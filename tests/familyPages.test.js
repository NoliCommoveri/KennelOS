// familyPages.test.js — the waitlist's family pages (cloud/public/family, W2 Plan
// §3) aren't part of the app and can't import it, so they carry copies of a few
// vocab labels. This fails if a copy drifts from shared/data/vocab.js, and pins
// the pages' small pure helpers (search, dates, possessives).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  SEX_LABEL, READY_LABEL, PURPOSE_LABEL, purposesText, CREDIT_LABEL, rowMatches, fmtDate, possessive, publicListHtml, esc,
  parentsLine, upcomingItemHtml, availableItemHtml, photosLink, pupColumnsHtml, dogInfo, dogInfoHtml, infoBubble
} from '../cloud/public/family/common.js';
import { WAITLIST_PREF_SEX, WAITLIST_READY_TIMING, PLACEMENT_PURPOSE, FEE_CREDIT_POLICY } from '../shared/data/vocab.js';
import { ACTION_VOCAB } from '../cloud/src/familyActions.js';
import { DECIDING_LABEL as SERVER_DECIDING } from '../cloud/src/familyPages.js';
import { DECIDING_LABEL } from '../shared/data/waitlistRules.js';

const asMap = (vocab) => Object.fromEntries(vocab.map((v) => [v.value, v.label]));

test("the family pages' labels match vocab.js", () => {
  assert.deepEqual(SEX_LABEL, asMap(WAITLIST_PREF_SEX));
  assert.deepEqual(READY_LABEL, asMap(WAITLIST_READY_TIMING));
  assert.deepEqual(PURPOSE_LABEL, asMap(PLACEMENT_PURPOSE));
  assert.equal(purposesText(['show', 'pet']), 'Pet / companion, Show');
  assert.equal(purposesText([]), 'Any');
  assert.deepEqual(CREDIT_LABEL, asMap(FEE_CREDIT_POLICY));
  // And the server's checks of what a family may ask for (cloud/src/familyActions.js).
  assert.deepEqual([...ACTION_VOCAB.SEX].sort(), WAITLIST_PREF_SEX.map((v) => v.value).sort());
  assert.deepEqual([...ACTION_VOCAB.READY].sort(), WAITLIST_READY_TIMING.map((v) => v.value).sort());
  assert.deepEqual([...ACTION_VOCAB.PURPOSE], PLACEMENT_PURPOSE.map((v) => v.value));
  // The turn holder's public row reads the same online and in her Copy public list.
  assert.equal(SERVER_DECIDING, DECIDING_LABEL);
});

test('the turn holder\'s row: highlighted, "Currently deciding" for the name, sex and date kept', () => {
  const html = publicListHtml([{ position: 1, name: 'Currently deciding', pref_sex: 'female', added: '2026-01-01', deciding: true }, { position: 2, name: 'Bo K.', pref_sex: 'male', added: '2026-01-02' }], '', 2);
  assert.match(html, /<tr class="deciding">\s*<td class="num">#1<\/td>\s*<td><em>Currently deciding<\/em><\/td>\s*<td>Female<\/td>\s*<td class="tip"><button type="button" class="added-tip" aria-label="Added Jan 1, 2026" data-tip="Added Jan 1, 2026">i<\/button><\/td>/);
  assert.equal(/<th>Added<\/th>/.test(html), false, 'the date added is a bubble, not a column');
  assert.match(publicListHtml([{ position: 1, name: 'Ann A.', pref_sex: 'female', wants_more: ['Full registration', '<b>'], added: '2026-01-01' }]),
    /<td>Female · Full registration · &lt;b&gt;<\/td>/, 'what else they narrowed, escaped');
  assert.match(html, /<tr class="mine">/);
  assert.match(publicListHtml([]), /No families to show right now/);
});

test('search finds a family by name (any case, any accents), number or date added', () => {
  const row = { position: 12, name: 'Chloé M.', pref_sex: 'female', added: '2026-03-12' };
  for (const q of ['', 'chloe', 'CHLO', ' chloé ', '12', '#12', 'mar 12']) assert.equal(rowMatches(row, q), true, q);
  for (const q of ['1', 'bo', '#13']) assert.equal(rowMatches(row, q), false, q);
});

test('dates, possessives and escaping', () => {
  assert.equal(fmtDate('2026-10-10'), 'Oct 10, 2026');
  assert.equal(fmtDate('2026-10-10', { weekday: true }), 'Saturday, Oct 10, 2026');
  assert.equal(fmtDate('nonsense'), '');
  assert.equal(possessive('Thornfield Kennels'), "Thornfield Kennels'");
  assert.equal(possessive('Juniper Ridge'), "Juniper Ridge's");
  assert.equal(esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
  const html = publicListHtml([{ position: 1, name: '<img src=x>', pref_sex: 'any', added: '2026-01-01' }, { position: 3, name: 'Bo K.', pref_sex: 'male', added: '2026-01-02' }], '', 3);
  assert.equal(html.includes('<img'), false, 'names are escaped');
  assert.match(html, /Their place is being held/, 'a skipped number is explained');
  assert.match(html, /class="mine"/);
});

test('the pages carry no inline script or style (the CSP forbids them) and load nothing from elsewhere', () => {
  const dir = new URL('../cloud/public/family/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    assert.equal(/style="/.test(text), false, `${f}: inline style`);
    // The one exception: the application form loads Cloudflare Turnstile, its spam
    // check, and only that page's CSP allows it.
    // The status page's Directions links (Family Requests plan §4) open the family's
    // own maps in a new tab: a link they tap, nothing the page loads.
    const outside = text.replace(/http:\/\/www\.w3\.org[^"']*/g, '')
      .replace(f === 'apply.js' ? /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/g : /$^/g, '')
      .replace(f === 'status.js' ? /https:\/\/www\.google\.com\/maps\/dir\/\?/g : /$^/g, '');
    assert.equal(/https?:\/\//.test(outside), false, `${f}: an outside URL`);
    if (f.endsWith('.html')) assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/.test(text), false, `${f}: inline script`);
  }
});

test('a parent\'s registered name, pedigree and health testing sit behind an info bubble by its call name; no bubble without any', () => {
  const dam = { name: 'Juniper', titles: ['CGC'], registered_name: 'Briar Hollow\'s Summer <Juniper>',
    pedigree: { sire: 'GCH Oak Ridge Cassius', dam: null }, tests: [{ name: 'OFA Hips', result: 'Good' }] };
  const sire = { name: 'Ash', titles: [] };
  const html = parentsLine(dam, sire);
  assert.match(html, /Dam: Juniper CGC <button type="button" class="info-bubble" data-dog-info="[^"]+" aria-label="About Juniper"[^>]*>i<\/button> · Sire: Ash<\/div>$/);
  assert.equal(html.includes('<details'), false, 'health testing is in the popup now');
  assert.equal(html.includes('<Juniper>'), false, 'the bubble\'s data is escaped');
  const info = JSON.parse(html.match(/data-dog-info="([^"]+)"/)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  assert.deepEqual(info, { name: 'Juniper', registered_name: 'Briar Hollow\'s Summer <Juniper>', pedigree: { sire: 'GCH Oak Ridge Cassius', dam: '' }, tests: [{ name: 'OFA Hips', result: 'Good' }] });
  const pop = dogInfoHtml(info);
  assert.match(pop, /<h3>Registered name<\/h3><p>Briar Hollow&#39;s Summer &lt;Juniper&gt;<\/p>/);
  assert.match(pop, /<h3>Pedigree<\/h3><dl class="info-facts"><dt>Sire<\/dt><dd>GCH Oak Ridge Cassius<\/dd><\/dl>/);
  assert.match(pop, /<h3>Health testing<\/h3>.*OFA Hips: Good/);
  assert.ok(pop.indexOf('Registered name') < pop.indexOf('Pedigree') && pop.indexOf('Pedigree') < pop.indexOf('Health testing'), 'in her order');
  assert.equal(dogInfo(sire), null);
  assert.equal(infoBubble({ name: 'Bo', titles: [], tests: [] }), '');
  assert.equal(dogInfoHtml(dogInfo({ name: 'Bo', registered_name: 'Bo of X' })).includes('Pedigree'), false, 'only what was published');
  const heat = upcomingItemHtml({ kind: 'planned_heat', label: 'Juniper', dam, expected_month: '2027-03' });
  assert.match(heat, /<strong>Juniper CGC<\/strong> <button type="button" class="info-bubble"/, 'a planned heat\'s dam gets the bubble by its name');
});

test('photos links: on a parent, a litter card and a planned heat, escaped, opening in a new tab', () => {
  const dam = { name: 'Juniper', titles: [], photos_url: 'https://photos.example/j?a=1&b="2"' };
  assert.match(parentsLine(dam, { name: 'Ash', titles: [] }), /Dam: Juniper \(<a class="photos-link" href="https:\/\/photos\.example\/j\?a=1&amp;b=&quot;2&quot;" target="_blank" rel="noopener noreferrer">Photos<\/a>\) · Sire: Ash</);
  const card = availableItemHtml({ label: 'Juniper × Ash', dam, sire: { name: 'Ash' }, photos_url: 'https://photos.example/litter', pups_available: 1 });
  assert.match(card, /See the litter&#39;s photos/);
  assert.match(upcomingItemHtml({ kind: 'planned_heat', label: 'Juniper', dam, expected_month: '2027-03' }), /Photos of Juniper/);
  assert.equal(photosLink('javascript:alert(1)'), '');
  assert.equal(availableItemHtml({ label: 'X', pups_available: 0 }).includes('photos'), false);
});

test('Available Puppies: Males left, Females right, the label once above each, a name its link, then its registration and registry when set', () => {
  const html = pupColumnsHtml({ pups: [
    { call_name: 'Pip', sex: 'male', photos_url: 'https://photos.example/pip' },
    { call_name: 'Poppy', sex: 'female', registration: 'full', registry: 'AKC' }, { call_name: '<b>Rue</b>', sex: 'female', registry: 'CKC' }
  ] });
  assert.match(html, /<div class="pup-col-head">Males<\/div><ul class="plain"><li><a class="photos-link" href="https:\/\/photos\.example\/pip"[^>]*>Pip<\/a><\/li><\/ul><\/div><div class="pup-col"><div class="pup-col-head">Females<\/div>/);
  // Each with its registration when set; an undecided one (none set) shows none here.
  assert.match(html, /<li>Poppy <span class="muted">· Full · AKC<\/span><\/li><li>&lt;b&gt;Rue&lt;\/b&gt; <span class="muted">· CKC<\/span><\/li>/);
  assert.equal(html.includes('Puppies</div>'), false, 'no third column without a pup of no sex');
  assert.match(pupColumnsHtml({ pups: [{ call_name: 'Bo', sex: 'female' }] }), /Males<\/div><div class="muted">None left/);
  assert.equal(pupColumnsHtml({ pups: [] }), '<div class="small muted">No puppies remaining</div>');
  assert.match(pupColumnsHtml({ pups_available: 1, pups_male: 1 }), /1 male remaining/, 'a card without names keeps the counts');
});
