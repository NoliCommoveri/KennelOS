// kennelCard.test.js — the pure half of Kennel Cards (data/kennelCard.js +
// the public-id helpers in data/kennelRepo.js). Everything here is db-free: it
// pins the allow-list (what may leave this device), the round trip (what a
// truncated paste must NOT half-apply), and the identity-format rules. The
// upsert side needs a live IndexedDB and is exercised in the browser, the same
// split scopePredicates.test.js takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildKennelCard, encodeKennelCard, decodeKennelCard, kennelCardLink,
  extractCardPayload, normalizeCardInput, cardChanges,
  KennelCardError, KENNEL_CARD_VERSION, CARD_PARAM, CARD_FIELDS
} from '../shared/data/kennelCard.js';
import { newPublicId, isPublicId } from '../shared/data/kennelRepo.js';

// A full own-kennel record, deliberately carrying every field a Kennel can hold
// that must NOT ride along on a card — program config, logo, archive state, and
// the row id.
const ownKennel = () => ({
  id: 'row-uuid-not-the-identity',
  public_id: 'kos1_11111111-2222-3333-4444-555555555555',
  kennel_name: 'Thornfield Kennels',
  prefix: 'Thornfield',
  location: 'Vermont, USA',
  website: 'https://thornfield.example',
  is_own_kennel: true,
  is_archived: false,
  logo_data_url: 'data:image/png;base64,AAAA',
  preferred_tests: ['OFA Hips', 'Cardiac'],
  preferred_breeds: ['Boston Terrier'],
  preferred_test_breeds: { 'ofa hips': ['Boston Terrier'] },
  promote_nudge_enabled: true,
  promote_age_male_months: 7,
  promote_age_female_months: 13,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z'
});

// --- Public id format -------------------------------------------------------

test('a minted public id is prefixed, well-formed, and unique per call', () => {
  const a = newPublicId();
  const b = newPublicId();
  assert.ok(a.startsWith('kos1_'), 'carries the namespace prefix');
  assert.ok(isPublicId(a));
  assert.notEqual(a, b);
});

test('isPublicId rejects a bare UUID and other apps’ ids', () => {
  // The whole point of the prefix: a bare UUID pasted into the wrong field must
  // fail loudly, not look valid.
  assert.equal(isPublicId('11111111-2222-3333-4444-555555555555'), false);
  assert.equal(isPublicId('kos1_not-a-uuid'), false);
  assert.equal(isPublicId('kos2_11111111-2222-3333-4444-555555555555'), false);
  assert.equal(isPublicId(''), false);
  assert.equal(isPublicId(null), false);
  assert.equal(isPublicId(' kos1_11111111-2222-3333-4444-555555555555 '), true, 'trims');
});

// --- The allow-list ---------------------------------------------------------

test('a card carries ONLY the identity fields — never program config, logo, or the row id', () => {
  const card = buildKennelCard(ownKennel());
  assert.deepEqual(
    Object.keys(card).sort(),
    ['cardVersion', 'issuedAt', 'kennelName', 'location', 'prefix', 'publicId', 'website']
  );
  // Named individually so a regression names the leak rather than a key count.
  for (const leak of ['id', 'is_own_kennel', 'is_archived', 'logo_data_url',
    'preferred_tests', 'preferred_breeds', 'preferred_test_breeds',
    'promote_nudge_enabled', 'promote_age_male_months', 'promote_age_female_months',
    'created_at', 'updated_at']) {
    assert.equal(leak in card, false, `"${leak}" must never ride a kennel card`);
  }
  assert.equal(card.cardVersion, KENNEL_CARD_VERSION);
  assert.equal(card.publicId, ownKennel().public_id);
  assert.equal(card.kennelName, 'Thornfield Kennels');
});

test('a card can only be built for one of YOUR OWN kennels, and only once it has an id', () => {
  assert.throws(() => buildKennelCard({ ...ownKennel(), is_own_kennel: false }), KennelCardError);
  assert.throws(() => buildKennelCard({ ...ownKennel(), public_id: null }), KennelCardError);
  assert.throws(() => buildKennelCard(null), KennelCardError);
});

// --- Round trip -------------------------------------------------------------

test('encode → decode returns the same card', () => {
  const card = buildKennelCard(ownKennel());
  const back = decodeKennelCard(encodeKennelCard(card));
  assert.deepEqual(back, card);
});

test('a card link round-trips through the URL hash', () => {
  const card = buildKennelCard(ownKennel());
  const link = kennelCardLink(card, 'https://pro.kennelos.app/pages/kennels.html');
  const payload = extractCardPayload(new URL(link).hash);
  assert.ok(payload);
  assert.deepEqual(decodeKennelCard(payload), card);
});

test('a whole pasted link is accepted wherever a bare code is', () => {
  const card = buildKennelCard(ownKennel());
  const link = kennelCardLink(card, 'https://pro.kennelos.app/pages/kennels.html');
  assert.deepEqual(decodeKennelCard(link), card, 'people paste what they were sent');
  assert.deepEqual(decodeKennelCard(`  ${encodeKennelCard(card)}  `), card, 'and it may carry whitespace');
});

test('extractCardPayload ignores a hash that is not a kennel card', () => {
  assert.equal(extractCardPayload('#seed=N4IgLg'), null, 'a Furever seed link is not ours');
  assert.equal(extractCardPayload('#N4IgLg'), null, 'nor is a bare Companion hash');
  assert.equal(extractCardPayload(''), null);
  assert.equal(normalizeCardInput(''), '');
});

// --- Malformed input --------------------------------------------------------

test('a truncated or foreign payload throws a friendly error rather than half-applying', () => {
  const code = encodeKennelCard(buildKennelCard(ownKennel()));
  for (const bad of ['', '   ', 'not-a-card', code.slice(0, Math.floor(code.length / 2))]) {
    assert.throws(() => decodeKennelCard(bad), KennelCardError, `should reject: "${bad.slice(0, 20)}"`);
  }
});

test('a payload whose id is not a KennelOS kennel id is rejected', () => {
  // e.g. a Furever seed packet, whose breederKey is a bare UUID.
  const foreign = encodeKennelCard({ publicId: '11111111-2222-3333-4444-555555555555', kennelName: 'X' });
  assert.throws(() => decodeKennelCard(foreign), KennelCardError);
});

test('a card with no kennel name is rejected', () => {
  const nameless = encodeKennelCard({ publicId: newPublicId(), kennelName: '   ' });
  assert.throws(() => decodeKennelCard(nameless), KennelCardError);
});

test('unknown keys from a future version are dropped, not fatal', () => {
  const card = buildKennelCard(ownKennel());
  const fromFuture = encodeKennelCard({ ...card, cardVersion: 99, breeds: ['Boxer'], registryHandle: 'thornfield' });
  const back = decodeKennelCard(fromFuture);
  assert.equal(back.cardVersion, 99);
  assert.equal('breeds' in back, false);
  assert.equal('registryHandle' in back, false);
  assert.equal(back.publicId, card.publicId, 'the v1 identity still imports');
});

// --- The diff a preview shows ----------------------------------------------

test('cardChanges reports only fields that actually differ', () => {
  const card = buildKennelCard(ownKennel());
  const existing = { kennel_name: 'Thornfield Kennels', prefix: '', location: 'Maine', website: '' };
  const changes = cardChanges(card, existing);
  assert.deepEqual(changes.map((c) => c.field).sort(), ['location', 'prefix', 'website']);
  assert.deepEqual(changes.find((c) => c.field === 'location'), {
    field: 'location', label: 'Location', from: 'Maine', to: 'Vermont, USA'
  });
});

test('a blank field on the card means "not supplied", never "clear what I have"', () => {
  const card = buildKennelCard({ ...ownKennel(), location: '', website: '' });
  const existing = { kennel_name: 'Thornfield Kennels', prefix: 'Thornfield', location: 'Maine', website: 'https://old.example' };
  assert.deepEqual(cardChanges(card, existing), []);
});

test('the card→record field map covers exactly the four identity fields', () => {
  assert.deepEqual(
    CARD_FIELDS.map((f) => f.field).sort(),
    ['kennel_name', 'location', 'prefix', 'website']
  );
  // is_own_kennel is the load-bearing omission: a received card must never be
  // able to place a foreign kennel into the user's own-kennel set.
  assert.equal(CARD_FIELDS.some((f) => f.field === 'is_own_kennel'), false);
  assert.equal(CARD_PARAM, 'kennelcard');
});
