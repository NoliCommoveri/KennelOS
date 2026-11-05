// waitlistPolicies.test.js — her waitlist policies (Waitlist Policies plan): the
// cleaned list, the "I've read the policies" question that exists only while she has
// a policy (so a form saved before this never asks it, and nothing can require a box
// with nothing to read behind it), and the starter wording, which may only say what
// her settings do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formQuestions, waitlistPolicies, hasPolicies, validatePolicies, newPolicy, POLICIES_READ_LOCK,
  entryQuestions, missingRequired, snapshotQuestions, isLocked
} from '../shared/data/waitlistForm.js';
import { POLICY_TOPICS, policyStarter, policyStarters, basisChanges, policyHint, openDaysWords } from '../shared/data/waitlistPolicies.js';
import { waitlistConfig, WAITLIST_CONFIG_DEFAULTS } from '../shared/data/waitlistRules.js';

const ONE = [{ id: 'pol_1', heading: 'Applications', body: 'Approval is at our discretion.' }];
const kennel = (c = {}) => ({ kennel_name: 'Thornfield Kennels', time_zone: 'America/Chicago', waitlist_config: c });
const id = () => 'x';

test('the policies list: cleaned, blank rows dropped, topic and basis kept; none by default', () => {
  assert.deepEqual(WAITLIST_CONFIG_DEFAULTS.policies, []);
  assert.deepEqual(waitlistPolicies(waitlistConfig(kennel())), []);
  assert.equal(hasPolicies({}), false);
  assert.equal(hasPolicies(null), false);
  const got = waitlistPolicies({ policies: [
    { id: ' a ', heading: ' Fees ', body: ' Non-refundable. ', topic: 'applications', basis: { fee_amount: 300 } },
    { heading: '', body: '   ' }, null, 'x',
    { heading: 'Pausing', body: 'Skipped while paused.' }
  ] });
  assert.deepEqual(got, [
    { id: 'a', heading: 'Fees', body: 'Non-refundable.', topic: 'applications', basis: { fee_amount: 300 } },
    { id: 'pol_3', heading: 'Pausing', body: 'Skipped while paused.' }
  ]);
  assert.deepEqual(validatePolicies([{ heading: 'A', body: '' }, { heading: '', body: 'B' }, { heading: '', body: '' }, { heading: 'C', body: 'D' }]),
    ['Policy 1 needs both a heading and its wording.', 'Policy 2 needs both a heading and its wording.']);
  assert.deepEqual(newPolicy(() => 'abc'), { id: 'pol_abc', heading: '', body: '' });
});

test('"I\'ve read the policies": only while she has a policy, locked, required, last, with its link', () => {
  const none = formQuestions({});
  assert.ok(!none.some((q) => q.key === 'policies_read'), 'no policies: not on the form');
  const withOne = formQuestions({ policies: ONE });
  const last = withOne.at(-1);
  assert.equal(last.key, 'policies_read');
  assert.ok(isLocked(last));
  assert.equal(last.type, 'checkboxes');
  assert.equal(last.required, true);
  assert.equal(last.link, 'policies');
  assert.match(last.label, /policies/);
  assert.deepEqual(last.options, [...POLICIES_READ_LOCK.options]);
  assert.equal(withOne.filter((q) => q.key === 'policies_read').length, 1);
});

test('a form saved before policies existed gets the question the moment she adds one, and loses it with the last', () => {
  const saved = formQuestions({}).map((q) => ({ ...q }));
  const config = { form_questions: saved };
  assert.ok(!formQuestions(config).some((q) => q.key === 'policies_read'));
  assert.equal(formQuestions({ ...config, policies: ONE }).at(-1).key, 'policies_read');
  assert.ok(!formQuestions({ ...config, policies: [] }).some((q) => q.key === 'policies_read'));
});

test('a stored copy keeps her wording but never shows without a policy; it always goes last', () => {
  const stored = [{ id: 'policies_read', key: 'policies_read', label: 'Read our policies first', type: 'checkboxes', required: false }, ...formQuestions({})];
  assert.ok(!formQuestions({ form_questions: stored }).some((q) => q.key === 'policies_read'), 'no policy behind it: dropped');
  const q = formQuestions({ form_questions: stored, policies: ONE });
  assert.equal(q.at(-1).key, 'policies_read');
  assert.equal(q.at(-1).label, 'Read our policies first');
  assert.equal(q.at(-1).required, true, 'its lock restores required');
  assert.equal(q.filter((x) => x.id === 'policies_read').length, 1);
  // An ordinary question that happened to use the id can't stand in for it.
  assert.ok(!formQuestions({ form_questions: [{ id: 'policies_read', label: 'x', type: 'short_text' }] }).some((x) => x.id === 'policies_read'));
});

test('required online only: her typed-in applications and imports never need it', () => {
  const qs = formQuestions({ policies: ONE });
  assert.ok(missingRequired(qs, { name: 'Ann' }, { manualEntry: false }).includes(qs.at(-1).label));
  assert.ok(!missingRequired(qs, { name: 'Ann', email: 'a@x', ready_timing: 'asap', policies_read: [POLICIES_READ_LOCK.options[0]] }, { manualEntry: false }).includes(qs.at(-1).label));
  assert.deepEqual(missingRequired(qs, { name: 'Ann' }), [], 'typed in: only the name');
  assert.ok(snapshotQuestions(qs).some((x) => x.id === 'policies_read'), 'its wording is kept with the answer');
});

test('an older application without the answer shows no blank box; an answered one shows it', () => {
  const qs = formQuestions({ policies: ONE });
  assert.ok(!entryQuestions({ application: { name: 'Ann' } }, qs).some((x) => x.id === 'policies_read'));
  assert.ok(entryQuestions({ application: { name: 'Ann', policies_read: ['yes'] } }, qs).some((x) => x.id === 'policies_read'));
});

test('starter topics: the owner\'s six, each with a heading, wording, topic and basis', () => {
  assert.deepEqual(POLICY_TOPICS.map((t) => t.id), ['applications', 'preferences', 'passes', 'picking', 'pausing', 'days']);
  const rows = policyStarters(waitlistConfig(kennel()), kennel(), id);
  assert.equal(rows.length, 6);
  for (const r of rows) {
    assert.ok(r.heading && r.body && r.topic && r.basis);
    assert.doesNotMatch(r.body, /undefined|null|NaN|\{|\}/, r.topic);
  }
  assert.equal(policyStarter('nope', {}, kennel()), null);
});

test('Applications: discretion always; the fee sentence only with a fee', () => {
  const free = policyStarter('applications', waitlistConfig(kennel()), kennel(), id).body;
  assert.match(free, /approval is at Thornfield Kennels' discretion/);
  assert.match(free, /counts from the day you're approved/);
  assert.doesNotMatch(free, /fee/);
  const paid = policyStarter('applications', waitlistConfig(kennel({ fee_amount: 300, fee_due_days: 5, open_days: [1, 2, 3, 4, 5] })), kennel(), id).body;
  assert.match(paid, /\$300 application fee is due within 5 business days, and it must be received and marked received by us before your name appears on the waitlist/);
  assert.match(policyStarter('applications', waitlistConfig(kennel({ fee_amount: 250 })), kennel(), id).body, /\$250 application fee must be received/);
  assert.match(policyStarter('applications', waitlistConfig({ kennel_name: "Ann's Bostons" }), { kennel_name: "Ann's Bostons" }, id).body, /Ann's Bostons' discretion/);
});

test('Passes: from her pass limit and no-response setting; the fee line only when non-refundable', () => {
  const two = policyStarter('passes', waitlistConfig(kennel()), kennel(), id).body;
  assert.match(two, /You can pass 1 time; your 2nd pass removes you/);
  assert.match(two, /Not responding by your deadline counts as a pass/);
  assert.doesNotMatch(two, /not returned/);
  const one = policyStarter('passes', waitlistConfig(kennel({ max_passes: 1, no_response_counts_as_pass: false, fee_credit_policy: 'non_refundable' })), kennel(), id).body;
  assert.match(one, /passing removes you from the waitlist/);
  assert.match(one, /the turn moves to the next family and Thornfield Kennels will be in touch/);
  assert.match(one, /the application fee is not returned/);
  assert.match(policyStarter('passes', waitlistConfig(kennel({ max_passes: 3 })), kennel(), id).body, /pass 2 times; your 3rd pass/);
});

test('Picking: one deadline for the pick and the deposit, in her days and time zone', () => {
  const b = policyStarter('picking', waitlistConfig(kennel({ respond_days: 3, open_days: [1, 2, 3, 4, 5] })), kennel(), id).body;
  assert.match(b, /3 business days, until the end of the day on your deadline \(Central time\), to choose your puppy and have your deposit received/);
  assert.match(b, /counts as a pass and the turn moves/);
  const every = policyStarter('picking', waitlistConfig(kennel({ respond_days: 1, no_response_counts_as_pass: false })), { kennel_name: 'K' }, id).body;
  assert.match(every, /1 day, until the end of the day on your deadline, to choose/);
  assert.doesNotMatch(every, /counts as a pass/);
});

test('Pausing quotes her readiness question; Preferences mentions color only with matching on', () => {
  assert.match(policyStarter('pausing', waitlistConfig(kennel()), kennel(), id).body, /will not be offered puppies.*before your turn comes up.*"What is the soonest/s);
  assert.doesNotMatch(policyStarter('preferences', waitlistConfig(kennel()), kennel(), id).body, /Color/);
  assert.match(policyStarter('preferences', waitlistConfig(kennel({ color_matching: true })), kennel(), id).body, /Color preferences count too/);
});

test('Business days: her open weekdays in words', () => {
  assert.equal(openDaysWords({}), null);
  assert.equal(openDaysWords({ open_days: [1, 2, 3, 4, 5] }), 'Monday through Friday');
  assert.equal(openDaysWords({ open_days: [5, 6, 0, 1] }), 'Friday through Monday');
  assert.equal(openDaysWords({ open_days: [1, 3, 5] }), 'Monday, Wednesday and Friday');
  assert.equal(openDaysWords({ open_days: [2, 3] }), 'Tuesday and Wednesday');
  assert.match(policyStarter('days', waitlistConfig(kennel({ open_days: [1, 2, 3, 4, 5] })), kennel(), id).body, /open for business: Monday through Friday\./);
  assert.match(policyStarter('days', waitlistConfig(kennel()), kennel(), id).body, /every day of the week, including weekends/);
});

test('when a setting it quoted changes, the row says so; her words are never touched', () => {
  const c = waitlistConfig(kennel({ fee_amount: 300 }));
  const rows = policyStarters(c, kennel(), id);
  for (const r of rows) assert.deepEqual(basisChanges(r, c), [], r.topic);
  const passes = rows.find((r) => r.topic === 'passes');
  assert.deepEqual(basisChanges(passes, { ...c, max_passes: 3 }), ['passes before removal are now 3']);
  const apps = rows.find((r) => r.topic === 'applications');
  assert.deepEqual(basisChanges(apps, { ...c, fee_amount: null }), ['there\'s no application fee now']);
  assert.deepEqual(basisChanges({ heading: 'Mine', body: 'x' }, c), [], 'her own rows have nothing to compare');
  assert.match(policyHint(passes, c), /From your settings: 2 passes, no response counts as a pass\./);
  assert.equal(policyHint({ heading: 'Mine' }, c), '');
});

test('Today\'s nudge: each own kennel with the list online and no policies; gone once one exists', async () => {
  const { installMemoryDb } = await import('./support/memoryDb.js');
  await installMemoryDb();
  const { policiesNudges } = await import('../shared/data/nudges.js');
  const own = (id, c) => ({ id, kennel_name: id === 'k1' ? 'Thornfield' : 'Second', is_own_kennel: true, waitlist_config: c });
  const kennels = [own('k1', { online: true }), own('k2', { online: true, policies: ONE }), own('k3', { online: false }),
    { id: 'k4', is_own_kennel: false, waitlist_config: { online: true } }, { ...own('k5', { online: true }), is_archived: true }];
  const got = policiesNudges(kennels);
  assert.deepEqual(got.map((n) => n.key), ['waitlist-policies:k1']);
  assert.match(got[0].title, /Add your waitlist policies for Thornfield/);
  assert.equal(got[0].subjectHref, 'kennel.html?id=k1&open=policies');
  assert.match(got[0].detail, /Until you add one, your application doesn't ask/);
  assert.deepEqual(policiesNudges(kennels, { online: false }), [], 'list not online here: nothing');
  assert.deepEqual(policiesNudges(kennels, { scopedTo: 'k2' }), [], 'scoped to a kennel with policies');
  assert.equal(policiesNudges([own('k1', { online: true })])[0].title, 'Add your waitlist policies', 'one kennel: no name');
});
