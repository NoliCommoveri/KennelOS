// waitlistEmbed.test.js — the waitlist on her own website (Integrations plan §1):
// the site addresses she types, cleaned to origins; `kennel.embed` in the
// projection only while she has it on; and the code she pastes. The server side
// (frame-ancestors) is cloud/tests/familyPages.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedOrigin, embedOrigins, EMBED_ORIGINS_MAX, WAITLIST_CONFIG_DEFAULTS } from '../shared/data/waitlistRules.js';
import { buildProjection } from '../shared/data/waitlistProjection.js';

test('what she types for her website becomes its origin; anything else is refused', () => {
  assert.equal(embedOrigin('thornfieldkennels.com'), 'https://thornfieldkennels.com', 'a bare name means https');
  assert.equal(embedOrigin('  WWW.Thornfield.com/puppies?x=1#a '), 'https://www.thornfield.com', 'only scheme and host matter');
  assert.equal(embedOrigin('http://thornfield.com:8080/'), 'http://thornfield.com:8080');
  assert.equal(embedOrigin('http://localhost:8000'), 'http://localhost:8000');
  for (const bad of ['', '   ', 'thornfield', 'javascript:alert(1)', 'ftp://thornfield.com', 'data:text/html,x', 'not a site.com', 'https://', null]) {
    assert.equal(embedOrigin(bad), null, String(bad));
  }
});

test('her listed sites are cleaned, de-duplicated and capped', () => {
  const many = Array.from({ length: 14 }, (_, i) => `site${i}.com`);
  assert.equal(embedOrigins({ embed_origins: many }).length, EMBED_ORIGINS_MAX);
  assert.deepEqual(embedOrigins({ embed_origins: ['a.com', 'https://a.com/x', 'nope', 'b.com'] }), ['https://a.com', 'https://b.com']);
  assert.deepEqual(embedOrigins({}), []);
  assert.equal(WAITLIST_CONFIG_DEFAULTS.embed, false, 'off unless she turns it on');
});

const kennel = (config) => ({
  id: 'k1', public_id: 'kos1_11111111-2222-4333-8444-555555555555', kennel_name: 'Thornfield Kennels',
  waitlist_config: { online: true, respond_days: 3, max_passes: 2, auto_offer_on: [], ...config }
});
const project = (config) => buildProjection({
  kennel: kennel(config), entries: [], offers: [], programs: [], contacts: [], dogs: [], litters: [], pairings: [], sales: [], today: '2026-10-10'
}).kennel;

test('the projection carries `embed` only while she has it on', () => {
  assert.equal('embed' in project({}), false);
  assert.equal('embed' in project({ embed: false, embed_origins: ['a.com'] }), false);
  assert.deepEqual(project({ embed: true }).embed, { origins: [] }, 'on, no sites: any site may show it');
  assert.deepEqual(project({ embed: true, embed_origins: ['thornfield.com', 'junk'] }).embed, { origins: ['https://thornfield.com'] });
});

test('the code to paste: a script per view with a plain link for no-script pages, and a button that is only a link', async () => {
  globalThis.location = { hostname: 'localhost' }; // → the staging server's address
  const cfg = await import('../shared/data/cloud/cloudConfig.js');
  const { devCloudUrl } = await import('../shared/data/editionConfig.js');
  const id = 'kos1_11111111-2222-4333-8444-555555555555';
  const form = cfg.embedSnippet(id, 'apply');
  assert.match(form, new RegExp(`<script async src="${devCloudUrl}/family/embed\\.js" data-kennel="${id}" data-view="apply"></script>`));
  assert.match(form, new RegExp(`<noscript><a href="${devCloudUrl}/apply/${id}">Apply for a puppy</a></noscript>`));
  assert.match(cfg.embedSnippet(id, 'list'), /data-view="list".*\n<noscript><a href="[^"]+\/list\/kos1_/s);
  assert.match(cfg.embedSnippet(id, 'anything'), /data-view="apply"/);
  const button = cfg.applyButtonSnippet(id);
  assert.match(button, new RegExp(`^<a href="${devCloudUrl}/apply/${id}" target="_blank" rel="noopener" style="[^"<]+">Apply for a puppy</a>$`));
  assert.ok(!/<script/.test(button));
  assert.equal(cfg.embedSnippet(null), null);
});
