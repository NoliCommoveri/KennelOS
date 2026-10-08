// Sending a sign-in code (plan §6.5). The provider is Resend.
//
// - With the RESEND_API_KEY secret set, the code is emailed through Resend's API
//   from MAIL_FROM (wrangler.toml [vars]).
// - Without it, staging (DEV_OUTBOX = "1") puts the code in `dev_outbox`, keyed
//   by the email HASH, and /ops shows it.
// - With neither (production before the key is set), sign-in refuses with 503
//   rather than pretending a code was sent.
//
// The address is used only inside this call: never stored, never logged. A
// failed send logs Resend's status code and nothing else.
import { fail } from './lib/http.js';

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'KennelOS <signin@kennelos.app>';

export function mailMode(env) {
  if (env.RESEND_API_KEY) return 'resend';
  if (env.DEV_OUTBOX === '1') return 'outbox';
  return null;
}

export function assertMailAvailable(env) {
  if (!mailMode(env)) fail(503, 'email_unavailable');
}

// The message itself. Plain text only: no tracking pixels, no links (a tapped
// link would open Safari, not the home-screen app; plan §2.1).
export function codeMessage(code, minutes) {
  return {
    subject: `Your KennelOS code: ${code}`,
    text: `Your KennelOS sign-in code is ${code}\n\n`
      + `Type it into the app within ${minutes} minutes.\n\n`
      + 'If you did not ask for this code, you can ignore this email.\n',
  };
}

// The code that links a Pro purchase made with this address to a cloud
// account (License Link Plan §5). Says what it's for, so a code nobody asked
// for is noticed rather than typed in.
export function linkCodeMessage(code, minutes) {
  return {
    subject: `Your KennelOS code: ${code}`,
    text: `Your KennelOS code is ${code}\n\n`
      + 'It links the KennelOS Pro purchase made with this email address to a KennelOS cloud backup account. '
      + `Type it into the app within ${minutes} minutes.\n\n`
      + 'If you did not ask for this, ignore this email: without the code nothing is linked.\n',
  };
}

// /ops's "Send a test email": proves the domain, the key and delivery work
// before any app screen exists. Resend only; there is nothing to test otherwise.
export async function sendTestEmail(env, rawEmail) {
  const email = String(rawEmail ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: 'That is not an email address.' };
  if (mailMode(env) !== 'resend') return { ok: false, reason: 'RESEND_API_KEY is not set, so there is nothing to test.' };
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || DEFAULT_FROM,
      to: [email],
      subject: 'KennelOS test email',
      text: 'This is a test sent from KennelOS ops. Sign-in codes will come from this address.\n',
    }),
  });
  if (res.ok) return { ok: true };
  let detail = '';
  try { detail = (await res.json()).message ?? ''; } catch { /* no body */ }
  return { ok: false, reason: `Resend refused it (${res.status})${detail ? `: ${detail}` : ''}` };
}

// A plain-text email to a family (Waitlist W2 Plan §8), recorded in wl_messages
// either way. Without Resend (staging's outbox mode) nothing is delivered: the
// row is kept as `sent` with no delivery, and the breeder's Copy status link is
// the way to reach a family there. → 'sent' | 'failed'. The address is used only
// for the send and the wl_messages row; never logged.
export async function sendFamilyMessage(env, { programId, publicId, entryId = null, kind, to, subject, text }, now = new Date()) {
  const mode = mailMode(env);
  if (!mode) fail(503, 'email_unavailable');
  let status = 'sent';
  if (mode === 'resend') {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || DEFAULT_FROM, to: [to], subject, text }),
    });
    if (!res.ok) {
      console.error('resend send failed', res.status);
      status = 'failed';
    }
  }
  const at = now.toISOString();
  await env.DB.prepare(
    `INSERT INTO wl_messages (id, program_id, public_id, entry_id, kind, to_email, subject, body, send_after, status, sent_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), programId, publicId, entryId, kind, to, subject, text, at, status, status === 'sent' ? at : null, at).run();
  return status;
}

// `message` overrides the sign-in wording (linkCodeMessage). The staging
// outbox shows the code either way.
export async function sendCode(env, { email, emailHash, code, minutes, message = null }) {
  const mode = mailMode(env);

  if (mode === 'resend') {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || DEFAULT_FROM, to: [email], ...(message ?? codeMessage(code, minutes)) }),
    });
    if (!res.ok) {
      console.error('resend send failed', res.status);
      fail(502, 'email_failed');
    }
    return;
  }

  if (mode === 'outbox') {
    await env.DB.prepare('INSERT INTO dev_outbox (email_hash, code, created_at) VALUES (?, ?, ?)')
      .bind(emailHash, code, new Date().toISOString())
      .run();
    return;
  }

  fail(503, 'email_unavailable');
}
