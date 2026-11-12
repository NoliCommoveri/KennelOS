// E-sign through Firma (docs/KennelOS_Integrations_Plan.md §2.3a, step 8; D25–D26).
//
// KennelOS holds one Firma company. Each cloud program that connects gets its own
// Firma WORKSPACE: her templates, signing requests and signed documents live there,
// walled off from every other program's by Firma. The company's master key (the
// Worker secret FIRMA_API_KEY) is used only to make and set up a workspace and to
// remove its webhook; everything she does runs on her workspace's own key, so
// Firma itself keeps one program out of another's templates and documents.
//
//   GET  /integrations/firma                   connected? and this month's sends
//   POST /integrations/firma/connect           make her workspace (once)
//   POST /integrations/firma/fields            the facts her templates can fill
//   GET  /integrations/firma/templates         her templates
//   POST /integrations/firma/templates         a new template from her PDF
//   POST /integrations/firma/template-token    a 24-hour token for Firma's editor
//   POST /integrations/esign/send              send a contract (counts, D26)
//   GET  /integrations/esign/document?ref=     a short-lived link to the signed PDF
//   POST /hooks/firma/<secret>                 Firma's webhook (integrations.js)
//
// The connection's sealed token (integrations.js) is JSON: her workspace's API key,
// its webhook signing secret and the webhook's id. Never sent to a device.
//
// What goes to Firma: her kennel's name (the workspace), her template PDFs, and per
// send the signer's name and email and the contract's facts (the allow-list her
// device builds, shared/data/contractForms.js). What is kept here: ids, statuses
// and times (esign_sends). Never logged: a key, a secret, a name, an email, a fact,
// a body.
import { herSide, registerAdapter, createConnection, openToken, sealToken } from './integrations.js';
import { hmacHexBytes, timingSafeEqual } from './lib/crypto.js';
import { fail } from './lib/http.js';

export const FIRMA_DEFAULT_URL = 'https://api.firma.dev/functions/v1/signing-request-api';
export const ESIGN_DEFAULT_MONTHLY_LIMIT = 10;
export const ESIGN_LIMIT_MAX = 10000;
const LIMIT_KEY = 'esign_monthly_limit';
const SIGNATURE_WINDOW_S = 300;
const TEMPLATE_DOC_MAX = 6_000_000; // base64 characters; Firma refuses a body over 6,291,456 bytes
const HOOK_EVENTS = [
  'signing_request.completed', 'signing_request.recipient.declined',
  'signing_request.expired', 'signing_request.cancelled',
];

const UUIDISH = /^[A-Za-z0-9_-]{1,64}$/;
const FACT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;
const text = (v) => (typeof v === 'string' ? v.trim() : '');

// --- Talking to Firma -----------------------------------------------------------------------

const base = (env) => (env.FIRMA_API_URL || FIRMA_DEFAULT_URL).replace(/\/+$/, '');

// → { status, data }. A network failure is { status: 0 }. Firma's body is parsed
// when it is JSON; nothing from it is logged.
async function firma(env, key, method, path, body) {
  let res;
  try {
    res = await fetch(`${base(env)}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { status: 0, data: null };
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data };
}

const ok = (r) => r.status >= 200 && r.status < 300;
// Firma's error code (e.g. VALIDATION_ERROR, RECIPIENT_EMAIL_SUPPRESSED), never its message.
const firmaCode = (r) => (typeof r.data?.code === 'string' && /^[A-Z0-9_]{1,60}$/.test(r.data.code) ? r.data.code : null);

function masterKey(env) {
  if (!env.FIRMA_API_KEY) fail(503, 'esign_not_configured');
  return env.FIRMA_API_KEY;
}

// --- Her connection -------------------------------------------------------------------------

async function connectionOf(env, programId) {
  return env.DB.prepare("SELECT * FROM int_connections WHERE program_id = ? AND provider = 'firma' ORDER BY connected_at LIMIT 1")
    .bind(programId).first();
}

async function secretsOf(env, connection) {
  try { return JSON.parse(await openToken(env, connection)) || {}; } catch { return {}; }
}

// Her connection and its workspace key, or 409 when she hasn't connected.
async function mine(env, auth) {
  const connection = await connectionOf(env, auth.programId);
  if (!connection) fail(409, 'esign_not_connected');
  const secrets = await secretsOf(env, connection);
  if (!secrets.apiKey) fail(409, 'esign_not_connected');
  return { connection, secrets };
}

// --- The monthly limit (D26) ----------------------------------------------------------------

// The first instant of this UTC month, and the first of the next (when it resets).
export function monthBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), resetsOn: next.toISOString().slice(0, 10) };
}

const cleanLimit = (v) => {
  if (v == null || (typeof v === 'string' && !/^\d+$/.test(v.trim()))) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= ESIGN_LIMIT_MAX ? n : null;
};

export async function defaultMonthlyLimit(env) {
  const v = await env.DB.prepare('SELECT value FROM ops_config WHERE key = ?').bind(LIMIT_KEY).first('value');
  return cleanLimit(v) ?? ESIGN_DEFAULT_MONTHLY_LIMIT;
}

// { limit, own }: her own limit when /ops set one, else the default.
export async function monthlyLimitFor(env, programId) {
  const own = await env.DB.prepare('SELECT monthly_limit FROM esign_limits WHERE program_id = ?').bind(programId).first('monthly_limit');
  return own == null ? { limit: await defaultMonthlyLimit(env), own: false } : { limit: Number(own), own: true };
}

export async function sendsThisMonth(env, programId, now = new Date()) {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM esign_sends WHERE program_id = ? AND sent_at >= ?')
    .bind(programId, monthBounds(now).start).first('n')) ?? 0;
}

export async function usage(env, programId, now = new Date()) {
  const { limit, own } = await monthlyLimitFor(env, programId);
  return { used: await sendsThisMonth(env, programId, now), limit, own, resetsOn: monthBounds(now).resetsOn };
}

// /ops: the default, or one program's own limit (null = back to the default).
export async function setDefaultMonthlyLimit(env, value, now = new Date()) {
  const n = cleanLimit(value);
  if (n === null) fail(400, 'bad_limit');
  await env.DB.prepare(
    'INSERT INTO ops_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).bind(LIMIT_KEY, String(n), now.toISOString()).run();
  return n;
}

export async function setProgramMonthlyLimit(env, programId, value, now = new Date()) {
  if (value === null || value === '') {
    await env.DB.prepare('DELETE FROM esign_limits WHERE program_id = ?').bind(programId).run();
    return null;
  }
  const n = cleanLimit(value);
  if (n === null) fail(400, 'bad_limit');
  await env.DB.prepare(
    'INSERT INTO esign_limits (program_id, monthly_limit, updated_at) VALUES (?, ?, ?) ON CONFLICT(program_id) DO UPDATE SET monthly_limit = excluded.monthly_limit, updated_at = excluded.updated_at',
  ).bind(programId, n, now.toISOString()).run();
  return n;
}

// /ops summary: counts only.
export async function esignOpsSummary(env, now = new Date()) {
  const { start } = monthBounds(now);
  const summary = {
    configured: !!env.FIRMA_API_KEY,
    testMode: env.FIRMA_TEST_MODE === 'true',
    defaultLimit: await defaultMonthlyLimit(env),
    workspaces: (await env.DB.prepare("SELECT COUNT(*) AS n FROM int_connections WHERE provider = 'firma'").first('n')) ?? 0,
    sendsThisMonth: (await env.DB.prepare('SELECT COUNT(*) AS n FROM esign_sends WHERE sent_at >= ?').bind(start).first('n')) ?? 0,
    unknownThisMonth: (await env.DB.prepare("SELECT COUNT(*) AS n FROM esign_sends WHERE sent_at >= ? AND status = 'unknown'").bind(start).first('n')) ?? 0,
    ownLimits: (await env.DB.prepare('SELECT COUNT(*) AS n FROM esign_limits').first('n')) ?? 0,
    credits: null,
  };
  if (summary.configured) {
    const r = await firma(env, env.FIRMA_API_KEY, 'GET', '/company');
    if (ok(r) && Number.isFinite(Number(r.data?.credits))) summary.credits = Number(r.data.credits);
  }
  return summary;
}

// --- Routes ---------------------------------------------------------------------------------

// GET /integrations/firma
export async function firmaStatus(env, auth, now = new Date()) {
  await herSide(env, auth);
  const connection = await connectionOf(env, auth.programId);
  return {
    available: !!env.FIRMA_API_KEY,
    connected: !!connection,
    connectedAt: connection?.connected_at ?? null,
    usage: await usage(env, auth.programId, now),
  };
}

// POST /integrations/firma/connect { kennelName }. Makes her workspace, its
// webhook to /hooks/firma/<secret>, and turns its webhooks on. Once only: a
// second call answers the connection she has.
export async function connectFirma(env, auth, url, body, now = new Date()) {
  await herSide(env, auth);
  const master = masterKey(env);
  if (!env.INT_TOKEN_KEY) fail(503, 'integrations_not_configured');
  const existing = await connectionOf(env, auth.programId);
  if (existing) return { connected: true, connectedAt: existing.connected_at, usage: await usage(env, auth.programId, now) };

  const name = text(body?.kennelName).replace(/\s+/g, ' ').slice(0, 100) || 'KennelOS kennel';
  const ws = await firma(env, master, 'POST', '/workspaces', { name });
  const workspaceId = ws.data?.id;
  const apiKey = env.FIRMA_TEST_MODE === 'true' ? ws.data?.test_api_key : ws.data?.api_key;
  if (!ok(ws) || !workspaceId || !apiKey) {
    console.error('firma: workspace not made', ws.status);
    fail(502, 'esign_setup_failed');
  }

  const { id, hookPath } = await createConnection(env, auth.programId,
    { provider: 'firma', accountRef: String(workspaceId), token: JSON.stringify({ apiKey }) }, now);
  const undo = async (webhookId) => {
    if (webhookId) await firma(env, master, 'DELETE', `/webhooks/${encodeURIComponent(webhookId)}`);
    await env.DB.prepare('DELETE FROM int_connections WHERE id = ?').bind(id).run();
  };

  const hook = await firma(env, master, 'POST', '/webhooks', {
    url: `${url.origin}${hookPath}`, events: HOOK_EVENTS, workspace_id: workspaceId, description: 'KennelOS',
  });
  const webhookId = hook.data?.id;
  if (!ok(hook) || !webhookId) {
    console.error('firma: webhook not made', hook.status);
    await undo(null);
    fail(502, 'esign_setup_failed');
  }
  // Webhooks deliver only while the workspace's own switch is on; turning it on
  // makes the workspace's signing secret.
  await firma(env, master, 'PATCH', `/workspaces/${encodeURIComponent(workspaceId)}`, { webhook_enabled: true });
  let webhookSecret = (await firma(env, master, 'GET', `/workspaces/${encodeURIComponent(workspaceId)}`)).data?.webhook_secret;
  if (!webhookSecret) {
    webhookSecret = (await firma(env, master, 'POST', `/workspaces/${encodeURIComponent(workspaceId)}/webhooks/rotate-secret`)).data?.new_secret;
  }
  if (typeof webhookSecret !== 'string' || webhookSecret.length < 16) {
    console.error('firma: no webhook secret');
    await undo(webhookId);
    fail(502, 'esign_setup_failed');
  }

  const row = { id, program_id: auth.programId, provider: 'firma' };
  const sealed = await sealToken(env, row, JSON.stringify({ apiKey, webhookSecret, webhookId: String(webhookId) }));
  await env.DB.prepare('UPDATE int_connections SET token_sealed = ? WHERE id = ?').bind(sealed, id).run();
  return { connected: true, connectedAt: now.toISOString(), usage: await usage(env, auth.programId, now) };
}

// POST /integrations/firma/fields { fields: [{ name, label }] }: the facts her
// device can fill (contractForms.js PREFILL_FIELDS), made as her workspace's custom
// fields so Firma's template editor offers them. Adds the missing ones only, so
// it is safe to repeat; at most 40 per call (a Worker's outbound calls are capped).
export async function syncFirmaFields(env, auth, body) {
  await herSide(env, auth);
  const { connection, secrets } = await mine(env, auth);
  const wanted = (Array.isArray(body?.fields) ? body.fields : [])
    .map((f) => ({ name: text(f?.name), label: text(f?.label).slice(0, 100) }))
    .filter((f) => FACT_NAME.test(f.name) && f.label);
  if (wanted.length > 40) fail(400, 'too_many_fields');
  const ws = encodeURIComponent(connection.account_ref);
  const list = await firma(env, secrets.apiKey, 'GET', `/workspace/${ws}/custom-fields`);
  if (!ok(list)) fail(502, 'esign_unavailable');
  const rows = Array.isArray(list.data) ? list.data : (list.data?.results ?? list.data?.custom_fields ?? []);
  const have = new Set(rows.map((r) => String(r?.field_name ?? '').toLowerCase()));
  let added = 0;
  for (const f of wanted) {
    if (have.has(f.name.toLowerCase())) continue;
    const r = await firma(env, secrets.apiKey, 'POST', `/workspace/${ws}/custom-fields`, { field_label: f.label, field_name: f.name });
    if (!ok(r)) fail(502, 'esign_unavailable', { added });
    have.add(f.name.toLowerCase());
    added++;
  }
  return { added };
}

// GET /integrations/firma/templates
export async function listFirmaTemplates(env, auth) {
  await herSide(env, auth);
  const { secrets } = await mine(env, auth);
  const r = await firma(env, secrets.apiKey, 'GET', '/templates?page_size=100&sort_by=name&sort_order=asc');
  if (!ok(r)) fail(502, 'esign_unavailable');
  return {
    templates: (r.data?.results ?? []).filter((t) => t?.id).map((t) => ({
      id: String(t.id), name: String(t.name ?? ''), pageCount: Number(t.page_count) || null,
    })),
  };
}

// POST /integrations/firma/templates { name, document: base64 PDF }
export async function createFirmaTemplate(env, auth, body) {
  await herSide(env, auth);
  const { secrets } = await mine(env, auth);
  const name = text(body?.name).slice(0, 255);
  const document = typeof body?.document === 'string' ? body.document.replace(/\s+/g, '') : '';
  if (!name) fail(400, 'name_required');
  if (!document || !/^[A-Za-z0-9+/]+=*$/.test(document)) fail(400, 'document_required');
  if (document.length > TEMPLATE_DOC_MAX) fail(413, 'too_large');
  const r = await firma(env, secrets.apiKey, 'POST', '/templates', { name, document });
  if (!ok(r) || !r.data?.id) {
    if (r.status >= 400 && r.status < 500) fail(400, 'esign_refused', { code: firmaCode(r) });
    fail(502, 'esign_unavailable');
  }
  return { id: String(r.data.id), name: String(r.data.name ?? name), pageCount: Number(r.data.page_count) || null };
}

// POST /integrations/firma/template-token { templateId } → { token, expiresAt }:
// opens her template in Firma's embedded editor. The template is read with her
// workspace's key first, so a template of another workspace is a 404 here.
export async function firmaTemplateToken(env, auth, body) {
  await herSide(env, auth);
  const { secrets } = await mine(env, auth);
  const templateId = text(body?.templateId);
  if (!UUIDISH.test(templateId)) fail(400, 'bad_template');
  const t = await firma(env, secrets.apiKey, 'GET', `/templates/${encodeURIComponent(templateId)}`);
  if (t.status === 404 || t.status === 403) fail(404, 'not_found');
  if (!ok(t)) fail(502, 'esign_unavailable');
  const r = await firma(env, secrets.apiKey, 'POST', '/generate-template-token', { companies_workspaces_templates_id: templateId });
  if (!ok(r) || typeof r.data?.token !== 'string') fail(502, 'esign_unavailable');
  return { token: r.data.token, expiresAt: r.data.expires_at ?? null };
}

const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/;
const httpsLink = (v) => (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : null);

// The signer's own link when Firma didn't hand it back (a send that had started
// before an error): the first Signer of the request.
async function signerLink(env, key, signingRequestId) {
  const r = await firma(env, key, 'GET', `/signing-requests/${encodeURIComponent(signingRequestId)}/users`);
  const users = Array.isArray(r.data) ? r.data : (r.data?.results ?? []);
  const signer = users.find((u) => u?.designation === 'Signer') || users[0];
  return httpsLink(signer?.signing_link) || (signer?.id ? `https://app.firma.dev/signing/${encodeURIComponent(signer.id)}` : null);
}

// POST /integrations/esign/send
//   { contractId, templateId, title, signer: { firstName, lastName, email },
//     facts: { <fact>: <text> }, emailSigner = true, resend = false }
// → { signingRequestId, signingLink, usage }
//
// A row is reserved in esign_sends BEFORE Firma is called, and only while the
// month's count is under her limit, so two sends at once can't pass it. A send
// Firma refused frees its row; one whose outcome is unknown keeps it (its credit
// may be spent) and says so.
export async function sendForSignature(env, auth, body, now = new Date()) {
  await herSide(env, auth);
  const { connection, secrets } = await mine(env, auth);

  const contractId = text(body?.contractId);
  const templateId = text(body?.templateId);
  if (!UUIDISH.test(contractId)) fail(400, 'bad_contract');
  if (!UUIDISH.test(templateId)) fail(400, 'bad_template');
  const firstName = text(body?.signer?.firstName).slice(0, 100);
  const lastName = text(body?.signer?.lastName).slice(0, 100);
  const email = text(body?.signer?.email).toLowerCase();
  if (!firstName) fail(400, 'signer_name_required');
  if (!EMAIL.test(email)) fail(400, 'signer_email_required');
  const facts = {};
  const rawFacts = body?.facts && typeof body.facts === 'object' && !Array.isArray(body.facts) ? body.facts : {};
  if (Object.keys(rawFacts).length > 80) fail(400, 'too_many_facts');
  for (const [k, v] of Object.entries(rawFacts)) {
    const value = typeof v === 'number' ? String(v) : text(v);
    if (FACT_NAME.test(k) && value) facts[k] = value.slice(0, 500);
  }
  const title = text(body?.title).slice(0, 200) || 'Contract';

  const live = await env.DB.prepare(
    "SELECT signing_request_id, status FROM esign_sends WHERE program_id = ? AND contract_id = ? AND status IN ('sending', 'sent', 'unknown') ORDER BY sent_at DESC LIMIT 1",
  ).bind(auth.programId, contractId).first();
  if (live && body?.resend !== true) fail(409, 'already_sent', { signingRequestId: live.signing_request_id ?? null, status: live.status });

  const { limit } = await monthlyLimitFor(env, auth.programId);
  const { start } = monthBounds(now);
  const rowId = crypto.randomUUID();
  const at = now.toISOString();
  const reserved = await env.DB.prepare(
    `INSERT INTO esign_sends (id, program_id, connection_id, contract_id, template_id, signing_request_id, status, sent_at, updated_at)
     SELECT ?, ?, ?, ?, ?, NULL, 'sending', ?, ?
      WHERE (SELECT COUNT(*) FROM esign_sends WHERE program_id = ? AND sent_at >= ?) < ?`,
  ).bind(rowId, auth.programId, connection.id, contractId, templateId, at, at, auth.programId, start, limit).run();
  if (!reserved.meta?.changes) fail(409, 'esign_limit_reached', { usage: await usage(env, auth.programId, now) });

  const settle = (status, signingRequestId = null) => env.DB.prepare(
    'UPDATE esign_sends SET status = ?, signing_request_id = COALESCE(?, signing_request_id), updated_at = ? WHERE id = ?',
  ).bind(status, signingRequestId, new Date().toISOString(), rowId).run();
  const free = () => env.DB.prepare('DELETE FROM esign_sends WHERE id = ?').bind(rowId).run();

  const r = await firma(env, secrets.apiKey, 'POST', '/signing-requests/create-and-send', {
    name: title,
    template_id: templateId,
    recipients: [{ first_name: firstName, last_name: lastName || undefined, email, designation: 'Signer', order: 1, custom_fields: facts }],
    settings: { send_signing_email: body?.emailSigner !== false },
  });

  let signingRequestId = ok(r) ? r.data?.id : (r.status === 409 ? r.data?.signing_request_id : null);
  signingRequestId = signingRequestId ? String(signingRequestId) : null;
  if (signingRequestId) {
    // Sent (or a send that had started, which Firma keeps and charges).
    await settle('sent', signingRequestId);
    const link = httpsLink(r.data?.first_signer?.signing_link) || await signerLink(env, secrets.apiKey, signingRequestId);
    return { signingRequestId, signingLink: link, usage: await usage(env, auth.programId, now) };
  }
  if (r.status === 402) {
    await free();
    console.error('firma: out of credits');
    fail(503, 'esign_unavailable');
  }
  if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 409 && r.status !== 429) {
    await free();
    fail(400, 'esign_refused', { code: firmaCode(r) });
  }
  if (r.status === 429) {
    await free();
    fail(503, 'esign_busy');
  }
  // No answer, a server error, or a 409 without an id: it may have gone out.
  await settle('unknown');
  console.error('firma: send outcome unknown', r.status);
  fail(502, 'esign_unknown', { usage: await usage(env, auth.programId, now) });
}

// GET /integrations/esign/document?ref=<signing request id> → { url, expiresAt,
// partial, status }: Firma's short-lived link to the signed PDF (a partial copy
// while signers are still at it). Only for a request this program sent.
export async function esignDocument(env, auth, url) {
  await herSide(env, auth);
  const { secrets } = await mine(env, auth);
  const ref = text(url.searchParams.get('ref'));
  if (!UUIDISH.test(ref)) fail(400, 'bad_ref');
  const row = await env.DB.prepare('SELECT 1 AS x FROM esign_sends WHERE program_id = ? AND signing_request_id = ?').bind(auth.programId, ref).first();
  if (!row) fail(404, 'not_found');
  const r = await firma(env, secrets.apiKey, 'GET', `/signing-requests/${encodeURIComponent(ref)}/download`);
  if (r.status === 503) fail(503, 'esign_pending');
  const link = httpsLink(r.data?.download_url);
  if (!ok(r) || !link) fail(502, 'esign_unavailable');
  return { url: link, expiresAt: r.data.expires_at ?? null, partial: !!r.data.is_partial, status: String(r.data.status ?? '') };
}

// --- The webhook adapter --------------------------------------------------------------------

// X-Firma-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">,
// keyed with the workspace's signing secret as text. X-Firma-Signature-Old
// carries the previous secret's signature during a rotation; we keep one secret,
// so either header matching it is enough.
export async function verifyFirmaSignature(header, raw, secret, nowMs = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  const t = Number(parts.t);
  if (!/^\d{1,12}$/.test(parts.t ?? '') || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - t) > SIGNATURE_WINDOW_S) return false;
  const prefix = new TextEncoder().encode(`${parts.t}.`);
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix, 0);
  signed.set(raw, prefix.length);
  return timingSafeEqual(await hmacHexBytes(secret, signed), parts.v1);
}

const HOOK_KIND = {
  'signing_request.completed': ['contract.signed', 'completed', 'completed_at'],
  'signing_request.recipient.declined': ['contract.declined', 'declined', null],
  'signing_request.expired': ['contract.expired', 'expired', null],
  'signing_request.cancelled': ['contract.cancelled', 'cancelled', 'cancelled_at'],
};
const dayOf = (...vals) => vals.map((v) => (typeof v === 'string' ? v.slice(0, 10) : '')).find((v) => /^\d{4}-\d{2}-\d{2}$/.test(v));

export const firmaAdapter = {
  provider: 'firma',
  async verify(request, raw, connection, env) {
    const { webhookSecret } = await secretsOf(env, connection);
    for (const h of ['x-firma-signature', 'x-firma-signature-old']) {
      if (await verifyFirmaSignature(request.headers.get(h), raw, webhookSecret)) return true;
    }
    return false;
  },
  // Firma names only its own signing request; esign_sends turns it back into her
  // contract. The names and emails in Firma's payload are never read.
  async toEvents(payload, connection, env) {
    const spec = HOOK_KIND[payload?.type];
    const sr = payload?.data?.signing_request;
    if (!spec || !payload?.id || !sr?.id) return [];
    const row = await env.DB.prepare('SELECT id, contract_id FROM esign_sends WHERE signing_request_id = ? AND connection_id = ?')
      .bind(String(sr.id), connection.id).first();
    if (!row) return [];
    const [kind, status, field] = spec;
    await env.DB.prepare('UPDATE esign_sends SET status = ?, updated_at = ? WHERE id = ?').bind(status, new Date().toISOString(), row.id).run();
    const date = dayOf(field ? sr[field] : null, payload.created_at);
    return [{ providerEventId: String(payload.id), kind, recordType: 'contract', recordId: row.contract_id, data: date ? { date } : {} }];
  },
  // Disconnect / account deletion: stop the webhook. Firma has no API to delete a
  // workspace, so her templates and documents stay in it (plan §2.3a).
  async revoke(env, token) {
    let webhookId = null;
    try { webhookId = JSON.parse(token)?.webhookId ?? null; } catch { /* nothing to stop */ }
    if (webhookId && env.FIRMA_API_KEY) await firma(env, env.FIRMA_API_KEY, 'DELETE', `/webhooks/${encodeURIComponent(webhookId)}`);
  },
};

registerAdapter(firmaAdapter);
