// writeScan.js — a static scan of the fields the app writes (Review Remainder
// batch I, K1-5). It reads every .js file under shared/data and shared/pages and
// finds each write to a Dexie table, either through its repo
// (`dogRepo.create({...})`, `dogRepo.update(id, {...})`) or directly
// (`db.dogs.put({...})`, `.add`, `.update`), or inside a repo file through its
// `base` (`base.create({...})`). For each one, it collects the
// top-level keys of every object-literal argument. Writes that take a variable
// (`dogRepo.update(id, patch)`) aren't seen: this is meant to sit beside the
// sample-packet coverage, not to replace it.
//
// Returns Map(table → Map(field → Set of 'file:line' where it's written)).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const SCAN_DIRS = ['shared/data', 'shared/pages'];
const METHODS = new Set(['create', 'update', 'put', 'add']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

// repo variable name → table, from each `<x>Repo.js`'s `makeRepo('<table>'`.
export function repoTables() {
  const map = new Map();
  for (const f of readdirSync(join(ROOT, 'shared/data'))) {
    if (!/Repo\.js$/.test(f)) continue;
    const src = readFileSync(join(ROOT, 'shared/data', f), 'utf8');
    const m = src.match(/makeRepo\(\s*['"]([a-z_]+)['"]/);
    if (m) map.set(basename(f, '.js'), m[1]);
  }
  return map;
}

// Skip a string, template literal or comment starting at i; return the index
// after it, or -1 when i doesn't start one.
function skipNonCode(src, i) {
  const c = src[i];
  if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); return e < 0 ? src.length : e; }
  if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); return e < 0 ? src.length : e + 2; }
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; if (src[j] === '\n') break; j++; }
    return j + 1;
  }
  if (c === '`') {
    let j = i + 1;
    while (j < src.length && src[j] !== '`') {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '$' && src[j + 1] === '{') { j = matchClose(src, j + 1) + 1; continue; }
      j++;
    }
    return j + 1;
  }
  return -1;
}

// Index of the bracket that closes the one at `open`.
function matchClose(src, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [pairs[src[open]]];
  let i = open + 1;
  while (i < src.length && stack.length) {
    const s = skipNonCode(src, i);
    if (s >= 0) { i = s; continue; }
    const c = src[i];
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) stack.pop();
    i++;
  }
  return i - 1;
}

// Top-level keys of the object literal whose `{` is at `open`.
function literalKeys(src, open) {
  const close = matchClose(src, open);
  const keys = [];
  let i = open + 1;
  let expectKey = true;
  while (i < close) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) { i = skipNonCode(src, i); continue; }
    if (expectKey) {
      expectKey = false;
      if (src.startsWith('...', i)) { /* spread: not a named key */ }
      else {
        const m = /^(?:(['"])([A-Za-z_$][\w$]*)\1|([A-Za-z_$][\w$]*))\s*(:|,|\}|\()/.exec(src.slice(i, close + 1));
        if (m) {
          // `get x()` / `async x()` methods don't occur in these literals; `x(` is a method: skip.
          if (m[4] !== '(') keys.push(m[2] || m[3]);
        }
      }
    }
    // Move to the next top-level comma.
    const s = skipNonCode(src, i);
    if (s >= 0) { i = s; continue; }
    if (c === '(' || c === '{' || c === '[') { i = matchClose(src, i) + 1; continue; }
    if (c === ',') expectKey = true;
    i++;
  }
  return keys;
}

// Object-literal arguments of the call whose `(` is at `open`.
function literalArgs(src, open) {
  const close = matchClose(src, open);
  const out = [];
  let i = open + 1;
  let argStart = true;
  while (i < close) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const s = skipNonCode(src, i);
    if (s >= 0) { i = s; argStart = false; continue; }
    if (c === '{' && argStart) { out.push(i); i = matchClose(src, i) + 1; argStart = false; continue; }
    if (c === '(' || c === '{' || c === '[') { i = matchClose(src, i) + 1; argStart = false; continue; }
    if (c === ',') { argStart = true; i++; continue; }
    argStart = false;
    i++;
  }
  return out;
}

export function scanWrites() {
  const repos = repoTables();
  const result = new Map();
  const add = (table, field, where) => {
    if (!result.has(table)) result.set(table, new Map());
    const t = result.get(table);
    if (!t.has(field)) t.set(field, new Set());
    t.get(field).add(where);
  };
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
  const callRe = /\b(?:([A-Za-z]\w*Repo|base)|db\.([a-z_]+)|db\.table\(\s*['"]([a-z_]+)['"]\s*\))\s*\.\s*([a-z]+)\s*\(/g;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    // Inside a repo file, `base` is that repo's makeRepo(...) object.
    const own = repos.get(basename(file, '.js'));
    let m;
    callRe.lastIndex = 0;
    while ((m = callRe.exec(src))) {
      const [, repo, dbTable, dbTable2, method] = m;
      if (!METHODS.has(method)) continue;
      const table = repo === 'base' ? own : repo ? repos.get(repo) : (dbTable || dbTable2);
      if (!table) continue;
      const open = m.index + m[0].length - 1;
      const line = src.slice(0, m.index).split('\n').length;
      for (const lit of literalArgs(src, open)) {
        for (const k of literalKeys(src, lit)) add(table, k, `${rel}:${line}`);
      }
    }
  }
  return result;
}
