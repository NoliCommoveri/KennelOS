// eventRepo.test.js — testTokensOf, the pure derivation of a test event's
// "test name" token(s) (data/eventRepo.js). It feeds the health-test planning
// match, where the three test-bearing types carry the name at different grains.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testTokensOf } from '../shared/data/eventRepo.js';

test('genetic_test: token is the panel name', () => {
  assert.deepEqual(testTokensOf({ event_type: 'genetic_test', details: { panel_name: 'Embark' } }), ['Embark']);
});

test('breed_specific_test: token is the test name', () => {
  assert.deepEqual(testTokensOf({ event_type: 'breed_specific_test', details: { test_name: 'PRA' } }), ['PRA']);
});

test('ofa_pennhip: method and joint combine into one token', () => {
  assert.deepEqual(testTokensOf({ event_type: 'ofa_pennhip', details: { method: 'OFA', joint: 'Hips' } }), ['OFA Hips']);
  // Either half alone still yields a single trimmed token.
  assert.deepEqual(testTokensOf({ event_type: 'ofa_pennhip', details: { joint: 'Elbows' } }), ['Elbows']);
});

test('token names are trimmed, and empty/missing data yields no tokens', () => {
  assert.deepEqual(testTokensOf({ event_type: 'genetic_test', details: { panel_name: '  Embark  ' } }), ['Embark']);
  assert.deepEqual(testTokensOf({ event_type: 'genetic_test', details: {} }), []);
  assert.deepEqual(testTokensOf({ event_type: 'genetic_test' }), []);
  assert.deepEqual(testTokensOf({ event_type: 'ofa_pennhip', details: {} }), []);
});

test('a non-test event type never contributes a token', () => {
  assert.deepEqual(testTokensOf({ event_type: 'vaccination', details: { panel_name: 'x' } }), []);
  assert.deepEqual(testTokensOf({ event_type: 'note', details: {} }), []);
});
