# KennelOS Cloud — accounts, sync & dog transfers (PROPOSAL / DRAFT)

> **Status: proposal for discussion. Nothing here is decided or built.** It reverses a
> founding non-negotiable ("no backend"; Editions Plan §Licensing; End-State guide §2), so
> every decision below needs explicit sign-off before any code lands. The open
> questions are collected in §9.

## 1. What's being asked

1. **Data protection.** Today a kennel's entire history lives in one browser's IndexedDB.
   If the browser clears site data, the phone gets replaced, or Safari evicts storage,
   the data is gone unless the owner remembered to export a JSON file or set up Dropbox.
   Our users are mostly non-technical, so in practice many of them have no backup.
2. **Transfers without files.** Sending a dog to another breeder should be "pick the dog,
   pick the person, they tap Accept." Today it's "export JSON, email it, import it."
3. **Multi-user business.** A household or a kennel with helpers should all see the same
   records on their own phones without anyone having to sync by hand.
4. **Some things can stay local.** Financials, for example.

## 2. Recommendation in one paragraph

**Keep the app local-first and add a cloud sync layer behind the repos.** Do not rewrite it
into an online-only web app. Every page keeps reading and writing IndexedDB through the repos
exactly as today, so the app stays fast and keeps working at shows, in barns, and anywhere
else with poor signal. A small Cloudflare backend (Workers + Durable Objects + D1 + R2) holds
the account, an authoritative copy of each kennel program, and the transfer inbox. The
repo layer records each write in a local outbox, and a sync loop pushes that outbox and pulls
everyone else's changes. Signing in on a new phone restores everything automatically.

Why this rather than a server-first rewrite:

- **The codebase is already about 80% sync-ready.** Ids are client-side UUIDs, so they never
  collide. Deletes are soft (`is_archived`), so there's almost nothing to tombstone. Every
  row has `updated_at`. All writes go through `repoBase` create/update/hardDelete, which already
  has a single interception point (`assertWritable`), plus a handful of direct writers
  (`fileRepo`, `expenseRepo`, `sampleData`, `assistantSync`, the `importExport` restore).
- **Offline still matters.** A server-first app fails in exactly the places breeders work.
- **It keeps the layering intact:** pages → repos → Dexie, with sync sitting below the repos.
  Pages don't change.

## 3. The Cloudflare shape

| Piece | Holds | Why this one |
|---|---|---|
| **Workers** | The API (auth, sync, transfers, license webhooks) | Same platform as the static hosting, and cheap |
| **Durable Object per program** (SQLite-backed) | The authoritative record set for one account's program, an ever-increasing change sequence, and live websocket pushes to that program's devices | One object per kennel program puts every write for that program in a single queue. That gives a clean change order for "give me changes since #N" and avoids cross-tenant locking. Point-in-time recovery covers the last 30 days. |
| **D1** | Global tables: users, programs, memberships/roles, pending transfers, the `kennels.public_id` directory, license entitlements | Cross-program lookups such as "which program owns kennel `kos1_…`?" and "what's in my transfer inbox?" |
| **R2** | Documents, receipts, photos (today's `files` table blobs) | No egress fees. Large blobs stay out of the record store. |
| **Email** (Cloudflare Email Service, Resend, or similar) | Sign-in links, transfer notices, invites | Non-technical users understand email. |

**Server record format:** one generic row per record, `(table, id, data_json, updated_at,
seq, deleted)`, rather than mirroring the 13 Dexie tables as SQL tables. The server then
doesn't need a migration every time a field is added locally, which matches the existing
"every non-indexed field still persists and rides the backup" convention.

**Rough cost:** the Workers paid plan is $5/month and includes enough Durable Object, D1, and
R2 headroom for hundreds of kennels. Real cost grows mainly with document and photo storage
(R2 is about $0.015 per GB-month).

## 4. Accounts, sign-in, programs, roles

- **Sign-in:** an emailed magic link, with optional passkeys added later. Users don't manage
  passwords, so there's no password reset to support. Account recovery is the same email.
- **Program** = what one install holds today: one or more kennels (multi-kennel scope
  already exists). One program has one owner and one subscription.
- **Members and roles** (proposed):
  - **Owner** — everything, including billing and transfers.
  - **Staff** — read and write all records except financials.
  - **Helper** — logs events against dogs only. This is today's KennelAssistant, which can
    then be retired. Helpers see the same allow-list `assistantSync.js` already enforces,
    but the server enforces it now, not just the export step.
- **Licensing gets simpler.** Lemon Squeezy webhooks go to the Worker, and entitlement
  belongs to the *account* rather than each browser. Activation slots, the device ids, the
  grace-window state machine, and the "release this device" UI (README Step 7) can all retire.

## 5. Sync model

- **Outbox:** each repo write also appends `{table, id, op}` to a new local `sync_outbox`
  table. The full record is read at push time, so repeated edits to one record collapse
  into a single push.
- **Push/pull:** `POST /sync {sinceSeq, changes[]}` returns the changes from other devices
  and the new `seq`. A websocket nudge means teammates' edits show up within seconds while
  online. Offline, the outbox simply grows.
- **Conflicts:** last writer wins **per record**, judged by server receive order. For a
  handful of people in one kennel, true same-record conflicts are rare. Per-field merging is
  a possible later refinement, not a starting requirement.
- **Hard delete** becomes a tombstone so other devices drop the row. The registry-driven
  reference check still runs locally first, against the fully synced set.
- **Referential integrity across devices:** the whole program syncs, so every FK target is
  present locally. No partial-replica edge cases inside one program.
- **Schema:** `sync_outbox` plus a per-table `seq` cursor in settings. Pre-launch this can go
  in the editable `version(1)` block. After launch it must be a new `db.version(N)`.

## 6. What stays device-only

Proposal: a table-level `sync: 'cloud' | 'device'` declaration. It would sit next to
`referenceRegistry.js` so it's one reviewable list.

- **Device-only candidates:** `expenses` (Financials). These rows point *at* cloud records
  (`event_id`, `subject_*`), and nothing in the cloud points back at them. Under the
  one-canonical-direction rule that's safe: a teammate's device never sees a dangling FK.
- **The catch, and why §9 Q2 matters:** device-only means *unprotected* again. Lose the phone
  and the financials are gone, and a second phone or a spouse won't see them. Options:
  1. Device-only, with the existing JSON/Dropbox backup kept for it.
  2. Synced, but visible to Owner only, never to Staff or Helpers, and never in a transfer.
     **This is my recommendation:** it fully meets "data protection" and still keeps
     financials private from everyone else in the kennel.
  3. Synced and end-to-end encrypted with a key only the owner holds. This is strongest
     against us, the operator, but a lost key means lost data, which is the exact failure we're
     trying to remove for non-technical users.
- **Sales also carry money** (price, deposit, balance). Decide whether "financials" means
  just the Expense ledger or also the money fields on Sale, Stud Service, and Litter.

## 7. Dog transfers between accounts

The flow the user sees:

1. Seller opens a dog and taps **Transfer to another breeder**. They enter the buyer's email
   (or scan the buyer's Kennel Card, §28.2) and tick what goes with the dog.
2. Buyer gets an email and an in-app inbox badge: "Thornfield Kennel wants to send you
   *Maple*." They tap **Accept** and the dog appears in their Dogs list with its history.
3. On the seller's side the dog departs through the **existing** departure/sale flow
   (ownership → external, or archive-on-departure in Lite). History is never destroyed.

Under the hood:

- The transfer payload is an **allow-list snapshot built by name**. It has the same security
  posture as `companionExport.js` and `fureverSeedExport.js` (positive key check, no record
  spreads). Proposed contents: the dog's identity fields, health tests, vaccinations, show
  results, selected documents (copied in R2), and the pedigree ancestors as *external* dogs.
  Never included: contacts, sale prices, internal notes, or other dogs.
- Ancestors and the breeder kennel arrive **as references the buyer can match**. The
  breeder kennel is matched by `public_id` (that's the "registry" §28 was built to allow
  later). Ancestors become external dogs, de-duplicated by a new **`dogs.public_id`** that
  works like the kennel one: minted once, write-once, and carried with the dog forever. That
  way the same sire arriving in two transfers isn't duplicated.
- The buyer's import reuses the CSV import's match-or-create rules: a dry-run preview,
  unmatched names flagged rather than invented, nothing silently merged.
- **If the recipient isn't on KennelOS:** the email link opens a Furever or Companion view,
  like today's share-outs, plus a "Start a free KennelOS account to keep this dog" call to
  action.
- **Later (not v1):** *linked dogs*. A breeder can opt into seeing new health tests the new
  owner logs, and co-owned dogs can be visible in both programs. This is genuine two-program
  shared state and should wait until v1 transfers have real use.

## 8. Phasing (each phase ships value on its own)

| Phase | Delivers | Risk |
|---|---|---|
| **1. Account + automatic cloud backup** | Sign in by email. The app pushes a backup snapshot on change, and a new phone signs in and restores. Solves data protection by itself. | Low. It reuses `exportAll`/restore unchanged and is effectively Dropbox sync without the Dropbox. |
| **2. Live multi-device sync** | Outbox, push/pull, websocket nudges. The same person's phone and laptop stay in step. | Medium. This is the core engineering. |
| **3. Team members & roles** | Invites, Staff and Helper roles, server-enforced visibility. KennelAssistant retires. | Medium |
| **4. Dog transfers** | §7 | Medium |
| **5. Account-based licensing** | Lemon Squeezy webhooks, no device slots | Low |
| **Later** | Linked dogs and co-ownership, and Furever families on accounts | Higher |

## 9. Open questions (need answers before Phase 1)

1. **Offline:** should the app keep working fully offline and sync when back online
   (recommended), or is "requires internet" acceptable?
2. **Financials:** device-only, owner-only synced (recommended), or encrypted? And does
   "financials" include sale prices and deposits, or just the Expense ledger?
3. **Editions:** which editions get cloud features? One suggestion: Lite gets Phase 1 backup,
   which is cheap and a strong reason to make an account. Pro gets sync, team, and transfers.
   Demo gets none.
4. **What travels with a transferred dog** by default, and can the seller untick items?
5. **Roles:** are Owner / Staff / Helper the right three?
6. **Existing users:** first sign-in uploads the current local data as the program (the
   proposed default). Should Dropbox sync and JSON-file transfers remain available
   afterwards, or retire?
7. **Operator obligations:** holding buyers' names, addresses and phone numbers on our
   server makes us a data processor. That means a privacy policy, a deletion-on-request path,
   and breach responsibility. Is that acceptable? (Cloudflare encrypts at rest by default;
   what remains is policy and process.)
8. **Who builds and runs the backend?** It's the first piece of this product that can go down
   at 2am.

## 10. What changes in this repo if approved

- New `cloud/` (the Worker plus Durable Object code), deployed with `wrangler`. This is the
  first build step that isn't a static copy.
- `shared/data/sync/` for the outbox, sync client, and auth session. Hooks go into
  `repoBase.js` and the few direct writers listed in §2.
- `shared/data/syncRegistry.js` for the cloud/device declaration per table (§6).
- `dogs.public_id` (§7).
- CLAUDE.md, the README, the Editions Plan (§Licensing), and the End-State guide (§2, §10,
  §26, §28) get rewritten to drop "no backend" and describe the new layer.
- `shared/sw.js`: the API is cross-origin, so the cache-first handler already ignores it.
  Only new app files need precache entries.
