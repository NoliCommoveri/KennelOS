// A sale's separate agreements (contractAddOns.js): transport, delayed pickup, and
// one agreement per extra (a training package with its stay).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addOnFacts, extraFor, extraChoices, pickupToSet, formKindOptionsHtml, readFormKind } from '../shared/data/contractAddOns.js';
import { prefillValues, rankForms, cleanForms, addOnApplies, agreementKey } from '../shared/data/contractForms.js';
import { CONTRACT_FORM_TYPE } from '../shared/data/vocab.js';
import { kennelChargeList } from '../shared/data/extraCharges.js';
import { withTemplateRow } from '../shared/data/esignTemplates.js';

const TODAY = '2026-11-12';
const litter = { estimated_ready_date: '2026-12-10' };
const priceList = [
  { id: 'two', label: '2-week training', amount: 600, group: 'Training', boarding_days: 14, description: 'Crate and potty basics' },
  { id: 'four', label: '4-week training', amount: 1100, group: 'Training', boarding_days: 28 },
  { id: 'photos', label: 'Photo package', amount: 75, group: 'Photos' }
];
const sale = {
  id: 's1', dog_id: 'p1', buyer_contact_id: 'b1', status: 'deposit_paid', price: 3000, deposit_amount: 500,
  balance_due_date: '2026-12-03', transport_fee: 450,
  deferred_boarding_amount: 25, deferred_boarding_frequency: 'Day', deferred_boarding_duration_days: '5',
  extra_charges: [
    { id: 'c1', label: '2-week training', amount: 600, list_id: 'two', boarding_days: 14,
      payments: [{ id: 'a', percent: 50, due: 'at_weeks', n: 6, due_date: '2026-11-26' }, { id: 'b', percent: 50, due: 'with_balance' }] },
    { id: 'c2', label: 'Photo package', amount: 75 },
    { id: 'c3', label: 'Card fee', amount: 15, fee_for: 'deposit' }
  ]
};

test('a training package: its own fields, the stay projected until logged, then as logged', () => {
  const a = addOnFacts({ sale, events: [], litter, priceList, today: TODAY });
  const x = extraFor(a, 'two');
  assert.equal(x.charge.id, 'c1');
  assert.deepEqual(x.stay, { start: '2026-12-10', end: '2026-12-23', logged: false });
  assert.equal(a.pickupFrom, '2026-12-24', 'home the day after training');
  assert.equal(extraFor(a, 'photos').charge.id, 'c2', 'a charge typed by hand, matched by name');
  assert.equal(a.extras.some((e) => e.charge.fee_for), false, 'a fee charge-back is no agreement');

  const v = Object.fromEntries(prefillValues({ form_type: 'extra', extra_list_id: 'two' }, { sale, addOns: a }));
  assert.equal(v.extraName, '2-week training');
  assert.equal(v.extraDescription, 'Crate and potty basics');
  assert.equal(v.extraPrice, '600.00');
  assert.equal(v.extraPayments, '50% (300.00) due 2026-11-26; 50% (300.00) due 2026-12-03');
  assert.deepEqual([v.extraPayment1Amount, v.extraPayment1Due, v.extraPayment2Due], ['300.00', '2026-11-26', '2026-12-03']);
  assert.deepEqual([v.extraStayDays, v.extraStayStart, v.extraStayEnd], ['14', '2026-12-10', '2026-12-23']);
  assert.equal(v.transportFee, undefined, 'only its own group');

  const stay = { subject_type: 'dog', subject_id: 'p1', event_type: 'boarding', event_date: '2026-12-14', event_end_date: '2026-12-27',
    details: { sale_id: 's1', extra_charge_id: 'c1' } };
  const logged = addOnFacts({ sale, events: [stay], litter, priceList, today: TODAY });
  assert.deepEqual(extraFor(logged, 'two').stay, { start: '2026-12-14', end: '2026-12-27', logged: true });
  assert.equal(logged.pickupFrom, '2026-12-28');

  const other = Object.fromEntries(prefillValues({ form_type: 'extra', extra_list_id: 'four' }, { sale, addOns: a }));
  assert.equal(other.extraName, undefined, 'the sale has no 4-week training');
});

test('transport and boarding: from the sale and its drop-off; boarding starts after training', () => {
  const dropoff = { subject_type: 'dog', subject_id: 'p1', event_type: 'placement', event_date: '2026-12-30', related_contact_id: 'b1',
    details: { dropoff_method: 'Flight nanny', placement_time: '10:00', location: 'ATL airport' } };
  const a = addOnFacts({ sale, events: [dropoff], litter, priceList, today: TODAY });
  const t = Object.fromEntries(prefillValues('transport', { sale, addOns: a }));
  assert.deepEqual([t.transportFee, t.deliveryDate, t.deliveryPlace, t.transportDueDate],
    ['450.00', '2026-12-30', 'ATL airport', '2026-12-03']);
  const b = Object.fromEntries(prefillValues('boarding', { sale, addOns: a }));
  assert.deepEqual([b.boardingRate, b.boardingPer, b.boardingLength, b.boardingTotal, b.boardingStart, b.boardingEnd],
    ['25.00', 'Day', '5 days', '125.00', '2026-12-24', '2026-12-29']);
  assert.ok(b.price, 'the sale\'s own fields come too');
});

test('separate agreements are offered first only when the sale has them; an Extra form keeps its extra', () => {
  const forms = cleanForms([
    { id: 'p', form_type: 'pet_home', label: 'Pet home', url: 'https://x.test/p' },
    { id: 't', form_type: 'transport', label: 'Transport', url: 'https://x.test/t' },
    { id: 'e2', form_type: 'extra', label: '2-week training agreement', url: 'https://x.test/e2', extra_list_id: 'two' },
    { id: 'e4', form_type: 'extra', label: '4-week training agreement', provider: 'firma', template_id: 'tpl_4', extra_list_id: 'four' },
    { id: 'pl', form_type: 'pet_home', label: 'Stray', url: 'https://x.test/s', extra_list_id: 'two' }
  ]);
  assert.equal(forms.find((f) => f.id === 'e4').extra_list_id, 'four');
  assert.equal('extra_list_id' in forms.find((f) => f.id === 'pl'), false, 'only an Extra agreement names one');
  const r = rankForms(forms, { contract_type: 'sale' }, { ...sale, registration_type: 'limited' });
  assert.deepEqual(r.matching.map((f) => f.id), ['p', 'pl', 't', 'e2']);
  assert.deepEqual(r.others.map((f) => f.id), ['e4']);
  assert.equal(addOnApplies({}, 'boarding', { deferred_boarding_amount: 0 }), false);

  let rows = withTemplateRow([], { templateId: 'tpl_4', name: '4-week', formType: 'extra', extraListId: 'four' });
  rows = withTemplateRow(rows, { templateId: 'tpl_4', name: '4-week', formType: 'extra', countersign: true });
  assert.equal(rows[0].extra_list_id, 'four', 'kept through another change');
  rows = withTemplateRow(rows, { templateId: 'tpl_4', name: '4-week', formType: 'pet_home' });
  assert.equal('extra_list_id' in rows[0], false);
});

test('the extras she can pick: every own kennel\'s price list, once each', () => {
  const kennels = [
    { id: 'k1', kennel_name: 'Maple', is_own_kennel: true, extra_charge_list: priceList },
    { id: 'k2', kennel_name: 'Outside', is_own_kennel: false, extra_charge_list: [{ id: 'z', label: 'Theirs', amount: 1 }] }
  ];
  assert.deepEqual(extraChoices(kennels, kennelChargeList).map((c) => [c.id, c.label, c.kennelName]),
    [['two', '2-week training', ''], ['four', '4-week training', ''], ['photos', 'Photo package', '']]);
});

test('one pick for a form\'s kind: her types, and each extra by name', () => {
  const esc = (v) => String(v);
  const choices = extraChoices([{ id: 'k1', kennel_name: 'Maple', is_own_kennel: true, extra_charge_list: priceList }], kennelChargeList);
  const html = formKindOptionsHtml(CONTRACT_FORM_TYPE, choices, { formType: 'extra', extraListId: 'two' }, esc);
  assert.ok(html.includes('<option value="extra:two" selected>Agreement: 2-week training</option>'));
  assert.ok(html.includes('<optgroup label="Extra agreements">'));
  assert.ok(!html.includes('value="extra"'), 'the bare type is never a pick');
  assert.ok(html.includes('<option value="boarding">Boarding agreement</option>'));
  assert.ok(formKindOptionsHtml(CONTRACT_FORM_TYPE, choices, { formType: 'extra', extraListId: 'old' }, esc)
    .includes('<option value="extra:old" selected>Agreement: (no longer on your price list)</option>'), 'a removed extra stays, marked');
  assert.deepEqual(readFormKind('extra:two'), { formType: 'extra', extraListId: 'two' });
  assert.deepEqual(readFormKind('pet_home'), { formType: 'pet_home', extraListId: '' });
  assert.deepEqual(readFormKind(''), { formType: '', extraListId: '' });
});

test('a boarding or training agreement with no pickup on the calendar asks for one', () => {
  const none = addOnFacts({ sale, events: [], litter, priceList, today: TODAY });
  assert.equal(pickupToSet({ form_type: 'boarding' }, none), '2026-12-29', 'the day after the 5 days of boarding');
  assert.equal(pickupToSet({ form_type: 'extra', extra_list_id: 'two' }, none), '2026-12-24', 'the day after the stay');
  assert.equal(pickupToSet({ form_type: 'extra', extra_list_id: 'photos' }, none), null, 'an extra with no stay');
  assert.equal(pickupToSet({ form_type: 'transport' }, none), null);
  assert.equal(pickupToSet({ form_type: 'pet_home' }, none), null);
  assert.equal(pickupToSet({ form_type: 'boarding' }, addOnFacts({ sale: { ...sale, deferred_boarding_amount: 0 }, events: [], litter, priceList, today: TODAY })), null, 'no boarding on the sale');
  const pickup = { subject_type: 'dog', subject_id: 'p1', event_type: 'placement', event_date: '2026-12-30', related_contact_id: 'b1', details: {} };
  const set = addOnFacts({ sale, events: [pickup], litter, priceList, today: TODAY });
  assert.equal(pickupToSet({ form_type: 'boarding' }, set), null, 'already on the calendar');
});

test('an Extra agreement is offered whenever it would fill; each agreement has its own key', () => {
  const a = addOnFacts({ sale, events: [], litter, priceList, today: TODAY });
  const photos = { form_type: 'extra', extra_list_id: 'photos' };
  assert.equal(addOnApplies(photos, 'extra', sale), false, 'a charge typed by hand has no link');
  assert.equal(addOnApplies(photos, 'extra', sale, a), true, 'matched by name, as it fills');
  assert.equal(addOnApplies({ form_type: 'extra', extra_list_id: 'four' }, 'extra', sale, a), false);
  const forms = cleanForms([{ id: 'ph', form_type: 'extra', label: 'Photos', url: 'https://x.test/ph', extra_list_id: 'photos' }]);
  assert.deepEqual(rankForms(forms, { contract_type: 'sale' }, sale, a).matching.map((f) => f.id), ['ph']);
  assert.deepEqual(['pet_home', 'deposit', 'transport', 'boarding'].map((t) => agreementKey({ form_type: t })), ['', '', 'transport', 'boarding']);
  assert.equal(agreementKey(photos), 'extra:photos');
});
