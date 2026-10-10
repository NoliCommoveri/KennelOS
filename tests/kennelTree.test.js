// kennelTree.test.js — the whole-kennel family-tree layout (shared/data/kennelTree.js):
// families are connected components over sire/dam links, ancestors always sit
// above descendants, no two dogs in a row overlap, and bad data can't hang it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKennelTree, placeRow } from '../shared/data/kennelTree.js';

const dog = (id, extra = {}) => ({ id, call_name: id, sex: 'female', ...extra });

// Two founders → a litter of three; one daughter bred to an outside stud → a
// litter of two. Plus an unrelated second family and a dog with no relatives.
const kennel = [
  dog('Rex', { sex: 'male', date_of_birth: '2018-01-01' }),
  dog('Bella', { date_of_birth: '2018-06-01' }),
  dog('Ace', { sex: 'male', sire_id: 'Rex', dam_id: 'Bella', date_of_birth: '2020-03-01' }),
  dog('Cleo', { sire_id: 'Rex', dam_id: 'Bella', date_of_birth: '2020-03-01' }),
  dog('Dot', { sire_id: 'Rex', dam_id: 'Bella', date_of_birth: '2020-03-01' }),
  dog('Stud', { sex: 'male', date_of_birth: '2019-01-01' }),
  dog('Pup1', { sire_id: 'Stud', dam_id: 'Cleo' }),
  dog('Pup2', { sex: 'male', sire_id: 'Stud', dam_id: 'Cleo' }),
  dog('Max', { sex: 'male' }),
  dog('Mia', { sire_id: 'Max' }),
  dog('Solo')
];

const nodeMap = (fam) => new Map(fam.nodes.map((n) => [n.id, n]));

test('dogs group into families by sire/dam links; unrelated dogs are loners', () => {
  const { families, loners } = buildKennelTree(kennel);
  assert.equal(families.length, 2);
  assert.deepEqual(families[0].nodes.map((n) => n.id).sort(), ['Ace', 'Bella', 'Cleo', 'Dot', 'Pup1', 'Pup2', 'Rex', 'Stud']);
  assert.deepEqual(families[1].nodes.map((n) => n.id).sort(), ['Max', 'Mia']);
  assert.deepEqual(loners.map((d) => d.id), ['Solo']);
});

test('every parent sits above its offspring, and a bought-in stud sits beside his mate', () => {
  const [fam] = buildKennelTree(kennel).families;
  const m = nodeMap(fam);
  for (const n of fam.nodes) {
    for (const p of [n.dog.sire_id, n.dog.dam_id].filter((id) => m.has(id))) {
      assert.ok(m.get(p).gen < n.gen, `${p} above ${n.id}`);
    }
  }
  assert.equal(m.get('Rex').gen, 0);
  assert.equal(m.get('Stud').gen, m.get('Cleo').gen, 'founder drops to his mate\'s row');
  assert.equal(fam.rows, 3);
});

test('no two dogs in a row are closer than one slot', () => {
  for (const fam of buildKennelTree(kennel).families) {
    const rows = new Map();
    for (const n of fam.nodes) rows.set(n.gen, [...(rows.get(n.gen) || []), n.x]);
    for (const xs of rows.values()) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 1 - 1e-9);
    }
    assert.ok(Math.min(...fam.nodes.map((n) => n.x)) === 0);
  }
});

test('one union per sire × dam pair, single-parent unions when only one is known', () => {
  const [fam, fam2] = buildKennelTree(kennel).families;
  const keys = fam.unions.map((u) => u.key).sort();
  assert.deepEqual(keys, ['Rex|Bella', 'Stud|Cleo']);
  assert.deepEqual(fam.unions.find((u) => u.key === 'Rex|Bella').childIds.slice().sort(), ['Ace', 'Cleo', 'Dot']);
  assert.deepEqual(fam2.unions, [{ key: 'Max|', sireId: 'Max', damId: null, childIds: ['Mia'], waypoints: { Max: [] } }]);
});

test('pedigree-only ancestors are hidden unless asked for, and can join families', () => {
  const dogs = [
    dog('GrandSire', { sex: 'male', pedigree_only: true }),
    dog('A', { sire_id: 'GrandSire' }),
    dog('B', { sire_id: 'GrandSire' })
  ];
  const hidden = buildKennelTree(dogs);
  assert.equal(hidden.families.length, 0);
  assert.deepEqual(hidden.loners.map((d) => d.id), ['A', 'B']);
  const shown = buildKennelTree(dogs, { includePedigreeOnly: true });
  assert.equal(shown.families.length, 1, 'half-siblings join through the shared ancestor');
  assert.equal(shown.families[0].nodes.length, 3);
});

test('a parent generations above the litter gets a lane through every row between', () => {
  // Line-breeding: Old sires a daughter, then a granddaughter, then a pup on her.
  const dogs = [
    dog('Old', { sex: 'male' }), dog('Base'),
    dog('F1', { sire_id: 'Old', dam_id: 'Base' }),
    dog('F2', { sire_id: 'Old', dam_id: 'F1' }),
    dog('Pup', { sire_id: 'Old', dam_id: 'F2' }),
    // A row-mate for every generation, so lanes have to make room.
    dog('Sib1', { sire_id: 'Old', dam_id: 'Base' }), dog('Sib2', { sire_id: 'Old', dam_id: 'F1' })
  ];
  const [fam] = buildKennelTree(dogs).families;
  const u = fam.unions.find((x) => x.key === 'Old|F2');
  assert.deepEqual(u.waypoints.Old.map((w) => w.gen), [1, 2]);
  assert.deepEqual(u.waypoints.F2, []);
  for (let g = 0; g < fam.rows; g++) {
    const xs = [
      ...fam.nodes.filter((n) => n.gen === g).map((n) => n.x),
      ...fam.unions.flatMap((x) => Object.values(x.waypoints).flat()).filter((w) => w.gen === g).map((w) => w.x)
    ].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 1 - 1e-9, `row ${g}: a lane never shares a dog's slot`);
  }
});

test('a sire/dam cycle in bad data still lays out', () => {
  const { families } = buildKennelTree([dog('X', { sire_id: 'Y' }), dog('Y', { sex: 'male', sire_id: 'X' })]);
  assert.equal(families.length, 1);
  assert.equal(families[0].nodes.length, 2);
});

test('placeRow keeps order, enforces a one-slot gap, and stays near the wanted spots', () => {
  assert.deepEqual(placeRow([0, 0, 0]), [-1, 0, 1]);
  assert.deepEqual(placeRow([0, 5, 9]), [0, 5, 9]);
  assert.deepEqual(placeRow([2, 2.5]), [1.75, 2.75]);
});
