// websiteBanner.test.js — the "not sent yet" strip's words and its Later key.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let b;
before(async () => {
  await installMemoryDb();
  b = await import('../shared/assets/websiteBanner.js');
});

const K = { id: 'k1', kennel_name: 'Oak <Hill>' };
const w = (lines, more = {}) => ({ kennel: K, lines, never: false, portal: false, ...more });

test('the strip names the first few changes, escaped, and the button says whether it publishes', () => {
  const html = b.waitingHtml([w(['Ruby: photos changed', 'New litter: <Spring>', 'Extras changed', 'Recommended products changed'])], { publish: true });
  assert.match(html, /4 changes not sent yet: Ruby: photos changed; New litter: &lt;Spring&gt;; Extras changed…/);
  assert.match(html, /Send and publish/);
  assert.match(b.waitingHtml([w(['Extras changed'])], { publish: false }), /Send to draft/);
});

test('See changes lists every change, per kennel when there are several, and says the portal sends itself', () => {
  const html = b.waitingHtml([w(['Extras changed'], { portal: true }), { ...w(['Bo: now retired']), kennel: { id: 'k2', kennel_name: 'Second' } }], { open: true, publish: true });
  assert.match(html, /<li><strong>Oak &lt;Hill&gt;<\/strong><\/li><li>Extras changed<\/li>/);
  assert.match(html, /<li>Bo: now retired<\/li>/);
  assert.match(html, /Puppy portal updates .* go by themselves/);
});

test('never sent from this device, and a note after sending', () => {
  assert.match(b.waitingHtml([w([], { never: true })]), /hasn’t been sent anything from this device yet/);
  assert.equal(b.waitingHtml([], { note: { text: 'Sent <ok>' } }), '<span>Sent &lt;ok&gt;</span>');
});

test('Later holds only while the same changes wait', () => {
  const one = b.waitingSignature([w(['Extras changed'])]);
  assert.equal(one, b.waitingSignature([w(['Extras changed'])]));
  assert.notEqual(one, b.waitingSignature([w(['Extras changed', 'Ruby: photos changed'])]));
});

// --- The kept compare (Load Performance plan D7) ---------------------------------
test('a kept compare is fresh until records change or the day turns', () => {
  const cache = { checkedAt: '2026-11-18T10:00:00.000Z', waiting: [] };
  const today = '2026-11-18';
  assert.equal(b.compareIsFresh(null, { today }), false, 'nothing kept: compare');
  assert.equal(b.compareIsFresh(cache, { today }), true, 'no change recorded: fresh');
  assert.equal(b.compareIsFresh(cache, { today, dataChangedAt: '2026-11-18T09:00:00.000Z' }), true, 'changed before: fresh');
  assert.equal(b.compareIsFresh(cache, { today, dataChangedAt: '2026-11-18T10:00:01.000Z' }), false, 'changed since: compare');
  assert.equal(b.compareIsFresh(cache, { today: '2026-11-19' }), false, 'a new day: compare (the bundle counts from today)');
});

test('remembering a compare keeps what the strip draws, for the next first paint', async () => {
  const settings = await import('../shared/data/settings.js');
  b.rememberCompare([w(['Extras changed'], { portal: true, kennel: { id: 'k1', kennel_name: 'Oak <Hill>', prefix: 'OAK', extra_charge_list: [{ id: 'x' }] } })], '2026-11-18T10:00:00.000Z');
  const kept = settings.getWebsiteStripCache();
  assert.equal(kept.checkedAt, '2026-11-18T10:00:00.000Z');
  assert.deepEqual(kept.waiting, [{ kennel: { id: 'k1', kennel_name: 'Oak <Hill>' }, lines: ['Extras changed'], never: false, portal: true }], 'only the kennel\'s id and name are kept');
  assert.equal(kept.signature, b.waitingSignature(kept.waiting));
  assert.match(kept.html, /1 change not sent yet: Extras changed/);
  b.rememberCompare([], '2026-11-18T11:00:00.000Z');
  assert.equal(settings.getWebsiteStripCache().html, null, 'nothing waiting: no strip');
});

test('every local change and every synced-in change moves dataChangedAt; a push never clears it', async () => {
  const settings = await import('../shared/data/settings.js');
  settings.markDataChanged('2026-11-18T10:00:00.000Z');
  assert.equal(settings.getDataChangedAt(), '2026-11-18T10:00:00.000Z');
  settings.clearCloudDirty();
  assert.equal(settings.getDataChangedAt(), '2026-11-18T10:00:00.000Z', 'a push clears the dirty flag, not this');
  settings.noteDataChanged('2026-11-18T10:05:00.000Z');
  assert.equal(settings.getDataChangedAt(), '2026-11-18T10:05:00.000Z');
  assert.equal(settings.getCloudDirtyAt(), null, 'a synced-in change does not mark the backup dirty');
});

test('a website link, send or site answer drops the kept compare', async () => {
  const settings = await import('../shared/data/settings.js');
  const store = await import('../shared/data/kennelportLinkStore.js');
  b.rememberCompare([], '2026-11-18T10:00:00.000Z');
  await store.setWebsiteLink('k1', { token: 't', site: { website: 'oak.example' } });
  assert.equal(settings.getWebsiteStripCache(), null);
  b.rememberCompare([], '2026-11-18T10:00:00.000Z');
  await store.noteWebsiteAnswer('k1', { summary: 'sent' });
  assert.equal(settings.getWebsiteStripCache(), null);
  b.rememberCompare([], '2026-11-18T10:00:00.000Z');
  await store.clearWebsiteLink('k1');
  assert.equal(settings.getWebsiteStripCache(), null);
});
