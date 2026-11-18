// loadCheck.mjs — how pages settle, in a real browser (Load Performance plan Phase 0).
// Run by hand, not by `node --test`; it needs the Chromium that Playwright drives.
//
//   node build/assemble.mjs                       # build dist/ first
//   node build/loadCheck.mjs                      # Pro and Lite
//   node build/loadCheck.mjs --edition pro --delay 3000 --json
//   node build/loadCheck.mjs --root ../other-checkout   # its dist/, to compare
//   node build/loadCheck.mjs --settle 8000        # watch each page longer (default 2000 ms)
//
// For each edition it serves <root>/dist on a local port, opens a phone-sized window
// (390 × 800, no service worker), gives the device a program (the edition's sample
// packet, kept as her own records: no manifest, a kennel of her own) and, in Pro, an
// activated license whose Lemon Squeezy check is answered `--delay` ms late (3 s by
// default). Then it opens Today, Dogs, a dog and a sale, in one browsing session,
// and for each records:
//   • nav     — ms from navigation until the nav is drawn (#app-nav .nav-inner);
//   • paint   — first contentful paint;
//   • CLS     — the layout shift after it (every shift, summed), with what moved most;
//   • reads   — each table read in full more than once (a getAll or cursor over the
//               whole store, counted under IndexedDB, so it sees past Dexie);
//   • store   — Lemon Squeezy requests during the page.
// Nothing is written to the repo. Exit code 0 unless the browser couldn't run.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const ROOT = resolve(opt('root', join(fileURLToPath(import.meta.url), '..', '..')));
const DIST = join(ROOT, 'dist');
const EDITIONS = opt('edition', 'pro,lite').split(',');
const DELAY = Number(opt('delay', '3000'));
// How long each page is watched after the store's answer: the shell's background
// checks (waitlist inbox, integrations, portal feed) start seconds after load.
const SETTLE = Number(opt('settle', '2000'));
const JSON_OUT = args.includes('--json');

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('loadCheck: Playwright isn\'t installed here (npm i -D playwright, then npx playwright install chromium).');
  process.exit(1);
}

// --- A static server for dist/ ------------------------------------------------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.csv': 'text/csv', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

// --- What the page records about itself ------------------------------------------------
function instrument() {
  window.__load = { nav: null, shifts: [], reads: {} };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      const who = (e.sources || []).map((s) => s.node && (s.node.id ? `#${s.node.id}` : (s.node.className && typeof s.node.className === 'string' ? `.${s.node.className.split(' ')[0]}` : s.node.nodeName))).filter(Boolean);
      window.__load.shifts.push({ value: e.value, at: Math.round(e.startTime), who });
    }
  }).observe({ type: 'layout-shift', buffered: true });
  const seen = () => {
    if (window.__load.nav == null && document.querySelector('#app-nav .nav-inner')) window.__load.nav = Math.round(performance.now());
  };
  new MutationObserver(seen).observe(document, { childList: true, subtree: true });
  // Reads under IndexedDB: a getAll or a cursor over a whole store is a full read.
  const count = (store, full) => {
    const r = (window.__load.reads[store] ||= { full: 0, other: 0 });
    if (full) r.full++; else r.other++;
  };
  for (const name of ['getAll', 'getAllKeys', 'openCursor', 'openKeyCursor', 'get', 'count']) {
    const wrap = (proto, isIndex) => {
      const orig = proto[name];
      if (!orig) return;
      proto[name] = function (...a) {
        const whole = !isIndex && (name === 'getAll' || name === 'openCursor') && (a[0] == null);
        count(isIndex ? this.objectStore.name : this.name, whole);
        return orig.apply(this, a);
      };
    };
    wrap(IDBObjectStore.prototype, false);
    wrap(IDBIndex.prototype, true);
  }
}

// --- A device with a program ------------------------------------------------------------
async function prepare(page, edition) {
  await page.goto(`${BASE}/${edition}/manifest.json`);
  await page.evaluate((pro) => {
    localStorage.clear();
    localStorage.setItem('kennelOS.sampleDataCleared', '1'); // no first-run card
    if (pro) {
      localStorage.setItem('kennelOS.proLicense', JSON.stringify({
        key: 'LOADCHECK', instanceId: 'loadcheck', status: 'active', expiresAt: null,
        variantName: 'Lifetime', interval: 'lifetime', lastValidated: new Date().toISOString()
      }));
    }
  }, edition === 'pro');
  return page.evaluate(async (edition) => {
    const at = (p) => `/${edition}/${p}`;
    const { db } = await import(at('data/db.js'));
    const demo = await import(at('data/demoMode.js'));
    const { seedSampleData } = await import(at('data/editionTour.js'));
    // A build from before the tour was read-only has no seed window to need; both work.
    await (demo.withSeedAllowed ? demo.withSeedAllowed(() => seedSampleData()) : seedSampleData());
    // Her own records from here on: no manifest, a kennel of her own, the tour done.
    localStorage.removeItem('kennelOS.sampleDataManifest');
    localStorage.setItem('kennelOS.sampleDataCleared', '1');
    localStorage.setItem('kennelOS.wizardStatus', 'completed');
    const own = (await db.kennels.toArray()).find((k) => k.is_own_kennel);
    if (own) localStorage.setItem('kennelOS.myKennelId', own.id);
    const dog = (await db.dogs.toArray()).find((d) => d.ownership_type === 'owned' && !d.is_archived);
    const sale = (await db.sales.toArray()).find((s) => !s.is_archived);
    return { dogId: dog?.id || null, saleId: sale?.id || null };
  }, edition);
}

async function measure(page, url, counter) {
  const before = counter.calls;
  await page.goto(url);
  await page.waitForLoadState('load');
  await page.waitForTimeout(Math.max(DELAY, 0) + SETTLE); // past the store's answer, then --settle more
  const r = await page.evaluate(() => ({ ...window.__load, fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0) }));
  const cls = r.shifts.reduce((n, s) => n + s.value, 0);
  const worst = [...r.shifts].sort((a, b) => b.value - a.value)[0];
  const repeats = Object.entries(r.reads).filter(([, v]) => v.full > 1).sort((a, b) => b[1].full - a[1].full).map(([t, v]) => `${t}×${v.full}`);
  return {
    page: url.replace(/^.*\/pages\//, '').replace(/\?.*$/, ''),
    nav: r.nav, paint: r.fcp, cls: +cls.toFixed(4),
    moved: worst ? `${worst.who.join(' ') || '?'} @${worst.at}ms` : '',
    fullReads: Object.values(r.reads).reduce((n, v) => n + v.full, 0),
    repeats, store: counter.calls - before
  };
}

const browser = await chromium.launch();
const results = {};
try {
  for (const edition of EDITIONS) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
    const counter = { calls: 0 };
    await ctx.route('https://api.lemonsqueezy.com/**', async (route) => {
      counter.calls++;
      await new Promise((r) => setTimeout(r, DELAY));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ valid: true, license_key: { status: 'active', expires_at: null }, meta: { variant_name: 'Lifetime' } }) });
    });
    // Nothing else leaves the machine (cloud, KennelPort, fonts).
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => (route.request().url().startsWith('https://api.lemonsqueezy.com/') ? route.fallback() : route.abort()));
    await ctx.addInitScript(instrument);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const ids = await prepare(page, edition);
    counter.calls = 0;
    const pages = [`today.html`, `dogs.html`, `dog.html?id=${ids.dogId}`, `sale.html?id=${ids.saleId}`];
    results[edition] = { rows: [], errors };
    for (const p of pages) results[edition].rows.push(await measure(page, `${BASE}/${edition}/pages/${p}`, counter));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (JSON_OUT) {
  console.log(JSON.stringify({ root: ROOT, delay: DELAY, results }, null, 2));
} else {
  for (const [edition, { rows, errors }] of Object.entries(results)) {
    console.log(`\n${edition} — ${ROOT === resolve(join(fileURLToPath(import.meta.url), '..', '..')) ? 'this checkout' : ROOT}, Lemon Squeezy answered ${DELAY} ms late`);
    console.table(rows.map((r) => ({ page: r.page, 'nav ms': r.nav, 'paint ms': r.paint, CLS: r.cls, 'moved most': r.moved, 'full reads': r.fullReads, 'read more than once': r.repeats.join(' '), 'store calls': r.store })));
    if (errors.length) console.log('page errors:', errors);
  }
}
