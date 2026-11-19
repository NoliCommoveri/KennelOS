// deleteBlockers.test.js — a refused Delete in words (review K1-7) and the pups an
// offer put in front of a family as a dog reference (K1-10). Review Remainder plan,
// batch I.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installMemoryDb } from './support/memoryDb.js';

let dogRepo, db, repoBase, notes;

before(async () => {
  await installMemoryDb();
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ db } = await import('../shared/data/db.js'));
  repoBase = await import('../shared/data/repoBase.js');
  globalThis.document ??= { addEventListener() {} }; // ui.js wires one click handler at import
  notes = await import('../shared/assets/deleteBlockers.js');
});

test('K1-10: a pup offered on an open turn can\'t be deleted, and says why', async () => {
  const pup = await dogRepo.create({ call_name: 'Ruby', status: 'external', sex: 'female', breed: 'Poodle', ownership_type: 'external', owner_contact_id: 'c0' });
  const other = await dogRepo.create({ call_name: 'Opal', status: 'external', sex: 'female', breed: 'Poodle', ownership_type: 'external', owner_contact_id: 'c0' });
  // An open offer as the waitlist engine writes it (the row only; its entry and litter don't matter here).
  await db.waitlist_offers.add({ id: 'o1', kennel_id: 'k1', entry_id: 'e1', litter_id: 'l1', outcome: 'open', eligible_dog_ids: [other.id, pup.id], offered_date: '2026-11-19', is_archived: false });
  const blockers = await dogRepo.getDeleteBlockers(pup.id);
  assert.deepEqual(blockers, [{ label: 'a pup offered to a waitlist family', count: 1 }]);
  await assert.rejects(dogRepo.hardDelete(pup.id), (e) => {
    assert.ok(e instanceof repoBase.ReferenceBlockedError);
    assert.match(e.message, /^Can't delete this dog: it's still in use \(a pup offered to a waitlist family × 1\)/);
    return true;
  });
  assert.ok(await dogRepo.getById(pup.id), 'still there');
  // A pup no offer named is free to go.
  const lone = await dogRepo.create({ call_name: 'Jet', status: 'external', sex: 'male', breed: 'Poodle', ownership_type: 'external', owner_contact_id: 'c0' });
  assert.deepEqual(await dogRepo.getDeleteBlockers(lone.id), []);
});

test('K1-7: the error names the entity, never the table', () => {
  const e = new repoBase.ReferenceBlockedError('waitlist_entries', [{ label: 'application a do-not-sell listing came from', count: 1 }]);
  assert.equal(e.message, "Can't delete this application: it's still in use (application a do-not-sell listing came from × 1). Archive it instead.");
  assert.doesNotMatch(e.message, /waitlist_entries/);
  // Every table a repo deletes from has words.
  const src = (name) => readFileSync(new URL(`../shared/data/${name}`, import.meta.url), 'utf8');
  for (const file of ['dogRepo.js', 'litterRepo.js', 'contactRepo.js', 'pairingRepo.js', 'saleRepo.js', 'kennelRepo.js', 'waitlistEntryRepo.js', 'accountRepo.js', 'contractRepo.js']) {
    const table = src(file).match(/makeRepo\(\s*'([a-z_]+)'/)[1];
    assert.ok(repoBase.ENTITY_LABELS[table], `${table} has no ENTITY_LABELS words`);
  }
});

test('K1-7: the note says what still uses it and what archiving gives her', () => {
  const blockers = [{ label: 'sire of another dog', count: 2 }, { label: 'dam of a litter', count: 1 }];
  assert.equal(notes.blockedDeleteText(blockers, { what: 'this dog' }),
    'Delete is off: this dog is still in use (sire of another dog × 2, dam of a litter × 1). Archive it instead: it keeps its history and drops out of your lists.');
  assert.equal(notes.blockedDeleteText([], { what: 'this dog' }), '');
  assert.equal(notes.blockedDeleteNoteHtml([]), '');
  const html = notes.blockedDeleteNoteHtml([{ label: '<b>x</b>', count: 1 }], { what: 'this kennel' });
  assert.match(html, /^<p class="delete-blocked-note" role="note">/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/, 'escaped');
});

test('K1-7: every detail page with a guarded Delete shows the note, not only a tooltip', () => {
  for (const page of ['dog', 'litter', 'contact', 'pairing', 'sale', 'waitlist-entry']) {
    const src = readFileSync(new URL(`../shared/pages/${page}.js`, import.meta.url), 'utf8');
    assert.match(src, /showDeleteBlockers\(els\.headerActions, blockers/, `${page}.js shows its blockers`);
    assert.doesNotMatch(src, /'Referenced as '/, `${page}.js still builds the tooltip-only wording`);
  }
  const kennels = readFileSync(new URL('../shared/pages/kennels.js', import.meta.url), 'utf8');
  assert.match(kennels, /blockedDeleteNoteHtml\(blocked/);
});
