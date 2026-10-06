// The maintenance answer (plan §6.1). Between a deploy and Apply pending the
// code is newer than the database, and the editions push in the background, so
// every API route answers 503 {maintenance: true} until the two agree. The
// client treats that like being offline and retries later.
//
// "Current" is cached per isolate once it is true: a new deploy is a new
// isolate, so the cache can't outlive the migration list it was checked
// against. "Not current" is never cached, so the first request after Apply
// pending goes straight through.
import { schemaIsCurrent } from './migrate.js';

let current = false;

export async function schemaReady(db) {
  if (current) return true;
  try {
    current = await schemaIsCurrent(db);
  } catch {
    current = false;
  }
  return current;
}

// Tests only: forget the cached answer.
export function resetGateCache() {
  current = false;
}
