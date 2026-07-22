// lite/editionTour.js — Lite edition's guided-tour package (sample seed + steps).
//
// The assembler overlays this onto the fixed shared path
// dist/lite/data/editionTour.js (build/assemble.mjs), so its relative imports
// resolve as if it sat in shared/data/ — './db.js', './dogRepo.js', … are its
// siblings in the assembled artifact. Pro/Demo keep the shared default
// (data/editionTour.js) — the full Thornfield packet + full step catalog.
//
// WHY LITE NEEDS ITS OWN: the shared seed builds a 21-dog / 5-litter Thornfield
// with contacts, kennels, stud services, contracts and external dogs. Run through
// Lite's repos that trips the cap (litterRepo.create throws on the 3rd litter) and
// the seed aborts PART-WAY — before the manifest is written — leaving orphan dogs
// with no "Clear Sample Data" banner. And the shared tour then navigates to
// Pro-only pages that 404 in the Lite build. So Lite gets:
//   • a smaller packet: exactly 6 counting dogs + 2 litters (i.e. AT the cap, which
//     also sets up the "upgrade for unlimited" pitch), no Pro-only entities;
//   • a tour that visits only Lite's pages and folds in Pro-promo cards.
import { db } from './db.js';
import { dogRepo } from './dogRepo.js';
import { HistoryEvent } from './eventRepo.js';
import { contactRepo } from './contactRepo.js';
import { kennelRepo } from './kennelRepo.js';
import { pairingRepo } from './pairingRepo.js';
import { litterRepo } from './litterRepo.js';
import { saleRepo } from './saleRepo.js';
import { expenseRepo } from './expenseRepo.js';
import { monthsFromToday, daysFromToday } from './dateUtils.js';
import { setSampleDataManifest } from './settings.js';

const BREED = 'Boston Terrier';

// --- The Lite sample packet -------------------------------------------------
// Seeded through the same repos real data uses (so it honours the same
// validation), tracked in a manifest for clean clear/reset. Ordering matters: the
// six counting dogs are created interleaved so the count never momentarily exceeds
// 6, and the two litters never exceed 2 — the packet sits exactly AT Lite's cap.
export async function seedSampleData() {
  const manifest = {
    seededAt: new Date().toISOString(),
    dogs: [], events: [], contacts: [], kennels: [], pairings: [], litters: [],
    sales: [], contracts: [], stud_services: [], expenses: []
  };

  // Own kennel — Thornfield. (Lite has no Kennels page, but a dog's kennel_id and
  // the owner features still resolve against this record; it rides the manifest.)
  const thornfield = await kennelRepo.create({
    kennel_name: 'Thornfield Kennels', prefix: 'THORN', location: 'Hartland, VT', is_own_kennel: true,
    preferred_tests: ['OFA Patella', 'Companion Animal Eye Exam (CAER)', 'BAER Hearing'],
    preferred_breeds: [BREED],
    promote_nudge_enabled: true, promote_age_male_months: 14, promote_age_female_months: 11
  });
  manifest.kennels.push(thornfield.id);

  // Buyers — Contacts are Pro-only as a browsable section, but a Sale still points
  // at its buyer, so the packet needs a couple of buyer records as data.
  const nora = await contactRepo.create({
    name: 'Nora Kim', contact_type: ['buyer'], phone: '555-0109',
    email: 'nora.kim@example.com', address: '48 Birchwood Lane, Burlington, VT 05401'
  });
  const jamal = await contactRepo.create({
    name: 'Jamal Reed', contact_type: ['buyer'], phone: '555-0110', email: 'jamal.reed@example.com',
    address: '12 Maple Court, Lebanon, NH 03766'
  });
  manifest.contacts.push(nora.id, jamal.id);

  // Ancestors (deceased → never count toward the cap) so Juniper's pedigree has
  // depth.
  const ash = await dogRepo.create({
    call_name: 'Ash', sex: 'male', breed: BREED,
    date_of_birth: '2016-04-02', date_of_death: '2024-08-15',
    ownership_type: 'owned', status: 'deceased', kennel_id: thornfield.id
  });
  const willow = await dogRepo.create({
    call_name: 'Willow', sex: 'female', breed: BREED,
    date_of_birth: '2017-09-14', date_of_death: '2025-01-10',
    ownership_type: 'owned', status: 'retired_breeding', kennel_id: thornfield.id
  });
  await dogRepo.archive(willow.id); // departed → uncounted, and pedigree-only

  // Counting dog 1/6 — Juniper, the flagship breeding dam. Carries a recorded COI,
  // a planned-test plan, a photo URL and a rich event history, so every dog-profile
  // tour stop (identity, COI, planned tests, health tests, timeline, pedigree,
  // derived panels) points at her.
  const juniper = await dogRepo.create({
    call_name: 'Juniper', sex: 'female', breed: BREED,
    date_of_birth: '2019-11-03', sire_id: ash.id, dam_id: willow.id,
    registered_name: 'Thornfield Midnight Juniper', registration_number: 'AKC WS71029304',
    microchip_id: '985141000123456', color_markings: 'Black & white, seal points', registry: 'AKC',
    url: 'https://images.example.com/thornfield/juniper.jpg',
    planned_tests: ['OFA Patella', 'Companion Animal Eye Exam (CAER)'],
    ownership_type: 'owned', status: 'active_breeding', kennel_id: thornfield.id,
    recorded_coi: { value: 6.25, method: 'genomic', source: 'Embark', as_of_date: '2023-03-01' }
  });
  // Counting dog 2/6 — Gunnar, the sire behind both litters (owned in Lite; there
  // are no external dogs here).
  const gunnar = await dogRepo.create({
    call_name: 'Gunnar', sex: 'male', breed: BREED,
    date_of_birth: '2018-06-01',
    registered_name: 'Thornfield Maximus Gunnar', registration_number: 'AKC WS78341201',
    microchip_id: '985141000456789', color_markings: 'Seal & white, Irish marked', registry: 'AKC',
    planned_tests: ['OFA Patella'],
    ownership_type: 'owned', status: 'active_breeding', kennel_id: thornfield.id
  });
  // Counting dog 3/6 — Ivy, the dam of the current Autumn litter.
  const ivy = await dogRepo.create({
    call_name: 'Ivy', sex: 'female', breed: BREED,
    date_of_birth: '2021-05-10',
    registered_name: 'Thornfield Wild Ivy', registration_number: 'AKC WS84550012',
    color_markings: 'Seal brindle & white', registry: 'AKC',
    ownership_type: 'owned', status: 'active_breeding', kennel_id: thornfield.id
  });

  // Litter 1/2 — the past "Summer" litter (Juniper × Gunnar), now grown and sold.
  const pairingSummer = await pairingRepo.create({
    sire_id: gunnar.id, dam_id: juniper.id, pairing_type: 'actual', method: 'natural',
    status: 'whelped', planned_date: '2023-06-18', expected_due_date: '2023-08-20'
  });
  const summerLitter = await litterRepo.create({
    pairing_id: pairingSummer.id, dam_id: juniper.id, sire_id: gunnar.id, nickname: 'Summer litter',
    whelp_date: '2023-08-20', litter_registration_number: 'THORN-L-2023-01',
    puppies_born_total: 2, puppies_born_alive: 2, puppies_born_deceased: 0, puppies_born_abnormalities: 0,
    status: 'sold'
  });

  // Counting dog 4/6 — Birch, a male kept back from the Summer litter for breeding.
  const birch = await dogRepo.create({
    call_name: 'Birch', sex: 'male', breed: BREED,
    date_of_birth: '2023-08-20', sire_id: gunnar.id, dam_id: juniper.id, litter_id: summerLitter.id,
    ownership_type: 'owned', status: 'active_breeding', kennel_id: thornfield.id, breeder_kennel_id: thornfield.id
  });
  // Counting dog 5/6 — Hazel, a Summer-litter female placed in a pet home (she is
  // also the buyer on the delivered sale below).
  const hazel = await dogRepo.create({
    call_name: 'Hazel', sex: 'female', breed: BREED,
    date_of_birth: '2023-08-20', sire_id: gunnar.id, dam_id: juniper.id, litter_id: summerLitter.id,
    ownership_type: 'owned', status: 'pet_home', kennel_id: thornfield.id, breeder_kennel_id: thornfield.id
  });
  // Counting dog 6/6 — Clover, a retired female now actively listed (for_sale).
  // This is the sixth and last counting slot: the kennel is now AT the Lite cap.
  const clover = await dogRepo.create({
    call_name: 'Clover', sex: 'female', breed: BREED,
    date_of_birth: '2018-02-11',
    ownership_type: 'owned', status: 'for_sale', kennel_id: thornfield.id
  });

  // Poppy — a kept female, old enough to promote but still status `puppy`
  // (disposition `keeping`), so she surfaces the promote-lifecycle nudge on Today.
  // A puppy never counts toward the cap, and she carries no litter (keeping the
  // packet at two litters).
  const poppy = await dogRepo.create({
    call_name: 'Poppy', sex: 'female', breed: BREED,
    date_of_birth: monthsFromToday(-12),
    ownership_type: 'owned', status: 'puppy', disposition: 'keeping', kennel_id: thornfield.id,
    breeder_kennel_id: thornfield.id
  });

  // Litter 2/2 — the current "Autumn" litter (Ivy × Gunnar), whelped ~9 weeks ago,
  // priced and actively selling. Drives Today's Active-litters card and the Sales.
  const pairingAutumn = await pairingRepo.create({
    sire_id: gunnar.id, dam_id: ivy.id, pairing_type: 'actual', method: 'natural',
    status: 'whelped', planned_date: daysFromToday(-126), expected_due_date: daysFromToday(-63)
  });
  const autumnLitter = await litterRepo.create({
    pairing_id: pairingAutumn.id, dam_id: ivy.id, sire_id: gunnar.id, nickname: 'Autumn litter',
    whelp_date: daysFromToday(-63), estimated_ready_date: daysFromToday(-7),
    accept_deposits_date: daysFromToday(-30), litter_registration_number: 'THORN-L-2026-01',
    puppies_born_total: 3, puppies_born_alive: 3, puppies_born_deceased: 0, puppies_born_abnormalities: 0,
    expected_price_male: 2800, expected_price_female: 3000,
    expected_deposit_male: 500, expected_deposit_female: 500,
    status: 'ready'
  });
  // Autumn puppies (all `puppy` → uncounted): one available, one placed on an open
  // sale, one undecided.
  const wren = await dogRepo.create({
    call_name: 'Wren', sex: 'female', breed: BREED,
    date_of_birth: daysFromToday(-63), sire_id: gunnar.id, dam_id: ivy.id, litter_id: autumnLitter.id,
    url: 'https://images.example.com/thornfield/wren.jpg',
    ownership_type: 'owned', status: 'puppy', disposition: 'available', kennel_id: thornfield.id,
    breeder_kennel_id: thornfield.id
  });
  const cedar = await dogRepo.create({
    call_name: 'Cedar', sex: 'male', breed: BREED,
    date_of_birth: daysFromToday(-63), sire_id: gunnar.id, dam_id: ivy.id, litter_id: autumnLitter.id,
    ownership_type: 'owned', status: 'puppy', disposition: 'placed', kennel_id: thornfield.id,
    breeder_kennel_id: thornfield.id
  });
  const aster = await dogRepo.create({
    call_name: 'Aster', sex: 'female', breed: BREED,
    date_of_birth: daysFromToday(-63), sire_id: gunnar.id, dam_id: ivy.id, litter_id: autumnLitter.id,
    ownership_type: 'owned', status: 'puppy', disposition: 'undecided', kennel_id: thornfield.id,
    breeder_kennel_id: thornfield.id
  });

  // A planned future pairing so the breeding chain shows a planned entry too.
  const pairingPlanned = await pairingRepo.create({
    sire_id: gunnar.id, dam_id: juniper.id, pairing_type: 'planned', status: 'planned',
    planned_date: monthsFromToday(4)
  });

  manifest.dogs.push(
    ash.id, willow.id, juniper.id, gunnar.id, ivy.id,
    birch.id, hazel.id, clover.id, poppy.id, wren.id, cedar.id, aster.id
  );
  manifest.pairings.push(pairingSummer.id, pairingAutumn.id, pairingPlanned.id);
  manifest.litters.push(summerLitter.id, autumnLitter.id);

  // --- Sales — a delivered one (collected income) and an open one (anticipated).
  const hazelSale = await saleRepo.create({
    dog_id: hazel.id, buyer_contact_id: nora.id, sale_date: '2024-01-15',
    price: 2500, deposit_amount: 500, deposit_date: '2023-11-01', balance_paid_date: '2024-01-15',
    placement_type: 'pet', status: 'delivered', lead_source: 'Website',
    notes: 'Went home with a family in Burlington, VT — regular updates from the family.'
  });
  const cedarSale = await saleRepo.create({
    dog_id: cedar.id, buyer_contact_id: jamal.id, sale_date: daysFromToday(-20),
    price: 2800, deposit_amount: 500, deposit_date: daysFromToday(-20), balance_due_date: daysFromToday(21),
    transport_fee: 250,
    placement_type: 'pet', status: 'deposit_paid', lead_source: 'Referral',
    notes: 'Reserved from the Autumn litter; balance due at pickup.'
  });
  manifest.sales.push(hazelSale.id, cedarSale.id);

  // --- Events — Juniper's history (feeds timeline + health-test summary + a
  // due-soon reminder), a scheduled pickup for Cedar (Today's due-outs), a couple
  // of Wren milestones, and the two litters' whelping summaries.
  const dogEvents = [
    { subject_id: juniper.id, event_type: 'vaccination', event_date: '2026-01-10', title: 'Annual vaccines',
      reminder_date: daysFromToday(7), details: { vaccine: 'DHPP + Rabies', lot_number: 'B4471' } },
    { subject_id: juniper.id, event_type: 'heat_cycle', event_date: '2026-02-02', title: 'Heat cycle',
      details: { cycle_start: '2026-02-02' } },
    { subject_id: juniper.id, event_type: 'ofa_pennhip', event_date: '2022-05-19', title: 'Hip evaluation',
      details: { joint: 'Hips', method: 'OFA', rating: 'Good' } },
    { subject_id: juniper.id, event_type: 'genetic_test', event_date: '2023-03-01', title: 'Panel results',
      details: { panel_name: 'Embark Breeder Panel', lab: 'Embark', result: 'Clear' } },
    { subject_id: juniper.id, event_type: 'breed_specific_test', event_date: '2023-03-05', title: 'Patellar luxation screen',
      details: { test_name: 'Patellar Luxation', result: 'Normal' } },
    { subject_id: juniper.id, event_type: 'title_earned', event_date: '2021-10-03', title: 'Earned CGC',
      details: { title_abbreviation: 'CGC', organization: 'AKC' } },
    { subject_id: cedar.id, event_type: 'placement', event_date: daysFromToday(7), title: 'Scheduled pickup',
      related_contact_id: jamal.id,
      details: { dropoff_method: 'Local pickup', placement_time: '10:00 AM', location: 'Thornfield Kennels', notes: 'Cedar going home with the Reeds.' } },
    { subject_id: wren.id, event_type: 'milestone', event_date: daysFromToday(-49), title: 'Eyes open',
      details: { description: 'Eyes open' } },
    { subject_id: wren.id, event_type: 'weight_check', event_date: daysFromToday(-7), title: 'Weight check',
      details: { weight_lbs: 3, weight_oz: 8, time_of_day: 'AM' } }
  ];
  const pairingEvents = [
    { subject_id: pairingAutumn.id, event_type: 'breeding_tie', event_date: daysFromToday(-126), title: 'Breeding tie',
      details: { tie_date: daysFromToday(-126), method: 'Natural' } },
    { subject_id: pairingAutumn.id, event_type: 'ultrasound', event_date: daysFromToday(-98), title: 'Ultrasound',
      details: { confirmed: 'Yes', estimated_count: 3 } },
    { subject_id: pairingSummer.id, event_type: 'breeding_tie', event_date: '2023-06-18', title: 'Breeding tie',
      details: { tie_date: '2023-06-18', method: 'Natural' } }
  ];
  const litterEvents = [
    { subject_id: autumnLitter.id, event_type: 'whelping_summary', event_date: daysFromToday(-63), title: 'Whelping summary',
      details: { total_born: 3, live_born: 3, notes: 'Three healthy pups; Ivy an attentive first-time dam.' } },
    { subject_id: summerLitter.id, event_type: 'whelping_summary', event_date: '2023-08-20', title: 'Whelping summary',
      details: { total_born: 2, live_born: 2, notes: 'Uncomplicated whelp, both nursing well within the hour.' } }
  ];
  for (const e of dogEvents) manifest.events.push((await HistoryEvent.create({ subject_type: 'dog', ...e })).id);
  for (const e of pairingEvents) manifest.events.push((await HistoryEvent.create({ subject_type: 'pairing', ...e })).id);
  for (const e of litterEvents) manifest.events.push((await HistoryEvent.create({ subject_type: 'litter', ...e })).id);

  // --- Financials ledger — a spread so Financials has real numbers.
  const expenses = [
    { subject_type: 'kennel', subject_id: thornfield.id, amount: 1200, category: 'facility', expense_date: daysFromToday(-45), vendor: 'Whelping barn lease', notes: 'Quarterly' },
    { subject_type: 'kennel', subject_id: thornfield.id, amount: 340.50, category: 'food', expense_date: daysFromToday(-30), vendor: 'Chewy', notes: 'Bulk kibble' },
    { subject_type: 'dog', subject_id: juniper.id, amount: 199, category: 'testing', expense_date: '2023-03-01', vendor: 'Embark', notes: 'Breeder panel' },
    { subject_type: 'litter', subject_id: autumnLitter.id, amount: 210.75, category: 'supplies', expense_date: daysFromToday(-40), vendor: 'Whelping supplies', notes: 'Pads, scale, ID collars' }
  ];
  for (const x of expenses) manifest.expenses.push((await expenseRepo.create(x)).id);

  // Named ids for the tour's anchor resolution (Wizard Runtime Spec §3.2) — the
  // Lite step catalog below hard-names these, and wizardUI resolves each to the
  // current seed's real id via this map.
  manifest.named = {
    juniper: juniper.id, gunnar: gunnar.id, ivy: ivy.id, birch: birch.id, hazel: hazel.id,
    clover: clover.id, poppy: poppy.id, wren: wren.id, cedar: cedar.id, aster: aster.id,
    ash: ash.id, willow: willow.id, thornfield: thornfield.id, nora: nora.id, jamal: jamal.id,
    summerLitter: summerLitter.id, autumnLitter: autumnLitter.id,
    pairingSummer: pairingSummer.id, pairingAutumn: pairingAutumn.id, pairingPlanned: pairingPlanned.id,
    hazelSale: hazelSale.id, cedarSale: cedarSale.id
  };

  setSampleDataManifest(manifest);
  return manifest;
}

// --- The Lite step catalog --------------------------------------------------
// Same shape as shared/data/wizardSteps.js (see its header for the field
// contract), but scoped to Lite's pages/features, with `kind: 'pro-promo'`
// centered cards that pitch what Pro adds. Plain text only — cards render escaped.
export const WIZARD_STEPS = [
  // --- Tour intro --------------------------------------------------------
  {
    id: 'tour-intro', kind: 'tour-intro', button: 'Start the tour →',
    title: 'Meet Thornfield Kennels',
    body: 'We’ve loaded a small sample kennel — Thornfield Kennels — with a few dogs, two litters and some records already filled in so you have something real to explore. None of it is yours: once you finish the tour we’ll clear it for you, and if you wander off on your own a yellow “Clear Sample Data” banner stays at the top so you can reset to a blank slate whenever you like. This is KennelOS Lite, the free edition, so the tour sticks to what Lite does — and points out a few things Pro adds as we go.'
  },

  // --- Today -------------------------------------------------------------
  {
    id: 'today-intro', kind: 'hub-intro', hub: 'Today', button: 'Explore Today Hub →',
    title: 'Today',
    body: 'The Today hub is your at-a-glance command center: everything that needs your attention right now — reminders, active litters, upcoming pickups, and a quick read on the whole kennel — gathered in one place.'
  },
  {
    id: 'today-reminders', hub: 'Today', page: 'today.html',
    selector: '[data-card="reminders"]', beforeShow: { openCard: 'reminders' },
    title: 'Reminders',
    body: 'Reminders track recurring events — like annual vet visits — so you know when the next one is due. Any event you give a future reminder date appears here automatically as the date gets close. From here you can log the new event, snooze the reminder for a while, or dismiss it if you no longer plan another occurrence.'
  },
  {
    id: 'today-active-litters', hub: 'Today', page: 'today.html',
    selector: '[data-card="active-litters"]', beforeShow: { openCard: 'active-litters' },
    title: 'Active litters',
    body: 'Active litters are the ones that still have puppies available for sale. Each shows a placed-vs-total count and a “New Sale” button to log a sale directly and keep things moving. Once every pup is placed or marked as keeping, the litter drops off this list.'
  },
  {
    id: 'today-due-outs', hub: 'Today', page: 'today.html',
    selector: '[data-card="upcoming"]', beforeShow: { openCard: 'upcoming' },
    title: 'Due outs & upcoming',
    body: 'Due outs are events you’ve already scheduled — a puppy pickup next week, or an annual vet visit. Use “Open” to edit the details, and you can reschedule or delete an event. Each one drops off the list once its date has passed.'
  },
  {
    id: 'today-overview', hub: 'Today', page: 'today.html',
    selector: '[data-card="overview"]', beforeShow: { openCard: 'overview' },
    title: 'Kennel overview',
    body: 'A quick count of your entire program’s stock at a glance.'
  },
  {
    id: 'today-nudges', hub: 'Today', page: 'today.html',
    selector: '[data-card="nudges"]', beforeShow: { openCard: 'nudges' },
    title: 'Nudges',
    body: 'Nudges are your companion for keeping information consistent across the app. It’s a set of rules that surface suggestions — like moving a grown dog from puppy to breeding status, or reopening a litter after a puppy sale is canceled or returned.'
  },

  // --- Dogs --------------------------------------------------------------
  {
    id: 'dogs-intro', kind: 'hub-intro', hub: 'Dogs', button: 'Explore Dogs Hub →',
    title: 'Dogs',
    body: 'This is the heart and soul of your kennel — the dogs that make up your program. From this hub you manage your stock, record events, and view pedigrees.'
  },
  {
    id: 'dogs-buckets', hub: 'Dogs', page: 'dogs.html',
    selector: '#dogs-bucket-tabs',
    title: 'The dog roster',
    body: 'The roster lists your entire stock with key details on each dog, plus curated life-stage toggles to focus on dogs at a certain stage. Open any dog’s profile straight from here.'
  },
  {
    id: 'dogs-filters', hub: 'Dogs', page: 'dogs.html',
    selector: '#dog-list',
    title: 'Filter, sort & export',
    body: 'Apply custom filters and sorts to pull exactly the dogs you need, and export your dog list as a spreadsheet for your physical files.'
  },
  {
    id: 'dog-identity', hub: 'Dogs', page: 'dog.html', anchor: 'juniper',
    selector: '#profile-body',
    title: 'Dog profile: identity',
    body: 'Record a dog’s details here — registered name and number, colors, and a URL that links out to a photo album or the dog’s own web page. Click “Edit” to add, remove, or change anything in this section.'
  },
  {
    id: 'dog-coi', hub: 'Dogs', page: 'dog.html', anchor: 'juniper',
    selector: '#recorded-coi-section',
    title: 'Recorded COI',
    body: 'If you know a dog’s COI, record it here to help you make informed decisions about potential breeding partners. Note that KennelOS does not attempt to calculate COI itself.'
  },
  {
    id: 'dog-planned-tests', hub: 'Dogs', page: 'dog.html', anchor: 'juniper',
    selector: '#planned-tests-section',
    title: 'Planned tests',
    body: 'Record the tests you intend to run if your kennel regularly does genetic and breed-specific testing. Once you log a test in the dog’s event history, it drops off the planned list automatically on the next refresh.'
  },
  {
    id: 'dog-health-tests', hub: 'Dogs', page: 'dog.html', anchor: 'juniper',
    selector: '#health-tests-section',
    title: 'Health-test summary',
    body: 'Because a dog’s event history can get long, this view pulls out just the health-testing events — so you can see at a glance which tests you’ve performed and their results.'
  },
  {
    id: 'dog-timeline', hub: 'Dogs', page: 'dog.html', anchor: 'juniper',
    selector: '#timeline-section',
    title: 'Event history',
    body: 'This is the full list of dated events a dog has been through — its entire history from whelping or acquisition onward. Add new events with the “Add Event” button.'
  },
  {
    id: 'dog-add-event', hub: 'Dogs', page: 'dog.html', anchor: 'juniper',
    selector: '#timeline-section',
    title: 'Adding new events',
    body: 'Event fields adapt to the event type: some offer helpful dropdowns or auto-filled values, others suggest entries as you type (a health test offers your planned test suite). You can also log the cost of an event straight to your Expenses table from here.'
  },
  {
    id: 'dog-disposition', hub: 'Dogs', page: 'dog.html', anchor: 'wren',
    selector: '#profile-body',
    title: 'Disposition',
    body: 'Disposition is for puppies only — it captures your plan for a pup you’ve bred. Marking one “available” flags your intent to sell it, and feeds the Active-litters card and your Sales.'
  },
  {
    id: 'dog-derived', hub: 'Dogs', page: 'dog.html', anchor: 'juniper',
    selector: '#pairings-section',
    title: 'Derived relationship panels',
    body: 'See the pairings, litters and sales your dog is associated with, all gathered in one place.'
  },
  {
    id: 'dog-pedigree', hub: 'Dogs', page: 'dog.html', anchor: 'juniper',
    selector: '#pedigree-section',
    title: 'Pedigree & offspring',
    body: 'An interactive, branching tree showing a dog’s pedigree, its offspring, and how the dogs in your program relate to each other. Open the full view to switch between related dogs seamlessly.'
  },
  {
    id: 'promo-dogs', kind: 'pro-promo', button: 'Keep exploring →',
    title: 'Every dog goes further in Pro',
    body: 'Lite gives every dog its identity, health history, pedigree and COI. Pro adds even more to each profile: attach documents and photos, record stud services, and track co-ownership and lease contracts — plus outside and leased dogs, and full Contacts and Kennel management. You’ll find “Upgrade to Pro” and a live “See the full app” demo in the More menu whenever you’re curious.'
  },

  // --- Breeding ----------------------------------------------------------
  {
    id: 'breeding-intro', kind: 'hub-intro', hub: 'Breeding', button: 'Explore Breeding Hub →',
    title: 'Breeding',
    body: 'This is where you run your breeding program — record your dogs’ pairings and litters, and produce new dog records for the puppies they yield.'
  },
  {
    id: 'breeding-chain', hub: 'Breeding', page: 'breeding.html',
    selector: '#breeding-body',
    title: 'The breeding chain',
    body: 'Your view of every pairing and litter your program has logged. You’ll typically start by adding a female’s heat cycle, then add pairing plans, record the litter, and create records for the resulting puppies. The most recent records show first.'
  },
  {
    id: 'breeding-log-heat', hub: 'Breeding', page: 'breeding.html',
    selector: '#log-heat-btn',
    title: 'Log a heat cycle',
    body: 'Add a heat cycle to a dog’s event history here. When it finishes you’ll get a nudge to record a pairing, successful or failed. Logging heat cycles helps you track skips and remember when to expect the next one.'
  },
  {
    id: 'pairing-profile', hub: 'Breeding', page: 'pairing.html', anchor: 'pairingAutumn',
    selector: '#profile-section',
    title: 'A pairing',
    body: '“Add New Pairing” opens the pairing screen, where you choose the sire and dam, record the date of the first tie (planned or already passed) and the last observed tie, and track pregnancy updates — tie dates, ultrasounds, notes — with the Add event button.'
  },
  {
    id: 'litter-profile', hub: 'Breeding', page: 'litter.html', anchor: 'autumnLitter',
    selector: '#profile-section',
    title: 'A litter',
    body: 'Once a pairing is recorded, create a litter. The litter record holds the general details that apply to the whole whelping — whelp date, when you’ll start accepting deposits, the litter registration number, born-alive and born-deceased counts, and expected prices for male and female pups. Tip: give the litter a nickname to tell apart litters from the same dam.'
  },
  {
    id: 'litter-roster', hub: 'Breeding', page: 'litter.html', anchor: 'autumnLitter',
    selector: '#roster-section',
    title: 'Puppy roster',
    body: 'The puppies produced in this litter. Adding puppies creates new dog records — quick-add several at once with “Add N Puppies”, record details like sex and nicknames, and log an event across multiple pups (vaccinations, weight checks) so it lands in every selected pup’s history from one screen.'
  },
  {
    id: 'litter-income', hub: 'Breeding', page: 'litter.html', anchor: 'autumnLitter',
    selector: '#income-section',
    title: 'Expenses & income',
    body: 'A quick view of the expenses and income a litter has accrued, so you can see the profit you’re making. For the full breakdown — calculations and income split out by type (deposit, purchase price, transport) — head to the Financials hub.'
  },

  // --- Sales -------------------------------------------------------------
  {
    id: 'sales-intro', kind: 'hub-intro', hub: 'Sales', button: 'Explore Sales Hub →',
    title: 'Sales',
    body: 'This is the business side of your program in Lite: recording puppies finding homes. Log the terms you agree with each buyer and track where every sale is in its lifecycle.'
  },
  {
    id: 'sales-list', hub: 'Sales', page: 'sales.html',
    selector: '#sale-list',
    title: 'Sales',
    body: 'An overview of the sales your kennel is making or has made. Adding a sale lets you record the terms agreed with the buyer and print puppy record details for any pup with an open sale.'
  },
  {
    id: 'sale-profile', hub: 'Sales', page: 'sale.html', anchor: 'cedarSale',
    selector: '#profile-section',
    title: 'Sale details',
    body: 'The details of a sale for a particular puppy — sale type (show or pet), a price prefilled from the litter and editable, any transport or deferred pick-up boarding charge, and a status tracking where the sale is in its lifecycle. Add a buyer inline if they’re not on file yet.'
  },
  {
    id: 'promo-sales', kind: 'pro-promo', button: 'Keep exploring →',
    title: 'Placements & Contracts in Pro',
    body: 'In Lite this hub is just Sales. Pro turns it into a full Placements & Contracts hub: income from studding your dogs out (stud services), standalone lease and co-ownership contracts, and Companion share-outs that send each buyer a clean, private page of their puppy’s details.'
  },

  // --- Financials --------------------------------------------------------
  {
    id: 'financials-intro', kind: 'hub-intro', hub: 'Financials', button: 'Explore Financials Hub →',
    title: 'Financials',
    body: 'The Financials hub is where the money lives — earned and anticipated income, expenses by category, and your running net.'
  },
  {
    id: 'fin-overview', hub: 'Financials', page: 'financials.html',
    selector: '#financials-view-tabs',
    title: 'Financials overview',
    body: 'Your at-a-glance view of where your kennel is receiving — and spending — its money. See your collected and anticipated revenue (completed versus still-in-progress sales), your total expenditures, and the net profit or loss those numbers produce.'
  },
  {
    id: 'fin-breakdown', hub: 'Financials', page: 'financials.html',
    selector: '#summary-section',
    title: 'Income & expense toggles',
    body: 'Here you’ll see the actual details of your income and expenses, and can make adjustments or add new items. Note that income is always derived from a sale — you can adjust existing values here, but anything completely missing has to be added first as a sale before it shows up.'
  },
  {
    id: 'promo-financials', kind: 'pro-promo', button: 'Keep exploring →',
    title: 'Invoices & receipts in Pro',
    body: 'Lite tracks all your income and expenses. Pro adds printable invoices and receipts — pre-filled from your sales and stud services, with full or partial amounts, accepted payment methods and due dates — ready to print to PDF and hand to a buyer.'
  },

  // --- More: backups + the closing Pro pitch -----------------------------
  {
    id: 'import-export', hub: 'More', page: 'import-export.html',
    selector: '#btn-backup',
    title: 'Import / export & backups',
    body: 'Where you bring in CSV files to populate a large kennel all at once, and where you back up your entire dataset to protect against loss. There’s no cloud storage, so losing your phone means starting over — back up regularly and keep the file somewhere central, like a Drive or an email to yourself, for easy recovery.'
  },
  {
    id: 'promo-final', kind: 'pro-promo', button: 'Finish',
    title: 'Ready for more? Meet KennelOS Pro',
    body: 'That’s Lite — free, private, and yours forever, for up to 6 dogs and 2 litters. When your program grows, Pro lifts those limits entirely and unlocks Contacts, Kennels, stud services, contracts, documents, Companion share-outs, invoices and every report. Your data comes with you: “Upgrade to Pro” exports a backup first, then picks up right where you left off. You’ll find it — and a live “See the full app” demo — in the More menu.'
  }
];
