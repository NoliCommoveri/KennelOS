// contentPackFetch.js — fetches a breeder's published content pack(s) for one
// pet: a public-key manifest read, then a public-key read of each listed file,
// version-gated against the local cache. See
// docs/KennelOS_Content_Package_Fetch_Mechanism.md §4.4/§9 (in the KennelOS repo)
// for the full mechanism this implements.
//
// API_KEY below is a public Google Cloud API key for the same "KennelOS"
// project as shared/data/googleDrive.js's CLIENT_ID, restricted two ways at
// https://console.cloud.google.com:
//   - Application restriction: HTTP referrers limited to the Furever origin
//     (https://furever.kennelos.app/*) plus http://localhost:8000/* for dev;
//   - API restriction: Google Drive API only.
// Those restrictions are the actual control, not secrecy — this key can only
// ever read files the breeder has already made public-by-link, and only when
// called from an allowed origin. No family sign-in, ever (§9's verified fact:
// `files/{id}?alt=media&key=…` is CORS-open for a publicly-shared file).
export const API_KEY = 'AIzaSyBvoty8PqxHv6KaZ3le_H0LNHYW9KhpZIk';

import { fileRepo } from './fileRepo.js';
import { documentRepo } from './documentRepo.js';
import { contentPackRepo } from './contentPackRepo.js';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

// Link-shared Drive items can require a resourceKey (§9's 2021-security-change
// caveat) — passed as a header, `{fileId}/{resourceKey}`, only when one is known.
function resourceKeyHeaders(fileId, resourceKey) {
  return resourceKey ? { 'X-Goog-Drive-Resource-Keys': `${fileId}/${resourceKey}` } : {};
}

function driveMediaUrl(fileId) {
  return `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media&key=${API_KEY}`;
}

async function fetchManifestJson(fileId, resourceKey) {
  const res = await fetch(driveMediaUrl(fileId), { headers: resourceKeyHeaders(fileId, resourceKey) });
  if (!res.ok) throw new Error(`manifest fetch failed (${res.status})`);
  return res.json();
}

async function fetchFileBlob(fileId, resourceKey) {
  const res = await fetch(driveMediaUrl(fileId), { headers: resourceKeyHeaders(fileId, resourceKey) });
  if (!res.ok) throw new Error(`file fetch failed (${res.status})`);
  return res.blob();
}

// Shape check only (§3.1) — a malformed manifest is treated the same as an
// unreachable one: skip this pack, never a hard failure.
function isValidManifest(m) {
  return !!m && typeof m === 'object'
    && typeof m.packKey === 'string' && m.packKey
    && typeof m.version === 'number'
    && Array.isArray(m.files);
}

// One pack pointer (§3.2): fetch its manifest, skip if unchanged, else fetch
// every listed file and blind-replace this pet's breeder layer for the pack.
// Never throws — every failure just leaves the cache/documents as they were,
// retried on the next open that carries this pointer.
async function fetchOnePackage(petId, pointer) {
  if (!pointer || !pointer.manifestFileId || !pointer.packKey) return;

  let manifest;
  try {
    manifest = await fetchManifestJson(pointer.manifestFileId, pointer.manifestResourceKey);
  } catch {
    return; // offline, not-yet-published, or a transient error — try again next open
  }
  if (!isValidManifest(manifest)) return;

  const cached = await contentPackRepo.getByKey(pointer.packKey);
  if (cached && typeof cached.version === 'number' && manifest.version <= cached.version) {
    return; // already have this version — cheap no-op (§4.4 step 2)
  }

  const docDate = manifest.updatedAt ? String(manifest.updatedAt).slice(0, 10) : '';
  const entries = [];
  for (const f of manifest.files) {
    if (!f || !f.fileId) continue;
    try {
      const blob = await fetchFileBlob(f.fileId, f.resourceKey);
      const fileRecord = await fileRepo.create({ blob, name: f.title || '', mime: f.mime || blob.type || '' });
      entries.push({
        file_id: fileRecord.id,
        drive_file_id: f.fileId,
        title: f.title || '',
        doc_type: f.docType || 'other',
        doc_date: docDate
      });
    } catch {
      // one bad file in the pack shouldn't drop the rest of it
    }
  }

  await documentRepo.replaceBreederLayer(petId, pointer.packKey, entries);
  await contentPackRepo.upsert({
    pack_key: pointer.packKey,
    kennel_name: manifest.kennelName || '',
    scope: manifest.scope || pointer.scope || '',
    version: manifest.version
  });
}

// The one entry point callers use (app.js boot(), after a seed link is applied —
// §4.4's "first open + every resend"). Best-effort and online-only: never throws,
// never blocks the caller, and a fully offline/failed run just leaves things as
// they were. `pet` must already carry its `seed.contentPackages` pointers (i.e.
// this pet was just seeded/re-seeded by consumeSeedLink).
export async function fetchContentPackagesForPet(pet) {
  const pointers = pet && pet.seed && Array.isArray(pet.seed.contentPackages)
    ? pet.seed.contentPackages
    : [];
  for (const pointer of pointers) {
    try {
      await fetchOnePackage(pet.id, pointer);
    } catch {
      // best-effort — one pack's failure never breaks another's or the caller
    }
  }
}
