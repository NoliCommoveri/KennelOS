// saleDefaults.test.js — the price a sale moves to when its registration changes
// (priceForRegistrationChange): the Full surcharge comes or goes on top of the
// sale's own price, so a discount she gave stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedPricing, priceForRegistrationChange } from '../shared/data/saleDefaults.js';

const litter = { expected_price_male: 2500, expected_price_female: 3000, full_reg_surcharge_male: 1000, full_reg_surcharge_female: '' };
const blue = { sex: 'male' };

test('expectedPricing adds the Full surcharge for that sex', () => {
  assert.equal(expectedPricing(blue, litter, 'full').price, 3500);
  assert.equal(expectedPricing(blue, litter, 'limited').price, 2500);
});

test('Limited → Full adds the surcharge to the sale\'s own price', () => {
  assert.deepEqual(priceForRegistrationChange(blue, litter, 2500, 'limited', 'full'), { from: 2500, to: 3500, delta: 1000 });
  assert.deepEqual(priceForRegistrationChange(blue, litter, '2200', 'limited', 'full'), { from: 2200, to: 3200, delta: 1000 });
});

test('Full → Limited takes it off, never below zero', () => {
  assert.deepEqual(priceForRegistrationChange(blue, litter, 3500, 'full', 'limited'), { from: 3500, to: 2500, delta: -1000 });
  assert.equal(priceForRegistrationChange(blue, litter, 500, 'full', 'none').to, 0);
});

test('no price yet takes the new expected price', () => {
  assert.deepEqual(priceForRegistrationChange(blue, litter, '', 'limited', 'full'), { from: null, to: 3500, delta: 1000 });
});

test('null when the litter\'s price doesn\'t change or isn\'t known', () => {
  assert.equal(priceForRegistrationChange(blue, litter, 2500, 'limited', 'none'), null);
  assert.equal(priceForRegistrationChange({ sex: 'female' }, litter, 3000, 'limited', 'full'), null);
  assert.equal(priceForRegistrationChange(blue, {}, 2500, 'limited', 'full'), null);
});
