// Sending a sign-in code (plan §6.5).
//
// No provider is connected yet. Until one is, staging runs with DEV_OUTBOX = "1"
// (wrangler.toml [vars]): the code goes into `dev_outbox`, keyed by the email
// HASH, and /ops shows it, so the whole flow can be tested. Production never
// sets DEV_OUTBOX, so with no provider it refuses sign-in (503) rather than
// pretending a code was sent.
//
// The address is used only inside this call, never stored and never logged.
import { fail } from './lib/http.js';

export function mailMode(env) {
  if (env.DEV_OUTBOX === '1') return 'outbox';
  return null;
}

export function assertMailAvailable(env) {
  if (!mailMode(env)) fail(503, 'email_unavailable');
}

export async function sendCode(env, { emailHash, code }) {
  if (mailMode(env) === 'outbox') {
    await env.DB.prepare('INSERT INTO dev_outbox (email_hash, code, created_at) VALUES (?, ?, ?)')
      .bind(emailHash, code, new Date().toISOString())
      .run();
    return;
  }
  fail(503, 'email_unavailable');
}
