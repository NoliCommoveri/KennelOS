// fureverIdentity.test.js — her Furever identity rides on her kennel record
// (K14-5), so a second device or a restore sends the same breederKey, tagline, vet
// and kennel pack instead of forking the family's breeder card.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, kennelRepo, settings, F;

before(async () => {
  ({ tables } = await installMemoryDb());
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  settings = await import('../shared/data/settings.js');
  F = await import('../shared/data/fureverIdentity.js');
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
});

test('this device’s key moves onto her kennel the first time', async () => {
  const k = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true });
  settings.setFureverSettings({ tagline: 'Goldens since 2010' });
  const key = settings.getFureverSettings().breederKey;
  await F.loadFureverIdentity();
  const row = await kennelRepo.getById(k.id);
  assert.equal(row.furever_identity.breederKey, key);
  assert.equal(row.furever_identity.tagline, 'Goldens since 2010');
  assert.equal('driveConnected' in row.furever_identity, false, 'UI state stays on the device');
});

test('her second device, or a restore, takes the kennel’s identity', async () => {
  await kennelRepo.create({
    kennel_name: 'Thornfield', is_own_kennel: true,
    furever_identity: { breederKey: 'KEY-1', tagline: 'Goldens', breederVet: { name: 'Dr Vet', phone: '1', address: '' }, contentPack: { packKey: 'PK', folderId: 'F', manifestFileId: 'M', version: 4 } }
  });
  const s = await F.loadFureverIdentity();
  assert.equal(s.breederKey, 'KEY-1');
  assert.equal(s.breederVet.name, 'Dr Vet');
  assert.equal(s.contentPack.manifestFileId, 'M');
  assert.equal(settings.getFureverSettings().breederKey, 'KEY-1', 'the device cache follows');
});

test('a save goes to the kennel that carries it, not a second one', async () => {
  const a = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true });
  const b = await kennelRepo.create({ kennel_name: 'Briar Hollow', is_own_kennel: true, furever_identity: { breederKey: 'KEY-B' } });
  settings.setMyKennelId(a.id);
  await F.saveFureverIdentity({ tagline: 'Two kennels, one key' });
  assert.equal((await kennelRepo.getById(b.id)).furever_identity.tagline, 'Two kennels, one key');
  assert.equal((await kennelRepo.getById(a.id)).furever_identity, undefined);
  assert.equal((await kennelRepo.getById(b.id)).furever_identity.breederKey, 'KEY-B');
});

test('identityHome prefers a carrier, then My kennel, then the first own kennel', () => {
  const k = (id, extra = {}) => ({ id, is_own_kennel: true, created_at: id, ...extra });
  assert.equal(F.identityHome([k('a'), k('b', { furever_identity: { breederKey: 'x' } })], 'a').kennel.id, 'b');
  assert.equal(F.identityHome([k('a'), k('b')], 'b').kennel.id, 'b');
  assert.equal(F.identityHome([k('a', { is_archived: true }), k('b')], null).kennel.id, 'b');
  assert.equal(F.identityHome([{ id: 'x', is_own_kennel: false }], null).kennel, null);
});
