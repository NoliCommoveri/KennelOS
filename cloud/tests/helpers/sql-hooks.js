// Wrangler bundles src/migrations/*.sql as text modules ([[rules]] in
// wrangler.toml). Node has no equivalent, so this hook does the same for the
// tests, letting them import the real Worker modules rather than a copy.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function load(url, context, nextLoad) {
  if (url.endsWith('.sql')) {
    const text = await readFile(fileURLToPath(url), 'utf8');
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(text)};` };
  }
  return nextLoad(url, context);
}
