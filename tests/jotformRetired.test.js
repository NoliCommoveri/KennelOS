// Connect Jotform is retired (Integrations plan D27, D29): opening the app deletes
// the Jotform API keys a device still holds, and leaves every other secret alone.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, store;
before(async () => {
  ({ tables } = await installMemoryDb());
  store = await import('../shared/data/jotformKeyStore.js');
});

test('forgetJotformKeys removes only the jotform: rows', async () => {
  const rows = tables.device_secrets.rows;
  for (const id of ['jotform:a1', 'jotform:b2', 'stripe:a1', 'vault', 'kennelport:k1']) rows.set(id, { id });
  assert.equal(await store.forgetJotformKeys(), 2);
  assert.deepEqual([...rows.keys()].sort(), ['kennelport:k1', 'stripe:a1', 'vault']);
  assert.equal(await store.forgetJotformKeys(), 0, 'nothing left to remove');
});
