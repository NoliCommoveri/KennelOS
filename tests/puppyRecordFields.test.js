// puppyRecordFields.test.js — the Puppy Record's per-kennel field picks
// (data/puppyRecordFields.js, guide §23): everything shows until unticked, a
// section's own box hides its fields, and only what's off is stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  puppyRecordShows, puppyRecordFieldsValue, healthKey,
  PUPPY_RECORD_FIELD_KEYS, PUPPY_RECORD_HEALTH_TYPES
} from '../shared/data/puppyRecordFields.js';

test('a kennel that never picked prints everything', () => {
  for (const k of [null, {}, { puppy_record_fields: null }]) {
    const shows = puppyRecordShows(k);
    for (const key of PUPPY_RECORD_FIELD_KEYS) assert.ok(shows(key), key);
  }
});

test('an unticked field is off, and a section off hides all its fields', () => {
  const shows = puppyRecordShows({ puppy_record_fields: { [healthKey('weight_check')]: false, buyer: false } });
  assert.equal(shows(healthKey('weight_check')), false);
  assert.ok(shows(healthKey('vaccination')));
  assert.equal(shows('buyer'), false);
  assert.equal(shows('buyerName'), false, 'off with its section');
  assert.ok(shows('callName'));
});

test('only the unticked keys are stored; all ticked stores null', () => {
  const all = Object.fromEntries(PUPPY_RECORD_FIELD_KEYS.map((k) => [k, true]));
  assert.equal(puppyRecordFieldsValue(all), null);
  assert.deepEqual(puppyRecordFieldsValue({ ...all, [healthKey('weight_check')]: false, bogus: false }),
    { [healthKey('weight_check')]: false });
});

test('every health type has a field, and the keys are unique', () => {
  for (const t of PUPPY_RECORD_HEALTH_TYPES) assert.ok(PUPPY_RECORD_FIELD_KEYS.includes(healthKey(t)), t);
  assert.equal(new Set(PUPPY_RECORD_FIELD_KEYS).size, PUPPY_RECORD_FIELD_KEYS.length);
});
