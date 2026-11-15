// Document files, content-addressed by sha256 (plan §4.1, §6.1, §6.3).
//
// D1's `files` table is the index: the snapshot reference check reads it. HEAD and
// PUT also ask R2, so a row whose object is gone (an R2 loss, D1 restored over the
// bucket) reads as missing, and the app's next upload puts the bytes back (review
// K4-5). A PUT streams straight into R2 with the expected sha256, so R2
// itself rejects a body that doesn't match; the Worker never buffers or hashes
// the file (25 MB would blow the CPU and memory limits).
import { contentLength, fail } from './lib/http.js';

export const SHA256 = /^[0-9a-f]{64}$/;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const fileKey = (programId, sha) => `files/${programId}/${sha}`;

function checkSha(sha) {
  if (!SHA256.test(sha)) fail(400, 'bad_sha256');
}

export async function fileExists(env, programId, sha) {
  return Boolean(await env.DB.prepare('SELECT 1 FROM files WHERE program_id = ? AND sha256 = ?').bind(programId, sha).first());
}

// The row and its object both there.
async function fileStored(env, programId, sha) {
  return (await fileExists(env, programId, sha)) && Boolean(await env.FILES.head(fileKey(programId, sha)));
}

// HEAD /files/:sha256 → true if present.
export async function headFile(env, auth, sha) {
  checkSha(sha);
  return fileStored(env, auth.programId, sha);
}

// PUT /files/:sha256. Uploading a file that's already there is a no-op.
export async function putFile(env, auth, sha, request) {
  checkSha(sha);
  const size = contentLength(request, MAX_FILE_BYTES);
  if (await fileStored(env, auth.programId, sha)) return { ok: true, existed: true };

  const contentType = (request.headers.get('content-type') ?? 'application/octet-stream').slice(0, 100);
  try {
    await env.FILES.put(fileKey(auth.programId, sha), request.body, { sha256: sha, httpMetadata: { contentType } });
  } catch (err) {
    if (/sha-?256|checksum|did not match/i.test(String(err?.message ?? err))) fail(400, 'hash_mismatch');
    throw err;
  }
  await env.DB.prepare('INSERT INTO files (program_id, sha256, size, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(auth.programId, sha, size, new Date().toISOString()).run();
  return { ok: true, existed: false };
}

// GET /files/:sha256 → the R2 object, or null.
export async function getFile(env, auth, sha) {
  checkSha(sha);
  if (!(await fileExists(env, auth.programId, sha))) return null;
  return env.FILES.get(fileKey(auth.programId, sha));
}
