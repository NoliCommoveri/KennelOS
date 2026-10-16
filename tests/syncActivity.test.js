// syncActivity.test.js — live sync's activity list in words (Cloud Phase 2 plan
// §2.3), and what an open page does when pulled records arrive (§2.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordName, activityText } from '../shared/data/cloud/syncActivity.js';

test('records are named the way she knows them, or by kind', () => {
  assert.equal(recordName('dogs', { call_name: 'Birch', registered_name: 'CH Birch' }), 'Birch');
  assert.equal(recordName('kennels', { kennel_name: 'Oak Hill' }), 'Oak Hill');
  assert.equal(recordName('contacts', { name: '  Jen Smith ' }), 'Jen Smith');
  assert.equal(recordName('litters', null), 'a litter', 'gone here');
  assert.equal(recordName('mystery', {}), 'a record');
});

test('each kind of activity is one plain sentence', () => {
  assert.equal(activityText({ kind: 'kept_theirs' }, 'Birch', "Jen's laptop"),
    "Kept the version of Birch from Jen's laptop (the change here was older).");
  assert.match(activityText({ kind: 'kept_theirs' }, 'Birch'), /another device/);
  assert.match(activityText({ kind: 'archived_instead' }, 'Birch'), /archived instead/);
  assert.match(activityText({ kind: 'archived_instead' }, 'a kennel'), /^A kennel was deleted/, 'a sentence starts with a capital');
  assert.match(activityText({ kind: 'dropped', reason: 'record_too_large' }, 'Oak Hill'), /too large/);
  assert.match(activityText({ kind: 'dropped', reason: 'cloud_key:x' }, 'Oak Hill'), /refused/);
  assert.match(activityText({ kind: 'missing_file' }, 'a file'), /couldn't be downloaded/);
  assert.match(activityText({ kind: 'replaced_theirs' }, 'Birch'), /replaced one/);
});
