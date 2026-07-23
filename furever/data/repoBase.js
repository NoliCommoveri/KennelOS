// repoBase.js — shared plumbing for the Furever entity repos.
//
// Every repo exposes the same thin surface (getById, getAll, create, update,
// archive, hardDelete). This factory supplies the boilerplate; each entity repo
// wraps it to add entity-specific validation. Pages call repos; repos are the
// only code that touches Dexie.
//
// Deliberately simpler than the breeder app's repoBase: Furever has no editions,
// no cap, and no demo read-only mode, so there is no assertWritable/CapExceeded
// coupling here. Soft delete, UUID ids, created_at/updated_at, and the
// reference-blocked hard delete are identical.
import { db } from './db.js';
import { findBlockingReferences } from './referenceRegistry.js';

export function newId() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

// Thrown by hardDelete when references still exist — carries the human-readable
// blocker list so the UI can tell the family exactly what to archive instead.
export class ReferenceBlockedError extends Error {
  constructor(entity, blockers) {
    const detail = blockers.map((b) => `${b.label} (${b.count})`).join(', ');
    super(`Cannot delete ${entity}: still referenced as ${detail}. Archive it instead.`);
    this.name = 'ReferenceBlockedError';
    this.blockers = blockers;
  }
}

// Build the standard repo for a table.
//   tableName  — Dexie table name
//   references — the entity's registry array (referenceRegistry.js), or null if
//                nothing can point at this entity (a leaf, e.g. care_events).
export function makeRepo(tableName, references = null) {
  const table = () => db.table(tableName);

  const repo = {
    getById(id) {
      return table().get(id);
    },

    // Archived rows are filtered in JS, not via an index: IndexedDB can't key on
    // booleans, and at family scale (a handful of pets, a few hundred rows) an
    // in-memory filter is trivial.
    async getAll({ includeArchived = false } = {}) {
      const all = await table().toArray();
      return includeArchived ? all : all.filter((r) => !r.is_archived);
    },

    async create(data) {
      const now = nowIso();
      const record = {
        ...data,
        id: data.id ?? newId(),
        is_archived: data.is_archived ?? false,
        created_at: now,
        updated_at: now
      };
      await table().add(record);
      return record;
    },

    async update(id, changes) {
      const existing = await table().get(id);
      if (!existing) throw new Error(`${tableName}: no record with id ${id}`);
      const record = {
        ...existing,
        ...changes,
        id, // id is immutable
        created_at: existing.created_at, // preserve original
        updated_at: nowIso()
      };
      await table().put(record);
      return record;
    },

    // Soft delete — always allowed, never cascades. Hides from active lists and
    // pickers while staying resolvable for history.
    archive(id) {
      return repo.update(id, { is_archived: true });
    },

    unarchive(id) {
      return repo.update(id, { is_archived: false });
    },

    // Report blockers without deleting — lets the UI disable/explain Delete.
    // Empty array => hard delete is currently allowed.
    async getDeleteBlockers(id) {
      if (!references) return [];
      return findBlockingReferences(references, id);
    },

    // Hard delete — the rare "undo a data-entry mistake" action. Blocked whenever
    // any reference exists (only archive is allowed then).
    async hardDelete(id) {
      if (references) {
        const blockers = await findBlockingReferences(references, id);
        if (blockers.length > 0) throw new ReferenceBlockedError(tableName, blockers);
      }
      await table().delete(id);
    }
  };

  return repo;
}
