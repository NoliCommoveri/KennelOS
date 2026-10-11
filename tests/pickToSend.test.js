// pickToSend.test.js — the waitlist's "Review sale & send" (Integrations plan
// §2.6) below the page: the deposit-request message (pure), and on the in-memory
// database the send helpers it shares with the Contract page (contractSend.js):
// which contract a sale sends, the facts a sale contract's link carries, marking
// it sent, and the message logged on the family's entry, which the KennelOS
// mailer must never send again.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let db; let kennelRepo; let dogRepo; let contactRepo; let saleRepo; let contractRepo; let accountRepo; let waitlistEntryRepo;
let send; let depositRequestMessage; let logOwnMessage; let queuedEmails;

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ contractRepo } = await import('../shared/data/contractRepo.js'));
  ({ accountRepo } = await import('../shared/data/accountRepo.js'));
  ({ waitlistEntryRepo } = await import('../shared/data/waitlistEntryRepo.js'));
  send = await import('../shared/data/contractSend.js');
  ({ depositRequestMessage } = await import('../shared/data/depositRequest.js'));
  ({ logOwnMessage, queuedEmails } = await import('../shared/data/waitlistOutbox.js'));
});

// --- Pure: the message ---------------------------------------------------------------

test('the deposit request says what\'s due, how to pay, the contract link and the invoice', () => {
  const m = depositRequestMessage({
    who: 'Jane', pupName: 'Maple', litterLabel: 'Opal × Cassius', deposit: '$500.00', depositDue: 'Oct 18, 2026',
    paymentText: 'Venmo @briar-hollow', contractLabel: 'Pet home contract', contractLink: 'https://form.jotform.com/1?a=b',
    invoice: true, balance: '$1,700.00', balanceDue: 'Dec 1, 2026', kennelName: 'Briar Hollow'
  });
  assert.equal(m.subject, 'Maple: your deposit and contract');
  assert.match(m.body, /^Hi Jane,\n\nThank you for choosing Maple from Opal × Cassius!/);
  assert.match(m.body, /Deposit: \$500\.00, due by Oct 18, 2026\.\nMaple is held for you until then\./);
  assert.match(m.body, /How to pay: Venmo @briar-hollow/);
  assert.match(m.body, /sign your Pet home contract\. The details are already filled in:\nhttps:\/\/form\.jotform\.com\/1\?a=b/);
  assert.match(m.body, /Your invoice is attached\./);
  assert.match(m.body, /The balance of \$1,700\.00 is due by Dec 1, 2026\./);
  assert.ok(m.body.endsWith('Briar Hollow'));
});

test('parts with nothing to say are left out; a payment link comes before her instructions', () => {
  const bare = depositRequestMessage({ pupName: 'Maple' });
  assert.equal(bare.subject, 'Maple: your deposit');
  assert.match(bare.body, /^Hi,/);
  assert.ok(!/Deposit:|contract|invoice|balance|pay/i.test(bare.body.replace('Thank you', '')));
  const linked = depositRequestMessage({ pupName: 'Maple', paymentLink: 'https://pay.example/x', paymentText: 'or a check' });
  assert.match(linked.body, /Pay online: https:\/\/pay\.example\/x\n\nOr pay: or a check/);
  const noDue = depositRequestMessage({ balance: '$100.00' });
  assert.match(noDue.body, /due when you pick up your puppy/);
});

// --- On the in-memory database --------------------------------------------------------

let K; let pup; let buyer; let sale;

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Briar Hollow', location: 'Woodstock, VT', is_own_kennel: true });
  const sire = await dogRepo.create({ call_name: 'Cassius', registered_name: 'Briar Hollow Cassius', sex: 'male', breed: 'Golden Retriever', ownership_type: 'owned', status: 'breeding', kennel_id: K.id });
  const dam = await dogRepo.create({ call_name: 'Opal', sex: 'female', breed: 'Golden Retriever', ownership_type: 'owned', status: 'breeding', kennel_id: K.id });
  pup = await dogRepo.create({ call_name: 'Maple', sex: 'female', breed: 'Golden Retriever', sire_id: sire.id, dam_id: dam.id, ownership_type: 'owned', status: 'puppy', kennel_id: K.id });
  buyer = await contactRepo.create({ name: 'Jane Smith', email: 'jane@example.com' });
  sale = await saleRepo.create({ kennel_id: K.id, dog_id: pup.id, buyer_contact_id: buyer.id, registration_type: 'limited', price: 2200, deposit_amount: 500, status: 'deposit_pending' });
});

test('her forms come from Form service accounts only', async () => {
  const forms = [{ id: 'f1', form_type: 'pet_home', label: 'Pet home', url: 'https://form.jotform.com/1' }];
  await accountRepo.create({ name: 'Jotform', account_type: 'form_service', contract_forms: forms });
  await accountRepo.create({ name: 'Chewy', account_type: 'supplier', contract_forms: forms });
  assert.deepEqual((await send.loadContractForms()).map((f) => f.account_name), ['Jotform']);
});

test('a sale sends its newest open contract; signed, void and archived ones are left alone', async () => {
  assert.equal(await send.openContractForSale(sale.id), null);
  await contractRepo.create({ contract_type: 'sale', related_sale_id: sale.id, kennel_id: K.id, status: 'signed' });
  await contractRepo.create({ contract_type: 'sale', related_sale_id: sale.id, kennel_id: K.id, status: 'draft', is_archived: true });
  assert.equal(await send.openContractForSale(sale.id), null);
  const open = await contractRepo.create({ contract_type: 'sale', related_sale_id: sale.id, kennel_id: K.id, status: 'draft' });
  assert.equal((await send.openContractForSale(sale.id)).id, open.id);
});

test('a sale contract\'s link carries the buyer, the pup, its parents and what\'s still owed; sending marks it sent', async () => {
  const c = await contractRepo.create({ contract_type: 'sale', related_sale_id: sale.id, kennel_id: K.id, status: 'draft', title: 'Pet home: Maple' });
  const facts = await send.gatherContractFacts(c);
  assert.equal(facts.balanceDue, 2200, 'nothing paid yet');
  const form = { id: 'f1', form_type: 'pet_home', label: 'Pet home', url: 'https://form.jotform.com/1' };
  const { url } = send.buildSignatureLink(form, facts);
  const q = new URL(url).searchParams;
  assert.equal(q.get('buyerEmail'), 'jane@example.com');
  assert.equal(q.get('puppyName'), 'Maple');
  assert.equal(q.get('sireName'), 'Briar Hollow Cassius');
  assert.equal(q.get('damName'), 'Opal');
  assert.equal(q.get('kennelLocation'), 'Woodstock, VT');
  assert.equal(q.get('balanceDue'), '2200.00');
  assert.equal(q.get('contractRef'), c.id);
  const sent = await send.markContractSent(c, form, url);
  assert.equal(sent.status, 'sent');
  assert.equal(sent.esign_provider, 'jotform');
  assert.equal(sent.esign_form_label, 'Pet home');
  assert.match(sent.esign_sent_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((await send.markContractSent({ ...sent, status: 'signed' }, form, url)).status, 'signed', 'never moves a signed one back');
});

test('the message she sent herself is logged as sent and never queued for the mailer', async () => {
  const entry = await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: buyer.id, status: 'active', listen_mode: 'all', pref_sex: 'any' });
  const m = await logOwnMessage(entry.id, { kind: 'deposit_request', subject: '  Maple:\n your deposit ', body: 'Hi' });
  assert.equal(m.status, 'sent');
  assert.equal(m.via, 'own');
  assert.equal(m.subject, 'Maple: your deposit');
  const saved = await waitlistEntryRepo.getById(entry.id);
  assert.equal(saved.messages.length, 1);
  assert.deepEqual(queuedEmails([saved]), []);
});
