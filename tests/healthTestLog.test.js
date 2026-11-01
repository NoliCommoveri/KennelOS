import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessTestType, testTypeFor, testPrefill, testEvent, unloggedPlanned, completedTestsByDog } from '../shared/data/healthTestLog.js';
import { testTokensOf } from '../shared/data/eventRepo.js';

test('guessTestType: OFA / PennHIP, genetic, else breed-specific', () => {
  for (const n of ['OFA Hips', 'OFA Elbows', 'PennHIP', 'OFA Patella']) assert.equal(guessTestType(n), 'ofa_pennhip', n);
  for (const n of ['Embark panel', 'DNA profile', 'PRA-prcd', 'DM', 'Paw Print Genetics panel']) assert.equal(guessTestType(n), 'genetic_test', n);
  for (const n of ['Companion Animal Eye Exam (CAER)', 'BAER Hearing', 'Holter Monitor (ARVC)']) assert.equal(guessTestType(n), 'breed_specific_test', n);
});

test('testTypeFor: the kind she used for that test before wins over the guess', () => {
  const events = [
    { event_type: 'breed_specific_test', details: { test_name: 'OFA Patella' } },
    { event_type: 'breed_specific_test', details: { test_name: 'ofa patella ' } },
    { event_type: 'ofa_pennhip', details: { joint: 'OFA Patella' } },
    { event_type: 'genetic_test', details: { panel_name: 'OFA Patella' }, is_archived: true }
  ];
  assert.equal(testTypeFor('OFA Patella', events, testTokensOf), 'breed_specific_test');
  assert.equal(testTypeFor('OFA Hips', events, testTokensOf), 'ofa_pennhip', 'never logged: the guess');
});

test('the logged event carries the name in its kind\'s name field, so the planned test reads as logged', () => {
  for (const type of ['genetic_test', 'ofa_pennhip', 'breed_specific_test']) {
    const e = testEvent({ dogId: 'd1', name: ' OFA Patella ', type, date: '2026-10-30', result: ' Normal ', lab: 'Embark' });
    assert.deepEqual(testTokensOf(e), ['OFA Patella'], type);
    assert.equal(e.title, 'OFA Patella');
    assert.equal(e.event_date, '2026-10-30');
    assert.equal(e.details[type === 'ofa_pennhip' ? 'rating' : 'result'], 'Normal');
    assert.equal('lab' in e.details, type === 'genetic_test', 'a lab only where the kind has one');
    const dog = { id: 'd1', planned_tests: ['OFA Patella', 'BAER Hearing'] };
    assert.deepEqual(unloggedPlanned(dog, [e], testTokensOf), ['BAER Hearing']);
  }
  const blank = testEvent({ dogId: 'd1', name: 'BAER Hearing', type: 'breed_specific_test', date: '2026-10-30' });
  assert.deepEqual(blank.details, { test_name: 'BAER Hearing' }, 'no empty result or lab');
});

test('testPrefill: the Dog page\'s form opens on the test, its kind and today', () => {
  assert.deepEqual(testPrefill('OFA Hips', 'ofa_pennhip', '2026-11-01'),
    { event_type: 'ofa_pennhip', event_date: '2026-11-01', title: 'OFA Hips', details: { joint: 'OFA Hips' } });
});

test('unloggedPlanned: case and spacing ignored; an archived result doesn\'t count', () => {
  const dog = { id: 'd1', planned_tests: ['OFA Hips', 'Embark panel'] };
  const events = [
    { subject_type: 'dog', subject_id: 'd1', event_type: 'ofa_pennhip', details: { joint: 'ofa hips' } },
    { subject_type: 'dog', subject_id: 'd1', event_type: 'genetic_test', details: { panel_name: 'Embark panel' }, is_archived: true },
    { subject_type: 'dog', subject_id: 'd2', event_type: 'genetic_test', details: { panel_name: 'Embark panel' } }
  ];
  assert.deepEqual(unloggedPlanned(dog, events, testTokensOf), ['Embark panel']);
});

import { testMatchTokensOf } from '../shared/data/eventRepo.js';

test('unloggedPlanned: a result titled as the planned test counts even when Joint differs', () => {
  const dog = { id: 'd1', planned_tests: ['OFA Patella', 'OFA Hips'] };
  const e = { subject_type: 'dog', subject_id: 'd1', event_type: 'ofa_pennhip', title: 'OFA Patella', details: { joint: 'Patella', rating: 'Grade 1' } };
  assert.deepEqual(unloggedPlanned(dog, [e], testMatchTokensOf), ['OFA Hips']);
});

test('completedTestsByDog: name and result only, a retest replaces the result in place, blanks and archived skipped', () => {
  const ev = (id, dog, type, date, details, extra = {}) => ({ id, subject_type: 'dog', subject_id: dog, event_type: type, event_date: date, title: '', details, ...extra });
  const m = completedTestsByDog([
    ev('a', 'd1', 'ofa_pennhip', '2025-01-10', { joint: 'Hips', rating: 'Fair' }),
    ev('b', 'd1', 'genetic_test', '2025-02-01', { panel_name: 'PRA-prcd', result: 'Clear', lab: 'OptiGen' }),
    ev('c', 'd1', 'ofa_pennhip', '2026-01-10', { joint: 'hips', rating: 'Good' }),
    ev('c2', 'd1', 'ofa_pennhip', '2026-01-12', { method: 'OFA', joint: 'Elbows', rating: 'Normal' }),
    ev('d', 'd1', 'breed_specific_test', '2026-02-01', { test_name: 'CAER' }), // no result yet
    ev('e', 'd1', 'breed_specific_test', '2026-03-01', { result: 'Normal' }, { title: 'BAER Hearing' }), // name from the title
    ev('f', 'd1', 'genetic_test', '2026-04-01', { panel_name: 'DM', result: 'Carrier' }, { is_archived: true }),
    ev('g', 'd2', 'title_earned', '2026-01-01', { title_abbreviation: 'CH' }),
    { ...ev('h', 'd2', 'ofa_pennhip', '2026-01-01', { joint: 'Elbows', rating: 'Normal' }), subject_type: 'litter' }
  ]);
  assert.deepEqual(m.get('d1'), [{ name: 'hips', result: 'Good' }, { name: 'PRA-prcd', result: 'Clear' }, { name: 'OFA Elbows', result: 'Normal' }, { name: 'BAER Hearing', result: 'Normal' }]);
  assert.equal(m.has('d2'), false);
});
