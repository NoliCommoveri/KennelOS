// coOwnedWebsite.test.js — co-owned dogs on her KennelPort website (KennelPort's
// docs/Co_Owned_Dogs_Plan.md): Dog.lives_with_contact_id (which co-owner it lives
// with now; empty is with her), kept to one of its co-owners by dogRepo; and the
// bundle's 'partner_kennels' section: only outside kennels she ticked Name this
// kennel on my website, by name and website, and never a co-owner as a person.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import {
  buildSiteBundle, websiteGaps, bundleChanges, coOwnership, webAddress, DOG_KEYS, CO_OWNED_KEYS, PARTNER_KENNEL_KEYS, BUNDLE_KEYS
} from '../shared/data/siteExport.js';

const K = { id: 'k1', kennel_name: 'AK', is_own_kennel: true };
const TODAY = '2026-11-04';
const dog = (id, more = {}) => ({ id, call_name: id, sex: 'female', status: 'active_breeding', kennel_id: 'k1', ownership_type: 'owned', show_on_website: true, ...more });
const kennels = [
  K,
  { id: 'oak', kennel_name: 'Oakridge Bostons', website: 'oakridge.example', is_own_kennel: false, name_on_website: true },
  { id: 'pine', kennel_name: 'Pinehill', website: 'https://pinehill.example/', is_own_kennel: false, name_on_website: false },
  { id: 'gone', kennel_name: 'Gone Kennel', is_own_kennel: false, name_on_website: true, is_archived: true }
];
const contacts = [
  { id: 'ann', name: 'Ann Lee', email: 'ann@example.com', phone: '555-0100', kennel_id: 'oak' },
  { id: 'bob', name: 'Bob Ray', email: 'bob@example.com', kennel_id: 'pine' },
  { id: 'cy', name: 'Cy Park', email: 'cy@example.com', kennel_id: null },
  { id: 'dee', name: 'Dee Fox', kennel_id: 'gone' }
];
const build = (more = {}) => buildSiteBundle({ kennel: K, today: TODAY, bundleId: 'bundle-0001', contacts, kennels, sections: ['partner_kennels'], ...more });

test('a co-owned dog living with a co-owner: lives_away, with that kennel when she ticked it; one at home is grouped like her own', () => {
  const b = build({ dogs: [
    dog('nova', { ownership_type: 'co_owned', co_owner_contact_ids: ['ann', 'bob'], lives_with_contact_id: 'ann' }),
    dog('juno', { ownership_type: 'co_owned', co_owner_contact_ids: ['bob', 'ann'] }),
    dog('echo', { ownership_type: 'co_owned', co_owner_contact_ids: ['cy'], lives_with_contact_id: 'cy' }),
    dog('mine')
  ] });
  const by = Object.fromEntries(b.dogs.map((d) => [d.id, d]));
  assert.deepEqual(Object.keys(by.nova).sort(), [...DOG_KEYS, ...CO_OWNED_KEYS].sort());
  assert.deepEqual(CO_OWNED_KEYS.map((k) => by.nova[k]), [true, true, 'oak', ['oak']], 'Pinehill is not ticked, so not named');
  assert.deepEqual(CO_OWNED_KEYS.map((k) => by.juno[k]), [true, false, null, ['oak']]);
  assert.deepEqual(CO_OWNED_KEYS.map((k) => by.echo[k]), [true, true, null, []], 'a co-owner with no kennel: lives away, nothing named');
  assert.deepEqual(CO_OWNED_KEYS.map((k) => by.mine[k]), [false, false, null, []]);
  // Only the kennels the dogs name, by name and website: never a person.
  assert.deepEqual(b.partner_kennels, [{ id: 'oak', name: 'Oakridge Bostons', website: 'https://oakridge.example/' }]);
  assert.deepEqual(Object.keys(b.partner_kennels[0]), PARTNER_KENNEL_KEYS);
  const text = JSON.stringify(b);
  for (const s of ['Ann', 'Bob', 'ann@example.com', '555-0100', 'Pinehill', 'Gone Kennel']) assert.equal(text.includes(s), false, s);
  assert.deepEqual(Object.keys(b).filter((k) => !BUNDLE_KEYS.includes(k)), []);
});

test('an older Worker (no partner_kennels section) gets neither the section nor the dog fields', () => {
  const b = build({ sections: [], dogs: [dog('nova', { ownership_type: 'co_owned', co_owner_contact_ids: ['ann'], lives_with_contact_id: 'ann' })] });
  assert.equal('partner_kennels' in b, false);
  assert.deepEqual(Object.keys(b.dogs[0]).sort(), [...DOG_KEYS].sort());
});

test('coOwnership: an archived or own kennel is never named, and living with someone not a co-owner is living with her', () => {
  const maps = { contactsById: new Map(contacts.map((c) => [c.id, c])), kennelsById: new Map(kennels.map((k) => [k.id, k])) };
  assert.deepEqual(coOwnership(dog('x', { ownership_type: 'co_owned', co_owner_contact_ids: ['dee'], lives_with_contact_id: 'dee' }), maps),
    { co_owned: true, lives_away: true, lives_with_kennel_id: null, co_owner_kennel_ids: [] });
  assert.deepEqual(coOwnership(dog('x', { ownership_type: 'co_owned', co_owner_contact_ids: ['bob'], lives_with_contact_id: 'ann' }), maps),
    { co_owned: true, lives_away: false, lives_with_kennel_id: null, co_owner_kennel_ids: [] });
  assert.deepEqual(coOwnership(dog('x', { ownership_type: 'owned', co_owner_contact_ids: ['ann'], lives_with_contact_id: 'ann' }), maps),
    { co_owned: false, lives_away: false, lives_with_kennel_id: null, co_owner_kennel_ids: [] });
  assert.equal(webAddress('oakridge.example'), 'https://oakridge.example/');
  assert.equal(webAddress('javascript:alert(1)'), null);
  assert.equal(webAddress(''), null);
});

test('gaps: unticked kennels of shown co-owned dogs are asked about; a co-owner with no kennel is said', () => {
  const g = websiteGaps(K, { contacts, kennels, dogs: [
    dog('nova', { ownership_type: 'co_owned', co_owner_contact_ids: ['ann', 'bob'], lives_with_contact_id: 'ann' }),
    dog('echo', { ownership_type: 'co_owned', co_owner_contact_ids: ['cy'], lives_with_contact_id: 'cy' }),
    dog('hidden', { ownership_type: 'co_owned', co_owner_contact_ids: ['bob'], show_on_website: false })
  ] });
  assert.deepEqual(g.partnerKennels.map((k) => k.id), ['pine']);
  assert.deepEqual(g.noKennel.map((d) => d.id), ['echo']);
});

test('what an update would change: a dog moving says where it now lives', () => {
  const at = (lives) => build({ dogs: [dog('nova', { ownership_type: 'co_owned', co_owner_contact_ids: ['ann'], lives_with_contact_id: lives })] });
  const home = at(null); const away = at('ann');
  // Both name Oakridge (Ann is a co-owner either way), so only the move is a change.
  assert.deepEqual(home.partner_kennels, away.partner_kennels);
  assert.deepEqual(bundleChanges(home, away), ['nova: now living with Oakridge Bostons']);
  assert.deepEqual(bundleChanges(away, home), ['nova: now living with you']);
});

let tables, repo;
before(async () => {
  ({ tables } = await installMemoryDb());
  repo = await import('../shared/data/dogRepo.js');
});
beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  tables.kennels.rows.set('K', { id: 'K', kennel_name: 'Mine', is_own_kennel: true, is_archived: false });
});
const base = { call_name: 'Nova', sex: 'female', breed: 'Boston Terrier', ownership_type: 'co_owned', status: 'active_breeding', kennel_id: 'K', co_owner_contact_ids: ['ann', 'bob'] };

test('dogRepo: lives with one of its own co-owners, or nobody; cleared when that stops being true', async () => {
  const d = await repo.dogRepo.create({ ...base, lives_with_contact_id: 'ann' });
  assert.equal(d.lives_with_contact_id, 'ann');
  assert.equal((await repo.dogRepo.create({ ...base, call_name: 'X', lives_with_contact_id: 'zed' })).lives_with_contact_id, null, 'not a co-owner');
  // That co-owner taken off: back with her.
  await repo.dogRepo.update(d.id, { co_owner_contact_ids: ['bob'] });
  assert.equal((await repo.dogRepo.getById(d.id)).lives_with_contact_id, null);
  // No longer co-owned: cleared too.
  await repo.dogRepo.update(d.id, { lives_with_contact_id: 'bob' });
  assert.equal((await repo.dogRepo.getById(d.id)).lives_with_contact_id, 'bob');
  await repo.dogRepo.update(d.id, { ownership_type: 'owned' });
  assert.equal((await repo.dogRepo.getById(d.id)).lives_with_contact_id, null);
  assert.equal(repo.livesWithOk({ ownership_type: 'co_owned', co_owner_contact_ids: ['a'], lives_with_contact_id: 'a' }), true);
});
