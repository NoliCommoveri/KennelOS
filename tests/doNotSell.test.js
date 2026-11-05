// doNotSell.test.js — her do-not-sell list: matching a new application on name,
// email or phone (and the contact it came from), the warning words, the contacts
// it hides, and the repo's add / duplicate / take-off rules on the in-memory db.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import {
  doNotSellMatches, entryDoNotSellMatches, doNotSellWarning, listedContactIds, listingProblem, alreadyListed
} from '../shared/data/doNotSell.js';

const jane = { id: 'l1', name: 'Jane Doe', email: 'Jane@Example.com', phone: '(555) 123-4567', reason: 'Resold a pup', is_archived: false };
const byPhone = { id: 'l2', name: '', email: '', phone: '555 999 0000', reason: '', is_archived: false };
const fromContact = { id: 'l3', name: 'Sam Roe', email: '', phone: '', contact_id: 'c9', reason: '', is_archived: false };
const list = [jane, byPhone, fromContact];

test('an application matches on email, phone, name or its contact', () => {
  assert.deepEqual(doNotSellMatches({ name: 'Someone', email: 'jane@example.com ' }, list).map((m) => [m.listing.id, m.strength, m.reason]), [['l1', 'certain', 'email']]);
  assert.equal(doNotSellMatches({ phone: '+1 555-999-0000' }, list)[0].listing.id, 'l2');
  assert.equal(doNotSellMatches({ phone: '555.123.4567' }, list)[0].reason, 'phone');
  const byName = doNotSellMatches({ name: 'jane  doe' }, list)[0];
  assert.equal(byName.strength, 'possible', 'a name alone is only a maybe');
  assert.equal(byName.reason, 'name');
  assert.equal(doNotSellMatches({ name: 'Kim Park' }, list).length, 0);
  assert.equal(doNotSellMatches({ name: 'Sam Roe-Smith' }, list)[0].reason, 'similar name', 'a near name is a maybe too');
  const e = { contact_id: 'c9', application: { name: 'Samuel R.', email: 'other@example.com' } };
  assert.deepEqual(entryDoNotSellMatches(e, list).map((m) => [m.listing.id, m.reason]), [['l3', 'contact']]);
  assert.equal(doNotSellMatches({ email: 'nobody@example.com', name: 'Pat Lee' }, list).length, 0);
});

test('a listing taken off the list never matches, and its contact shows again', () => {
  const off = [{ ...jane, is_archived: true }, fromContact];
  assert.equal(doNotSellMatches({ email: 'jane@example.com' }, off).length, 0);
  assert.deepEqual([...listedContactIds(list)], ['c9']);
  assert.deepEqual([...listedContactIds([{ ...fromContact, is_archived: true }])], []);
});

test('the warning says how sure it is and why', () => {
  assert.equal(doNotSellWarning(doNotSellMatches({ email: 'jane@example.com' }, list)), 'On your do-not-sell list: Jane Doe (same email). Reason: Resold a pup');
  assert.equal(doNotSellWarning(doNotSellMatches({ name: 'Jane Doe' }, list)), 'May be on your do-not-sell list: Jane Doe (same name). Reason: Resold a pup');
  assert.match(doNotSellWarning(doNotSellMatches({ name: 'Jane Doe', phone: '555 999 0000' }, list)), /\(and 1 more listing\)/);
  assert.equal(doNotSellWarning([]), '');
});

test('a listing needs something to match on; duplicates are found', () => {
  assert.ok(listingProblem({ reason: 'x' }));
  assert.equal(listingProblem({ phone: '5551234567' }), '');
  assert.equal(alreadyListed({ email: 'JANE@example.com' }, list).id, 'l1');
  assert.equal(alreadyListed({ contact_id: 'c9' }, list).id, 'l3');
  assert.equal(alreadyListed({ name: 'Jane Doe' }, list), null, 'a name alone isn\'t a duplicate');
});

// --- The repo -----------------------------------------------------------------

let db; let doNotSellRepo; let contactRepo;
before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ doNotSellRepo } = await import('../shared/data/doNotSellRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
});
beforeEach(async () => { for (const t of db.tables) await t.clear(); });

test('added by hand, from a contact, or from an application; never twice', async () => {
  const hand = await doNotSellRepo.create({ name: '  Pat Lee ', phone: '555 222 3333', reason: 'No-show twice' });
  assert.equal(hand.name, 'Pat Lee');
  assert.match(hand.added_date, /^\d{4}-\d{2}-\d{2}$/);
  await assert.rejects(doNotSellRepo.create({ name: 'P. Lee', phone: '(555) 222-3333' }), /already on your do-not-sell list/);
  await assert.rejects(doNotSellRepo.create({ reason: 'nothing to match' }), /Add a name, an email or a phone/);
  const c = await contactRepo.create({ name: 'Sam Roe', email: 'sam@example.com' });
  const fromC = await doNotSellRepo.addContact(c, { reason: 'Rude' });
  assert.equal(fromC.contact_id, c.id);
  assert.equal(fromC.email, 'sam@example.com');
  assert.equal((await doNotSellRepo.forContact(c.id)).length, 1);
  const fromApp = await doNotSellRepo.addApplicant({ id: 'e1', contact_id: null, application: { name: 'Kim', email: 'kim@example.com' } });
  assert.equal(fromApp.source_entry_id, 'e1');
  await doNotSellRepo.archive(hand.id);
  assert.equal((await doNotSellRepo.getAll()).length, 2, 'taken off = archived');
  assert.ok(await doNotSellRepo.create({ name: 'Pat Lee', phone: '555 222 3333' }), 'can go back on once taken off');
});
