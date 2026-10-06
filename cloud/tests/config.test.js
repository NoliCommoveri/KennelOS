// Checks on files the Worker's correctness depends on but no import reaches:
// wrangler.toml and the editions' deploy map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cors } from './helpers/worker.js';

const here = (p) => new URL(p, import.meta.url);
const toml = readFileSync(here('../wrangler.toml'), 'utf8');

test('CORS origins are exactly the Lite and Pro domains deploy.yml publishes', () => {
  const deploy = readFileSync(here('../../.github/workflows/deploy.yml'), 'utf8');
  const domainOf = (edition) => {
    const m = deploy.match(new RegExp(`edition:\\s*${edition}\\b[\\s\\S]*?domain:\\s*(\\S+)`));
    assert.ok(m, `deploy.yml has no ${edition} leg`);
    return `https://${m[1]}`;
  };
  assert.deepEqual([...cors.EDITION_ORIGINS].sort(), [domainOf('lite'), domainOf('pro')].sort());
});

test('wrangler.toml: the .sql rule uses a glob wrangler will actually match', () => {
  assert.match(toml, /\[\[rules\]\][\s\S]*type\s*=\s*"Text"[\s\S]*globs\s*=\s*\["\*\*\/\*\.sql"\]/);
});

test('wrangler.toml: never sets not_found_handling (it would cut /ops off)', () => {
  const active = toml.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(active, /not_found_handling/);
});

test('wrangler.toml: binding names match what src/ reads', () => {
  assert.match(toml, /binding\s*=\s*"DB"/);
  assert.match(toml, /binding\s*=\s*"FILES"/);
});

test('wrangler.toml: a daily retention cron, and the staging outbox switch', () => {
  assert.match(toml, /\[triggers\]\s*crons\s*=\s*\["[^"]+"\]/);
  assert.match(toml, /DEV_OUTBOX\s*=\s*"1"/, 'staging shows codes on /ops; production must not set this');
  assert.match(toml, /name\s*=\s*"kennelos-api-staging"/, 'DEV_OUTBOX may only ride along with the staging Worker');
});
