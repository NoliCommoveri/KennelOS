// seedLink.js — decodes a breeder-sent seed link (brief §"The idea"; schema doc
// §"Not built yet") and applies it through the existing seed-layer repos.
//
// The link carries "#seed=<lz-string-compressed JSON>" (index.html forwards the
// whole hash to pages/today.html, schema doc §Not built yet). The packet is ONE
// flat object shaped to match what both upsert methods already read by name —
// breederRepo.upsertFromSeed (breederKey, kennelName, tagline, breederContact,
// breederVet) and petRepo.upsertSeededPet (pupId, name, species, sex, breed, dob,
// photoUrl, contentPackKey, plus whatever else — the whole packet rides along
// unindexed in pet.seed) — so decoding is just decompress → parse → validate →
// upsert breeder → upsert pet. No DOM here; pages call consumeSeedLink() and
// render whatever it returns or throws.
import { decompressFromEncodedURIComponent } from '../vendor/lz-string.min.mjs';
import { breederRepo } from './breederRepo.js';
import { petRepo } from './petRepo.js';

const SEED_PARAM = 'seed';

export class SeedLinkError extends Error {}

const BAD_LINK_MESSAGE = 'This link could not be read. Please ask your breeder for a fresh one.';

// Pull the raw compressed payload out of a URL hash, e.g. "#seed=N4IgLg9g…".
// Deliberately NOT run through URLSearchParams/decodeURIComponent: lz-string's
// encoded-URI-component charset (A-Za-z0-9+-$) is fragment-safe as-is, and
// form-encoding's "+" → space rule would corrupt a raw "+" in the payload.
// Returns null when the hash carries no seed param — the common case.
export function extractSeedPayload(hash) {
  const raw = (hash || '').replace(/^#/, '');
  const prefix = `${SEED_PARAM}=`;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : null;
}

// Decompress + parse a payload into the raw packet object. Throws SeedLinkError
// (a friendly, family-facing message) on anything malformed rather than letting a
// truncated or corrupted link half-apply.
export function decodeSeedPacket(payload) {
  let json = null;
  try {
    json = decompressFromEncodedURIComponent(payload);
  } catch (e) { json = null; }
  if (!json) throw new SeedLinkError(BAD_LINK_MESSAGE);

  let packet;
  try {
    packet = JSON.parse(json);
  } catch (e) {
    throw new SeedLinkError(BAD_LINK_MESSAGE);
  }
  if (!packet || typeof packet !== 'object') throw new SeedLinkError(BAD_LINK_MESSAGE);
  if (!packet.pupId || !packet.breederKey) throw new SeedLinkError(BAD_LINK_MESSAGE);
  return packet;
}

// Apply a decoded packet: upsert the breeder identity, then upsert the seeded pet
// keyed on pupId (schema doc §seed layer — a resend refreshes seed-owned fields
// only; the family's own records in other tables are never touched). Returns
// { pet, breeder, created }.
export async function applySeedPacket(packet) {
  const breeder = await breederRepo.upsertFromSeed(packet);
  const { pet, created } = await petRepo.upsertSeededPet(packet, breeder.id);
  return { pet, breeder, created };
}

// The one entry point pages use: given the raw location.hash, decode + apply a
// seed link if one is present. Returns null when there's nothing to do (no `seed`
// param), so callers can tell "no link" apart from "bad link" (which throws).
export async function consumeSeedLink(hash) {
  const payload = extractSeedPayload(hash);
  if (!payload) return null;
  const packet = decodeSeedPacket(payload);
  return applySeedPacket(packet);
}
