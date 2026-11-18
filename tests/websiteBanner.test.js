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
