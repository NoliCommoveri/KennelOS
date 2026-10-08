// A local stand-in for the deployed Worker, for looking at the family pages in a
// browser: the real Worker code (src/) on the tests' node:sqlite D1, with ASSETS
// read from public/. Not used by any test. Run from cloud/:
//   node tests/helpers/serve.mjs [port]     (default 8790; prints a breeder token)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeEnv, signIn, call } from './env.js';
import { worker } from './worker.js';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const assets = {
  async fetch(req) {
    const path = normalize(new URL(req.url).pathname).replace(/^\/+/, '');
    if (path.includes('..')) return new Response('no', { status: 404 });
    try {
      const body = await readFile(join(PUBLIC, path));
      return new Response(body, { headers: { 'content-type': TYPES[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream' } });
    } catch { return new Response('not found', { status: 404 }); }
  },
};

const port = Number(process.argv[2] || 8790);
const env = await makeEnv({ ASSETS: assets });
const s = await signIn(env, 'breeder@example.com');
const { email_hash: eh } = env.DB.raw.prepare('SELECT email_hash FROM users').get();
env.DB.raw.prepare(`INSERT INTO pro_purchases (id, email_hash, kind, plan, status, access_until, source_updated_at, received_at)
  VALUES ('order:1', ?, 'order', 'lifetime', 'paid', NULL, ?, ?)`).run(eh, new Date().toISOString(), new Date().toISOString());
await call(env, 'POST', '/program/backing-device', { token: s.token });

createServer(async (req, res) => {
  // Local only: the newest emails this server "sent" (staging's outbox mode
  // delivers nothing), so a browser test can read a verification code.
  if (req.url === '/__dev/messages') {
    const rows = env.DB.raw.prepare('SELECT kind, to_email, subject, body FROM wl_messages ORDER BY rowid DESC LIMIT 5').all();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(rows));
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = { ...req.headers, 'cf-connecting-ip': '127.0.0.1' };
  const r = await worker.fetch(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(JSON.stringify({ port, token: s.token })));
