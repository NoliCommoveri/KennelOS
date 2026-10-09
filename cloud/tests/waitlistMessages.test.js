// Emails to families in the kennel's name (docs/KennelOS_Waitlist_W2_Plan.md
// §8, step 6): POST /waitlist/messages, the kennel's sender address, the footer
// with the status-page link, retries, and the emails a status page lists.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn } from './helpers/env.js';

const { senderBase, senderDisplayName, familySender, familyFooter } = await import('../src/mail.js');
const { EMAIL_KINDS, MESSAGE_LIMITS } = await import('../src/waitlist.js');

const KENNEL = 'kos1_11111111-2222-4333-8444-555555555555';
const OTHER_KENNEL = 'kos1_99999999-2222-4333-8444-555555555555';
const TOKEN = 'a'.repeat(64);
const iso = (ms) => new Date(ms).toISOString();
const count = (env, table) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// Every Resend call, from the start (sign-in codes too); `sent.status` is what
// Resend answers next, and `sent.clear()` forgets the setup's emails.
function captureFetch() {
  const sent = [];
  sent.status = 200;
  sent.clear = () => { sent.length = 0; };
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response('{}', { status: sent.status });
  };
  return sent;
}

function makePro(env, session) {
  const { email_hash: eh } = env.DB.raw.prepare(
    'SELECT u.email_hash FROM users u JOIN programs p ON p.owner_user_id = u.id WHERE p.id = ?',
  ).get(session.programId);
  env.DB.raw.prepare(
    `INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
     VALUES (?, ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`,
  ).run(`order:${session.programId}`, eh, iso(Date.now()), iso(Date.now()));
}

async function breeder(env, email = 'breeder@example.com', deviceId = 'phone-1') {
  const s = await signIn(env, email, { deviceId });
  makePro(env, s);
  await call(env, 'POST', '/program/backing-device', { token: s.token });
  return s;
}

const projection = (name = 'Thornfield Kennels') => ({
  kennel: { name, time_zone: 'America/Chicago' },
  public_list: [],
  entries: {
    e1: { name: 'Ann Lee', email: 'ann@example.com', status: 'active', status_token: TOKEN },
    e2: { name: 'No Email', email: null, status: 'active' },
  },
  litters: {},
});

async function published(env, s, kennel = KENNEL, name) {
  const res = await call(env, 'PUT', `/waitlist/projection/${kennel}`, { token: s.token, body: { projection: projection(name) } });
  assert.equal(res.status, 200);
}

const message = (over = {}) => ({
  id: 'msg-00000001', public_id: KENNEL, entry_id: 'e1', kind: 'offer',
  subject: "It's your turn at Thornfield Kennels", body: 'Hi Ann,\n\nYour turn is here.\n', ...over,
});
const send = (env, s, body) => call(env, 'POST', '/waitlist/messages', { token: s.token, body });

test('the sender address comes from the kennel name', () => {
  assert.equal(senderBase('Thornfield Kennels'), 'thornfield-kennels');
  assert.equal(senderBase('  Café & Crème  '), 'cafe-and-creme');
  assert.equal(senderBase('***'), 'kennel');
  assert.equal(senderBase('x'.repeat(80)).length, 40);
  assert.equal(senderDisplayName('Bad "Name" <x@y>\r\nBcc: z'), 'Bad Name x@y Bcc: z');
  assert.equal(senderDisplayName(''), 'Waitlist');
  assert.match(familyFooter('https://apply.example/s/abc', 'Thornfield'), /status page:\nhttps:\/\/apply\.example\/s\/abc\n/);
});

test('her device sends an email; the server picks the address and adds the status link', async () => {
  const env = await makeEnv({ MAIL_FAMILY_DOMAIN: 'mail.kennelos.app', FAMILY_PAGES_ORIGIN: 'https://apply.kennelos.app' });
  const sent = captureFetch();
  const s = await breeder(env);
  await published(env, s);
  env.RESEND_API_KEY = 're_test'; // after signing in, which reads the staging outbox
  sent.clear();
  const res = await send(env, s, message({ to: 'someone-else@example.com' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'sent');
  assert.ok(body.sentAt);

  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, ['ann@example.com'], 'never an address the device names');
  assert.equal(sent[0].body.from, '"Thornfield Kennels" <thornfield-kennels@mail.kennelos.app>');
  assert.equal(sent[0].body.reply_to, undefined, 'no-reply: no Reply-To');
  assert.equal(sent[0].body.subject, "It's your turn at Thornfield Kennels");
  assert.match(sent[0].body.text, /^Hi Ann,\n\nYour turn is here\.\n\n--\n/);
  assert.match(sent[0].body.text, new RegExp(`https://apply\\.kennelos\\.app/s/${TOKEN}`));
  assert.match(sent[0].body.text, /doesn't receive replies/);

  const row = env.DB.raw.prepare('SELECT kind, entry_id, to_email, body, status FROM wl_messages WHERE id = ?').get('msg-00000001');
  assert.equal(row.kind, 'offer');
  assert.equal(row.entry_id, 'e1');
  assert.equal(row.to_email, 'ann@example.com');
  assert.equal(row.body, 'Hi Ann,\n\nYour turn is here.', 'stored without the footer');
  assert.equal(row.status, 'sent');
});

test('a retry with the same id never sends twice; a failed one is tried again', async () => {
  const env = await makeEnv({ MAIL_FAMILY_DOMAIN: 'mail.kennelos.app' });
  const sent = captureFetch();
  const s = await breeder(env);
  await published(env, s);
  env.RESEND_API_KEY = 're_test';
  sent.status = 500;
  const realError = console.error;
  console.error = () => {};
  try {
    assert.equal((await (await send(env, s, message())).json()).status, 'failed');
  } finally {
    console.error = realError;
  }
  sent.status = 200;
  sent.clear();
  assert.equal((await (await send(env, s, message())).json()).status, 'sent');
  assert.equal((await (await send(env, s, message())).json()).status, 'sent');
  assert.equal(sent.length, 1, 'the third call is answered from the row');
  assert.equal(count(env, 'wl_messages'), 1);
});

test('only to a family in the published list, with an email, and only from the backing device', async () => {
  const env = await makeEnv();
  const s = await breeder(env);
  assert.equal((await (await send(env, s, message())).json()).error, 'not_published', 'nothing published yet');
  await published(env, s);
  assert.equal((await (await send(env, s, message({ entry_id: 'nobody' }))).json()).error, 'not_published');
  assert.equal((await (await send(env, s, message({ entry_id: 'e2' }))).json()).error, 'no_email');

  const laptop = await signIn(env, 'breeder@example.com', { deviceId: 'laptop-1' });
  assert.equal((await (await send(env, laptop, message())).json()).error, 'not_backing_device');

  const other = await breeder(env, 'other@example.com', 'other-phone');
  const refused = await send(env, other, message());
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'kennel_taken', "another account can't mail her families");

  // Staging's outbox: recorded as sent, nothing delivered.
  const sent = captureFetch();
  assert.equal((await (await send(env, s, message())).json()).status, 'sent');
  assert.equal(sent.length, 0);
});

test('a malformed message is refused before anything is sent', async () => {
  const env = await makeEnv();
  const s = await breeder(env);
  await published(env, s);
  for (const bad of [
    { id: 'x' }, { kind: 'invoice' }, { subject: '' }, { subject: 'Two\nlines' }, { subject: 's'.repeat(MESSAGE_LIMITS.subjectMax + 1) },
    { body: '  ' }, { body: 'b'.repeat(MESSAGE_LIMITS.bodyMax + 1) }, { entry_id: 'bad id!' }, { public_id: 'thornfield' },
  ]) {
    const res = await send(env, s, message(bad));
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  assert.equal(count(env, 'wl_messages'), 0);
  assert.ok(EMAIL_KINDS.includes('offer') && !EMAIL_KINDS.includes('verification_code'));
});

test('Pro only', async () => {
  const env = await makeEnv();
  const s = await signIn(env, 'lite@example.com', { deviceId: 'phone-1' });
  const res = await send(env, s, message());
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'pro_required');
});

test('two kennels with the same name get different addresses; a renamed kennel a new one', async () => {
  const env = await makeEnv({ MAIL_FAMILY_DOMAIN: 'mail.kennelos.app' });
  const a = await breeder(env, 'a@example.com', 'a-phone');
  const b = await breeder(env, 'b@example.com', 'b-phone');
  const from = (s, publicId, kennelName) => familySender(env, { programId: s.programId, publicId, kennelName });
  assert.equal(await from(a, KENNEL, 'Thornfield'), '"Thornfield" <thornfield@mail.kennelos.app>');
  assert.equal(await from(a, KENNEL, 'Thornfield'), '"Thornfield" <thornfield@mail.kennelos.app>', 'stable');
  assert.equal(await from(b, OTHER_KENNEL, 'Thornfield'), '"Thornfield" <thornfield-9999@mail.kennelos.app>');
  assert.equal(await from(a, KENNEL, 'Thornfield Farm'), '"Thornfield Farm" <thornfield-farm@mail.kennelos.app>');
  assert.equal(await from(b, OTHER_KENNEL, 'Support'), '"Support" <support-9999@mail.kennelos.app>', 'reserved names are never handed out');
  assert.equal(await familySender({ ...env, MAIL_FAMILY_DOMAIN: '' }, { programId: a.programId, publicId: KENNEL, kennelName: 'X' }),
    'KennelOS <signin@kennelos.app>', 'without the family domain, the sign-in sender');
});

test('sign-in codes for families come from the kennel too', async () => {
  const env = await makeEnv({ MAIL_FAMILY_DOMAIN: 'mail.kennelos.app' });
  const sent = captureFetch();
  const s = await breeder(env);
  await published(env, s);
  env.RESEND_API_KEY = 're_test'; // after signing in, which reads the staging outbox
  sent.clear();
  const res = await call(env, 'POST', '/f/code', { body: { public_id: KENNEL, email: 'ann@example.com' } });
  assert.equal(res.status, 200);
  assert.equal(sent[0].body.from, '"Thornfield Kennels" <thornfield-kennels@mail.kennelos.app>');
});

test("a family's status page lists the emails sent to them, newest first", async () => {
  const env = await makeEnv();
  const s = await breeder(env);
  await published(env, s);
  const t0 = Date.parse('2026-10-01T12:00:00Z');
  const mail = (id, at, body = 'Body', kind = 'offer', entry = 'e1') => env.DB.raw.prepare(
    `INSERT INTO wl_messages (id, program_id, public_id, entry_id, kind, to_email, subject, body, send_after, status, sent_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'ann@example.com', ?, ?, ?, 'sent', ?, ?)`,
  ).run(id, s.programId, KENNEL, entry, kind, `Subject ${id}`, body, iso(at), iso(at), iso(at));
  mail('m1', t0, null);
  mail('m2', t0 + 1000);
  mail('m3', t0 + 2000, 'Your code is 123456', 'verification_code');
  mail('m4', t0 + 3000, 'Not theirs', 'offer', 'e2');
  const view = await (await call(env, 'GET', `/f/status/${TOKEN}`)).json();
  assert.deepEqual(view.emails, [
    { at: iso(t0 + 1000), subject: 'Subject m2', body: 'Body' },
    { at: iso(t0), subject: 'Subject m1', body: null },
  ]);
});
