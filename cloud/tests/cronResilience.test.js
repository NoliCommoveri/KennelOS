// cronResilience.test.js — review K04 findings 3, 4 and 12 (fix step 9a): one job,
// one R2 call or one pre-router throw can't take the rest down with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worker } from './helpers/worker.js';
import { makeEnv, call } from './helpers/env.js';

const { DAILY_CRON } = await import('../src/index.js');
const { runRetention } = await import('../src/retention.js');

// Run a cron to the end, collecting what it logs.
async function cron(env, cronExpr, scheduledTime) {
  const logs = [];
  const errors = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const waits = [];
    await worker.scheduled({ cron: cronExpr, ...(scheduledTime != null ? { scheduledTime } : {}) }, env, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  } finally {
    console.log = log;
    console.error = error;
  }
  return { logs, errors };
}

// Make every statement whose SQL matches `re` throw.
function failing(env, re, message = 'D1 refused the read') {
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => {
    if (re.test(sql)) return { bind() { return this; }, all: async () => { throw new Error(message); }, first: async () => { throw new Error(message); }, run: async () => { throw new Error(message); } };
    return prepare(sql);
  };
}

function seedDueEmailChange(env) {
  const at = new Date(Date.now() - 60_000).toISOString();
  env.DB.raw.prepare('INSERT INTO users (id, email_hash, created_at) VALUES (?, ?, ?)').run('u1', 'old-hash', at);
  env.DB.raw.prepare('INSERT INTO email_changes (user_id, new_email_hash, device_id, requested_at, effective_at) VALUES (?, ?, ?, ?, ?)')
    .run('u1', 'new-hash', 'd1', at, at);
}

test('K4-3: the waitlist read failing leaves the other hourly jobs running', async () => {
  const env = await makeEnv();
  seedDueEmailChange(env);
  failing(env, /FROM wl_projection/);
  const { logs, errors } = await cron(env, '0,30 * * * *');
  assert.ok(errors.some((e) => e.startsWith('waitlist moves failed')), 'the failure is logged');
  for (const job of ['email changes', 'digests', 'esign copies', 'esign previews']) {
    assert.ok(logs.some((l) => l.startsWith(job)), `${job} still ran`);
  }
  assert.equal(env.DB.raw.prepare('SELECT email_hash FROM users WHERE id = ?').get('u1').email_hash, 'new-hash', 'the due change applied');
});

test('K4-3: the hourly moves read kennels one at a time, every one of them', async () => {
  const env = await makeEnv();
  const { runWaitlistMoves } = await import('../src/serverMoves.js');
  const now = new Date().toISOString();
  env.DB.raw.prepare('INSERT INTO users (id, email_hash, created_at) VALUES (?, ?, ?)').run('u', 'h', now);
  for (let i = 0; i < 3; i++) {
    env.DB.raw.prepare('INSERT INTO programs (id, owner_user_id, created_at) VALUES (?, ?, ?)').run(`p${i}`, 'u', now);
    env.DB.raw.prepare('INSERT INTO wl_projection (public_id, program_id, version, body, device_id, published_at) VALUES (?, ?, 1, ?, ?, ?)')
      .run(`pub${i}`, `p${i}`, JSON.stringify({ entries: [] }), 'd', new Date().toISOString());
  }
  const totals = await runWaitlistMoves(env);
  assert.equal(totals.kennels, 3);
});

test('K4-4: an R2 failure in the sweep still lets the day\'s D1 purge run', async () => {
  const env = await makeEnv();
  const past = new Date(Date.now() - 60_000).toISOString();
  env.DB.raw.prepare('INSERT INTO login_codes (email_hash, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)')
    .run('h', 'c', past, past);
  env.FILES.list = async () => { throw new Error('R2 unavailable'); };
  const errs = [];
  const error = console.error;
  console.error = (...a) => errs.push(a.join(' '));
  let summary;
  try { summary = await runRetention(env); } finally { console.error = error; }
  assert.equal(summary.r2SweepError, true);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM login_codes').get().n, 0, 'the expired code was purged');
  assert.ok(errs.some((e) => e.startsWith('r2 sweep failed')));
});

test('K4-4: the daily cron logs a retention failure instead of ending silently', async () => {
  const env = await makeEnv();
  failing(env, /FROM snapshots WHERE status = 'committed'/);
  const { errors } = await cron(env, DAILY_CRON);
  assert.ok(errors.some((e) => e.startsWith('retention failed')));
});

test('K4-12: a throw before the router answers JSON with CORS, not a bare exception', async () => {
  const env = await makeEnv();
  // The family pages are served first; make their asset fetch throw.
  env.ASSETS = { fetch: async () => { throw new Error('assets down'); } };
  const error = console.error;
  console.error = () => {};
  let res;
  try { res = await call(env, 'GET', '/list/abc'); } finally { console.error = error; }
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'internal' });
});

test('Waitlist Timers T3: the :30 run is the waitlist moves only; :00 runs every hourly job', async () => {
  const env = await makeEnv();
  const half = await cron(env, '0,30 * * * *', Date.parse('2026-11-19T18:30:00Z'));
  assert.ok(half.logs.some((l) => l.startsWith('waitlist moves')), 'moves at :30');
  for (const job of ['email changes', 'digests', 'esign copies', 'esign previews']) {
    assert.ok(!half.logs.some((l) => l.startsWith(job)), `${job} waits for :00`);
  }
  const top = await cron(env, '0,30 * * * *', Date.parse('2026-11-19T19:00:00Z'));
  for (const job of ['waitlist moves', 'email changes', 'digests', 'esign copies', 'esign previews']) {
    assert.ok(top.logs.some((l) => l.startsWith(job)), `${job} at :00`);
  }
});
