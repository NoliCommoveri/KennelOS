// The online application form, server side (docs/KennelOS_Waitlist_W2_Plan.md
// step 4): the form as published, a sealed application held until the applicant
// types the emailed code, then reaching her inbox with its status link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn } from './helpers/env.js';

const { runRetention } = await import('../src/retention.js');
const { FAMILY_LIMITS, formView } = await import('../src/familyPages.js');

const KENNEL = 'kos1_11111111-2222-4333-8444-555555555555';
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const count = (env, table, where = '1=1') => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get().n;

const form = (extra = {}) => ({
  open: true, key_id: 'fk_1', public_key: 'BPUBLICKEY',
  questions: [{ id: 'name', key: 'name', label: 'Name', type: 'short_text', required: true }, { id: 'email', key: 'email', label: 'Email', type: 'email', required: true }],
  faq: [{ id: 'f1', question: 'Price?', answer: '$2,500' }], breeds: ['Boston Terrier'], matching_keys: ['pref_sex'], matching_notice: 'Only matching pups.', color_matching: false,
  ...extra,
});
const projection = (formExtra = {}, entries = {}) => ({
  format: 1, as_of: '2026-10-08', kennel: { public_id: KENNEL, name: 'Thornfield Kennels', time_zone: 'America/Chicago', form: form(formExtra) },
  public_list: [], entries, litters: {},
});

async function setup(extraEnv = {}, formExtra = {}) {
  const env = await makeEnv(extraEnv);
  const s = await signIn(env, 'breeder@example.com');
  const { email_hash: eh } = env.DB.raw.prepare('SELECT email_hash FROM users').get();
  env.DB.raw.prepare(`INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
    VALUES ('order:1', ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`).run(eh, iso(), iso());
  await call(env, 'POST', '/program/backing-device', { token: s.token });
  const pub = await call(env, 'PUT', `/waitlist/projection/${KENNEL}`, { token: s.token, body: { projection: projection(formExtra) } });
  assert.equal(pub.status, 200);
  return { env, s };
}

const application = (extra = {}) => ({ key_id: 'fk_1', sealed: 'U0VBTEVE', name: 'Ann Lee', email: 'Ann@Example.com', ...extra });
const apply = (env, body = application(), ip = '203.0.113.5') => call(env, 'POST', `/f/apply/${KENNEL}`, { body, ip });
const lastCode = (env) => /(\d{6})/.exec(env.DB.raw.prepare('SELECT subject FROM wl_messages ORDER BY rowid DESC LIMIT 1').get().subject)[1];
const inbox = async (env, s) => (await (await call(env, 'GET', '/waitlist/inbox', { token: s.token })).json()).items;

test('the form page gets her published form, and nothing when she isn\'t taking applications', async () => {
  const { env } = await setup();
  const res = await call(env, 'GET', `/f/form/${KENNEL}`);
  assert.equal(res.status, 200);
  const v = await res.json();
  assert.deepEqual(Object.keys(v).sort(), ['form', 'kennel', 'turnstile_site_key']);
  assert.equal(v.form.public_key, 'BPUBLICKEY');
  assert.equal(v.turnstile_site_key, null);
  assert.equal(formView(projection({ open: false })), null);
  assert.equal(formView({ kennel: {} }), null);
  const closed = await setup({}, { open: false });
  assert.equal((await call(closed.env, 'GET', `/f/form/${KENNEL}`)).status, 404);
  assert.equal((await apply(closed.env)).status, 404);
});

test('an application waits for its emailed code, then reaches her inbox with its link', async () => {
  const { env, s } = await setup();
  const res = await apply(env);
  assert.equal(res.status, 200);
  assert.equal(count(env, 'wl_inbox', 'confirmed_at IS NULL'), 1);
  assert.deepEqual(await inbox(env, s), [], 'unconfirmed: her device never sees it');
  const msg = env.DB.raw.prepare('SELECT kind, to_email, subject, body FROM wl_messages').get();
  assert.equal(msg.kind, 'application_code');
  assert.equal(msg.to_email, 'ann@example.com');
  assert.match(msg.subject, /Confirm your application to Thornfield Kennels: \d{6}/);

  const verify = await call(env, 'POST', '/f/verify', { body: { public_id: KENNEL, code: lastCode(env) } });
  assert.equal(verify.status, 200);
  const { status_token: token, session } = await verify.json();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.ok(session);

  const items = await inbox(env, s);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'application');
  assert.equal(items[0].name, 'Ann Lee');
  assert.equal(items[0].email, 'ann@example.com');
  assert.equal(items[0].blob, 'U0VBTEVE');
  assert.equal(items[0].statusToken, token, 'her device keeps the link the applicant already has');
  assert.equal(items[0].entryId, items[0].id);

  const page = await (await call(env, 'GET', `/f/status/${token}`)).json();
  assert.deepEqual(page.family, { name: 'Ann Lee', status: 'applied' }, 'their page says it arrived, and nothing else yet');

  // Her device publishes before taking it in: the applicant's link survives.
  await call(env, 'PUT', `/waitlist/projection/${KENNEL}`, { token: s.token, body: { projection: projection() } });
  assert.equal((await call(env, 'GET', `/f/status/${token}`)).status, 200);
  // Taken in (acked) and published with the entry: still the same link.
  await call(env, 'POST', '/waitlist/inbox/ack', { token: s.token, body: { ids: [items[0].id] } });
  await call(env, 'PUT', `/waitlist/projection/${KENNEL}`, { token: s.token, body: { projection: projection({}, {
    [items[0].id]: { name: 'Ann Lee', email: 'ann@example.com', status: 'applied', status_token: token, offers: [] },
  }) } });
  assert.equal((await (await call(env, 'GET', `/f/status/${token}`)).json()).family.status, 'applied');
});

test('an applicant who lost the code can get a new one from See Your Details', async () => {
  const { env, s } = await setup();
  await apply(env);
  await call(env, 'POST', '/f/code', { body: { public_id: KENNEL, email: 'ann@example.com' } });
  const msg = env.DB.raw.prepare('SELECT kind FROM wl_messages ORDER BY rowid DESC LIMIT 1').get();
  assert.equal(msg.kind, 'verification_code');
  assert.equal((await call(env, 'POST', '/f/verify', { body: { public_id: KENNEL, code: lastCode(env) } })).status, 200);
  assert.equal((await inbox(env, s)).length, 1, 'confirmed by that code too');
});

test('applying again before confirming replaces the first try; a changed key or a bad request is refused', async () => {
  const { env } = await setup();
  await apply(env);
  await apply(env, application({ name: 'Ann Lee-Smith' }));
  assert.equal(count(env, 'wl_inbox'), 1);
  assert.equal(count(env, 'wl_tokens'), 1, 'the first try\'s link went with it');
  assert.equal(env.DB.raw.prepare('SELECT name FROM wl_inbox').get().name, 'Ann Lee-Smith');

  const changed = await apply(env, application({ key_id: 'fk_old', email: 'bo@example.com' }));
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error, 'form_changed');
  assert.equal((await apply(env, application({ email: 'nope' }))).status, 400);
  assert.equal((await apply(env, application({ email: 'cy@example.com', name: ' ' }))).status, 400);
  assert.equal((await apply(env, application({ email: 'cy@example.com', sealed: '' }))).status, 400);
  assert.equal((await apply(env, application({ email: 'cy@example.com', sealed: 'x'.repeat(FAMILY_LIMITS.applicationBytes + 1) }))).status, 400);
});

test('applications are rate-limited per address and per connection', async () => {
  const { env } = await setup();
  for (let i = 0; i < FAMILY_LIMITS.applicationsPerHourPerEmail; i++) assert.equal((await apply(env, application(), `198.51.100.${i}`)).status, 200);
  assert.equal((await apply(env, application(), '198.51.100.50')).status, 429);
  for (let i = 0; i < FAMILY_LIMITS.applicationsPerHourPerIp; i++) await apply(env, application({ email: `p${i}@example.com` }), '192.0.2.77');
  assert.equal((await apply(env, application({ email: 'late@example.com' }), '192.0.2.77')).status, 429);
});

test('Turnstile decides when it\'s set up; production without it keeps the form closed', async () => {
  const realFetch = globalThis.fetch;
  let verdict = false;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://challenges.cloudflare.com/')) return new Response(JSON.stringify({ success: verdict }));
    if (String(url).startsWith('https://api.resend.com/')) return new Response('{}', { status: 200 });
    return realFetch(url);
  };
  try {
    const { env } = await setup({ TURNSTILE_SECRET: 'ts', TURNSTILE_SITE_KEY: 'site' });
    assert.equal((await (await call(env, 'GET', `/f/form/${KENNEL}`)).json()).turnstile_site_key, 'site');
    const no = await apply(env, application({ turnstile: 'tok' }));
    assert.equal(no.status, 400);
    assert.equal((await no.json()).error, 'not_verified');
    verdict = true;
    assert.equal((await apply(env, application({ turnstile: 'tok' }))).status, 200);

    const prod = await setup();
    Object.assign(prod.env, { DEV_OUTBOX: '0', RESEND_API_KEY: 're_test' }); // production: email works, no Turnstile yet
    const closed = await apply(prod.env, application({ email: 'z@example.com' }));
    assert.equal(closed.status, 503);
    assert.equal((await closed.json()).error, 'form_unavailable');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('an application never confirmed is removed after two days, with its link', async () => {
  const { env } = await setup();
  await apply(env);
  await apply(env, application({ email: 'bo@example.com', name: 'Bo Kim' }));
  await call(env, 'POST', '/f/verify', { body: { public_id: KENNEL, code: lastCode(env) } }); // Bo confirms
  env.DB.raw.prepare('UPDATE wl_inbox SET created_at = ?').run(iso(Date.now() - 3 * 24 * 3600 * 1000));
  await runRetention(env);
  assert.deepEqual(env.DB.raw.prepare('SELECT name FROM wl_inbox').all().map((r) => r.name), ['Bo Kim']);
  assert.equal(count(env, 'wl_tokens'), 1);
});
