// The ordered migration list /ops applies (plan §6.6). Adding a migration means
// adding its .sql file beside this one AND a line here; the runner only knows
// what this list names.
//
// Rules, in short (the plan has the reasons):
// - pre-launch, 0001 may be edited on staging (it then reads as drifted);
// - from the first real sign-in on production, forward-only and additive, and an
//   applied file is never edited — its checksum is what drift is measured by;
// - no bare `;` worries: src/lib/sql.js understands strings, comments and
//   trigger bodies;
// - PRAGMA foreign_keys=OFF does nothing inside the runner's batch, so a table
//   something references is rebuilt by moving the child table out first;
// - keep LIKE/GLOB patterns under 50 characters (D1 caps them, unpublished).
import schema from './0001_schema.sql';

export const MIGRATIONS = [
  { id: '0001', name: 'schema', sql: schema },
];
