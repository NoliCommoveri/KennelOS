// portalFeed.test.js — her puppy portal's family feed (KennelPort's
// docs/Puppy_Parent_Portal_Plan.md 3.2, 3.4; End-State guide §35.1): each family
// from their signed contract on, in KennelPort's format 1, field by field; what
// has gone goes as `removed`; sent on its own only to a site whose portal is on;
// the facts that come back applied once; the status page's portal link in the
// projection; and Companion off there.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import {
  buildPortalFeed, parseClock, zonedIso, zonedParts, clockText, portalEntryView, herVet, feedCopy,
  FEED_KEYS, FAMILY_KEYS, PLACEMENT_KEYS, HEALTH_KEYS, PORTAL_KEEP_DAYS
} from '../shared/data/portalFeed.js';
import { buildProjection } from '../shared/data/waitlistProjection.js';
import { addDaysToYMD } from '../shared/data/dateUtils.js';

const TODAY = '2026-12-01';
const K = { id: 'k1', kennel_name: 'AK Bostons', is_own_kennel: true, time_zone: 'America/Chicago', public_id: 'kos1_11111111-2222-4333-8444-555555555555' };
const pup = (id, more = {}) => ({ id, call_name: id[0].toUpperCase() + id.slice(1), sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'puppy', kennel_id: 'k1', litter_id: 'l1', microchip_id: '985000111', registration_number: 'NR123', ...more });
const sale = (id, dog, buyer, more = {}) => ({ id, dog_id: dog, buyer_contact_id: buyer, kennel_id: 'k1', status: 'deposit_paid', registration_type: 'limited', price: 3500, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-11-20T00:00:00Z', ...more });
const signed = (id, saleId, on = '2026-11-15', more = {}) => ({ id, contract_type: 'sale', kennel_id: 'k1', related_sale_id: saleId, status: 'signed', signed_date: on, terms_summary: 'private terms', ...more });
const base = () => ({
  kennel: K,
  dogs: [pup('opal'), pup('pip', { microchip_id: '' })],
  litters: [{ id: 'l1', kennel_id: 'k1', whelp_date: '2026-10-10', estimated_ready_date: '2026-12-05', status: 'weaning' }],
  contacts: [
    { id: 'reed', name: 'The Reed family', email: 'Reed@Example.com', phone: '555-0100', address: '1 Elm St' },
    { id: 'lane', name: 'Lane Ortiz', email: 'lane@example.com' },
    { id: 'vet1', name: 'Elm Street Animal Clinic', contact_type: ['vet'], phone: '555-0199', address: '9 Elm St' }
  ],
  sales: [sale('s1', 'opal', 'reed', { extra_charges: [{ id: 'x1', label: 'Training', amount: 900, list_id: 'train12' }, { id: 'x2', label: 'Crate', amount: 80 }] }), sale('s2', 'pip', 'lane')],
  contracts: [signed('c1', 's1'), { ...signed('c2', 's2'), status: 'sent', signed_date: '' }],
  events: [
    { id: 'e1', subject_type: 'dog', subject_id: 'opal', event_type: 'placement', event_date: '2026-12-23', title: 'Puppy pickup', related_contact_id: 'reed', details: { placement_time: '10:00 AM–10:30 AM', location: 'Our place' } },
    { id: 'v1', subject_type: 'dog', subject_id: 'opal', event_type: 'vaccination', event_date: '2026-11-21', title: 'DHPP', details: { vaccine: 'DHPP #1', lot_number: 'A12', next_due: '2026-12-12' } },
    { id: 'w1', subject_type: 'dog', subject_id: 'opal', event_type: 'preventative', event_date: '2026-11-07', title: 'Dewormer', details: { product: 'Pyrantel' } },
    { id: 'vv', subject_type: 'dog', subject_id: 'opal', event_type: 'vet_visit', event_date: '2026-11-28', title: 'Puppy check', related_contact_id: 'vet1', details: { reason: 'Check', findings: 'private findings' } },
    { id: 'later', subject_type: 'dog', subject_id: 'opal', event_type: 'vaccination', event_date: '2026-12-12', title: 'DHPP #2', details: {} }
  ],
  entries: [{ id: 'en1', kennel_id: 'k1', contact_id: 'reed', status: 'placed', status_token: 'f'.repeat(64), placed_sale_id: 's1', application: { email: 'reeds@example.com' } }],
  today: TODAY, feedId: 'feed-1', statusUrlOf: (t) => `https://apply.kennelos.app/s/${t}`
});

test('a family from their signed contract on, field by field, with nothing private', () => {
  const { feed, known } = buildPortalFeed(base());
  assert.deepEqual(Object.keys(feed).sort(), ['families', 'feed_id', 'format', 'kennel_id', 'removed', 'vet'].sort());
  assert.ok(Object.keys(feed).every((k) => FEED_KEYS.includes(k)));
  assert.equal(feed.families.length, 1, 'Lane\'s contract is only sent, not signed: not yet');
  const f = feed.families[0];
  assert.deepEqual(Object.keys(f), FAMILY_KEYS);
  assert.deepEqual(f.emails, ['reed@example.com', 'reeds@example.com']);
  assert.equal(f.status_url, `https://apply.kennelos.app/s/${'f'.repeat(64)}`);
  const p = f.placements[0];
  assert.deepEqual(Object.keys(p), PLACEMENT_KEYS);
  assert.deepEqual({ id: p.id, puppy_id: p.puppy_id, puppy_name: p.puppy_name, signed: p.contract_signed_on, go: p.go_home_on, at: p.pickup_at, chip: p.microchip, reg: p.registration_no, voided: p.voided },
    { id: 's1', puppy_id: 'opal', puppy_name: 'Opal', signed: '2026-11-15', go: '2026-12-23', at: '2026-12-23T16:00:00.000Z', chip: '985000111', reg: 'NR123', voided: null });
  assert.deepEqual(p.health.map((h) => [h.id, h.type, h.given_on, h.name, h.notes]), [
    ['vv', 'vet_visit', '2026-11-28', 'Puppy check', null],
    ['v1', 'vaccine', '2026-11-21', 'DHPP #1', 'Lot A12, next due 2026-12-12'],
    ['w1', 'deworming', '2026-11-07', 'Pyrantel', null]
  ], 'nothing dated after today; a vet visit\'s findings never go');
  assert.ok(p.health.every((h) => Object.keys(h).every((k) => HEALTH_KEYS.includes(k))));
  assert.deepEqual(p.extras, [{ id: 'x1', extra_id: 'train12' }], 'only extras on her price list, never an amount');
  assert.deepEqual(feed.vet, { clinic: 'Elm Street Animal Clinic', doctor: null, phone: '555-0199', address: '9 Elm St' });
  const text = JSON.stringify(feed);
  for (const secret of ['3500', '900', '555-0100', '1 Elm St', 'private terms', 'private findings']) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(known.map((k) => `${k.type}:${k.id}`).sort(), ['family:reed', 'health:v1', 'health:vv', 'health:w1', 'placement:s1']);
});

test('no pickup booked: go-home is the ready date and there is no time', () => {
  const b = base();
  b.events = b.events.filter((e) => e.id !== 'e1');
  const p = buildPortalFeed(b).feed.families[0].placements[0];
  assert.equal(p.go_home_on, '2026-12-05');
  assert.equal(p.pickup_at, null);
});

test('a voided sale says why; what has gone since goes as removed; a released sale stays after its contract is voided', () => {
  const b = base();
  const first = buildPortalFeed(b);
  b.sales[0] = { ...b.sales[0], status: 'voided', end_reason: 'pup_died', updated_at: '2026-11-30T12:00:00Z' };
  b.contracts[0] = { ...b.contracts[0], status: 'void' };
  b.events = b.events.filter((e) => e.id !== 'w1');
  const next = buildPortalFeed({ ...b, known: first.known });
  const p = next.feed.families[0].placements[0];
  assert.deepEqual(p.voided, { reason: 'died', on: '2026-11-30' });
  assert.equal(p.contract_signed_on, '2026-11-15', 'the date it went with');
  assert.deepEqual(next.feed.removed, [{ type: 'health', id: 'w1' }]);

  b.sales = b.sales.filter((s) => s.id !== 's1');
  const gone = buildPortalFeed({ ...b, known: next.known });
  assert.deepEqual(gone.feed.families, []);
  assert.deepEqual(gone.feed.removed.map((r) => `${r.type}:${r.id}`).sort(), ['family:reed', 'health:v1', 'health:vv', 'placement:s1']);
  assert.deepEqual(buildPortalFeed({ ...b, known: gone.known }).feed.removed, [], 'said once');
});

test('a contract that is only signed by mistake, then set back: removed', () => {
  const b = base();
  const first = buildPortalFeed(b);
  b.contracts[0] = { ...b.contracts[0], status: 'sent' };
  assert.ok(buildPortalFeed({ ...b, known: first.known }).feed.removed.some((r) => r.type === 'placement' && r.id === 's1'));
});

test(`a delivered placement keeps going for ${PORTAL_KEEP_DAYS} days, then rests (not removed)`, () => {
  const b = base();
  b.sales[0] = { ...b.sales[0], status: 'delivered', updated_at: '2026-12-23T18:00:00Z' };
  const first = buildPortalFeed({ ...b, today: '2027-01-10' });
  assert.equal(first.feed.families.length, 1);
  const later = buildPortalFeed({ ...b, today: addDaysToYMD('2026-12-23', PORTAL_KEEP_DAYS + 1), known: first.known });
  assert.deepEqual(later.feed.families, []);
  assert.deepEqual(later.feed.removed, []);
});

test('her vet: the Vet contact she names most on her dogs\' visits, else her only one', () => {
  const b = base();
  const dogsById = new Map(b.dogs.map((d) => [d.id, d]));
  assert.equal(herVet({ kennel: K, contacts: b.contacts, events: [], dogsById }).clinic, 'Elm Street Animal Clinic');
  const two = [...b.contacts, { id: 'vet2', name: 'Oak Vets', contact_type: ['vet'] }];
  assert.equal(herVet({ kennel: K, contacts: two, events: [], dogsById }), null, 'two and no visits: no telling');
  assert.equal(herVet({ kennel: K, contacts: two, events: b.events, dogsById }).clinic, 'Elm Street Animal Clinic');
});

test('times: her free-text pickup time in her time zone, and back', () => {
  assert.equal(parseClock('10:00 AM–10:30 AM'), '10:00');
  assert.equal(parseClock('2pm'), '14:00');
  assert.equal(parseClock('12:15 am'), '00:15');
  assert.equal(parseClock('around noon'), null);
  assert.equal(zonedIso('2026-12-23', '10:00', 'America/Chicago'), '2026-12-23T16:00:00.000Z');
  assert.equal(zonedIso('2026-07-01', '10:00', 'America/Chicago'), '2026-07-01T15:00:00.000Z', 'daylight time');
  assert.deepEqual(zonedParts('2026-12-24T01:30:00.000Z', 'America/Chicago'), { date: '2026-12-23', time: '19:30' });
  assert.equal(clockText('19:30'), '7:30 PM');
});

test('the status page: the portal link from the signed contract on; only that once handed over; Companion off', () => {
  const b = base();
  const withPortal = { ...K, kennelport_portal: { url: 'https://ak.kennelport.com/family', handoff_url: 'https://ak.kennelport.com/family/handoff', handoff_key: 'ab'.repeat(32), handoff_minutes: 10, home: [], facts: {} } };
  const project = (kennel, more = {}) => buildProjection({ kennel, entries: b.entries, sales: b.sales, contacts: b.contacts, dogs: b.dogs, litters: b.litters, contracts: b.contracts, pickupEvents: b.events, today: TODAY, ...more });
  const off = project(K);
  assert.equal(off.entries.en1.portal, undefined);
  assert.equal(off.server?.portal, undefined);
  assert.notEqual(off.entries.en1.companion.link, false);

  const on = project(withPortal);
  assert.deepEqual(on.entries.en1.portal, { family_id: 'reed', only: false, pickup_on: '2026-12-23' });
  assert.deepEqual(on.entries.en1.companion, { available: true, link: false, request: null });
  assert.deepEqual(on.server.portal, { url: 'https://ak.kennelport.com/family', handoff_url: 'https://ak.kennelport.com/family/handoff', handoff_key: 'ab'.repeat(32), minutes: 10 });

  const home = project({ ...withPortal, kennelport_portal: { ...withPortal.kennelport_portal, home: ['reed'] } });
  assert.equal(home.entries.en1.portal.only, true);
  assert.equal(portalEntryView(b.entries[0], { sale: { ...b.sales[0], status: 'delivered' }, contracts: b.contracts, events: b.events, today: TODAY }).only, true);
  assert.equal(portalEntryView(b.entries[0], { sale: b.sales[0], contracts: b.contracts, events: b.events, today: '2026-12-24' }).only, true, 'pickup day passed');
  assert.equal(portalEntryView(b.entries[0], { sale: { ...b.sales[0], status: 'voided' }, contracts: b.contracts, events: b.events, today: TODAY }), null,
    'a lost puppy: the status page takes them back in full');
  assert.equal(portalEntryView(b.entries[0], { sale: b.sales[0], contracts: [], events: b.events, today: TODAY }), null, 'no signed contract yet');
});

// --- sending, and the facts that come back --------------------------------------------

let db; let sync; let kennelRepo; let store; let calls; let reply;
const realFetch = globalThis.fetch;
const realLocation = globalThis.location;
const TOKEN = `kpl_${'a'.repeat(64)}`;
const SITE = { name: 'AK', website: 'https://ak.kennelport.com/', portal_feed: 1 };
const PORTAL = { url: 'https://ak.kennelport.com/family', handoff_url: 'https://ak.kennelport.com/family/handoff', handoff_key: 'cd'.repeat(32), handoff_minutes: 10 };

before(async () => {
  await installMemoryDb();
  globalThis.location = { hostname: 'localhost' }; // the staging KennelPort (devKennelportUrl)
  ({ db } = await import('../shared/data/db.js'));
  sync = await import('../shared/data/portalFeedSync.js');
  store = await import('../shared/data/kennelportLinkStore.js');
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
});

beforeEach(async () => {
  for (const t of ['kennels', 'dogs', 'contacts', 'sales', 'contracts', 'events', 'litters', 'waitlist_entries', 'device_secrets']) await db[t].clear();
  const b = base();
  await db.kennels.put(K);
  for (const d of b.dogs) await db.dogs.put(d);
  for (const c of b.contacts) await db.contacts.put(c);
  for (const s of b.sales) await db.sales.put(s);
  for (const c of b.contracts) await db.contracts.put(c);
  for (const e of b.events) await db.events.put(e);
  for (const l of b.litters) await db.litters.put(l);
  await store.setWebsiteLink('k1', { token: TOKEN, site: SITE });
  calls = [];
  reply = () => ({ status: 200, body: { received: 'x', summary: { families_new: 1 }, facts: [], portal: PORTAL } });
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers?.authorization });
    const r = reply(opts.method, u.pathname);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
});
afterEach(() => { globalThis.fetch = realFetch; });
test.after(() => { globalThis.location = realLocation; });

test('sent on its own to a site whose portal is on; not again until something changes; the portal kept on the kennel', async () => {
  const out = await sync.sendPortalFeed(K, { today: TODAY, feedId: 'f-1' });
  assert.equal(out.status, 'sent');
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.auth]), [['POST', '/v1/portal', `Bearer ${TOKEN}`]]);
  assert.equal(calls[0].body.families[0].id, 'reed');
  const kennel = await kennelRepo.getById('k1');
  assert.deepEqual(kennel.kennelport_portal, { ...PORTAL, home: [], facts: {} });
  assert.deepEqual((await sync.sendPortalFeed(kennel, { today: TODAY })).reason, 'unchanged');
  assert.equal(calls.length, 1);
  await db.dogs.put({ ...(await db.dogs.get('opal')), microchip_id: '985000222' });
  assert.equal((await sync.sendPortalFeed(kennel, { today: TODAY })).status, 'sent');
  assert.equal(calls[1].body.families[0].placements[0].microchip, '985000222');
  assert.deepEqual(feedCopy(calls[1].body).removed, []);
});

test('a site without the portal: nothing sent; the kennel\'s portal goes only on the site\'s own word', async () => {
  await store.noteWebsiteAnswer('k1', { site: { ...SITE, portal_feed: null } });
  await db.kennels.put({ ...K, kennelport_portal: { ...PORTAL, home: [], facts: {} } });
  assert.equal((await sync.sendPortalFeed(K, { today: TODAY })).reason, 'portal_off');
  assert.equal(calls.length, 0);
  assert.ok((await kennelRepo.getById('k1')).kennelport_portal, 'old facts on this device don\'t take it off');
  reply = () => ({ status: 200, body: { linked: true, site: { ...SITE, portal_feed: null } } });
  assert.equal((await sync.sendPortalFeed(K, { today: TODAY, refresh: true })).reason, 'portal_off');
  assert.deepEqual(calls.map((c) => [c.method, c.path]), [['GET', '/v1/link']]);
  assert.equal((await kennelRepo.getById('k1')).kennelport_portal, null);
});

test('switched off in KennelPort since: portal_off refused, nothing more sent', async () => {
  reply = () => ({ status: 409, body: { error: 'portal_off', message: 'The puppy portal isn\'t switched on for this website.' } });
  assert.equal((await sync.sendPortalFeed(K, { today: TODAY })).reason, 'portal_off');
  assert.equal((await store.getWebsiteLink('k1')).site.portal_feed, null);
  assert.equal((await sync.sendPortalFeed(K, { today: TODAY })).reason, 'portal_off');
  assert.equal(calls.length, 1);
});

test('the facts come back once: picked up (its time on the pickup, the sale Delivered), the microchip, a death; handed over', async () => {
  reply = () => ({ status: 200, body: { received: 'x', summary: {}, portal: PORTAL, facts: [
    { id: 's1', family_id: 'reed', picked_up_at: '2026-12-23T21:15:00.000Z', portal_only: true, microchip: '985000999' }
  ] } });
  // The day after pickup: a fact is checked against today (K7-2).
  const out = await sync.sendPortalFeed(K, { today: '2026-12-24' });
  assert.equal(out.status, 'sent', String(out.message));
  assert.deepEqual(out.applied.map((a) => a.what), ['picked_up', 'microchip']);
  const ev = await db.events.get('e1');
  assert.deepEqual([ev.event_date, ev.details.placement_time, ev.details.location], ['2026-12-23', '3:15 PM', 'Our place']);
  assert.equal((await db.sales.get('s1')).status, 'delivered');
  assert.equal((await db.dogs.get('opal')).microchip_id, '985000999');
  const k = await kennelRepo.getById('k1');
  assert.deepEqual(k.kennelport_portal.home, ['reed']);
  assert.deepEqual(k.kennelport_portal.facts.s1, { picked_up_at: '2026-12-23T21:15:00.000Z', microchip: '985000999' });

  // She changes the microchip in KennelOS afterwards: the portal's older value
  // doesn't undo it.
  await db.dogs.put({ ...(await db.dogs.get('opal')), microchip_id: '985000123' });
  reply = () => ({ status: 200, body: { received: 'x', summary: {}, portal: PORTAL, facts: [
    { id: 's1', family_id: 'reed', picked_up_at: '2026-12-23T21:15:00.000Z', portal_only: true, microchip: '985000999', died_on: '2027-03-02' }
  ] } });
  const again = await sync.sendPortalFeed(await kennelRepo.getById('k1'), { today: '2027-03-05', force: true });
  assert.deepEqual(again.applied.map((a) => a.what), ['died']);
  const opal = await db.dogs.get('opal');
  assert.deepEqual([opal.microchip_id, opal.status, opal.date_of_death], ['985000123', 'deceased', '2027-03-02']);
});

test('picked up with no pickup event: one is made, with the family on it', async () => {
  await db.events.delete('e1');
  reply = () => ({ status: 200, body: { received: 'x', summary: {}, portal: PORTAL, facts: [{ id: 's1', family_id: 'reed', picked_up_at: '2026-12-20T17:00:00.000Z', portal_only: true }] } });
  await sync.sendPortalFeed(K, { today: '2026-12-21' });
  const made = (await db.events.toArray()).find((e) => e.event_type === 'placement');
  assert.deepEqual([made.subject_id, made.event_date, made.related_contact_id, made.details.placement_time], ['opal', '2026-12-20', 'reed', '11:00 AM']);
});

test('a stopped link: forgotten here, and the portal off the kennel', async () => {
  await db.kennels.put({ ...K, kennelport_portal: { ...PORTAL, home: [], facts: {} } });
  reply = () => ({ status: 401, body: { error: 'not_linked' } });
  assert.equal((await sync.sendPortalFeed(K, { today: TODAY })).status, 'error');
  assert.equal(await store.getWebsiteLink('k1'), null);
  assert.equal((await kennelRepo.getById('k1')).kennelport_portal, null);
});

// --- Waitlist fixes plan step 4 (K7-1, K7-2, K7-3, K7-14) ---------------------------

test('K7-1: a returned sale goes voided, keeps no vet visit from the next home, and leaves once it ages out', () => {
  const b = base();
  // Opal came back on Dec 10 and was sold to the Lanes on Dec 12; a vet visit on Dec 14.
  const returned = { ...b.sales[0], status: 'returned', end_reason: 'other', updated_at: '2026-12-10T12:00:00Z' };
  const resale = sale('s3', 'opal', 'lane', { created_at: '2026-12-12T00:00:00Z', updated_at: '2026-12-12T00:00:00Z' });
  const visit = { id: 'v-new', subject_type: 'dog', subject_id: 'opal', event_type: 'vet_visit', event_date: '2026-12-14', title: 'Ear infection', details: {} };
  const input = { ...b, sales: [returned, resale], contracts: [b.contracts[0], signed('c3', 's3', '2026-12-12')], events: [...b.events, visit], today: '2026-12-15',
    known: [{ type: 'placement', id: 's1', signed_on: '2026-11-15' }, { type: 'family', id: 'reed' }] };
  const { feed } = buildPortalFeed(input);
  const reed = feed.families.find((f) => f.id === 'reed');
  const lane = feed.families.find((f) => f.id === 'lane');
  assert.deepEqual(reed.placements[0].voided, { reason: 'other', on: '2026-12-10' });
  assert.ok(!reed.placements[0].health.some((h) => h.id === 'v-new'), 'the next home\'s visit isn\'t theirs');
  assert.ok(lane.placements[0].health.some((h) => h.id === 'v-new'));
  // Long after: the returned placement is removed from the portal, not left as it was.
  const later = buildPortalFeed({ ...input, today: addDaysToYMD('2026-12-23', PORTAL_KEEP_DAYS + 5) });
  assert.ok(later.feed.removed.some((r) => r.type === 'placement' && r.id === 's1'));
  assert.ok(!later.feed.families.some((f) => f.placements.some((p) => p.id === 's1')));
});

test('K7-2: a fact about a sale the feed never carried, a future death, or another family\'s handover is refused; each applied fact leaves a Note', async () => {
  const today = '2026-12-24';
  reply = () => ({ status: 200, body: { received: 'x', summary: {}, portal: PORTAL, facts: [
    { id: 's2', family_id: 'lane', picked_up_at: '2026-12-23T21:15:00.000Z' }, // Lane's contract isn't signed: never sent
    { id: 's1', family_id: 'lane', portal_only: true, died_on: '2027-05-01', picked_up_at: '2026-12-23T21:15:00.000Z' }
  ] } });
  const out = await sync.sendPortalFeed(K, { today });
  assert.deepEqual(out.applied.map((a) => [a.sale_id, a.what]), [['s1', 'picked_up']]);
  assert.equal((await db.sales.get('s2')).status, 'deposit_paid', 'untouched');
  assert.equal((await db.dogs.get('opal')).status, 'puppy', 'a death in the future is refused');
  assert.deepEqual((await kennelRepo.getById('k1')).kennelport_portal.home, [], 'not Lane\'s pup');
  const notes = (await db.events.toArray()).filter((e) => e.event_type === 'note' && e.details?.portal_fact);
  assert.deepEqual(notes.map((n) => [n.subject_id, n.details.portal_fact, n.event_date]), [['opal', 'picked_up', today]]);
  const { portalFactNudges } = await import('../shared/data/nudges.js');
  const dogsById = new Map((await db.dogs.toArray()).map((d) => [d.id, d]));
  const shown = portalFactNudges(notes, dogsById, today);
  assert.equal(shown.length, 1);
  assert.match(shown[0].detail, /picked up on 2026-12-23 at 3:15 PM/);
  assert.equal(portalFactNudges(notes, dogsById, '2027-02-01').length, 0, 'shown for two weeks');
});

test('K7-2: a fact on a sale that has since ended is refused', async () => {
  await db.sales.put({ ...(await db.sales.get('s1')), status: 'voided', end_reason: 'pup_died' });
  await store.notePortalSent('k1', { sent: {}, known: [{ type: 'placement', id: 's1', signed_on: '2026-11-15' }] });
  reply = () => ({ status: 200, body: { received: 'x', summary: {}, portal: PORTAL, facts: [{ id: 's1', microchip: '985000777', picked_up_at: '2026-12-01T17:00:00.000Z' }] } });
  const out = await sync.sendPortalFeed(K, { today: TODAY, force: true });
  assert.deepEqual(out.applied, []);
  assert.equal((await db.dogs.get('opal')).microchip_id, '985000111');
});

test('K7-3: disconnecting turns the portal off on the kennel, keeping what it learned; a connected device turns it back on', async () => {
  const link = await import('../shared/data/kennelportLink.js');
  await db.kennels.put({ ...K, kennelport_portal: { ...PORTAL, home: ['reed'], facts: { s1: { microchip: 'x' } } } });
  reply = () => ({ status: 200, body: { linked: false } });
  const out = await link.disconnectWebsite('k1');
  assert.deepEqual(out, { reached: true, portal_off: true });
  const k = await kennelRepo.getById('k1');
  assert.equal(k.kennelport_portal.handoff_url, null);
  assert.deepEqual(k.kennelport_portal.home, ['reed']);
  const { portalOn } = await import('../shared/data/portalFeed.js');
  assert.equal(portalOn(k), false, 'their status pages stop offering it');
  // Another device, still linked, sends: the portal is back, as it was.
  await store.setWebsiteLink('k1', { token: TOKEN, site: SITE });
  reply = () => ({ status: 200, body: { received: 'x', summary: {}, facts: [], portal: PORTAL } });
  await sync.sendPortalFeed(k, { today: TODAY });
  const back = (await kennelRepo.getById('k1')).kennelport_portal;
  assert.equal(portalOn({ kennelport_portal: back }), true);
  assert.deepEqual(back.home, ['reed']);
});

test('K7-14: a device that isn\'t doing the server work sends nothing', async () => {
  const out = await sync.sendPortalFeed(K, { today: TODAY, mayFeed: async () => false });
  assert.deepEqual(out, { status: 'skipped', reason: 'other_device' });
  assert.equal(calls.length, 0);
  assert.equal(await sync.mayFeedHere(), true, 'no cloud session: this device sends');
});
