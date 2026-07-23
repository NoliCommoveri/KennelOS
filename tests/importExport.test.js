// importExport.test.js — the Blob ⇄ base64 marker round-trip that keeps stored
// documents and expense receipts durable across the JSON backup and Dropbox sync
// (data/importExport.js). JSON.stringify turns a Blob into `{}` and silently drops
// its bytes, so this encode/decode is the thing standing between "backup" and
// "lost my files"; it's worth a byte-exact regression test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blobToMarker, markerToBlob, BACKUP_FORMAT_VERSION, inspectBackup } from '../shared/data/importExport.js';

async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

test('a Blob survives marker encode → decode byte-for-byte, mime preserved', async () => {
  const original = new Blob([new Uint8Array([0, 1, 2, 254, 255, 128, 127])], { type: 'application/pdf' });
  const marker = await blobToMarker(original);
  assert.equal(marker.__blob_b64__, true);
  assert.equal(marker.mime, 'application/pdf');
  assert.equal(typeof marker.data, 'string');

  const restored = markerToBlob(marker);
  assert.ok(restored instanceof Blob);
  assert.equal(restored.type, 'application/pdf');
  assert.deepEqual([...(await bytesOf(restored))], [0, 1, 2, 254, 255, 128, 127]);
});

test('the marker is JSON-safe (a raw Blob is not)', async () => {
  const marker = await blobToMarker(new Blob([new Uint8Array([42, 200, 7])], { type: 'image/png' }));
  const roundTripped = JSON.parse(JSON.stringify(marker)); // survives the backup file
  const restored = markerToBlob(roundTripped);
  assert.deepEqual([...(await bytesOf(restored))], [42, 200, 7]);
  assert.equal(restored.type, 'image/png');
});

test('a large blob round-trips (exercises the chunked base64 path)', async () => {
  const n = 100_000; // larger than the 0x8000 chunk in blobToMarker
  const src = new Uint8Array(n);
  for (let i = 0; i < n; i++) src[i] = i % 256;
  const restored = markerToBlob(await blobToMarker(new Blob([src])));
  const out = await bytesOf(restored);
  assert.equal(out.length, n);
  assert.equal(out[0], 0);
  assert.equal(out[n - 1], (n - 1) % 256);
});

test('an empty/absent mime falls back to a generic binary type', async () => {
  const restored = markerToBlob(await blobToMarker(new Blob([new Uint8Array([1])])));
  assert.equal(restored.type, 'application/octet-stream');
});

test('BACKUP_FORMAT_VERSION is a positive integer (guards accidental clobber)', () => {
  assert.ok(Number.isInteger(BACKUP_FORMAT_VERSION) && BACKUP_FORMAT_VERSION >= 2);
});

test('inspectBackup rejects a file with no collections', () => {
  assert.throws(() => inspectBackup({}), /collections/);
  assert.throws(() => inspectBackup(null), /collections/);
});

test('inspectBackup refuses a format newer than this build understands', () => {
  assert.throws(
    () => inspectBackup({ format_version: BACKUP_FORMAT_VERSION + 1, collections: {} }),
    /newer version/
  );
});

test('inspectBackup accepts equal, older, or absent format_version', () => {
  // These must NOT throw on the format check (they may still report unknown tables,
  // which is not an error). A v1 file predates the field → undefined → allowed.
  assert.doesNotThrow(() => inspectBackup({ format_version: BACKUP_FORMAT_VERSION, collections: {} }));
  assert.doesNotThrow(() => inspectBackup({ format_version: 1, collections: {} }));
  assert.doesNotThrow(() => inspectBackup({ collections: {} }));
});
