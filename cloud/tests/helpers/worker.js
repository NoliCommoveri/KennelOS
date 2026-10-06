// Every test imports the Worker through this file. It registers the .sql hook
// first and only then imports src/ dynamically: a static import would link the
// .sql files before the hook existed. Doing it here (not with --import on the
// command line) means a bare `node --test` from the repo root works too.
import { register } from 'node:module';

register('./sql-hooks.js', import.meta.url);

export const worker = (await import('../../src/index.js')).default;
export const migrate = await import('../../src/migrate.js');
export const gate = await import('../../src/gate.js');
export const cors = await import('../../src/lib/cors.js');
export const sql = await import('../../src/lib/sql.js');
