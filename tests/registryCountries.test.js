// registryCountries.test.js — registry codes → country, ISO-3 country names and
// her home country (data/registryCountries.js; Dog Titles Field Plan D7, D8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGISTRY_COUNTRIES, countryOfRegistry, countryName, homeCountry, normCode, ISO3_COUNTRIES
} from '../shared/data/registryCountries.js';

test('no code belongs to two countries, after matching drops dots and a trailing hyphen', () => {
  const seen = new Map();
  for (const [country, codes] of Object.entries(REGISTRY_COUNTRIES)) {
    for (const c of codes) {
      const k = normCode(c);
      assert.ok(!seen.has(k) || seen.get(k) === country, `${c} is ${seen.get(k)} and ${country}`);
      seen.set(k, country);
    }
  }
});

test('the codes the plan names map to their countries', () => {
  for (const [code, country] of [
    ['JR', 'Serbia'], ['JUR', 'Serbia'], ['KSS', 'Serbia'], ['RKF', 'Russia'], ['RKF R.', 'Russia'],
    ['MET', 'Hungary'], ['LOE', 'Spain'], ['RRC', 'Spain'], ['LOI', 'Italy'], ['LIR', 'Italy'],
    ['PKR', 'Poland'], ['PKR.', 'Poland'], ['KW', 'Poland'], ['S', 'Sweden'], ['SHPK', 'Slovakia'],
    ['ISBR', 'Israel'], ['KC', 'United Kingdom'], ['ZA', 'South Africa'], ['ANKC', 'Australia'],
    ['NZKC', 'New Zealand'], ['UKC', 'United States'], ['AKC', 'United States'], ['VDH', 'Germany'],
    ['LOF', 'France'], ['ÖHZB', 'Austria'], ['ČLP', 'Czech Republic'], ['CMKU', 'Czech Republic'],
    ['AESKC', 'United Arab Emirates'], ['LOMAD', 'Madagascar'], ['KIF-', 'Turkey'], ['NIC-F', 'Nicaragua'],
    ['K.C.T.', 'Taiwan'], ['JoKC', 'Jordan'], ['GEO', 'Georgia']
  ]) assert.equal(countryOfRegistry(code), country, code);
});

test('matching ignores case, dots and a trailing hyphen, and takes the whole code', () => {
  assert.equal(countryOfRegistry('jr'), 'Serbia');
  assert.equal(countryOfRegistry('K.C.T'), 'Taiwan');
  assert.equal(countryOfRegistry('KCT'), 'Taiwan');
  assert.equal(countryOfRegistry('KIF'), 'Turkey');
  assert.equal(countryOfRegistry('öhzb'), 'Austria');
  assert.equal(countryOfRegistry('KCC'), 'Chile', 'KC does not swallow KCC');
  assert.equal(countryOfRegistry('KCU'), 'Uruguay');
  assert.equal(countryOfRegistry('JRX'), '');
  assert.equal(countryOfRegistry(''), '');
  assert.equal(countryOfRegistry(null), '');
});

test('ambiguous codes are left off the map', () => {
  for (const code of ['CKC', 'KCSB', 'KCB', 'K.C.B.', 'FCG', 'F.C.G.', 'ACC', 'CR', 'FCC', 'LGC', 'LPB', 'N', 'A']) {
    assert.equal(countryOfRegistry(code), '', code);
  }
});

test('countryName: an ISO alpha-3 code becomes its country, anything else stays as printed', () => {
  assert.equal(countryName('SRB'), 'Serbia');
  assert.equal(countryName(' srb '), 'Serbia');
  assert.equal(countryName('CAN'), 'Canada');
  assert.equal(countryName('Canada'), 'Canada');
  assert.equal(countryName('Somewhere  Else'), 'Somewhere Else');
  assert.equal(countryName(''), '');
  // Every map country spelled the same in both lists.
  const names = new Set(Object.keys(REGISTRY_COUNTRIES));
  for (const n of names) assert.ok(Object.values(ISO3_COUNTRIES).includes(n), `${n} has an ISO-3 code`);
});

test('homeCountry: the registry most of her own dogs use, else the United States', () => {
  const own = (registry, extra = {}) => ({ ownership_type: 'owned', registry, ...extra });
  assert.equal(homeCountry([]), 'United States');
  assert.equal(homeCountry([own('JR'), own('JR'), own('AKC')]), 'Serbia');
  assert.equal(homeCountry([own('JR'), own('AKC')]), 'United States', 'a tie goes to the United States');
  assert.equal(homeCountry([own('JR'), own('MET')]), 'Hungary', 'else A–Z');
  assert.equal(homeCountry([
    own('AKC'),
    { ownership_type: 'external', registry: 'JR' }, { ownership_type: 'external', registry: 'JR' },
    own('JR', { pedigree_only: true }), own('JR', { is_archived: true }), own('CKC'), own('CKC')
  ]), 'United States', 'outside, pedigree-only, archived and unmapped dogs do not count');
  assert.equal(homeCountry([{ ownership_type: 'co_owned', registry: 'KC' }]), 'United Kingdom');
});
