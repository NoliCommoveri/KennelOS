// kelsUnderstand.test.js — Kels's "Understanding Something": the FAQ entries
// (data/kelsUnderstand.js), gated per edition, and searched with kelsFind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { ENTRIES, SECTIONS, understandEntries, understandSections, understandCandidates } from '../shared/data/kelsUnderstand.js';
import { search, clearWinner } from '../shared/data/kelsFind.js';
import { isProOnlyPage } from '../shared/data/proPages.js';

// An edition's flags, read from its source: lite/ and pro/ editionConfig.js
// import their edition's paths, so they can't be imported here (editionConfig.test.js).
function flagsOf(path) {
  const src = readFileSync(new URL(path, import.meta.url), 'utf8');
  const start = src.indexOf('export const editionFlags = {');
  const block = src.slice(start, src.indexOf('\n};', start));
  return Object.fromEntries([...block.replace(/\/\/.*$/gm, '').matchAll(/([A-Za-z_]\w*)\s*:\s*(true|false)/g)].map(([, k, v]) => [k, v === 'true']));
}
const PRO = flagsOf('../pro/editionConfig.js');
const LITE = flagsOf('../lite/editionConfig.js');

const pro = (opts = {}) => understandEntries({ edition: 'pro', flags: PRO, cloud: true, vault: true, online: true, ...opts });
const lite = (opts = {}) => understandEntries({ edition: 'lite', flags: LITE, cloud: true, vault: false, ...opts });
const ask = (entries, q) => search(understandCandidates(entries), q);
const top = (entries, q) => clearWinner(ask(entries, q).hits)?.c.entry.id || ask(entries, q).hits[0]?.c.entry.id;

test('entries: unique ids, a known section, a question, keywords; every flag is a real edition flag', () => {
  const ids = ENTRIES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  const sections = new Set(SECTIONS.map((s) => s.id));
  for (const e of ENTRIES) {
    assert.ok(sections.has(e.section), e.id);
    assert.ok(e.q.endsWith('?'), `${e.id} asks a question`);
    assert.ok(e.keywords.length, `${e.id} has keywords`);
    if (e.flag) assert.ok(e.flag in PRO && e.flag in LITE, `${e.id}: ${e.flag}`);
    if (e.href) assert.ok(e.show, `${e.id} names its Show me`);
  }
});

test('answers: plain sentences, worked out in every edition, no field names', () => {
  for (const entries of [pro(), lite(), pro({ cloud: false, vault: false })]) {
    for (const e of entries) {
      assert.equal(typeof e.a, 'string', e.id);
      assert.ok(e.a.length > 40 && /[.!]$/.test(e.a), `${e.id} is a sentence`);
      assert.ok(!/undefined|null|_id\b|[a-z]+_[a-z]+/.test(e.a), `${e.id} says no field names`);
    }
  }
});

test('every Show me page exists and is precached; Lite has no Pro pages', () => {
  const sw = readFileSync(new URL('../shared/sw.js', import.meta.url), 'utf8');
  for (const e of pro()) {
    if (!e.href) continue;
    const page = e.href.split(/[?#]/)[0];
    assert.ok(existsSync(new URL(`../shared/pages/${page}`, import.meta.url)), page);
    assert.ok(sw.includes(`'pages/${page}'`), `${page} precached`);
  }
  for (const e of lite()) if (e.href) assert.ok(!isProOnlyPage(e.href.split(/[?#]/)[0]), e.href);
});

test('Lite: no waitlist, stud, foster or Companion topics; its own way out for a dog; no limit topic', () => {
  const l = lite();
  const ids = new Set(l.map((e) => e.id));
  assert.ok(![...ids].some((id) => id.startsWith('wl-')));
  for (const id of ['our-stud', 'stud-fee', 'foster-money', 'companion-link', 'kennel-scope', 'owner-needed', 'archive-dog', 'processing-fee']) assert.ok(!ids.has(id), id);
  for (const id of ['remove-dog', 'pedigree-only']) assert.ok(ids.has(id), id);
  assert.match(l.find((e) => e.id === 'gone-home').a, /remove the pup from your program/);
  assert.doesNotMatch(l.find((e) => e.id === 'add-income').a, /stud|waitlist/);
  assert.ok(!l.some((e) => /\blimit\b|\bcap\b|upgrade/i.test(e.a)), 'no word on the limit');
  assert.ok(!l.some((e) => /archiv/i.test(e.q + e.a + (e.show || ''))), 'Lite never says archive');
  assert.ok(!understandSections(l, LITE).some((s) => /archiv/i.test(s.label)), 'nor does a Lite topic');
  assert.ok(!understandCandidates(l, LITE).some((c) => /archiv/i.test(c.group)));
  assert.equal(understandSections(pro(), PRO).find((s) => s.id === 'removing').label, 'Archiving and deleting');
  assert.ok(ids.has('mistake-money') && !ids.has('archive-money'), 'Lite asks how to take out a mistake instead');
  assert.ok(!pro().some((e) => e.id === 'mistake-money'));
  assert.ok(!understandSections(l).some((s) => s.id === 'waitlist'), 'no empty topic');
});

test('Pro: the gone-home pup goes External; income names every source; no cloud, no cloud topics', () => {
  const p = pro();
  assert.match(p.find((e) => e.id === 'gone-home').a, /External with the family as its owner/);
  assert.match(p.find((e) => e.id === 'add-income').a, /your sales, stud fees you earned and waitlist fees/);
  assert.match(p.find((e) => e.id === 'add-income').a, /edit the sale, stud service or waitlist family it comes from/);
  assert.match(p.find((e) => e.id === 'earned').a, /Completed.*received/);
  const offline = new Set(pro({ cloud: false, online: false }).map((e) => e.id));
  assert.ok(!offline.has('cloud-device') && !offline.has('wl-online'));
  assert.doesNotMatch(pro({ cloud: false }).find((e) => e.id === 'where-data').a, /cloud/);
});

test('search looks at the questions: her words find the one she means', () => {
  const p = pro();
  assert.equal(top(p, 'why is this family fourth'), 'wl-position');
  assert.equal(top(p, 'how do I add income'), 'add-income');
  assert.equal(top(p, 'cancelled sale deposit'), 'sale-ended');
  assert.equal(top(p, 'keeping a puppy'), 'keeping-puppy');
  assert.equal(top(p, 'merge or replace'), 'merge-replace');
  assert.equal(ask(p, 'zebra').hits.length, 0);
});
