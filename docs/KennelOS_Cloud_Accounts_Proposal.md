# KennelOS Cloud — accounts, sync, transfers & connections (PROPOSAL / DRAFT)

> **Status: proposal, partly decided, nothing built.** Decisions made so far are listed at
> the end of §10. It amends a founding non-negotiable ("no backend"; Editions Plan
> §Licensing; End-State guide §2): the app stays fully functional with no backend, and a
> backend becomes an **optional, removable add-on** (§2a). CLAUDE.md and those docs get
> updated when the first phase is approved for build. Open questions are in §10.

## 1. What's being asked

1. **Data-loss protection** (the primary goal — protection against *losing* data, not
   privacy from the operator). Today a kennel's entire history lives in one browser's IndexedDB.
   If the browser clears site data, the phone gets replaced, or Safari evicts storage,
   the data is gone unless the owner remembered to export a JSON file or set up Dropbox.
   Our users are mostly non-technical, so in practice many of them have no backup.
2. **Transfers without files.** Sending a dog to another breeder should be "pick the dog,
   pick the person, they tap Accept." Today it's "export JSON, email it, import it."
3. **Multi-user business.** A household or a kennel with helpers should all see the same
   records on their own phones without anyone having to sync by hand.
4. **Sensitive data stays low-risk.** Financials, buyers' details and the like should not sit
   readable on our server, but users who want them backed up should be able to. See §6.
5. **Connections between breeder friends.** Connect privately (never publicly), have each
   other's kennel and contact records created and kept current automatically, and show off
   dogs and litters to friends. See §8.

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

## 2a. The governing rule: the cloud is opt-in and removable (decided)

**Every server-backed feature is something a user turns on, and the app must keep working
exactly like today if we ever stop hosting.** The device stays the source of truth and the
cloud is an add-on, never a dependency. Concretely:

- **No sign-in required, ever, to use the app.** First run works as today. Cloud backup is
  offered prominently (first-run card, periodic reminders: "Turn on cloud backup, recommended"),
  but it is opt-in. An account is needed only for the features that inherently involve the
  server: cloud backup/vault, sync, team, connections, transfers.
- **Nothing in the core path calls the server.** Pages → repos → Dexie never waits on the
  network. Sync runs in the background against the outbox; if the server is down or gone, the
  outbox just grows and nothing else changes.
- **Everything the cloud gave you is already local.** Synced records, connection-created
  kennels and contacts, linked dogs, and accepted transfers all land as ordinary local rows.
  Losing the server loses only *future* updates, pending transfers, and the live feed.
- **The vault never holds the only copy.** Private data is decrypted and kept on the device as
  today, so a shutdown can't strand it.
- **The no-server backups stay:** JSON download/restore and Dropbox (answers the old "retire
  them?" question: no). They're the path for anyone who never opts in, and the fallback if we
  shut down.
- **Licensing must not depend on our server** (see §4). Pro keeps validating directly with
  Lemon Squeezy from the browser, as today. Account-linked licensing can be an optional
  convenience on top, never the only path. (Server-run Pro features, such as the waitlist's
  online routes, do check the license server-side. That gates only what our server does on a
  user's behalf, never whether the app itself runs as Pro.)
- **One switch removes the cloud.** All cloud code is reached through one config value, the API
  base URL in `editionConfig` (`cloudUrl`). With it `null`, no cloud UI renders and no sync runs.
  That's the shutdown build, and it's also the behavior of today's app. A test pins that the app
  boots, seeds, and runs every page with `cloudUrl: null`.
- **A graceful sunset is planned up front.** The server can send a "service ending on <date>"
  notice that the app shows in-app, prompting a JSON backup download. It's in-app only: the
  server keeps no readable account emails (§4), so there's no shutdown email. Then a final release ships
  with `cloudUrl: null`.

## 3. The Cloudflare shape

| Piece | Holds | Why this one |
|---|---|---|
| **Workers** | The API (auth, sync, transfers, license webhooks) | Cheap, and the only thing that can reach D1/R2. The editions stay on GitHub Pages and call it cross-origin (Phase 1 Plan §6) |
| **Durable Object per program** (SQLite-backed) | The authoritative record set for one account's program, an ever-increasing change sequence, and live websocket pushes to that program's devices | One object per kennel program puts every write for that program in a single queue. That gives a clean change order for "give me changes since #N" and avoids cross-tenant locking. Point-in-time recovery covers the last 30 days. |
| **D1** | Global tables: users, programs, memberships/roles, pending transfers, the `kennels.public_id` directory, license entitlements | Cross-program lookups such as "which program owns kennel `kos1_…`?" and "what's in my transfer inbox?" |
| **R2** | Documents, receipts, photos (today's `files` table blobs) | No egress fees. Large blobs stay out of the record store. |
| **Email** (Cloudflare Email Service, Resend, or similar) | Sign-in codes, transfer notices, invites | Non-technical users understand email. |

**Server record format:** one generic row per record, `(table, id, data_json, updated_at,
seq, deleted)`, rather than mirroring the 13 Dexie tables as SQL tables. The server then
doesn't need a migration every time a field is added locally, which matches the existing
"every non-indexed field still persists and rides the backup" convention.

**Rough cost:** the Workers paid plan is $5/month and includes enough Durable Object, D1, and
R2 headroom for hundreds of kennels. Real cost grows mainly with document and photo storage
(R2 is about $0.015 per GB-month).

## 4. Accounts, sign-in, programs, roles

- **Sign-in:** an emailed **6-digit code** the user types into the app, with optional
  passkeys added later. **Not a magic link:** an iPhone home-screen app has separate storage
  from Safari, and a tapped email link opens Safari, signing in the wrong copy of the app
  (Phase 1 plan §2.1). Users don't manage passwords, so there's no password reset to
  support. Account recovery is the same email.
- **No readable email on the server (decided).** The server keeps only a keyed hash of each
  account's email, enough to find the account when the user types the address again (Phase 1
  plan §6.2). Whenever the server sends an email (a sign-in code, a transfer notice, a
  connection or team invite), it sends to an address someone has **just typed** into that
  request, then discards it. The trade-off: we never email a user unprompted. Service notices
  are in-app only (§2a).
- **Program** = what one install holds today: one or more kennels (multi-kennel scope
  already exists). One program has one owner and one subscription.
- **Members and roles** (proposed):
  - **Owner** — everything, including billing and transfers.
  - **Staff** — read and write all kennel records (§6's cloud tier). No private fields in v1.
  - **Helper** — logs events against dogs only. This is today's KennelAssistant, which can
    then be retired. Helpers see the same allow-list `assistantSync.js` already enforces,
    but the server enforces it now, not just the export step.
- **Licensing stays browser-to-Lemon-Squeezy** (§2a). An optional add-on: Lemon Squeezy
  webhooks to the Worker let a signed-in user's key follow their account to a new device
  without retyping it. The webhook's customer email is hashed the same way and matched to
  the account hash, so the server still never keeps the readable address. The existing
  activation-slot/grace logic stays, because it must keep working with no server of ours.

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
- **Undo for mistakes:** the server keeps dated snapshots for 30 days (cloud tier and vault
  alike), so "restore my program as of last Tuesday" recovers a bad import or a wrong delete
  that has already synced everywhere.
- **Hard delete** becomes a tombstone so other devices drop the row. The registry-driven
  reference check still runs locally first, against the fully synced set.
- **Referential integrity across devices:** the whole program syncs, so every FK target is
  present locally. No partial-replica edge cases inside one program.
- **Schema:** `sync_outbox` plus a per-table `seq` cursor in settings. Pre-launch this can go
  in the editable `version(1)` block. After launch it must be a new `db.version(N)`.

## 6. Sensitive data: two tiers, and a private vault you can opt into

**Goal:** back up and sync as much as possible automatically, while **the server never
holds sensitive data in a form we (or anyone who breaches us) can read.** Users who want
their sensitive data backed up too can turn on an encrypted vault.

### 6.1 The two tiers

| Tier | What it is | Where it lives | Who can read it |
|---|---|---|---|
| **Kennel records** (non-sensitive) | The dogs and their history: identity, pedigree, health tests, litters, pairings, schedules | Synced to the cloud automatically, always on | The program's members. It's also the only tier a transfer can draw from. |
| **Private** (sensitive) | Other people's personal details, money, contracts, receipts, free-text notes | **On the device by default.** Optionally backed up to the cloud **end-to-end encrypted** (the vault, §6.3) | The owner only. The server sees only scrambled bytes. |

**Where the line sits (decided 2026-10-07; Phase 1 plan §5.1):** by **whose data it is**.
Other people's personal details and money are private. The breeder's **own business setup**
(her waitlist rules, application form, FAQ, the fee she charges, payment instructions) is
kennel records, because she can't run her program after a restore without it. Waitlist
applicants' **name and email** are the one third-party exception: W2's server holds them
readable anyway (`KennelOS_Waitlist_Spec.md` §8.1), so backup carries the same two fields
and nothing else from an application.

**Why this is the low-risk split:** if our server is ever breached, misconfigured, or
subpoenaed, what's exposed is pedigrees and whelping dates, not buyers' home addresses
or what they paid. It also shrinks our obligations as an operator (§10 Q7). The
sensitive tier is mostly *other people's* information (buyers, co-owners), and those
people never agreed to us holding it.

### 6.2 Classification is per field, not per table

Sensitive data is spread through otherwise ordinary records. A Sale is a useful record
for a teammate ("Maple goes home Saturday"), but its `price` isn't. So the classification
is a **positive allow-list of cloud fields per table**, in a new
`shared/data/syncRegistry.js`:

- **Any field not on the list stays private.** A new field added later stays on the device
  until someone deliberately classifies it. This is the same "silence is the safe default"
  posture as `companionExport.js`. A check (like the existing registry-coverage test) fails if
  a field seen in the sample data is unclassified, so the default never silently costs
  someone a backup without anyone noticing.
- **Locally nothing changes:** a record is still one Dexie row. Push sends only its cloud
  fields. Pull **merges** the server copy into the local row and leaves private fields
  alone. So there's no data-model split and no new FK rules, and pages don't know the
  difference.
- A few tables also need a **per-row** rule. Example: a Document filed as `health_test` or
  `pedigree` is a kennel record, but one filed as `contract` is private.

Proposed starting classification (to be reviewed field by field):

| Table | Cloud (kennel records) | Private |
|---|---|---|
| dogs | everything except → | `notes` |
| events | type, dates, title, structured `details`, related ids | `notes` (free text can hold anything) |
| litters, pairings, breed_feeding_schedules | everything except → | `notes` |
| kennels (own) | name, prefix, `public_id`, location, website, logo, preferences | none (location: cloud, **decided**) |
| contacts | `id`, `name`, `contact_type`, `public_id` (§8.5). Names in the cloud: **decided** | `email`, `phone`, `address`, `notes`, `companion_note`, `first_contact_source` |
| sales | dog, buyer link, status, placement type, dates | `price`, `deposit_amount`, balance/boarding/transport amounts, `lead_source` |
| stud_services | dogs, partner link, direction, status, dates, `fee_structure` | `fee_amount`, `pick_value_amount`, `result_notes` |
| contracts | type, status, links, dates | `document_url`, terms, any money |
| documents + files | rows with `doc_type` health_test / pedigree / registration | rows with `doc_type` contract / other |
| expenses + receipt files | none | everything (all of Financials) |

### 6.3 The private vault (opt-in, end-to-end encrypted)

> **Built 2026-10-07** as Phase 2b: `docs/KennelOS_Private_Vault_Plan.md` is the build plan
> and as-built record (all three unlock paths; no category picker in v1, its §10 decision 2;
> the vault holds full records, decision 1). Hidden behind `VAULT_RELEASED` until the
> `LAUNCH_CHECKLIST.md` §3b release.

An **"Also back up my private info"** switch, off by default, with an advanced option to
pick categories: contact details, financials, contracts & receipts, private notes.

- The device encrypts the private fields and tables (WebCrypto, AES-GCM) **before**
  upload. The server stores a scrambled blob it can't open, and keeps dated vault
  snapshots for 30 days like the kennel tier.
- **Unlocking without a password to remember:** the vault key is random and stored
  wrapped (encrypted) two ways:
  1. **By the user's passkey** (the WebAuthn PRF extension). On a new phone they sign in,
     do Face ID or a fingerprint, and the vault opens. Passkeys sync through iCloud Keychain
     and Google Password Manager, so a lost phone isn't a lost key.
  2. **By a recovery code** shown once at setup, with a "print this / save to Files" step
     that's required before the switch turns on.
  3. **By another of the owner's devices** that's already unlocked (decided 2026-10-07):
     the new device shows a short code, and the unlocked one approves it and wraps the
     vault key to the new device. This covers swapping phones while still having a laptop,
     without the recovery code.
- **How it's offered (decided 2026-10-07; Phase 1 plan §5.1):**
  - inside "Turn on cloud backup", not hidden in settings;
  - strongly suggested for anyone using the waitlist, and **required before the
    waitlist's W2**;
  - the backup status shows kennel records and private info as two separate lines, so
    nobody mistakes cloud backup for "everything".
- **The honest trade-off, said plainly in the UI:** if they lose their passkey *and* their
  recovery code, *we cannot open the vault*. That only costs data if they've **also** lost
  every device holding the local copy. The vault is a second copy, never the only one.
  This is why it's opt-in, and why it never applies to kennel records.
- **Deliberately not offered (reaffirmed 2026-10-07):** backing up private info
  *unencrypted*, or encrypted with a key *we* hold, to our server. It would be easier to
  recover, but it puts us back to holding readable personal data, which is the thing this
  design avoids. **The fallback, decided in advance:** if support requests show real users
  locked out despite passkey sync, the recovery code *and* second-device unlock, the answer
  is a per-user opt-in, "Let KennelOS help me recover my private info (less private)". It is
  never a change to the default.

### 6.4 Protecting private data that *isn't* in the vault

If the vault is off, the private tier is exactly as fragile as the whole app is today.
So the app keeps working at it:

- Request persistent storage (`requestPersistentStorage()` already exists).
- Keep the existing JSON download and Dropbox backup. Their reminder now refers only to
  private info: "Your contacts' details and financials are only on this phone. Last
  backed up 40 days ago." Each reminder also offers the vault.
- **A restore without the vault is still usable.** Every record comes back. Sales still
  show the buyer's name and the dog; the private fields are just blank, with a "private
  details are on your other device / in your vault" hint.

### 6.5 What this means for teams and transfers

- **Transfers** draw only from the cloud tier, so nothing sensitive can cross between
  accounts, by construction. The transfer allow-list (§7) is a subset of the cloud
  allow-list.
- **Staff and Helpers** see kennel records only. Sharing private fields with Staff (for
  example a buyer's phone number for pickup day) means sharing the vault key with that
  member's device. That's possible later (wrap the key to each member), but it's **not v1**.
  In v1 the owner's devices are the only ones that see private fields.

## 7. Dog transfers between accounts

The flow the user sees:

1. Seller opens a dog and taps **Transfer to another breeder**. They enter the buyer's email
   (or scan the buyer's Kennel Card, §28.2) and tick what goes with the dog.
2. Buyer gets an email and an in-app inbox badge: "Thornfield Kennel wants to send you
   *Maple*." They tap **Accept** and the dog appears in their Dogs list with its history.
   (The email goes to the address the seller just typed, once, and the pending transfer is
   keyed by its hash (§4). Reminders after that are the in-app badge only.)
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

## 8. Connections (breeder friends)

Breeders in this market are often a close circle of friends who already trade dogs, stud
services, and advice. A **Connection** is a mutual, consented link between two kennel
programs. Once two breeders are connected, the app does the paperwork of knowing each other:
each side's kennel and contact records are created and kept current automatically, and each
can show off what they choose to the other. None of this is ever public.

This is the networked version of the Kennel Card (End-State guide §28.2), and it keeps the
card's rules. Identity is keyed on `public_id`. Everything leaving a program is a named
allow-list. A card can never make itself one of *your* kennels. A received kennel can be
offered as a link to one you typed in yourself, but is never matched by name automatically.

### 8.1 Connecting

- **Ways to connect,** in order of how non-technical users will actually do it:
  1. **An invite link** sent by text or Messenger ("Join me on KennelOS"). It works whether or
     not the friend has an account yet; if not, it signs them up for free Lite first.
  2. **A QR code** shown phone-to-phone at a show or a visit.
  3. **By email** from inside the app (sent once to the typed address, which isn't kept; §4).
- **Both sides must accept.** Nothing is shared until they do.
- **No public directory and no search in v1.** You can only connect with someone who handed
  you a link or code, or whose email you already know. That matches "intimate group of
  friends", and nobody can be found by strangers. ("People you may know: connected to 3 of
  your friends" is a possible later step, and only if it's opt-in.)
- **Disconnect or block at any time.** Updates stop flowing both ways. The kennel and
  contact records already on each side **stay** (soft data never cascades and history is
  never destroyed); they lose their "connected" badge and stop auto-updating.

### 8.2 The breeder profile: what a connection gives you automatically

Each program has one **profile**: the information its owner chooses to give their
connections. It is self-published, the breeder's own data shared about themselves, so it
doesn't carry the third-party privacy concern of §6.

| Profile field | Lands on the friend's side as |
|---|---|
| kennel name, prefix, location, website, logo, breeds | an **outside Kennel** (`public_id` linked, `is_own_kennel` forced false, same as card import) |
| breeder's name | a **Contact** (`contact_type` breeder), affiliated to that kennel |
| phone, email: **each opt-in, off by default** | that Contact's private fields (on the friend's device, or in their vault) |

- **Live, not a snapshot:** when a friend updates their profile (new logo, moved, new
  phone), your linked kennel and contact update too. The connection owns those fields;
  your own notes and anything else on the records stay yours and are never overwritten.
- **First connect runs the same preview as a card import:** "Create Thornfield Kennel as a
  new kennel" or "Link to the *Thornfield Kennels* you typed in last year". The link option
  is offered, never automatic, so everything already pointing at the hand-typed record keeps
  pointing at it.

### 8.3 Showing off, to connections only

Opt-in per item, never by default. Each dog or litter gets a **Share with connections**
switch, and what's shared appears in your connections' **Friends feed**.

- **Dog cards:** photo, call/registered name, breed, sex, titles, health test results, show
  wins, and pedigree (via `dogs.public_id`). It's a *live projection*, so a new health test or
  title updates the card. Never shared: owner/buyer, prices, notes, or anything else from §6's
  private tier.
- **Milestone posts,** generated from events on shared dogs and confirmed with one tap before
  posting: "Maple finished her Championship", "Juniper × Ash: 6 puppies born", "OFA Hips:
  Excellent".
- **Availability flags** (optional): "at stud", "planned litter", "puppies available". This is
  the practical side of showing off, because friends breed to each other's dogs.
- **Reactions** (a paw or heart) are the only interaction in v1. Comments and DMs are
  deliberately out: they bring moderation burden, and these friends already text each other.

### 8.4 What connections make easier elsewhere

- **Transfers (§7):** pick the recipient from your connections instead of typing an email. The
  buyer's side already has the right kennel and contact, so nothing needs matching.
- **Stud services and pedigrees:** on a friend's shared dog, **"Add to my records"** creates an
  *external* Dog keyed by its `public_id`, with pedigree ancestors included. It's a **linked
  dog** in read-only form: when the friend logs a new health test or title, your copy updates.
  This is the first useful slice of §7's "linked dogs", one-way and opt-in by the owner.
  Duplicates are prevented by `public_id`: if a friend's sire arrives through a transfer and
  again from their feed, it's the same record.
- **Stud service records:** a stud service with a connected breeder's dog can prefill
  partner, partner kennel, and partner dog from the connection.

### 8.5 Editions (decided)

- **Lite:** connect, profile, friends feed, and the connection-created outside kennel and
  contact. **Lite users have accounts**, which also carry Lite's cloud backup and vault
  (decided, §10). The Lite cap is unaffected: it counts owned and
  co-owned dogs only, and a connection creates no dogs.
- **Lite needs its own surface for this.** The Kennels list and the Kennel Card UI are
  Pro-only today, so the connections page, invite/QR flow, and feed must live in
  `shared/` (not `pro/`). The connection-created outside kennel has to be viewable from the
  contact in Lite.
- **Pro adds:** transfers to a connection (§7) and "Add to my records" linked dogs (§8.4).

### 8.6 How it fits the data rules

- **Server (D1):** `profiles` (one per program, the allow-listed fields), `connections`
  (program A, program B, status: pending / accepted / blocked, who invited), and
  `shared_items` (the dog-card projections and posts, each built field-by-field from the
  cloud tier).
- **Every outbound piece is an allow-list builder,** like `kennelCard.js`/`companionExport.js`,
  with an `assertOnlyKeys` positive check. The profile and shared-item allow-lists are
  **subsets of the cloud tier** (§6.2), so private-tier data can't reach a friend even through
  a bug in the list itself.
- **Local schema:** `contacts` gains a `public_id` (the connection-linked breeder, write-once,
  same rules as `kennels.public_id`). `dogs.public_id` is already proposed in §7. Neither is an
  FK, so neither needs a `referenceRegistry` entry. Connection state itself lives server-side
  only; the device asks for it rather than storing a back-pointer.
- **Reads of friends' data are online-only** (the feed, browsing their dogs). Anything you've
  *added to your records* is local and works offline like everything else.

## 9. Phasing (each phase ships value on its own)

| Phase | Delivers | Risk |
|---|---|---|
| **1. Account + automatic cloud backup** (build plan: `KennelOS_Cloud_Phase1_Plan.md`) | **Opt-in** (§2a): turn on cloud backup, sign in by email. The app pushes a **cloud-tier** backup snapshot on change, and a new phone signs in and restores. Covers the bulk of the data-loss goal. | Low. It builds on `exportAll`/restore, filtered through `syncRegistry.js`. The classification has to land here, first, so private data never reaches the server even once. |
| **2b. Private vault — moved up (decided 2026-10-07); built 2026-10-07** | §6.3. Passkey + recovery code + second-device unlock, encrypted private-tier backup (`KennelOS_Private_Vault_Plan.md`; released behind `VAULT_RELEASED`). **Scheduled directly after Phase 1**, ahead of 2–4: the waitlist depends on it (its W2 keeps the application key in the vault, `KennelOS_Waitlist_Spec.md` §8.2), and until it exists the only copy of contact details, family fees and full applications is the device plus file backups (Phase 1 plan §5.1). | Medium. Crypto is standard WebCrypto, but the recovery UX must be tested on real non-technical users |
| **2. Live multi-device sync** | Outbox, push/pull, websocket nudges. The same person's phone and laptop stay in step. | Medium. This is the core engineering. |
| **3. Team members & roles** | Invites, Staff and Helper roles, server-enforced visibility. KennelAssistant retires. | Medium |
| **4. Dog transfers** | §7 | Medium |
| **4b. Connections** | §8. Invite/QR/email connect, profile → auto kennel + contact, the feed, then "add to my records" linked dogs | Medium. Mostly allow-list builders plus a feed. Low data risk because everything shared is already cloud tier |
| **5. Optional account-linked license** | Webhooks so a key follows a signed-in account; browser validation stays the base path (§2a). **The webhook → Worker link is brought forward** as a prerequisite of the waitlist's W2, used only to gate the server-side waitlist routes (`KennelOS_Waitlist_Spec.md` §8.5, §12); plan: `KennelOS_License_Link_Plan.md` (server half built 2026-10-07). | Low |
| **Later** | Two-way linked dogs and co-ownership, optional "people you may know", and Furever families on accounts | Higher |

## 10. Open questions (need answers before Phase 1)

1. ~~Offline~~ (decided below).
2. **Tiers (§6):** does the two-tier split match her instincts? Anything in the cloud column she
   considers sensitive, or anything private she'd want teammates to see?
3. ~~Editions~~ (decided below).
4. **What travels with a transferred dog** by default, and can the seller untick items?
5. **Roles:** are Owner / Staff / Helper the right three?
6. **Existing users:** turning on cloud backup uploads the current local data as the program
   (proposed default). (Keeping Dropbox and JSON: decided, they stay, §2a.)
7. **Operator obligations:** with §6, the server holds contact *names* (and waitlist
   applicants' names and emails, which W2 holds anyway) but not addresses, phones, or
   payments, the vault only as scrambled bytes, and account emails only as keyed
   hashes (§4). We'd still need a privacy
   policy and a delete-my-account path, but breach exposure is much smaller.
8. **Who builds and runs the backend?** It's the first piece of this product that can go down
   at 2am.

**Decided:**
- **Offline-first,** and **every cloud feature is opt-in and removable;** the app must run
  exactly like today with no server (§2a).
- Contact names are in the cloud tier; kennel location is in the cloud tier.
- **Privacy vs. recoverability (2026-10-07; Phase 1 plan §5.1):**
  - the line is drawn by whose data it is;
  - her waitlist setup and the list's running state are cloud;
  - waitlist applicants' name and email are cloud, and nothing else from an application
    is;
  - the vault moves to right after Phase 1, with a second-device unlock;
  - no readable private data on our server stays the default, with a per-user
    opt-in recovery switch as a fallback only if lock-outs show up in support.
- **Account emails are stored only as keyed hashes** (§4). Codes, transfer notices and invites
  go to an address typed in that request; nothing emails a user unprompted, and service
  notices are in-app only.
- **Connections are free in Lite:** connecting, the breeder profile, and the friends feed.
  Transfers to a connection and "Add to my records" linked dogs stay Pro.
- Sharing to connections is **opt-in per dog/litter**, and milestone posts need a **one-tap
  confirm**; nothing auto-posts.
- **Data-loss protection is the same in Lite and Pro:** Lite gets Phase 1
  cloud backup of kennel records **and** the private vault (§6.3), exactly as Pro does.
  Protecting a user's data is never an upsell. Pro's paid additions are multi-device live
  sync, team members, transfers, and linked dogs. Demo gets none of the cloud features.
  Consequence for the build: the sign-in, backup-status, vault setup, and restore UI must
  live in `shared/` and stay out of `proPages.js`. (Today's Dropbox section on
  Import/Export is Pro-gated; the cloud equivalent must not be.)

## 11. What changes in this repo if approved

- `cloudUrl` in every `editionConfig` (and the every-flag-declared test), gating all cloud
  code and UI (§2a), plus a no-server boot test.
- New `cloud/` (the Worker plus Durable Object code), deployed with `wrangler`. This is the
  first build step that isn't a static copy.
- `shared/data/sync/` for the outbox, sync client, and auth session. Hooks go into
  `repoBase.js` and the few direct writers listed in §2.
- `shared/data/syncRegistry.js`, the per-field cloud allow-list plus the per-row rules (§6.2),
  with a coverage test.
- The vault (§6.3), as built: `shared/data/cloud/vaultCrypto.js`, `vaultKeyStore.js`,
  `vaultPasskey.js` and `cloudVault.js` (Private Vault Plan §3.1).
- `dogs.public_id` (§7) and `contacts.public_id` (§8.5).
- `shared/data/connectionProfile.js` and `sharedItems.js`: the allow-list builders for §8.
- CLAUDE.md, the README, the Editions Plan (§Licensing), and the End-State guide (§2, §10,
  §26, §28) get rewritten to drop "no backend" and describe the new layer.
- `shared/sw.js`: the API is cross-origin, so the cache-first handler already ignores it.
  Only new app files need precache entries.
