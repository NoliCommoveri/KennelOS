import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, sql } from './helpers/worker.js';
import { makeDb } from './helpers/d1.js';

const { applyPending, migrationStatus, schemaIsCurrent } = migrate;

test('every migration applies to an empty database and creates every Phase 1 table', async () => {
  const db = makeDb();
  const { log, halted } = await applyPending(db);
  assert.equal(halted, false);
  assert.ok(log.length >= 2 && log.every((l) => l.ok));

  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  for (const t of ['users', 'login_codes', 'sessions', 'programs', 'snapshots', 'files', 'snapshot_files', 'rate_limits', 'dev_outbox', 'notices', '_migrations']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  assert.equal(await schemaIsCurrent(db), true);
});

test('applying twice runs nothing the second time', async () => {
  const db = makeDb();
  await applyPending(db);
  const again = await applyPending(db);
  assert.deepEqual(again.log, []);
});

test('an edited migration reads as drifted, and drift is never applied over', async () => {
  const db = makeDb();
  const original = [{ id: '0001', name: 'one', sql: 'CREATE TABLE a (x TEXT);' }];
  await applyPending(db, original);
  const edited = [{ id: '0001', name: 'one', sql: 'CREATE TABLE a (x TEXT, y TEXT);' }];

  const status = await migrationStatus(db, edited);
  assert.equal(status[0].state, 'drifted');
  assert.equal(await schemaIsCurrent(db, edited), false);
  assert.deepEqual((await applyPending(db, edited)).log, []);
});

test('an applied migration with no file reads as orphaned', async () => {
  const db = makeDb();
  await applyPending(db, [{ id: '0001', name: 'one', sql: 'CREATE TABLE a (x TEXT);' }]);
  const status = await migrationStatus(db, []);
  assert.deepEqual(status.map((s) => [s.id, s.state]), [['0001', 'orphaned']]);
});

test('a failing migration lands nothing and halts the ones after it', async () => {
  const db = makeDb();
  const list = [
    { id: '0001', name: 'good', sql: 'CREATE TABLE a (x TEXT);' },
    { id: '0002', name: 'bad', sql: 'CREATE TABLE b (x TEXT); INSERT INTO nowhere VALUES (1);' },
    { id: '0003', name: 'after', sql: 'CREATE TABLE c (x TEXT);' },
  ];
  const { log, halted } = await applyPending(db, list);
  assert.equal(halted, true);
  assert.deepEqual(log.map((l) => [l.id, l.ok]), [['0001', true], ['0002', false]]);
  assert.equal(log[1].statementList.length, 2);

  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  assert.ok(tables.includes('a'));
  assert.ok(!tables.includes('b'), 'the failed batch must roll back whole');
  assert.ok(!tables.includes('c'));
  const states = (await migrationStatus(db, list)).map((s) => s.state);
  assert.deepEqual(states, ['applied', 'pending', 'pending']);
});

test('the splitter keeps a ; inside a string and a trigger body whole', () => {
  // Heritage Hooves' splitter broke a seed migration on exactly this.
  const parts = sql.splitStatements(`
    INSERT INTO t VALUES ('one; two'); -- a comment; with a semicolon
    CREATE TRIGGER tr AFTER INSERT ON t BEGIN UPDATE t SET x = 1; UPDATE t SET y = 2; END;
    SELECT 1;`);
  assert.equal(parts.length, 3);
  assert.match(parts[0], /'one; two'/);
  assert.match(parts[1], /END$/);
});
