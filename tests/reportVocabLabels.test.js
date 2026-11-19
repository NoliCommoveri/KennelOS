// reportVocabLabels.test.js — the reports say a status in the vocab's words, not
// their own copy of them (review K1-9; Review Remainder plan, batch I).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { offerOutcomes } from '../shared/data/waitlistReports.js';
import { WAITLIST_OFFER_OUTCOME, descriptor } from '../shared/data/vocab.js';

test('offer outcomes are labelled from WAITLIST_OFFER_OUTCOME', () => {
  const { outcomes } = offerOutcomes([{ outcome: 'accepted' }, { outcome: 'passed' }, { outcome: 'no_response' }, { outcome: 'open' }]);
  assert.deepEqual(outcomes.map((o) => o.label),
    ['accepted', 'passed', 'no_response'].map((v) => descriptor(WAITLIST_OFFER_OUTCOME, v).label));
});

test('the outcome words aren\'t written out in the waitlist reports', () => {
  const words = ['accepted', 'passed', 'no_response'].map((v) => descriptor(WAITLIST_OFFER_OUTCOME, v).label);
  for (const file of ['data/waitlistReports.js', 'pages/offers-removals-report.js']) {
    const src = readFileSync(new URL(`../shared/${file}`, import.meta.url), 'utf8');
    for (const w of words) {
      assert.doesNotMatch(src, new RegExp(`(label|name): '${w}'`), `${file} writes '${w}' itself`);
    }
  }
});
