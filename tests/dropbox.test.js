// dropbox.test.js — the Dropbox client against a stubbed Dropbox API (review K2-9,
// K2-13; Review Remainder plan §3 E): a revoked grant forgets the connection and
// says so; the backup push is guarded by the file's revision, so a phone that
// hasn't seen another's push gets the conflict instead of replacing it.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let dbx, settings, sync, ie, tables;
// The stubbed Dropbox: one app folder, revisions counted up, a refresh grant that
// can be revoked.
const box = { files: new Map(), revN: 0, revoked: false, calls: [] };
function json(status, body, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
async function fakeFetch(url, init = {}) {
  const u = String(url);
  if (u.endsWith('/oauth2/token')) {
    box.calls.push('token');
    if (box.revoked) return json(400, { error: 'invalid_grant', error_description: 'refresh token is invalid or revoked' });
    return json(200, { access_token: 'at', expires_in: 14400 });
  }
  const arg = JSON.parse(init.headers['Dropbox-API-Arg']);
  if (u.endsWith('/upload')) {
    box.calls.push(`upload ${JSON.stringify(arg.mode)}`);
    const cur = box.files.get(arg.path);
    const m = arg.mode;
    const conflict = (m === 'add' && cur) || (m?.['.tag'] === 'update' && (!cur || cur.rev !== m.update));
    if (conflict) return json(409, { error_summary: 'path/conflict/file/..' });
    const rev = `r${++box.revN}`;
    box.files.set(arg.path, { rev, body: init.body });
    return json(200, { rev, path_display: arg.path });
  }
  if (u.endsWith('/download')) {
    const cur = box.files.get(arg.path);
    if (!cur) return json(409, { error_summary: 'path/not_found/..' });
    return new Response(cur.body, { status: 200, headers: { 'Dropbox-API-Result': JSON.stringify({ rev: cur.rev }) } });
  }
  throw new Error(`unexpected ${u}`);
}

before(async () => {
  ({ tables } = await installMemoryDb());
  globalThis.fetch = fakeFetch;
  dbx = await import('../shared/data/dropbox.js');
  settings = await import('../shared/data/settings.js');
  sync = await import('../shared/data/assistantSync.js');
  ie = await import('../shared/data/importExport.js');
});
beforeEach(() => {
  box.files.clear(); box.revN = 0; box.revoked = false; box.calls.length = 0;
  localStorage.clear();
  settings.setDropboxSettings({ refreshToken: 'rt' });
  tables.dogs.rows.set('d1', { id: 'd1', call_name: 'Ruby', updated_at: '2026-11-01T00:00:00.000Z' });
});

test('a revoked grant disconnects, says to connect again, and tells the page', async () => {
  box.revoked = true;
  let heard = 0;
  const onChanged = () => { heard++; };
  globalThis.addEventListener?.(dbx.DROPBOX_CHANGED_EVENT, onChanged);
  await assert.rejects(dbx.dropboxUploadJson('/x.json', {}), (e) => e.code === 'dropbox_expired' && e.message === 'Your Dropbox connection has expired. Connect again.');
  assert.equal(dbx.isDropboxConnected(), false, 'the card shows Connect');
  if (globalThis.addEventListener) assert.equal(heard, 1);
  globalThis.removeEventListener?.(dbx.DROPBOX_CHANGED_EVENT, onChanged);
});

test('a network failure on the refresh keeps the connection', async () => {
  const was = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  try {
    await assert.rejects(dbx.dropboxUploadJson('/x.json', {}), /Could not reach Dropbox/);
    assert.equal(dbx.isDropboxConnected(), true);
  } finally { globalThis.fetch = was; }
});

test('two phones: the stale one gets the conflict, then pulls, restores, and pushes', async () => {
  const P = dbx.DROPBOX_PATHS.backup;
  // Phone A pushes first: nothing there, so an add.
  await sync.pushToDropbox();
  const aRev = dbx.knownRev(P);
  assert.ok(aRev);
  const aSettings = settings.getDropboxSettings();

  // Phone B has never seen the file: its push is refused, nothing replaced.
  localStorage.clear();
  settings.setDropboxSettings({ refreshToken: 'rt' });
  await assert.rejects(sync.pushToDropbox(), (e) => e.code === 'dropbox_conflict' && /Pull it first, or push anyway/.test(e.message));
  assert.equal(box.files.get(P).rev, aRev);
  // A preview alone doesn't count as seen.
  const fetched = await sync.fetchDropboxBackup();
  assert.equal(fetched.rev, aRev);
  await assert.rejects(sync.pushToDropbox(), (e) => e.code === 'dropbox_conflict');
  // Restored from it: now B's push replaces it.
  sync.noteDropboxRestored(fetched.rev);
  await sync.pushToDropbox();
  const bRev = box.files.get(P).rev;
  assert.notEqual(bRev, aRev);

  // Phone A, a stale rev now: conflict; Push anyway overwrites.
  localStorage.clear();
  settings.setDropboxSettings(aSettings);
  await assert.rejects(sync.pushToDropbox(), (e) => e.code === 'dropbox_conflict');
  await sync.pushToDropbox({ force: true });
  assert.notEqual(box.files.get(P).rev, bRev);
  assert.equal(dbx.knownRev(P), box.files.get(P).rev);
});

test('the assistant feed stays an unguarded overwrite', () => {
  assert.equal(dbx.uploadMode(dbx.DROPBOX_PATHS.feed), 'overwrite');
  assert.equal(dbx.uploadMode('/p', { guard: true }), 'add');
  assert.equal(dbx.uploadMode('/p', { guard: true, force: true }), 'overwrite');
});

test('the restore preview knows a backup made before her newest change', () => {
  assert.equal(ie.backupIsBehind('2026-11-01T10:00:00.000Z', '2026-11-02T09:00:00.000Z'), true);
  assert.equal(ie.backupIsBehind('2026-11-03T10:00:00.000Z', '2026-11-02T09:00:00.000Z'), false);
  assert.equal(ie.backupIsBehind(null, '2026-11-02T09:00:00.000Z'), false);
  assert.equal(ie.backupIsBehind('2026-11-01T10:00:00.000Z', null), false);
});
