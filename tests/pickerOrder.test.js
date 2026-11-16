// pickerOrder.test.js — pickers read alphabetically: contacts, kennels and
// waitlist programs come back from their repos sorted by name, and the contract
// pickers group her forms by kind, the kinds A–Z (contractForms.formTypeGroups).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { formTypeGroups } from '../shared/data/contractForms.js';

let db, contactRepo, kennelRepo, waitlistProgramRepo;
before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ waitlistProgramRepo } = await import('../shared/data/waitlistProgramRepo.js'));
});
beforeEach(async () => { for (const t of db.tables) await t.clear(); });

test('contacts, kennels and programs come back by name, case-insensitive', async () => {
  for (const name of ['zoe Vet', 'Amy Buyer', 'bob Referrer']) await contactRepo.create({ name });
  assert.deepEqual((await contactRepo.getAll()).map((c) => c.name), ['Amy Buyer', 'bob Referrer', 'zoe Vet']);
  for (const kennel_name of ['Willow Run', 'acorn Hill', 'Maple']) await kennelRepo.create({ kennel_name, is_own_kennel: false });
  assert.deepEqual((await kennelRepo.getAll()).map((k) => k.kennel_name), ['acorn Hill', 'Maple', 'Willow Run']);
  const own = await kennelRepo.create({ kennel_name: 'Mine', is_own_kennel: true });
  for (const name of ['Pet homes', 'breeding homes']) await waitlistProgramRepo.create({ name, kennel_id: own.id });
  assert.deepEqual((await waitlistProgramRepo.getAll()).map((p) => p.name), ['breeding homes', 'Pet homes']);
});

test('formTypeGroups: only the kinds she has, kinds A–Z, forms A–Z inside', () => {
  const groups = formTypeGroups([
    { id: '1', form_type: 'pet_home', label: 'Pet home B' },
    { id: '2', form_type: 'stud_service', label: 'Stud' },
    { id: '3', form_type: 'pet_home', label: 'pet home A' },
    { id: '4', form_type: 'breeding_rights', label: 'Breeding' }
  ]);
  assert.deepEqual(groups.map((g) => g.label), ['Breeding rights contract', 'Pet home contract', 'Stud service contract']);
  assert.deepEqual(groups[1].forms.map((f) => f.id), ['3', '1']);
  assert.deepEqual(formTypeGroups([]), []);
});
