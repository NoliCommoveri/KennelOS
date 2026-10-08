// familyPages.test.js — the waitlist's family pages (cloud/public/family, W2 Plan
// §3) aren't part of the app and can't import it, so they carry copies of a few
// vocab labels. This fails if a copy drifts from shared/data/vocab.js, and pins
// the pages' small pure helpers (search, dates, possessives).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  SEX_LABEL, READY_LABEL, PLACEMENT_LABEL, CREDIT_LABEL, rowMatches, fmtDate, possessive, publicListHtml, esc
} from '../cloud/public/family/common.js';
import { WAITLIST_PREF_SEX, WAITLIST_READY_TIMING, PLACEMENT_TYPE, FEE_CREDIT_POLICY } from '../shared/data/vocab.js';

const asMap = (vocab) => Object.fromEntries(vocab.map((v) => [v.value, v.label]));

test("the family pages' labels match vocab.js", () => {
  assert.deepEqual(SEX_LABEL, asMap(WAITLIST_PREF_SEX));
  assert.deepEqual(READY_LABEL, asMap(WAITLIST_READY_TIMING));
  assert.deepEqual(PLACEMENT_LABEL, asMap(PLACEMENT_TYPE));
  assert.deepEqual(CREDIT_LABEL, asMap(FEE_CREDIT_POLICY));
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
  assert.match(html, /paused/, 'a skipped number is explained');
  assert.match(html, /class="mine"/);
});

test('the pages carry no inline script or style (the CSP forbids them) and load nothing from elsewhere', () => {
  const dir = new URL('../cloud/public/family/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    assert.equal(/style="/.test(text), false, `${f}: inline style`);
    // The one exception: the application form loads Cloudflare Turnstile, its spam
    // check, and only that page's CSP allows it.
    const outside = text.replace(/http:\/\/www\.w3\.org[^"']*/g, '')
      .replace(f === 'apply.js' ? /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/g : /$^/g, '');
    assert.equal(/https?:\/\//.test(outside), false, `${f}: an outside URL`);
    if (f.endsWith('.html')) assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/.test(text), false, `${f}: inline script`);
  }
});
