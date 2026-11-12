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
//   GET  /integrations/esign/countersign?ref=  her own signing link (D32)
//   GET  /signed/<send id>/<mac>               the signed copy KennelOS keeps (D33), the
//                                              link emailed to the buyer
//   runEsignCopies (hourly cron)               copies signed PDFs to R2, emails the link
//   POST /hooks/firma/<secret>                 Firma's webhook (integrations.js)
//   POST /integrations/esign/preview           a draft of a send, read-only in Firma's editor
//   DELETE /integrations/esign/preview?id=     discard that draft
//   GET  /esign/editor (+ .js, .css)           Firma's template editor (or a draft, read-only), in its own tab
//
// The connection's sealed token (integrations.js) is JSON: her workspace's API key,
// its webhook signing secret and the webhook's id. Never sent to a device.
//
// What goes to Firma: her kennel's name (the workspace), her template PDFs, and per
// send the signer's name and email, hers when she countersigns (D32), and the contract's facts (the allow-list her
// device builds, shared/data/contractForms.js). What is kept here: ids, statuses
// and times (esign_sends), and her kennel's name on a send whose copy is kept.
// The signed PDFs she asked KennelOS to keep are in R2 (esign/<program>/<id>.pdf).
// Never logged: a key, a secret, a name, an email, a fact, a body.
import { herSide, registerAdapter, createConnection, openToken, sealToken } from './integrations.js';
import { hmacHex, hmacHexBytes, timingSafeEqual } from './lib/crypto.js';
import { fail } from './lib/http.js';
import { sendSignedCopyMail } from './mail.js';

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
const TEMPLATE_PAGE = 100;

export async function listFirmaTemplates(env, auth) {
  await herSide(env, auth);
  const { secrets } = await mine(env, auth);
  const r = await firma(env, secrets.apiKey, 'GET', `/templates?page_size=${TEMPLATE_PAGE}&sort_by=name&sort_order=asc`);
  if (!ok(r)) fail(502, 'esign_unavailable');
  const results = Array.isArray(r.data?.results) ? r.data.results : [];
  return {
    templates: results.filter((t) => t?.id).map((t) => ({
      id: String(t.id), name: String(t.name ?? ''), pageCount: Number(t.page_count) || null,
    })),
    // Every template she has, not just a first page: her device may then forget
    // the ones that are gone (deleted in Firma's editor).
    complete: results.length < TEMPLATE_PAGE,
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

// A request's recipients, as Firma lists them, or null when Firma didn't answer.
async function requestUsers(env, key, signingRequestId) {
  const r = await firma(env, key, 'GET', `/signing-requests/${encodeURIComponent(signingRequestId)}/users`);
  if (!ok(r)) return null;
  return Array.isArray(r.data) ? r.data : (r.data?.results ?? []);
}

const linkOf = (u) => httpsLink(u?.signing_link) || (u?.id ? `https://app.firma.dev/signing/${encodeURIComponent(u.id)}` : null);
const signersOf = (users) => (users || []).filter((u) => u?.designation === 'Signer');

// The buyer's own link when Firma didn't hand it back (a send that had started
// before an error): the first Signer of the request.
async function signerLink(env, key, signingRequestId) {
  const users = await requestUsers(env, key, signingRequestId);
  return linkOf(signersOf(users).find((u) => Number(u.order) === 1) || signersOf(users)[0] || users?.[0]);
}

// Her workspace's custom fields, as Firma lists them, or null when it didn't answer.
async function customFieldRows(env, key, accountRef) {
  const list = await firma(env, key, 'GET', `/workspace/${encodeURIComponent(accountRef)}/custom-fields`);
  if (!ok(list)) return null;
  return Array.isArray(list.data) ? list.data : (list.data?.results ?? list.data?.custom_fields ?? []);
}

// A field placed in Firma's editor with its Prefilled Data set to one of her
// custom fields is filled from the recipient's custom_fields key it names, case
// aside (format_rules.prefilledData). The editor may name the field by an id of
// Firma's rather than its field_name, so each fact also goes under every
// identifier its custom field carries. Pure. → { <key>: <text> }
export const WORKSPACE_FIELD_PREFIX = 'custom_workspace_';
export const FIELD_ALIASES = ['id', 'key', 'name', 'slug', 'variable_name', 'variable_defined_name'];
const ALIAS = /^[A-Za-z0-9_.:-]{1,100}$/;
export function withFieldAliases(facts, rows) {
  const out = { ...facts };
  const byName = new Map(Object.keys(facts).map((k) => [k.toLowerCase(), k]));
  const taken = new Set(Object.keys(out).map((k) => k.toLowerCase()));
  for (const row of Array.isArray(rows) ? rows : []) {
    const fact = byName.get(String(row?.field_name ?? '').toLowerCase());
    if (!fact) continue;
    // The editor names a workspace custom field `custom_workspace_<its id>` (seen
    // on the first production sends), so that form goes too.
    const ids = FIELD_ALIASES.map((prop) => (row[prop] == null ? '' : String(row[prop])));
    if (row.id != null) ids.push(`${WORKSPACE_FIELD_PREFIX}${row.id}`);
    for (const alias of ids) {
      if (!ALIAS.test(alias) || taken.has(alias.toLowerCase())) continue;
      out[alias] = facts[fact];
      taken.add(alias.toLowerCase());
    }
  }
  return out;
}

// The keys of prefilled fields Firma left empty on a request it made (only the
// keys: never a value), for the log. → [key]
export function emptyPrefills(data) {
  const fields = Array.isArray(data?.fields) ? data.fields : (Array.isArray(data?.signing_request?.fields) ? data.signing_request.fields : []);
  return fields.map((f) => f?.format_rules?.prefilledData)
    .filter((k, i) => typeof k === 'string' && ALIAS.test(k) && !text(String(fields[i]?.value ?? '')))
    .slice(0, 40);
}

// POST /integrations/esign/send
//   { contractId, templateId, title, signer: { firstName, lastName, email },
//     countersigner: { name, email } | absent,
//     facts: { <fact>: <text> }, emailSigner = true, resend = false,
//     keepCopy = false, kennelName }
// → { signingRequestId, signingLink, countersign, usage }
//
// With a countersigner (D32) she is the request's second Signer, after the buyer:
// one request, so one credit. Her email comes from her device (her account's
// email; the Worker keeps only its hash). Firma's completed webhook comes once
// every signer has finished, so Signed means both have signed.
//
// With keepCopy (D33) the signed PDF is kept and the buyer emailed a link to it
// once it's signed (runEsignCopies). kennelName is for that email's wording.
//
// A row is reserved in esign_sends BEFORE Firma is called, and only while the
// month's count is under her limit, so two sends at once can't pass it. A send
// Firma refused frees its row; one whose outcome is unknown keeps it (its credit
// may be spent) and says so.
// The send's body, checked (sendForSignature and the preview share it).
function parseSend(body) {
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
  const keepCopy = body?.keepCopy === true;
  const kennelName = keepCopy ? (text(body?.kennelName).replace(/\s+/g, ' ').slice(0, 100) || null) : null;
  let countersigner = null;
  if (body?.countersigner != null) {
    const name = text(body.countersigner?.name).replace(/\s+/g, ' ').slice(0, 100);
    const herEmail = text(body.countersigner?.email).toLowerCase();
    if (!name) fail(400, 'countersigner_name_required');
    if (!EMAIL.test(herEmail)) fail(400, 'countersigner_email_required');
    if (herEmail === email) fail(400, 'countersigner_is_signer');
    countersigner = { first_name: name, email: herEmail, designation: 'Signer', order: 2 };
  }

  return { contractId, templateId, firstName, lastName, email, facts, title, keepCopy, kennelName, countersigner };
}

// A template gone from her workspace (deleted in Firma's editor) → 404 template_missing.
async function templateThere(env, key, templateId) {
  const tpl = await firma(env, key, 'GET', `/templates/${encodeURIComponent(templateId)}`);
  if (tpl.status === 404) fail(404, 'template_missing');
}

// Firma's body for one request: the buyer, and her as the second signer when she
// countersigns, each with every fact under each name the template may use.
async function requestBody(env, key, workspaceId, { templateId, title, firstName, lastName, email, facts, countersigner }, emailSigner) {
  const rows = Object.keys(facts).length ? await customFieldRows(env, key, workspaceId) : null;
  const values = withFieldAliases(facts, rows);
  return {
    values,
    payload: {
      name: title,
      template_id: templateId,
      recipients: [
        { first_name: firstName, last_name: lastName || undefined, email, designation: 'Signer', order: 1, custom_fields: values },
        ...(countersigner ? [{ ...countersigner, custom_fields: values }] : []),
      ],
      settings: { send_signing_email: emailSigner },
    },
  };
}

export async function sendForSignature(env, auth, body, now = new Date()) {
  await herSide(env, auth);
  const { connection, secrets } = await mine(env, auth);
  const { contractId, templateId, firstName, lastName, email, facts, title, keepCopy, kennelName, countersigner } = parseSend(body);

  // A template deleted in Firma's editor (her device may still offer it): refused
  // here, before a place in the month's count is taken. Only a clear "not there"
  // stops the send; any other answer leaves it to Firma.
  await templateThere(env, secrets.apiKey, templateId);

  const live = await env.DB.prepare(
    "SELECT signing_request_id, status FROM esign_sends WHERE program_id = ? AND contract_id = ? AND status IN ('sending', 'sent', 'unknown') ORDER BY sent_at DESC LIMIT 1",
  ).bind(auth.programId, contractId).first();
  if (live && body?.resend !== true) fail(409, 'already_sent', { signingRequestId: live.signing_request_id ?? null, status: live.status });

  // A template deleted in Firma's editor (her device may still offer it): refused
  // here, before a place in the month's count is taken. Only a clear "not there"
  // stops the send; any other answer leaves it to Firma.
  const tpl = await firma(env, secrets.apiKey, 'GET', `/templates/${encodeURIComponent(templateId)}`);
  if (tpl.status === 404) fail(404, 'template_missing');

  const { limit } = await monthlyLimitFor(env, auth.programId);
  const { start } = monthBounds(now);
  const rowId = crypto.randomUUID();
  const at = now.toISOString();
  const reserved = await env.DB.prepare(
    `INSERT INTO esign_sends (id, program_id, connection_id, contract_id, template_id, signing_request_id, status, sent_at, updated_at, keep_copy, kennel_name)
     SELECT ?, ?, ?, ?, ?, NULL, 'sending', ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM esign_sends WHERE program_id = ? AND sent_at >= ?) < ?`,
  ).bind(rowId, auth.programId, connection.id, contractId, templateId, at, at, keepCopy ? 1 : 0, kennelName, auth.programId, start, limit).run();
  if (!reserved.meta?.changes) fail(409, 'esign_limit_reached', { usage: await usage(env, auth.programId, now) });

  const settle = (status, signingRequestId = null) => env.DB.prepare(
    'UPDATE esign_sends SET status = ?, signing_request_id = COALESCE(?, signing_request_id), updated_at = ? WHERE id = ?',
  ).bind(status, signingRequestId, new Date().toISOString(), rowId).run();
  const free = () => env.DB.prepare('DELETE FROM esign_sends WHERE id = ?').bind(rowId).run();

  // The facts under each name the template may use, for both signers: a field
  // she placed for herself fills too, and a required one never blocks the send.
  const { values, payload } = await requestBody(env, secrets.apiKey, connection.account_ref,
    { templateId, title, firstName, lastName, email, facts, countersigner }, body?.emailSigner !== false);
  const r = await firma(env, secrets.apiKey, 'POST', '/signing-requests/create-and-send', payload);

  let signingRequestId = ok(r) ? r.data?.id : (r.status === 409 ? r.data?.signing_request_id : null);
  signingRequestId = signingRequestId ? String(signingRequestId) : null;
  if (signingRequestId) {
    // Sent (or a send that had started, which Firma keeps and charges).
    await settle('sent', signingRequestId);
    const missed = ok(r) ? emptyPrefills(r.data) : [];
    // Keys only, never values. "not sent" = no fact under that key (a name we don't
    // know yet); "sent" = KennelOS sent it but Firma still left it empty.
    const sentKeys = new Set(Object.keys(values).map((k) => k.toLowerCase()));
    if (missed.length) console.warn('firma: prefilled fields left empty', missed.map((k) => `${k} (${sentKeys.has(k.toLowerCase()) ? 'sent' : 'not sent'})`).join(','));
    const link = httpsLink(r.data?.first_signer?.signing_link) || await signerLink(env, secrets.apiKey, signingRequestId);
    return { signingRequestId, signingLink: link, countersign: !!countersigner, keepCopy, usage: await usage(env, auth.programId, now) };
  }
  if (r.status === 404) {
    await free();
    fail(404, 'template_missing');
  }
  if (r.status === 402) {
    await free();
    console.error('firma: out of credits');
    fail(503, 'esign_unavailable');
  }
  if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 409 && r.status !== 429) {
    await free();
    console.warn('firma: send refused', r.status, firmaCode(r) ?? '');
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

// POST /integrations/esign/preview: the same body as a send → { previewId, token,
// expiresAt }. A DRAFT signing request (POST /signing-requests never sends, and
// Firma charges a credit only at send), so it's free and never counts toward her
// month. Its token opens Firma's signing request editor read-only on the editor
// page (#t=…&sr=…), showing her real template with this contract's values filled.
// Nothing is kept here: her device discards the draft when its Send dialog closes
// (DELETE below).
export async function previewSigningRequest(env, auth, body) {
  await herSide(env, auth);
  const { connection, secrets } = await mine(env, auth);
  const parsed = parseSend(body);
  await templateThere(env, secrets.apiKey, parsed.templateId);
  const { payload } = await requestBody(env, secrets.apiKey, connection.account_ref, parsed, false);
  const r = await firma(env, secrets.apiKey, 'POST', '/signing-requests', payload);
  const id = ok(r) && r.data?.id ? String(r.data.id) : null;
  if (!id) {
    if (r.status === 404) fail(404, 'template_missing');
    if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) fail(400, 'esign_refused', { code: firmaCode(r) });
    fail(502, 'esign_unavailable');
  }
  const t = await firma(env, secrets.apiKey, 'POST', '/jwt/generate-signing-request', { companies_workspaces_signing_requests_id: id });
  if (!ok(t) || typeof t.data?.jwt !== 'string') {
    await discardDraft(env, secrets.apiKey, id);
    fail(502, 'esign_unavailable');
  }
  return { previewId: id, token: t.data.jwt, expiresAt: t.data.expires_at ?? null };
}

// Only a draft in her own workspace is ever deleted: a sent request (charged, a
// buyer's link) never is. → true when it's gone.
async function discardDraft(env, key, id) {
  const sr = await firma(env, key, 'GET', `/signing-requests/${encodeURIComponent(id)}`);
  if (sr.status === 404) return true;
  if (!ok(sr) || String(sr.data?.status ?? '').toLowerCase() !== 'draft') return false;
  const d = await firma(env, key, 'DELETE', `/signing-requests/${encodeURIComponent(id)}`);
  return ok(d) || d.status === 404;
}

// DELETE /integrations/esign/preview?id=<signing request id> → { discarded }.
export async function discardPreview(env, auth, url) {
  await herSide(env, auth);
  const { secrets } = await mine(env, auth);
  const id = text(url.searchParams.get('id'));
  if (!UUIDISH.test(id)) fail(400, 'bad_ref');
  return { discarded: await discardDraft(env, secrets.apiKey, id) };
}

// GET /integrations/esign/document?ref=<signing request id> → { url, expiresAt,
// partial, status, kept, emailedAt }: the copy KennelOS keeps when there is one
// (D33: the same link the buyer was emailed, kept: true), else Firma's
// short-lived link to the signed PDF (a partial copy while signers are still at
// it). Only for a request this program sent.
export async function esignDocument(env, auth, url) {
  await herSide(env, auth);
  const { secrets } = await mine(env, auth);
  const ref = text(url.searchParams.get('ref'));
  if (!UUIDISH.test(ref)) fail(400, 'bad_ref');
  const row = await env.DB.prepare('SELECT id, copy_key, copy_status, emailed_at FROM esign_sends WHERE program_id = ? AND signing_request_id = ?').bind(auth.programId, ref).first();
  if (!row) fail(404, 'not_found');
  if (row.copy_key) {
    return { url: await signedCopyLink(env, url.origin, row.id), expiresAt: null, partial: false, status: 'completed', kept: true, emailedAt: row.emailed_at ?? null };
  }
  const r = await firma(env, secrets.apiKey, 'GET', `/signing-requests/${encodeURIComponent(ref)}/download`);
  if (r.status === 503) fail(503, 'esign_pending');
  const link = httpsLink(r.data?.download_url);
  if (!ok(r) || !link) fail(502, 'esign_unavailable');
  return { url: link, expiresAt: r.data.expires_at ?? null, partial: !!r.data.is_partial, status: String(r.data.status ?? ''), kept: false, emailedAt: null };
}

// --- Signed copies KennelOS keeps (D33) -----------------------------------------------------

export const COPY_MAX_BYTES = 25_000_000;
export const COPY_MAX_TRIES = 48; // hourly: two days, then 'failed'
const COPIES_PER_RUN = 10; // each is a few outbound calls; a Worker's are capped
const copyKey = (programId, rowId) => `esign/${programId}/${rowId}.pdf`;
const SEND_ID = /^[0-9a-f-]{36}$/;

// The link's secret part: an HMAC of the send's id, so nothing more is stored
// and her device can be given the same link. INT_TOKEN_KEY also seals her keys.
async function copyMac(env, rowId) {
  if (!env.INT_TOKEN_KEY) fail(503, 'integrations_not_configured');
  return (await hmacHex(env.INT_TOKEN_KEY, `esign-copy:${rowId}`)).slice(0, 32);
}

export async function signedCopyLink(env, origin, rowId) {
  return `${String(origin || '').replace(/\/+$/, '')}/signed/${rowId}/${await copyMac(env, rowId)}`;
}

// The buyer: the request's first Signer, as Firma lists it. Read when the email
// goes, never kept.
async function buyerEmail(env, key, signingRequestId) {
  const users = await requestUsers(env, key, signingRequestId);
  if (!users) return { ok: false, email: null };
  const signers = signersOf(users);
  const buyer = signers.find((u) => Number(u.order) === 1) || signers[0];
  const email = text(buyer?.email).toLowerCase();
  return { ok: true, email: EMAIL.test(email) ? email : null };
}

async function fetchPdf(link) {
  let res;
  try { res = await fetch(link); } catch { return null; }
  if (!res.ok) return null;
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > COPY_MAX_BYTES) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length || bytes.length > COPY_MAX_BYTES) return null;
  return bytes;
}

// The hourly cron: every completed send she asked to keep is copied to R2, then
// its buyer emailed the link. A step that fails is tried again next hour, up to
// COPY_MAX_TRIES. → counts only.
export async function runEsignCopies(env, { now = new Date(), origin = env.FAMILY_PAGES_ORIGIN || '' } = {}) {
  const out = { kept: 0, emailed: 0, noEmail: 0, failed: 0, waiting: 0 };
  if (!env.FILES || !env.INT_TOKEN_KEY || !origin) return out;
  const { results } = await env.DB.prepare(
    `SELECT id, program_id, connection_id, signing_request_id, kennel_name, copy_status, copy_key, copy_tries
       FROM esign_sends WHERE copy_status IN ('pending', 'kept') ORDER BY updated_at LIMIT ?`,
  ).bind(COPIES_PER_RUN).all();
  for (const row of results) {
    const at = now.toISOString();
    const tried = async (status) => {
      const tries = row.copy_tries + 1;
      const next = tries >= COPY_MAX_TRIES ? (row.copy_key ? 'unsent' : 'failed') : status;
      await env.DB.prepare('UPDATE esign_sends SET copy_tries = ?, copy_status = ?, updated_at = ? WHERE id = ?').bind(tries, next, at, row.id).run();
      if (next === 'failed' || next === 'unsent') out.failed++; else out.waiting++;
    };
    const connection = await env.DB.prepare('SELECT * FROM int_connections WHERE id = ?').bind(row.connection_id).first();
    const { apiKey } = connection ? await secretsOf(env, connection) : {};
    if (!apiKey) { await tried(row.copy_status); continue; }

    if (!row.copy_key) {
      const d = await firma(env, apiKey, 'GET', `/signing-requests/${encodeURIComponent(row.signing_request_id)}/download`);
      const link = ok(d) && !d.data?.is_partial ? httpsLink(d.data?.download_url) : null;
      const bytes = link ? await fetchPdf(link) : null;
      if (!bytes) { await tried('pending'); continue; }
      const key = copyKey(row.program_id, row.id);
      await env.FILES.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
      await env.DB.prepare("UPDATE esign_sends SET copy_key = ?, copy_bytes = ?, copied_at = ?, copy_status = 'kept', copy_tries = 0, updated_at = ? WHERE id = ?")
        .bind(key, bytes.length, at, at, row.id).run();
      row.copy_key = key;
      row.copy_tries = 0;
      out.kept++;
    }

    const buyer = await buyerEmail(env, apiKey, row.signing_request_id);
    if (!buyer.ok) { await tried('kept'); continue; }
    if (!buyer.email) {
      await env.DB.prepare("UPDATE esign_sends SET copy_status = 'no_email', updated_at = ? WHERE id = ?").bind(at, row.id).run();
      out.noEmail++;
      continue;
    }
    const sent = await sendSignedCopyMail(env, { to: buyer.email, kennelName: row.kennel_name, link: await signedCopyLink(env, origin, row.id) });
    if (sent !== 'sent') { await tried('kept'); continue; }
    await env.DB.prepare("UPDATE esign_sends SET copy_status = 'emailed', emailed_at = ?, updated_at = ? WHERE id = ?").bind(at, at, row.id).run();
    out.emailed++;
  }
  return out;
}

// GET /signed/<send id>/<mac>: the kept PDF, for whoever has the link (the
// buyer's email, her Signed copy). A wrong mac is a 404, the same as no copy.
export async function serveSignedCopy(request, env, url) {
  const m = /^\/signed\/([^/]+)\/([0-9a-f]{32})$/.exec(url.pathname);
  if (!m) return null;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  if (!SEND_ID.test(m[1]) || !env.FILES || !env.INT_TOKEN_KEY || !env.DB) return notFound();
  if (!timingSafeEqual(await copyMac(env, m[1]), m[2])) return notFound();
  const row = await env.DB.prepare('SELECT copy_key FROM esign_sends WHERE id = ?').bind(m[1]).first();
  if (!row?.copy_key) return notFound();
  const obj = await env.FILES.get(row.copy_key);
  if (!obj) return notFound();
  return new Response(request.method === 'HEAD' ? null : obj.body, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'inline; filename="Signed contract.pdf"',
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
    },
  });
}

// Account deletion: her kept copies go with her rows.
export const esignCopyPrefix = (programId) => `esign/${programId}/`;

// GET /integrations/esign/countersign?ref=<signing request id> → { url }: her own
// signing link on a request she countersigns (D32), the second Signer. Asked for
// when she taps Countersign, never kept. Only for a request this program sent.
export async function esignCountersignLink(env, auth, url) {
  await herSide(env, auth);
  const { secrets } = await mine(env, auth);
  const ref = text(url.searchParams.get('ref'));
  if (!UUIDISH.test(ref)) fail(400, 'bad_ref');
  const row = await env.DB.prepare('SELECT status FROM esign_sends WHERE program_id = ? AND signing_request_id = ?').bind(auth.programId, ref).first();
  if (!row) fail(404, 'not_found');
  if (row.status !== 'sent') fail(409, 'esign_not_open', { status: row.status });
  const users = await requestUsers(env, secrets.apiKey, ref);
  if (!users) fail(502, 'esign_unavailable');
  const signers = signersOf(users);
  const hers = signers.find((u) => Number(u.order) === 2) || (signers.length > 1 ? signers.at(-1) : null);
  const link = linkOf(hers);
  if (!link) fail(409, 'no_countersigner');
  return { url: link };
}

// --- The template editor page (D31) ---------------------------------------------------------

// Firma's editor is a script from api.firma.dev that runs in the page that loads
// it. It gets a page of its own, opened in a new tab by her device with the token
// in the fragment, and served sandboxed: an opaque origin, so Firma's code never
// reaches this Worker's cookies (/ops, /manager) or storage, nor her app's data.
// No script-src list: Firma's bundle loads what it needs (fonts, its own API).
const EDITOR_FILES = {
  '/esign/editor': ['/esign/editor.html', 'no-store'],
  '/esign/editor.js': ['/esign/editor.js', 'public, max-age=300'],
  '/esign/editor.css': ['/esign/editor.css', 'public, max-age=300'],
};
export const EDITOR_CSP = "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";

export async function serveEsignEditor(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const file = EDITOR_FILES[url.pathname];
  if (!file || !env.ASSETS) return null;
  const res = await env.ASSETS.fetch(new Request(new URL(file[0], request.url), { method: 'GET' }));
  if (!res.ok) return null;
  const headers = new Headers(res.headers);
  headers.set('cache-control', file[1]);
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-robots-tag', 'noindex, nofollow');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', EDITOR_CSP);
  return new Response(res.body, { status: 200, headers });
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
    const row = await env.DB.prepare('SELECT id, contract_id, keep_copy, copy_status FROM esign_sends WHERE signing_request_id = ? AND connection_id = ?')
      .bind(String(sr.id), connection.id).first();
    if (!row) return [];
    const [kind, status, field] = spec;
    // A copy she asked to keep is queued for the hourly cron (runEsignCopies).
    const queue = status === 'completed' && row.keep_copy && !row.copy_status;
    await env.DB.prepare('UPDATE esign_sends SET status = ?, copy_status = COALESCE(?, copy_status), updated_at = ? WHERE id = ?')
      .bind(status, queue ? 'pending' : null, new Date().toISOString(), row.id).run();
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
