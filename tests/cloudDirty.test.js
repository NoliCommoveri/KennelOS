// cloudDirty.test.js — every direct database writer marks the cloud backup
// dirty (Cloud Phase 1 plan §3.2). The scheduler only pushes while
// settings.cloudDirtyAt is set, so a writer that forgets markDataChanged()
// silently stops backups for whatever it changed.
//
// This scans every app .js file for Dexie write calls (put/add/update/delete/
// bulk*/clear on db.<table>, db.table(...), table() or a `table` loop variable)
// and pins each file's count of write sites. A file with writes must call
// markDataChanged(), unless it is in EXEMPT, with the reason. A NEW write site
// (in any file) changes a count and fails here, which is the moment to decide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const WRITE = /\b(?:db\.[a-z_]+|db\.table\([^)]*\)|table\(\)|table)\.(?:put|add|update|delete|bulk[A-Za-z]*|clear|modify)\(/g;

// File → number of direct write sites. Each must call markDataChanged().
const MARKED = {
  'shared/data/repoBase.js': 3,      // create / update / hardDelete
  'shared/data/fileRepo.js': 3,      // create / remove / putRaw
  'shared/data/expenseRepo.js': 2,   // migrateEventCosts
  'shared/data/assistantSync.js': 1, // KennelAssistant event import
  'shared/data/importExport.js': 4   // restoreBackup replace/merge, cloud-merge, vault-merge
};

// File → { sites, why }. Writers that deliberately don't mark the backup dirty.
const EXEMPT = {
  'shared/data/sampleData.js': { sites: 14, why: 'clearing sample data: sample rows are never in a snapshot' },
  'shared/data/appReset.js': { sites: 1, why: 'Reset App: an emptied program must never be pushed (plan §3.3, §3.5)' },
  'shared/data/cloud/vaultKeyStore.js': { sites: 4, why: 'the device-only vault key (device_secrets): not kennel data, never in a snapshot' }
};

function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'vendor' || ent.name === 'node_modules') continue;
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith('.js') || ent.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

// Comment lines don't count (a comment may describe a write).
function writeSites(src) {
  return src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n').match(WRITE)?.length ?? 0;
}

const found = {};
for (const dir of ['shared', 'lite', 'pro', 'demo']) {
  for (const file of walk(join(ROOT, dir))) {
    const n = writeSites(readFileSync(file, 'utf8'));
    if (n) found[relative(ROOT, file).split('\\').join('/')] = n;
  }
}

test('every file with direct db writes is accounted for, with its exact count of write sites', () => {
  const expected = { ...MARKED };
  for (const [f, { sites }] of Object.entries(EXEMPT)) expected[f] = sites;
  assert.deepEqual(found, expected,
    'a direct db write was added or removed: call markDataChanged() beside it (and update MARKED), or add it to EXEMPT with a reason');
});

test('every non-exempt writer calls markDataChanged()', () => {
  for (const file of Object.keys(MARKED)) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    const calls = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l) && /markDataChanged\(/.test(l)).length;
    assert.ok(calls >= 1, `${file} writes to the database but never calls markDataChanged()`);
  }
});
