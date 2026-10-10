// The KennelOS cloud backup Worker (docs/KennelOS_Cloud_Phase1_Plan.md §6).
//
// What reaches it:
// - /ops: the operator's page, same-origin HTML, never CORS-enabled;
// - preflights (OPTIONS) from the editions, answered from lib/cors.js;
// - /notice and /health: public, and answered even in maintenance;
// - the JSON API (api.js), behind the maintenance gate;
// - Lemon Squeezy's webhook (license.js), behind the gate too, server to
//   server: no CORS, no bearer token, an HMAC signature instead;
// - the waitlist's family pages (familyPages.js): static pages from ASSETS,
//   served whatever the schema state, and their same-origin JSON under /f/,
//   behind the gate;
// - the crons: the daily one runs retention, the hourly one the waitlist's
//   own moves (serverMoves.js: deadlines, automatic offers, reminders).
import { handleOps } from './ops.js';
import { handleApi } from './api.js';
import { schemaReady } from './gate.js';
import { activeNotices } from './notice.js';
import { handleWebhook } from './license.js';
import { handleFamilyApi, serveFamilyPage } from './familyPages.js';
import { runRetention } from './retention.js';
import { runWaitlistMoves } from './serverMoves.js';
import { applyDueEmailChanges } from './emailChange.js';
import { corsHeaders, preflight } from './lib/cors.js';
import { ApiError, json } from './lib/http.js';

// Must match the daily entry of `crons` in wrangler.toml (both environments).
export const DAILY_CRON = '17 3 * * *';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ops' || url.pathname.startsWith('/ops/')) {
      return handleOps(request, env);
    }

    const page = await serveFamilyPage(request, env, url);
    if (page) return page;

    if (request.method === 'OPTIONS') return preflight(request);

    const cors = corsHeaders(request);

    try {
      // Service notices are the shutdown channel, so they're served whatever
      // state the schema is in (no table yet = no notices).
      if (url.pathname === '/notice' && request.method === 'GET') {
        const notices = env.DB ? await activeNotices(env) : [];
        return json({ notices }, 200, { ...cors, 'cache-control': 'public, max-age=300' });
      }

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

      if (url.pathname === '/webhooks/lemonsqueezy' && request.method === 'POST') return await handleWebhook(request, env);
      if (url.pathname.startsWith('/f/')) return await handleFamilyApi(request, env, url);

      return await handleApi(request, env, url, cors);
    } catch (err) {
      if (err instanceof ApiError) {
        const extra = err.status === 429 ? { 'retry-after': '3600' } : {};
        return json({ error: err.code, ...err.extra }, err.status, { ...cors, ...extra });
      }
      // The message only: never a request body, an email, a code or a token
      // (plan §6.4).
      console.error('unhandled', String(err?.message ?? err));
      return json({ error: 'internal' }, 500, cors);
    }
  },

  // The crons ([triggers] in wrangler.toml), in UTC, never retried. The daily one
  // (DAILY_CRON) runs retention, which is idempotent and /ops can run by hand; the
  // hourly one runs the waitlist's moves, each of which happens once whenever it runs.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      if (!(await schemaReady(env.DB))) {
        console.log('cron skipped: migrations pending');
        return;
      }
      if (event.cron === DAILY_CRON) console.log('retention', JSON.stringify(await runRetention(env)));
      else {
        console.log('waitlist moves', JSON.stringify(await runWaitlistMoves(env)));
        console.log('email changes', JSON.stringify(await applyDueEmailChanges(env)));
      }
    })());
  },
};
