// waitlistProjection.test.js — what one kennel's waitlist looks like online
// (shared/data/waitlistProjection.js, Waitlist W2 Plan §5). The projection is
// what the server holds readable, so these pin its allow-list (Spec §8.1, Q11):
// a family's name, email, place, offers, the unpaid fee and whether it was
// received; never other answers, contact details, programs, notes or payment
// details. And it must agree with the rules engine the app itself uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjection, entryEmail, PROJECTION_FORMAT } from '../shared/data/waitlistProjection.js';
import { litterQueue, publicList, overallPositions, waitlistConfig, entryName } from '../shared/data/waitlistRules.js';

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
  assert.deepEqual(keysOf(p), ['as_of', 'entries', 'format', 'kennel', 'litters', 'public_list']);
  assert.deepEqual(p.kennel, {
    public_id: kennel.public_id, name: 'Thornfield Kennels', time_zone: 'America/Chicago',
    respond_days: 3, max_passes: 2, auto_offer_on: ['no_response']
  });
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
    'litter_positions', 'name', 'offers', 'passes', 'paused_until', 'position', 'prefs', 'ready_from', 'status']);
  assert.equal(e1.name, 'Family e1 Lee');
  assert.equal(e1.email, 'c-e1@example.com', "the contact's address wins over the application's");
  assert.equal(e1.fee_due, null, 'paid: no amount or instructions');
  assert.equal(e1.fee_received_date, '2026-02-11', 'fee received is readable (Q11)');
  assert.deepEqual(e1.offers, [{ id: 'o1', litter_id: 'lit-1', offered_date: '2026-10-07', respond_by_date: '2026-10-10', eligible_dog_ids: ['p1', 'p2'], picked_dog_id: null }]);
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
  for (const [id, pos] of positions) assert.equal(p.entries[id].position, pos, id);
  assert.equal(p.entries.e2.position, 1, 'her ahead program puts them first');

  const queue = litterQueue(live, litter, f.dogs.filter((d) => d.litter_id === 'lit-1'), [], { today: TODAY, config: waitlistConfig(kennel), programsById: f.programsById });
  assert.deepEqual(p.litters['lit-1'].queue.map((q) => q.entry_id), queue.map((q) => q.entry.id));
  for (const q of queue) assert.equal(p.entries[q.entry.id].litter_positions['lit-1'], q.litterPosition);
  assert.equal(p.entries.e3.litter_positions['lit-1'], undefined, 'paused: not in any queue');

  const rows = publicList(live, K, f.programsById, { today: TODAY, nameOf: (e) => entryName(e, f.contacts.find((c) => c.id === e.contact_id)) });
  assert.deepEqual(p.public_list, rows);
  assert.ok(!p.public_list.some((r) => r.name.startsWith('Family e3')), 'a paused family is off the public list');
});

test('a litter shows its available pups as a family may see them, and every eligible family however many', () => {
  const f = fixture();
  for (let i = 0; i < 60; i++) {
    f.entries.push(entry(`m${i}`, { fee_received_date: `2026-03-${String(1 + (i % 28)).padStart(2, '0')}` }));
  }
  const p = buildProjection(f);
  const l = p.litters['lit-1'];
  assert.deepEqual(keysOf(l), ['label', 'open_offer_entry_id', 'picks_open', 'pups', 'queue', 'ready_date', 'status', 'whelp_date']);
  assert.equal(l.label, 'Juniper × Ash');
  assert.equal(l.picks_open, true);
  assert.equal(l.open_offer_entry_id, 'e1');
  assert.deepEqual(l.pups, [{ id: 'p1', call_name: 'p1', sex: 'male', color: 'black' }, { id: 'p2', call_name: 'p2', sex: 'female', color: 'black' }],
    'a pup she is keeping is not shown');
  assert.equal(l.queue.length, 62, 'every eligible family (60 + e1 + e2; e3 is paused), not just the next few (Q13)');
  assert.deepEqual(l.queue.find((q) => q.entry_id === 'e2').dog_ids, ['p2'], 'only the pups that match them');
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
