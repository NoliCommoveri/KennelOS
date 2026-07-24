// appReset.js — "Reset app": a full, irreversible teardown of every table and
// every localStorage key Furever owns, landing back on the exact first-run state
// a browser that's never visited would see. Mirrors the breeder core's
// shared/data/appReset.js — no reference guard and no soft delete, since nothing
// survives. The Family & Settings danger button calls this, then reloads.
import { db, existingTableNames } from './db.js';
import { clearAllSettings } from './settings.js';

// Live record counts across whatever tables the current schema has, for the
// confirmation copy ("erase all N records"). Stays correct as later stages add
// tables.
export async function getResetCounts() {
  const names = existingTableNames();
  const counts = {};
  for (const name of names) counts[name] = await db.table(name).count();
  return counts;
}

export async function resetApp() {
  const names = existingTableNames();
  await db.transaction('rw', names.map((n) => db.table(n)), async () => {
    for (const name of names) await db.table(name).clear();
  });
  clearAllSettings();
}
