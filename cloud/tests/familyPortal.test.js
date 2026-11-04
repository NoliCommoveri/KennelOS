// Her puppy portal on KennelPort, from the status page (KennelPort's
// Puppy_Parent_Portal_Plan.md 3.4): Open your puppy portal while her device says
// the family's signed sale is in the portal; only that once the portal has taken
// over, or the pickup day has passed; the one-tap link, signed in KennelPort's
// format with the key her device published, only for a signed-in family; and no
// Companion link request while the portal is on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, signIn } from './helpers/env.js';
import { hmacHex } from '../src/lib/crypto.js';

const { statusView, portalOf, localDay } = await import('../src/familyPages.js');

const KENNEL = 'kos1_11111111-2222-4333-8444-555555555555';
const KEY = 'ab'.repeat(32);
const tok = (c) => c.repeat(64);
const iso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const projection = (extra = {}) => ({
  format: 1, as_of: today(),
  kennel: { public_id: KENNEL, name: 'Thornfield Kennels', time_zone: 'UTC', breeds: [] },
  public_list: [],
  entries: {
    ann: { name: 'Ann Lee', email: 'ann@example.com', status: 'placed', status_token: tok('a'),
      companion: { available: true, link: false, request: null },
      pickup: { slots: [], booked: null, requests: [] },
      portal: { family_id: 'contact-ann', only: false, pickup_on: plusDays(5) } },
    bo: { name: 'Bo Kim', email: 'bo@example.com', status: 'placed', status_token: tok('b'),
      companion: { available: true, request: null } },
  },
  litters: {}, upcoming: [],
  server: { portal: { url: 'https://ak.kennelport.com/family', handoff_url: 'https://ak.kennelport.com/family/handoff', handoff_key: KEY, minutes: 10 } },
  ...extra,
});

test('statusView: Open your puppy portal while it is on for them; only that once it has taken over or pickup has passed', () => {
  const p = projection();
  const v = statusView(p, 'ann');
  assert.deepEqual(v.family.portal, { only: false });
  assert.equal(v.kennel.portal_url, 'https://ak.kennelport.com/family');
  assert.equal(v.family.companion.link, false, 'before pickup the status page stays, without the Companion request');
  assert.equal(JSON.stringify(v).includes(KEY), false, 'the key never reaches a family');
  assert.equal(JSON.stringify(v).includes('contact-ann'), false);

  p.entries.ann.portal.only = true;
  const only = statusView(p, 'ann');
  assert.deepEqual(only.family, { name: 'Ann Lee', status: 'placed', portal: { only: true } });
  assert.deepEqual([only.offers, only.litters, only.upcoming, only.public_list], [[], [], [], []]);

  p.entries.ann.portal = { family_id: 'contact-ann', only: false, pickup_on: plusDays(-1) };
  assert.equal(statusView(p, 'ann').family.portal.only, true, 'the switch at pickup happens on the server, not waiting for her device');
  p.entries.ann.portal.pickup_on = today();
  assert.equal(portalOf(p, p.entries.ann).only, false, 'the pickup day itself still shows the status page');

  assert.equal(statusView(p, 'bo').family.portal, undefined);
  delete p.server;
  assert.equal(statusView(p, 'ann').family.portal, undefined, 'without the one-tap link on the server, nothing');
});

test('localDay reads her time zone', () => {
  const at = new Date('2026-12-24T03:00:00Z');
  assert.equal(localDay('America/Chicago', at), '2026-12-23');
  assert.equal(localDay('UTC', at), '2026-12-24');
  assert.equal(localDay('Not/AZone', at), '2026-12-24');
});

async function setup(p = projection()) {
  const env = await makeEnv();
  const s = await signIn(env, 'breeder@example.com');
  const { email_hash: eh } = env.DB.raw.prepare('SELECT email_hash FROM users').get();
  env.DB.raw.prepare(`INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
    VALUES ('order:1', ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`).run(eh, iso(), iso());
  await call(env, 'POST', '/program/backing-device', { token: s.token });
  const publish = async (proj) => assert.equal((await call(env, 'PUT', `/waitlist/projection/${KENNEL}`, { token: s.token, body: { projection: proj } })).status, 200);
  await publish(p);
  let ip = 10;
  const familySession = async (email) => {
    const at = `192.0.2.${ip++}`;
    await call(env, 'POST', '/f/code', { body: { public_id: KENNEL, email }, ip: at });
    const code = /(\d{6})/.exec(env.DB.raw.prepare('SELECT subject FROM wl_messages ORDER BY rowid DESC LIMIT 1').get().subject)[1];
    return (await (await call(env, 'POST', '/f/verify', { body: { public_id: KENNEL, code }, ip: at })).json()).session;
  };
  return { env, publish, ann: await familySession('ann@example.com'), bo: await familySession('bo@example.com') };
}

const portal = (env, session, token) => call(env, 'POST', '/f/portal', { body: { session, status_token: token } });

// KennelPort's own check (its worker/src/portal/feed.js redeemHandoff), minus the
// database: signed with the site's key, unexpired, at most its minutes ahead.
async function kennelportReads(url) {
  const t = new URL(url).searchParams.get('t');
  const m = /^([A-Za-z0-9_-]{10,400})\.([0-9a-f]{64})$/.exec(t);
  assert.ok(m, 'the token is in KennelPort\'s shape');
  assert.equal(await hmacHex(KEY, m[1]), m[2], 'signed with the site\'s key');
  const body = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
  assert.ok(body.x > Date.now() && body.x <= Date.now() + 10 * 60000 + 60000);
  assert.match(body.n, /^[0-9a-f]{32}$/);
  return body;
}

test('/f/portal: a one-tap link into her portal for a signed-in family, in KennelPort\'s format', async () => {
  const { env, ann } = await setup();
  const res = await portal(env, ann, tok('a'));
  assert.equal(res.status, 200);
  const { url } = await res.json();
  assert.ok(url.startsWith('https://ak.kennelport.com/family/handoff?t='));
  const body = await kennelportReads(url);
  assert.equal(body.f, 'contact-ann', 'the family as the portal knows them: their KennelOS contact');
  const again = await (await portal(env, ann, tok('a'))).json();
  assert.notEqual(again.url, url, 'each tap is a new link');
});

test('/f/portal: only signed in, only their own page, only with the portal on for them', async () => {
  const { env, ann, bo, publish } = await setup();
  assert.equal((await portal(env, undefined, tok('a'))).status, 401, 'a status link alone doesn\'t open the portal');
  assert.equal((await portal(env, bo, tok('a'))).status, 403);
  const none = await portal(env, bo, tok('b'));
  assert.equal(none.status, 409);
  assert.equal((await none.json()).error, 'no_portal');
  const p = projection();
  delete p.server;
  await publish(p);
  assert.equal((await portal(env, ann, tok('a'))).status, 409, 'portal switched off: no link');
});

test('no Companion link request while her portal is on', async () => {
  const { env, ann, bo } = await setup();
  const off = await call(env, 'POST', '/f/act', { body: { session: ann, status_token: tok('a'), action: 'companion_request' } });
  assert.equal(off.status, 409);
  assert.equal((await off.json()).error, 'no_sale');
  const on = await call(env, 'POST', '/f/act', { body: { session: bo, status_token: tok('b'), action: 'companion_request' } });
  assert.equal(on.status, 200, 'other families as before');
});
