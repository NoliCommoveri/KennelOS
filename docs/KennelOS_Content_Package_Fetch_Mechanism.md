# KennelOS — Content Package Fetch Mechanism

> **Status: built (2026-07-24), OAuth-write path.** The mechanism described below — the
> Furever-side fetch (§4.4) and the KennelOS-side connect/publish flow (§4.1/§4.2) — is now
> implemented, following the owner's 2026-07-24 decisions (documents-only payload; fetch on
> first open **and** every resend; "do as much as possible from KennelOS, including creating
> the Drive folders and dropping the generated manifest in") and the settled §7 decisions
> (OAuth-write primary, manual fallback **documented only, not built** — see §7 decision 1;
> documents stay dog-scoped with a bulk-add picker; a sensitive-doc warning + per-doc opt-in
> on publish). See §8 for exactly which files landed. **Not yet browser/round-trip verified
> against a real Google account** — no live OAuth consent flow or Drive API round trip has
> been exercised in this environment; verify end-to-end before relying on it in production.
>
> **§5.1: the one-time Google Cloud setup is done** (owner, 2026-07-24) — Cloud project, Drive
> API, OAuth consent screen (`drive.file` only), both credentials created + restricted, both
> recorded in code (§5.1/§5.2).

---

## 0. TL;DR

A breeder puts documents (health guarantee, registration how-to, pedigree, litter health
records, a care-guide PDF…) into Google Drive folders. At Furever share-out the breeder
**tags which folders apply to this pup** — always the one **kennel-wide** folder plus this
pup's **litter** folder. The texted seed link stays tiny: it carries only *pointers* to a
small **manifest file** in each folder, never the files themselves (files are far over the
~1.7K text budget — brief appendix). On first open, and again on every resend, **Furever**
fetches each manifest with a public read-only API key, then fetches each listed file, and
lands them in the pet's **document vault** as read-only "From your breeder" documents,
cached offline thereafter.

The breeder does as much as possible **from inside KennelOS**: they connect Google Drive
once, and KennelOS creates the folders, uploads the tagged files, writes the manifest JSON,
and sets the public-link sharing — all through the browser, no backend.

Two sides, two Google credentials:

| Side | Who | Credential | What it can do |
|---|---|---|---|
| **Breeder** (KennelOS Pro, Furever console) | the breeder, once | **OAuth token** (Google Identity Services, `drive.file` scope) | create/upload/share **only files this app made** in the breeder's own Drive |
| **Family** (Furever app) | nobody — automatic | **public API key** (baked into the build, referrer-restricted) | read the publicly-shared manifest + files by ID |

---

## 1. Why Drive, and why this shape

- **The files are too big to text.** A per-pup seed packet is ~1.7K compressed; care-guide
  prose alone is ~1.5K *per page*, and PDFs are far bigger (brief appendix). So the payload
  can't ride the link — only *pointers* can. Drive is the transport/CDN; the link stays a text.
- **No family account, ever.** Google Drive's API host (`googleapis.com/…?alt=media`) is
  CORS-open and serves a publicly-shared file to an anonymous caller holding only a public
  API key (brief appendix verified this for a *known file ID*). The family never signs in.
- **Manifest, not live folder-listing.** We deliberately fetch **one known manifest file per
  folder** (its Drive file ID is in the seed packet) rather than calling `files.list` on the
  folder. Anonymous `files.list?q='<folderId>' in parents` *can* work for an "Anyone with the
  link" folder, but link-shared items can additionally require a **resourceKey** (Google's
  2021 security change) and the listing surface is fragile. Fetching a known file ID by manifest
  is the robust path **and** it's exactly what "KennelOS generates the JSON and drops it in"
  produces — so the owner's automation goal and the reliable transport are the same choice.
- **Backend-less on both sides.** Mirrors the existing zero-backend integrations: the family
  read key is one baked-in public key (like `dropbox.js`'s `APP_KEY`), and the breeder write
  side uses Google Identity Services' **token model** — browser-only, CORS-supported, access
  token only, **no client secret** and **no backend**. The `drive.file` scope is
  **non-sensitive**, so publishing the OAuth app needs **no Google verification review**.

---

## 2. The two-sided architecture

```
  BREEDER SIDE  (KennelOS Pro — shared/pages/furever.*, Pro-only)
  ────────────────────────────────────────────────────────────────
   1. Connect Google Drive         GIS token client, scope drive.file  → 1h access token
   2. Ensure folder tree           files.create (folders) in breeder's own Drive
        KennelOS Furever/
          Kennel-wide/             ← one, shared by every pup from this kennel
          Litter — <nickname>/     ← one per litter
   3. Upload tagged documents      files.create (multipart) → fileId (+ resourceKey)
   4. Share for public link        permissions.create {type:'anyone', role:'reader'} on the folder
   5. Write manifest (pack.json)   files.create/overwrite → manifestFileId (+ resourceKey), bump version
   6. Persist pack pointers        kennel-wide → Furever settings; litter → litterRepo field

                     │  breeder sends the Furever seed link (existing flow)
                     ▼
   seed packet gains  contentPackages: [ {kennel pack pointer}, {this pup's litter pack pointer} ]
                     │  (pointers only — fileIds + resourceKeys + version; NO key, NO file bytes)
                     ▼
  FAMILY SIDE  (Furever — furever/…)
  ────────────────────────────────────────────────────────────────
   on first open + every resend:
   A. for each pack pointer:  fetch manifestFileId  (files/{id}?alt=media&key=PUBLIC_KEY  [+resourceKey])
   B. if manifest.version > cached:  fetch each listed file → Blob
   C. store Blob in `files`, upsert a read-only `documents` row (source='breeder', pack_key, drive_file_id)
   D. drop breeder docs for that pack_key that are no longer in the manifest
   E. cache manifest meta (content_packs: pack_key, version, fetched_at)
      — all wrapped so an offline/failed fetch never breaks boot; retried next open
```

The **manifest** is the contract between the two sides. Named-copy discipline applies to the
seed-packet additions exactly as in `fureverSeedExport.js`/`companionExport.js` (build the
fields by name; a new Dog/Sale/Litter field never rides along silently).

---

## 3. Data shapes

### 3.1 Manifest file (`pack.json`, one per folder, hosted in Drive)

```jsonc
{
  "packVersion": 1,                 // manifest FORMAT version (bump only on breaking shape change)
  "packKey": "5f3c…",               // stable UUID per (kennel, scope): one for kennel-wide, one per litter
  "scope": "kennel",                // "kennel" | "litter"
  "kennelName": "Thornfield",
  "version": 3,                     // CONTENT version — bumped each republish; Furever skips re-download when unchanged
  "updatedAt": "2026-07-24T12:00:00Z",
  "parentDogIds": ["d1a2…", "d3b4…"], // scope:"litter" ONLY — the litter's sire/dam Dog ids, shared with every pup
  "files": [
    {
      "fileId": "1AbC…",            // Drive file ID (public-by-link)
      "resourceKey": "0-xY…",       // present only when Drive assigned one; passed on fetch, else omitted
      "title": "Health Guarantee",
      "docType": "contract",        // maps to Furever documents.doc_type vocab
      "mime": "application/pdf",
      "size": 128374,
      "dogId": "d5c6…"               // scope:"litter" ONLY — the Dog this document was filed on
    }
  ]
}
```

**Per-pup scoping (scope:"litter" only).** The manifest is one shared file for
the whole litter (one Drive folder, one `pack.json`), but every pup's Furever
app fetches the SAME manifest and must not show every OTHER pup's documents.
Each file therefore carries the `dogId` it was filed on; a document filed on
the litter's sire or dam is additionally listed in `parentDogIds` and is shared
with every pup's family, but a document filed on one specific pup is filtered
OUT of every other pup's family view. The filter runs client-side, after
fetch, in `furever/data/contentPackFetch.js`'s `filesForThisPup(manifest,
pupId)` — `pupId` is the family's `pet.pup_id`, the same breeder-side Dog id
`dogId`/`parentDogIds` are stated in. A `scope:"kennel"` manifest carries no
`dogId`/`parentDogIds` at all and is never filtered — it is deliberately the
SAME for every family (a breed care guide, a blank guarantee template), so
there is nothing to scope.

### 3.2 Seed-packet addition (emitted by `shared/data/fureverSeedExport.js`)

```jsonc
"contentPackages": [
  { "packKey": "5f3c…", "scope": "kennel", "manifestFileId": "1KwD…", "manifestResourceKey": "0-aa…", "version": 3 },
  { "packKey": "9b21…", "scope": "litter", "manifestFileId": "1LtE…", "manifestResourceKey": "0-bb…", "version": 1 }
]
```

- **No API key and no file bytes in the packet** — only public pointers. Adds ~150–250
  compressed chars to the ~1.7K packet; still comfortably textable.
- The public read key lives **once** in the Furever build (§5.2), never in the link.
- Only packs that are actually configured are included (an unpublished kennel/litter pack is
  simply absent — the pup just has no breeder docs).

### 3.3 Furever storage (documents-only decision → reuse the vault, repurpose `content_packs`)

Fetched files land in the **existing** `documents` + `files` vault, kept separable from the
family's own uploads exactly like the seed/family layer split the schema doc emphasizes:

- **`documents`** gains three plain (unindexed) fields on breeder-sourced rows:
  `source` (`'self'` default | `'breeder'`), `pack_key`, `drive_file_id`. Family uploads stay
  `source:'self'` and are **never** touched by a fetch. Breeder rows for a `pack_key` are
  replaced wholesale on a version bump (blind replace of the breeder layer — same discipline
  as `petRepo.upsertSeededPet`). Breeder docs render read-only in a "From your breeder" group;
  **no in-place edit and no family Remove** (settled — a Remove would just re-appear on the next
  resend, which reads as a bug; family owns only `source:'self'` docs).
- **`content_packs`** is **repurposed** from the old care-overlay cache to the **manifest
  cache**: `{ id, &pack_key, kennel_name, scope, version, fetched_at }` (drop `payload`). It
  records "which version of which pack we've already fetched" so §2-B can skip unchanged packs.
  The actual bytes live in `files`; each fetched file is a `documents` row linked by `pack_key`
  + `drive_file_id`. (`contentPackRepo.upsert` already keys on `pack_key` — extend, don't add
  a table.)
- **`pets.content_pack_key`** — the schema already has this single-pack pointer; generalize to
  the `contentPackages` array on the pet's `seed`, or keep `content_pack_key` for the kennel
  pack and add `litter_pack_key`. (Build detail; either is additive.)

### 3.4 Breeder-side pointers (KennelOS Pro)

- **Kennel-wide pack** → `getFureverSettings()`/`setFureverSettings()` in
  `shared/data/settings.js` (`kennelOS.furever`): `{ packKey, folderId, manifestFileId,
  manifestResourceKey, version, selection }`, plus the connected-Drive token state.
- **Per-litter pack** → a plain, unindexed field group on the **litter** record
  (`litterRepo`): `furever_pack = { packKey, folderId, manifestFileId, manifestResourceKey,
  version, selection }`. Additive; no new index, no `referenceRegistry` entry (it points *out*
  to Drive, not at a KennelOS entity).
- **`selection`** is what makes republish pre-checked and keeps the picker (§4.2) fast without
  reshaping the `documents` table: `{ documentIds: [...KennelOS doc IDs...], uploads: [{ title,
  docType, drive_file_id, resourceKey }] }`. `documentIds` are the dog-scoped documents the
  breeder ticked; `uploads` are files pushed straight to Drive that aren't filed on a dog (a care
  guide, a poison list). The Drive **manifest is the authoritative file list**; `selection` is
  just the cached UI state so the next Publish opens with the right boxes already ticked.

---

## 4. The flows in detail

### 4.1 Breeder: connect Drive (once)

- A **"Connect Google Drive"** button in the Furever console, same UX slot as Dropbox's
  Connect. Loads Google Identity Services (`https://accounts.google.com/gsi/client` — **must be
  vendored**, per the no-CDN rule) and calls `google.accounts.oauth2.initTokenClient({
  client_id, scope: 'https://www.googleapis.com/auth/drive.file', callback })`.
- Clicking requests an access token (a Google consent popup the first time). Token is
  ~1 hour, **access-token-only** (no refresh token without a backend). Held in memory for the
  publish session; a later publish re-requests a token — silent (`prompt: ''`) when the
  breeder's Google session is still live, otherwise a quick re-consent.
- **Token lifetime is fixed at ~1 hour by Google — not configurable, and not a deadline the
  breeder races.** A token matters only *while a publish is running* (seconds), so 1 hour is far
  more than one publish needs. If a token has expired by the time a Drive call fires (breeder
  connected then stepped away, or a large multi-file upload runs long), the call returns `401`;
  the client **re-requests a token and retries** — the same 401-retry `dropbox.js` already does.
  The re-request is **silent** when the Google session is still live, a one-click re-consent
  otherwise. **No refresh token exists to renew silently in the background**, so we always
  acquire/refresh the token *at* publish time (a token grabbed only at "Connect" may already be
  stale). Because publish is **re-runnable** — folders reused by cached ID, files upserted by
  `drive_file_id`, manifest overwritten wholesale — a re-auth-and-retry resumes cleanly with no
  partial-publish or data loss. Worst case for the breeder: one extra click.
- `drive.file` means KennelOS can see/manage **only files it created** — it cannot read the
  breeder's other Drive files. State this in the UI; it's a privacy selling point.

### 4.2 Breeder: publish a package

Triggered by a **"Publish to Furever"** action per scope (kennel-wide; and per litter on the
litter page / console). With a live token:

1. **Ensure folders.** If no `folderId` cached for this scope, `files.create` a folder
   (`mimeType: application/vnd.google-apps.folder`) under a root "KennelOS Furever" folder;
   cache the ID. Reuse on republish.
2. **Choose documents — a bulk-add picker** (settled: documents stay **dog-scoped**; no new
   per-litter/kennel document store). The picker never makes the breeder add files one at a time:
   - **Litter pack** — the candidate pool is every document filed on the dogs **connected to this
     litter**: its pups (`dogRepo` where `litter_id` = this litter) **and** the sire + dam
     (`litter.sire_id`/`dam_id`), each via `documentRepo.getByDog`. They're shown grouped by dog
     with **bulk selectors**: a master "select all", a **per-type** toggle ("add every
     registration", "add every health test"), and per-dog "select all". So "add all 8 pups'
     registrations" is one click, not eight.
   - **Kennel-wide pack** — same picker over **any** dog's documents (for reusable material like a
     breed care guide filed on a representative dog), **plus** an **"Upload new"** affordance for
     kennel-level files that aren't filed on a dog at all (care guide, poison list, blank
     guarantee template). Uploaded-new files go straight to Drive (§4.2-3) and are tracked in the
     pack's `selection.uploads`, never forced into the dog-scoped `documents` table.
   - The picker **pre-checks** from the pack's cached `selection` (§3.4), so republishing after
     adding one pup's paperwork is: open Publish → the prior set is already ticked → tick the new
     one → Publish.
   - **Sensitive-doc guard** (settled): each candidate shows its `doc_type`; anything that
     typically carries buyer PII (a signed `contract`) is **unchecked by default** and, if ticked,
     requires an explicit "this will be publicly readable by link" confirmation before it's
     included. The publish summary restates what's about to become public.
3. **Upload** each chosen file's bytes to the scope's folder (`files.create` multipart);
   capture `fileId` (+ `resourceKey` from the response). Skip files already uploaded at the
   same content (track by `drive_file_id`), so republish is incremental.
4. **Share** the folder public-by-link once: `permissions.create` `{type:'anyone',
   role:'reader'}`. Children inherit, so every file + the manifest become link-readable.
5. **Write the manifest.** Build `pack.json` (§3.1) by name from the chosen files, **bump
   `version`**, and `files.create`/overwrite it in the folder; capture its `manifestFileId`
   (+ resourceKey).
6. **Persist pointers** (§3.4). Done — the next seed link for any pup in scope carries them.

### 4.3 Seed-link send (existing flow, extended)

`fureverSeedExport.buildSeedPacket(dog, sale)` additionally reads the kennel-wide pointer
(settings) and this dog's litter pointer (`litterRepo` via `dog.litter_id`) and emits
`contentPackages` (§3.2), named-copy only. Everything else about the send (mailto/sms/copy,
size ceilings) is unchanged.

### 4.4 Family: fetch (first open + every resend)

A new `furever/data/contentPackFetch.js`, called from `app.js boot()` **after**
`consumeSeedLink()` applied the packet (so the pet + its `contentPackages` exist):

1. For each pointer in the pet's `contentPackages`: `GET
   https://www.googleapis.com/drive/v3/files/{manifestFileId}?alt=media&key={PUBLIC_KEY}` with
   header `X-Goog-Drive-Resource-Keys: {manifestFileId}/{manifestResourceKey}` when present.
   Parse → validate manifest shape (friendly failure, never a hard boot error).
2. If `manifest.version` ≤ the cached `content_packs.version` for this `pack_key`, **skip**.
3. Else for each `files[]` entry: `GET files/{fileId}?alt=media&key=…` (+ resourceKey) → Blob →
   `fileRepo` row → upsert a `documents` row (`source:'breeder'`, `pack_key`, `drive_file_id`,
   `doc_type`, `title`, `doc_date` = manifest `updatedAt`).
4. Remove breeder `documents` (and owned `files`) for this `pack_key` whose `drive_file_id`
   is no longer in the manifest.
5. Update the `content_packs` cache row (`pack_key`, `version`, `fetched_at`, `kennel_name`,
   `scope`).
6. **Resilience:** the whole thing is best-effort and online-only. Offline / any fetch error →
   leave the cache as-is, surface nothing fatal, retry on the next open. Runs after the app is
   already usable, never blocking first paint.

**No family-side clock.** The breeder's ~1h OAuth token (§4.1) is a **breeder-only** limit that
matters only during a publish; it has **nothing to do with how long the family has to click the
link.** The seed link itself never expires (it's a static payload pointing at public Drive
files), and the family read key is a permanent public key, not a token. A family can open the
link any time — the only things that would make a late click come up short are the breeder
*deleting* the files or *un-sharing* the folder, not any timeout. A late click simply fetches the
**current** published version. (If the family opens a link before that pack was published, its
pointers aren't in the packet yet, so the pup shows no breeder docs until a later open after
publish.)

**Resend semantics** (owner's "first open + every resend"): a resend re-applies the seed
(refreshing `contentPackages`), and the fetch re-runs; the `version` check makes an unchanged
pack a cheap no-op, and a bumped pack replaces its breeder docs in place. The family's own
documents (`source:'self'`) are never involved.

---

## 5. Every credential + setup step ("record all the pieces")

### 5.1 Owner one-time setup — Google Cloud (like registering the Dropbox app once)

**Status: done (2026-07-24).** Steps 1–5 below are complete; the owner confirmed both
credentials' restrictions are set (API key: HTTP referrer + API restriction; OAuth client:
JS origins). Left as a numbered list because it's also the recipe for rotating either
credential later, not just the original setup log.

1. **Create a Google Cloud project** (e.g. "KennelOS").
2. **Enable the Google Drive API** on it.
3. **OAuth consent screen:** User type **External**; app name/logo/support email; scope list =
   **`.../auth/drive.file` only** (non-sensitive → **no verification review**, no security
   assessment). **Publish the app to Production** so it isn't capped at 100 test users; because
   the scope is non-sensitive, production publishing is immediate.
4. **OAuth 2.0 Client ID**, type **Web application**. Authorized **JavaScript origins** =
   KennelOS Pro origin + Demo origin (whichever ship the console) + `http://localhost:8000`
   for dev. (Token model uses JS origins, **no redirect URIs**.) → yields the **OAuth client
   ID** baked into the KennelOS build. **No client secret is used or stored.**
5. **API key** (separate credential), restricted two ways:
   - **Application restriction:** HTTP referrers = `https://furever.kennelos.app/*` (+
     `http://localhost:8000/*` for dev).
   - **API restriction:** Google Drive API only.
   → yields the **public read key** baked into the **Furever** build.
6. Record both in the builds the same way `dropbox.js` records `APP_KEY`: OAuth client ID in a
   KennelOS module (breeder side), API key in a Furever module (family side). Both are **public
   by design** — the referrer/origin restrictions and the read-only-of-already-public scope are
   the actual control, not secrecy.

> Deploy-config parity with the existing launch tasks: this joins the Lemon Squeezy /
> Dropbox / domain items in `README.md` § Next and `build/README.md` as an
> owner-does-once external prerequisite.

**Recorded values (2026-07-24)** — the source of truth is the code in §5.2; copied here
only so a new session doesn't have to open those files to see what's configured. Both are
public by design (see § 6) — the restrictions above are the actual control, not secrecy.

- OAuth 2.0 Client ID: `566763436944-k7rk72avivr1qg5nd7sn1fhbbg0343r2.apps.googleusercontent.com`
- API key: `AIzaSyBvoty8PqxHv6KaZ3le_H0LNHYW9KhpZIk`

### 5.2 Where the credentials live in code

| Credential | Build | Home | Precedent |
|---|---|---|---|
| OAuth client ID (`drive.file`) | KennelOS (`shared/`, Pro console) | `shared/data/googleDrive.js` — `CLIENT_ID` const (done) | `dropbox.js` `APP_KEY` |
| Public Drive API read key | Furever (`furever/`) | `furever/data/contentPackFetch.js` — `API_KEY` const (done) | brief appendix |
| GIS library `gsi/client.js` | KennelOS | **vendored** into `shared/vendor/gsi/client.js`, listed in `sw.js` `PRECACHE_URLS` (done) | no-CDN rule |

`googleDrive.js` and `contentPackFetch.js` now hold the full connect/publish/fetch logic
described in §2–4, not just the credential consts (§8 lists every file).

### 5.3 Breeder per-kennel steps (in-app, minimal)

1. Open the Furever console → **Connect Google Drive** (one Google consent).
2. **Publish** the kennel-wide pack (pick docs / upload the care guide, hit Publish).
3. Per litter: **Publish** that litter's pack (pick the litter's docs).
   *(KennelOS creates the folders, uploads, shares, and writes the manifest — the breeder never
   touches Drive directly. A no-OAuth manual fallback exists — § Decisions (settled), decision 1.)*

### 5.4 Family steps

**None.** The docs appear in the pet's document vault on first open and refresh on resend.

---

## 6. Privacy & security

- **Public-by-link is real.** Anything published is readable by anyone who has the file ID (in
  the link). Fine for a care guide, breed info, pedigree, a blank guarantee template — **not**
  for a signed contract carrying buyer PII. The console **warns on publish** and requires an
  explicit per-doc opt-in for anything sensitive — `contract`-type docs are unchecked by default
  and need a "this becomes publicly readable by link" confirmation to include (settled; see §4.2-2).
- **`drive.file` is least-privilege.** KennelOS can only ever see files it created; it cannot
  read the breeder's wider Drive. Good posture and worth stating in-app.
- **API key is referrer-restricted + Drive-only.** Its worst case is reading files that are
  already public; the restriction blocks casual reuse from other origins.
- **Seed link leaks nothing new.** It carries only public Drive pointers (IDs + resourceKeys),
  no key, no bytes — same exposure as the already-public `photosUrl` in existing bundles.
- **Named-copy allow-list.** The `contentPackages` seed fields and the `pack.json` builder both
  follow `fureverSeedExport.js`/`companionExport.js` discipline: fields copied **by name**, so
  no Dog/Sale/Litter field ever rides along by accident.
- **Blast radius on decode.** Furever validates the manifest shape and every fetch is
  best-effort; a malformed/hostile manifest can at worst fail its own fetch — it never writes
  outside the breeder layer for its `pack_key`, and never touches family rows.

---

## 7. Decisions (settled 2026-07-24)

1. **Breeder auth model → OAuth-write primary, manual fallback documented.** Build the §4 flow —
   KennelOS creates folders, uploads, shares, writes the manifest via a GIS `drive.file` token.
   The owner sets up the OAuth client (§5.1) and we vendor GIS; the breeder re-grants a
   short-lived token per publish session (usually silent — §4.1). A **no-OAuth manual fallback**
   stays documented for breeders who won't connect Google: KennelOS **generates** `pack.json`
   (and the file list) for **download**; the breeder makes the Drive folder, uploads the files +
   `pack.json`, sets "Anyone with the link", and **pastes the manifest/folder link back**;
   KennelOS parses out the manifest file ID (+ resourceKey). Fallback is second-priority — ship
   the OAuth path first.
2. **Document sourcing → keep documents dog-scoped; add a bulk-add picker.** No new per-litter or
   per-kennel document store and **no reshape of the per-dog `documents` table**. The Publish
   picker (§4.2-2) sources from the documents already filed on the litter's connected dogs (pups
   + sire + dam) for a litter pack, and from any dog + an "Upload new" affordance for a
   kennel-wide pack, with **bulk selectors** (select-all, per-type, per-dog) so many docs go in at
   once. Selection is cached on the pack pointer (§3.4 `selection`) for pre-checked republish.
3. **Sensitive documents → warn + per-doc opt-in.** Published files are world-readable-by-link,
   so the picker leaves PII-bearing types (`contract`) unchecked by default and requires an
   explicit "this becomes public" confirmation to include; the publish summary restates what's
   going public (§4.2-2, §6).
4. **Litter pack privacy → tag by dog, filter per pup, no new document store (added
   post-launch).** The original build shipped one shared manifest per litter with no per-file
   dog association — every pup's family in a litter fetched the exact same file list, so a
   document filed on ONE pup was visible to every OTHER pup's family too. Fixed without
   reshaping `documents` (decision 2 still holds): each manifest file now carries the `dogId`
   it was filed on (§3.1), the litter's sire/dam ids ride along as `parentDogIds` (shared with
   the whole litter), and `furever/data/contentPackFetch.js` filters the fetched file list down
   to "this pup's own documents + the litter's parents' documents" before writing the family's
   breeder-doc layer. A kennel-wide pack is untouched — it has no per-file tagging and stays
   deliberately identical for every family.

---

## 8. Build task list — done (2026-07-24)

**Furever (family) side**
- ✅ `furever/data/contentPackFetch.js` — public-key manifest + file fetch, version-gated,
  best-effort, resourceKey header handling; called from `app.js boot()` after `consumeSeedLink`
  (via a `sessionStorage` hand-off, since the seed-link flow usually redirects to Profile
  before a fetch could otherwise start — see the file's `app.js` header comment).
- ✅ `furever/data/db.js`: `documents`/`content_packs` usage notes updated for `source`/
  `pack_key`/`drive_file_id` (plain, unindexed — no schema-version bump needed) and the
  manifest-cache repurposing (drop `payload`, add `scope`).
- ✅ `contentPackRepo` (manifest cache) + `documentRepo` (`getBreederDocsForPack`,
  `replaceBreederLayer` — a blind wholesale replace per version bump, §3.3) +
  `fileRepo` (already generic enough, unchanged).
- ✅ `documents.js` page: read-only "From your breeder" group for `source:'breeder'` rows
  (Download only, no edit/remove).
- ✅ Public API read key baked in; no vendoring on this side (fetch is plain `fetch`).

**KennelOS (breeder) side**
- ✅ `shared/data/googleDrive.js` — GIS token client wrapper (connect, ensure-token-with-401-retry,
  ensure-folder, upload/overwrite via hand-built multipart/related, share-public, write-manifest).
- ✅ Vendored `gsi/client.js` into `shared/vendor/gsi/client.js`, added to `shared/sw.js`
  `PRECACHE_URLS` (landed with this change; `CACHE_NAME` bump is separate — ask-first, per
  CLAUDE.md).
- ✅ `shared/data/fureverContentPack.js` — builds `pack.json` (named-copy) and orchestrates a
  publish (ensure folders → upload each source, reusing a cached Drive file id when the same
  source was published before → share → write manifest → return the pointer to persist).
- ✅ `shared/data/fureverSeedExport.js` — `buildSeedPacket` is now `async` and emits
  `contentPackages` (kennel pointer from settings + this dog's litter pointer via `litter_id`).
- ✅ `settings.js` (`contentPack`: packKey/folderId/manifestFileId/manifestResourceKey/version/
  selection, plus `driveConnected` UI state) and the litter's plain `furever_pack` field
  (no `litterRepo` code change needed — `update()` already merges arbitrary fields).
- ✅ Furever console (`shared/pages/furever.*`): Connect-Drive button, a kennel-wide Publish
  panel and one per litter, the bulk-add picker (select-all / per-type / per-dog-select-all,
  litter pool = pups + sire + dam via `documentRepo.getByDog`, "Upload new" for kennel-level
  files, pre-checked from the cached `selection`), and the sensitive-doc (`contract`)
  unchecked-by-default + confirm-to-publish warning.

**Known gaps / not built**
- The **manual (no-OAuth) fallback** from §7 decision 1 is documented only, not built — the
  owner settled OAuth-write as first-priority and the fallback as second-priority/deferred.
- **Not browser-verified against a real Google account** — no live OAuth consent or Drive API
  round trip has been exercised (this build environment can't drive a real Google consent
  popup). Verify Connect → Publish → a family device fetching real docs before relying on it.
- True "skip identical bytes" isn't implemented — a republish re-uploads every selected file's
  bytes, but reuses the same Drive file id per source (a stable overwrite, not a new file each
  time), so Drive doesn't accumulate duplicates; see `fureverContentPack.js`'s header comment.

**Docs updated in the same change**
- `KennelOS_Furever_Schema.md`: the `documents`/`content_packs` field changes, a new "Built
  (content-pack fetch)" section, moved out of § Not built yet.
- `furever/README.md`: file map + status prose.
- `End_State_Design_and_Maintenance_Guide.md` (→ `shared/…`): the new `shared/data/googleDrive.js`
  + `fureverContentPack.js`, the `fureverSeedExport` packet field, the litter `furever_pack` field.
- `README.md` / `build/README.md`: left as-is — neither documents third-party credential setup
  today (Dropbox's App Key isn't mentioned there either), and the Google Cloud setup itself
  needs no further action (§5.1 is done, nothing pending).
- **SW precache + `CACHE_NAME` bump** for the vendored GIS lib and any new files (ask-first, per CLAUDE.md).

---

## 9. Verified technical facts (so the build isn't guessing)

- **Anonymous public read of a known file ID** via `files/{id}?alt=media&key=KEY` is CORS-open
  and works with a public API key (brief appendix, round-trip verified).
- **Backend-less Drive write** from the browser via Google Identity Services' **token model**
  (`initTokenClient`, `drive.file`) is supported: access-token-only, **no client secret**, no
  backend; Google APIs support CORS with a bearer token.
- **`drive.file` is a non-sensitive scope** → the OAuth app publishes to production with **no
  verification review**, and the app can only touch files it created.
- **resourceKey caveat:** link-shared items (post-2021) can require a `resourceKey`, passed via
  the `X-Goog-Drive-Resource-Keys` header (`{fileId}/{resourceKey}`) or a `resourceKey` query
  param. We capture it from the create/get response and carry it in the manifest + packet, so
  fetches always include it when present.
- **Folder-listing (`files.list … in parents`) is deliberately avoided** in favor of the
  known-manifest fetch — more robust and it's the artifact the breeder-side automation produces
  anyway.

Sources:
[Use the token model (GIS)](https://developers.google.com/identity/oauth2/web/guides/use-token-model) ·
[files.get (alt=media)](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get) ·
[files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list) ·
[Access link-shared files with resource keys](https://developers.google.com/workspace/drive/api/guides/resource-keys) ·
[Add restrictions to API keys](https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys)
