// statusPopupScenarios.test.js — the status page pop-up (End-State guide §29 "The status
// page pop-up") across her litters as they really come: several born at once, a few weeks
// apart or close together, picks open overlapping or not, families who pass on or don't
// match the first litter but do the second. Built through the real actions and projection;
// the Worker's familyPages.statusPopup picks each family's pop-up.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let kennelRepo; let dogRepo; let litterRepo; let contactRepo; let waitlistEntryRepo; let waitlistOfferRepo; let actions; let buildProjection; let statusPopup;
before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ litterRepo } = await import('../shared/data/litterRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ waitlistEntryRepo } = await import('../shared/data/waitlistEntryRepo.js'));
  ({ waitlistOfferRepo } = await import('../shared/data/waitlistOfferRepo.js'));
  actions = await import('../shared/data/waitlistActions.js');
  ({ buildProjection } = await import('../shared/data/waitlistProjection.js'));
  ({ statusPopup } = await import('../cloud/src/familyPages.js'));
});

const TODAY = '2026-11-19';
const SHOWN = { early_litters: { public: true, family: true } };
let K; let parents; let n;
beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  n = 0;
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, waitlist_config: { max_passes: 2, respond_days: 3, show_upcoming: SHOWN } });
  const dog = (call_name, sex) => dogRepo.create({ call_name, sex, breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: K.id });
  parents = { ash: await dog('Ash', 'male'), rex: await dog('Rex', 'male'), jun: await dog('Juniper', 'female'), wil: await dog('Willow', 'female'), haz: await dog('Hazel', 'female') };
});

// A born litter with its pups ({ male: 2, female: 1 }), picks planned on `opens` (or none).
async function litter(name, dam, sire, pups, opens = null) {
  const l = await litterRepo.create({ dam_id: parents[dam].id, sire_id: parents[sire].id, status: 'whelped', kennel_id: K.id, whelp_date: '2026-10-01', nickname: name, ...(opens ? { accept_deposits_date: opens } : {}) });
  for (const [sex, count] of Object.entries(pups)) {
    for (let i = 0; i < count; i++) await dogRepo.create({ call_name: `${name} ${sex} ${i + 1}`, sex, breed: 'Boston Terrier', ownership_type: 'owned', status: 'puppy', litter_id: l.id, disposition: 'available', kennel_id: K.id });
  }
  return l;
}
// Families in line in the order made.
async function family(name, extra = {}) {
  n++;
  const c = await contactRepo.create({ name, email: `${name.toLowerCase()}@example.com` });
  return (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c.id, status: 'active', approved_date: '2026-01-01', fee_received_date: `2026-01-${String(n).padStart(2, '0')}`, pref_sex: 'any', ...extra })).id;
}
const notThis = (entryId, l) => actions.addPrepass(entryId, { litter_id: l.id, reason: { id: 'x', label: 'Timing' }, date: TODAY });
async function popups(fams, { config = {} } = {}) {
  if (Object.keys(config).length) await kennelRepo.update(K.id, { waitlist_config: { ...(await kennelRepo.getById(K.id)).waitlist_config, ...config } });
  const kennel = { ...(await kennelRepo.getById(K.id)), public_id: 'kos1_x', time_zone: 'America/Chicago' };
  const p = buildProjection({
    kennel, entries: await waitlistEntryRepo.getByKennel(K.id), offers: await waitlistOfferRepo.getByKennel(K.id),
    litters: await litterRepo.getAll(), dogs: await dogRepo.getAll(), contacts: [], today: TODAY
  });
  const out = {};
  for (const [name, id] of Object.entries(fams)) out[name] = statusPopup(p, id)?.kind ?? null;
  return out;
}
const openTurn = async () => (await waitlistOfferRepo.getByKennel(K.id)).find((o) => o.outcome === 'open');

test('A open now, B born and opening in three weeks (no overlap)', async () => {
  const A = await litter('A', 'jun', 'ash', { male: 2 });
  await litter('B', 'wil', 'rex', { male: 1, female: 2 }, '2026-12-10');
  const f = {
    ann: await family('Ann'), // holds the turn on A
    bo: await family('Bo'), // next on A, a male left for them
    cy: await family('Cy'), // third on A: both males gone first; B has a pup for them
    dee: await family('Dee', { pref_sex: 'female' }), // no female in A; first female-wanter for B
    eve: await family('Eve', { pref_sex: 'female' }),
    fay: await family('Fay', { pref_sex: 'female' }), // third female-wanter: B's two females gone first
    gus: await family('Gus', { listen_mode: 'except', listen_dam_ids: [parents.wil.id] }), // skips B; far on A
  };
  await actions.openPicks(A.id, { date: TODAY });
  assert.deepEqual(await popups(f), {
    ann: 'turn', bo: 'open', cy: 'soon', dee: 'soon', eve: 'soon_far', fay: 'soon_far', gus: 'open_far',
  });
});

test('"Not this litter" on A, a match on B: counts to B; on both: skipped', async () => {
  const A = await litter('A', 'jun', 'ash', { male: 2, female: 1 });
  const B = await litter('B', 'wil', 'rex', { male: 2 }, '2026-12-10');
  const f = { ann: await family('Ann'), bo: await family('Bo'), cy: await family('Cy'), dee: await family('Dee') };
  await notThis(f.bo, A);
  await notThis(f.cy, A);
  await notThis(f.cy, B);
  await actions.openPicks(A.id, { date: TODAY });
  const got = await popups(f);
  assert.equal(got.ann, 'turn');
  assert.equal(got.bo, 'soon', 'passed A ahead of time; first for B');
  assert.equal(got.cy, 'skipped', 'said no to both');
  assert.equal(got.dee, 'open', 'Ann takes one of three; Dee second in line on A');
});

test('a family who passed on their turn on A waits for B', async () => {
  const A = await litter('A', 'jun', 'ash', { male: 2 });
  await litter('B', 'wil', 'rex', { male: 2 }, '2026-12-10');
  const f = { ann: await family('Ann'), bo: await family('Bo'), cy: await family('Cy') };
  await actions.openPicks(A.id, { date: TODAY });
  await actions.recordOutcome((await openTurn()).id, 'passed', { date: TODAY });
  await actions.offerNextTurn(K.id, { today: TODAY });
  const got = await popups(f);
  assert.equal(got.bo, 'turn', 'the turn moved on to Bo');
  assert.equal(got.ann, 'soon', 'their turn on A used; B ahead');
  assert.equal(got.cy, 'open');
});

test('A and B both open (overlap): one turn order across both', async () => {
  const A = await litter('A', 'jun', 'ash', { male: 1 });
  const B = await litter('B', 'wil', 'rex', { female: 1 });
  const f = {
    ann: await family('Ann'), bo: await family('Bo', { pref_sex: 'female' }), cy: await family('Cy', { pref_sex: 'male' }), dee: await family('Dee'),
  };
  await actions.openPicks(A.id, { date: TODAY });
  await actions.openPicks(B.id, { date: TODAY });
  const got = await popups(f);
  assert.equal(got.ann, 'turn');
  // Ann's turn covers both litters' pups; Bo wants B's female, Cy A's male; Dee anything.
  assert.equal(got.bo, 'open_far', 'Ann (ahead, either pup) could take the one female');
  assert.equal(got.cy, 'open_far');
  assert.equal(got.dee, 'open_far');
});

test('close together: A opens tomorrow, B in two days, neither open yet', async () => {
  await litter('A', 'jun', 'ash', { male: 1 }, '2026-11-20');
  await litter('B', 'wil', 'rex', { male: 1 }, '2026-11-21');
  const f = { ann: await family('Ann'), bo: await family('Bo'), cy: await family('Cy') };
  const got = await popups(f);
  assert.equal(got.ann, 'soon');
  assert.equal(got.bo, 'soon', 'A\'s one pup to Ann, B\'s to Bo');
  assert.equal(got.cy, 'soon_far', 'two pups, two families ahead');
});

test('a born litter with no planned opening day: "opening soon" without the reach check', async () => {
  await litter('A', 'jun', 'ash', { male: 1 });
  const f = { ann: await family('Ann'), bo: await family('Bo') };
  assert.deepEqual(await popups(f), { ann: 'soon', bo: 'soon' });
});

test('a litter she doesn\'t show on family pages gives no pop-up; paused families and empty boxes none', async () => {
  await litter('A', 'jun', 'ash', { male: 1 }, '2026-12-10');
  const f = { ann: await family('Ann'), bo: await family('Bo', { paused_until: '2027-01-01' }) };
  assert.deepEqual(await popups(f, { config: { show_upcoming: null } }), { ann: null, bo: null });
  assert.deepEqual(await popups(f, { config: { show_upcoming: SHOWN, status_popups: { soon: '' } } }), { ann: null, bo: null });
});

test('days and hours turns give the same pop-ups (no time in them)', async () => {
  const A = await litter('A', 'jun', 'ash', { male: 2 });
  const f = { ann: await family('Ann'), bo: await family('Bo'), cy: await family('Cy') };
  await actions.openPicks(A.id, { date: TODAY });
  const days = await popups(f);
  const hours = await popups(f, { config: { turn_hours: 24, awake_from: '08:00', awake_until: '21:00' } });
  assert.deepEqual(days, { ann: 'turn', bo: 'open', cy: 'open_far' });
  assert.deepEqual(hours, days);
});

test('three litters: A open, B opening tomorrow while A\'s line still runs, C six weeks out', async () => {
  const A = await litter('A', 'jun', 'ash', { male: 1 });
  const B = await litter('B', 'wil', 'rex', { female: 1 }, '2026-11-20');
  await litter('C', 'haz', 'ash', { female: 2 }, '2026-12-31');
  const f = {
    ann: await family('Ann'), // holds the turn on A (its one male)
    bo: await family('Bo'), // A's male is Ann's to take; B's female should be theirs
    cy: await family('Cy', { pref_sex: 'female' }), // none in A; B's one female to Bo first; C
    dee: await family('Dee', { pref_sex: 'female' }), // C's second female
    eve: await family('Eve'), // "Not this litter" on A and B; C's females gone to Cy and Dee first
    gus: await family('Gus', { pref_sex: 'male' }), // only A has a male, and Ann holds it
    hal: await family('Hal', { listen_mode: 'selected', listen_dam_ids: [parents.wil.id] }), // only Willow's: B
  };
  await notThis(f.eve, A);
  await notThis(f.eve, B);
  await actions.openPicks(A.id, { date: TODAY });
  assert.deepEqual(await popups(f), {
    ann: 'turn', bo: 'soon', cy: 'soon', dee: 'soon', eve: 'soon_far', gus: 'open_far', hal: 'soon_far',
  });
});

test('nothing for them anywhere: skipped, its words by whether picks are open', async () => {
  const A = await litter('A', 'jun', 'ash', { male: 1 }, '2026-12-10');
  const f = { ann: await family('Ann', { pref_sex: 'female' }) };
  const kennel = async () => ({ ...(await kennelRepo.getById(K.id)), public_id: 'kos1_x', time_zone: 'America/Chicago' });
  const text = async () => statusPopup(buildProjection({
    kennel: await kennel(), entries: await waitlistEntryRepo.getByKennel(K.id), offers: await waitlistOfferRepo.getByKennel(K.id),
    litters: await litterRepo.getAll(), dogs: await dogRepo.getAll(), contacts: [], today: TODAY
  }), f.ann)?.text;
  assert.match(await text(), /^Deposits are opening soon, but you are not scheduled.*reach out to Thornfield if/);
  await actions.openPicks(A.id, { date: TODAY });
  assert.match(await text(), /^Deposits are open, but/);
});

test('a family whose turn on A ran out with no answer waits for B; the next family holds A\'s turn', async () => {
  const A = await litter('A', 'jun', 'ash', { male: 2 });
  await litter('B', 'wil', 'rex', { male: 1 }, '2026-12-10');
  const f = { ann: await family('Ann'), bo: await family('Bo'), cy: await family('Cy') };
  await actions.openPicks(A.id, { date: TODAY });
  await actions.recordOutcome((await openTurn()).id, 'no_response', { date: TODAY });
  await actions.offerNextTurn(K.id, { today: TODAY });
  assert.deepEqual(await popups(f), { ann: 'soon', bo: 'turn', cy: 'open' });
});
