// waitlistProjection.test.js — what one kennel's waitlist looks like online
// (shared/data/waitlistProjection.js, Waitlist W2 Plan §5). The projection is
// what the server holds readable, so these pin its allow-list (Spec §8.1, Q11):
// a family's name, email, place, offers, the unpaid fee and whether it was
// received; never other answers, contact details, programs, notes or payment
// details. And it must agree with the rules engine the app itself uses.
import { serverEmailTemplates } from '../shared/data/waitlistEmails.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjection, entryEmail, titlesByDog, PROJECTION_FORMAT } from '../shared/data/waitlistProjection.js';
import { litterQueue, publicList, overallPositions, waitlistConfig, entryName, passReasons, publicIntroText, PUBLIC_INTRO_DEFAULT } from '../shared/data/waitlistRules.js';

const TODAY = '2026-10-08';
const K = 'kennel-1';
const kennel = {
  id: K, public_id: 'kos1_11111111-2222-4333-8444-555555555555', kennel_name: 'Thornfield Kennels',
  time_zone: 'America/Chicago',
  waitlist_config: { fee_amount: 300, payment_instructions: 'Venmo @thornfield', respond_days: 3, max_passes: 2, auto_offer_on: ['no_response'] }
};
const program = { id: 'prog-1', kennel_id: K, name: 'Cancer-treatment family', priority: 'ahead', fee_override: null };

const contact = (id, name, extra = {}) => ({ id, name, email: `${id}@example.com`, phone: '555-0100', address: '1 Secret Lane', notes: 'private contact note', ...extra });

function entry(id, extra = {}) {
  return {
    id, kennel_id: K, status: 'active', contact_id: `c-${id}`, approved_date: '2026-01-01',
    fee_received_date: `2026-02-${String(10 + Number(id.replace(/\D/g, '') || 0)).padStart(2, '0')}`,
    fee_amount: 300, fee_payment_method: 'venmo', fee_payment_reference: 'REF-SECRET', notes: 'private entry note',
    pause_reason: 'chemo', application: { name: 'Ignored Name', email: 'app@example.com', phone: '555-0199', about: 'our essay' },
    pref_sex: 'any', ...extra
  };
}

const dam = { id: 'dam', call_name: 'Juniper', sex: 'female', kennel_id: K };
const sire = { id: 'sire', call_name: 'Ash', sex: 'male', kennel_id: K };
const litter = { id: 'lit-1', kennel_id: K, status: 'whelped', dam_id: 'dam', sire_id: 'sire', whelp_date: '2026-09-01', picks_opened_date: '2026-10-01', notes: 'litter note' };
const pup = (id, sex, extra = {}) => ({ id, litter_id: 'lit-1', call_name: id, sex, color_markings: 'black', microchip: 'CHIP-SECRET', kennel_id: K, ...extra });

function fixture() {
  const entries = [
    entry('e1'),
    entry('e2', { pref_sex: 'female', waitlist_program_id: 'prog-1' }),
    entry('e3', { paused_until: '2026-12-01' }),
    entry('e4', { status: 'approved', fee_received_date: null, fee_due_date: '2026-10-20', approved_date: '2026-10-06' }),
    entry('e5', { status: 'applied', contact_id: null, fee_received_date: null, approved_date: null }),
    entry('e6', { status: 'placed', placed_sale_id: 's1' }),
    entry('e7', { status: 'removed', removed_reason: 'second_pass' }),
    entry('e8', { is_archived: true }),
    entry('e9', { kennel_id: 'other-kennel' })
  ];
  const contacts = entries.map((e) => contact(`c-${e.id}`, `Family ${e.id} Lee`));
  const offers = [
    { id: 'o1', entry_id: 'e1', litter_id: 'lit-1', kennel_id: K, outcome: 'open', offered_date: '2026-10-07', respond_by_date: '2026-10-10', eligible_dog_ids: ['p1', 'p2'], chosen_dog_id: null, notes: 'offer note' },
    { id: 'o0', entry_id: 'e2', litter_id: 'lit-1', kennel_id: K, outcome: 'passed', counts_as_pass: true, offered_date: '2026-10-01' }
  ];
  const dogs = [dam, sire, pup('p1', 'male'), pup('p2', 'female'), pup('p3', 'female', { disposition: 'keeping' })];
  return { kennel, entries, offers, programsById: new Map([[program.id, program]]), litters: [litter], dogs, sales: [], contacts, today: TODAY };
}

const keysOf = (o) => Object.keys(o).sort();

test('the projection has exactly its allow-listed parts', () => {
  const p = buildProjection(fixture());
  assert.equal(p.format, PROJECTION_FORMAT);
  assert.deepEqual(keysOf(p), ['as_of', 'entries', 'events_through', 'format', 'kennel', 'litters', 'public_list', 'turn_queue', 'upcoming']);
  assert.deepEqual(p.kennel, {
    public_id: kennel.public_id, name: 'Thornfield Kennels', intro: publicIntroText({}, 'Thornfield Kennels'), time_zone: 'America/Chicago',
    respond_days: 3, max_passes: 2, auto_offer_on: ['no_response'],
    breeds: [], color_matching: false,
    pass_reasons: passReasons({}),
    parents: { sires: [{ id: 'sire', name: 'Ash' }], dams: [{ id: 'dam', name: 'Juniper' }] },
    // What the server sends by itself (W2 step 7): her wording, defaults here.
    email_templates: serverEmailTemplates({}), reminders: true
  });
  assert.deepEqual(Object.keys(p.kennel.email_templates).sort(), ['deadline_passed', 'fee_reminder', 'offer', 'offer_reminder', 'ready_check']);
  for (const q of p.turn_queue) assert.equal(q.respond_days, 3, 'the window the server gives them');
  assert.equal(buildProjection({ ...fixture(), kennel: { ...kennel, waitlist_config: { ...kennel.waitlist_config, email_reminders: false } } }).kennel.reminders, false);
  assert.equal(p.events_through, 0);
});

test('nothing private ever reaches the projection', () => {
  const text = JSON.stringify(buildProjection(fixture()));
  for (const secret of ['555-01', 'Secret Lane', 'private contact note', 'private entry note', 'REF-SECRET', 'venmo"',
    'chemo', 'our essay', 'Cancer-treatment', 'CHIP-SECRET', 'offer note', 'litter note']) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test("a family on the list sees its place, prefs, passes and offers; nothing else", () => {
  const p = buildProjection(fixture());
  const e1 = p.entries.e1;
  assert.deepEqual(keysOf(e1), ['applied_date', 'approved_date', 'email', 'fee_due', 'fee_received_date', 'listen',
    'matching_litter_ids', 'name', 'offers', 'passes', 'paused_until', 'place_hidden', 'position', 'prefs', 'prepasses', 'ready_check', 'ready_from', 'requests', 'status', 'upcoming', 'whelp_notes']);
  assert.deepEqual(e1.prepasses, []);
  assert.deepEqual(e1.requests, { pause: null, pref_change: null, listen: null });
  assert.equal(e1.name, 'Family e1 Lee');
  assert.equal(e1.email, 'c-e1@example.com', "the contact's address wins over the application's");
  assert.equal(e1.fee_due, null, 'paid: no amount or instructions');
  assert.equal(e1.fee_received_date, '2026-02-11', 'fee received is readable (Q11)');
  assert.deepEqual(e1.offers, [{ id: 'o1', turn_id: 'o1', litter_id: 'lit-1', offered_date: '2026-10-07', respond_by_date: '2026-10-10', eligible_dog_ids: ['p1', 'p2'], picked_dog_id: null }]);
  assert.deepEqual(p.entries.e2.passes, { used: 1, max: 2 });
  assert.equal(p.entries.e3.paused_until, '2026-12-01');
});

test('the fee and her payment instructions show only while approved and unpaid', () => {
  const f = fixture();
  let p = buildProjection(f);
  assert.deepEqual(p.entries.e4.fee_due, { amount: 300, due_date: '2026-10-20', instructions: 'Venmo @thornfield', credit_policy: 'credited_to_purchase' });
  assert.equal(p.entries.e5.fee_due, null, 'not approved yet');
  f.programsById.set('prog-1', { ...program, fee_override: 0 });
  f.entries[3].waitlist_program_id = 'prog-1';
  p = buildProjection(f);
  assert.equal(p.entries.e4.fee_due, null, 'a waived fee is never asked for');
});

test("a family whose time on the list ended keeps only its outcome; archived and other kennels' families are left out", () => {
  const p = buildProjection(fixture());
  assert.deepEqual(p.entries.e6, { name: 'Family e6 Lee', email: 'c-e6@example.com', status: 'placed' });
  assert.deepEqual(p.entries.e7, { name: 'Family e7 Lee', email: 'c-e7@example.com', status: 'removed' });
  assert.equal(p.entries.e8, undefined);
  assert.equal(p.entries.e9, undefined);
  assert.equal(p.entries.e5.name, 'Ignored Name', 'an applicant with no contact yet goes by the name they applied with');
  assert.equal(p.entries.e5.email, 'app@example.com');
});

test('positions, litter queues and the public list come straight from the rules engine', () => {
  const f = fixture();
  const p = buildProjection(f);
  const live = f.entries.filter((e) => !e.is_archived && e.kennel_id === K);
  const positions = overallPositions(live, K, f.programsById);
  // e1 holds a turn and e2 passed on a litter still being offered: no number for either.
  for (const [id, pos] of positions) assert.equal(p.entries[id].position, ['e1', 'e2'].includes(id) ? null : pos, id);
  assert.equal(positions.get('e2'), 1, 'her ahead program puts them first');
  assert.deepEqual(p.entries.e1.place_hidden, { reason: 'turn' });
  assert.deepEqual(p.entries.e2.place_hidden, { reason: 'passed', litters: [{ litter_id: 'lit-1', label: 'Juniper × Ash', outcome: 'passed' }] });
  assert.equal(p.entries.e4.place_hidden, null);

  const queue = litterQueue(live, litter, f.dogs.filter((d) => d.litter_id === 'lit-1'), [], { today: TODAY, config: waitlistConfig(kennel), programsById: f.programsById });
  for (const q of queue) assert.deepEqual(p.entries[q.entry.id].matching_litter_ids, ['lit-1'], 'a match, never a place in its line');
  assert.equal(JSON.stringify(p).includes('litter_positions'), false);
  // The turn queue: the same order, minus families whose turn on it is open (e1) or spent (e2 passed).
  assert.deepEqual(p.turn_queue.map((q) => q.entry_id), queue.map((q) => q.entry.id).filter((id) => !['e1', 'e2'].includes(id)));
  assert.deepEqual(p.entries.e3.matching_litter_ids, [], 'paused: not in any queue');

  const rows = publicList(live, K, f.programsById, { today: TODAY, nameOf: (e) => entryName(e, f.contacts.find((c) => c.id === e.contact_id)), hidden: (e) => ['e1', 'e2'].includes(e.id) });
  assert.deepEqual(p.public_list, rows);
  assert.ok(!p.public_list.some((r) => r.position === 1 || r.name.startsWith('Family e1')), 'between turns: off the public list, number skipped');
  assert.ok(!p.public_list.some((r) => r.name.startsWith('Family e3')), 'a paused family is off the public list');
});

test('a litter shows its available pups as a family may see them, and every eligible family however many', () => {
  const f = fixture();
  for (let i = 0; i < 60; i++) {
    f.entries.push(entry(`m${i}`, { fee_received_date: `2026-03-${String(1 + (i % 28)).padStart(2, '0')}` }));
  }
  const p = buildProjection(f);
  const l = p.litters['lit-1'];
  assert.deepEqual(keysOf(l), ['breed', 'dam', 'label', 'nickname', 'open_offer_entry_id', 'pairing_id', 'picks_open', 'pups', 'ready_date', 'sire', 'status', 'whelp_date']);
  assert.equal(l.label, 'Juniper × Ash');
  assert.deepEqual(l.sire, { name: 'Ash', titles: [] });
  assert.deepEqual(l.dam, { name: 'Juniper', titles: [] });
  assert.equal(l.picks_open, true);
  assert.equal(l.open_offer_entry_id, 'e1');
  assert.deepEqual(l.pups, [{ id: 'p1', call_name: 'p1', sex: 'male', color: 'black' }, { id: 'p2', call_name: 'p2', sex: 'female', color: 'black' }],
    'a pup she is keeping is not shown');
  assert.equal(p.turn_queue.length, 60, 'every eligible family still to have a turn (e1 holds it, e2 passed, e3 is paused), not just the next few (Q13)');
  f.entries.find((e) => e.id === 'm0').pref_sex = 'female';
  assert.deepEqual(buildProjection(f).turn_queue.find((q) => q.entry_id === 'm0').litters, { 'lit-1': ['p2'] }, 'only the pups that match them, per litter');
});

test('the same records always make the same projection, in any order', () => {
  const a = fixture();
  const b = fixture();
  b.entries.reverse();
  b.dogs.reverse();
  b.offers.reverse();
  assert.equal(JSON.stringify(buildProjection(a)), JSON.stringify(buildProjection(b)));
});

test('status-page tokens ride along when an entry has one, and a kennel needs its public identity', () => {
  const f = fixture();
  f.entries[0].status_token = 'a'.repeat(64);
  f.entries[5].status_token = 'b'.repeat(64);
  const p = buildProjection(f);
  assert.equal(p.entries.e1.status_token, 'a'.repeat(64));
  assert.equal(p.entries.e6.status_token, 'b'.repeat(64), 'an old link still shows the outcome');
  assert.equal('status_token' in p.entries.e2, false);
  assert.throws(() => buildProjection({ ...f, kennel: { ...kennel, public_id: '' } }), /public identity/);
  assert.throws(() => buildProjection({ ...f, today: '' }), /today/);
  assert.equal(entryEmail({ application: {} }, null), null);
});

test("a family's requests show what they asked and her decision, never their note, and drop off after a while", () => {
  const f = fixture();
  Object.assign(f.entries[0], {
    pause_request: { requested_date: '2026-10-07', until: '2026-12-31', note: 'SECRET-PAUSE-NOTE' },
    pref_change_request: { requested_date: '2026-10-01', changes: { pref_sex: 'female' }, note: 'SECRET-PREF-NOTE', decided: 'declined', decided_date: '2026-10-02' },
    listen_change_request: { requested_date: '2026-08-01', listen_mode: 'selected', listen_sire_ids: ['sire'], listen_dam_ids: [], decided: 'approved', decided_date: '2026-08-02' }
  });
  const p = buildProjection(f);
  assert.deepEqual(p.entries.e1.requests, {
    pause: { until: '2026-12-31', requested_date: '2026-10-07', decided: null, decided_date: null },
    pref_change: { changes: { pref_sex: 'female' }, requested_date: '2026-10-01', decided: 'declined', decided_date: '2026-10-02' },
    listen: null
  }, 'a decision older than REQUEST_SHOWN_DAYS is gone');
  assert.equal(JSON.stringify(p).includes('SECRET-'), false, 'notes stay on her device');
});

test('the listen-only choices, the message key and how far her device got through the events', () => {
  const f = fixture();
  f.dogs.push({ id: 'retired', call_name: 'Old Boy', sex: 'male', kennel_id: K, is_archived: true, microchip: 'CHIP-SECRET' });
  f.dogs.push({ id: 'stud', call_name: 'Outside Stud', sex: 'male', kennel_id: 'elsewhere' });
  f.entries[0].listen_mode = 'selected';
  f.entries[0].listen_sire_ids = ['retired'];
  const pairings = [{ id: 'pr1', kennel_id: K, status: 'planned', sire_id: 'stud', dam_id: 'dam' }];
  const p = buildProjection({ ...f, pairings, formKey: { id: 'fk_1', public_key: 'PUB', private_key: { d: 'PRIVATE-SECRET' } }, eventsThrough: 42 });
  assert.deepEqual(p.kennel.parents.sires.map((d) => d.name), ['Ash', 'Old Boy', 'Outside Stud'],
    "her breeding sires, an upcoming pairing's outside stud, and one a family already picked");
  assert.deepEqual(p.kennel.message_key, { key_id: 'fk_1', public_key: 'PUB' });
  assert.equal(p.kennel.form, undefined, 'the form only while she takes applications online');
  assert.equal(JSON.stringify(p).includes('PRIVATE-SECRET'), false);
  assert.equal(JSON.stringify(p).includes('CHIP-SECRET'), false);
  assert.equal(p.events_through, 42);
});

test('"Not this litter": which and when, never the reason; the turn queue lists those litters apart', () => {
  const f = fixture();
  f.entries[1].prepasses = [{ litter_id: 'lit-1', date: '2026-10-07', reason: { id: 'finances', label: 'Financial reasons', text: 'SECRET-REASON' } }];
  f.offers = f.offers.filter((o) => o.entry_id !== 'e2');
  const p = buildProjection(f);
  assert.deepEqual(p.entries.e2.prepasses, [{ litter_id: 'lit-1', date: '2026-10-07' }]);
  assert.deepEqual(p.turn_queue.find((q) => q.entry_id === 'e2'), { entry_id: 'e2', respond_days: 3, litters: {}, prepassed: ['lit-1'] });
  assert.equal(JSON.stringify(p).includes('SECRET-REASON'), false);
  assert.deepEqual(p.kennel.pass_reasons.at(-1).id, 'other');
});

// --- Pairings and early litters before picks open (Spec §16.4) ---------------------

function upcomingFixture(show) {
  const f = fixture();
  f.kennel = { ...kennel, waitlist_config: { ...kennel.waitlist_config, show_upcoming: show } };
  const willow = { id: 'willow', call_name: 'Willow', sex: 'female', kennel_id: K };
  f.dogs.push(willow, { id: 'sp1', litter_id: 'spring', call_name: 'Sprout', sex: 'female', kennel_id: K });
  f.litters.push(
    { id: 'spring', kennel_id: K, status: 'whelped', dam_id: 'willow', sire_id: 'sire', pairing_id: 'pr-spring', nickname: 'Spring litter', whelp_date: '2026-09-20', accept_deposits_date: '2026-10-20', notes: 'litter note' },
    { id: 'winter', kennel_id: K, status: 'expected', dam_id: 'dam', sire_id: 'sire', pairing_id: 'pr-winter', nickname: 'Winter litter' }
  );
  f.pairings = [
    { id: 'pr-spring', kennel_id: K, status: 'whelped', dam_id: 'willow', sire_id: 'sire' },
    { id: 'pr-winter', kennel_id: K, status: 'confirmed_pregnant', dam_id: 'dam', sire_id: 'sire', expected_due_date: '2026-12-01', notes: 'pairing note' },
    { id: 'pr-plan', kennel_id: K, status: 'planned', dam_id: 'willow', sire_id: 'sire', planned_date: '2027-02-01', expected_due_date: '2027-04-05' },
    { id: 'pr-gone', kennel_id: K, status: 'cancelled', dam_id: 'dam', sire_id: 'sire' }
  ];
  f.events = [
    { id: 'ev1', subject_type: 'dog', subject_id: 'sire', event_type: 'title_earned', event_date: '2020-09-12', details: { title_abbreviation: 'JH' } },
    { id: 'ev2', subject_type: 'dog', subject_id: 'dam', event_type: 'title_earned', event_date: '2021-10-03', details: { title_abbreviation: 'CGC' } },
    { id: 'ev3', subject_type: 'dog', subject_id: 'dam', event_type: 'title_earned', event_date: '2022-01-01', details: { title_abbreviation: 'CGC' }, is_archived: true },
    { id: 'ev4', subject_type: 'dog', subject_id: 'dam', event_type: 'show', event_date: '2022-01-01', details: { title_abbreviation: 'NOPE' } }
  ];
  f.entries.find((e) => e.id === 'e1').listen_mode = 'except';
  f.entries.find((e) => e.id === 'e1').listen_dam_ids = ['willow'];
  return f;
}

test('upcoming: nothing until she switches a stage on', () => {
  assert.deepEqual(buildProjection(upcomingFixture(null)).upcoming, []);
  assert.deepEqual(buildProjection(upcomingFixture(null)).entries.e1.upcoming, {});
});

test('upcoming: each stage where she shows it, with call names, titles and her dates; nothing private', () => {
  const p = buildProjection(upcomingFixture({
    planned_pairings: { public: true, family: false }, pairings: { public: false, family: true }, early_litters: { public: true, family: true }
  }));
  assert.deepEqual(p.upcoming, [
    { id: 'spring', kind: 'early_litter', label: 'Spring litter', pairing_id: 'pr-spring', litter_id: 'spring',
      sire: { name: 'Ash', titles: ['JH'] }, dam: { name: 'Willow', titles: [] }, breed: null,
      expected_whelp_date: null, whelp_date: '2026-09-20', picks_expected_date: '2026-10-20', public: true, family: true },
    { id: 'pr-winter', kind: 'pairing', label: 'Winter litter', pairing_id: 'pr-winter', litter_id: 'winter',
      sire: { name: 'Ash', titles: ['JH'] }, dam: { name: 'Juniper', titles: ['CGC'] }, breed: null,
      expected_whelp_date: '2026-12-01', whelp_date: null, picks_expected_date: null, public: false, family: true },
    { id: 'pr-plan', kind: 'planned_pairing', label: 'Willow × Ash', pairing_id: 'pr-plan', litter_id: null,
      sire: { name: 'Ash', titles: ['JH'] }, dam: { name: 'Willow', titles: [] }, breed: null,
      expected_whelp_date: '2027-04-05', whelp_date: null, picks_expected_date: null, public: true, family: false }
  ], 'an expected litter shows once, with its pairing; a litter with open picks and a cancelled pairing not at all');
  const text = JSON.stringify(p.upcoming);
  for (const secret of ['pairing note', 'litter note', 'sire_id', 'dam_id', '"willow"']) assert.equal(text.includes(secret), false, secret);
  // Per family: only the family-page items; waiting (listen-only) and their place for a born litter.
  assert.deepEqual(p.entries.e1.upcoming, { spring: { waiting: false, match: false }, 'pr-winter': { waiting: true } });
  assert.deepEqual(p.entries.e2.upcoming.spring, { waiting: true, match: true }, 'whether they match the born litter, never their place in it');
  assert.deepEqual(p.entries.e4.upcoming, {}, 'not on the list yet');
});

test('titlesByDog: logged title_earned abbreviations, oldest first, once each, never archived', () => {
  const t = titlesByDog(upcomingFixture(null).events);
  assert.deepEqual(t.get('dam'), ['CGC']);
  assert.deepEqual(t.get('sire'), ['JH']);
});

test('whelp notes (Spec §16.6): per family, for a born litter before picks open, whatever her switches say (Q34)', () => {
  const p = buildProjection(upcomingFixture(null));
  // Spring litter (born, picks not open, one female pup): e1 skips Willow's litters; e2 wants a female.
  assert.deepEqual(p.entries.e1.whelp_notes, [{ litter_id: 'spring', pairing_id: 'pr-spring', label: 'Spring litter', kind: 'review', why: ['listen'], breed: null, sire: { name: 'Ash', titles: ['JH'] }, dam: { name: 'Willow', titles: [] } }]);
  assert.deepEqual(p.entries.e2.whelp_notes, [{ litter_id: 'spring', pairing_id: 'pr-spring', label: 'Spring litter', kind: 'match', why: [], breed: null, sire: { name: 'Ash', titles: ['JH'] }, dam: { name: 'Willow', titles: [] } }]);
  assert.deepEqual(p.entries.e3.whelp_notes, [], 'paused');
  assert.deepEqual(p.entries.e4.whelp_notes, [], 'not on the list yet');
  assert.deepEqual(p.upcoming, [], 'shown though her early-litters switch is off');
});

test('the Companion link block (Spec §8.3): only for a family with an open sale, placed or not; never their note', () => {
  const f = fixture();
  f.sales = [
    { id: 's1', dog_id: 'p9', buyer_contact_id: 'c-e6', status: 'paid_in_full', price: 2500, notes: 'sale note' },
    { id: 's2', dog_id: 'p1', buyer_contact_id: 'c-e1', status: 'deposit_pending' },
    { id: 's3', dog_id: 'p8', buyer_contact_id: 'c-e7', status: 'delivered' },
    { id: 's4', dog_id: 'p7', buyer_contact_id: 'c-e3', status: 'cancelled' }
  ];
  f.entries[5].companion_request = { requested_date: '2026-10-07', note: 'NOTE-SECRET' };
  const p = buildProjection(f);
  assert.deepEqual(p.entries.e6, {
    name: 'Family e6 Lee', email: 'c-e6@example.com', status: 'placed',
    companion: { available: true, request: { requested_date: '2026-10-07', decided: null, decided_date: null } }
  });
  assert.deepEqual(p.entries.e1.companion, { available: true, request: null }, 'a pick held by a deposit-pending sale counts');
  for (const id of ['e2', 'e3', 'e5', 'e7']) assert.equal('companion' in p.entries[id], false, id);
  const text = JSON.stringify(p);
  for (const secret of ['NOTE-SECRET', '2500', 'sale note']) assert.equal(text.includes(secret), false, secret);

  f.entries[5].companion_request = { requested_date: '2026-09-01', note: '', decided: 'sent', decided_date: '2026-09-02' };
  assert.equal(buildProjection(f).entries.e6.companion.request, null, 'an old decision drops off after 30 days');
});

test('the message under her public list heading: her own text, else the default, with the kennel name filled in', () => {
  const def = publicIntroText({}, 'Thornfield Kennels');
  assert.match(def, /^Our waitlist is a rolling list of approved applicants for Thornfield Kennels puppies\. When puppies are ready for selection, applicants/);
  assert.doesNotMatch(def, /\[kennel name\]|,,/i);
  assert.ok(PUBLIC_INTRO_DEFAULT.includes('[Kennel Name]'));
  assert.equal(publicIntroText({ public_intro_text: 'Hi from [kennel name]!' }, 'Briar Hollow'), 'Hi from Briar Hollow!');
});
