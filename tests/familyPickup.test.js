// familyPickup.test.js — pickup places and times, the transport fee, and a family's
// pickup view (docs/KennelOS_Family_Requests_Plan.md §4–§5): pure parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transportQuote, mapsLink, aboutMiles } from '../shared/data/transportFee.js';
import { pickupLocations, standardLocation, locationsProblem, makeSlots, cleanSlots, familySlots, slotBookings, timeRange, changeUntil, dateRules, withDateRule, ruleFor, standardBoarding } from '../shared/data/pickupSlots.js';
import { ownPlaceAllowed, pickupFrom, familyPickupView, withPickupRequest, requestText, PICKUP_EARLY_DAYS, pickupWish } from '../shared/data/familyPickup.js';
import { formQuestions, DEFAULT_FORM_QUESTIONS } from '../shared/data/waitlistForm.js';

test('the transport fee shows its working: round trip doubles, "no charge under" is all or nothing', () => {
  assert.deepEqual(transportQuote(340, { mileage_rate: 1.5, mileage_basis: 'round_trip' }),
    { charged_miles: 680, fee: 1020, free: false, far: false, text: '340 miles one way × 2 (round trip) = 680 × $1.50 = $1,020.00' });
  assert.equal(transportQuote(340, { mileage_rate: 1.5, mileage_basis: 'one_way' }).fee, 510);
  const free = transportQuote(9, { mileage_rate: 1.5, mileage_free_under: 25 });
  assert.deepEqual([free.fee, free.free, free.text], [0, true, '9 miles one way, 18 miles round trip: under your 25, no charge']);
  assert.equal(transportQuote(13, { mileage_rate: 1, mileage_free_under: 25 }).fee, 26, 'at or over the limit every mile counts, from the first');
  assert.equal(transportQuote(200, { transport_far_miles: 150 }).far, true);
  assert.equal(transportQuote(100, {}).fee, null, 'no rate: no fee worked out');
  assert.match(transportQuote(100, {}).text, /Set a fee per mile/);
  assert.equal(aboutMiles(339.6), 'about 340 miles');
  assert.equal(mapsLink('Library, Austin TX', '1 Main St'), 'https://www.google.com/maps/dir/?api=1&origin=Library%2C+Austin+TX&destination=1+Main+St');
});

test('her places: one standard, named and addressed', () => {
  const places = pickupLocations({ pickup_locations: [
    { id: 'a', label: 'Library', address: '1 Main St', show_to_families: true },
    { id: 'b', label: 'Home', address: '2 Elm', is_standard: true, show_to_families: false },
    { id: 'c', label: '', address: 'x' }
  ] });
  assert.deepEqual(places.map((l) => [l.id, l.is_standard, l.show_to_families]), [['a', false, true], ['b', true, false]]);
  assert.equal(standardLocation({ pickup_locations: [{ id: 'a', label: 'L', address: 'A' }] }).id, 'a', 'none marked: the first');
  assert.match(locationsProblem([{ label: 'Library', address: '' }]), /address for Library/);
  assert.equal(locationsProblem([{ label: '', address: '' }]), '');
});

test('Add times makes a run at each place; a family sees what has room, from when the pup is ready', () => {
  const { slots, error } = makeSlots({ date: '2026-11-21', from: '10:00', to: '11:00', length: 30, locationIds: ['a', 'b'] });
  assert.equal(error, '');
  assert.deepEqual(slots.map((s) => [s.location_id, s.start_time, s.end_time]), [['a', '10:00', '10:30'], ['a', '10:30', '11:00'], ['b', '10:00', '10:30'], ['b', '10:30', '11:00']]);
  assert.match(makeSlots({ date: '2026-11-21', from: '11:00', to: '10:00', locationIds: ['a'] }).error, /after/);
  assert.match(makeSlots({ date: '2026-11-21', from: '10:00', to: '11:00', locationIds: [] }).error, /place/);
  assert.equal(timeRange({ start_time: '13:00', end_time: '13:30' }), '1:00 PM–1:30 PM');
  assert.equal(changeUntil('2026-11-21', 2), '2026-11-19');

  const locations = pickupLocations({ pickup_locations: [{ id: 'a', label: 'Library', address: '1 Main St' }, { id: 'b', label: 'Home', address: '2 Elm', show_to_families: false }] });
  const all = cleanSlots([...slots, { id: 'early', date: '2026-11-10', start_time: '09:00', end_time: '09:30', location_id: 'a' }]);
  const booked = slotBookings([{ event_type: 'placement', details: { pickup_slot_id: slots[0].id } }], [{ pickup_requests: [{ kind: 'slot', slot_id: slots[1].id }] }]);
  const open = familySlots({ slots: all, locations, bookings: booked, from: '2026-11-15', today: '2026-11-01' });
  assert.deepEqual(open, [], 'both Library times taken, Home hidden, the early one before the pup is ready');
  const mine = familySlots({ slots: all, locations, bookings: booked, from: '2026-11-15', today: '2026-11-01', mine: slots[0].id });
  assert.deepEqual(mine.map((s) => [s.id, s.left, s.location.label]), [[slots[0].id, 1, 'Library']], 'their own booking always shows');
});

test('who may suggest their own place: anyone, unless her distance rule says how far they must live; her choice wins', () => {
  assert.equal(ownPlaceAllowed({}, {}), true);
  const rule = { transport_min_home_miles: 200 };
  assert.equal(ownPlaceAllowed({}, rule), null, 'not known yet: their page asks');
  assert.equal(ownPlaceAllowed({ home_miles: 250 }, rule), true);
  assert.equal(ownPlaceAllowed({ home_miles: 120 }, rule), false);
  assert.equal(ownPlaceAllowed({ home_miles: 120, own_place_override: true }, rule), true);
  assert.equal(ownPlaceAllowed({ own_place_override: false }, {}), false);
});

test('their page asks where they live only while no place is known; an unmeasured place is hers to decide', () => {
  const sale = { id: 's1', dog_id: 'p1', buyer_contact_id: 'c1', status: 'deposit_paid', kennel_id: 'k1' };
  const base = { sales: [sale], dogsById: new Map([['p1', { id: 'p1', litter_id: 'l1' }]]), litters: [{ id: 'l1', whelp_date: '2026-09-01' }],
    kennel: {}, config: { transport_min_home_miles: 100 }, today: '2026-10-20' };
  const ask = (entry) => { const v = familyPickupView({ ...base, entry: { contact_id: 'c1', kennel_id: 'k1', ...entry } }); return [v?.own_place, v?.ask_home]; };
  assert.deepEqual(ask({}), [null, true], 'nothing known: asked');
  assert.deepEqual(ask({ home_place: 'Dallas, TX', home_miles: null, home_measured_date: '2026-10-19' }), [null, false], 'answered but not measured: not asked again');
  assert.deepEqual(ask({ home_place: 'Dallas, TX', home_miles: 190 }), [true, false]);
  assert.deepEqual(ask({ home_place: 'Dallas, TX', home_miles: null, own_place_override: true }), [true, false], 'her choice');
});

test('their times start after a training stay; their page shows the booking with its change date', () => {
  const sale = { id: 's1', dog_id: 'p1', buyer_contact_id: 'c1', status: 'deposit_paid', kennel_id: 'k1' };
  const litter = { id: 'l1', whelp_date: '2026-09-01', pickup_slots: [
    { id: 'x1', date: '2026-10-30', start_time: '10:00', end_time: '10:30', location_id: 'a' },
    { id: 'x2', date: '2026-11-20', start_time: '10:00', end_time: '10:30', location_id: 'a' }
  ] };
  const stay = { id: 'b1', event_type: 'boarding', subject_id: 'p1', event_date: '2026-10-27', event_end_date: '2026-11-09', details: { sale_id: 's1', extra_charge_id: 'c1' } };
  assert.equal(pickupFrom(sale, litter, []), '2026-10-27', 'the ready date (8 weeks)');
  assert.equal(pickupFrom(sale, litter, [stay]), '2026-11-10', 'the day after the stay');
  const kennel = { pickup_locations: [{ id: 'a', label: 'Library', address: '1 Main St' }] };
  const base = { entry: { contact_id: 'c1', kennel_id: 'k1' }, sales: [sale], dogsById: new Map([['p1', { id: 'p1', litter_id: 'l1' }]]), litters: [litter], kennel,
    config: { pickup_change_days: 2, transport_far_miles: 150 }, today: '2026-10-20' };
  const v = familyPickupView({ ...base, events: [stay] });
  assert.deepEqual(v.slots.map((s) => s.id), ['x2']);
  assert.deepEqual([v.own_place, v.ask_home, v.far_miles], [true, false, 150]);
  const pickup = { id: 'e1', event_type: 'placement', subject_id: 'p1', related_contact_id: 'c1', event_date: '2026-11-20', details: { pickup_slot_id: 'x2' } };
  const withBooking = familyPickupView({ ...base, events: [stay, pickup] });
  assert.deepEqual(withBooking.booked, { kind: 'slot', date: '2026-11-20', start_time: '10:00', end_time: '10:30', place: 'Library', address: '1 Main St', change_until: '2026-11-18' });
  assert.equal(familyPickupView({ ...base, sales: [{ ...sale, status: 'delivered' }], events: [] }), null, 'no open sale: nothing');
  const req = { id: 'event-1', kind: 'address', address: '9 Oak, Dallas TX', miles: 196.4, requested_date: '2026-10-20' };
  assert.equal(withPickupRequest({ pickup_requests: [req] }, req), null);
  assert.equal(requestText(req), 'to meet at 9 Oak, Dallas TX (about 196 miles)');
  assert.equal(requestText({ ...req, date: '2026-11-22', start_time: '14:30' }), 'to meet at 9 Oak, Dallas TX on 2026-11-22 at 2:30 PM (about 196 miles)', 'the day and time they would like');
});

test('families see her times from a week before the ready date (seven weeks); boarding still counts from the ready date', () => {
  assert.equal(PICKUP_EARLY_DAYS, 7);
  const sale = { id: 's1', dog_id: 'p1', buyer_contact_id: 'c1', status: 'deposit_paid', kennel_id: 'k1' };
  const slot = (id, date) => ({ id, date, start_time: '10:00', end_time: '10:30', location_id: 'a' });
  const litter = { id: 'l1', whelp_date: '2026-09-01', pickup_slots: [slot('six', '2026-10-19'), slot('seven', '2026-10-20'), slot('eight', '2026-10-27')] };
  assert.equal(pickupFrom(sale, litter, []), '2026-10-27', 'when the pup can go home: 8 weeks, what standard boarding counts from');
  assert.equal(pickupFrom(sale, litter, [], { earlyDays: PICKUP_EARLY_DAYS }), '2026-10-20', 'seven weeks');
  const base = { entry: { contact_id: 'c1', kennel_id: 'k1' }, sales: [sale], dogsById: new Map([['p1', { id: 'p1', litter_id: 'l1' }]]),
    kennel: { pickup_locations: [{ id: 'a', label: 'Library', address: '1 Main St' }] }, config: {}, events: [], today: '2026-10-10' };
  const v = familyPickupView({ ...base, litters: [litter] });
  assert.deepEqual([v.ready_from, v.slots.map((s) => s.id)], ['2026-10-20', ['seven', 'eight']]);
  const set = familyPickupView({ ...base, litters: [{ ...litter, estimated_ready_date: '2026-10-26' }] });
  assert.deepEqual(set.slots.map((s) => s.id), ['six', 'seven', 'eight'], 'a week before her estimated ready date');
  const stay = { id: 'b1', event_type: 'boarding', subject_id: 'p1', event_date: '2026-10-27', event_end_date: '2026-11-09', details: { sale_id: 's1', extra_charge_id: 'c1' } };
  assert.equal(pickupFrom(sale, litter, [stay], { earlyDays: PICKUP_EARLY_DAYS }), '2026-11-10', 'a training stay is never cut short');
});

test('City / state is locked and required while her distance rule is on, and hers again when it is off', () => {
  const on = formQuestions({ transport_min_home_miles: 200 });
  const q = on.find((x) => x.id === 'location');
  assert.deepEqual([q.key, q.required], ['location', true]);
  const off = formQuestions({ form_questions: on });
  const back = off.find((x) => x.id === 'location');
  assert.deepEqual([back.key, back.required], [undefined, false], 'saved while locked: an ordinary question again');
  const removed = formQuestions({ form_questions: DEFAULT_FORM_QUESTIONS.filter((x) => x.id !== 'location'), transport_min_home_miles: 50 });
  assert.equal(removed[removed.findIndex((x) => x.key === 'email') + 1].id, 'location', 'put back after email when she had removed it');
});

test('a rule per pickup date: a package needed first, or her standard boarding, never both', () => {
  const litter = { pickup_date_rules: [
    { date: '2026-11-21', requires_list_id: 'tr', boarding: true }, { date: '2026-11-22', boarding: true }, { date: '2026-11-22', requires_list_id: 'dup' }, { date: 'bad', boarding: true }
  ] };
  assert.deepEqual(dateRules(litter), [{ date: '2026-11-21', requires_list_id: 'tr' }, { date: '2026-11-22', boarding: true }]);
  assert.deepEqual(withDateRule(litter, '2026-11-22', null), [{ date: '2026-11-21', requires_list_id: 'tr' }]);
  assert.deepEqual(ruleFor({ pickup_date_rules: withDateRule({}, '2026-11-20', { boarding: true }) }, '2026-11-20'), { date: '2026-11-20', boarding: true });
  assert.deepEqual(standardBoarding('2026-11-10', '2026-11-22', 25), { days: 12, start: '2026-11-10', end: '2026-11-21', amount: 300 });
  assert.equal(standardBoarding('2026-11-22', '2026-11-22', 25), null, 'picked up the day they can go: no boarding');
  assert.equal(standardBoarding('2026-11-10', '2026-11-22', null), null, 'no rate set');

  const sale = { id: 's1', dog_id: 'p1', buyer_contact_id: 'c1', status: 'deposit_paid', kennel_id: 'k1', extra_charges: [] };
  const lit = { id: 'l1', whelp_date: '2026-09-01', pickup_slots: [
    { id: 'a1', date: '2026-11-21', start_time: '10:00', location_id: 'a' }, { id: 'b1', date: '2026-11-22', start_time: '10:00', location_id: 'a' }
  ], pickup_date_rules: [{ date: '2026-11-21', requires_list_id: 'tr' }, { date: '2026-11-22', boarding: true }] };
  const kennel = { pickup_locations: [{ id: 'a', label: 'Library', address: '1 Main St' }], extra_charge_list: [{ id: 'tr', label: '10 week training', amount: 900, family_can_request: true }] };
  const base = { entry: { contact_id: 'c1', kennel_id: 'k1' }, dogsById: new Map([['p1', { id: 'p1', litter_id: 'l1' }]]), litters: [lit], kennel, config: {}, events: [], today: '2026-11-01' };
  assert.deepEqual(familyPickupView({ ...base, sales: [sale] }).dates, [
    { date: '2026-11-21', requires: '10 week training', has_it: false }, { date: '2026-11-22', boarding: true }
  ]);
  const withIt = { ...sale, extra_charges: [{ id: 'c', label: '10 week training', amount: 900, list_id: 'tr' }] };
  assert.equal(familyPickupView({ ...base, sales: [withIt] }).dates[0].has_it, true);
});

test('what a family asked for and she has not decided fills in a pickup she logs another way', () => {
  const kennel = { pickup_locations: [{ id: 'a', label: 'Library', address: '1 Main St' }] };
  const litter = { pickup_slots: [{ id: 'x1', date: '2026-11-21', start_time: '10:00', end_time: '10:30', location_id: 'a' }] };
  const slotReq = { id: 'r1', kind: 'slot', slot_id: 'x1', date: '2026-11-21', start_time: '10:00', end_time: '10:30', place: 'Library', requested_date: '2026-11-01' };
  assert.deepEqual(pickupWish({ pickup_requests: [slotReq] }, { kennel, litter }),
    { date: '2026-11-21', time: '10:00 AM–10:30 AM', location: 'Library, 1 Main St', method: 'Local pickup' });
  assert.equal(pickupWish({ pickup_requests: [slotReq] }).location, 'Library', 'without her places: the label');
  const own = { id: 'r2', kind: 'address', address: '9 Oak, Dallas TX', date: '2026-11-22', start_time: '14:30', requested_date: '2026-11-02' };
  assert.deepEqual(pickupWish({ pickup_requests: [slotReq, own] }), { date: '2026-11-22', time: '2:30 PM', location: '9 Oak, Dallas TX', method: '' }, 'the newest');
  assert.equal(pickupWish({ pickup_requests: [{ ...own, decided: 'declined' }, { id: 'r3', kind: 'cancel', requested_date: '2026-11-03' }] }), null, 'decided, or a cancel: nothing');
});
