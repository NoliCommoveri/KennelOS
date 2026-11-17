// geo.js — driving miles between two addresses, through Mapbox
// (docs/KennelOS_Family_Requests_Plan.md §5, D4): geocode both (address → point),
// then one driving route between them (Directions API: miles and minutes). Not the
// Matrix API: it refuses a request for a single distance ("minimum number of matrix
// elements is 2"). The key is a Worker secret,
// MAPBOX_TOKEN; without it nothing is measured (503 geo_off) and the app falls
// back to an Open in Maps link. Nothing is stored here, and an address is never
// logged: the caller keeps only the miles and minutes.
//
// POST /geo/distance {from, to} (her app, signed in) → { miles, minutes }.
//
// Failures, each its own code so her app can say what happened (K8-5): no key → 503
// geo_off; Mapbox refuses the key, is over quota or down (401/403/429/5xx) → 502
// geo_failed, which stops her device's measuring for this sync; Mapbox unreachable or
// slower than GEO_TIMEOUT_MS → 502 geo_unreachable, the same; one address Mapbox won't
// take (another 4xx), can't find or has no road to → 422 not_found; one it only places
// roughly (a whole state or country, or a low-confidence match) → 422 imprecise. The
// last two are about that address alone, so measuring moves on to the next family.
//
// The family's address is looked up near hers (K8-6): `proximity` her point, so
// "Springfield" or "123 Main St" means the one nearest her, not the first anywhere.
import { fail, readJson } from './lib/http.js';
import { limitBucket } from './ratelimit.js';

const GEOCODE = 'https://api.mapbox.com/search/geocode/v6/forward';
const DIRECTIONS = 'https://api.mapbox.com/directions/v5/mapbox/driving/';
// A route's URL between two [lng, lat] points: no geometry or steps, only the totals.
const routeUrl = (env, a, b) => `${DIRECTIONS}${a.join(',')};${b.join(',')}?${new URLSearchParams({ overview: 'false', alternatives: 'false', steps: 'false', access_token: env.MAPBOX_TOKEN })}`;
export const GEO_LIMITS = { perHourPerProgram: 60, perHourPerFamily: 6, addressChars: 300 };
export const GEO_TIMEOUT_MS = 10 * 1000;
const METERS_PER_MILE = 1609.344;

export const geoAvailable = (env) => Boolean(env.MAPBOX_TOKEN);

// An address as a family or she typed it: a short line of text, or null.
export function cleanAddress(v) {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t.length >= 2 && t.length <= GEO_LIMITS.addressChars ? t : null;
}

// One request to Mapbox: unreachable, slow or not JSON → geo_unreachable.
async function mapbox(url) {
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(GEO_TIMEOUT_MS) }); } catch { fail(502, 'geo_unreachable'); }
  // The key or the service: everything waits for the next try.
  if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) fail(502, 'geo_failed');
  if (!res.ok) return null; // a query Mapbox won't take: about this address only
  try { return await res.json(); } catch { fail(502, 'geo_unreachable'); }
}

// Too rough to measure miles from: a whole country or region, or a match Mapbox itself
// rates low. Only what Mapbox says counts; a feature without these fields is taken.
const ROUGH_TYPES = new Set(['country', 'region']);
export function roughMatch(feature) {
  const p = feature?.properties || {};
  return ROUGH_TYPES.has(p.feature_type) || p.match_code?.confidence === 'low';
}

// → [lng, lat], null (not found), or 'rough'.
async function geocode(env, query, near = null) {
  const body = await mapbox(`${GEOCODE}?${new URLSearchParams({ q: query, limit: '1', ...(near ? { proximity: near.join(',') } : {}), access_token: env.MAPBOX_TOKEN })}`);
  const feature = body?.features?.[0];
  const at = feature?.geometry?.coordinates;
  if (!(Array.isArray(at) && at.length === 2 && at.every(Number.isFinite))) return null;
  return roughMatch(feature) ? 'rough' : at;
}

// → { miles, minutes } (miles to one decimal, minutes whole), null when either place
// can't be found or there's no road between them, or { imprecise: true } when the
// address is only placed roughly.
export async function drivingDistance(env, from, to) {
  if (!geoAvailable(env)) fail(503, 'geo_off');
  const a = await geocode(env, from);
  if (!a || a === 'rough') return a === 'rough' ? { imprecise: true } : null;
  const b = await geocode(env, to, a);
  if (!b) return null;
  if (b === 'rough') return { imprecise: true };
  const route = (await mapbox(routeUrl(env, a, b)))?.routes?.[0];
  const meters = route?.distance;
  const seconds = route?.duration;
  if (!Number.isFinite(meters)) return null;
  return { miles: Math.round((meters / METERS_PER_MILE) * 10) / 10, minutes: Number.isFinite(seconds) ? Math.round(seconds / 60) : null };
}

export async function handleGeoDistance(env, auth, request) {
  const body = await readJson(request, 4 * 1024);
  const from = cleanAddress(body.from);
  const to = cleanAddress(body.to);
  if (!from || !to) fail(400, 'bad_address');
  if (!geoAvailable(env)) fail(503, 'geo_off');
  await limitBucket(env, `geo:${auth.programId}`, GEO_LIMITS.perHourPerProgram);
  const d = await drivingDistance(env, from, to);
  if (!d) fail(422, 'not_found');
  if (d.imprecise) fail(422, 'imprecise');
  return d;
}

// Is the Mapbox key working (/ops)? One geocode of a fixed public place and one
// route between two fixed points: the same two APIs drivingDistance
// uses. No family's or kennel's address is ever used here.
// → { state: 'off' } | { state: 'ok', miles } | { state: 'failed', step: 'geocode' | 'route', status, message }
const CHECK_PLACE = 'Denver, Colorado';
const CHECK_TO = [-105.2705, 40.015]; // Boulder, Colorado
export async function checkMapbox(env) {
  if (!geoAvailable(env)) return { state: 'off' };
  const why = async (res) => { try { return String((await res.json())?.message ?? ''); } catch { return ''; } };
  try {
    const g = await fetch(`${GEOCODE}?${new URLSearchParams({ q: CHECK_PLACE, limit: '1', access_token: env.MAPBOX_TOKEN })}`);
    if (!g.ok) return { state: 'failed', step: 'geocode', status: g.status, message: await why(g) };
    const at = (await g.json())?.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(at) || at.length !== 2) return { state: 'failed', step: 'geocode', status: g.status, message: 'No place found for a known city.' };
    const m = await fetch(routeUrl(env, at, CHECK_TO));
    if (!m.ok) return { state: 'failed', step: 'route', status: m.status, message: await why(m) };
    const meters = (await m.json())?.routes?.[0]?.distance;
    if (!Number.isFinite(meters)) return { state: 'failed', step: 'route', status: m.status, message: 'No route between two known cities.' };
    return { state: 'ok', miles: Math.round((meters / METERS_PER_MILE) * 10) / 10 };
  } catch {
    return { state: 'failed', step: 'network', status: 0, message: 'Mapbox could not be reached.' };
  }
}
