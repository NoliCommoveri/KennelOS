// familyFreeChanges.test.js — free changes (docs/KennelOS_Family_Free_Changes_Plan.md):
// her per-change setting for before / after pups are born, the phase rule, and what
// her device does with a family's change when it applies it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFamilyEvent } from '../shared/data/waitlistEvents.js';
import { familyChanges, pupsOnGround, changePhase, freeChanges, waitlistConfig, PUPS_ON_GROUND_STATUSES } from '../shared/data/waitlistRules.js';
import { policyStarters } from '../shared/data/waitlistPolicies.js';

const litter = (status, extra = {}) => ({ id: `l-${status}`, kennel_id: 'k', status, ...extra });
const ev = (kind, payload = {}) => ({ seq: 9, publicId: 'kos1_x', entryId: 'e1', kind, payload, madeBy: 'family', createdAt: '2026-11-10T18:00:00.000Z' });
const entry = (extra = {}) => ({ id: 'e1', kennel_id: 'k', status: 'active', pref_sex: 'any', ready_timing: 'asap', listen_mode: 'all', listen_sire_ids: [], listen_dam_ids: [], ...extra });
const cfg = (grid, extra = {}) => waitlistConfig({ waitlist_config: { family_changes: grid, ...extra } });
const ctx = (extra = {}) => ({ entry: entry(), offers: [], pups: [], sales: [], timeZone: 'UTC', litters: new Map(), config: cfg(null), ...extra });

test('her setting: every change starts needing her OK; only true counts', () => {
  const g = familyChanges({});
  assert.equal(Object.keys(g).length, 8);
  assert.ok(Object.values(g).every((x) => x.before === false && x.after === false));
  assert.deepEqual(familyChanges({ family_changes: { pref_sex: { before: true, after: 'yes' } } }).pref_sex, { before: true, after: false });
  assert.equal(waitlistConfig({}).unpause_allowed, false);
});

test('pups on the ground: a litter of this kennel whelped, weaning, ready or sold; not expected, closed, archived, off the waitlist or another kennel\'s', () => {
  assert.deepEqual(PUPS_ON_GROUND_STATUSES, ['whelped', 'weaning', 'ready', 'sold']);
  for (const s of PUPS_ON_GROUND_STATUSES) assert.equal(pupsOnGround([litter(s)], 'k'), true, s);
  assert.equal(pupsOnGround([litter('expected'), litter('closed')], 'k'), false);
  assert.equal(pupsOnGround([litter('whelped', { is_archived: true })], 'k'), false);
  assert.equal(pupsOnGround([litter('whelped', { waitlist_off: true })], 'k'), false, 'plan Q2');
  assert.equal(pupsOnGround([litter('whelped', { kennel_id: 'other' })], 'k'), false);
  assert.equal(changePhase(new Map([['a', litter('ready')]]), 'k'), 'after', 'a Map works too');
  assert.equal(changePhase([], 'k'), 'before');
});

test('free now: her column for the phase; an open turn always follows After; ending a pause early only where she offers it', () => {
  const config = cfg({ pref_sex: { before: true, after: false }, unpause: { before: true } });
  assert.equal(freeChanges(entry(), { config, phase: 'before' }).pref_sex, true);
  assert.equal(freeChanges(entry(), { config, phase: 'after' }).pref_sex, false);
  assert.equal(freeChanges(entry(), { config, phase: 'before', offers: [{ entry_id: 'e1', outcome: 'open' }] }).pref_sex, false, 'the safety net');
  assert.equal(freeChanges(entry(), { config, phase: 'before' }).unpause, false, 'unpause_allowed is off');
  assert.equal(freeChanges(entry(), { config: { ...config, unpause_allowed: true }, phase: 'before' }).unpause, true);
});

test('an answer change: the free fields apply, logged as theirs; the rest become one request', () => {
  const config = cfg({ pref_sex: { before: true } });
  const plan = planFamilyEvent(ev('pref_change', { changes: { pref_sex: 'female', ready_timing: '3_months' }, note: 'ok' }), ctx({ config }));
  assert.equal(plan.op, 'pref_apply');
  assert.deepEqual(plan.changes, { pref_sex: 'female' });
  assert.deepEqual(plan.request, { requested_date: '2026-11-10', changes: { ready_timing: '3_months' }, note: 'ok' });
  assert.match(plan.activity.body, /before pups were born.*Sex: Either → Female.*The rest waits for you/);
  const all = planFamilyEvent(ev('pref_change', { changes: { pref_sex: 'female' } }), ctx({ config }));
  assert.equal(all.request, null);
});

test('her records decide, never the server\'s mark: a litter whelped since the tap makes it a request', () => {
  const config = cfg({ pref_sex: { before: true }, listen: { before: true }, pause: { before: true } });
  const litters = new Map([['l', litter('whelped')]]);
  assert.equal(planFamilyEvent(ev('pref_change', { changes: { pref_sex: 'female' }, free: ['pref_sex'] }), ctx({ config, litters })).op, 'pref_request');
  assert.equal(planFamilyEvent(ev('listen', { mode: 'selected', sire_ids: ['ash'], free: true }), ctx({ config, litters })).op, 'listen_request');
  assert.equal(planFamilyEvent(ev('pause_request', { until: '2026-12-31', free: true }), ctx({ config, litters })).op, 'pause_request');
  // And the other way: free now though the family's page said it would ask.
  assert.equal(planFamilyEvent(ev('pause_request', { until: '2026-12-31', free: false }), ctx({ config })).op, 'pause_apply');
});

test('parents and pausing apply by themselves where she allows it; "Not yet" pauses at once', () => {
  const config = cfg({ listen: { before: true }, pause: { before: true } });
  const listen = planFamilyEvent(ev('listen', { mode: 'except', dam_ids: ['juniper'] }), ctx({ config }));
  assert.equal(listen.op, 'listen_apply');
  assert.deepEqual(listen.changes, { listen_mode: 'except', listen_sire_ids: [], listen_dam_ids: ['juniper'] });
  const toAll = planFamilyEvent(ev('listen', { mode: 'all' }), ctx({ config, entry: entry({ listen_mode: 'selected', listen_sire_ids: ['ash'] }) }));
  assert.deepEqual(toAll.changes, { listen_mode: 'all' }, 'back to All keeps their earlier picks');
  const pause = planFamilyEvent(ev('pause_request', { until: '2026-12-31', note: 'Moving' }), ctx({ config }));
  assert.deepEqual([pause.op, pause.until, pause.note], ['pause_apply', '2026-12-31', 'Moving']);
  const ready = planFamilyEvent(ev('ready', { answer: 'no', until: '2027-01-15', reason: 'Moving' }), ctx({ config }));
  assert.equal(ready.free, true);
  assert.equal(planFamilyEvent(ev('ready', { answer: 'no', until: '2027-01-15', reason: 'Moving' }), ctx()).free, undefined, 'otherwise a pause request');
});

test('ending a pause early: free, a request, or a line when she no longer offers it or the pause is over', () => {
  const paused = entry({ paused_until: '2026-12-31' });
  const offered = cfg({ unpause: { before: true } }, { unpause_allowed: true });
  assert.equal(planFamilyEvent(ev('unpause'), ctx({ entry: paused, config: offered })).op, 'unpause_apply');
  assert.equal(planFamilyEvent(ev('unpause', { note: 'Ready!' }), ctx({ entry: paused, config: cfg(null, { unpause_allowed: true }) })).op, 'unpause_request');
  assert.equal(planFamilyEvent(ev('unpause'), ctx({ entry: paused, config: cfg(null) })).op, 'note');
  assert.equal(planFamilyEvent(ev('unpause'), ctx({ entry: entry({ paused_until: '2026-11-01' }), config: offered })).op, 'note');
});

test('her policies say what families may change themselves', () => {
  const prefs = (c) => policyStarters(waitlistConfig({ waitlist_config: c }), { kennel_name: 'Thornfield' }).find((p) => p.topic === 'preferences').body;
  assert.match(prefs({}), /You can ask to change them from your status page\./);
  const before = Object.fromEntries(['pref_sex', 'pref_breed', 'pref_purposes', 'ready_timing', 'listen'].map((k) => [k, { before: true }]));
  assert.match(prefs({ family_changes: before }), /Until puppies are born you can change them yourself/);
  assert.match(prefs({ family_changes: { pref_sex: { before: true } } }), /change some of them yourself/);
  const pausing = (c) => policyStarters(waitlistConfig({ waitlist_config: c }), { kennel_name: 'Thornfield' }).find((p) => p.topic === 'pausing').body;
  assert.match(pausing({ unpause_allowed: true }), /end your pause early from your status page/);
});
