// kelsSetup.test.js — the rules behind Kels's "Getting Started" (data/kelsSetup.js):
// which parts each edition asks, when the task leads her menu, and what a
// second kennel starts with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../shared/data/kelsSetup.js';
import { editionFlags } from '../shared/data/editionConfig.js';

const LITE = Object.fromEntries(Object.keys(editionFlags).map((k) => [k, false]));

test('Pro asks every part, in order', () => {
  assert.deepEqual(S.setupParts(editionFlags), ['logo', 'nudges', 'tests', 'puppy-record', 'extra-charges', 'accounts', 'kennels', 'furever', 'assistant', 'backup']);
});

test('Lite (no Kennel page, no Pro features) asks only the backup', () => {
  assert.deepEqual(S.setupParts(LITE, { kennelPage: false }), ['backup']);
});

test('each part only with what it sets up', () => {
  const only = (flags) => S.setupParts({ ...LITE, ...flags });
  assert.deepEqual(only({}), ['nudges', 'tests', 'backup']);
  assert.deepEqual(only({ invoicing: true }), ['logo', 'nudges', 'tests', 'backup']);
  assert.deepEqual(only({ multiKennel: true, furever: true }), ['nudges', 'tests', 'kennels', 'furever', 'backup']);
  assert.deepEqual(only({ extraCharges: true, accounts: true }), ['nudges', 'tests', 'extra-charges', 'accounts', 'backup']);
  assert.deepEqual(S.setupParts({ ...editionFlags }, { kennelPage: false }), ['accounts', 'furever', 'assistant', 'backup']);
});

test('an account as she\'d say it: a fee only where one is taken', () => {
  const pp = { name: 'PayPal (business)', account_type: 'payment_service', fee_percent: 3.49, fee_fixed: 0.49, fee_charge_back: true };
  assert.equal(S.accountLine(pp, { chargeBack: true }), 'PayPal (business), Payment service: 3.49% + $0.49, charged back to the family');
  assert.equal(S.accountLine(pp), 'PayPal (business), Payment service: 3.49% + $0.49', 'only where charge-backs exist');
  assert.equal(S.accountLine({ name: 'Zelle', account_type: 'payment_service' }, { chargeBack: true }), 'Zelle, Payment service: no fee');
  assert.equal(S.accountLine({ name: 'Good Dog', account_type: 'marketplace', fee_percent: 6.25, fee_charge_back: true }, { chargeBack: true }), 'Good Dog, Puppy marketplace: 6.25%', 'a marketplace is never charged back');
  assert.equal(S.accountLine({ name: 'AKC', account_type: 'registry', fee_percent: 5 }), 'AKC, Registry / club');
});

test('what prints her logo, in her words', () => {
  assert.equal(S.listWords(S.logoUses(editionFlags)), 'invoices, receipts, puppy records and printed reports');
  assert.equal(S.listWords(S.logoUses({ puppyRecord: true })), 'puppy records');
  assert.deepEqual(S.logoUses(LITE), []);
});

test('possessives', () => {
  assert.equal(S.possessive('Elmwood Kennels'), "Elmwood Kennels'");
  assert.equal(S.possessive('Bluebell'), "Bluebell's");
});

test('new: until her first dog record, of any kind', () => {
  assert.equal(S.isNewProgram({ dogs: [] }), true);
  assert.equal(S.isNewProgram({}), true);
  assert.equal(S.isNewProgram({ dogs: [{ ownership_type: 'external' }] }), false);
  assert.equal(S.isNewProgram({ dogs: [{ ownership_type: 'owned', is_archived: true }] }), false);
  assert.equal(S.setupPriority({ dogs: [] }), S.SETUP_PRIORITY_NEW);
  assert.equal(S.setupPriority({ dogs: [{ ownership_type: 'owned' }] }), S.SETUP_PRIORITY);
  assert.ok(S.SETUP_PRIORITY_NEW < 97, 'unfinished drafts stay above it');
});

test('a second kennel starts with the nudges and Puppy Record fields only', () => {
  const k = {
    id: 'a', kennel_name: 'Elmwood', logo_data_url: 'data:image/png;base64,x', public_id: 'kos1_x', waitlist_config: { fee_amount: 50 },
    promote_nudge_enabled: true, promote_age_male_months: 8, promote_age_female_months: 14, puppy_record_fields: { buyer: false }
  };
  assert.deepEqual(S.settingsToCopy(k), {
    promote_nudge_enabled: true, promote_age_male_months: 8, promote_age_female_months: 14, puppy_record_fields: { buyer: false }
  });
  assert.deepEqual(S.settingsToCopy({ kennel_name: 'New', puppy_record_fields: null }), {});
});

test('a new kennel name: required, and a near match asked about once', () => {
  const kennels = [{ kennel_name: 'Elmwood Kennels', is_own_kennel: true }, { kennel_name: 'Ridgeway', is_own_kennel: false }];
  assert.equal(S.newKennelNameProblem('  ', kennels), 'Give the new kennel a name.');
  assert.equal(S.newKennelNameProblem('Bluebell Show Dogs', kennels), null);
  const own = S.newKennelNameProblem('elmwood kennels', kennels);
  assert.match(own.message, /already have a kennel called "Elmwood Kennels"/);
  assert.ok(own.key);
  assert.match(S.newKennelNameProblem('Ridgeway', kennels).message, /someone else's/);
});
