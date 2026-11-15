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
  assert.equal(activityText({ kind: 'kept_theirs', op: 'put' }, 'Birch', "Jen's laptop"),
    "Birch was changed on Jen's laptop while your change here was waiting to be sent. Jen's laptop's version was kept.");
  assert.match(activityText({ kind: 'kept_theirs' }, 'Birch'), /another device/);
  assert.doesNotMatch(activityText({ kind: 'kept_theirs' }, 'Birch'), /older/, 'never says why (K03, 10)');
  assert.match(activityText({ kind: 'kept_theirs', op: 'delete' }, 'Birch'), /deleted on another device/);
  assert.match(activityText({ kind: 'kept_theirs', reason: 'older' }, 'Birch'), /later date/, 'a join decides by date, and says so');
  assert.equal(activityText({ kind: 'replaced_mine', op: 'put' }, 'Birch', 'Laptop B'),
    'Your change to Birch was replaced by one from Laptop B, which hadn\'t yet seen it.');
  assert.match(activityText({ kind: 'replaced_mine', op: 'delete' }, 'Birch', 'Laptop B'), /^Birch was deleted on Laptop B/);
  assert.match(activityText({ kind: 'clock', where: 'here' }, 'Birch'), /this device's date/);
  assert.match(activityText({ kind: 'clock', where: 'there' }, 'Birch'), /other devices/);
  assert.match(activityText({ kind: 'needs_update', tbl: 'new_table', id: null }, 'a record'), /newer version of KennelOS/);
  assert.match(activityText({ kind: 'archived_instead' }, 'Birch'), /archived instead/);
  assert.match(activityText({ kind: 'archived_instead' }, 'a kennel'), /^A kennel was deleted/, 'a sentence starts with a capital');
  assert.match(activityText({ kind: 'dropped', reason: 'record_too_large' }, 'Oak Hill'), /too large/);
  assert.match(activityText({ kind: 'dropped', reason: 'cloud_key:x' }, 'Oak Hill'), /refused/);
  assert.match(activityText({ kind: 'missing_file' }, 'a file'), /couldn't be downloaded/);
  assert.doesNotMatch(activityText({ kind: 'missing_file' }, 'a file'), /next time it changes/, 'files never change (K03, 5)');
  assert.match(activityText({ kind: 'replaced_theirs' }, 'Birch', 'Phone A'), /replaced one from Phone A/);
  assert.doesNotMatch(activityText({ kind: 'replaced_theirs' }, 'Birch'), /a moment before/);
});
