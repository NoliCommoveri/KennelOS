// pedigreeParse.test.js — the pedigree chart layout reader (data/pedigreeParse.js),
// on a synthetic AKC-style chart built here (made-up dogs, real layout rules: one
// column per generation, each box centred between its two parents' boxes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wordsToSegments, parsePedigree, isAkcReg, isOtherReg, isColorOnly, isDetail, parseDetails, splitTitles
} from '../shared/data/pedigreeParse.js';

// A chart of `gens` ancestor generations. Each box: name line, then reg, then color.
// Returns positioned "words" the way the PDF reader hands them over (one per run).
function chart({ gens = 3, dogBox = true, page = { width: 1000, height: 800 } } = {}) {
  const words = [];
  const put = (text, x, y, h = 8) => words.push({ text, x, y, w: text.length * h * 0.5, h });
  put('THE AMERICAN KENNEL CLUB', 20, 10, 12);
  put('Parents', 220, 40); put('Grandparents', 420, 40); put('Great-Grandparents', 620, 40);
  put('Breed/Variety: Test Terrier', 20, 52); put('Sex: Female', 20, 62); put('Birth Date: 03/04/2022', 160, 62);
  put('Breeder(s): Jo Breeder', 20, 72);
  const top = 90; const bottom = 780;
  const name = (path) => `Dog ${path.toUpperCase()}`;
  let n = 100000;
  const box = (path, g, slot) => {
    const span = (bottom - top) / 2 ** g;
    const cy = top + span * (slot + 0.5);
    const x = 20 + g * 200;
    put(name(path || 'root'), x, cy - 12);
    put(`NP${n++}/0${g} 01-20`, x, cy - 2, 6);
    put('Black & White', x, cy + 6, 6);
  };
  const walk = (path, g, slot) => {
    if (g > 0 || dogBox) box(path, g, slot);
    if (g === gens) return;
    walk(`${path}s`, g + 1, slot * 2);
    walk(`${path}d`, g + 1, slot * 2 + 1);
  };
  walk('', 0, 0);
  return { words, page };
}

test('every box lands on its path, with sex from position', () => {
  const { words, page } = chart();
  const r = parsePedigree(wordsToSegments(words), page);
  assert.equal(r.generations, 3);
  assert.equal(r.dogs.size, 15);
  for (const [path, d] of r.dogs) {
    if (path) assert.equal(d.registered_name, `Dog ${path.toUpperCase()}`, path);
    if (path) assert.equal(d.sex, path.endsWith('s') ? 'male' : 'female');
    assert.match(d.registration_number, /^NP\d{6}\/\d{2} 01-20$/, 'the four digits after the number are kept');
    assert.equal(d.registry, 'AKC');
    assert.equal(d.color_markings, 'Black & White');
  }
  assert.deepEqual(r.warnings, []);
});

test('the header supplies breed, sex, birth date and breeder for the dog', () => {
  const { words, page } = chart();
  const r = parsePedigree(wordsToSegments(words), page);
  assert.equal(r.header.breed, 'Test Terrier');
  const dog = r.dogs.get('');
  assert.equal(dog.sex, 'female');
  assert.equal(dog.date_of_birth, '2022-03-04');
  assert.ok(dog.notes.includes('Breeder: Jo Breeder'));
});

test('an unreadable dog box falls back to the header and keeps the parents in place', () => {
  const { words, page } = chart({ dogBox: false });
  words.push({ text: 'Name: Dog Root', x: 20, y: 82, w: 60, h: 8 });
  const r = parsePedigree(wordsToSegments(words), page);
  assert.equal(r.dogs.get('').registered_name, 'Dog Root');
  assert.equal(r.dogs.get('s').registered_name, 'Dog S');
  assert.equal(r.dogs.get('dd').registered_name, 'Dog DD');
  assert.equal(r.dogs.size, 15);
});

test('no registrations anywhere means no chart', () => {
  const r = parsePedigree(wordsToSegments([{ text: 'Hello there', x: 10, y: 100, w: 50, h: 8 }]), { width: 500, height: 500 });
  assert.equal(r.dogs.size, 0);
  assert.equal(r.warnings.length, 1);
});

test('segments: a line is read left to right and columns stay apart', () => {
  const segs = wordsToSegments([
    { text: 'Oklahoma', x: 60, y: 101, w: 40, h: 8 }, { text: 'Of', x: 45, y: 100, w: 10, h: 8 },
    { text: 'Elliot', x: 10, y: 102, w: 30, h: 8 }, { text: 'Far', x: 400, y: 100, w: 20, h: 8 }
  ]);
  assert.deepEqual(segs.map((s) => s.text), ['Elliot Of Oklahoma', 'Far']);
});

test('line classifiers', () => {
  assert.ok(isAkcReg('NP888072/07 03-25'));
  assert.ok(isAkcReg('NPS60004/04'), 'OCR letter-for-digit swap');
  assert.ok(!isAkcReg('Champagne Dawn'));
  for (const t of ['MET BOST.T.915/19', 'PKR IX-75080', 'KCSB 3847CY', 'ACR A 394-22/140', 'KSS JR 71592 BST']) assert.ok(isOtherReg(t), t);
  for (const t of ['Gold Gelb Box Tamir', 'CH Dorkay\'s Hot', 'Blue Angel IV']) assert.ok(!isOtherReg(t), t);
  assert.ok(isColorOnly('Black Brindle & White'));
  for (const t of ['Blue Angel IV', 'Champagne Dawn', 'Terray\'s Blue Trigger']) assert.ok(!isColorOnly(t), t);
  for (const t of ['AKC DNA V10117423', 'CHIC62826', '(Romania)', 'V10117423', '08-23']) assert.ok(isDetail(t), t);
  assert.ok(!isDetail('Bojangle VI'));
});

test('details: registration, color, DNA and country', () => {
  const d = parseDetails(['NP165114/01 08-08 (Canada)', 'Black Brindle & White', 'AKC DNA V516516']);
  assert.equal(d.registration_number, 'NP165114/01 08-08');
  assert.equal(d.registry, 'AKC');
  assert.equal(d.color_markings, 'Black Brindle & White');
  assert.deepEqual(d.notes, ['Registered in Canada', 'AKC DNA V516516']);
  const f = parseDetails(['MET BOST.T.915/19']);
  assert.equal(f.registry, 'MET');
  assert.equal(f.registration_number, 'MET BOST.T.915/19');
  assert.equal(parseDetails(['NPS60004/04 02-21']).registration_number, 'NP560004/04 02-21');
  assert.equal(parseDetails(['NP888072/07 03/25']).registration_number, 'NP888072/07 03/25', 'kept as printed');
  assert.equal(parseDetails(['NP165114/01']).registration_number, 'NP165114/01');
});

test('titles come off the front of a name', () => {
  assert.deepEqual(splitTitles('CH Crazy Crys Key'), { name: 'Crazy Crys Key', titles: ['CH'] });
  assert.deepEqual(splitTitles('GCH. CH Dog'), { name: 'Dog', titles: ['GCH', 'CH'] });
  assert.deepEqual(splitTitles('Chester'), { name: 'Chester', titles: [] });
});

// An AKC Certified Pedigree: unslashed numbers with the date in brackets,
// abbreviated colors, details run on as one wrapped paragraph, and the dog's box
// in the parents' column between its sire and dam, under "Sire" / "Dam" labels.
function certified() {
  const words = [];
  const put = (text, x, y, h = 8) => words.push({ text, x, y, w: text.length * h * 0.5, h });
  put('AMERICAN KENNEL CLUB · FOUNDED 1884', 20, 10, 12);
  put('Certified Pedigree', 20, 26, 14);
  const top = 60; const bottom = 780;
  let n = 10000000;
  const box = (path, g, slot) => {
    const span = (bottom - top) / 2 ** g;
    const x = 20 + Math.max(0, g - 1) * 220;
    // Parents sit in the first column, a quarter of the page from each end.
    const cy = g === 1 ? top + (bottom - top) * (slot ? 0.8 : 0.2) : top + span * (slot + 0.5);
    put(`DOG ${path.toUpperCase() || 'ROOT'}`, x, cy - 12);
    put(`NP${n++} (05-24) OFA46G BLK BRDL &`, x, cy - 3, 6);
    put('WH AKC DNA V627089', x, cy + 4, 6);
    if (path === 's') put('Sire', 0, cy + 14);
    if (path === 'd') put('Dam', 0, cy + 14);
  };
  const walk = (path, g, slot) => {
    if (g) box(path, g, slot);
    if (g === 3) return;
    walk(`${path}s`, g + 1, slot * 2);
    walk(`${path}d`, g + 1, slot * 2 + 1);
  };
  walk('', 0, 0);
  put("DASH'N DARLIN'S ADORE MI'AMOR", 20, 405);
  put('NP95797004', 26, 414, 6);
  put('BOSTON TERRIER FEMALE BRDL & WH', 26, 421, 6);
  put('Microchip: 900263007514602', 26, 426, 6);
  put('Date Whelped: 01/20/2025', 26, 433, 6);
  put('Breeder: JAMIE COTTON', 26, 440, 6);
  return { words, page: { width: 1000, height: 800 } };
}

test('an AKC Certified Pedigree: dog between its parents, unslashed numbers, abbreviations', () => {
  const { words, page } = certified();
  const r = parsePedigree(wordsToSegments(words), page);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.dogs.size, 15);
  const dog = r.dogs.get('');
  assert.equal(dog.registered_name, "DASH'N DARLIN'S ADORE MI'AMOR");
  assert.equal(dog.registration_number, 'NP957970/04');
  assert.equal(dog.sex, 'female');
  assert.equal(dog.date_of_birth, '2025-01-20');
  assert.equal(dog.microchip_id, '900263007514602');
  assert.equal(dog.color_markings, 'Brindle & White');
  assert.ok(dog.notes.includes('Breeder: JAMIE COTTON'));
  assert.equal(r.header.breed, 'Boston Terrier');
  for (const [path, d] of r.dogs) {
    if (!path) continue;
    assert.equal(d.registered_name, `DOG ${path.toUpperCase()}`, path);
    assert.match(d.registration_number, /^NP\d{6}\/\d{2} 05-24$/);
    assert.equal(d.registry, 'AKC');
    assert.equal(d.color_markings, 'Black Brindle & White');
    assert.deepEqual(d.notes, ['OFA46G', 'AKC DNA V627089']);
  }
});

test('certified details: run-on paragraph, country, CHIC, a bare trailing AKC', () => {
  const d = parseDetails(['NP78894701 (04-23) BLK BRDL & WH', '(SRB) AKC DNA V10076593']);
  assert.equal(d.registration_number, 'NP788947/01 04-23');
  assert.equal(d.color_markings, 'Black Brindle & White');
  assert.deepEqual(d.notes, ['Registered in SRB', 'AKC DNA V10076593']);
  const c = parseDetails(['NP03255104 (01-05) CHIC19082 BLK BRDL & WH AKC', 'DNA V324746']);
  assert.equal(c.color_markings, 'Black Brindle & White');
  assert.deepEqual(c.notes, ['CHIC19082', 'AKC DNA V324746']);
  assert.equal(parseDetails(['NP37883405 (04-16) SL & WH']).color_markings, 'Seal & White');
  assert.ok(isAkcReg('NP95797004'));
  assert.ok(!isAkcReg('V10142513'));
});

test('a name with digits in it ("MRF WIGGLES BLUE 17 50-3") starts its own box', () => {
  const { words, page } = chart();
  // Rename two boxes to all-caps names with digits, the kind that read like a detail.
  for (const w of words) {
    if (w.text === 'Dog SDD') w.text = 'MRF WIGGLES BLUE 17 50-3';
    if (w.text === 'Dog DS') w.text = 'MRF WILBER 13 12-2';
  }
  const r = parsePedigree(wordsToSegments(words), page);
  assert.equal(r.dogs.size, 15);
  assert.equal(r.dogs.get('sdd').registered_name, 'MRF WIGGLES BLUE 17 50-3');
  assert.equal(r.dogs.get('ds').registered_name, 'MRF WILBER 13 12-2');
  assert.equal(r.dogs.get('sd').registered_name, 'Dog SD', 'the box above keeps only its own lines');
  assert.deepEqual(r.warnings, []);
});
