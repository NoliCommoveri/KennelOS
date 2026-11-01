import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessTestType, testTypeFor, testPrefill, testEvent, unloggedPlanned } from '../shared/data/healthTestLog.js';
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
