// pedigreeWalk.test.js — a dog's ancestors for her website's lineage section:
// nearest first, sire's side first, four generations at most, a loop in the data
// stops its line, line breeding lists a dog at each place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ancestorsOf, MAX_GENERATIONS } from '../shared/data/pedigreeWalk.js';

const byId = (dogs) => new Map(dogs.map((d) => [d.id, d]));
const paths = (list) => list.map((a) => `${a.path}=${a.dog.id}`);

test('nearest first, sire before dam, with each path', () => {
  const dogs = [
    { id: 'pup', sire_id: 's', dam_id: 'd' },
    { id: 's', sire_id: 'ss', dam_id: 'sd' },
    { id: 'd', dam_id: 'dd' },
    { id: 'ss' }, { id: 'sd' }, { id: 'dd' }
  ];
  const list = ancestorsOf(dogs[0], byId(dogs));
  assert.deepEqual(paths(list), ['sire=s', 'dam=d', 'sire.sire=ss', 'sire.dam=sd', 'dam.dam=dd']);
  assert.deepEqual(list.map((a) => a.generation), [1, 1, 2, 2, 2]);
});

test('four generations at most: 30 places for a full pedigree', () => {
  const dogs = [];
  const make = (id, depth) => {
    const d = { id };
    dogs.push(d);
    if (depth < 6) { d.sire_id = make(`${id}s`, depth + 1).id; d.dam_id = make(`${id}d`, depth + 1).id; }
    return d;
  };
  const root = make('x', 0);
  const list = ancestorsOf(root, byId(dogs));
  assert.equal(MAX_GENERATIONS, 4);
  assert.equal(list.length, 30);
  assert.equal(Math.max(...list.map((a) => a.generation)), 4);
  assert.equal(ancestorsOf(root, byId(dogs), { generations: 9 }).length, 30, 'never past the cap');
  assert.equal(ancestorsOf(root, byId(dogs), { generations: 1 }).length, 2);
});

test('a loop in the data stops its line; line breeding lists a dog at each place; a missing parent ends a line', () => {
  const loop = [{ id: 'a', sire_id: 'b' }, { id: 'b', sire_id: 'a' }];
  assert.deepEqual(paths(ancestorsOf(loop[0], byId(loop))), ['sire=b']);
  const self = [{ id: 'a', sire_id: 'a' }];
  assert.deepEqual(ancestorsOf(self[0], byId(self)), []);
  const lineBred = [{ id: 'pup', sire_id: 's', dam_id: 'd' }, { id: 's', sire_id: 'g' }, { id: 'd', sire_id: 'g' }, { id: 'g' }];
  assert.deepEqual(paths(ancestorsOf(lineBred[0], byId(lineBred))), ['sire=s', 'dam=d', 'sire.sire=g', 'dam.sire=g']);
  assert.deepEqual(paths(ancestorsOf({ id: 'p', sire_id: 'gone' }, byId([]))), []);
  assert.deepEqual(ancestorsOf(null, byId([])), []);
});
