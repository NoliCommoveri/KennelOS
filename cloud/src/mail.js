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

export async function sendCode(env, { email, emailHash, code, minutes }) {
  const mode = mailMode(env);

  if (mode === 'resend') {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || DEFAULT_FROM, to: [email], ...codeMessage(code, minutes) }),
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
