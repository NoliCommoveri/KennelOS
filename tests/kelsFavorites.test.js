// kelsFavorites.test.js — how her tasks move up Kels's "Doing Something" menu
// (data/kelsFavorites.js): unfinished, then starred, then used often, then priority.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from '../shared/data/kelsFavorites.js';

const today = '2026-10-15';
const t = (id, priority, extra = {}) => ({ id, priority, ...extra });
const ids = (rows) => rows.map((r) => r.task.id);
const days = (...n) => n.map((d) => {
  const x = new Date(`${today}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - d);
  return x.toISOString().slice(0, 10);
});

test('frequent: more than 3 starts in the last 60 days', () => {
  assert.equal(K.isFrequent(days(1, 2, 3), today), false);
  assert.equal(K.isFrequent(days(1, 2, 3, 59), today), true);
  assert.equal(K.isFrequent(days(1, 2, 3, 60), today), false); // the 60th day back is out
  assert.equal(K.isFrequent(undefined, today), false);
});

test('a start is logged and the window trimmed', () => {
  const uses = K.withStart({ a: days(70, 10) }, 'a', today);
  assert.deepEqual(uses.a, [...days(10), today]);
  assert.deepEqual(K.withStart({}, 'b', today), { b: [today] });
});

test('order: unfinished, starred, frequent, then priority; priority within each', () => {
  const tasks = [t('low', 10), t('high', 50), t('draft', 100, { unfinished: true }), t('star1', 20), t('star2', 30), t('often', 5)];
  const rows = K.orderTasks(tasks, { starred: ['star1', 'star2', 'draft'], uses: { often: days(1, 2, 3, 4) } }, today);
  assert.deepEqual(ids(rows), ['draft', 'star2', 'star1', 'often', 'high', 'low']);
  assert.deepEqual(rows.map((r) => [r.task.id, r.starred, r.frequent]).find((r) => r[0] === 'often'), ['often', false, true]);
});

test('a starred task isn\'t also "used often"; "Don\'t move this up" keeps one where its priority puts it', () => {
  const uses = { a: days(1, 2, 3, 4), b: days(1, 2, 3, 4) };
  const rows = K.orderTasks([t('a', 1), t('b', 2), t('c', 9)], { starred: ['a'], uses, noPromote: ['b'] }, today);
  assert.deepEqual(ids(rows), ['a', 'c', 'b']);
  assert.equal(rows[0].frequent, false);
  assert.equal(rows[2].frequent, false);
});

test('starring undoes "Don\'t move this up"; unstarring doesn\'t bring it back', () => {
  assert.deepEqual(K.withStar({ starred: [], noPromote: ['a'] }, 'a', true), { starred: ['a'], noPromote: [] });
  assert.deepEqual(K.withStar({ starred: ['a', 'b'], noPromote: [] }, 'a', false), { starred: ['b'], noPromote: [] });
  assert.deepEqual(K.withStar({ starred: ['a'] }, 'a', true).starred, ['a']); // no doubles
});
