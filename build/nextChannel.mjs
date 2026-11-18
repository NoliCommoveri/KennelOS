// build/nextChannel.mjs — the "next" release channel: an unreleased build of Pro, published
// to its own origin (next-pro.kennelos.app) from the `next` branch, so what's coming can be
// seen and tested without touching production. `node build/assemble.mjs pro --channel next`
// runs these rewrites after the normal assembly (the same way --final does, finalRelease.mjs):
//
//   1. editionConfig: the nav's edition tag (`editionLabel`) reads "Next" instead of "Pro",
//      the only on-screen cue (no banner: it costs space); `cloudUrl` and `kennelportUrl`
//      become the staging servers the config
//      already names (`devCloudUrl`, `devKennelportUrl`), so nothing reaches the production
//      cloud, her real website or real families; Pro's license gate is switched off, so
//      testers need no key and use no activation.
//   2. sw.js: the CACHE_NAME gets a `-next` suffix.
//   3. manifest.json and the root <title>: "KennelOS Pro Next", so an installed copy can't
//      be mistaken for the real app.
//   4. robots.txt: keep search engines out.
//
// The separate ORIGIN is what keeps her data apart: IndexedDB, localStorage and the service
// worker are per origin, so a next build's schema upgrades never reach the live database.
// Never serve a next build under a path of a live origin.
//
// Each rewrite checks its anchor and throws when it's missing: a config that moved must
// fail the build, never ship a "next" build that talks to production.

export const NEXT_EDITIONS = ['pro'];
export const NEXT_NAMES = { pro: 'KennelOS Pro Next' };
export const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

// The live server URLs a next build must never carry.
const PRODUCTION_HOSTS = ['api.kennelos.app', 'api.kennelport.com'];

function assertNextEdition(edition) {
  if (!NEXT_EDITIONS.includes(edition)) {
    throw new Error(`${edition}: there is no next channel for this edition (only ${NEXT_EDITIONS.join(', ')})`);
  }
}

export function nextEditionConfig(text, edition) {
  assertNextEdition(edition);
  let out = text;

  const label = /^export const editionLabel = [^;\n]*;.*$/m;
  if (!label.test(out)) throw new Error(`${edition}: next build: editionConfig has no single-line \`export const editionLabel = …;\``);
  out = out.replace(label, "export const editionLabel = 'Next'; // next channel (build/nextChannel.mjs)");

  for (const [live, staging] of [['cloudUrl', 'devCloudUrl'], ['kennelportUrl', 'devKennelportUrl']]) {
    const url = out.match(new RegExp(`^export const ${staging} = '([^']+)';`, 'm'))?.[1];
    if (!url) throw new Error(`${edition}: next build: editionConfig has no single-line \`export const ${staging} = '…';\``);
    const re = new RegExp(`^export const ${live} = [^;\\n]*;.*$`, 'm');
    if (!re.test(out)) throw new Error(`${edition}: next build: editionConfig has no single-line \`export const ${live} = …;\``);
    out = out.replace(re, `export const ${live} = '${url}'; // next channel: the staging server, never production`);
  }

  const gateOn = /^(\s*)licenseGate:\s*true\s*,.*$/m;
  if (!gateOn.test(out)) throw new Error(`${edition}: next build: editionConfig has no \`licenseGate: true,\` to switch off`);
  out = out.replace(gateOn, '$1licenseGate: false, // next channel: testers need no key');

  const live = PRODUCTION_HOSTS.filter((h) => out.includes(`https://${h}'`));
  if (live.length) throw new Error(`${edition}: next build still points at production: ${live.join(', ')}`);
  return out;
}

export function nextServiceWorker(text, edition) {
  assertNextEdition(edition);
  const re = /const CACHE_NAME = '([^']+)';/;
  const m = text.match(re);
  if (!m) throw new Error(`${edition}: next build: sw.js has no CACHE_NAME`);
  const name = m[1].endsWith('-next') ? m[1] : `${m[1]}-next`;
  return { text: text.replace(re, `const CACHE_NAME = '${name}';`), cacheName: name };
}
