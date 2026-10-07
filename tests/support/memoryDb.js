// memoryDb.js — an in-memory stand-in for the Dexie tables, so a test can run
// the REAL sample-data seed (repos and all) without IndexedDB. Not a test file
// itself (node --test only discovers *.test.js under tests/).
//
// It covers the slice of the Dexie Table API the repos and seed use today:
// get/add/put/update/delete/bulkDelete/bulkPut/clear/toArray/count, where(index)
// .equals/anyOf/aboveOrEqual/between (multi-entry arrays match by membership;
// a '[a+b]' compound index matches by tuple), and an immediate transaction().
// If a repo starts using something else, the seed throws here, loudly.
//
// Call installMemoryDb() BEFORE importing anything that reads localStorage or
// writes through db; it patches the shared `db` singleton in place.

function memoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; }
  };
}

function memoryTable(name) {
  const rows = new Map();
  const copy = (r) => structuredClone(r);
  const matches = (r, field, v) => (Array.isArray(r[field]) ? r[field].includes(v) : r[field] === v);
  const collection = (pred) => ({
    toArray: async () => [...rows.values()].filter(pred).map(copy),
    count: async () => [...rows.values()].filter(pred).length,
    first: async () => { const r = [...rows.values()].find(pred); return r ? copy(r) : undefined; },
    filter: (p2) => collection((r) => pred(r) && p2(r))
  });
  return {
    name,
    rows,
    get: async (id) => (rows.has(id) ? copy(rows.get(id)) : undefined),
    add: async (r) => {
      if (rows.has(r.id)) throw new Error(`memoryDb ${name}: duplicate id ${r.id}`);
      rows.set(r.id, copy(r));
      return r.id;
    },
    put: async (r) => { rows.set(r.id, copy(r)); return r.id; },
    update: async (id, changes) => {
      const r = rows.get(id);
      if (!r) return 0;
      Object.assign(r, copy(changes));
      return 1;
    },
    delete: async (id) => { rows.delete(id); },
    bulkDelete: async (ids) => { ids.forEach((id) => rows.delete(id)); },
    bulkPut: async (rs) => { rs.forEach((r) => rows.set(r.id, copy(r))); },
    clear: async () => { rows.clear(); },
    toArray: async () => [...rows.values()].map(copy),
    count: async () => rows.size,
    filter: (p) => collection(p),
    where: (index) => {
      if (index.startsWith('[')) {
        const keys = index.slice(1, -1).split('+');
        return { equals: (vals) => collection((r) => keys.every((k, i) => r[k] === vals[i])) };
      }
      return {
        equals: (v) => collection((r) => matches(r, index, v)),
        anyOf: (vs) => collection((r) => vs.some((v) => matches(r, index, v))),
        aboveOrEqual: (v) => collection((r) => r[index] != null && r[index] >= v),
        between: (lo, hi, incLo = true, incHi = false) => collection((r) => {
          const x = r[index];
          if (x == null) return false;
          return (incLo ? x >= lo : x > lo) && (incHi ? x <= hi : x < hi);
        })
      };
    }
  };
}

// Patches `db` (shared/data/db.js) so every table is in memory. Returns
// { tables } — a map of table name → stand-in, whose `.rows` Map holds the data.
export async function installMemoryDb() {
  if (!globalThis.localStorage) globalThis.localStorage = memoryStorage();
  const { db } = await import('../../shared/data/db.js');
  const tables = {};
  for (const t of db.tables) {
    tables[t.name] = memoryTable(t.name);
    Object.defineProperty(db, t.name, { value: tables[t.name], configurable: true });
  }
  // Code that iterates db.tables (exportAll, restore) gets the stand-ins too.
  Object.defineProperty(db, 'tables', { value: Object.values(tables), configurable: true });
  db.table = (n) => {
    if (!tables[n]) throw new Error(`memoryDb: no table "${n}"`);
    return tables[n];
  };
  db.transaction = async (...args) => args[args.length - 1]();
  return { db, tables };
}

// The current contents as an exportAll-shaped `{ table: rows[] }` map.
export function snapshotTables(tables) {
  const out = {};
  for (const [name, t] of Object.entries(tables)) out[name] = [...t.rows.values()].map((r) => structuredClone(r));
  return out;
}
