// The KennelOS cloud backup Worker (docs/KennelOS_Cloud_Phase1_Plan.md §6).
//
// Three kinds of request reach it:
// - /ops: the operator's page, same-origin HTML, never CORS-enabled;
// - preflights (OPTIONS) from the editions, answered from lib/cors.js;
// - the JSON API the editions call cross-origin. Step 3a has only /health; the
//   rest (auth, snapshots, files, notice) lands in step 3b, between the gate and
//   the closing 404 below.
import { handleOps } from './ops.js';
import { schemaReady } from './gate.js';
import { corsHeaders, preflight } from './lib/cors.js';
import { json } from './lib/http.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ops' || url.pathname.startsWith('/ops/')) {
      return handleOps(request, env);
    }

    if (request.method === 'OPTIONS') return preflight(request);

    const cors = corsHeaders(request);

    try {
      const ready = env.DB ? await schemaReady(env.DB) : false;

      // Unauthenticated liveness, so a client or a person can tell "down" from
      // "in maintenance" from "up". Nothing with a count in it: that is /ops's.
      if (url.pathname === '/health' && request.method === 'GET') {
        return json({ ok: ready, maintenance: !ready }, 200, cors);
      }

      // Every API route sits behind this (plan §6.1).
      if (!ready) {
        return json({ maintenance: true }, 503, { ...cors, 'retry-after': '300' });
      }

      return json({ error: 'not_found' }, 404, cors);
    } catch (err) {
      // The message only: never a request body, an email, a code or a token
      // (plan §6.4).
      console.error('unhandled', String(err?.message ?? err));
      return json({ error: 'internal' }, 500, cors);
    }
  },
};
