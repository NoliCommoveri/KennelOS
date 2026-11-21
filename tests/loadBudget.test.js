// loadBudget.test.js — how much every page loads before anything runs (Load
// Performance plan Phase 0). A page's static graph is app.js's plus its own script's:
// every module reachable through static `import … from` / `export … from`, counted
// once, with its size on disk (unminified source, as shipped today). Dynamic
// import()s are left out on purpose: they load only when used.
//
// The budgets start at the numbers as of Phases 1–2 (plan §1.2 has the ones before),
// with a little room, and come DOWN as Phase 3 lands (targets: app.js ≤ 550 KB,
// Today ≤ 1,000 KB, Dog ≤ 800 KB). A page that outgrows its budget fails here: make
// the new import dynamic, or raise the number on purpose with a reason beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const shared = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared');
const STATIC = /^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;

// The static graph from `starts`: { files: Map(relative path → depth), modules, kb, depth }.
function staticGraph(starts) {
  const files = new Map();
  const queue = starts.map((f) => [f, 1]);
  while (queue.length) {
    const [file, depth] = queue.shift();
    if (files.has(file) || !existsSync(file)) continue;
    files.set(file, depth);
    for (const m of readFileSync(file, 'utf8').matchAll(STATIC)) {
      const spec = m[1] || m[2];
      if (spec.startsWith('.')) queue.push([normalize(join(dirname(file), spec)), depth + 1]);
    }
  }
  let bytes = 0;
  for (const f of files.keys()) bytes += statSync(f).size;
  return {
    files: new Map([...files].map(([f, d]) => [relative(shared, f).split('\\').join('/'), d])),
    modules: files.size, kb: Math.round(bytes / 1024), depth: Math.max(0, ...files.values())
  };
}

const APP = join(shared, 'app.js');
const pageGraph = (page) => staticGraph(page ? [APP, join(shared, 'pages', `${page}.js`)] : [APP]);

// Entry → { modules, kb }. Measured 2026-11-18 after Phases 1–2: app.js 57 / 918,
// Today 100 / 1,723, Dogs 64 / 1,014, Dog 76 / 1,194, Litter 97 / 1,525, Sale
// 84 / 1,353, Waitlist 102 / 1,721, Waitlist entry 114 / 2,034, Kels 129 / 2,129.
const BUDGETS = {
  'app.js': { modules: 59, kb: 950 }, // 945 → 950 (2026-11-20): boarding's Where (away / with us, vocab.boardingStayAt) and the board's Staying with us reached 947
  today: { modules: 102, kb: 1790 }, // 1780 → 1790 (2026-11-21): every sale's deposit due date and its overdue flag (Unified Sale plan) reached 1,784; 1775 → 1780 (2026-11-20): boarding's Where (away / with us, vocab.boardingStayAt) and the board's Staying with us reached 1,778
  dogs: { modules: 66, kb: 1050 },
  dog: { modules: 78, kb: 1240 }, // 1220 → 1240 (2026-11-19): the waitlist timers' rules and review batch F together reached 1,221
  litter: { modules: 99, kb: 1580 }, // 1575 → 1580 (2026-11-19): review batch I (a refused Delete's note, assets/deleteBlockers.js) reached 1,576
  sale: { modules: 86, kb: 1410 }, // 1395 → 1410 (2026-11-21): the sale's checks, held pup and settled claims (Unified Sale plan) reached 1,404; 1390 → 1395 (2026-11-19): review batch I (a refused Delete's note) reached 1,391
  waitlist: { modules: 104, kb: 1775 }, // 1770 → 1775 (2026-11-21): the Unified Sale plan's settled claims reached 1,772
  'waitlist-entry': { modules: 116, kb: 2095 }, // 2090 → 2095 (2026-11-20): boarding's Where (away / with us, vocab.boardingStayAt) and the board's Staying with us reached 2,091
  kels: { modules: 131, kb: 2180 }
};

for (const [entry, budget] of Object.entries(BUDGETS)) {
  test(`${entry}: within its load budget (${budget.modules} modules, ${budget.kb} KB)`, () => {
    const g = pageGraph(entry === 'app.js' ? null : entry);
    const what = `${entry} loads ${g.modules} modules, ${g.kb} KB, ${g.depth} imports deep`;
    assert.ok(g.modules <= budget.modules, `${what}: over its ${budget.modules}-module budget`);
    assert.ok(g.kb <= budget.kb, `${what}: over its ${budget.kb} KB budget`);
  });
}

// What app.js must never load statically once Phase 3 lands: the tour, first run,
// the setup modal's CSV parser and the license gate load only when they're needed.
// A to-do until then: it reports what still does, without failing.
const NEVER_STATIC_FROM_APP = [
  'data/sampleData.js', 'assets/sampleDataUI.js', 'assets/wizardUI.js', 'data/wizardSteps.js',
  'assets/onboardingUI.js', 'assets/kennelSetupUI.js', 'data/seedImport.js', 'vendor/papaparse.min.mjs',
  'assets/licenseGate.js'
];

test('app.js loads none of the tour, first-run, setup-modal or license code statically', { todo: 'Phase 3 of the Load Performance plan' }, () => {
  const files = pageGraph(null).files;
  const reached = NEVER_STATIC_FROM_APP.filter((f) => files.has(f));
  assert.deepEqual(reached, []);
});

test('the walk sees what it should: app.js reaches the nav and the database, never a page', () => {
  const files = pageGraph(null).files;
  assert.ok(files.has('nav.js') && files.has('data/db.js') && files.has('data/settings.js'));
  assert.ok(![...files.keys()].some((f) => f.startsWith('pages/')));
});
