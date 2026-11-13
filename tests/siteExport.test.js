// siteExport.test.js — her KennelPort website (KennelPort plan 5.3–5.5): the
// bundle (pure: only marked records, allow-listed keys, her dates and marks, the
// website's heat rules, prices only when the site takes them), and Connect /
// Update website against a stubbed KennelPort (the token on this device only, the
// photos links filled without touching ones she typed).
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import {
  buildSiteBundle, websiteGaps, bundleChanges, puppyStatus, websiteHeats, litterMarked, waitlistSteps, applicationFeePay, line,
  BUNDLE_KEYS, DOG_KEYS, LITTER_KEYS, PUPPY_KEYS, SiteExportError, SITE_MAX
} from '../shared/data/siteExport.js';

const K = { id: 'k1', kennel_name: 'AK', public_id: 'kos1_00000000-0000-4000-8000-000000000001' };
const TODAY = '2026-11-03';
const dog = (id, more = {}) => ({ id, call_name: id, sex: 'female', status: 'active_breeding', kennel_id: 'k1', ownership_type: 'owned', show_on_website: true, ...more });
const build = (more = {}) => buildSiteBundle({ kennel: K, today: TODAY, bundleId: 'bundle-0001', ...more });

test('only what she marked goes, with exactly the allow-listed keys', () => {
  const dogs = [
    dog('willow', { registered_name: 'AK Willow', color_markings: 'Black & white', date_of_birth: '2022-01-02', notes: 'private', microchip_id: '985' }),
    dog('unmarked', { show_on_website: false }),
    dog('other-kennel', { kennel_id: 'k2' }),
    dog('archived', { is_archived: true }),
    dog('pet', { status: 'pet_home' }),
    dog('ancestor', { pedigree_only: true })
  ];
  const b = build({ dogs });
  assert.deepEqual(Object.keys(b).filter((k) => !BUNDLE_KEYS.includes(k)), []);
  assert.deepEqual(b.dogs.map((d) => d.id), ['willow']);
  assert.deepEqual(Object.keys(b.dogs[0]).sort(), [...DOG_KEYS].sort());
  assert.equal(b.dogs[0].color, 'Black & white');
  assert.equal(JSON.stringify(b).includes('private'), false);
  assert.equal(JSON.stringify(b).includes('985'), false);
  assert.equal(b.format, 1);
  assert.equal(b.kennel_id, 'k1');
  assert.equal('waitlist_public_id' in b, false, 'no public list unless website_feed is on');
});

test('titles and health results as data; a test keeps its id across a retest', () => {
  const ev = (id, type, date, details) => ({ id, subject_type: 'dog', subject_id: 'willow', event_type: type, event_date: date, title: '', details });
  const events = [
    ev('t1', 'title_earned', '2025-01-01', { title_abbreviation: 'CH' }),
    ev('h1', 'ofa_pennhip', '2025-02-01', { method: 'OFA', joint: 'Hips', rating: 'Fair', outcome: 'Normal' }),
    ev('h2', 'ofa_pennhip', '2026-02-01', { method: 'OFA', joint: 'Hips', rating: 'Good', outcome: 'Normal' }),
    ev('h3', 'genetic_test', '2026-03-01', { panel_name: 'DM', result: 'Carrier', outcome: 'Abnormal' }),
    ev('h4', 'breed_specific_test', '2026-04-01', { test_name: 'BAER', result: 'Bilateral' })
  ];
  const [d] = build({ dogs: [dog('willow')], events }).dogs;
  assert.deepEqual(d.titles, ['CH']);
  assert.deepEqual(d.health, [
    { id: 'test:ofa hips', test: 'OFA Hips', result: 'Good', normal: true, date: '2026-02-01' },
    { id: 'test:dm', test: 'DM', result: 'Carrier', normal: false, date: '2026-03-01' },
    // Not marked: no claim either way (the website counts it as normal).
    { id: 'test:baer', test: 'BAER', result: 'Bilateral', normal: null, date: '2026-04-01' }
  ]);
});

test('a litter: her dates, its puppies with their statuses, prices only when the site takes them', () => {
  const dogs = [dog('willow'), dog('stud', { sex: 'male', show_on_website: false })];
  const litter = {
    id: 'l1', kennel_id: 'k1', status: 'whelped', dam_id: 'willow', sire_id: 'stud', nickname: 'Spring', pairing_id: 'p1', show_on_website: true,
    whelp_date: '2026-10-01', estimated_ready_date: '2026-11-26', accept_deposits_date: '2026-11-01',
    expected_price_female: 3000, full_reg_surcharge_female: 500, expected_deposit_female: '500', notes: 'secret'
  };
  const pup = (id, more) => ({ id, call_name: id, sex: 'female', status: 'puppy', litter_id: 'l1', kennel_id: 'k1', ...more });
  const pups = [
    pup('a', { disposition: 'available', intended_registration: 'full', color_markings: 'Brindle' }), pup('b', { disposition: 'keeping' }), pup('c', {}),
    pup('d', { disposition: 'health_hold' }), pup('e', { disposition: 'available' }), pup('f', { disposition: 'available' }),
    pup('g', { disposition: 'placed' }), pup('h', { status: 'deceased' })
  ];
  // A sale or a waitlist pick changes nothing: only her disposition counts.
  const sales = [{ id: 's1', dog_id: 'e', status: 'deposit_paid' }, { id: 's2', dog_id: 'f', status: 'cancelled' }];
  const offers = [{ id: 'o1', outcome: 'open', chosen_dog_id: 'f' }];
  const b = build({ dogs: [...dogs, ...pups], litters: [litter], sales, offers });
  const [l] = b.litters;
  assert.deepEqual(Object.keys(l).sort(), [...LITTER_KEYS].sort());
  assert.equal(l.name, 'Spring');
  assert.equal(l.dam_name, 'willow');
  assert.equal(l.sire_name, 'stud', 'an unmarked sire still shows as a name');
  assert.equal(l.born_on, '2026-10-01');
  assert.equal(l.expected_on, null);
  assert.equal(l.deposits_on, '2026-11-01');
  assert.equal(l.prices, null, 'no prices unless Use my KennelOS prices is on');
  assert.deepEqual(Object.fromEntries(l.puppies.map((p) => [p.id, p.status])), { a: 'available', b: 'staying', c: 'undecided', d: 'hidden', e: 'available', f: 'available', g: 'placed' });
  assert.deepEqual(Object.keys(l.puppies[0]).sort(), [...PUPPY_KEYS].sort());
  assert.equal(l.puppies[0].registration, 'full');
  assert.equal(JSON.stringify(b).includes('secret'), false);

  const priced = build({ dogs: [...dogs, ...pups], litters: [litter], prices: true }).litters[0].prices;
  assert.deepEqual(priced, { price_female: 3000, price_male: null, full_reg_female: 500, full_reg_male: null, deposit_female: 500, deposit_male: null });
});

test('litters: live statuses only; a litter with no mark of its own follows its pairing', () => {
  const pairingsById = new Map([['p1', { id: 'p1', show_on_website: true }]]);
  assert.equal(litterMarked({ pairing_id: 'p1' }, pairingsById), true);
  assert.equal(litterMarked({ pairing_id: 'p1', show_on_website: false }, pairingsById), false);
  assert.equal(litterMarked({}, pairingsById), false);
  const base = { kennel_id: 'k1', dam_id: 'willow', sire_id: 'x', show_on_website: true };
  const b = build({
    dogs: [dog('willow')],
    pairings: [{ id: 'p1', kennel_id: 'k1', status: 'confirmed_pregnant', show_on_website: true, expected_due_date: '2026-12-20', dam_id: 'willow', sire_id: 'x' }],
    litters: [
      { ...base, id: 'l1', status: 'expected', pairing_id: 'p1', show_on_website: undefined },
      { ...base, id: 'l2', status: 'sold' },
      { ...base, id: 'l3', status: 'closed' }
    ]
  });
  assert.deepEqual(b.litters.map((l) => l.id), ['l1']);
  assert.equal(b.litters[0].expected_on, '2026-12-20', 'an expected litter says when, from its pairing');
  assert.equal(b.litters[0].born_on, null);
  assert.deepEqual(b.pairings, [], 'a pairing with a litter leaves: the litter takes over its page');
});

test('pairings: marked, on their way, not failed', () => {
  const p = (id, status, more = {}) => ({ id, kennel_id: 'k1', status, dam_id: 'willow', sire_id: 'x', show_on_website: true, planned_date: '2026-12-01', ...more });
  const b = build({ dogs: [dog('willow')], pairings: [p('a', 'planned'), p('b', 'bred'), p('c', 'failed'), p('d', 'cancelled'), p('e', 'planned', { show_on_website: false }), p('f', 'not_pregnant')] });
  assert.deepEqual(b.pairings.map((x) => x.id), ['a', 'b']);
  assert.deepEqual(b.pairings[0], { id: 'a', dam_id: 'willow', sire_id: 'x', dam_name: 'willow', sire_name: null, planned_on: '2026-12-01', expected_on: null });
});

test('heats: the dam\'s heats_online, kept 60 days, a pairing uses the nearest one', () => {
  const dogs = [dog('willow', { heats_online: true }), dog('gem', { heats_online: false })];
  const heat = (id, subject_id, event_date) => ({ id, subject_type: 'dog', subject_id, event_type: 'heat_cycle', event_date });
  const events = [
    heat('old', 'willow', '2026-08-01'), // more than 60 days ago: gone
    heat('recent', 'willow', '2026-09-20'), // 44 days ago: stays
    heat('next', 'willow', '2027-01-10'),
    heat('later', 'willow', '2027-07-01'),
    heat('same-month', 'willow', '2027-07-20'), // one per dam per month
    heat('gem', 'gem', '2027-01-01') // her dam's switch is off
  ];
  assert.deepEqual(websiteHeats(K, { dogs, events, today: TODAY }).map((h) => [h.id, h.month]), [['recent', '2026-09'], ['next', '2027-01'], ['later', '2027-07']]);
  // A pairing planned 5 days after the next heat uses it, not the later one.
  const pairings = [{ id: 'p', kennel_id: 'k1', dam_id: 'willow', status: 'planned', planned_date: '2027-01-15' }];
  assert.deepEqual(websiteHeats(K, { dogs, events, pairings, today: TODAY }).map((h) => h.id), ['recent', 'later']);
  // A cancelled one uses nothing; one with no planned date counts from when it was entered.
  assert.equal(websiteHeats(K, { dogs, events, pairings: [{ ...pairings[0], status: 'cancelled' }], today: TODAY }).length, 3);
  assert.deepEqual(websiteHeats(K, { dogs, events, pairings: [{ id: 'q', dam_id: 'willow', status: 'planned', created_at: '2026-09-25T10:00:00Z' }], today: TODAY }).map((h) => h.id), ['next', 'later']);
  const b = build({ dogs, events });
  assert.deepEqual(b.heats[1], { id: 'next', dam_id: 'willow', month: '2027-01', dam_name: 'willow' });
});

test("Kels's Update my website: what isn't on the website yet, in groups", () => {
  const dogs = [
    dog('willow'), dog('nova', { show_on_website: false }), dog('old', { show_on_website: false, status: 'retired_breeding' }),
    dog('gone', { show_on_website: false, status: 'pet_home' }), dog('ped', { show_on_website: false, pedigree_only: true }),
    dog('other', { show_on_website: false, kennel_id: 'k2' }), dog('max', { show_on_website: false, sex: 'male', heats_online: false }),
    dog('heats', { heats_online: true }),
    dog('fern', { status: 'puppy', show_on_website: false, disposition: 'keeping', litter_id: 'closed' }),
    dog('moss', { status: 'puppy', show_on_website: false, disposition: 'keeping', litter_id: 'live' }),
    dog('ivy', { status: 'puppy', show_on_website: false, disposition: 'available', litter_id: 'closed' })
  ];
  const litters = [
    { id: 'live', kennel_id: 'k1', status: 'whelped', show_on_website: true, whelp_date: '2026-10-01' },
    { id: 'closed', kennel_id: 'k1', status: 'closed', show_on_website: true },
    { id: 'new', kennel_id: 'k1', status: 'expected', show_on_website: false },
    { id: 'born', kennel_id: 'k1', status: 'whelped', show_on_website: false },
    { id: 'dated', kennel_id: 'k1', status: 'ready', show_on_website: true, accept_deposits_date: '2026-11-20' },
    { id: 'pl', kennel_id: 'k1', status: 'expected', pairing_id: 'p2' }
  ];
  const pairings = [
    { id: 'p1', kennel_id: 'k1', status: 'planned', show_on_website: false },
    { id: 'p2', kennel_id: 'k1', status: 'bred', show_on_website: false },
    { id: 'p3', kennel_id: 'k1', status: 'cancelled', show_on_website: false },
    { id: 'p4', kennel_id: 'k1', status: 'planned', show_on_website: true }
  ];
  const ids = (list) => list.map((r) => r.id);
  const g = websiteGaps(K, { dogs, litters, pairings });
  assert.deepEqual(ids(g.dogs), ['nova', 'old', 'max'], 'her own adults not marked; not a gone-home, pedigree-only or other kennel\'s dog');
  assert.deepEqual(ids(g.keptPups), ['fern'], 'a pup she is keeping whose litter has left the site');
  assert.deepEqual(ids(g.litters), ['new', 'born', 'pl'], 'live litters not marked (one follows its unmarked pairing)');
  assert.deepEqual(ids(g.pairings), ['p1'], 'live pairings not marked and not yet a litter');
  assert.deepEqual(ids(g.heats), ['willow', 'nova'], 'her breeding girls with heats off');
  assert.deepEqual(ids(g.deposits), ['live'], 'a shown, born litter with no deposits date');
  assert.deepEqual(ids(websiteGaps(K, { dogs, litters, pairings }, { marking: ['born'] }).deposits), ['live', 'born'], 'one she is adding counts');
  const accounts = [
    { id: 'chewy', name: 'Chewy', account_type: 'supplier', referral_code: 'AK10' },
    { id: 'shown', name: 'Shown', account_type: 'supplier', referral_link: 'https://x.example', show_on_website: true },
    { id: 'akc', name: 'AKC', account_type: 'registry' },
    { id: 'van', name: 'Pet van', account_type: 'transport', referral_instructions: 'Book early' },
    { id: 'old', name: 'Old', account_type: 'supplier', referral_code: 'X', is_archived: true }
  ];
  assert.deepEqual(ids(websiteGaps(K, { dogs, litters, pairings, accounts }).accounts), ['chewy', 'van'], 'something to share, not shown; a transport account too');
  assert.deepEqual(ids(websiteGaps(K, { dogs, litters, pairings, accounts: [{ id: 'bare', name: 'Bare van', account_type: 'transport' }] }).accounts), [], 'transport with nothing to link to');
});

test('what an update would change, in words', () => {
  const before = {
    dogs: [{ id: 'z', call_name: 'Zoey', status: 'active_breeding', color: 'Brindle' }, { id: 'c', call_name: 'Claire', status: 'active_breeding' }],
    litters: [{ id: 'l', name: 'First Down', born_on: '2026-10-01', deposits_on: null, puppies: [{ id: 'p1', name: 'Coach', status: 'available' }, { id: 'p2', name: 'LB', status: 'available' }] }],
    pairings: [{ id: 'q', dam_name: 'Claire', sire_name: 'Zeus', planned_on: '2027-01-01' }], heats: [], extras: null
  };
  assert.deepEqual(bundleChanges(before, structuredClone(before)), [], 'the same: nothing');
  const after = structuredClone(before);
  after.dogs[0].color = 'Black & white';
  after.dogs[1].status = 'retired_breeding';
  after.dogs.push({ id: 'n', call_name: 'Nova', status: 'active_breeding' });
  after.litters[0].deposits_on = '2026-10-22';
  after.litters[0].puppies[0].status = 'placed';
  after.litters[0].puppies.pop();
  after.pairings = [];
  after.heats = [{ id: 'h', dam_name: 'Zoey', month: '2027-03' }];
  after.extras = [{ id: 'x', name: 'Crate' }];
  assert.deepEqual(bundleChanges(before, after), [
    'Zoey: colour changed', 'Claire: now retired', 'New dog: Nova',
    'First Down: deposits date changed', 'Coach: Available → Spoken for', 'LB: off the site',
    'Claire × Zeus: off Coming up', "Coming up: Zoey's heat", 'Extras changed'
  ]);
});

test('puppy statuses are her disposition, as she set it (plan 3.6)', () => {
  assert.equal(puppyStatus({ id: 'p' }), 'undecided', 'no plan set counts as undecided');
  assert.equal(puppyStatus({ id: 'p', disposition: 'undecided' }), 'undecided');
  assert.equal(puppyStatus({ id: 'p', disposition: 'available' }), 'available');
  assert.equal(puppyStatus({ id: 'p', disposition: 'placed' }), 'placed', 'spoken for');
  assert.equal(puppyStatus({ id: 'p', disposition: 'keeping' }), 'staying');
  assert.equal(puppyStatus({ id: 'p', disposition: 'health_hold' }), 'hidden');
  assert.equal(puppyStatus({ id: 'p', status: 'active_breeding' }), 'undecided', 'her status field is not read');
});

test('extras: names and groups always, amounts only with prices; steps and How to pay from her waitlist', () => {
  const kennel = {
    ...K,
    extra_charge_list: [{ id: 'x1', label: 'Crate', amount: 90, group: 'Gear', description: 'A crate.' }],
    waitlist_config: { fee_amount: 250, fee_due_days: 3, payment_instructions: 'Venmo @ak-bostons', online: true, online_form: true, website_feed: true }
  };
  const b = buildSiteBundle({ kennel, today: TODAY, bundleId: 'bundle-0002' });
  assert.deepEqual(b.extras, [{ id: 'x1', name: 'Crate', group: 'Gear', description: 'A crate.', price_from: null, price_to: null }]);
  assert.equal(buildSiteBundle({ kennel, today: TODAY, bundleId: 'bundle-0002', prices: true }).extras[0].price_from, 90);
  assert.equal(b.waitlist_public_id, K.public_id);
  assert.deepEqual(b.steps.map((s) => s.id), ['apply', 'approved', 'turn']);
  assert.match(b.steps[0].body, /online\. There is an application fee\./);
  assert.match(b.steps[1].body, /within 3 days of approval/);
  assert.doesNotMatch(JSON.stringify(b.steps), /250/, 'amounts never go in the wording');
  assert.deepEqual(b.payment, { application_fee: { title: 'Application fee', due_note: 'Within 3 days of approval.', note: 'Venmo @ak-bostons' } });
  assert.deepEqual(waitlistSteps(K), [], 'no steps before her waitlist is set up');
  assert.equal(applicationFeePay({ ...K, waitlist_config: { payment_instructions: 'x'.repeat(201) } }), null, 'never cut a payment detail short');
  assert.equal('steps' in buildSiteBundle({ kennel: K, today: TODAY, bundleId: 'bundle-0003' }), false, 'no steps: her own stay as they are');
});

test('long text is cut to what the website takes; over its caps says so in words', () => {
  assert.equal(line(`  ${'a'.repeat(50)}  `, 40).length, 40);
  const b = build({ dogs: [dog('w', { call_name: 'W'.repeat(60), color_markings: 'c\n'.repeat(40) })] });
  assert.equal(b.dogs[0].call_name.length, 40);
  assert.ok(b.dogs[0].color.length <= 40 && !b.dogs[0].color.includes('\n'));
  const many = Array.from({ length: SITE_MAX.dogs + 1 }, (_, i) => dog(`d${i}`));
  assert.throws(() => build({ dogs: many }), (err) => err instanceof SiteExportError && /at most 200 dogs/.test(err.message));
  assert.throws(() => build({ bundleId: 'x' }), /bundle id/);
});

test('recommended products: Accounts she marked, link and code only, never a login; only to a Worker that takes them', () => {
  const accounts = [
    { id: 'a1', name: 'TLC Pet Food', account_type: 'supplier', show_on_website: true, referral_link: 'https://tlcpetpro.com/r/ak', referral_code: 'AK10', referral_instructions: 'Use AK10 for 10% off.', username: 'me@x.com', password: 'hunter2', customer_id: 'C-9', notes: 'private' },
    { id: 'a2', name: 'Chewy', account_type: 'supplier', show_on_website: true, website: 'https://chewy.com', referral_instructions: 'x'.repeat(121) },
    { id: 'a3', name: 'Unticked', show_on_website: false, referral_link: 'https://u.example' },
    { id: 'a4', name: 'Flight nanny', account_type: 'transport', show_on_website: true, referral_link: 'https://n.example' },
    { id: 'a5', name: 'Archived', show_on_website: true, is_archived: true }
  ];
  const b = build({ accounts, sections: ['products'] });
  assert.deepEqual(b.products, [
    { id: 'a2', name: 'Chewy', link_url: 'https://chewy.com', code: null, code_note: null },
    { id: 'a1', name: 'TLC Pet Food', link_url: 'https://tlcpetpro.com/r/ak', code: 'AK10', code_note: 'Use AK10 for 10% off.' }
  ]);
  assert.doesNotMatch(JSON.stringify(b), /hunter2|me@x\.com|C-9|private/);
  assert.equal('products' in build({ accounts }), false, 'a Worker that doesn\'t list products isn\'t sent them');
  assert.throws(() => build({ sections: ['products'], accounts: Array.from({ length: SITE_MAX.products + 1 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, show_on_website: true, referral_code: 'X' })) }), /at most 50 recommended products/);
  // Marked but nothing to share: not sent (only referrals, or transport).
  assert.equal(build({ sections: ['products'], accounts: [{ id: 'z', name: 'Plain shop', show_on_website: true, website: 'https://shop.example' }] }).products.length, 0);
});

test('transport accounts she marked go to a Worker that takes them, flagged, with their website', () => {
  const accounts = [
    { id: 't1', name: 'Sky Nanny', account_type: 'transport', show_on_website: true, website: 'skynanny.com', notes: 'private' },
    { id: 't2', name: 'Pup Van', account_type: 'transport', show_on_website: true, website: 'https://pupvan.example', referral_link: 'https://pupvan.example/r/ak', referral_code: 'AK5' },
    { id: 't3', name: 'Unticked van', account_type: 'transport', show_on_website: false, website: 'https://u.example' },
    { id: 'a1', name: 'TLC', account_type: 'supplier', show_on_website: true, website: 'https://tlcpetpro.com', referral_code: 'AK10' }
  ];
  const b = build({ accounts, sections: ['products', 'transport'] });
  assert.deepEqual(b.products, [
    { id: 't2', name: 'Pup Van', link_url: 'https://pupvan.example/r/ak', code: 'AK5', code_note: null, website: 'https://pupvan.example', transport: true },
    { id: 't1', name: 'Sky Nanny', link_url: 'https://skynanny.com', code: null, code_note: null, website: 'https://skynanny.com', transport: true },
    { id: 'a1', name: 'TLC', link_url: 'https://tlcpetpro.com', code: 'AK10', code_note: null, website: 'https://tlcpetpro.com', transport: false }
  ]);
  assert.doesNotMatch(JSON.stringify(b), /private/);
  const old = build({ accounts, sections: ['products'] });
  assert.deepEqual(old.products.map((x) => x.id), ['a1'], 'an older Worker: no transport, and no new fields');
  assert.deepEqual(Object.keys(old.products[0]), ['id', 'name', 'link_url', 'code', 'code_note']);
});

// --- Connect website and Update website (in-memory db, fetch stubbed) ------------

let db; let link; let dogRepo; let litterRepo; let kennelRepo; let calls; let reply;
const realFetch = globalThis.fetch;
const realLocation = globalThis.location;
const TOKEN = `kpl_${'a'.repeat(64)}`;
const SITE = { name: 'AK', website: 'https://akbostons.kennelport.com/', extras_info_url: 'https://akbostons.kennelport.com/extras', waitlist_page: true, kennelos_prices: false };

before(async () => {
  await installMemoryDb();
  globalThis.location = { hostname: 'localhost' }; // the staging KennelPort (devKennelportUrl)
  ({ db } = await import('../shared/data/db.js'));
  link = await import('../shared/data/kennelportLink.js');
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ litterRepo } = await import('../shared/data/litterRepo.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
});
beforeEach(() => {
  calls = [];
  reply = (method, path) => {
    if (path === '/v1/link' && method === 'POST') return { status: 200, body: { token: TOKEN, site: SITE } };
    if (path === '/v1/link' && method === 'GET') return { status: 200, body: { linked: true, site: SITE } };
    if (path === '/v1/link' && method === 'DELETE') return { status: 200, body: { linked: false } };
    return { status: 200, body: { summary: { text: 'From KennelOS: 1 new (needs photos). Preview, then Publish.', created: 1 }, addresses: { dogs: {}, litters: {} }, site: SITE } };
  };
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url);
    calls.push({ url: u, opts, body: opts.body ? JSON.parse(opts.body) : null });
    const r = reply(opts.method, u.pathname);
    if (r === 'network') throw new TypeError('Failed to fetch');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
});
afterEach(() => { globalThis.fetch = realFetch; });
test.after(() => { globalThis.location = realLocation; });

test('the address rules: fill blanks and KennelPort\'s own, never what she typed; blank a page that left', () => {
  const sites = [{ website: 'https://www.akbostonterriers.com/' }];
  const dogs = [
    { id: 'a', url: '' }, // blank: filled
    { id: 'b', url: 'https://photos.google.com/album' }, // hers: kept
    { id: 'c', url: 'https://akbostons.kennelport.com/litters/spring/c' }, // the puppy page: the dog page replaces it
    { id: 'd', url: 'https://www.akbostonterriers.com/dogs/d' }, // her domain's page, gone from the site: blanked
    { id: 'e', url: 'https://www.akbostonterriers.com/dogs/e' } // unchanged: nothing
  ];
  const changes = link.addressChanges({
    dogs, litters: [{ id: 'l', photos_url: '' }], sites,
    addresses: { dogs: { a: 'https://x.kennelport.com/dogs/a', b: 'https://x.kennelport.com/dogs/b', c: 'https://x.kennelport.com/dogs/c', e: 'https://www.akbostonterriers.com/dogs/e' }, litters: { l: 'https://x.kennelport.com/litters/l' } }
  });
  assert.deepEqual(changes, [
    { table: 'dogs', id: 'a', changes: { url: 'https://x.kennelport.com/dogs/a' } },
    { table: 'dogs', id: 'c', changes: { url: 'https://x.kennelport.com/dogs/c' } },
    { table: 'dogs', id: 'd', changes: { url: '' } },
    { table: 'litters', id: 'l', changes: { photos_url: 'https://x.kennelport.com/litters/l' } }
  ]);
});

test('kennel settings the link fills: website, extras link, the feed when the list is online, the embed sites when she listed any', () => {
  assert.deepEqual(link.kennelChanges({ website: '', waitlist_config: {} }, SITE), {
    website: SITE.website,
    waitlist_config: { extras_info_url: SITE.extras_info_url }
  });
  assert.equal(link.kennelChanges({ website: 'https://mykennel.com', waitlist_config: { extras_info_url: 'https://mykennel.com/extras' } }, SITE), null, 'never what she typed');
  const c = link.kennelChanges({ website: SITE.website, waitlist_config: { online: true, extras_info_url: SITE.extras_info_url, embed_origins: ['https://mykennel.com'] } }, SITE);
  assert.deepEqual(c, { waitlist_config: { online: true, extras_info_url: SITE.extras_info_url, embed_origins: ['https://mykennel.com', 'https://akbostons.kennelport.com'], website_feed: true } });
});

test('Connect website: the token on this device only, the kennel filled in; Update website sends, fills photos links; Unlink there forgets it here', async () => {
  const k = await kennelRepo.create({ kennel_name: 'AK', is_own_kennel: true });
  const kennel = await kennelRepo.getById(k.id);
  const site = await link.connectWebsite(kennel, 'abcd-2345', 'Her phone');
  assert.equal(site.website, SITE.website);
  assert.equal(calls[0].url.href, 'https://kennelport-staging.kennelport.workers.dev/v1/link');
  assert.deepEqual(calls[0].body, { code: 'abcd-2345', kennel_id: k.id, device_label: 'Her phone' });
  assert.equal(calls[0].opts.credentials, 'omit');
  assert.equal((await db.device_secrets.get(`kennelport:${k.id}`)).token, TOKEN);
  assert.equal((await kennelRepo.getById(k.id)).website, SITE.website);

  const willow = await dogRepo.create({ call_name: 'Willow', sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: k.id, show_on_website: true });
  const typed = await dogRepo.create({ call_name: 'Gem', sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: k.id, show_on_website: true, url: 'https://photos.example.com/gem' });
  const answerAddresses = { dogs: { [willow.id]: 'https://akbostons.kennelport.com/dogs/willow', [typed.id]: 'https://akbostons.kennelport.com/dogs/gem' }, litters: {} };
  const realReply = reply;
  reply = (method, path) => (path === '/v1/bundle' ? { status: 200, body: { summary: { text: 'ok' }, addresses: answerAddresses, site: SITE } } : realReply(method, path));
  calls = [];
  const out = await link.updateWebsite(await kennelRepo.getById(k.id), { bundleId: 'bundle-test-1' });
  assert.deepEqual(calls.map((c) => `${c.opts.method} ${c.url.pathname}`), ['GET /v1/link', 'POST /v1/bundle']);
  assert.equal(calls[1].opts.headers.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(calls[1].body.dogs.map((d) => d.call_name).sort(), ['Gem', 'Willow']);
  assert.equal(out.filled, 1);
  assert.equal((await dogRepo.getById(willow.id)).url, 'https://akbostons.kennelport.com/dogs/willow');
  assert.equal((await dogRepo.getById(typed.id)).url, 'https://photos.example.com/gem', 'her own link stays');
  assert.equal((await link.getWebsiteLink(k.id)).last_summary.text, 'ok');

  // Unlinked in KennelPort: the next press says so and forgets the token.
  reply = () => ({ status: 401, body: { error: 'not_linked', message: 'Your website is no longer linked.' } });
  await assert.rejects(link.updateWebsite(await kennelRepo.getById(k.id)), (err) => err.kind === 'not_linked' && /no longer linked/.test(err.message));
  assert.equal(await link.getWebsiteLink(k.id), null);

  // The token never rides a backup.
  reply = realReply;
  await link.connectWebsite(await kennelRepo.getById(k.id), 'abcd-2345', 'Her phone');
  const { exportAll } = await import('../shared/data/importExport.js');
  assert.equal(JSON.stringify(await exportAll()).includes(TOKEN), false);
  // Disconnect stops this device there and forgets it here.
  calls = [];
  await link.disconnectWebsite(k.id);
  assert.deepEqual(calls.map((c) => c.opts.method), ['DELETE']);
  assert.equal(await link.getWebsiteLink(k.id), null);
});

test('a refusal comes back in KennelPort\'s words; no network says so', async () => {
  const k = await kennelRepo.create({ kennel_name: 'Second', is_own_kennel: true });
  reply = () => ({ status: 400, body: { error: 'invalid_code', message: 'That code isn\'t right or has expired.' } });
  await assert.rejects(link.connectWebsite(await kennelRepo.getById(k.id), 'zzzz-zzzz', 'x'), (err) => err.kind === 'refused' && err.code === 'invalid_code' && /expired/.test(err.message));
  reply = () => 'network';
  await assert.rejects(link.connectWebsite(await kennelRepo.getById(k.id), 'zzzz-zzzz', 'x'), (err) => err.kind === 'network');
  assert.equal(await link.getWebsiteLink(k.id), null);
});

test('her own homepage on the kennel record: asked, never replaced silently; Keep mine remembered per site address', async () => {
  // Pure: what's asked about.
  assert.deepEqual(link.websiteOffer({ website: 'https://akbostons.com' }, SITE), { current: 'https://akbostons.com', next: SITE.website });
  assert.equal(link.websiteOffer({ website: '' }, SITE), null, 'blank: filled, not asked');
  assert.equal(link.websiteOffer({ website: 'https://akbostons.kennelport.com' }, SITE), null, 'already it (trailing slash aside)');
  assert.equal(link.websiteOffer({ website: 'https://old.kennelport.com/' }, SITE), null, 'KennelPort\'s own: replaced without asking');
  assert.equal(link.websiteOffer({ website: 'https://akbostons.com' }, SITE, { kept: SITE.website }), null, 'she said Keep mine');
  assert.ok(link.websiteOffer({ website: 'https://akbostons.com' }, { ...SITE, website: 'https://www.akbostonterriers.com/' }, { kept: SITE.website }), 'a new site address asks again');

  // Connect leaves her typed homepage alone and offers; each answer does what it says.
  const k = await kennelRepo.create({ kennel_name: 'Homepage', is_own_kennel: true, website: 'https://akbostons.com' });
  await link.connectWebsite(await kennelRepo.getById(k.id), 'abcd-2345', 'x');
  assert.equal((await kennelRepo.getById(k.id)).website, 'https://akbostons.com');
  assert.deepEqual(await link.pendingWebsiteOffer(k.id), { current: 'https://akbostons.com', next: SITE.website });
  await link.keepKennelWebsite(k.id);
  assert.equal(await link.pendingWebsiteOffer(k.id), null);
  await link.useSiteAsKennelWebsite(k.id);
  assert.equal((await kennelRepo.getById(k.id)).website, SITE.website);
});

test("Kels's Update my website: her ticks mark records, deposits dates save, and KennelOS prices switch on the site", async () => {
  const k = await kennelRepo.create({ kennel_name: 'Kels', is_own_kennel: true });
  await link.connectWebsite(await kennelRepo.getById(k.id), 'abcd-2345', 'Her phone');
  const nova = await dogRepo.create({ call_name: 'Nova', sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: k.id });
  const max = await dogRepo.create({ call_name: 'Max', sex: 'male', breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: k.id, show_on_website: true });
  const litter = await litterRepo.create({ kennel_id: k.id, dam_id: nova.id, sire_id: max.id, status: 'whelped', whelp_date: '2026-10-01' });
  let g = await link.websiteGapsFor(await kennelRepo.getById(k.id));
  assert.deepEqual(g.dogs.map((d) => d.id), [nova.id]);
  assert.deepEqual(g.litters.map((l) => l.id), [litter.id]);
  await link.markOnWebsite({ dogs: [nova.id], litters: [litter.id], heats: [nova.id] });
  assert.equal((await dogRepo.getById(nova.id)).show_on_website, true);
  assert.equal((await dogRepo.getById(nova.id)).heats_online, true);
  g = await link.websiteGapsFor(await kennelRepo.getById(k.id));
  assert.deepEqual([g.dogs.length, g.litters.length, g.heats.length], [0, 0, 0]);
  assert.deepEqual(g.deposits.map((l) => l.id), [litter.id]);
  await link.setDepositsDate(litter.id, '2026-11-20');
  assert.equal((await litterRepo.getById(litter.id)).accept_deposits_date, '2026-11-20');
  assert.equal((await link.websiteGapsFor(await kennelRepo.getById(k.id))).deposits.length, 0);

  const realReply = reply;
  reply = (method, path) => (path === '/v1/settings' ? { status: 200, body: { site: { ...SITE, kennelos_prices: true, settings: ['kennelos_prices'] } } } : realReply(method, path));
  calls = [];
  const site = await link.setWebsitePrices(await kennelRepo.getById(k.id), true);
  assert.deepEqual(calls.map((c) => `${c.opts.method} ${c.url.pathname}`), ['POST /v1/settings']);
  assert.deepEqual(calls[0].body, { kennelos_prices: true });
  assert.equal(site.kennelos_prices, true);
  assert.equal((await link.websiteFacts(k.id)).kennelos_prices, true, 'the next Update website sends prices');
  reply = realReply;
});

test('after an update, this device knows what it sent, and says what the next would change', async () => {
  const k = await kennelRepo.create({ kennel_name: 'Compare', is_own_kennel: true });
  await link.connectWebsite(await kennelRepo.getById(k.id), 'abcd-2345', 'Her phone');
  const zoey = await dogRepo.create({ call_name: 'Zoey', sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: k.id, show_on_website: true });
  const zeus = await dogRepo.create({ call_name: 'Zeus', sex: 'male', breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: k.id });
  const litter = await litterRepo.create({ kennel_id: k.id, dam_id: zoey.id, sire_id: zeus.id, nickname: 'First Down', status: 'whelped', whelp_date: '2026-10-01', show_on_website: true });
  const coach = await dogRepo.create({ call_name: 'Coach', sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'puppy', kennel_id: k.id, litter_id: litter.id, dam_id: zoey.id, sire_id: zeus.id, disposition: 'available' });
  assert.deepEqual(await link.pendingWebsiteChanges(await kennelRepo.getById(k.id)), { never: true }, 'never sent from here');
  assert.equal(await link.anyWebsiteLink(), true);
  await link.updateWebsite(await kennelRepo.getById(k.id), { bundleId: 'bundle-compare-1' });
  assert.deepEqual(await link.pendingWebsiteChanges(await kennelRepo.getById(k.id)), { lines: [] });
  await dogRepo.update(coach.id, { disposition: 'placed' });
  assert.deepEqual((await link.pendingWebsiteChanges(await kennelRepo.getById(k.id))).lines, ['Coach: Available → Spoken for']);

  // From a snapshot taken as a task starts: only what changed since, apart from
  // what was already waiting. A task that changes nothing the website shows has
  // nothing fresh, though Coach is still waiting.
  const since = await link.websiteSnapshot(await kennelRepo.getById(k.id));
  await dogRepo.update(zeus.id, { notes: 'Not on the website' });
  let ch = await link.pendingWebsiteChanges(await kennelRepo.getById(k.id), { since });
  assert.deepEqual(ch.fresh, []);
  assert.deepEqual(ch.lines, ['Coach: Available → Spoken for']);
  await dogRepo.update(zoey.id, { color_markings: 'Brindle' });
  ch = await link.pendingWebsiteChanges(await kennelRepo.getById(k.id), { since });
  assert.deepEqual(ch.fresh, ['Zoey: colour changed']);
  assert.equal(ch.lines.length, 2);
  assert.equal(await link.websiteSnapshot({ id: 'not-linked' }), null);
});


test('registry: on dogs and puppies only for a Worker that takes it (its `registry` section)', () => {
  const dogs = [dog('willow', { registry: ' AKC ' }), dog('max', { sex: 'male' }),
    { id: 'fern', call_name: 'Fern', sex: 'female', status: 'puppy', litter_id: 'l1', kennel_id: 'k1', registry: 'CKC', disposition: 'available' }];
  const litters = [{ id: 'l1', kennel_id: 'k1', status: 'whelped', dam_id: 'willow', nickname: 'Spring', show_on_website: true, whelp_date: '2026-10-01' }];
  const old = build({ dogs, litters });
  assert.equal('registry' in old.dogs[0], false, 'an older Worker: never sent');
  assert.equal('registry' in old.litters[0].puppies[0], false);
  const now = build({ dogs, litters, sections: ['registry'] });
  assert.equal(now.dogs.find((d) => d.id === 'willow').registry, 'AKC');
  assert.equal(now.dogs.find((d) => d.id === 'max').registry, null);
  assert.equal(now.litters[0].puppies[0].registry, 'CKC');
});

test('disposition: on a puppy-status dog only, for a Worker that takes it (its `disposition` section)', () => {
  const dogs = [dog('willow'), dog('fern', { status: 'puppy', disposition: 'available' }), dog('moss', { status: 'puppy', disposition: 'keeping' }), dog('ivy', { status: 'puppy' })];
  const old = build({ dogs });
  assert.equal(old.dogs.some((d) => 'disposition' in d), false, 'an older Worker: never sent');
  const now = build({ dogs, sections: ['disposition'] });
  const by = (id) => now.dogs.find((d) => d.id === id);
  assert.equal('disposition' in by('willow'), false, 'not on a grown dog');
  assert.equal(by('fern').disposition, 'available');
  assert.equal(by('moss').disposition, 'keeping');
  assert.equal(by('ivy').disposition, 'undecided', 'none set reads undecided');
});

test('raw values (contract Part C): each only for a Worker whose answer lists its section', () => {
  const dogs = [dog('willow'),
    { id: 'fern', call_name: 'Fern', sex: 'female', status: 'puppy', litter_id: 'l1', kennel_id: 'k1', disposition: 'keeping' },
    { id: 'moss', call_name: 'Moss', sex: 'male', status: 'puppy', litter_id: 'l1', kennel_id: 'k1' },
    { id: 'rue', call_name: 'Rue', sex: 'male', status: 'puppy', litter_id: 'l1', kennel_id: 'k1', disposition: 'reserved' }];
  const litters = [{ id: 'l1', kennel_id: 'k1', status: 'weaning', dam_id: 'willow', show_on_website: true, whelp_date: '2026-10-01' }];
  const events = [{ id: 'h1', subject_type: 'dog', subject_id: 'willow', event_type: 'genetic_test', event_date: '2026-03-01', title: '', details: { panel_name: 'DM', result: 'Clear' } }];
  const accounts = [
    { id: 'a1', name: 'TLC', account_type: 'supplier', show_on_website: true, referral_code: 'AK10' },
    { id: 'a2', name: 'Odd', account_type: 'mystery', show_on_website: true, referral_code: 'X' },
    { id: 't1', name: 'Sky Nanny', account_type: 'transport', show_on_website: true, website: 'skynanny.com' }
  ];
  const old = build({ dogs, litters, events, accounts, sections: ['products', 'transport'] });
  assert.equal('status' in old.litters[0], false, 'an older Worker: no litter status');
  assert.equal(old.litters[0].puppies.some((p) => 'disposition' in p), false);
  assert.equal('type' in old.dogs[0].health[0], false);
  assert.equal(old.products.some((p) => 'account_type' in p), false);

  const now = build({ dogs, litters, events, accounts, sections: ['products', 'transport', 'pup_disposition', 'litter_status', 'health_detail', 'account_type'] });
  assert.deepEqual(Object.keys(now.litters[0]).sort(), [...LITTER_KEYS, 'status'].sort());
  assert.equal(now.litters[0].status, 'weaning', 'C2: as she set it');
  const pup = (id) => now.litters[0].puppies.find((p) => p.id === id);
  assert.deepEqual(Object.keys(pup('fern')).sort(), [...PUPPY_KEYS, 'disposition'].sort());
  assert.equal(pup('fern').disposition, 'keeping', 'C1: raw');
  assert.equal(pup('fern').status, 'staying', 'the worked-out status still goes');
  assert.equal(pup('moss').disposition, null, 'none set: null, not undecided');
  assert.equal(pup('rue').disposition, null, 'a value KennelOS does not have: null');
  assert.deepEqual(now.dogs[0].health[0], { id: 'test:dm', test: 'DM', result: 'Clear', normal: null, date: '2026-03-01', type: 'genetic_test' }, 'C5');
  const prod = (id) => now.products.find((p) => p.id === id);
  assert.equal(prod('a1').account_type, 'supplier', 'C6');
  assert.equal(prod('a2').account_type, null);
  assert.equal(prod('t1').account_type, 'transport');
  assert.equal(prod('t1').transport, true, 'transport still goes');
  // Without 'transport', an account's type still goes with Recommended products.
  const noTransport = build({ accounts, sections: ['products', 'account_type'] });
  assert.deepEqual(Object.keys(noTransport.products[0]), ['id', 'name', 'link_url', 'code', 'code_note', 'account_type']);
});

test('titles_detail: each title with its organization and date, for a Worker that takes it', () => {
  const ev = (id, date, abbr, organization, more = {}) => ({ id, subject_type: 'dog', subject_id: 'willow', event_type: 'title_earned', event_date: date, details: { title_abbreviation: abbr, organization }, ...more });
  const events = [
    ev('t2', '2025-06-01', 'CH', 'UKC'),
    ev('t1', '2025-01-01', 'CH', 'AKC'),
    ev('t3', '2025-09-01', ' ch ', 'akc'), // the same title again: counted once, at its first date
    ev('t4', '2026-01-01', 'GCH', ''),
    ev('t5', '2026-02-01', 'BISS', 'AKC', { is_archived: true })
  ];
  assert.deepEqual(build({ dogs: [dog('willow')], events }).dogs[0].titles, ['CH', 'ch', 'GCH'], 'an older Worker: the abbreviations, as before');
  assert.deepEqual(build({ dogs: [dog('willow')], events, sections: ['titles_detail'] }).dogs[0].titles, [
    { abbr: 'CH', organization: 'AKC', date: '2025-01-01' },
    { abbr: 'CH', organization: 'UKC', date: '2025-06-01' },
    { abbr: 'GCH', organization: null, date: '2026-01-01' }
  ]);
});

test('bundleChanges: a litter status change is named once, a pup disposition rides its status line', () => {
  const dogs = [dog('willow'), { id: 'fern', call_name: 'Fern', sex: 'female', status: 'puppy', litter_id: 'l1', kennel_id: 'k1', disposition: 'available' }];
  const litter = { id: 'l1', kennel_id: 'k1', status: 'whelped', dam_id: 'willow', nickname: 'Spring', show_on_website: true, whelp_date: '2026-10-01' };
  const sections = ['pup_disposition', 'litter_status'];
  const a = build({ dogs, litters: [litter], sections });
  const b = build({ dogs: [dogs[0], { ...dogs[1], disposition: 'placed' }], litters: [{ ...litter, status: 'weaning' }], sections });
  assert.deepEqual(bundleChanges(a, b), ['Spring: status changed', 'Fern: Available → Spoken for']);
});

test('heat_id: a pairing, and its litter, name the heat they use, for a Worker that takes it', () => {
  const dogs = [dog('willow', { heats_online: true }), dog('stud', { sex: 'male' })];
  const events = [{ id: 'h1', subject_type: 'dog', subject_id: 'willow', event_type: 'heat_cycle', event_date: '2027-01-10' }];
  const p = { id: 'p1', kennel_id: 'k1', dam_id: 'willow', sire_id: 'stud', status: 'planned', planned_date: '2027-01-15', show_on_website: true };
  const other = { id: 'p2', kennel_id: 'k1', dam_id: 'willow', sire_id: 'stud', status: 'planned', planned_date: '2027-09-01', show_on_website: true };
  // An older Worker isn't sent it: it would refuse the whole bundle.
  assert.equal('heat_id' in build({ dogs, events, pairings: [p] }).pairings[0], false);
  const b = build({ dogs, events, pairings: [p, other], sections: ['heat_id'] });
  assert.deepEqual(b.pairings.map((x) => [x.id, x.heat_id]), [['p1', 'h1'], ['p2', null]]);
  assert.equal(b.heats.length, 0);
  // Whelped: the litter names its pairing's heat too, so a heat whose pairing never
  // showed carries on as the litter.
  const litter = { id: 'l1', kennel_id: 'k1', status: 'whelped', whelp_date: '2027-03-15', dam_id: 'willow', sire_id: 'stud', pairing_id: 'p1', show_on_website: true };
  const c = build({ dogs, events, pairings: [p], litters: [litter], sections: ['heat_id'] });
  assert.equal(c.litters[0].heat_id, 'h1');
  assert.equal(build({ dogs, events, pairings: [p], litters: [litter] }).litters[0].heat_id, undefined);
  // Not a change she's shown.
  assert.deepEqual(bundleChanges(build({ dogs, events, pairings: [p] }), b).filter((x) => /heat/.test(x)), []);
});

test("Kels's website check after a task: only what the task changed, never the same old changes again", async () => {
  // ui.js listens on document when it loads; nothing here clicks.
  const hadDocument = 'document' in globalThis;
  if (!hadDocument) globalThis.document = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const ui = await import('../shared/assets/websiteUpdateUI.js').finally(() => { if (!hadDocument) delete globalThis.document; });
  const { ownKennels } = await import('../shared/data/kennelScope.js');
  for (const k of await ownKennels()) await link.disconnectWebsite(k.id).catch(() => {});
  const k = await kennelRepo.create({ kennel_name: 'Kels check', is_own_kennel: true });
  await link.connectWebsite(await kennelRepo.getById(k.id), 'abcd-2345', 'Her phone');
  const ivy = await dogRepo.create({ call_name: 'Ivy', sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'active_breeding', kennel_id: k.id, show_on_website: true });
  await link.updateWebsite(await kennelRepo.getById(k.id), { bundleId: 'bundle-kels-check-1' });
  const said = [];
  // Yes, check; then Not now to the update.
  const chat = { say: async (t) => { said.push(t); }, choose: async (opts) => (opts.some((o) => o.value === 'yes') ? 'yes' : 'no') };

  // Waiting from earlier (she said Not now): a task that touches nothing on the website asks nothing.
  await dogRepo.update(ivy.id, { color_markings: 'Brindle' });
  await ui.noteWebsiteBaseline();
  await dogRepo.update(ivy.id, { notes: 'private' });
  await ui.offerWebsiteCheck(chat);
  assert.deepEqual(said, []);

  // A task that does: only its change is listed, with the earlier one counted.
  await ui.noteWebsiteBaseline();
  await dogRepo.update(ivy.id, { registered_name: 'AK Poison Ivy' });
  await ui.offerWebsiteCheck(chat);
  await ui.offerWebsiteCheck(chat);
  assert.equal(said.length, 3, 'asked once: the question, the list, then Okay');
  assert.match(said[1], /This changes 1 thing on your website:[\s\S]*Ivy: registered name changed[\s\S]*1 earlier change still waiting/);
  assert.doesNotMatch(said[1], /colour/);
});

test('a lapsed or missing license stops Update website, except on support\'s helper device', async () => {
  const { editionFlags } = await import('../shared/data/editionConfig.js');
  const { setCloudSession } = await import('../shared/data/settings.js');
  const was = editionFlags.licenseGate;
  editionFlags.licenseGate = true;
  try {
    localStorage.removeItem('kennelOS.cloudSession');
    assert.equal(await link.licenseOk(), false); // no license on this device
    setCloudSession({ token: 't', role: 'owner' });
    assert.equal(await link.licenseOk(), false);
    setCloudSession({ token: 't', role: 'helper' });
    assert.equal(await link.licenseOk(), true);
  } finally {
    editionFlags.licenseGate = was;
    localStorage.removeItem('kennelOS.cloudSession');
  }
});
