// waitlistTimers.test.js — deadlines at a time of day (docs/KennelOS_Waitlist_Timers_Plan.md
// Phase 1): turns in hours, rounded up to the half hour and kept in her families'
// waking hours, counted on her open days; days turns unchanged; overdue at a time; the
// rule the same on her device and the Worker; the actions storing the time.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import * as rules from '../shared/data/waitlistRules.js';
import * as server from '../cloud/src/serverMoves.js';

const HOURS = { respond_days: 3, turn_hours: 24, awake_from: '08:00', awake_until: '21:00' };

test('a 24-hour turn: same time the next day, on the half hour, inside waking hours', () => {
  assert.deepEqual(rules.respondBy({ date: '2026-11-20', time: '19:00' }, HOURS), { date: '2026-11-21', time: '19:00' });
  assert.deepEqual(rules.respondBy({ date: '2026-11-20', time: '19:01' }, HOURS), { date: '2026-11-21', time: '19:30' }, 'rounded up');
  assert.deepEqual(rules.respondBy({ date: '2026-11-20', time: '02:10' }, HOURS), { date: '2026-11-21', time: '08:00' }, 'a 2 am pass: their morning');
  assert.deepEqual(rules.respondBy({ date: '2026-11-20', time: '21:15' }, HOURS), { date: '2026-11-22', time: '08:00' }, 'after 9 pm: the next morning');
  assert.deepEqual(rules.respondBy({ date: '2026-11-20', time: '20:45' }, HOURS), { date: '2026-11-21', time: '21:00' }, 'the end of waking hours is in');
  assert.deepEqual(rules.respondBy({ date: '2026-11-20', time: '10:00' }, { ...HOURS, turn_hours: 48 }), { date: '2026-11-22', time: '10:00' });
  assert.deepEqual(rules.respondBy('2026-11-20', HOURS), { date: '2026-11-21', time: '08:00' }, 'a bare date starts at waking hours');
});

test('closed weekdays and closed dates don\'t count toward the hours (T5)', () => {
  // Sunday 2026-11-22 closed: Saturday 7 pm + 24 h = Monday 7 pm.
  const c = { ...HOURS, open_days: [1, 2, 3, 4, 5, 6] };
  assert.deepEqual(rules.respondBy({ date: '2026-11-21', time: '19:00' }, c), { date: '2026-11-23', time: '19:00' });
  // Offered on the closed Sunday: counting starts Monday 00:00, ending Tuesday 00:00, so Tuesday's morning.
  assert.deepEqual(rules.respondBy({ date: '2026-11-22', time: '12:00' }, c), { date: '2026-11-24', time: '08:00' });
  assert.deepEqual(rules.respondBy({ date: '2026-11-20', time: '19:00' }, { ...HOURS, closed_dates: ['2026-11-21'] }), { date: '2026-11-22', time: '19:00' });
});

test('a program\'s longer window counts its days as 24 hours each (T6); days turns are unchanged', () => {
  assert.deepEqual(rules.respondBy({ date: '2026-11-20', time: '19:00' }, HOURS, { respond_days_override: 2 }), { date: '2026-11-22', time: '19:00' });
  const days = { respond_days: 3 };
  assert.deepEqual(rules.respondBy({ date: '2026-11-20', time: '19:00' }, days), { date: '2026-11-23', time: null });
  assert.equal(rules.turnHours(days), null);
  assert.equal(rules.turnLengthText(days), '3 days');
  assert.equal(rules.turnLengthText(HOURS), '24 hours');
});

test('overdue at a time; a deadline with no time is the end of its day; a bare date never closes one early', () => {
  const timed = { respond_by_date: '2026-11-21', respond_by_time: '19:00' };
  assert.equal(rules.isTurnOverdue(timed, { date: '2026-11-21', time: '18:59' }), false);
  assert.equal(rules.isTurnOverdue(timed, { date: '2026-11-21', time: '19:00' }), true);
  assert.equal(rules.isTurnOverdue(timed, '2026-11-21'), false, 'a date alone reads as 00:00');
  assert.equal(rules.isTurnOverdue(timed, '2026-11-22'), true);
  const day = { respond_by_date: '2026-11-21' };
  assert.equal(rules.isTurnOverdue(day, { date: '2026-11-21', time: '23:59' }), false);
  assert.equal(rules.isTurnOverdue(day, '2026-11-21'), false);
  assert.equal(rules.isTurnOverdue(day, { date: '2026-11-22', time: '00:00' }), true);
  assert.equal(rules.isTurnOverdue(day, '2026-11-22'), true);
});

test('a turn\'s deadline is its latest row\'s, time included', () => {
  const rows = [
    { respond_by_date: '2026-11-21', respond_by_time: '19:00' },
    { respond_by_date: '2026-11-21', respond_by_time: '20:30' },
    { respond_by_date: '2026-11-20' }
  ];
  assert.deepEqual(rules.turnDeadline(rows), { date: '2026-11-21', time: '20:30' });
  assert.deepEqual(rules.turnDeadline([{ respond_by_date: '2026-11-21', respond_by_time: '19:00' }, { respond_by_date: '2026-11-21' }]), { date: '2026-11-21', time: null }, 'no time = 11:59 pm, the later');
  assert.equal(rules.deadlineLabel('2026-11-21', '19:00'), '2026-11-21, 7:00 pm');
  assert.equal(rules.deadlineLabel('2026-11-21', null), '2026-11-21');
});

test('waking hours and the turn length are checked before saving', () => {
  assert.equal(rules.waitlistConfigProblem({ ...rules.WAITLIST_CONFIG_DEFAULTS, ...HOURS }), '');
  assert.match(rules.waitlistConfigProblem({ ...rules.WAITLIST_CONFIG_DEFAULTS, ...HOURS, turn_hours: 0 }), /Hours to accept/);
  assert.match(rules.waitlistConfigProblem({ ...rules.WAITLIST_CONFIG_DEFAULTS, ...HOURS, awake_from: '08:15' }), /half hour/);
  assert.match(rules.waitlistConfigProblem({ ...rules.WAITLIST_CONFIG_DEFAULTS, ...HOURS, awake_from: '22:00' }), /start before/);
});

test('her device and the Worker work out the same deadline', () => {
  const cases = [
    [{ date: '2026-11-20', time: '19:00' }, 24, null, []],
    [{ date: '2026-11-20', time: '19:13' }, 24, null, []],
    [{ date: '2026-11-20', time: '01:00' }, 12, null, []],
    [{ date: '2026-11-21', time: '19:00' }, 24, [1, 2, 3, 4, 5, 6], []],
    [{ date: '2026-11-22', time: '12:00' }, 24, [1, 2, 3, 4, 5, 6], ['2026-11-23']],
    [{ date: '2026-11-20', time: '20:59' }, 72, [1, 2, 3, 4, 5], ['2026-11-26']],
    [{ date: '2026-11-20', time: null }, 6, null, []]
  ];
  for (const [at, hours, open, closed] of cases) {
    const config = { ...HOURS, turn_hours: hours, open_days: open, closed_dates: closed };
    const device = rules.respondBy(at, config);
    const worker = server.hoursDeadline(at, hours, open, closed, server.awakeHours({ awake_from: '08:00', awake_until: '21:00' }));
    assert.deepEqual(worker, device, JSON.stringify(at));
  }
});

// --- Through the actions ---------------------------------------------------------------

let db; let kennelRepo; let dogRepo; let litterRepo; let contactRepo; let waitlistEntryRepo; let waitlistOfferRepo; let actions;
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
});

let K; let L; let ids;
beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, waitlist_config: { max_passes: 2, ...HOURS } });
  const dog = (call_name, sex, extra = {}) => dogRepo.create({ call_name, sex, breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: K.id, ...extra });
  const ash = await dog('Ash', 'male');
  const jun = await dog('Juniper', 'female');
  L = await litterRepo.create({ dam_id: jun.id, sire_id: ash.id, status: 'whelped', kennel_id: K.id, whelp_date: '2026-09-01', nickname: 'Litter A' });
  await dog('Pip', 'male', { status: 'puppy', litter_id: L.id, disposition: 'available' });
  const fam = async (name, fee) => {
    const c = await contactRepo.create({ name, email: `${name.toLowerCase()}@example.com` });
    return (await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: c.id, status: 'active', approved_date: '2026-01-01', fee_received_date: fee, pref_sex: 'any' })).id;
  };
  ids = { lee: await fam('Lee', '2026-01-01'), kim: await fam('Kim', '2026-01-02') };
});

test('opening picks stores the turn\'s time; given more time keeps it or takes a new one', async () => {
  const { kennelNow } = await import('../shared/data/dateUtils.js');
  const turn = await actions.openPicks(L.id);
  const now = kennelNow(K);
  const want = rules.respondBy(now, K.waitlist_config);
  assert.equal(turn.entry_id, ids.lee);
  assert.deepEqual({ date: turn.respond_by_date, time: turn.respond_by_time }, want);
  const [row] = (await waitlistOfferRepo.getByKennel(K.id)).filter((o) => o.outcome === 'open');
  assert.equal(row.respond_by_time, want.time);

  const later = (await import('../shared/data/dateUtils.js')).addDaysToYMD(want.date, 2);
  const kept = await actions.extendTurn(turn.id, { until: later });
  assert.deepEqual([kept.respond_by_date, kept.respond_by_time], [later, want.time], 'keeps the turn\'s time');
  const moved = await actions.extendTurn(turn.id, { until: later, untilTime: '20:30' });
  assert.equal(moved.respond_by_time, '20:30');
  await assert.rejects(actions.extendTurn(turn.id, { until: later, untilTime: '8pm' }), /Pick a time/);
});

test('a turn opened on a past day (a back-dated open) starts at waking hours', async () => {
  const turn = await actions.openPicks(L.id, { date: '2026-11-02' });
  assert.deepEqual({ date: turn.respond_by_date, time: turn.respond_by_time }, { date: '2026-11-03', time: '08:00' });
});

test('with turns in days, nothing gets a time', async () => {
  await kennelRepo.update(K.id, { waitlist_config: { max_passes: 2, respond_days: 3 } });
  const turn = await actions.openPicks(L.id, { date: '2026-11-02' });
  assert.equal(turn.respond_by_date, '2026-11-05');
  assert.equal(turn.respond_by_time, null);
  const [row] = (await waitlistOfferRepo.getByKennel(K.id)).filter((o) => o.outcome === 'open');
  assert.equal(row.respond_by_time, null);
});

test('the projection carries the turn\'s time and her hours settings to the Worker and the family page', async () => {
  const { buildProjection } = await import('../shared/data/waitlistProjection.js');
  const turn = await actions.openPicks(L.id, { date: '2026-11-02' });
  const kennel = { ...(await kennelRepo.getById(K.id)), public_id: 'kos1_x', time_zone: 'America/Chicago' };
  const p = buildProjection({
    kennel,
    entries: await waitlistEntryRepo.getByKennel(K.id),
    offers: await waitlistOfferRepo.getByKennel(K.id),
    litters: [await litterRepo.getById(L.id)],
    dogs: await dogRepo.getAll(),
    contacts: [],
    today: '2026-11-02'
  });
  assert.equal(p.entries[turn.entry_id].offers[0].respond_by_time, '08:00');
  assert.equal(p.kennel.turn_hours, 24);
  assert.equal(p.kennel.awake_from, '08:00');
  assert.equal(p.kennel.awake_until, '21:00');
  assert.ok(p.turn_queue.every((q) => q.respond_hours === 24));
});

// --- Phase 2: the planned opening; Phase 3: the turn order it joins -----------------

test('a planned opening: the litter\'s own time, else her usual one; due from that time', () => {
  const cfg = { picks_open_time: '19:00' };
  assert.deepEqual(rules.plannedOpening({ accept_deposits_date: '2026-11-21' }, cfg), { date: '2026-11-21', time: '19:00' });
  assert.deepEqual(rules.plannedOpening({ accept_deposits_date: '2026-11-21', picks_open_time: '18:30' }, cfg), { date: '2026-11-21', time: '18:30' });
  assert.deepEqual(rules.plannedOpening({ accept_deposits_date: '2026-11-21' }, {}), { date: '2026-11-21', time: null });
  assert.equal(rules.plannedOpening({}, cfg), null);
  const at = { date: '2026-11-21', time: '19:00' };
  assert.equal(rules.isOpeningDue(at, { date: '2026-11-21', time: '18:59' }), false);
  assert.equal(rules.isOpeningDue(at, { date: '2026-11-21', time: '19:00' }), true);
  assert.equal(rules.isOpeningDue({ date: '2026-11-21', time: null }, '2026-11-21'), true, 'no time: from the start of the day, as before');
  const l = { id: 'l', status: 'whelped', accept_deposits_date: '2026-11-21', picks_open_time: '19:00' };
  const pups = [{ id: 'p', litter_id: 'l', disposition: 'available', status: 'puppy' }];
  assert.equal(rules.depositsDueLitters([l], pups, [], { date: '2026-11-21', time: '18:00' }, { configFor: () => ({}) }).length, 0);
  assert.equal(rules.depositsDueLitters([l], pups, [], { date: '2026-11-21', time: '19:00' }, { configFor: () => ({}) }).length, 1);
  assert.equal(rules.waitlistConfigProblem({ ...rules.WAITLIST_CONFIG_DEFAULTS, picks_open_time: '19:10' }), 'Picks open on the hour or half hour.');
});

test('countdowns: her device and the Worker agree on the moment; the words', async () => {
  const d = await import('../shared/data/dateUtils.js');
  for (const [date, time, tz] of [['2026-11-21', '19:00', 'America/Chicago'], ['2026-03-08', '03:30', 'America/Chicago'], ['2026-11-21', null, 'Asia/Kathmandu']]) {
    assert.equal(d.zonedInstant(date, time, tz), server.zonedInstant(date, time, tz));
  }
  const now = Date.parse('2026-11-19T12:00:00Z');
  assert.equal(d.countdownText(now + (2 * 86400 + 4 * 3600 + 60) * 1000, now), '2 days 4 hr');
  assert.equal(d.countdownText(now + (5 * 3600 + 12 * 60 + 9) * 1000, now), '5 hr 12 min');
  assert.equal(d.countdownText(now + (12 * 60 + 4) * 1000, now), '12:04');
  assert.equal(d.countdownText(now - 1000, now), '');
});

test('the projection: her planned opening for the server\'s alert, and the turn order it joins', async () => {
  const { buildProjection } = await import('../shared/data/waitlistProjection.js');
  await litterRepo.update(L.id, { accept_deposits_date: '2026-11-30', picks_open_time: '19:00' });
  await kennelRepo.update(K.id, { waitlist_config: { ...K.waitlist_config, show_upcoming: { early_litters: { public: true, family: true } } } });
  const kennel = { ...(await kennelRepo.getById(K.id)), public_id: 'kos1_x', time_zone: 'America/Chicago' };
  const p = buildProjection({
    kennel, entries: await waitlistEntryRepo.getByKennel(K.id), offers: await waitlistOfferRepo.getByKennel(K.id),
    litters: [await litterRepo.getById(L.id)], dogs: await dogRepo.getAll(), contacts: [], today: '2026-11-19'
  });
  assert.deepEqual(p.litters[L.id].planned_open, { date: '2026-11-30', time: '19:00' });
  const [pip] = (await dogRepo.getAll()).filter((d) => d.litter_id === L.id);
  assert.deepEqual(p.openings, [{ litter_id: L.id, date: '2026-11-30', time: '19:00', queue: [
    { entry_id: ids.lee, dog_ids: [pip.id], planned: true }, { entry_id: ids.kim, dog_ids: [pip.id], planned: true }
  ] }]);
  const item = p.upcoming.find((u) => u.litter_id === L.id);
  assert.equal(item.picks_expected_time, '19:00');
  // …and the family's page: when picks open, and Kim's estimate after Lee's 24 hours.
  const { statusView } = await import('../cloud/src/familyPages.js');
  const now = new Date('2026-11-19T18:00:00Z');
  assert.equal(statusView(p, ids.kim, now).family.turn_estimate, undefined, 'one pup, and Lee first: nothing for Kim');
  assert.equal(statusView(p, ids.lee, now).family.turn_estimate.at, '2026-12-01T01:00:00.000Z', 'Lee: when picks open, 7:00 pm Chicago');
  // A second pup: Kim could get one, after Lee's 24 hours.
  await dogRepo.create({ call_name: 'Pia', sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'puppy', litter_id: L.id, disposition: 'available', kennel_id: K.id });
  const p2 = buildProjection({
    kennel, entries: await waitlistEntryRepo.getByKennel(K.id), offers: await waitlistOfferRepo.getByKennel(K.id),
    litters: [await litterRepo.getById(L.id)], dogs: await dogRepo.getAll(), contacts: [], today: '2026-11-19'
  });
  const kim = statusView(p2, ids.kim, now);
  assert.equal(kim.family.turn_estimate.at, '2026-12-02T01:00:00.000Z', 'Dec 1, 7:00 pm Chicago');
  assert.equal(kim.upcoming.find((u) => u.litter_id === L.id).picks_expected_at, '2026-12-01T01:00:00.000Z');
});
