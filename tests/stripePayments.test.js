// stripePayments.test.js — Integrations plan §4–§5 (steps 6 and the application
// fee, 2026-10-12): the fee estimated per payment from the account each part is
// paid via, the Stripe call builders and their reading of a paid session, the
// fee rule when Stripe reports a payment's real fee, and end to end on the
// in-memory database with Stripe stubbed: her key on the device, a one-time sale
// link paid, and a waitlist application fee paid before and after approval.
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { saleFeeEstimate } from '../shared/data/processingFees.js';
import { linkParams, sessionPayment, feeSessionPayment } from '../shared/data/stripeApi.js';
import { planIntegrationEvent } from '../shared/data/integrationEvents.js';
import { feeCharge, withClientRef, feePay, planFeePayment } from '../shared/data/waitlistFeePay.js';

const PS = 'payment_service';
const stripeAcct = { id: 'st', name: 'Stripe', account_type: PS, fee_percent: 2.9, fee_fixed: 0.3 };
const zelle = { id: 'ze', name: 'Zelle', account_type: PS, payment_instructions: 'Zelle to me' };
const goodDog = { id: 'gd', name: 'Good Dog', account_type: 'marketplace', fee_percent: 6.25 };
const byId = new Map([stripeAcct, zelle, goodDog].map((a) => [a.id, a]));

// --- The fee, per payment ------------------------------------------------------------

test('saleFeeEstimate: each payment at its own account\'s rate; Sold through alone covers the whole price', () => {
  const sale = { price: 3000, deposit_amount: 500, deposit_paid_via_account_id: 'st', balance_paid_via_account_id: 'ze' };
  assert.deepEqual(saleFeeEstimate(sale, byId), { total: 14.8, parts: { deposit: 14.8, balance: null } }, '2.9% + $0.30 on $500; Zelle is free');
  assert.deepEqual(saleFeeEstimate({ ...sale, balance_paid_via_account_id: 'st' }, byId).total, 14.8 + 72.8);
  const marketplace = saleFeeEstimate({ price: 3200, deposit_amount: 500, sales_channel_account_id: 'gd' }, byId);
  assert.equal(marketplace.total, 200);
  assert.equal(marketplace.parts.deposit + marketplace.parts.balance, 200);
  assert.equal(saleFeeEstimate({ price: 3000, deposit_paid_via_account_id: 'ze' }, byId), null, 'no rate anywhere');
});

test('a reported fee replaces its part\'s estimate; a fee she typed is left and reviewed', () => {
  const estimate = { total: 87.6, parts: { deposit: 14.8, balance: 72.8 } };
  const ev = (component, fee, ref) => ({ seq: 1, provider: 'stripe', kind: 'payment.paid', recordType: 'sale', recordId: 's',
    payload: { component, amount: 500, fee, date: '2026-10-12', reference: ref }, createdAt: '2026-10-12T00:00:00Z' });
  const dep = planIntegrationEvent(ev('deposit', 15.1, 'pi_1'), { status: 'deposit_pending', processing_fee_amount: 87.6 }, { estimate });
  assert.equal(dep.changes.processing_fee_amount, 87.9, 'deposit: 15.10 reported + 72.80 still estimated');
  assert.deepEqual(dep.changes.processing_fee_reports, [{ ref: 'pi_1', fee: 15.1, date: '2026-10-12', component: 'deposit' }]);

  const after = { status: 'deposit_paid', deposit_date: '2026-10-12', processing_fee_amount: 87.9, processing_fee_reports: dep.changes.processing_fee_reports };
  const bal = planIntegrationEvent(ev('balance', 73, 'pi_2'), after, { estimate });
  assert.equal(bal.changes.processing_fee_amount, 88.1, 'both parts reported');

  const typed = planIntegrationEvent(ev('deposit', 15.1, 'pi_1'), { status: 'deposit_pending', processing_fee_amount: 50 }, { estimate });
  assert.equal(typed.changes.status, 'deposit_paid', 'the payment is still applied');
  assert.equal(typed.changes.processing_fee_amount, undefined);
  assert.match(typed.review.reason, /which you entered/);

  const again = planIntegrationEvent(ev('deposit', 15.1, 'pi_1'), { status: 'deposit_pending', processing_fee_reports: dep.changes.processing_fee_reports }, { estimate });
  assert.equal(again.changes.processing_fee_reports, undefined, 'a payment\'s fee counts once');
});

// --- Stripe, the pure parts --------------------------------------------------------------

test('linkParams: a sale\'s link is one-use with its sale in the metadata; a fee link is reusable', () => {
  const sale = linkParams({ amount: 500, currency: 'usd', name: 'Deposit: Maple', saleId: 's1', component: 'deposit' });
  assert.deepEqual(sale.price, { currency: 'usd', unit_amount: 50000, product_data: { name: 'Deposit: Maple' } });
  const link = sale.link('price_1');
  assert.deepEqual(link.restrictions, { completed_sessions: { limit: 1 } });
  assert.deepEqual(link.metadata, { kennelos_sale_id: 's1', kennelos_component: 'deposit' });
  const fee = linkParams({ amount: 51.79, name: 'Fee', feeFor: 'kos1_x' }).link('price_2');
  assert.equal(fee.restrictions, undefined);
  assert.deepEqual(fee.metadata, { kennelos_purpose: 'waitlist_fee', kennelos_kennel: 'kos1_x' });
  assert.equal(linkParams({ amount: 51.79, name: 'Fee', feeFor: 'k' }).price.unit_amount, 5179);
});

const paidSession = (meta, extra = {}) => ({
  id: 'cs_1', status: 'complete', payment_status: 'paid', amount_total: 50000, currency: 'usd', created: 1760270400,
  metadata: meta, payment_intent: { id: 'pi_1', latest_charge: { balance_transaction: { fee: 1480 } } }, ...extra
});

test('sessionPayment / feeSessionPayment read what was paid and the fee Stripe kept', () => {
  const p = sessionPayment(paidSession({ kennelos_sale_id: 's1', kennelos_component: 'deposit' }), { timeZoneDate: () => '2026-10-12' });
  assert.deepEqual(p, { saleId: 's1', sessionId: 'cs_1', payload: { component: 'deposit', amount: 500, fee: 14.8, currency: 'USD', date: '2026-10-12', method: 'Credit/debit card', reference: 'pi_1' } });
  assert.equal(sessionPayment(paidSession({})), null, 'not ours');
  const f = feeSessionPayment(paidSession({ kennelos_purpose: 'waitlist_fee' }, { client_reference_id: 'entry-1', amount_total: 5179 }), { timeZoneDate: () => '2026-10-12' });
  assert.equal(f.entryId, 'entry-1');
  assert.equal(f.payload.amount, 51.79);
  assert.equal(feeSessionPayment(paidSession({ kennelos_purpose: 'waitlist_fee' })), null, 'no family on it');
});

test('the application fee: what the family pays, their link, and what a payment does', () => {
  const passing = { ...stripeAcct, fee_passed_to_buyer_default: true };
  assert.deepEqual(feeCharge(50, stripeAcct), { charge: 50, passed: false });
  assert.deepEqual(feeCharge(50, passing), { charge: 51.81, passed: true }, '(50 + 0.30) ÷ 0.971, rounded up to the cent');
  assert.equal(withClientRef('https://buy.stripe.com/x', 'e1'), 'https://buy.stripe.com/x?client_reference_id=e1');
  assert.equal(withClientRef('https://square.link/u/x', 'e1'), 'https://square.link/u/x', 'only a Stripe link');

  const kennel = { waitlist_fee_account_id: 'st', waitlist_config: { fee_links: [{ account_id: 'st', amount: 50, charge: 50, url: 'https://buy.stripe.com/fee', ref: 'plink_1' }] } };
  assert.deepEqual(feePay(kennel, [stripeAcct], 50), { url: 'https://buy.stripe.com/fee', amount: 50, stripe: true });
  assert.equal(feePay(kennel, [stripeAcct], 75), null, 'no link for that amount, and no own link');
  assert.deepEqual(feePay({ waitlist_fee_account_id: 'sq' }, [{ id: 'sq', account_type: PS, payment_link: 'https://square.link/u/x' }], 50),
    { url: 'https://square.link/u/x', amount: 50, stripe: false });
  assert.equal(feePay({ waitlist_fee_account_id: 'gd' }, [goodDog], 50), null, 'a Payment service only');

  const p = { date: '2026-10-12', amount: 50, fee: 1.75, method: 'Credit/debit card', reference: 'pi_9' };
  assert.equal(planFeePayment({ status: 'approved' }, p, 'st').op, 'received');
  const pre = planFeePayment({ status: 'applied' }, p, 'st');
  assert.equal(pre.op, 'prepaid');
  assert.equal(pre.changes.fee_paid_online.date, '2026-10-12');
  assert.equal(pre.changes.fee_processing_amount, 1.75);
  assert.equal(planFeePayment({ status: 'active', fee_received_date: '2026-10-01', fee_payment_reference: 'pi_9' }, p, 'st').op, 'skip');
  assert.equal(planFeePayment(null, p, 'st').op, 'skip');
});

// --- End to end, Stripe stubbed -----------------------------------------------------------

let db; let stripe; let accountRepo; let saleRepo; let kennelRepo; let dogRepo; let contactRepo; let waitlistEntryRepo; let actions; let incomeView;
let stripeCalls; let sessionsByLink;
const realFetch = globalThis.fetch;
const KEY = 'rk_test_abcdefghij0123456789';

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  stripe = await import('../shared/data/stripeLinks.js');
  ({ accountRepo } = await import('../shared/data/accountRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ waitlistEntryRepo } = await import('../shared/data/waitlistEntryRepo.js'));
  actions = await import('../shared/data/waitlistActions.js');
  incomeView = await import('../shared/data/incomeView.js');
});

beforeEach(() => {
  stripeCalls = [];
  sessionsByLink = {};
  let n = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    stripeCalls.push({ method: opts.method, path: u.pathname, auth: opts.headers?.Authorization, body: opts.body ? String(opts.body) : '' });
    const ok = (body) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });
    if (u.pathname === '/v1/payment_links' && opts.method === 'GET') return ok({ data: [] });
    if (u.pathname === '/v1/prices') return ok({ id: `price_${++n}` });
    if (u.pathname === '/v1/payment_links') { n++; return ok({ id: `plink_${n}`, url: `https://buy.stripe.com/test_${n}` }); }
    if (u.pathname === '/v1/checkout/sessions') return ok({ data: sessionsByLink[u.searchParams.get('payment_link')] || [] });
    return { ok: false, status: 404, statusText: 'nf', json: async () => ({ error: { message: 'no' } }) };
  };
  localStorage.clear();
});
afterEach(() => { globalThis.fetch = realFetch; });

async function setup() {
  const k = await kennelRepo.create({ kennel_name: `Test Boston ${Math.random()}`, is_own_kennel: true });
  const acct = await accountRepo.create({ name: 'Stripe', account_type: PS, fee_percent: 2.9, fee_fixed: 0.3 });
  await stripe.connectStripe(acct.id, KEY, 'usd');
  return { k, acct };
}

test('connect: a restricted key only, checked with Stripe, kept on this device and never in a backup', async () => {
  const acct = await accountRepo.create({ name: 'Stripe', account_type: PS });
  await assert.rejects(stripe.connectStripe(acct.id, 'sk_live_abcdefghij0123456789'), /full secret key/);
  await assert.rejects(stripe.connectStripe(acct.id, 'nope'), /restricted key/);
  assert.equal(stripeCalls.length, 0);
  const c = await stripe.connectStripe(acct.id, KEY, 'usd');
  assert.equal(c.testMode, true);
  assert.equal(stripeCalls[0].auth, `Bearer ${KEY}`);
  const { exportAll } = await import('../shared/data/importExport.js');
  assert.ok(!JSON.stringify(await exportAll()).includes(KEY));
  await stripe.disconnectStripe(acct.id);
  assert.equal(await stripe.stripeConnection(acct.id), null);
});

test('a one-time deposit link, paid: the sale moves on, with Stripe\'s fee in place of the estimate', async () => {
  const { k, acct } = await setup();
  const buyer = await contactRepo.create({ name: 'Ann Buyer' });
  const pup = await dogRepo.create({ call_name: 'Maple', breed: 'Lab', sex: 'female', ownership_type: 'owned', status: 'puppy', kennel_id: k.id });
  let sale = await saleRepo.create({ dog_id: pup.id, buyer_contact_id: buyer.id, registration_type: 'limited', status: 'deposit_pending', price: 3000, deposit_amount: 500, kennel_id: k.id,
    deposit_paid_via_account_id: acct.id, processing_fee_amount: 14.8 });
  sale = await stripe.makeSaleLink({ sale, account: acct, component: 'deposit', amount: 500, pupName: 'Maple' });
  assert.equal(sale.payment_link_ref, 'plink_2');
  assert.equal(sale.payment_link_url, 'https://buy.stripe.com/test_2');
  assert.match(stripeCalls.find((c) => c.path === '/v1/payment_links' && c.method === 'POST').body, /kennelos_sale_id%5D=/);

  assert.deepEqual(await stripe.checkStripePayments({ force: true }), { applied: 0, review: 0, skipped: 0, checked: 1, feesReceived: 0, feesPrepaid: 0 }, 'not paid yet');
  sessionsByLink.plink_2 = [paidSession({ kennelos_sale_id: sale.id, kennelos_component: 'deposit' }, { payment_intent: { id: 'pi_1', latest_charge: { balance_transaction: { fee: 1510 } } } })];
  const res = await stripe.checkStripePayments({ force: true });
  assert.equal(res.applied, 1);
  const after = await saleRepo.getById(sale.id);
  assert.equal(after.status, 'deposit_paid');
  assert.equal(after.payment_method, 'Credit/debit card');
  assert.equal(after.payment_reference, 'pi_1');
  assert.equal(after.processing_fee_amount, 15.1, 'the real fee replaced the deposit\'s estimate');
  assert.equal(after.payment_link_ref, null, 'the paid link is cleared');
  assert.equal(await stripe.checkStripePayments(), null, 'not due again for 15 minutes');
});

test('the application fee: a Stripe link per amount; paid before approval it waits, approval uses it; Income nets the fee', async () => {
  const { k, acct } = await setup();
  await kennelRepo.update(k.id, { waitlist_fee_account_id: acct.id, waitlist_config: { fee_amount: 50 } });
  const { ensureFeeLinks } = await import('../shared/data/waitlistFeeLinks.js');
  const kennel = await ensureFeeLinks(await kennelRepo.getById(k.id));
  const [link] = kennel.waitlist_config.fee_links;
  assert.deepEqual({ amount: link.amount, charge: link.charge, account_id: link.account_id }, { amount: 50, charge: 50, account_id: acct.id });
  const made = stripeCalls.filter((c) => c.path === '/v1/payment_links' && c.method === 'POST').length;
  await ensureFeeLinks(kennel);
  assert.equal(stripeCalls.filter((c) => c.path === '/v1/payment_links' && c.method === 'POST').length, made, 'made once');

  const entry = await waitlistEntryRepo.create({ kennel_id: k.id, status: 'applied', applied_date: '2026-10-10', application: { name: 'Ann Lee', email: 'ann@example.com' } });
  sessionsByLink[link.ref] = [paidSession({ kennelos_purpose: 'waitlist_fee' }, { id: 'cs_fee', client_reference_id: entry.id, amount_total: 5000,
    payment_intent: { id: 'pi_fee', latest_charge: { balance_transaction: { fee: 175 } } } })];
  const res = await stripe.checkStripePayments({ force: true });
  assert.equal(res.feesPrepaid, 1);
  const pre = await waitlistEntryRepo.getById(entry.id);
  assert.equal(pre.status, 'applied');
  assert.equal(pre.fee_paid_online.reference, 'pi_fee');
  assert.equal(pre.fee_processing_amount, 1.75);
  assert.equal(pre.fee_paid_via_account_id, acct.id);
  assert.equal((await stripe.checkStripePayments({ force: true })).feesPrepaid, 0, 'once');

  const approved = await actions.approve(entry.id, { date: '2026-10-14' });
  assert.equal(approved.status, 'active');
  assert.equal(approved.fee_received_date, pre.fee_paid_online.date, 'on the list from the day they paid');
  const row = (await incomeView.getIncomeRows({ kennelId: k.id })).find((r) => r.source_id === entry.id);
  assert.equal(row.earned, 48.25, '$50 less the $1.75 Stripe kept');
});
