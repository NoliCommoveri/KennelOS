// dogCard.test.js — Dog Cards (Shared Dogs Plan §3, End-State guide §36): what may
// leave a device, the round trip, and the receiving side's rules. One in-memory
// database plays both breeders: the card is built on the sender's records, the
// tables are cleared, and it's applied to the receiver's.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, dogRepo, eventRepo, kennelRepo, contactRepo, C;

before(async () => {
  ({ tables } = await installMemoryDb());
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ eventRepo } = await import('../shared/data/eventRepo.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  C = await import('../shared/data/dogCard.js');
});

const clear = () => { for (const t of Object.values(tables)) t.rows.clear(); localStorage.clear(); };
beforeEach(clear);

const LAB = 'Boston Terrier';

// The sender: her kennel, a co-owned female with notes, a sire and grandsire, a test,
// a title, a heat (which must not travel), and a contact (which must not either).
async function senderProgram() {
  const k = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, prefix: 'Thornfield', logo_data_url: 'data:x', preferred_tests: ['OFA'] });
  const buyer = await contactRepo.create({ name: 'Private Person', email: 'p@example.com' });
  const grand = await dogRepo.createPedigreeOnly({ registered_name: 'CH Old Grandsire', sex: 'male', breed: LAB, registry: 'AKC', registration_number: 'GS1' });
  const sire = await dogRepo.create({ call_name: 'Duke', registered_name: 'Thornfield Duke', sex: 'male', breed: LAB, ownership_type: 'owned', status: 'active_breeding', kennel_id: k.id, sire_id: grand.id, notes: 'secret sire note' });
  const maple = await dogRepo.create({
    call_name: 'Maple', registered_name: 'Thornfield Maple Leaf', sex: 'female', breed: LAB, ownership_type: 'co_owned',
    status: 'active_breeding', kennel_id: k.id, co_owner_contact_ids: [buyer.id], lives_with_contact_id: buyer.id,
    sire_id: sire.id, date_of_birth: '2023-04-01', registry: 'AKC', registration_number: 'MP123', microchip_id: '985000',
    breeder_kennel_id: k.id, notes: 'secret maple note', planned_tests: ['Eyes'], disposition: null, show_on_website: true
  });
  const test1 = await eventRepo.create({ subject_type: 'dog', subject_id: maple.id, event_type: 'ofa_pennhip', event_date: '2025-05-01', title: 'OFA hips', details: { joint: 'Hips', rating: 'Good', vet_comment: 'private' }, notes: 'secret event note' });
  await eventRepo.create({ subject_type: 'dog', subject_id: maple.id, event_type: 'title_earned', event_date: '2025-06-01', title: 'Champion', details: { title_abbreviation: 'CH', organization: 'AKC' } });
  await eventRepo.create({ subject_type: 'dog', subject_id: maple.id, event_type: 'heat_cycle', event_date: '2025-07-01', title: 'Heat' });
  return { k, buyer, grand, sire, maple, test1 };
}

// The receiver: her own kennel only.
async function receiver() {
  return kennelRepo.create({ kennel_name: 'Riverbend', is_own_kennel: true });
}

test('a dog public id is prefixed, write-once and unique', async () => {
  const k = await receiver();
  const id = C.DOG_CARD_VERSION && (await import('../shared/data/dogRepo.js')).newDogPublicId();
  assert.match(id, /^kosd1_/);
  const d = await dogRepo.create({ call_name: 'A', sex: 'male', breed: LAB, ownership_type: 'owned', status: 'active_breeding', kennel_id: k.id, public_id: id });
  await assert.rejects(dogRepo.update(d.id, { public_id: (await import('../shared/data/dogRepo.js')).newDogPublicId() }), /permanent/);
  await dogRepo.update(d.id, { public_id: '' });
  assert.equal((await dogRepo.getById(d.id)).public_id, id, 'never blanked');
  await assert.rejects(dogRepo.create({ call_name: 'B', sex: 'male', breed: LAB, ownership_type: 'owned', status: 'active_breeding', kennel_id: k.id, public_id: id }), /already has that public ID/);
  await assert.rejects(dogRepo.create({ call_name: 'C', sex: 'male', breed: LAB, ownership_type: 'owned', status: 'active_breeding', kennel_id: k.id, public_id: 'kos1_11111111-2222-3333-4444-555555555555' }), /not a valid KennelOS dog ID/);
});

test('the card carries only the allow-listed fields: no notes, contacts, heats or plans', async () => {
  const s = await senderProgram();
  const card = C.decodeDogCard(C.encodeDogCard(await C.buildDogCard({ fromKennelId: s.k.id, dogIds: [s.maple.id] })));
  const json = JSON.stringify(card);
  for (const leak of ['secret', 'Private Person', 'p@example.com', 'Eyes', 'vet_comment', 'heat_cycle', 'data:x', 'OFA"', s.buyer.id, s.maple.id, s.k.id]) {
    assert.ok(!json.includes(leak), `"${leak}" leaked onto the card`);
  }
  assert.equal(card.dogs.length, 3, 'Maple, her sire and her grandsire');
  const maple = card.dogs.find((d) => d.sent);
  assert.equal(maple.callName, 'Maple');
  assert.equal(maple.microchipId, '985000');
  assert.deepEqual(maple.events.map((e) => e.type), ['ofa_pennhip', 'title_earned']);
  assert.deepEqual(maple.events[0].details, { joint: 'Hips', rating: 'Good' });
  assert.ok(card.dogs.filter((d) => !d.sent).every((d) => d.events.length === 0), 'ancestors carry no events');
  assert.ok((await dogRepo.getById(s.maple.id)).public_id, 'sending minted her public id');
  assert.ok((await dogRepo.getById(s.grand.id)).public_id, 'and the ancestors’');
});

test('a mangled card, or a kennel card, is refused with a sentence', async () => {
  assert.throws(() => C.decodeDogCard('nonsense'), C.DogCardError);
  const { buildKennelCard, encodeKennelCard } = await import('../shared/data/kennelCard.js');
  const k = await receiver();
  const kc = encodeKennelCard(buildKennelCard(await kennelRepo.getById(k.id)));
  assert.throws(() => C.decodeDogCard(kc), /kennel card, not a dog card/);
});

test('received as co-owned: a new contact, her kennel, lives with them; parents and tests come too', async () => {
  const s = await senderProgram();
  const encoded = C.encodeDogCard(await C.buildDogCard({ fromKennelId: s.k.id, dogIds: [s.maple.id] }));
  clear();
  const mine = await receiver();
  const card = C.decodeDogCard(`https://pro.kennelos.app/pages/dog-cards.html#dogcard=${encoded}`);

  const preview = await C.previewDogCard(card);
  assert.equal(preview.from.action, 'create');
  assert.deepEqual(preview.dogs.map((d) => d.action), ['create']);
  assert.deepEqual(preview.ancestors, { total: 2, added: 2, matched: 0 });
  assert.equal(tables.dogs.rows.size, 0, 'the preview writes nothing');

  const r = await C.applyDogCard(card, { holding: 'co_owned', newContactName: 'Thornfield', kennelId: mine.id });
  assert.equal(r.created, 1);
  assert.equal(r.ancestorsAdded, 2);
  assert.equal(r.eventsAdded, 2);

  const dogs = await dogRepo.getAll({ includePedigreeOnly: true });
  const maple = dogs.find((d) => d.call_name === 'Maple');
  assert.equal(maple.ownership_type, 'co_owned');
  assert.equal(maple.kennel_id, mine.id);
  assert.deepEqual(maple.co_owner_contact_ids, [r.contact.id]);
  assert.equal(maple.lives_with_contact_id, r.contact.id);
  assert.equal(maple.notes, undefined);
  const sire = dogs.find((d) => d.id === maple.sire_id);
  assert.equal(sire.registered_name, 'Thornfield Duke');
  assert.equal(sire.pedigree_only, true);
  assert.equal(dogs.find((d) => d.id === sire.sire_id).registered_name, 'CH Old Grandsire');
  const thornfield = await kennelRepo.getById(r.kennel.id);
  assert.equal(thornfield.is_own_kennel, false);
  assert.equal(maple.breeder_kennel_id, thornfield.id);
  assert.equal((await contactRepo.getById(r.contact.id)).kennel_id, thornfield.id);
  const events = await eventRepo.getForSubject('dog', maple.id);
  assert.equal(events.length, 2);
  assert.ok(events.every((e) => e.shared_ref?.startsWith(`${maple.public_id}:`)));
});

test('sent again: the same dogs update, her own fields stay, and nothing is duplicated', async () => {
  const s = await senderProgram();
  const first = C.encodeDogCard(await C.buildDogCard({ fromKennelId: s.k.id, dogIds: [s.maple.id] }));
  // The sender adds a test and corrects the microchip before sending again.
  await dogRepo.update(s.maple.id, { microchip_id: '985111' });
  await eventRepo.update(s.test1.id, { details: { joint: 'Hips', rating: 'Excellent' } });
  await eventRepo.create({ subject_type: 'dog', subject_id: s.maple.id, event_type: 'genetic_test', event_date: '2025-08-01', title: 'Panel', details: { panel_name: 'Embark', result: 'Clear' } });
  const second = C.encodeDogCard(await C.buildDogCard({ fromKennelId: s.k.id, dogIds: [s.maple.id] }));

  clear();
  const mine = await receiver();
  const r1 = await C.applyDogCard(C.decodeDogCard(first), { holding: 'co_owned', newContactName: 'Thornfield', kennelId: mine.id });
  const maple = (await dogRepo.getAll()).find((d) => d.call_name === 'Maple');
  await dogRepo.update(maple.id, { notes: 'my own note', lives_with_contact_id: null });

  const preview = await C.previewDogCard(C.decodeDogCard(second));
  assert.equal(preview.dogs[0].action, 'update');
  assert.deepEqual(preview.dogs[0].changes.map((c) => c.field), ['microchip_id']);
  assert.deepEqual(preview.dogs[0].events, { added: 1, changed: 1 });

  const r2 = await C.applyDogCard(C.decodeDogCard(second), {});
  assert.equal(r2.updated, 1);
  assert.equal(r2.ancestorsAdded, 0);
  const after = await dogRepo.getById(maple.id);
  assert.equal(after.microchip_id, '985111');
  assert.equal(after.notes, 'my own note');
  assert.equal(after.lives_with_contact_id, null, 'her lives-with stays hers');
  assert.equal((await dogRepo.getAll({ includePedigreeOnly: true })).length, 3);
  const events = await eventRepo.getForSubject('dog', maple.id);
  assert.equal(events.length, 3);
  assert.equal(events.find((e) => e.event_type === 'ofa_pennhip').details.rating, 'Excellent');
  assert.equal((await kennelRepo.getAll()).length, 2, 'Riverbend and Thornfield, once');
  assert.equal((await contactRepo.getAll()).length, 1);
  assert.ok(r1.contact);
});

test('a dog she typed in herself is offered, and linked only when she picks it', async () => {
  const s = await senderProgram();
  const encoded = C.encodeDogCard(await C.buildDogCard({ fromKennelId: s.k.id, dogIds: [s.maple.id] }));
  clear();
  const mine = await receiver();
  const typed = await dogRepo.create({ call_name: 'Maple', sex: 'female', breed: LAB, ownership_type: 'owned', status: 'active_breeding', kennel_id: mine.id, registration_number: 'MP123' });
  const card = C.decodeDogCard(encoded);
  const preview = await C.previewDogCard(card);
  assert.deepEqual(preview.dogs[0].candidates.map((d) => d.id), [typed.id]);
  const pid = card.dogs.find((d) => d.sent).publicId;
  const r = await C.applyDogCard(card, { dogs: { [pid]: { linkToId: typed.id } } });
  assert.equal(r.linked, 1);
  assert.equal(r.contact, null, 'no contact needed when nothing is new');
  const linked = await dogRepo.getById(typed.id);
  assert.equal(linked.public_id, pid);
  assert.equal(linked.ownership_type, 'owned', 'her ownership stays');
  assert.equal(linked.microchip_id, '985000');
});

test('outside dogs: owned by the contact, in the sending kennel', async () => {
  const s = await senderProgram();
  const encoded = C.encodeDogCard(await C.buildDogCard({ fromKennelId: s.k.id, dogIds: [s.maple.id, s.sire.id] }));
  clear();
  await receiver();
  const owner = await contactRepo.create({ name: 'Ann at Thornfield' });
  const r = await C.applyDogCard(C.decodeDogCard(encoded), { holding: 'external', contactId: owner.id });
  assert.equal(r.created, 2);
  assert.equal(r.ancestorsAdded, 1, 'only the grandsire: Duke was sent');
  const duke = (await dogRepo.getAll()).find((d) => d.call_name === 'Duke');
  assert.equal(duke.ownership_type, 'external');
  assert.equal(duke.owner_contact_id, owner.id);
  assert.equal(duke.kennel_id, r.kennel.id);
  assert.equal(duke.pedigree_only, undefined);
});

test('a card from one of her own kennels is refused, nothing written', async () => {
  const s = await senderProgram();
  const card = C.decodeDogCard(C.encodeDogCard(await C.buildDogCard({ fromKennelId: s.k.id, dogIds: [s.maple.id] })));
  assert.equal((await C.previewDogCard(card)).from.action, 'own');
  const before = tables.dogs.rows.size;
  await assert.rejects(C.applyDogCard(card, { holding: 'co_owned', newContactName: 'X', kennelId: s.k.id }), /your own kennels/);
  assert.equal(tables.dogs.rows.size, before);
});

test('an ancestor she has links by the same registry and number', async () => {
  const s = await senderProgram();
  const encoded = C.encodeDogCard(await C.buildDogCard({ fromKennelId: s.k.id, dogIds: [s.maple.id] }));
  clear();
  const mine = await receiver();
  const gs = await dogRepo.createPedigreeOnly({ registered_name: 'Ch. Old Grandsire', sex: 'male', breed: LAB, registry: 'akc', registration_number: 'gs1' });
  const card = C.decodeDogCard(encoded);
  assert.deepEqual((await C.previewDogCard(card)).ancestors, { total: 2, added: 1, matched: 1 });
  await C.applyDogCard(card, { holding: 'co_owned', newContactName: 'Thornfield', kennelId: mine.id });
  const kept = await dogRepo.getById(gs.id);
  assert.ok(kept.public_id, 'now linked');
  assert.equal(kept.registered_name, 'Ch. Old Grandsire', 'her spelling stays: only blanks are filled');
  const duke = (await dogRepo.getAll({ includePedigreeOnly: true })).find((d) => d.registered_name === 'Thornfield Duke');
  assert.equal(duke.sire_id, gs.id);
});

test('a co-owned add needs a contact and one of her kennels', async () => {
  const s = await senderProgram();
  const encoded = C.encodeDogCard(await C.buildDogCard({ fromKennelId: s.k.id, dogIds: [s.maple.id] }));
  clear();
  await receiver();
  await assert.rejects(C.applyDogCard(C.decodeDogCard(encoded), { holding: 'co_owned' }), /co-own these dogs with/);
  await assert.rejects(C.applyDogCard(C.decodeDogCard(encoded), { holding: 'co_owned', newContactName: 'T' }), /which of your kennels/);
});

test('the file name says whose and how many', async () => {
  const s = await senderProgram();
  const card = await C.buildDogCard({ fromKennelId: s.k.id, dogIds: [s.maple.id, s.sire.id] });
  assert.equal(C.dogCardFileName(card), 'thornfield-2-dogs.kosdogs');
});
