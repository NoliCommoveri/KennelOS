// db.js — Dexie schema for KennelOS Furever (the free, family-facing pet-care
// app). SEPARATE APP, SEPARATE ORIGIN, SEPARATE DATABASE from the breeder app:
// nothing here shares storage with `KennelOSBreedingApp`. Furever installs on a
// puppy family's device at pickup, seeded with one pup, and grows into their
// home for ALL their pets over years (see docs/KennelOS_Furever_Family_App_Brief.md
// and docs/KennelOS_Furever_Schema.md).
//
// Same conventions as the breeder core: pages never import this file and never
// call db.<table>.* — they go through the repo modules in this folder. The repos
// are the only code that touches Dexie.
//
// Dexie is vendored locally (no CDN) so the app works offline after first load.
import Dexie from '../vendor/dexie.min.mjs';

// Distinct DB name — Furever runs on its own sub-origin (e.g. companion.kennelos.app)
// and its storage must never collide with anything else on that account.
export const db = new Dexie('KennelOSFurever');

// --- The two data layers (the spine of this schema) -----------------------
// Everything below serves ONE separation (brief §"Two data layers"):
//   1. SEED layer  — breeder-provided, refreshable, upserted by `pup_id`. The
//      family never edits it; a resend replaces it wholesale. Lives in the
//      `breeders` table and in each seeded pet's unindexed `seed` object.
//   2. FAMILY layer — everything the family adds over the years. Theirs; the
//      seed never touches it. Lives in `care_events`, `care_plans`, `contacts`,
//      `documents`, `photos`, `files`.
// Because the two layers are physically distinct rows/fields, a resend is a
// blind replace of the seed side — no merge, and the family's history can't be
// clobbered.
//
// --- The reminder model (why there is no reminder_date anywhere) ----------
// Furever deliberately does NOT copy the breeder app's plan-then-edit reminder
// (schedule a future-dated event, come back and edit it into the actual). A
// family finds that backwards. Instead:
//   - "What's due" is DERIVED, never stored (see schedule.js). A schedule item
//     projects a due date from the pet's DOB (or a plan's start date); nothing
//     is written when it becomes due.
//   - "What happened" is an append-only `care_events` row carrying the REAL
//     date and, optionally, the `plan_item_id` of the schedule item it satisfies.
//   - A reminder clears because a matching actual was logged, not because a
//     future event got edited. Recurring items compute their next due from the
//     latest logged actual. A corrected DOB just recomputes due dates and never
//     disturbs a logged actual.
// So there is no `schedule_progress` table and no `reminder_date` column — the
// due-soon list is a pure query over (schedule items) × (care_events).
//
// Index notes:
//  - pets `pup_id` is the SEED UPSERT KEY. Present only on seeded pets (a
//    self-added pet has none), so it is a sparse index; a resend is
//    pets.where('pup_id').equals(pupId) → replace the seed side in place.
//  - `source` ('seeded' | 'self') indexed so a view can split "from your breeder"
//    from "pets you added yourself".
//  - `species` indexed because content is dog-first: a dog gets the full care
//    library + schedule; other species are records-only until a content pack
//    exists (brief §Multi-pet).
//  - care_events `pet_id` is the load-bearing scope index: every family-layer
//    page filters to the active pet, so `getByPet` is an index probe. `plan_item_id`
//    is indexed so "has this scheduled item been logged yet?" — the heart of the
//    derived reminder — is a probe, not a scan. `event_date` is the ACTUAL date,
//    indexed for newest-first history.
//  - care_plans holds only FAMILY-AUTHORED cadences ("vet says every 6 weeks").
//    Universal schedule items are CONTENT (careLibrary.js), not rows here.
//    Indexed on pet_id (scope) and category. (Breeder packs are DOCUMENTS-only,
//    per Content Package Fetch Mechanism §0 — they never contribute schedule
//    items, so content_packs plays no part in the schedule engine.)
//  - contacts `pet_id` is NULLABLE: null = a family-wide contact (their vet)
//    that shows for every pet; set = specific to one pet.
//  - documents/photos each own exactly one `files` row (fileRepo), deleted
//    alongside — files is never a referenceRegistry target, only fetched by id,
//    so only `created_at` (backup ordering) rides beside it. `documents` also
//    carries plain, unindexed `source`/`pack_key`/`drive_file_id` fields:
//    breeder-published rows (source:'breeder') land via contentPackFetch.js and
//    are blindly replaced wholesale on a pack version bump
//    (documentRepo.replaceBreederLayer); family uploads (source:'self', default)
//    are never touched by a fetch.
//  - content_packs is the MANIFEST CACHE for a breeder's published packs
//    (Content Package Fetch Mechanism §3.3 — repurposed from an earlier "custom
//    overlay" design, dropped for a documents-only payload): just "which version
//    of which pack have we fetched," so contentPackFetch.js can skip an
//    unchanged pack on a resend. `pack_key` is unique (&): a pet points at its
//    kennel-wide pack by key (pets.content_pack_key), and a re-fetch upserts.
//  - household is a SINGLETON (one row, fixed id 'household'): the family's own
//    identity — their name ("Carson" → shown as "Carson Family Pets" in the app
//    banner) and room to grow (address/phone later). App-wide, not pet-scoped, so
//    it carries no pet_id and nothing points at it. Their vet and other contacts
//    are NOT here — those are family-wide `contacts` rows (pet_id null).
//  - feeding is ONE ROW PER PET (feedingRepo upserts by pet_id): the pet's food
//    brand + chosen feeding schedule (an age-bracket preset key or a Custom text).
//    The age→portion presets themselves are CONTENT (careLibrary.FEEDING_PLAN),
//    not rows; only the family's brand + choice persist here.
//  - potty_events is the Potty page's high-frequency log (a success or an
//    accident, with the calendar date it happened). Kept OUT of care_events so
//    that table stays the scheduled-care actuals log (plan_item_id pairing);
//    indexed on pet_id (scope) + occurred_date (the one-day-at-a-time view).
db.version(1).stores({
  pets:          'id, pup_id, source, breeder_id, species, is_archived',
  breeders:      'id, breeder_key, is_archived',
  household:     'id',
  contacts:      'id, pet_id, contact_type, is_archived',
  care_events:   'id, pet_id, plan_item_id, event_type, event_date, is_archived',
  care_plans:    'id, pet_id, category, is_archived',
  feeding:       'id, pet_id, is_archived',
  potty_events:  'id, pet_id, occurred_date, is_archived',
  documents:     'id, pet_id, doc_type, doc_date, is_archived',
  photos:        'id, pet_id, taken_date, is_archived',
  files:         'id, created_at',
  content_packs: 'id, &pack_key'
});

// --- First-run storage durability -----------------------------------------
// This app is meant to last FIVE YEARS on a family's phone, so eviction is the
// real risk. Ask the browser to keep this origin's data; best-effort, pairs with
// the Add-to-Home-Screen nudge (brief §Keeping five years of records safe).
export async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    /* non-fatal — durability is a nicety, not a requirement */
  }
  return false;
}

// Whether the browser has ALREADY granted durable storage to this origin (vs.
// requestPersistentStorage(), which asks for it). Lets the Settings page show the
// current state and offer a manual re-request if first-run didn't get it.
export async function isStoragePersisted() {
  try {
    if (navigator.storage && navigator.storage.persisted) {
      return await navigator.storage.persisted();
    }
  } catch {
    /* non-fatal */
  }
  return false;
}

// Convenience: the table names that exist in the current schema version, so the
// reference-integrity guard never probes a table that isn't there yet.
export function existingTableNames() {
  return db.tables.map((t) => t.name);
}
