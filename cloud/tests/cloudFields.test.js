// The server's copy of the cloud allow-list matches the app's (Cloud Phase 2 plan §6.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_FIELDS } from '../src/lib/cloudFields.js';
import { cloudFieldManifest } from '../../shared/data/syncRegistry.js';

test('cloudFields.js is up to date with shared/data/syncRegistry.js (regenerate: node cloud/scripts/cloud-fields.mjs > cloud/src/lib/cloudFields.js)', () => {
  assert.deepEqual(CLOUD_FIELDS, cloudFieldManifest());
});
