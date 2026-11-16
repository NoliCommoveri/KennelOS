// The template library (docs/KennelOS_Integrations_Plan.md §2.3b): contract templates
// KennelOS support builds once and offers to breeders, who add a copy to their own
// Firma workspace without support being in their program (no assisted session).
//
// The library is the Firma workspace of one KennelOS account support links in the
// manager app (its own test account): templates are uploaded and their fields placed
// there with the app's own Contract templates and Place fields. Support then names,
// per template, who may add it: every breeder, or breeders it has named.
//
// Adding one: Firma's POST /templates/{id}/copy (the company key) deep-copies the
// template, its PDF, fields and signer roles into her workspace. Each prefilled field
// still names the LIBRARY workspace's custom field (`custom_workspace_<id>`), which
// means nothing in hers. Every KennelOS workspace has the same custom fields by
// field_name (Set up e-signing makes them from one fact list); only the ids differ.
// So the field_name is the bridge: each prefill is pointed at her field of the same
// name (prefillRemap), one PATCH per field, over as many calls as it takes.
//
//   manager app (/manager/api/library/*, the ops cookie; assist.js routes here):
//     GET  library            the link, the library's templates with who may add each, the named breeders
//     POST library/link       { email, label } the account whose workspace is the library
//     POST library/unlink
//     POST library/breeder    { email, label } name a breeder; { programId, remove: true }
//     POST library/offer      { templateId, name, description, signs, to: 'none'|'all'|'chosen', programIds }
//   her device (Pro, her bearer):
//     GET  /integrations/firma/library       the templates she may add
//     POST /integrations/firma/library/add   { templateId } copy it to her workspace and
//                                            point its prefills at her fields; repeat
//                                            while `ready` is false
//
// Kept: program ids, the names support types (never an email), template ids and
// statuses. Never logged: a key, a name, an email, a template's name.
import { emailHash, normalizeEmail } from './auth.js';
import { herSide } from './integrations.js';
import { fail } from './lib/http.js';
import {
  FIELD_ALIASES, WORKSPACE_FIELD_PREFIX, connectionOf, failFirma, fieldsOf, firma, firmaCode,
  masterKey, mine, ok, secretsOf, workspaceFields,
} from './firma.js';

export const LIBRARY_PROGRAM_KEY = 'esign_library_program';
export const LIBRARY_LABEL_KEY = 'esign_library_label';
const CALL_BUDGET = 45; // outbound calls per request, under the Worker's 50
const TEMPLATE_PAGE = 100;
const UUIDISH = /^[A-Za-z0-9_-]{1,64}$/;
const SIGNS = ['none', 'first', 'last'];
const ALIAS = /^[A-Za-z0-9_.:-]{1,100}$/;
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const one = (v, max) => text(v).replace(/\s+/g, ' ').slice(0, max);
const iso = (now = new Date()) => now.toISOString();

// Firma's own recipient keys (format_rules.prefilledData): fill from the recipient,
// the same in every workspace. Never re-pointed.
const RECIPIENT_KEYS = new Set(['first_name', 'last_name', 'full_name', 'email', 'phone_number', 'company', 'title',
  'street_address', 'city', 'state_province', 'postal_code', 'country']);

// --- Re-pointing a copy's prefills (pure) ---------------------------------------------------

// Every way a prefill may name a workspace custom field: the editor's
// `custom_workspace_<id>` (seen on production sends), the id itself, and Firma's other
// identifiers (FIELD_ALIASES). → [[form, value]]
function identifiers(row) {
  const out = [];
  if (row?.id != null) out.push(['prefix', `${WORKSPACE_FIELD_PREFIX}${row.id}`], ['id', String(row.id)]);
  for (const prop of FIELD_ALIASES) if (prop !== 'id' && row?.[prop] != null && String(row[prop])) out.push([prop, String(row[prop])]);
  return out.filter(([, v]) => ALIAS.test(v));
}

// The same identifier form on her field, else the editor's.
function herIdentifier(row, form) {
  const found = identifiers(row).find(([f]) => f === form);
  return found ? found[1] : `${WORKSPACE_FIELD_PREFIX}${row.id}`;
}

// A copied template's fields, each prefill re-pointed at her workspace's field of the
// same field_name. Her first field of a name is the one kept (syncFirmaFields drops
// later copies), so a prefill naming a later copy is re-pointed too.
//   fields   the copy's fields (GET /templates/{id}/fields)
//   libRows  the library workspace's custom fields;  herRows: hers
// → { changes: [{ id, format_rules, variable_name? }],  PATCH each as `field`
//     missing: [{ field_name, field_label }],           make these in hers, then run again
//     unmapped: n }                                     prefills naming no field either side knows
export function prefillRemap(fields, libRows, herRows) {
  const nameOf = new Map(); // any identifier, either workspace → { name, form }
  const herByName = new Map();
  const libByName = new Map();
  for (const row of Array.isArray(herRows) ? herRows : []) {
    const name = String(row?.field_name ?? '').toLowerCase();
    if (!name || row.id == null) continue;
    if (!herByName.has(name)) herByName.set(name, row);
    for (const [form, v] of identifiers(row)) if (!nameOf.has(v.toLowerCase())) nameOf.set(v.toLowerCase(), { name, form });
  }
  for (const row of Array.isArray(libRows) ? libRows : []) {
    const name = String(row?.field_name ?? '').toLowerCase();
    if (!name || row.id == null) continue;
    if (!libByName.has(name)) libByName.set(name, row);
    for (const [form, v] of identifiers(row)) if (!nameOf.has(v.toLowerCase())) nameOf.set(v.toLowerCase(), { name, form });
  }
  const changes = [];
  const missing = new Map();
  let unmapped = 0;
  for (const f of Array.isArray(fields) ? fields : []) {
    const rules = f?.format_rules && typeof f.format_rules === 'object' && !Array.isArray(f.format_rules) ? f.format_rules : null;
    const key = typeof rules?.prefilledData === 'string' ? rules.prefilledData.trim() : '';
    if (!key || f.id == null) continue;
    const lk = key.toLowerCase();
    if (RECIPIENT_KEYS.has(lk)) continue;
    const hit = nameOf.get(lk);
    if (!hit) {
      // A plain fact name fills in any workspace (every send carries each fact under it).
      if (!herByName.has(lk) && !libByName.has(lk)) unmapped++;
      continue;
    }
    const her = herByName.get(hit.name);
    if (!her) {
      const lib = libByName.get(hit.name);
      missing.set(hit.name, { field_name: String(lib?.field_name ?? hit.name), field_label: one(lib?.field_label, 100) || String(lib?.field_name ?? hit.name) });
      continue;
    }
    const target = herIdentifier(her, hit.form);
    if (target.toLowerCase() === lk) continue; // already hers
    const change = { id: f.id, format_rules: { ...rules, prefilledData: target } };
    const vn = typeof f.variable_name === 'string' ? f.variable_name.trim().toLowerCase() : '';
    const vHit = vn && vn !== target.toLowerCase() ? nameOf.get(vn) : null;
    if (vHit && vHit.name === hit.name) change.variable_name = herIdentifier(her, vHit.form);
    changes.push(change);
  }
  return { changes, missing: [...missing.values()], unmapped };
}

// --- The library ---------------------------------------------------------------------------

const config = (env, key) => env.DB.prepare('SELECT value FROM ops_config WHERE key = ?').bind(key).first('value');
async function setConfig(env, key, value, now) {
  await env.DB.prepare('INSERT INTO ops_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, value, iso(now)).run();
}

// The linked account's program, its Firma connection and workspace key.
// → { programId, label, connection, apiKey } | null (nothing linked)
export async function libraryOf(env) {
  const programId = await config(env, LIBRARY_PROGRAM_KEY);
  if (!programId) return null;
  const connection = await connectionOf(env, programId);
  const apiKey = connection ? (await secretsOf(env, connection)).apiKey || null : null;
  return { programId, label: (await config(env, LIBRARY_LABEL_KEY)) || '', connection, apiKey };
}

async function programByEmail(env, raw) {
  const email = normalizeEmail(raw);
  if (!email) fail(400, 'bad_email');
  const programId = await env.DB.prepare('SELECT p.id FROM users u JOIN programs p ON p.owner_user_id = u.id WHERE u.email_hash = ?')
    .bind(await emailHash(env, email)).first('id');
  if (!programId) fail(404, 'no_account');
  return programId;
}

// The library's templates as Firma lists them (its own key). → [{ id, name, pageCount }] | null
async function libraryTemplates(env, lib) {
  if (!lib?.apiKey) return null;
  const r = await firma(env, lib.apiKey, 'GET', `/templates?page_size=${TEMPLATE_PAGE}&sort_by=name&sort_order=asc`);
  if (!ok(r)) { console.warn('firma: library templates not read', r.status); return null; }
  const results = Array.isArray(r.data?.results) ? r.data.results : [];
  return results.filter((t) => t?.id).map((t) => ({ id: String(t.id), name: String(t.name ?? ''), pageCount: Number(t.page_count) || null }));
}

// Statements that forget the library's offers (another account linked, or the linked
// one deleted): its templates were that workspace's.
const forgetOffers = (env) => [env.DB.prepare('DELETE FROM esign_library_access'), env.DB.prepare('DELETE FROM esign_library_templates')];

// For account deletion (program.js): her breeder entry, her access and her copies'
// rows; and when hers was the library, the link and its offers. → [statement]
export function deleteLibraryStatements(env, programId) {
  const isLibrary = `EXISTS (SELECT 1 FROM ops_config WHERE key = '${LIBRARY_PROGRAM_KEY}' AND value = ?)`;
  return [
    env.DB.prepare('DELETE FROM esign_library_access WHERE program_id = ?').bind(programId),
    env.DB.prepare('DELETE FROM esign_library_breeders WHERE program_id = ?').bind(programId),
    env.DB.prepare('DELETE FROM esign_library_copies WHERE program_id = ?').bind(programId),
    env.DB.prepare(`DELETE FROM esign_library_access WHERE ${isLibrary}`).bind(programId),
    env.DB.prepare(`DELETE FROM esign_library_templates WHERE ${isLibrary}`).bind(programId),
    env.DB.prepare(`DELETE FROM ops_config WHERE key = '${LIBRARY_LABEL_KEY}' AND ${isLibrary}`).bind(programId),
    env.DB.prepare(`DELETE FROM ops_config WHERE key = '${LIBRARY_PROGRAM_KEY}' AND value = ?`).bind(programId),
  ];
}

// --- The manager app -----------------------------------------------------------------------

// GET library → { linked, templates, breeders }
async function libraryView(env) {
  const lib = await libraryOf(env);
  const { results: offers } = await env.DB.prepare('SELECT * FROM esign_library_templates').all();
  const { results: access } = await env.DB.prepare('SELECT template_id, program_id FROM esign_library_access').all();
  const { results: breeders } = await env.DB.prepare(
    `SELECT b.program_id, b.label, b.created_at,
            EXISTS (SELECT 1 FROM int_connections c WHERE c.program_id = b.program_id AND c.provider = 'firma') AS esign
       FROM esign_library_breeders b ORDER BY b.label COLLATE NOCASE`,
  ).all();
  const { results: copies } = await env.DB.prepare("SELECT library_template_id AS id, COUNT(*) AS n FROM esign_library_copies WHERE status = 'ready' GROUP BY library_template_id").all();
  const copiesOf = new Map(copies.map((c) => [c.id, Number(c.n)]));
  const offerOf = new Map(offers.map((o) => [o.template_id, o]));
  const listed = await libraryTemplates(env, lib);
  const shape = (id, firmaName, pageCount, gone) => {
    const o = offerOf.get(id);
    return {
      id, firmaName, pageCount, gone,
      name: o?.name ?? firmaName, description: o?.description ?? '', signs: o?.signs ?? 'none',
      to: !o ? 'none' : (o.all_breeders ? 'all' : 'chosen'),
      programIds: access.filter((a) => a.template_id === id).map((a) => a.program_id),
      copies: copiesOf.get(id) ?? 0,
    };
  };
  const templates = (listed || []).map((t) => shape(t.id, t.name, t.pageCount, false));
  // Offered, but no longer in the library (deleted in Firma's editor): shown so it can be withdrawn.
  if (listed) for (const o of offers) if (!listed.some((t) => t.id === o.template_id)) templates.push(shape(o.template_id, o.name, null, true));
  return {
    linked: lib ? { programId: lib.programId, label: lib.label, connected: !!lib.apiKey } : null,
    templatesRead: listed !== null,
    templates,
    breeders: breeders.map((b) => ({ programId: b.program_id, label: b.label, esign: !!b.esign })),
  };
}

// POST library/link { email, label }: that account's workspace is the library. It must
// have e-signing set up (its workspace exists). Another account than before: the old
// library's offers go (their templates were in that workspace); copies stay.
async function linkLibrary(env, body, now) {
  const programId = await programByEmail(env, body.email);
  const label = one(body.label, 60) || 'Template library';
  if (!(await connectionOf(env, programId))) fail(409, 'library_not_set_up');
  const before = await config(env, LIBRARY_PROGRAM_KEY);
  if (before && before !== programId) await env.DB.batch(forgetOffers(env));
  await setConfig(env, LIBRARY_PROGRAM_KEY, programId, now);
  await setConfig(env, LIBRARY_LABEL_KEY, label, now);
  return libraryView(env);
}

async function unlinkLibrary(env) {
  await env.DB.batch([
    ...forgetOffers(env),
    env.DB.prepare('DELETE FROM ops_config WHERE key IN (?, ?)').bind(LIBRARY_PROGRAM_KEY, LIBRARY_LABEL_KEY),
  ]);
  return libraryView(env);
}

// POST library/breeder { email, label } | { programId, remove: true }
async function setBreeder(env, body, now) {
  if (body.remove === true) {
    const programId = text(body.programId);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM esign_library_access WHERE program_id = ?').bind(programId),
      env.DB.prepare('DELETE FROM esign_library_breeders WHERE program_id = ?').bind(programId),
    ]);
    return libraryView(env);
  }
  const label = one(body.label, 60);
  if (!label) fail(400, 'label_required');
  const programId = await programByEmail(env, body.email);
  await env.DB.prepare('INSERT INTO esign_library_breeders (program_id, label, created_at) VALUES (?, ?, ?) ON CONFLICT(program_id) DO UPDATE SET label = excluded.label')
    .bind(programId, label, iso(now)).run();
  return libraryView(env);
}

// POST library/offer { templateId, name, description, signs, to, programIds }: who may add
// a library template, and whether the breeder signs it too (`signs`, as its signer roles
// were placed). 'none' withdraws it (copies already added stay theirs).
async function setOffer(env, body, now) {
  const templateId = text(body.templateId);
  if (!UUIDISH.test(templateId)) fail(400, 'bad_template');
  const to = ['none', 'all', 'chosen'].includes(body.to) ? body.to : null;
  if (!to) fail(400, 'bad_offer');
  if (to === 'none') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM esign_library_access WHERE template_id = ?').bind(templateId),
      env.DB.prepare('DELETE FROM esign_library_templates WHERE template_id = ?').bind(templateId),
    ]);
    return libraryView(env);
  }
  const lib = await libraryOf(env);
  if (!lib) fail(409, 'library_not_linked');
  if (!lib.apiKey) fail(409, 'library_not_set_up');
  const t = await firma(env, lib.apiKey, 'GET', `/templates/${encodeURIComponent(templateId)}`);
  if (t.status === 404 || t.status === 403) fail(404, 'template_missing');
  if (!ok(t)) fail(502, 'esign_unavailable');
  const name = one(body.name, 255) || one(t.data?.name, 255) || 'Contract';
  const description = one(body.description, 300) || null;
  const signs = SIGNS.includes(body.signs) ? body.signs : 'none';
  const named = new Set((await env.DB.prepare('SELECT program_id FROM esign_library_breeders').all()).results.map((r) => r.program_id));
  const chosen = to === 'chosen' ? [...new Set((Array.isArray(body.programIds) ? body.programIds : []).map(text))].filter((id) => named.has(id)) : [];
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO esign_library_templates (template_id, name, description, all_breeders, signs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(template_id) DO UPDATE SET name = excluded.name, description = excluded.description, all_breeders = excluded.all_breeders,
         signs = excluded.signs, updated_at = excluded.updated_at`,
    ).bind(templateId, name, description, to === 'all' ? 1 : 0, signs, iso(now), iso(now)),
    env.DB.prepare('DELETE FROM esign_library_access WHERE template_id = ?').bind(templateId),
    ...chosen.map((id) => env.DB.prepare('INSERT INTO esign_library_access (template_id, program_id, created_at) VALUES (?, ?, ?)').bind(templateId, id, iso(now))),
  ]);
  return libraryView(env);
}

// The manager app's library routes (assist.js handleManager). → the answer, or undefined
// when `p` isn't one of them.
export async function handleLibraryManager(env, p, method, body, now = new Date()) {
  if (p === 'api/library' && method === 'GET') return libraryView(env);
  if (method !== 'POST') return undefined;
  if (p === 'api/library/link') return linkLibrary(env, body, now);
  if (p === 'api/library/unlink') return unlinkLibrary(env);
  if (p === 'api/library/breeder') return setBreeder(env, body, now);
  if (p === 'api/library/offer') return setOffer(env, body, now);
  return undefined;
}

// --- Her side ------------------------------------------------------------------------------

// The offer of a library template to her program, or null.
async function offerFor(env, programId, templateId) {
  return env.DB.prepare(
    `SELECT t.* FROM esign_library_templates t WHERE t.template_id = ?
       AND (t.all_breeders = 1 OR EXISTS (SELECT 1 FROM esign_library_access a WHERE a.template_id = t.template_id AND a.program_id = ?))`,
  ).bind(templateId, programId).first();
}

// GET /integrations/firma/library → { templates: [{ id, name, description, signs, added }] }.
// No Firma call: what support offers her, and whether she has added each.
export async function listLibrary(env, auth) {
  await herSide(env, auth);
  if (!(await config(env, LIBRARY_PROGRAM_KEY))) return { templates: [] };
  const { results } = await env.DB.prepare(
    `SELECT t.template_id, t.name, t.description, t.signs,
            EXISTS (SELECT 1 FROM esign_library_copies c WHERE c.program_id = ? AND c.library_template_id = t.template_id AND c.status = 'ready') AS added
       FROM esign_library_templates t
      WHERE t.all_breeders = 1 OR EXISTS (SELECT 1 FROM esign_library_access a WHERE a.template_id = t.template_id AND a.program_id = ?)
      ORDER BY t.name COLLATE NOCASE`,
  ).bind(auth.programId, auth.programId).all();
  return { templates: results.map((r) => ({ id: r.template_id, name: r.name, description: r.description || '', signs: SIGNS.includes(r.signs) ? r.signs : 'none', added: !!r.added })) };
}

const setCopy = (env, id, fields, now) => env.DB.prepare(
  `UPDATE esign_library_copies SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
).bind(...Object.values(fields), iso(now), id).run();

// Make the missing custom fields in her workspace (the ones the copy's prefills need).
// → { made, calls }
async function makeFields(env, key, ws, missing, budget) {
  let calls = 0;
  let made = 0;
  for (const f of missing) {
    if (calls >= budget) break;
    const r = await firma(env, key, 'POST', `/workspace/${ws}/custom-fields`, { field_label: f.field_label, field_name: f.field_name });
    calls++;
    if (ok(r) || r.status === 409) { made++; continue; }
    fail(502, 'esign_unavailable');
  }
  return { made, calls };
}

// Point the copy's prefills at her fields, within this request's calls.
// → { ready, unmapped, refused } | { gone: true } (the copy isn't in her workspace)
async function remapCopy(env, lib, her, templateId, used) {
  let calls = used;
  const libWs = encodeURIComponent(lib.connection.account_ref);
  const herWs = encodeURIComponent(her.connection.account_ref);
  const libFields = await workspaceFields(env, lib.apiKey, libWs, lib.connection);
  const herFields = await workspaceFields(env, her.apiKey, herWs, her.connection);
  calls += libFields.calls + herFields.calls;
  const read = await firma(env, her.apiKey, 'GET', `/templates/${encodeURIComponent(templateId)}/fields`);
  calls++;
  if (read.status === 404) return { gone: true };
  if (!ok(read)) await failFirma(env, her.connection, read);
  let plan = prefillRemap(fieldsOf(read.data), libFields.rows, herFields.rows);
  if (plan.missing.length) {
    // Not sure her list was all of them: making one could double it, so wait for a full read.
    if (!herFields.complete) { console.warn('firma: library copy, her fields list incomplete'); return { ready: false, unmapped: plan.unmapped, refused: 0 }; }
    const made = await makeFields(env, her.apiKey, herWs, plan.missing, CALL_BUDGET - calls);
    calls += made.calls;
    if (made.made < plan.missing.length) return { ready: false, unmapped: plan.unmapped, refused: 0 };
    const again = await workspaceFields(env, her.apiKey, herWs, her.connection);
    calls += again.calls;
    plan = prefillRemap(fieldsOf(read.data), libFields.rows, again.rows);
  }
  let refused = 0;
  let applied = 0;
  for (const change of plan.changes) {
    if (calls >= CALL_BUDGET) break;
    const r = await firma(env, her.apiKey, 'PATCH', `/templates/${encodeURIComponent(templateId)}`, { field: change });
    calls++;
    if (ok(r)) { applied++; continue; }
    if (r.status >= 400 && r.status < 500) {
      refused++;
      console.warn(`firma: library copy, a field not re-pointed: ${r.status}${firmaCode(r) ? ` ${firmaCode(r)}` : ''}`);
      continue;
    }
    fail(502, 'esign_unavailable');
  }
  const ready = applied + refused === plan.changes.length && !plan.missing.length;
  console.log(`firma: library copy, ${applied} prefill(s) re-pointed, ${refused} refused, ${plan.unmapped} unmapped${ready ? '' : ', more to do'}`);
  return { ready, unmapped: plan.unmapped + refused, refused };
}

// POST /integrations/firma/library/add { templateId }
// → { id (her copy), name, signs, ready, unmapped, already }
// One copy per breeder and library template: a second add answers the copy she has,
// unless she deleted it in Firma's editor. Not ready: call again (her device does).
export async function addLibraryTemplate(env, auth, body, now = new Date()) {
  await herSide(env, auth);
  const { connection, secrets } = await mine(env, auth);
  const libraryId = text(body?.templateId);
  if (!UUIDISH.test(libraryId)) fail(400, 'bad_template');
  const offer = await offerFor(env, auth.programId, libraryId);
  if (!offer) fail(404, 'not_found');
  const lib = await libraryOf(env);
  if (!lib?.apiKey) fail(409, 'library_not_linked');
  const her = { connection, apiKey: secrets.apiKey };
  let calls = 0;

  let row = await env.DB.prepare('SELECT * FROM esign_library_copies WHERE program_id = ? AND library_template_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(auth.programId, libraryId).first();
  if (row?.status === 'ready' && row.template_id) {
    const t = await firma(env, her.apiKey, 'GET', `/templates/${encodeURIComponent(row.template_id)}`);
    calls++;
    if (ok(t)) return { id: row.template_id, name: String(t.data?.name ?? offer.name), signs: offer.signs, ready: true, unmapped: 0, already: true };
    if (t.status !== 404) await failFirma(env, connection, t);
    await env.DB.prepare('DELETE FROM esign_library_copies WHERE id = ?').bind(row.id).run(); // deleted in her editor
    row = null;
  }
  if (!row || !row.template_id) {
    // A row still 'copying' lost Firma's answer: Firma may have made that copy too (a
    // spare template costs nothing, and she can delete it); copy again.
    const id = row?.id ?? crypto.randomUUID();
    if (!row) {
      await env.DB.prepare("INSERT INTO esign_library_copies (id, program_id, library_template_id, template_id, status, created_at, updated_at) VALUES (?, ?, ?, NULL, 'copying', ?, ?)")
        .bind(id, auth.programId, libraryId, iso(now), iso(now)).run();
    }
    const r = await firma(env, masterKey(env), 'POST', `/templates/${encodeURIComponent(libraryId)}/copy`, { workspace_id: connection.account_ref, name: offer.name });
    calls++;
    if (!ok(r) || !r.data?.id || !UUIDISH.test(String(r.data.id))) {
      console.warn(`firma: library copy refused: ${r.status}${firmaCode(r) ? ` ${firmaCode(r)}` : ''}`);
      if (r.status !== 0) await env.DB.prepare('DELETE FROM esign_library_copies WHERE id = ?').bind(id).run();
      if (r.status === 404) fail(404, 'template_missing');
      fail(502, 'esign_unavailable');
    }
    await setCopy(env, id, { template_id: String(r.data.id), status: 'mapping' }, now);
    row = { id, template_id: String(r.data.id), status: 'mapping' };
  }
  const result = await remapCopy(env, lib, her, row.template_id, calls);
  if (result.gone) {
    // Her copy was deleted (in Firma's editor) before it was ready: forget it, so the
    // next add makes a new one.
    await env.DB.prepare('DELETE FROM esign_library_copies WHERE id = ?').bind(row.id).run();
    fail(409, 'copy_missing');
  }
  if (result.ready) await setCopy(env, row.id, { status: 'ready' }, now);
  return { id: row.template_id, name: offer.name, signs: offer.signs, ready: result.ready, unmapped: result.unmapped, already: false };
}
