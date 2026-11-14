// picksPreview.test.js — the picks preview (Picks Preview Spec) never disagrees
// with what Open picks really does: each case builds a kennel on the in-memory
// database, previews opening a litter, then runs the real waitlistActions.openPicks
// and compares. Plus the reasons, the Either switch, the alone view and a
// settings draft.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let kennelRepo; let dogRepo; let litterRepo; let contactRepo; let saleRepo;
let waitlistEntryRepo; let waitlistOfferRepo; let waitlistProgramRepo; let actions; let preview;
const DAY = '2026-10-08';

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ litterRepo } = await import('../shared/data/litterRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ waitlistEntryRepo } = await import('../shared/data/waitlistEntryRepo.js'));
  ({ waitlistOfferRepo } = await import('../shared/data/waitlistOfferRepo.js'));
  ({ waitlistProgramRepo } = await import('../shared/data/waitlistProgramRepo.js'));
  actions = await import('../shared/data/waitlistActions.js');
  preview = await import('../shared/data/picksPreview.js');
});

let K; let A; let B; let C;
const ids = {};

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, waitlist_config: { max_passes: 2, respond_days: 3 } });
  const dog = (call_name, sex, extra = {}) => dogRepo.create({ call_name, sex, breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: K.id, ...extra });
  const ash = await dog('Ash', 'male');
  const jun = await dog('Juniper', 'female');
  const wil = await dog('Willow', 'female');
  const mk = async (dam, label) => litterRepo.create({ dam_id: dam.id, sire_id: ash.id, status: 'whelped', kennel_id: K.id, whelp_date: '2026-08-01', nickname: label });
  A = await mk(jun, 'Litter A');
  B = await mk(wil, 'Litter B');
  C = await mk(jun, 'Litter C');
  const pup = (name, sex, litter, extra = {}) => dog(name, sex, { status: 'puppy', litter_id: litter.id, disposition: 'available', intended_registration: 'limited', ...extra });
  ids.aMale = (await pup('Pip', 'male', A)).id;
  ids.aFemale = (await pup('Poppy', 'female', A)).id;
  ids.bFemale = (await pup('Pearl', 'female', B)).id;
  ids.cMale = (await pup('Rex', 'male', C)).id;
  ids.cKept = (await pup('Kit', 'female', C, { disposition: 'keeping' })).id;
  const fam = async (name, fee, extra = {}) => {
    const c = await contactRepo.create({ name, email: `${name.toLowerCase()}@example.com` });
    return (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c.id, status: 'active', approved_date: '2026-01-01', fee_received_date: fee, pref_sex: 'any', pref_purposes: ['pet'], ...extra })).id;
  };
  ids.lee = await fam('Lee', '2026-01-01', { pref_sex: 'male' });
  ids.kim = await fam('Kim', '2026-01-02');
  ids.ng = await fam('Ng', '2026-01-03', { pref_sex: 'female' });
});

async function load() {
  const [kennel, entries, offers, litters, dogs, sales, programsById, contacts] = await Promise.all([
    kennelRepo.getById(K.id), waitlistEntryRepo.getByKennel(K.id), waitlistOfferRepo.getByKennel(K.id),
    litterRepo.getAll({ includeArchived: true }), dogRepo.getAll({ includeArchived: true }),
    saleRepo.getAll({ includeArchived: true }), waitlistProgramRepo.getMapForKennel(K.id), contactRepo.getAll({ includeArchived: true })
  ]);
  return { kennel, entries, offers, litters, dogs, sales, programsById, contacts };
}
const run = async (litterId, o = {}) => preview.previewPicks(await load(), { litterId, today: DAY, ...o });

test('no turn open: the preview names the family openPicks offers, the litters and the deadline', async () => {
  const p = await run(A.id);
  assert.equal(p.action.kind, 'offer');
  assert.equal(p.action.entry_id, ids.lee);
  assert.deepEqual(p.action.litters, [{ litter_id: A.id, dog_ids: [ids.aMale] }]);
  const turn = await actions.openPicks(A.id, { date: DAY });
  assert.equal(turn.entry_id, p.action.entry_id);
  assert.deepEqual(turn.litter_ids, p.action.litters.map((x) => x.litter_id));
  assert.equal(turn.respond_by_date, p.action.respond_by);
});

test('a turn is open and someone above the holder wants the new litter: it waits, as openPicks does', async () => {
  await actions.openPicks(A.id, { date: DAY }); // Lee (male only) holds A
  const p = await run(B.id); // B: a female; Kim (Either) ranks below Lee but Lee doesn't match
  // Kim is the top family for B and isn't the holder → B waits.
  assert.equal(p.action.kind, 'wait');
  assert.equal(p.action.holder_id, ids.lee);
  assert.equal(await actions.openPicks(B.id, { date: DAY }), null);
  // In the combined view both litters are shown, and the holder is marked.
  assert.deepEqual(p.shown_litter_ids, [A.id, B.id]);
  assert.equal(p.turnOrder[0].entry_id, ids.lee);
  assert.equal(p.turnOrder[0].holds_turn, true);
  // The holder is first in line for the pups in their turn, and within reach.
  const pip = p.pupsByLitter[0].pups.find((r) => r.dog_id === ids.aMale);
  assert.deepEqual(pip.families[0], { entry_id: ids.lee, prepassed: false, holds_turn: true });
  assert.deepEqual(p.pupsByLitter[0].by_sex.male.within_reach, [ids.lee]);
});

test('a turn is open and the holder is first for the new litter: it joins, restarting the deadline', async () => {
  await litterRepo.update(C.id, { picks_opened_date: '2026-10-01' });
  await actions.offerTo(C.id, ids.lee, { today: '2026-10-01' }); // Lee holds C (Rex), due 10-04
  const p = await run(A.id); // A has Pip: Lee is the top family for it
  assert.equal(p.action.kind, 'join');
  assert.equal(p.action.entry_id, ids.lee);
  assert.equal(p.action.was_respond_by, '2026-10-04');
  const res = await actions.openPicks(A.id, { date: DAY });
  assert.equal(res.joined, true);
  assert.equal(res.respond_by_date, p.action.respond_by);
  assert.deepEqual(p.action.dog_ids, [ids.aMale]);
});

test('"Not this litter" on a whole turn: the preview shows the pass the real loop records, then who gets the turn', async () => {
  await waitlistEntryRepo.update(ids.lee, { prepasses: [{ litter_id: A.id, date: '2026-10-01', reason: { id: 'timing', label: 'Timing', text: '' } }] });
  const p = await run(A.id);
  assert.equal(p.action.kind, 'offer');
  assert.equal(p.action.entry_id, ids.kim);
  assert.equal(p.action.auto_passed.length, 1);
  assert.equal(p.action.auto_passed[0].entry_id, ids.lee);
  assert.equal(p.action.auto_passed[0].counted, true);
  assert.equal(p.action.auto_passed[0].used, 1);
  const turn = await actions.openPicks(A.id, { date: DAY });
  assert.equal(turn.entry_id, ids.kim);
  assert.deepEqual(turn.auto_passed.map((x) => [x.entry_id, x.counted, x.used, x.removed]),
    p.action.auto_passed.map((x) => [x.entry_id, x.counted, x.used, x.removed]));
});

test('nobody qualifies: none, and every family is left out with a reason', async () => {
  for (const id of [ids.lee, ids.kim, ids.ng]) await waitlistEntryRepo.update(id, { paused_until: '2026-12-31' });
  const p = await run(A.id);
  assert.equal(p.action.kind, 'none');
  assert.equal(await actions.openPicks(A.id, { date: DAY }), null);
  assert.equal(p.excluded.length, 3);
  for (const x of p.excluded) assert.ok(x.litters[0].reasons.some((r) => r.code === 'paused' && r.until === '2026-12-31'));
});

test('the families in line equal litterQueue; every reason is given, not just the first', async () => {
  const rules = await import('../shared/data/waitlistRules.js');
  await waitlistEntryRepo.update(ids.ng, { paused_until: '2026-12-31', pref_breed: 'Poodle' });
  const d = await load();
  const p = preview.previewPicks(d, { litterId: B.id, today: DAY, view: 'alone' });
  const config = rules.waitlistConfig(d.kennel);
  const queue = rules.litterQueue(d.entries, { ...B, picks_opened_date: DAY }, d.dogs, d.sales, { today: DAY, config, programsById: d.programsById });
  assert.deepEqual(p.turnOrder.map((t) => t.entry_id), queue.map((q) => q.entry.id));
  const ng = p.excluded.find((x) => x.entry_id === ids.ng).litters[0].reasons;
  assert.deepEqual(ng.map((r) => r.code), ['paused', 'no_match']);
  assert.deepEqual(ng[1].pups[0].fields, ['breed']);
  const lee = p.excluded.find((x) => x.entry_id === ids.lee).litters[0].reasons;
  assert.deepEqual(lee, [{ code: 'no_match', pups: [{ dog_id: ids.bFemale, fields: ['sex'] }] }]);
});

test('pups not offered say why; offered pups carry their setup flags', async () => {
  await dogRepo.update(ids.cMale, { intended_registration: null });
  const p = await run(C.id, { view: 'alone' });
  const rows = p.pupsByLitter[0].pups;
  const kit = rows.find((r) => r.dog_id === ids.cKept);
  assert.equal(kit.offered, false);
  assert.deepEqual(kit.blockers, [{ code: 'disposition', disposition: 'keeping' }]);
  const rex = rows.find((r) => r.dog_id === ids.cMale);
  assert.equal(rex.offered, true);
  assert.deepEqual(rex.flags, ['no_registration']);
  assert.deepEqual(rex.families.map((f) => f.entry_id), [ids.lee, ids.kim]);
});

test('the Either switch moves Either families between sexes, and never changes what will happen', async () => {
  const stated = await run(A.id, { view: 'alone' });
  const asFemale = await run(A.id, { view: 'alone', eitherAs: 'female' });
  const asMale = await run(A.id, { view: 'alone', eitherAs: 'male' });
  const males = (p) => p.pupsByLitter[0].by_sex.male.families;
  const females = (p) => p.pupsByLitter[0].by_sex.female.families;
  assert.equal(males(stated), 2); // Lee, Kim
  assert.equal(males(asFemale), 1); // Lee only
  assert.equal(females(asMale), 1); // Ng only
  assert.deepEqual(asFemale.action, stated.action);
  assert.deepEqual(asMale.action, stated.action);
  assert.equal(asFemale.turnOrder.find((t) => t.entry_id === ids.kim).either_as, 'female');
});

test('alone view: only this litter, families also in line elsewhere are marked; combined shows both', async () => {
  await litterRepo.update(B.id, { picks_opened_date: DAY });
  const alone = await run(A.id, { view: 'alone' });
  assert.deepEqual(alone.shown_litter_ids, [A.id]);
  assert.deepEqual(alone.turnOrder.find((t) => t.entry_id === ids.kim).also_in, [B.id]);
  const combined = await run(A.id);
  assert.deepEqual(combined.shown_litter_ids, [B.id, A.id]);
  const kim = combined.turnOrder.find((t) => t.entry_id === ids.kim);
  assert.deepEqual(kim.litters.map((x) => x.litter_id).sort(), [A.id, B.id].sort());
});

test('a settings draft changes the deadline without writing anything', async () => {
  const p = await run(A.id, { configDraft: { respond_days: 7 } });
  assert.equal(p.action.respond_by, '2026-10-15');
  assert.equal((await kennelRepo.getById(K.id)).waitlist_config.respond_days, 3);
});

test('checks flag likely input mistakes on families in line; families not on the list are listed apart', async () => {
  await waitlistEntryRepo.update(ids.kim, { pref_purposes: [], pref_breed: 'Bostn Terier' });
  const pat = await contactRepo.create({ name: 'Pat' });
  await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: pat.id, status: 'approved', approved_date: '2026-02-01' });
  const p = await run(A.id);
  const kim = p.checks.find((c) => c.entry_id === ids.kim);
  assert.deepEqual(kim.codes, ['any_registration', 'breed_unknown']);
  assert.equal(p.notOnList.length, 1);
  assert.equal(p.notOnList[0].status, 'approved');
});
