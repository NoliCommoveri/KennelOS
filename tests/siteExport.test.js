// siteExport.test.js — her KennelPort website (KennelPort plan 5.3–5.5): the
// bundle (pure: only marked records, allow-listed keys, her dates and marks, the
// website's heat rules, prices only when the site takes them), and Connect /
// Update website against a stubbed KennelPort (the token on this device only, the
// photos links filled without touching ones she typed).
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import {
  buildSiteBundle, puppyStatus, websiteHeats, litterMarked, waitlistSteps, applicationFeePay, line,
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
    ev('h3', 'genetic_test', '2026-03-01', { panel_name: 'DM', result: 'Carrier', outcome: 'Abnormal' })
  ];
  const [d] = build({ dogs: [dog('willow')], events }).dogs;
  assert.deepEqual(d.titles, ['CH']);
  assert.deepEqual(d.health, [
    { id: 'test:ofa hips', test: 'OFA Hips', result: 'Good', normal: true, date: '2026-02-01' },
    { id: 'test:dm', test: 'DM', result: 'Carrier', normal: false, date: '2026-03-01' }
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
  assert.deepEqual(Object.fromEntries(l.puppies.map((p) => [p.id, p.status])), { a: 'available', b: 'staying', c: 'undecided', d: 'hidden', e: 'reserved', f: 'reserved', g: 'placed' });
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

test('puppy statuses say what she set (plan 3.6)', () => {
  assert.equal(puppyStatus({ id: 'p' }), 'undecided', 'no plan set counts as undecided');
  assert.equal(puppyStatus({ id: 'p', disposition: 'available' }, { sales: [{ dog_id: 'p', status: 'delivered' }] }), 'placed');
  assert.equal(puppyStatus({ id: 'p', disposition: 'available' }, { sales: [{ dog_id: 'p', status: 'voided' }] }), 'available');
  assert.equal(puppyStatus({ id: 'p', disposition: 'available' }, { offers: [{ outcome: 'passed', chosen_dog_id: 'p' }] }), 'available');
  assert.equal(puppyStatus({ id: 'p', status: 'active_breeding' }), 'staying', 'a kept pup grown up is staying');
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
