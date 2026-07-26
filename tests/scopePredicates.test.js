// scopePredicates.test.js — the active-kennel read predicates (Multi-Kennel Scope
// Spec §7). These decide, for every list / hub / report in the app, whether a
// record is shown at all. §7 calls a silently hidden record far worse than a
// missing filter, so the two directions that matter most are pinned here: nothing
// is hidden when unscoped, and nothing scope-transparent is ever hidden.
//
// data/scopePredicates.js is deliberately db-free (spec §16) precisely so this
// file can exist — the bound wrappers in data/kennelScope.js reach Dexie and
// localStorage and remain untestable in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCOPED_OWNERSHIP,
  isOwnedByUser,
  inScopeOf,
  dogInScopeOf,
  subjectInScopeOf,
} from '../shared/data/scopePredicates.js';

const A = 'kennel-a';
const B = 'kennel-b';

const dog = (over = {}) => ({ id: 'd1', ownership_type: 'owned', kennel_id: A, ...over });
const rec = (over = {}) => ({ id: 'r1', kennel_id: A, ...over });

// --- Unscoped: the filter must be a no-op ----------------------------------

test('with no active kennel, everything is in scope', () => {
  for (const activeId of [null, undefined, '']) {
    assert.equal(inScopeOf(activeId, rec({ kennel_id: B })), true);
    assert.equal(inScopeOf(activeId, rec({ kennel_id: null })), true);
    assert.equal(dogInScopeOf(activeId, dog({ kennel_id: B })), true);
    assert.equal(subjectInScopeOf(activeId, 'dog', 'nope', {}), true);
  }
});

// --- The plain stamped-record rule -----------------------------------------

test('a stamped record is in scope only under its own kennel', () => {
  assert.equal(inScopeOf(A, rec({ kennel_id: A })), true);
  assert.equal(inScopeOf(A, rec({ kennel_id: B })), false);
});

test('a record with no kennel is out of scope while scoped', () => {
  // Every scoped table requires kennel_id on create (spec §4.3), so this should
  // not occur — but if it ever does it must not masquerade as "belongs here".
  assert.equal(inScopeOf(A, rec({ kennel_id: null })), false);
  assert.equal(inScopeOf(A, undefined), false);
});

test('an explicitly transparent record is in scope everywhere', () => {
  assert.equal(inScopeOf(A, rec({ kennel_id: B }), { transparent: true }), true);
});

// --- Dogs: ownership decides transparency (spec §3.1a) ---------------------

test('SCOPED_OWNERSHIP is exactly owned + co_owned', () => {
  assert.deepEqual([...SCOPED_OWNERSHIP].sort(), ['co_owned', 'owned']);
  assert.equal(isOwnedByUser(dog({ ownership_type: 'co_owned' })), true);
  assert.equal(isOwnedByUser(dog({ ownership_type: 'external' })), false);
  assert.equal(isOwnedByUser(null), false);
});

test('an owned dog follows its kennel', () => {
  assert.equal(dogInScopeOf(A, dog({ ownership_type: 'owned', kennel_id: A })), true);
  assert.equal(dogInScopeOf(A, dog({ ownership_type: 'owned', kennel_id: B })), false);
  assert.equal(dogInScopeOf(A, dog({ ownership_type: 'co_owned', kennel_id: B })), false);
});

test('external and leased-in dogs are scope-transparent under every kennel', () => {
  // The load-bearing case: an outside stud's kennel_id names SOMEBODY ELSE'S
  // kennel. Matching it against an own kennel would hide him from every scope,
  // breaking pedigree and stud-service workflows (spec §3.1a/§7).
  for (const ownership of ['external', 'leased_in']) {
    assert.equal(dogInScopeOf(A, dog({ ownership_type: ownership, kennel_id: B })), true);
    assert.equal(dogInScopeOf(A, dog({ ownership_type: ownership, kennel_id: null })), true);
  }
});

// --- Polymorphic subjects: events and expenses (spec §4.1) -----------------

const maps = (over = {}) => ({
  dog: new Map([['d-a', dog({ id: 'd-a', kennel_id: A })],
                ['d-b', dog({ id: 'd-b', kennel_id: B })],
                ['d-ext', dog({ id: 'd-ext', ownership_type: 'external', kennel_id: B })]]),
  litter: new Map([['l-a', rec({ id: 'l-a', kennel_id: A })],
                   ['l-b', rec({ id: 'l-b', kennel_id: B })]]),
  pairing: new Map([['p-b', rec({ id: 'p-b', kennel_id: B })]]),
  ...over
});

test('a subject-bearing row takes its subject\'s scope', () => {
  assert.equal(subjectInScopeOf(A, 'dog', 'd-a', maps()), true);
  assert.equal(subjectInScopeOf(A, 'dog', 'd-b', maps()), false);
  assert.equal(subjectInScopeOf(A, 'litter', 'l-a', maps()), true);
  assert.equal(subjectInScopeOf(A, 'litter', 'l-b', maps()), false);
  assert.equal(subjectInScopeOf(A, 'pairing', 'p-b', maps()), false);
});

test('a dog subject goes through the transparent dog rule, not the plain one', () => {
  // An event or a boarding cost logged against an outside stud must stay visible.
  assert.equal(subjectInScopeOf(A, 'dog', 'd-ext', maps()), true);
});

test('a kennel-subject expense IS its kennel', () => {
  assert.equal(subjectInScopeOf(A, 'kennel', A, maps()), true);
  assert.equal(subjectInScopeOf(A, 'kennel', B, maps()), false);
});

test('an unresolvable subject is shown, never silently dropped', () => {
  // §7: a silently hidden record is far worse than a missing filter. This is also
  // why callers must build their id→record maps from UNSCOPED loads — a
  // pre-filtered map would make every other kennel's rows look unresolvable and
  // let them all through.
  assert.equal(subjectInScopeOf(A, 'dog', 'ghost', maps()), true);
  assert.equal(subjectInScopeOf(A, 'litter', 'ghost', maps()), true);
  assert.equal(subjectInScopeOf(A, 'dog', 'd-a', {}), true);
  assert.equal(subjectInScopeOf(A, 'nonsense', 'x', maps()), true);
});
