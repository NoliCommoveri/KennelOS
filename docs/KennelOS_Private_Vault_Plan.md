# KennelOS Cloud — Phase 2b build plan: the private vault (DRAFT)

> Parent design: `docs/KennelOS_Cloud_Accounts_Proposal.md` §6.3 (cited as "Proposal §N").
> Builds on: `docs/KennelOS_Cloud_Phase1_Plan.md` (cited as "Phase 1 §N"), whose decisions in
> §5.1 moved the vault to directly after Phase 1 and added the second-device unlock.
> Needed by: the waitlist's W2 (`KennelOS_Waitlist_Spec.md` §8.2, §12).
> Status: **in progress.** Decisions recorded in §10 (2026-10-07). Built so far: §9 step 1
> (`shared/data/cloud/vaultCrypto.js` + `tests/vaultCrypto.test.js`) and step 2, the server
> (`cloud/src/vault.js`, migration `0005`, `cloud/tests/vault.test.js`; §6.4 is the as-built
> record), step 3, the client modules, and step 4, unlocking from another device (§9 is the
> as-built record). Step 5, the UI, is next. Nothing user-visible yet.

## 1. Scope

**In the vault (v1):**
- An opt-in switch, **"Also back up my private info"**, offered inside "Turn on cloud backup"
  and on the cloud backup card. Off by default. Lite and Pro alike (Editions Plan tier table);
  Demo has no cloud, so no vault.
- With it on, every push also uploads an **end-to-end encrypted** copy of the private tier.
  The server stores bytes it can't open, on the same 30-day retention as the kennel tier.
- **Three ways to unlock** on a new device (Proposal §6.3): the owner's **passkey** (WebAuthn
  PRF), a **recovery code** shown once at setup, or **another of the owner's devices** that's
  already unlocked.
- **Restore** brings back everything: a new phone that signs in and unlocks gets the whole
  program, private details included.
- The status card shows **two lines**: kennel records and private info (Phase 1 §5.1).

**Not in v1:** picking categories (Proposal §6.3's "advanced option"; §10 decision 2), sharing the
vault with Staff (Proposal §6.5), the "less private" recovery fallback (Phase 1 §5.1
Decision 4: decided in advance, not planned), and the waitlist's form key itself (W2 puts it
in the vault; this plan only makes the vault able to hold it).

**The governing rules still hold:** opt-in and removable (Proposal §2a); `cloudUrl: null`
makes no request and renders nothing; only `cloudApi.js` touches the network; the server
never holds readable private data, nor a key that opens it (Proposal §6.3, "Deliberately not
offered").

## 2. What the user sees

### 2.1 Turning it on
Inside "Turn on cloud backup", after the first backup succeeds, and on the card any time later:

1. **"Also back up your private info?"** One paragraph: contacts' details, prices, Financials,
   contracts, private notes; encrypted on this device before upload; we can't read it.
   Strongly suggested when the waitlist is in use (wording only, no gate in v1).
2. **The recovery code.** A 24-character code in groups of four, shown once, with **Print**,
   **Save to Files** (a small `.txt`) and **Copy**. The switch doesn't turn on until the user
   types the last group back ("I've saved it"), so the code isn't skipped.
3. **The passkey (when the browser supports PRF, §5.2).** "Unlock with Face ID / fingerprint
   next time?" → the browser's passkey sheet. Skippable; the recovery code already works.
4. **The honest line, said plainly** (Phase 1 §5.1, verbatim intent): "If you lose your
   passkey **and** this code, we can't open your private backup. Your devices and file backups
   are unaffected."
5. The first encrypted backup runs immediately, with the same progress bar.

### 2.2 While it's on
- **Nothing to do day to day.** An unlocked device keeps the vault key (§3.3) and encrypts
  every push in the background, exactly as cloud backup runs now. The passkey, recovery code
  or another device is needed only to unlock a device that doesn't have the key: a new
  phone, or one whose key was cleared (Reset App, cleared site data, remote erase) (§2.3).
- Status card: "Kennel records: backed up 4 minutes ago" / "Private info: encrypted backup,
  4 minutes ago". With it off: "Private info: only on this device · last file backup 40 days
  ago" plus "Turn on".
- Card actions: **Add a passkey**, **New recovery code** (replaces the old one; the old one
  stops working), **Unlock another device** (§2.4), **Turn off private backup** (§2.5).
- Private-only edits (a buyer's phone number) now cause a push. Today they don't: the
  "unchanged" check hashes only the cloud tier (§4.3).

### 2.3 New phone / reset
The existing "I already use KennelOS → sign in and restore" path (onboarding and kennel setup)
gains one step after sign-in when the program has a vault:

**"Unlock your private info"** → **Use passkey** (if one is registered and this browser can
use it) · **Enter recovery code** · **Use another device** (§2.4) · **Not now**.

- Unlocked: the restore brings back everything.
- "Not now": the kennel-tier restore runs as today, private fields blank and labelled (the
  per-record hint Phase 1 §4.6 deferred, Phase 1 §5.1). The card keeps an **Unlock** button;
  unlocking later merges the private tier in (§4.4). Until then this device **must not push**
  (§3.4), or it would replace the vault with an empty one.

### 2.4 Unlocking from another device
1. New device: **Use another device** → shows a 12-character code (§5.3) and "Open KennelOS
   on a device that's already unlocked, then Cloud backup → Unlock another device."
2. Unlocked device: **Unlock another device** → lists waiting requests by device label and
   time → the user picks one and **types the code** from the new device.
3. The new device unlocks within a few seconds (it polls). Requests expire after 10 minutes.

### 2.5 Turning it off
"Turn off private backup" (fresh sign-in, as for the other destructive actions, Phase 1 §2.5):
deletes the key wraps on the server, so nobody can unlock the vault again, and stops encrypted
uploads. Old encrypted snapshots age out on the normal 30-day retention (they can't be
opened anyway). The device's own data is untouched. Deleting the cloud account removes it all
as today.

## 3. Client design (`shared/`)

### 3.1 New modules

| File | Role |
|---|---|
| `data/cloud/vaultCrypto.js` | Pure WebCrypto: make a vault key, wrap/unwrap it (recovery code, PRF output, device-pairing key), encrypt/decrypt a payload, deterministic file encryption (§4.2). No db, no network; unit-tested in Node (WebCrypto is built in). |
| `data/cloud/vaultKeyStore.js` | Holds this device's unlocked vault key (a `CryptoKey`, §3.3). The only reader/writer of the new store. |
| `data/cloud/cloudVault.js` | The flows: `enableVault()`, `unlockWithRecoveryCode()`, `unlockWithPasskey()`, `requestDeviceUnlock()` / `approveDeviceUnlock()`, `addPasskey()`, `newRecoveryCode()`, `disableVault()`, `vaultStatus()`. Network only through `cloudApi`. |
| `assets/cloudVaultUI.js` | §2's screens, imported dynamically from `cloudBackupUI.js` (so `cloudUrl: null` never loads it). Not in `proPages.js`. |

`cloudBackup.js` changes: the push builds and uploads the vault payload when the vault is on
and unlocked (§4.1); the restore merges it (§4.4); `getBackupStatus()` reports two tiers.

### 3.2 The vault key
One random 256-bit AES-GCM key per **program** (Phase 1 has one program per user). It never
leaves the device unwrapped. The server stores only **wraps** of it (§6.2), one per unlock
path, each wrap an AES-GCM encryption of the raw key under a key-encryption key (KEK):

| Wrap | KEK |
|---|---|
| recovery | HKDF-SHA256 of the 120-bit recovery code (high-entropy, so no slow hash needed) |
| passkey | HKDF-SHA256 of the passkey's PRF output for a per-wrap random salt |
| device | ECDH P-256 (new device's key pair × approver's ephemeral pair) → HKDF, mixed with the typed code (§5.3) |

A `key_id` (random, stored beside every wrap and in every vault payload) catches a stale wrap
or payload made under a replaced key.

### 3.3 Where the unlocked key lives on the device
Pages never touch storage, and `settings.js` is `localStorage`, which can't hold a
`CryptoKey`. So the key goes in IndexedDB as a `CryptoKey` object: **a new Dexie table,
`device_secrets`** (one row per key). It is **never** in `exportAll`, the JSON/Dropbox
backups, the cloud snapshot, the sample-data manifest or Reset App's re-seed, and Reset App
and remote erase clear it. Extractable, because approving another device has to wrap it;
that adds no exposure, since the same IndexedDB already holds the private data in the clear.
Added to the existing `db.version(1)` block (§10 decision 4).

### 3.4 Pushing safely
- Vault **on and unlocked**: each push carries both tiers.
- Vault **on but locked on this device** (restored with "Not now"): **pushes pause** with a
  blocking state, "Unlock to keep backing up", like the existing conflict/shrink pauses. A
  push without a vault payload would let retention forget the last good one in 30 days.
- Vault **off**: unchanged from Phase 1.
- The server enforces the first rule too: when the program has a vault, a snapshot without a
  vault part is refused (§6.1). So a stale or older client can't drop it.

## 4. Payload and restore

### 4.1 What the vault payload holds
**The complete records, not the private complement**: the same `exportAll` rows the JSON
backup holds (sample data dropped, as for the cloud tier), JSON, gzipped, then encrypted. Why
not just the private fields: the complement logic would have to track `syncRegistry.js`
forever (partial fields, row rules, filtered `details`), and any drift silently loses data.
The full rows can't drift, and restore is the existing file-backup merge. The cost is size
(roughly the cloud tier again) and it's all encrypted. Decided: §10 decision 1.

Envelope (encrypted body): `{ vault_format: 1, key_id, schema_version, created_at, collections }`.
On the wire: `{ v: 1, key_id, iv, ciphertext }` as one binary blob; the server sees only its
size.

### 4.2 Private files
Documents filed as `contract`/`other` and receipt files aren't in the cloud tier. In the
vault they're encrypted **deterministically**: IV = first 12 bytes of HMAC(file-key,
plaintext sha256), file-key derived from the vault key. Same file → same ciphertext → same
sha256, so the existing content-addressed `/files` upload-if-missing, the snapshot's file list
and retention all work **unchanged**, and an unchanged document is never re-uploaded. The
server learns only that two uploads are the same file. Each vault file row records its
ciphertext sha256; restore downloads, decrypts and checks the plaintext hash.

### 4.3 The "unchanged" check
Today a push is skipped when the cloud tier's hash matches the last push. With the vault on,
the hash covers the vault payload's plaintext too, so private-only edits push.

### 4.4 Restore
- Unlocked at restore time: run the existing `'cloud-merge'` of the kennel tier, then a
  `'merge'` of the decrypted full rows (newer `updated_at` wins, so a device that has newer
  local edits keeps them), inside the same progress dialog. One summary.
- Unlocked later ("Not now", then Unlock): the same `'merge'` of the latest vault payload.
- Restore as of a date: the snapshot's own vault part, when it has one.
- Dog cap (Lite): the merge goes through the same `enforceImportDogCap` as every import.

## 5. Unlock paths in detail

### 5.1 Recovery code
24 Crockford base32 characters (120 bits), shown as `XXXX-XXXX-…`. Typing is
case-insensitive and ignores spaces/dashes; `O/I/L` read as `0/1/1`. Rate-limited at the
server by the same per-account limiter as sign-in codes, though 120 bits makes guessing
pointless; the limit is against hammering.

### 5.2 Passkey (WebAuthn PRF)
- **Not used for sign-in.** Email codes stay the only sign-in in v1. The passkey only derives
  the KEK, so **the server never verifies a WebAuthn assertion**: it stores the credential id
  and the PRF salt beside the wrap, and the browser does the rest. No WebAuthn library.
- **RP ID `kennelos.app`**, so a passkey made on `lite.` works on `pro.` (the Lite → Pro
  restore, Editions Plan) and the passkey syncs once for both. `localhost` uses `localhost`.
- **Support:** PRF works in current Chrome (desktop + Android), Safari 18+ (iOS/macOS, iCloud
  Keychain) and recent Firefox; not every authenticator supports it (some Windows Hello and
  older security keys don't). The flow feature-detects (`getClientExtensionResults().prf`)
  and simply doesn't offer the passkey where it can't work. **The recovery code is always
  required**, so no user depends on PRF.

### 5.3 Another device
The server relays, but must not be able to open what it relays (Proposal §6.3's threat model
includes a breached server):
1. New device makes an ECDH P-256 key pair and a random **12-character code** (60 bits),
   posts only its **public key** and label: `POST /vault/pairings` → pairing id.
2. Approver lists open pairings, the user types the code; the approver derives
   KEK = HKDF(ECDH(own ephemeral, new device's public), salt = code), wraps the vault key,
   posts the wrap + its ephemeral public key.
3. New device polls, derives the same KEK, unwraps. The pairing row is deleted on success or
   after 10 minutes.

A server that swaps in its own public key gets a wrap it can open only by guessing the
60-bit code offline against AES-GCM; that's impractical. (A 6-digit code would not be; §10 decision 3.)

## 6. Server (`cloud/`)

### 6.1 API (bearer token; all behind the maintenance gate)

| Route | Does |
|---|---|
| `GET /vault` | `{enabled, keyId, wraps: [{id, kind, label, credentialId?, prfSalt?, createdAt}]}`; no wrapped bytes |
| `POST /vault` | Turn on: `{keyId, recoveryWrap}`. 409 if already on |
| `GET /vault/wraps/:id` | One wrap's bytes (rate-limited; recovery wraps on the sign-in limiter) |
| `POST /vault/wraps` | Add a passkey or device wrap (key_id must match) |
| `PUT /vault/wraps/recovery` | New recovery code: replaces the recovery wrap |
| `DELETE /vault/wraps/:id` | Remove a passkey |
| `DELETE /vault` | Turn off (fresh sign-in): deletes every wrap |
| `POST /vault/pairings`, `GET /vault/pairings`, `POST /vault/pairings/:id/approve`, `GET /vault/pairings/:id` | §5.3 |
| `POST /snapshots` | Gains `vault: {size, keyId}`. **Refused (`vault_required`) when the program has a vault and it's missing**, or when `keyId` is stale |
| `PUT /snapshots/:id/vault` | The encrypted payload; must land **before** the body PUT that commits |
| `GET /snapshots/:id/vault` | The encrypted payload |

### 6.2 Migration `0005_vault.sql` (additive)
```sql
CREATE TABLE IF NOT EXISTS vaults (
  program_id  TEXT PRIMARY KEY REFERENCES programs(id),
  key_id      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vault_wraps (
  id             TEXT PRIMARY KEY,
  program_id     TEXT NOT NULL REFERENCES programs(id),
  kind           TEXT NOT NULL CHECK (kind IN ('recovery', 'passkey', 'device')),
  label          TEXT,
  key_id         TEXT NOT NULL,
  credential_id  TEXT,   -- passkey only
  prf_salt       TEXT,   -- passkey only
  wrapped        TEXT NOT NULL,  -- base64 AES-GCM(iv || ciphertext); useless without the KEK
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_wraps_program ON vault_wraps (program_id);
CREATE TABLE IF NOT EXISTS vault_pairings (
  id               TEXT PRIMARY KEY,
  program_id       TEXT NOT NULL REFERENCES programs(id),
  device_label     TEXT,
  public_key       TEXT NOT NULL,
  approver_key     TEXT,
  wrapped          TEXT,
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL
);
ALTER TABLE snapshots ADD COLUMN vault_size INTEGER;
ALTER TABLE snapshots ADD COLUMN vault_key_id TEXT;
ALTER TABLE snapshots ADD COLUMN vault_landed INTEGER NOT NULL DEFAULT 0;
```
R2: `snapshots/<program>/<id>.vault` beside the body. Retention deletes it with its snapshot;
expired pairings go with the other ephemeral rows; account deletion removes all of it. The
`/ops` D1 export gains `vaults` and `vault_wraps` (not pairings). Nothing logs a code, a wrap
or a key; `/ops` shows only counts ("programs with a vault: N").

### 6.3 Posture check
Everything the server holds about a vault is a wrap (needs a KEK it never sees), a PRF salt
and credential id (public by design), an ECDH public key, or ciphertext. A full D1 + R2 dump
opens nothing.

### 6.4 As built (§9 step 2, 2026-10-07)
Where the build differs from §6.1–§6.2 above, this wins:
- **No `device` wraps.** A device unlocked by another device keeps the key locally, so the
  pairing hands over a one-time wrap and nothing persists. `vault_wraps.kind` is
  `recovery | passkey`: exactly one recovery wrap (replaced, never removed) and up to 10
  passkeys. `POST /vault/wraps` adds passkeys only.
- **Fresh sign-in** (the Phase 1 §2.5 rule: a session from the last 15 minutes, or a code
  just sent) for `DELETE /vault`, `PUT /vault/wraps/recovery` and `DELETE /vault/wraps/:id`.
  Turning the vault on and adding a passkey don't need it.
- **Pairings:** `vault_pairings` also stores the asking `device_id` (only that device can
  poll; it can't approve its own request), and the approver's `key_id`. At most five open
  per program; they expire after 10 minutes; reading an approved answer deletes it.
- **Limits** (per program, per UTC hour, in `rate_limits`): 30 wrap reads, 10 new pairings.
- **Snapshots:** refusals are `vault_required` (400, carries the current `keyId`),
  `vault_key_stale` (409, same), `no_vault` (400, a vault part with no vault),
  `vault_missing` (400, body before vault part). The body PUT re-checks the vault at
  commit and discards the half-snapshot if it was turned off or re-keyed meanwhile.
  `GET /snapshots` gains `vaultKeyId`.
- `/ops`: counts for `vaults`, `vault_wraps`, `vault_pairings`; the D1 export carries
  `vaults` and `vault_wraps`.

## 7. Editions & docs
- No edition differences: Lite and Pro both get it; Demo has `cloudUrl: null`.
- `shared/sw.js` `PRECACHE_URLS` gains the new client files (none Pro-only); `CACHE_NAME`
  bump asked first, as always.
- Docs in the same change as each step: README build status; Phase 1 §2.2 status line and
  §5.1 Decision 3 (now "built"); Proposal §6.3 and §9 (Phase 2b status); Editions Plan
  ("Converting Lite → Pro": after the vault, the file isn't needed); End-State guide (§30
  cloud section: the new table, modules and flows; `device_secrets` in the schema block);
  `cloud/README.md` (routes, migration 0005, R2 layout); the privacy policy
  (`site/privacy.html`: the encrypted tier); the Waitlist Spec's W2 prerequisite.

## 8. Testing
- `vaultCrypto` unit tests: round-trips; wrong code/PRF/key fails; deterministic file
  encryption is stable per key and differs across keys; tampered ciphertext fails.
- Server tests (`cloud/tests/vault.test.js`, the node:sqlite shim): turn on/off, wraps,
  `vault_required` refusal, stale `key_id`, pairing expiry, retention and account deletion
  remove the vault objects, export/import includes the new tables.
- Client: a push with the vault on uploads `vault` before the body; a locked device pauses;
  the restore merge brings back private fields; Reset App / erase clear `device_secrets`; and
  a **leak test**: nothing in the kennel-tier snapshot changes when the vault is on.
- Browser: Lite and Pro on staging, end to end on two browsers (recovery code, device
  pairing), passkey on a real Android and iPhone; Demo / `cloudUrl: null` renders nothing.

## 9. Build order (each a reviewable PR; nothing user-visible until step 5)
1. **`vaultCrypto.js` + tests.** Pure, no network. Review the crypto choices here.
   **Built 2026-10-07.** Codes (Crockford base32; recovery 24, pairing 12); the vault key
   and its `keyId`; KEKs from the recovery code, PRF output and ECDH pairing (all HKDF-SHA256
   to AES-GCM-256); wraps bound to their kind and `keyId`; one ciphertext layout for payloads
   and files (`KVLT` | version | keyId | iv, the header as AES-GCM additional data);
   deterministic private-file encryption under subkeys derived from the vault key. Every
   failure is one `VaultLockedError`. Not imported by anything yet; in `PRECACHE_URLS`.
2. **Server:** migration `0005`, the `/vault` routes, the snapshot `vault` part and the
   `vault_required` rule, retention/deletion/export, tests. Staging: Apply pending.
   **Built 2026-10-07** (§6.4), pairing routes included, so step 4 is client-only.
   `0005` is applied on staging and production (production's Worker deploys from `main`
   and answers 503 while a migration is pending, so it had to be applied there too).
3. **Client modules:** `vaultKeyStore`, `cloudVault`, the push/restore changes in
   `cloudBackup`, the pause state. Against staging.
   **Built 2026-10-07.** `device_secrets` in `db.version(1)` as a device-only table
   (`db.dataTables()` leaves it out of exports and restores; Reset App and erase clear it);
   the key row is tagged with its program. `cloudVault`: `startVaultSetup`/
   `finishVaultSetup` (the last group typed back, then the first encrypted push),
   `unlockWithRecoveryCode` (then merges the latest vault part unless `merge: false`),
   `mergeLatestVault`, `startNewRecoveryCode`/`finishNewRecoveryCode`, `disableVault`,
   `vaultStatus`. `cloudBackup`: `buildVaultPayload` + `sealVaultPayload` (the plaintext half
   feeds the "unchanged" hash, so nothing is encrypted unless it pushes; files the cloud
   tier already uploads are referenced, not stored twice); the `vault_locked` pause;
   `no_vault` forgets the key and pushes again without it, `vault_key_stale` forgets it and
   pauses; `restoreSnapshot` merges the same snapshot's vault part (`restoreSnapshotVault`).
   Restore is a new `importExport` mode, `'vault-merge'`: newer wins, but a locally newer
   row (edited while locked) keeps its edit and gets blank private fields filled from the
   vault. Tested end to end against the Worker (`tests/cloudVault.test.js`). Passkey and
   pairing flows are steps 4 and 6.
4. **Second-device pairing** (client + the pairing routes, if split from step 2).
   **Built 2026-10-07** (client only; the routes came with step 2). `cloudVault`:
   `requestDeviceUnlock` (new device: an ECDH key pair and a 12-character code; only the
   public key is sent), `pendingDeviceUnlock`, `pollDeviceUnlock` / `waitForDeviceUnlock`
   (every 3 s; derives the KEK and unwraps), `cancelDeviceUnlock`; on the unlocked device
   `listUnlockRequests` and `approveDeviceUnlock` (an ephemeral key pair, the typed code as
   the HKDF salt, a one-time `device` wrap). The open request (its non-extractable private
   key and the code) is kept in `device_secrets`, so a reload or page change mid-wait doesn't
   lose it. The approver can't check the code: a wrong one fails on the new device
   (`VaultLockedError`), and since the server hands the answer out once, it asks again.
   Tests: `tests/cloudVault.test.js`.
5. **UI:** §2's screens, the two-line status, the restore unlock step, the blank-private-field
   hint. Browser-verified in Lite and Pro.
6. **Passkey (PRF)** as its own step: it needs real-device testing and is optional for users.
7. **Docs (§7), privacy policy, `PRECACHE_URLS`, SW bump (asked first).** (Production: Apply
   pending on `/ops`, already done for `0005`.)

## 10. Decisions (2026-10-07)
1. **Vault payload = full records (§4.1)**, not only the private fields. The readable kennel
   tier stays too (restore without unlocking, and the server-side features that read it), so
   record JSON is stored twice; files are not.
2. **No category picker in v1.** All-or-nothing; Proposal §6.3's "advanced option" is
   deferred.
3. **Second-device code: 12 characters** (60 bits), typed on the approving device (§5.3).
4. **`device_secrets` goes in the existing `db.version(1)` block.** There are no real users
   yet, so the schema is still editable as CLAUDE.md says (reconcile with Reset App).
5. **Passkey RP ID `kennelos.app`** (§5.2), one passkey for Lite and Pro.
6. **W2 needs the vault to exist; turning it on is strongly suggested, not a gate.** W2 may
   revisit.
7. **Turning it off** deletes the wraps at once; the encrypted snapshot parts age out on
   retention.
