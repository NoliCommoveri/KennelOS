// careVisit.js — the care step's rules: what the first form needs, the shots and
// screening tests it makes for every ticked dog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../shared/data/careVisit.js';
import { EVENT_TYPES, RELATED_CONTACT_ROLE, defaultExpenseCategoryFor } from '../shared/data/vocab.js';
import { TEST_TYPES } from '../shared/data/healthTestLog.js';
import { cloudDetailKeys } from '../shared/data/syncRegistry.js';

test('screening_test: a vet event, never one of the health test types', () => {
  const t = EVENT_TYPES.find((x) => x.value === 'screening_test');
  assert.ok(t);
  assert.deepEqual(t.subjects, ['dog']);
  assert.equal(t.relatedContact, 'Vet');
  assert.equal(RELATED_CONTACT_ROLE.screening_test, 'vet');
  assert.equal(defaultExpenseCategoryFor('screening_test'), 'veterinary');
  assert.equal(TEST_TYPES.includes('screening_test'), false);
  assert.deepEqual([...cloudDetailKeys('screening_test')].sort(), ['outcome', 'result', 'test', 'vet']);
});

test('the first form: something ticked, a dog, a date, a numeric cost for a visit', () => {
  const ok = { steps: ['visit', 'shots'], dogIds: ['a'], date: '2026-11-12' };
  assert.equal(V.careStepsProblem(ok), '');
  assert.ok(V.careStepsProblem({ ...ok, steps: [] }));
  assert.ok(V.careStepsProblem({ ...ok, dogIds: [] }));
  assert.ok(V.careStepsProblem({ ...ok, date: '' }));
  assert.ok(V.careStepsProblem({ ...ok, cost: 'abc' }));
  assert.equal(V.careStepsProblem({ ...ok, steps: ['shots'], cost: 'abc' }), '');
  assert.deepEqual(V.followUps(['medication', 'visit', 'screening', 'shots']), ['shots', 'screening', 'medication']);
});

test('shots: one vaccination per shot per dog, next due from the choice, a reminder when asked', () => {
  assert.equal(V.nextDueFrom('2026-11-12', '3w'), '2026-12-03');
  assert.equal(V.nextDueFrom('2026-11-12', '1y'), '2027-11-12');
  assert.equal(V.nextDueFrom('2026-11-12', ''), '');
  const rows = [{ vaccine: 'DHPP', nextDue: '3w' }, { vaccine: 'Rabies', nextDue: '' }];
  const events = V.vaccineEvents({ rows, dogIds: ['a', 'b'], date: '2026-11-12', lot: ' L1 ', remind: true });
  assert.equal(events.length, 4);
  const dhpp = events.find((e) => e.subject_id === 'b' && e.details.vaccine === 'DHPP');
  assert.deepEqual(dhpp, {
    subject_type: 'dog', subject_id: 'b', event_type: 'vaccination', event_date: '2026-11-12',
    reminder_date: '2026-12-03', title: 'DHPP', details: { vaccine: 'DHPP', lot_number: 'L1', next_due: '2026-12-03' }
  });
  const rabies = events.find((e) => e.details.vaccine === 'Rabies');
  assert.equal(rabies.reminder_date, undefined);
  assert.equal(rabies.details.next_due, undefined);
  assert.equal(V.vaccineEvents({ rows, dogIds: ['a'], date: '2026-11-12' })[0].reminder_date, undefined);
  // Her own title beside the vaccine; a blank one takes the vaccine.
  const [titled] = V.vaccineEvents({ rows: [{ vaccine: 'DHPP', title: ' Puppy shot #2 ' }], dogIds: ['a'], date: '2026-11-12' });
  assert.equal(titled.title, 'Puppy shot #2');
  assert.equal(titled.details.vaccine, 'DHPP');
  assert.equal(V.vaccineEvents({ rows: [{ vaccine: 'DHPP', title: '  ' }], dogIds: ['a'], date: '2026-11-12' })[0].title, 'DHPP');
  assert.ok(V.vaccineProblem({ rows: [], dogIds: ['a'], date: '2026-11-12' }));
  assert.ok(V.vaccineProblem({ rows: [{ vaccine: ' ' }], dogIds: ['a'], date: '2026-11-12' }));
  assert.ok(V.vaccineProblem({ rows, dogIds: [], date: '2026-11-12' }));
  assert.equal(V.vaccineProblem({ rows, dogIds: ['a'], date: '2026-11-12' }), '');
});

test('screening: one event per test per dog; a dog\'s own result wins over the one for all', () => {
  const tests = [
    { test: 'Fecal', result: 'Negative', outcome: 'Normal', perDog: { b: { result: 'Positive (giardia)', outcome: 'Abnormal' }, a: { result: '', outcome: '' } } },
    { test: 'Heartworm', result: '', outcome: '' }
  ];
  const events = V.screeningEvents({ tests, dogIds: ['a', 'b'], date: '2026-11-12', relatedContactId: 'vet1' });
  assert.equal(events.length, 4);
  const fa = events.find((e) => e.subject_id === 'a' && e.details.test === 'Fecal');
  assert.deepEqual(fa, {
    subject_type: 'dog', subject_id: 'a', event_type: 'screening_test', event_date: '2026-11-12',
    related_contact_id: 'vet1', title: 'Fecal', details: { test: 'Fecal', result: 'Negative', outcome: 'Normal' }
  });
  const fb = events.find((e) => e.subject_id === 'b' && e.details.test === 'Fecal');
  assert.deepEqual(fb.details, { test: 'Fecal', result: 'Positive (giardia)', outcome: 'Abnormal' });
  assert.deepEqual(events.find((e) => e.details.test === 'Heartworm').details, { test: 'Heartworm' });
  // Her own title beside the test's name; a blank one takes the name.
  const [titled] = V.screeningEvents({ tests: [{ test: 'Fecal', title: 'Annual fecal', result: 'Negative' }], dogIds: ['a'], date: '2026-11-12' });
  assert.equal(titled.title, 'Annual fecal');
  assert.equal(titled.details.test, 'Fecal');
  assert.equal(V.screeningProblem({ tests, dogIds: ['a'], date: '2026-11-12' }), '');
  assert.ok(V.screeningProblem({ tests: [], dogIds: ['a'], date: '2026-11-12' }));
  assert.ok(V.screeningProblem({ tests: [{ test: '' }], dogIds: ['a'], date: '2026-11-12' }));
  assert.ok(V.screeningProblem({ tests: [{ test: 'Fecal', outcome: 'Maybe' }], dogIds: ['a'], date: '2026-11-12' }));
});
