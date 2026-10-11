// referralShare.test.js — her referral links and codes shared with families, and
// the thank-you notes (Integrations plan §3): which accounts show (and only their
// shareable fields), the go-home date and the follow-up window, the note texts,
// and the allow-lists that carry them (the waitlist projection, the family
// Companion bundle). The Worker's copy is cloud/tests/familyPages.test.js.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let rs; let db; let kennelRepo; let dogRepo; let contactRepo; let saleRepo; let accountRepo; let eventRepo;
let computeNudges; let buildFamilyBundle; let buildProjection; let settings;

before(async () => {
  await installMemoryDb();
  rs = await import('../shared/data/referralShare.js');
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ dogRepo } = await import('../shared/data/dogRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  ({ saleRepo } = await import('../shared/data/saleRepo.js'));
  ({ accountRepo } = await import('../shared/data/accountRepo.js'));
  ({ eventRepo } = await import('../shared/data/eventRepo.js'));
  ({ computeNudges } = await import('../shared/data/nudges.js'));
  ({ buildFamilyBundle } = await import('../shared/data/companionExport.js'));
  ({ buildProjection } = await import('../shared/data/waitlistProjection.js'));
  settings = await import('../shared/data/settings.js');
});

const chewy = {
  id: 'a1', name: 'Chewy', share_with_families: true, referral_link: 'https://www.chewy.com/refer/x', referral_code: 'THORNPUP',
  referral_instructions: 'Use code THORNPUP for 30% off.', username: 'me@example.com', password: 'secret', customer_id: 'C-1', notes: 'private', fee_note: 'private'
};

// --- Pure ---------------------------------------------------------------------------

test('only accounts she shares, not archived, with a link or code, and only their shareable fields', () => {
  const list = rs.sharedReferrals([
    chewy,
    { name: 'AKC', share_with_families: false, referral_link: 'https://akc.org/r' },
    { name: 'Embark', share_with_families: true, referral_code: 'EMB10', is_archived: true },
    { name: 'Blank', share_with_families: true },
    { name: 'Bad link', share_with_families: true, referral_link: 'javascript:alert(1)' },
    { name: 'Amazon', share_with_families: true, referral_link: 'https://amzn.to/abc' }
  ]);
  assert.deepEqual(list, [
    { name: 'Amazon', link: 'https://amzn.to/abc', code: '', instructions: '' },
    { name: 'Chewy', link: 'https://www.chewy.com/refer/x', code: 'THORNPUP', instructions: 'Use code THORNPUP for 30% off.' }
  ], 'never her login, notes or a link that isn\'t a web address; by name');
});

test('the go-home date: the latest placement on or before today, else the balance-paid date', () => {
  const sale = { balance_paid_date: '2026-09-01' };
  assert.equal(rs.goHomeDate(sale, ['2026-09-20', '2026-09-28', '2026-11-01'], '2026-10-10'), '2026-09-28', 'a future pickup doesn\'t count yet');
  assert.equal(rs.goHomeDate(sale, [], '2026-10-10'), '2026-09-01');
  assert.equal(rs.goHomeDate({}, ['2026-12-01'], '2026-10-10'), null);
  assert.equal(rs.daysBetween('2026-10-03', '2026-10-10'), 7);
});

test('the follow-up note: how it\'s going, thanks, and what she recommends when she shares any', () => {
  const m = rs.followUpMessage({ buyerName: 'Renee Coleman', pupName: 'Maple', kennelName: 'Briar Hollow', days: 9, referrals: rs.sharedReferrals([chewy]) });
  assert.equal(m.subject, 'How is Maple settling in?');
  assert.match(m.body, /^Hi Renee,/);
  assert.match(m.body, /It's been a week since Maple went home with you/);
  assert.match(m.body, /- Chewy: https:\/\/www\.chewy\.com\/refer\/x, code THORNPUP\n {2}Use code THORNPUP for 30% off\./);
  assert.match(m.body, /Briar Hollow$/);
  const plain = rs.followUpMessage({ buyerName: 'Renee', pupName: 'Maple', kennelName: 'Briar Hollow', days: 30 });
  assert.match(plain.body, /It's been 4 weeks/);
  assert.ok(!/recommend/.test(plain.body), 'no recommendations section when she shares none');
});

test('the thank-you note: for a link or code she shares, or for recommending her', () => {
  const [ref] = rs.sharedReferrals([chewy]);
  assert.match(rs.referralThanksMessage({ buyerName: 'Priya Shah', kennelName: 'Thornfield', referral: ref }).body, /^Hi Priya,\n\nThank you for using our Chewy link! It really helps support Thornfield/);
  assert.match(rs.referralThanksMessage({ buyerName: 'Tessa', kennelName: 'Thornfield', referral: { name: 'Embark', code: 'EMB', link: '' } }).body, /our Embark code/);
  assert.match(rs.referralThanksMessage({ buyerName: 'Tessa', kennelName: 'Thornfield' }).body, /Thank you for recommending us to others/);
});

test('the waitlist projection carries the shared list for every status page, and nothing else of an account', () => {
  const kennel = { id: 'k1', public_id: 'kos1_11111111-2222-4333-8444-555555555555', kennel_name: 'Thornfield', waitlist_config: { online: true } };
  const base = { kennel, today: '2026-10-10' };
  assert.equal('recommended' in buildProjection(base).kennel, false, 'none shared: absent');
  const p = buildProjection({ ...base, accounts: [chewy, { ...chewy, name: 'Hidden', share_with_families: false }] });
  assert.deepEqual(p.kennel.recommended, rs.sharedReferrals([chewy]));
  assert.ok(!JSON.stringify(p).includes('secret') && !JSON.stringify(p).includes('me@example.com'));
});

// --- On the in-memory database: the Companion bundle and the follow-up nudge -----------

let K; let pup; let buyer;
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Briar Hollow', is_own_kennel: true });
  pup = await dogRepo.create({ call_name: 'Maple', sex: 'female', breed: 'Boston Terrier', ownership_type: 'owned', status: 'puppy', kennel_id: K.id });
  buyer = await contactRepo.create({ name: 'Renee Coleman', email: 'renee@example.com', phone: '555-0101' });
  await accountRepo.create({ ...chewy, id: undefined });
});

const sale = (over = {}) => saleRepo.create({
  kennel_id: K.id, dog_id: pup.id, buyer_contact_id: buyer.id, registration_type: 'limited', price: 2200, status: 'delivered', ...over
});
const followUps = async () => (await computeNudges()).filter((n) => n.key.startsWith('follow-up:'));

test('the family Companion bundle carries her shared recommendations, unless she unticks them', async () => {
  await sale({ status: 'deposit_paid' }); // an open sale: a current family
  const b = await buildFamilyBundle(buyer);
  assert.deepEqual(b.recommended, rs.sharedReferrals([chewy]));
  settings.setCompanionSettings('family', { include: { recommended: false } });
  assert.deepEqual((await buildFamilyBundle(buyer)).recommended, [], 'unticked: empty');
  settings.setCompanionSettings('family', { include: { recommended: true } });
});

test('a week after a pup goes home, Today suggests a note; not before, and not for old placements', async () => {
  const s = await sale({ balance_paid_date: daysAgo(3) });
  assert.equal((await followUps()).length, 0, 'only 3 days: not yet');
  await eventRepo.create({ subject_type: 'dog', subject_id: pup.id, event_type: 'placement', event_date: daysAgo(9), title: 'Went home' });
  const [n] = await followUps();
  assert.equal(n.key, `follow-up:${s.id}`);
  assert.equal(n.title, 'Check in with Renee Coleman: Maple went home 9 days ago');
  const report = await n.actions[0].run();
  assert.equal(report.doneDismisses, true);
  assert.deepEqual([report.compose.email, report.compose.phone, report.compose.subject], ['renee@example.com', '555-0101', 'How is Maple settling in?']);
  assert.match(report.compose.body, /Chewy: https:\/\/www\.chewy\.com\/refer\/x, code THORNPUP/);
  await saleRepo.update(s.id, { balance_paid_date: daysAgo(90) });
  await db.events.clear();
  assert.equal((await followUps()).length, 0, 'went home 90 days ago: past the window');
  await saleRepo.update(s.id, { status: 'paid_in_full', balance_paid_date: daysAgo(10) });
  assert.equal((await followUps()).length, 0, 'not delivered yet');
});
