// Integration plumbing (docs/KennelOS_Integrations_Plan.md §0, step 5): a vendor
// connection with its token sealed, the webhook route (the adapter's signature
// check, the allow-list, a retry ignored), the events stream, disconnect with a
// revoke at the vendor, retention and account deletion. A test adapter stands in
// for a vendor; production registers none until step 6.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn } from './helpers/env.js';

const integrations = await import('../src/integrations.js');
const { runRetention } = await import('../src/retention.js');
const { createConnection, registerAdapter, unregisterAdapter, cleanEvent, openToken } = integrations;

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const count = (env, table) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const KEY = 'test-int-token-key';

function makePro(env, session) {
  const { email_hash: eh } = env.DB.raw.prepare(
    'SELECT u.email_hash FROM users u JOIN programs p ON p.owner_user_id = u.id WHERE p.id = ?',
  ).get(session.programId);
  env.DB.raw.prepare(
    `INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
     VALUES (?, ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`,
  ).run(`order:${session.programId}`, eh, iso(Date.now()), iso(Date.now()));
}

async function breeder(env, email = 'breeder@example.com') {
  const s = await signIn(env, email, { deviceId: 'phone-1' });
  makePro(env, s);
  return s;
}

// The test vendor: signs with a header equal to "ok", sends { events: [...] }.
let revoked;
beforeEach(() => {
  revoked = [];
  registerAdapter({
    provider: 'testpay',
    verify: async (request) => request.headers.get('x-test-signature') === 'ok',
    toEvents: (payload) => payload.events || [],
    revoke: async (env, token) => { revoked.push(token); },
  });
});
afterEach(() => unregisterAdapter('testpay'));

const hook = (env, path, body, sig = 'ok') => call(env, 'POST', path, { body, headers: { 'x-test-signature': sig } });
const paid = (id, extra = {}) => ({
  providerEventId: id, kind: 'payment.paid', recordType: 'sale', recordId: 'sale-1',
  data: { component: 'deposit', amount: 500, fee: 14.8, currency: 'USD', date: '2026-10-12', method: 'Card', reference: 'pi_123', ...extra },
});

test('cleanEvent keeps only what the kind allows', () => {
  const e = cleanEvent({ ...paid('ev1'), data: { ...paid('ev1').data, buyer_email: 'ann@example.com', amount: -3, note: 'hi' } });
  assert.deepEqual(e.payload, { component: 'deposit', fee: 14.8, currency: 'USD', date: '2026-10-12', method: 'Card', reference: 'pi_123' });
  assert.equal(cleanEvent({ ...paid('x'), kind: 'payment.stolen' }), null);
  assert.equal(cleanEvent({ ...paid('x'), recordType: 'contract' }), null, 'a payment is about a sale');
  assert.equal(cleanEvent({ ...paid('x'), recordId: 'not ok/../' }), null);
  assert.equal(cleanEvent({ ...paid(''), providerEventId: '' }), null);
  assert.deepEqual(cleanEvent({ providerEventId: 'c1', kind: 'contract.signed', recordType: 'contract', recordId: 'c-1', data: { date: 'today' } }).payload, {});
});

test('a connection seals its token, bound to the connection, and keeps only the hook secret\'s hash', async () => {
  const env = await makeEnv({ INT_TOKEN_KEY: KEY });
  const s = await breeder(env);
  const { id, hookPath } = await createConnection(env, s.programId, { provider: 'testpay', accountRef: 'acct_1', token: 'sk_secret' });
  assert.match(hookPath, /^\/hooks\/testpay\/[0-9a-f]{64}$/);
  const row = env.DB.raw.prepare('SELECT * FROM int_connections WHERE id = ?').get(id);
  assert.ok(!row.token_sealed.includes('sk_secret'));
  assert.ok(!JSON.stringify(row).includes(hookPath.split('/').pop()), 'the secret itself is not stored');
  assert.equal(await openToken(env, row), 'sk_secret');
  await assert.rejects(openToken(env, { ...row, id: 'another' }), 'a sealed token moved to another row does not open');

  await assert.rejects(createConnection(await makeEnv(), s.programId, { provider: 'testpay', token: 't' }), /integrations_not_configured/);
  await assert.rejects(createConnection(env, s.programId, { provider: 'nobody' }), /unknown_provider/);
});

test('webhooks: the secret finds the connection, the signature is checked, a retry is ignored', async () => {
  const env = await makeEnv({ INT_TOKEN_KEY: KEY });
  const s = await breeder(env);
  const { hookPath } = await createConnection(env, s.programId, { provider: 'testpay', token: 'sk' });

  assert.equal((await hook(env, hookPath, { events: [paid('ev1')] }, 'forged')).status, 401);
  assert.equal((await hook(env, hookPath.replace(/.$/, (c) => (c === '0' ? '1' : '0')), { events: [paid('ev1')] })).status, 404, 'a wrong secret');
  assert.equal((await hook(env, hookPath.replace('testpay', 'otherpay'), { events: [] })).status, 404, 'an unknown provider');
  assert.equal(count(env, 'int_events'), 0);

  const ok = await hook(env, hookPath, { events: [paid('ev1'), { providerEventId: 'junk', kind: 'nope' }] });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, received: 1 });
  assert.equal((await hook(env, hookPath, { events: [paid('ev1', { amount: 999 })] })).status, 200);
  assert.equal(count(env, 'int_events'), 1, 'the vendor retried: kept once, the first version');
  assert.equal(JSON.parse(env.DB.raw.prepare('SELECT payload FROM int_events').get().payload).amount, 500);
});

test('her devices read the events after their cursor; Pro only', async () => {
  const env = await makeEnv({ INT_TOKEN_KEY: KEY });
  const s = await breeder(env);
  const { hookPath } = await createConnection(env, s.programId, { provider: 'testpay' });
  await hook(env, hookPath, { events: [paid('a'), paid('b', { component: 'balance' }),
    { providerEventId: 'c', kind: 'contract.signed', recordType: 'contract', recordId: 'k-1', data: { date: '2026-10-11' } }] });

  const all = await (await call(env, 'GET', '/integrations/events?since=0', { token: s.token })).json();
  assert.equal(all.events.length, 3);
  assert.equal(all.more, false);
  assert.deepEqual(Object.keys(all.events[0]).sort(), ['createdAt', 'kind', 'payload', 'provider', 'recordId', 'recordType', 'seq']);
  const after = await (await call(env, 'GET', `/integrations/events?since=${all.events[1].seq}`, { token: s.token })).json();
  assert.deepEqual(after.events.map((e) => e.kind), ['contract.signed']);
  assert.equal((await call(env, 'GET', '/integrations/events?since=x', { token: s.token })).status, 400);

  const other = await signIn(env, 'other@example.com', { deviceId: 'x' });
  assert.equal((await call(env, 'GET', '/integrations/events?since=0', { token: other.token })).status, 403, 'not Pro');
  makePro(env, other);
  assert.equal((await (await call(env, 'GET', '/integrations/events?since=0', { token: other.token })).json()).events.length, 0, 'another program sees none');
});

test('connections list without tokens; disconnect revokes at the vendor and deletes', async () => {
  const env = await makeEnv({ INT_TOKEN_KEY: KEY });
  const s = await breeder(env);
  const { id } = await createConnection(env, s.programId, { provider: 'testpay', accountRef: 'acct_1', token: 'sk_live', scopes: 'payment_links' });
  const list = await (await call(env, 'GET', '/integrations/connections', { token: s.token })).json();
  assert.equal(list.connections.length, 1);
  assert.equal(list.connections[0].accountRef, 'acct_1');
  assert.ok(!JSON.stringify(list).includes('sk_live') && !JSON.stringify(list).includes('sealed'));

  const other = await breeder(env, 'other@example.com');
  assert.equal((await call(env, 'DELETE', `/integrations/connections/${id}`, { token: other.token })).status, 404, 'not theirs');
  assert.equal((await call(env, 'DELETE', `/integrations/connections/${id}`, { token: s.token })).status, 200);
  assert.deepEqual(revoked, ['sk_live']);
  assert.equal(count(env, 'int_connections'), 0);
});

test('retention drops events after 90 days; account deletion revokes and removes everything', async () => {
  const env = await makeEnv({ INT_TOKEN_KEY: KEY });
  const s = await breeder(env);
  const { hookPath } = await createConnection(env, s.programId, { provider: 'testpay', token: 'sk_del' });
  await hook(env, hookPath, { events: [paid('new')] });
  env.DB.raw.prepare(`INSERT INTO int_events (program_id, connection_id, provider, provider_event_id, kind, record_type, record_id, payload, created_at)
    VALUES (?, 'c', 'testpay', 'old', 'payment.paid', 'sale', 's', '{}', ?)`).run(s.programId, iso(Date.now() - 91 * DAY));
  await runRetention(env, new Date());
  assert.deepEqual(env.DB.raw.prepare('SELECT provider_event_id AS id FROM int_events').all().map((r) => r.id), ['new']);

  assert.equal((await call(env, 'DELETE', '/account', { token: s.token, body: { confirm: 'DELETE' } })).status, 200);
  assert.deepEqual(revoked, ['sk_del']);
  assert.equal(count(env, 'int_connections'), 0);
  assert.equal(count(env, 'int_events'), 0);
});
