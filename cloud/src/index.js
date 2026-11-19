// The KennelOS cloud backup Worker (docs/KennelOS_Cloud_Phase1_Plan.md §6).
//
// What reaches it:
// - /ops: the operator's page, same-origin HTML, never CORS-enabled;
// - /manager: support's installable manager app (assist.js), same-origin, likewise;
// - preflights (OPTIONS) from the editions, answered from lib/cors.js;
// - /notice and /health: public, and answered even in maintenance;
// - the JSON API (api.js), behind the maintenance gate;
// - Lemon Squeezy's webhook (license.js), behind the gate too, server to
//   server: no CORS, no bearer token, an HMAC signature instead;
// - the waitlist's family pages (familyPages.js): static pages from ASSETS,
//   served whatever the schema state, and their same-origin JSON under /f/,
//   behind the gate;
// - Firma's template editor page (firma.js serveEsignEditor): a sandboxed static
//   page from ASSETS, opened in its own tab by her device; and /signed/, the
//   signed copies KennelOS keeps (firma.js serveSignedCopy, D33);
// - the crons: the daily one runs retention, the half-hourly one (:00, :30) the waitlist's
//   own moves (serverMoves.js: deadlines, automatic offers, reminders) and, on :00, the
//   breeder's email digests (notify.js) and the signed copies to keep and
//   email (firma.js runEsignCopies);
// - /notify/off: the digest email's turn-off page (notify.js).
import { handleOps } from './ops.js';
import { handleManager } from './assist.js';
import { handleApi } from './api.js';
import { schemaReady } from './gate.js';
import { activeNotices } from './notice.js';
import { handleWebhook } from './license.js';
import { handleHook } from './integrations.js';
// Importing firma.js registers the Firma adapter for /hooks/firma/ (Integrations plan §2.3a).
import { serveEsignEditor, serveSignedCopy, runEsignCopies, runEsignPreviews } from './firma.js';
import { handleFamilyApi, serveFamilyPage } from './familyPages.js';
import { runRetention } from './retention.js';
import { runWaitlistMoves } from './serverMoves.js';
import { applyDueEmailChanges } from './emailChange.js';
import { handleDigestOff, runDigests } from './notify.js';
import { corsHeaders, preflight, WEBSITE_PATHS, websiteCors, websitePreflight } from './lib/cors.js';
import { ApiError, json } from './lib/http.js';

// Must match the daily entry of `crons` in wrangler.toml (both environments).
export const DAILY_CRON = '17 3 * * *';

// Every request, family pages and preflights included, goes through one `try`, so
// anything that throws answers JSON with CORS rather than Cloudflare's own error
// page (review K4-12). `state.cors` is filled once the request's CORS is known.
async function route(request, env, state) {
  const url = new URL(request.url);

  if (url.pathname === '/ops' || url.pathname.startsWith('/ops/')) {
    return handleOps(request, env);
  }

  // Support's manager app (assist.js): same-origin, its own cookie, like /ops.
  if (url.pathname === '/manager' || url.pathname.startsWith('/manager/')) {
    if (url.pathname === '/manager') return Response.redirect(`${url.origin}/manager/`, 301);
    const ready = env.DB ? await schemaReady(env.DB) : false;
    if (!ready && url.pathname.startsWith('/manager/api/')) return json({ error: 'maintenance', maintenance: true }, 503);
    return handleManager(request, env);
  }

  const page = await serveFamilyPage(request, env, url) || await serveEsignEditor(request, env, url) || await serveSignedCopy(request, env, url);
  if (page) return page;

  // Her KennelPort website's application form calls three family endpoints
  // (lib/cors.js WEBSITE_PATHS); everything else answers the editions only.
  const fromWebsite = WEBSITE_PATHS.test(url.pathname);
  if (request.method === 'OPTIONS') return fromWebsite ? websitePreflight(request, env) : preflight(request, env);

  const cors = fromWebsite ? websiteCors(request, env) : corsHeaders(request, env);
  state.cors = cors;

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

  // The digest email's turn-off link: a page with a button, same origin, no CORS.
  if (url.pathname === '/notify/off' && (request.method === 'GET' || request.method === 'POST')) return await handleDigestOff(request, env, url);
  if (url.pathname === '/webhooks/lemonsqueezy' && request.method === 'POST') return await handleWebhook(request, env);
  if (url.pathname.startsWith('/hooks/') && request.method === 'POST') return await handleHook(request, env, url);
  if (url.pathname.startsWith('/f/')) {
    const res = await handleFamilyApi(request, env, url);
    if (fromWebsite) for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  }

  return await handleApi(request, env, url, cors);
}

export default {
  async fetch(request, env) {
    const state = { cors: {} };
    try {
      return await route(request, env, state);
    } catch (err) {
      const { cors } = state;
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

  // Each job runs on its own: one that throws is logged and the others still run
  // (review K4-3). The logs are the only place the operator sees a failed job.
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        if (!(await schemaReady(env.DB))) {
          console.log('cron skipped: migrations pending');
          return;
        }
      } catch (err) {
        console.error('cron failed: schema check', String(err?.message ?? err));
        return;
      }
      // The half-hourly cron (Waitlist Timers plan T3) runs the waitlist's moves on :00
      // and :30, so a deadline at a time of day closes on it; the other jobs keep one
      // run an hour, the :00 one.
      const halfPast = Number.isFinite(event.scheduledTime) && new Date(event.scheduledTime).getUTCMinutes() >= 30;
      const jobs = event.cron === DAILY_CRON
        ? [['retention', runRetention]]
        : [['waitlist moves', runWaitlistMoves], ...(halfPast ? [] : [['email changes', applyDueEmailChanges], ['digests', runDigests],
          ['esign copies', runEsignCopies], ['esign previews', runEsignPreviews]])];
      for (const [name, run] of jobs) {
        try {
          console.log(name, JSON.stringify(await run(env)));
        } catch (err) {
          console.error(`${name} failed`, String(err?.message ?? err));
        }
      }
    })());
  },
};
