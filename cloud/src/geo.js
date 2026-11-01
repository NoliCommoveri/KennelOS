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
