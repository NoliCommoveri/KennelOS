// build/finalRelease.mjs — the end-of-life ("final") build of the editions.
//
// If KennelOS ever ends, the terms (site/terms.html §14, "If KennelOS ends") promise a
// final version of each app that needs no license check and no online service of ours.
// This is that build: `node build/assemble.mjs --final` runs these two rewrites on each
// edition after its normal assembly.
//
//   1. editionConfig: every server URL is nulled (cloud, KennelPort, and the staging
//      overrides), the upgrade and demo links are nulled (nothing is sold, and the demo
//      may be gone), and Pro's license gate is switched off, so Pro opens for anyone,
//      with or without a key. Every Pro feature flag is left as it is.
//   2. sw.js: the edition's CACHE_NAME gets a `-final` suffix, so every installed app
//      takes the final files the next time it opens online, with no manual cache bump.
//
// Both are text rewrites of files this repo owns, so each one checks its anchor and
// throws when it's missing: a config that moved must fail the build, never ship a
// "final" Pro that still walls.

// The exports a final build sets to null, when the edition's config has them.
export const FINAL_NULLED_EXPORTS = [
  'cloudUrl', 'devCloudUrl', 'kennelportUrl', 'devKennelportUrl', 'upgradeUrl', 'demoUrl', 'tourUrl',
];

export function finalizeEditionConfig(text, edition) {
  let out = text;
  for (const name of FINAL_NULLED_EXPORTS) {
    const re = new RegExp(`^export const ${name} = [^;\\n]*;`, 'm');
    if (!re.test(out)) throw new Error(`${edition}: final build: editionConfig has no single-line \`export const ${name} = …;\``);
    out = out.replace(re, `export const ${name} = null; // final build (build/finalRelease.mjs)`);
  }
  const gateOn = /^(\s*)licenseGate:\s*true\s*,.*$/m;
  if (edition === 'pro') {
    if (!gateOn.test(out)) throw new Error('pro: final build: editionConfig has no `licenseGate: true,` to switch off');
    out = out.replace(gateOn, '$1licenseGate: false, // final build: Pro opens with or without a key');
  }
  if (gateOn.test(out)) throw new Error(`${edition}: final build: a license gate is still on`);
  return out;
}

export function finalizeServiceWorker(text, edition) {
  const re = /const CACHE_NAME = '([^']+)';/;
  const m = text.match(re);
  if (!m) throw new Error(`${edition}: final build: sw.js has no CACHE_NAME`);
  const name = m[1].endsWith('-final') ? m[1] : `${m[1]}-final`;
  return { text: text.replace(re, `const CACHE_NAME = '${name}';`), cacheName: name };
}
