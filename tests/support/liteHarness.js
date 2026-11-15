// liteHarness.js — the real Lite editionConfig, runnable under node --test.
// Not a test file itself (node --test only discovers *.test.js).
//
// lite/editionConfig.js's relative imports ('./db.js', './rosterCount.js') only
// resolve once the build overlays it onto data/editionConfig.js. This does the
// same overlay in a scratch folder: a copy of shared/data with Lite's config in
// place, and shared/vendor linked beside it. The test then loads the data layer
// from there through `lite(path)`, after installMemoryDb({ dbUrl }), so every
// repo and restore runs against Lite's real cap hooks (review K13 coverage gap).
import { mkdtempSync, cpSync, symlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installMemoryDb } from './memoryDb.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function installLite() {
  const dir = mkdtempSync(join(tmpdir(), 'kennelos-lite-'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'shared'));
  cpSync(join(ROOT, 'shared', 'data'), join(dir, 'shared', 'data'), { recursive: true });
  cpSync(join(ROOT, 'lite', 'editionConfig.js'), join(dir, 'shared', 'data', 'editionConfig.js'));
  symlinkSync(join(ROOT, 'shared', 'vendor'), join(dir, 'shared', 'vendor'), 'dir');
  const url = (rel) => pathToFileURL(join(dir, 'shared', 'data', rel)).href;
  const { db, tables } = await installMemoryDb({ dbUrl: url('db.js') });
  return { db, tables, lite: (rel) => import(url(rel)) };
}
