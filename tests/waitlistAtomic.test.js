// waitlistAtomic.test.js — K6-13: every waitlist action is one transaction. The tests'
// memory database runs a transaction straight through, so it can't catch an action
// left outside one, or a wrapper Dexie won't keep open; this reads the source instead.
// (Checked against real IndexedDB in Chromium when it was built: a plain-arrow scope
// lost the transaction after the first write, PrematureCommitError.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../shared/data/waitlistActions.js', import.meta.url), 'utf8');

// Read-only helpers: no writes, so no transaction.
const READ_ONLY = ['previewNextTurn', 'lostSaleFamilyFor', 'pickupWishesFor', 'backOutEntryFor', 'backOutMoney', 'soldBeforeWaitlistPlan'];

test('every exported waitlist action that writes runs through atomic()', () => {
  const plain = [...src.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);
  assert.deepEqual(plain.filter((n) => !READ_ONLY.includes(n)), [], 'a new action: wrap it in atomic(), or list it here as read-only');
  const wrapped = [...src.matchAll(/^export const (\w+) = atomic\(async function (\w+)\(/gm)];
  assert.ok(wrapped.length > 60);
  for (const [, a, b] of wrapped) assert.equal(a, b, 'the wrapped function keeps its name');
});

test('the transaction scope is an async function, over every data table', () => {
  assert.match(src, /function atomic\(fn\) \{\n {2}return \(\.\.\.args\) => db\.transaction\('rw', dataTables\(\), async \(\) => await fn\(\.\.\.args\)\);\n\}/);
});
