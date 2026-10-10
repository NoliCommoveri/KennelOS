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

// --- Emails to families, in the kennel's name (Waitlist W2 Plan §8, step 6) ------
//
// From `"Thornfield Kennels" <thornfield@mail.kennelos.app>` (MAIL_FAMILY_DOMAIN,
// a sending domain of its own in Resend, so families' spam reports never touch
// the sign-in address). No Reply-To: replies go nowhere, and every email says to
// answer on the status page (Spec §15.4). Without MAIL_FAMILY_DOMAIN, MAIL_FROM.

// Local parts the family domain never hands to a kennel.
const RESERVED_LOCAL = new Set(['admin', 'abuse', 'postmaster', 'hostmaster', 'webmaster', 'mailer-daemon', 'noreply',
  'no-reply', 'support', 'security', 'signin', 'kennelos', 'help', 'info', 'billing', 'root']);

// Pure: the name-made part of a kennel's address. "Thornfield Kennels" →
// "thornfield-kennels"; accents dropped; nothing usable → "kennel".
export function senderBase(kennelName) {
  const s = String(kennelName ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return s || 'kennel';
}

// Pure: a display name safe inside quotes in a From header.
export function senderDisplayName(kennelName) {
  const s = String(kennelName ?? '').replace(/[\u0000-\u001f\u007f"\\<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
  return s || 'Waitlist';
}

// The kennel's address on the family domain: the one it has if its name hasn't
// changed, else the first free of base, base-xxxx, base-xxxxxxxx… (from its
// public id), claimed in wl_senders. → '"Name" <local@domain>'
export async function familySender(env, { programId, publicId, kennelName }, now = new Date()) {
  const display = senderDisplayName(kennelName);
  if (!env.MAIL_FAMILY_DOMAIN) return env.MAIL_FROM || DEFAULT_FROM;
  const base = senderBase(kennelName);
  const mine = await env.DB.prepare('SELECT base, local_part FROM wl_senders WHERE public_id = ?').bind(publicId).first();
  let local = mine && mine.base === base ? mine.local_part : null;
  if (!local) {
    const hex = String(publicId).replace(/^kos1_/, '').replace(/-/g, '');
    const tries = [base, `${base}-${hex.slice(0, 4)}`, `${base}-${hex.slice(0, 8)}`, `${base}-${hex.slice(0, 12)}`, `k-${hex}`];
    for (const candidate of tries) {
      if (RESERVED_LOCAL.has(candidate)) continue;
      const owner = await env.DB.prepare('SELECT public_id FROM wl_senders WHERE local_part = ?').bind(candidate).first();
      if (owner && owner.public_id !== publicId) continue;
      try {
        await env.DB.prepare(
          `INSERT INTO wl_senders (public_id, program_id, base, local_part, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (public_id) DO UPDATE SET base = excluded.base, local_part = excluded.local_part`,
        ).bind(publicId, programId, base, candidate, now.toISOString()).run();
        local = candidate;
        break;
      } catch {
        // Claimed by another kennel a moment ago: the next one.
      }
    }
  }
  return local ? `"${display}" <${local}@${env.MAIL_FAMILY_DOMAIN}>` : (env.MAIL_FROM || DEFAULT_FROM);
}

// Pure: what ends every email her device sends a family. The link opens their
// status page, the one place they answer (Spec §8.3).
export function familyFooter(link, kennelName) {
  const name = senderDisplayName(kennelName);
  return '\n\n--\n'
    + `Reply or take action on your status page:\n${link}\n\n`
    + `This address doesn't receive replies. To write to ${name}, use the message box on your status page.\n`;
}

// A plain-text email to a family, recorded in wl_messages either way (`body` is
// the text without the footer: what their status page shows). Without Resend
// (staging's outbox mode) nothing is delivered: the row is kept as `sent` with no
// delivery. `id` makes a retry the same message: a row already there is updated,
// never doubled. → 'sent' | 'failed'. The address is used only for the send and
// the wl_messages row; never logged.
export async function sendFamilyMessage(env, {
  id = crypto.randomUUID(), programId, publicId, entryId = null, kind, to, subject, text, from = null, footer = '',
}, now = new Date()) {
  const mode = mailMode(env);
  if (!mode) fail(503, 'email_unavailable');
  let status = 'sent';
  if (mode === 'resend') {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: from || env.MAIL_FROM || DEFAULT_FROM, to: [to], subject, text: text + footer }),
    });
    if (!res.ok) {
      console.error('resend send failed', res.status);
      status = 'failed';
    }
  }
  const at = now.toISOString();
  await env.DB.prepare(
    `INSERT INTO wl_messages (id, program_id, public_id, entry_id, kind, to_email, subject, body, send_after, status, sent_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET to_email = excluded.to_email, subject = excluded.subject, body = excluded.body,
       status = excluded.status, sent_at = excluded.sent_at`,
  ).bind(id, programId, publicId, entryId, kind, to, subject, text, at, status, status === 'sent' ? at : null, at).run();
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

// A plain notice to the account's address (no code in it), such as the warning
// that a recovery code asked to change the email (recovery.js). Staging's
// outbox records it as 'notice' so /ops shows that one went out.
export async function sendNotice(env, { email, emailHash, message }) {
  const mode = mailMode(env);
  if (mode === 'resend') {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || DEFAULT_FROM, to: [email], ...message }),
    });
    if (!res.ok) {
      console.error('resend send failed', res.status);
      fail(502, 'email_failed');
    }
    return;
  }
  if (mode === 'outbox') {
    await env.DB.prepare('INSERT INTO dev_outbox (email_hash, code, created_at) VALUES (?, ?, ?)')
      .bind(emailHash, 'notice', new Date().toISOString()).run();
    return;
  }
  fail(503, 'email_unavailable');
}
