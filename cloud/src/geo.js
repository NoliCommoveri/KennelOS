// geo.js — driving miles between two addresses, through Mapbox
// (docs/KennelOS_Family_Requests_Plan.md §5, D4): geocode both (address → point),
// then one Matrix element (miles and minutes). The key is a Worker secret,
// MAPBOX_TOKEN; without it nothing is measured (503 geo_off) and the app falls
// back to an Open in Maps link. Nothing is stored here, and an address is never
// logged: the caller keeps only the miles and minutes.
//
// POST /geo/distance {from, to} (her app, signed in) → { miles, minutes }.
import { fail, readJson } from './lib/http.js';
import { limitBucket } from './ratelimit.js';

const GEOCODE = 'https://api.mapbox.com/search/geocode/v6/forward';
const MATRIX = 'https://api.mapbox.com/directions-matrix/v1/mapbox/driving/';
export const GEO_LIMITS = { perHourPerProgram: 60, perHourPerFamily: 6, addressChars: 300 };
const METERS_PER_MILE = 1609.344;

export const geoAvailable = (env) => Boolean(env.MAPBOX_TOKEN);

// An address as a family or she typed it: a short line of text, or null.
export function cleanAddress(v) {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t.length >= 2 && t.length <= GEO_LIMITS.addressChars ? t : null;
}

async function geocode(env, query) {
  const url = `${GEOCODE}?${new URLSearchParams({ q: query, limit: '1', access_token: env.MAPBOX_TOKEN })}`;
  const res = await fetch(url);
  if (!res.ok) fail(502, 'geo_failed');
  const body = await res.json();
  const at = body?.features?.[0]?.geometry?.coordinates;
  return Array.isArray(at) && at.length === 2 && at.every(Number.isFinite) ? at : null;
}

// → { miles, minutes } (miles to one decimal, minutes whole), or null when either
// place can't be found or there's no road between them.
export async function drivingDistance(env, from, to) {
  if (!geoAvailable(env)) fail(503, 'geo_off');
  const [a, b] = await Promise.all([geocode(env, from), geocode(env, to)]);
  if (!a || !b) return null;
  const url = `${MATRIX}${a.join(',')};${b.join(',')}?${new URLSearchParams({ annotations: 'distance,duration', sources: '0', destinations: '1', access_token: env.MAPBOX_TOKEN })}`;
  const res = await fetch(url);
  if (!res.ok) fail(502, 'geo_failed');
  const body = await res.json();
  const meters = body?.distances?.[0]?.[0];
  const seconds = body?.durations?.[0]?.[0];
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
  return d;
}

// Is the Mapbox key working (/ops)? One geocode of a fixed public place and one
// Matrix element between two fixed points: the same two APIs drivingDistance
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
    const m = await fetch(`${MATRIX}${at.join(',')};${CHECK_TO.join(',')}?${new URLSearchParams({ annotations: 'distance', sources: '0', destinations: '1', access_token: env.MAPBOX_TOKEN })}`);
    if (!m.ok) return { state: 'failed', step: 'route', status: m.status, message: await why(m) };
    const meters = (await m.json())?.distances?.[0]?.[0];
    if (!Number.isFinite(meters)) return { state: 'failed', step: 'route', status: m.status, message: 'No route between two known cities.' };
    return { state: 'ok', miles: Math.round((meters / METERS_PER_MILE) * 10) / 10 };
  } catch {
    return { state: 'failed', step: 'network', status: 0, message: 'Mapbox could not be reached.' };
  }
}
