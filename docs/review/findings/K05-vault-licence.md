# K05 — The vault, the licence, and account identity

Reviewed: `shared/data/cloud/vaultCrypto.js` (323), `vaultPasskey.js` (180),
`vaultKeyStore.js` (84), `cloudVault.js` (525), `cloudAuth.js` (188), `cloudDevices.js` (214),
`cloudAssist.js` (117), `cloudApi.js` (error mapping), `shared/data/license.js` (346),
`shared/data/jotformKeyStore.js` / `stripeKeyStore.js`, `shared/assets/licenseGate.js` (230),
`cloudVaultUI.js` (665), `cloudAssistUI.js` (265), `vendorKeyUI.js` (the key-entry steps),
`cloudBackupUI.js` §sign-in/recovery (lines 200–430), the `?assist=` and licence-gate block in
`shared/app.js` (131–200); `cloud/src/vault.js` (343), `assist.js` (388), `assistApp.js` (253),
`license.js` (329), `recovery.js` (139), `auth.js` (183), `program.js` (94), `api.js` (the
`OWNER_ONLY` set), `ratelimit.js` (40), `retention.js` (the identity rows),
`cloud/src/migrations/0005`, `0011`, `0014`, `0020`.
· Contract read: `docs/KennelOS_Private_Vault_Plan.md`, `_License_Link_Plan.md` §5, §9,
`_Assisted_Setup_Plan.md` §1–§7, `KennelOS_Lite_Pro_Editions_Plan.md` §Licensing,
`KennelOS_Cloud_Phase1_Plan.md` §2.5–§2.7, guide §0 and §30, `site/faq.html` (the licence
answers), README Status.

Verified by: green baseline at `c71302a` — `node --test` **1649 pass**, `cd cloud && npm test`
**305 pass**, `node build/assemble.mjs` succeeds. Then, in my scratchpad (nothing in the repo):

- two Playwright runs against the **built Pro edition** served over HTTP
  (`dist/pro/pages/import-export.html`), with `api.lemonsqueezy.com` blocked: one with a
  lapsed monthly record, one with `role: "helper"` written into the session blob;
- five probes driving the **real Worker in-process** through `cloud/tests/helpers/env.js`:
  the pairing caps hit by repeated requests; every owner-only route tried with a live helper
  session; the manager app deleting and erasing an account it never set up;
  an `account_deletions` row aged past 90 days and put through `runRetention`;
  `/recover/wrap` for an address with and without an account;
- two client-side suites on the `tests/support/memoryDb.js` + in-process Worker harness
  (the `tests/cloudClient.test.js` pattern): one support device opening **two** assist links
  with no hand back in between, and `startAccountRecovery` across the three states of a vault;
- a script over `detectInterval` / `onlineVerdict` / `offlineVerdict` for ten real-shaped
  Lemon Squeezy variant names, and `helpSectionHtml` run for all five assist states.

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S1 | shared/assets/cloudAssistUI.js:58-117 · data/cloud/cloudAuth.js:59-66 | A second assist link opened on a support device that still holds the previous user's records carries that whole kennel — dogs, contacts with phone and email, notes — into the new user's account and syncs it to her devices, with no question asked | verified |
| 2 | S1 | cloud/src/assist.js:285-295 · assistApp.js:167 | The manager app's "Delete an account" identifies the account by a hand-typed email, shows nothing about whose it is, and has **erase its devices** checked by default: one wrong-but-real address destroys a stranger's only copy of her records | verified |
| 3 | S2 | shared/assets/licenseGate.js:144-159,53-77 · shared/app.js:156-168 | Behind the renewal wall (and the activation and reconnect walls) there is no way to her own records and no export; the editions plan's promise that "the records stay exportable" is not implemented anywhere | verified |
| 4 | S2 | shared/assets/cloudAssistUI.js:212-216,231-239 | "Later" at the recovery-code step leaves the takeover unfinished, so support's helper session is never revoked — and while the program is in `setup` her Account card offers no End help at all, so she cannot end that access | verified |
| 5 | S2 | shared/data/cloud/cloudAssist.js:104-117 · cloud/src/vault.js:203-205 · ratelimit.js:36 | The takeover's automatic pairing asks again on every page load without reusing the open request: six navigations in ten minutes answer `too_many_pairings`, eleven in an hour `rate_limited`, and the takeover is stuck for the rest of the hour behind "Too many codes requested" | verified |
| 6 | S2 | shared/assets/cloudBackupUI.js:416-423 | The two account-recovery messages are attached to the wrong cases: a breeder with no vault is told to check a recovery code she never had, and one whose code just opened her real vault is told no recovery code was ever set up | verified |
| 7 | S2 | shared/assets/cloudAssistUI.js:84-87 · cloud/src/sync.js:22 | Assisted setup stops at "Setup stopped — Couldn't turn on keeping devices in step (pro_required)" whenever the server holds no Pro purchase for her address, after the vault is already on, and re-alerts on every page load | verified |
| 8 | S3 | shared/assets/cloudAssistUI.js:141-150,258 · cloud/src/assist.js:62-71 | "their copy of your records is wiped" is stated as done, but the wipe needs support's device to make one more request — and Hand back while support is offline neither ends help nor wipes anything, with only "That didn't work" shown | verified |
| 9 | S3 | shared/data/license.js:67-77,301-324 · assets/licenseGate.js:124,144 | A lifetime key whose variant name doesn't match `lifetime\|perpetual` is treated as monthly: it walls after **3 days** offline, on the renewal wall with a "Renew Pro →" link the editions plan says a lifetime owner must never see | verified |
| 10 | S3 | cloud/src/retention.js:135 · assistApp.js:183 | An erase never reaches a device that stays away longer than 90 days: it gets a plain `unauthorized` and keeps every record, while the manager app told support those devices "will be told when they next open" | verified |
| 11 | S4 | shared/app.js:133,156 · data/cloud/cloudAuth.js:59-66,139 | The helper device's licence-gate exemption is decided by a `role` field in the `localStorage` session blob, so three lines of `localStorage` clear a lapsed Pro wall with no key, no store call and no server | verified |
| 12 | S4 | cloud/src/api.js:37-47 · vault.js:151-168 | `POST /vault/wraps` is not owner-only: a helper device that holds the vault key can leave a passkey wrap of its own in her vault, and fill all ten passkey slots so she cannot add hers | verified |
| 13 | S4 | cloud/src/assist.js:199-210,373-374 | The manager app's session cookie cannot be revoked: Log out only clears it in that browser, it is valid for 60 days, and the only revocation is rotating `OPS_TOKEN`, which also locks support out of `/ops` | verified |
| 14 | S4 | pro/editionConfig.js:64-66 · guide §30:2389 | Two statements the next change will be made against: the Pro config still says a lifetime key "never needs online re-validation" (it does, every 90 days), and the guide says the server's Pro check "gates only server features (the online waitlist)" when it also gates sync, alerts and integrations | verified |

---

## 0. The crypto, first: it holds up

The plan asked me to judge the cryptography before anything else. I found nothing wrong with
it, and that is worth recording as plainly as a defect would be.

**Keys and derivation.** One random AES-GCM-256 key per program (`vaultCrypto.js:106`), with a
16-byte random `keyId` minted in the same call. Every KEK is HKDF-SHA256 over high-entropy
input with a distinct `info` label — `recovery/v1`, `passkey/v1`, `handoff/v1`,
`handoff-proof/v1`, `pairing/v1`, `account-check/v1/<keyId>`, `files/enc/v1`, `files/iv/v1` —
so no two uses of the same secret produce related keys. The recovery and handoff codes are 120
bits of Crockford base32 (`:78`, `:102`), which is why a single HKDF pass and a constant salt
are the right choice rather than a slow hash: there is nothing to grind. `randomCode` draws
`byte & 31` over a 32-symbol alphabet, so it is uniform (`:83`), and `normalizeCode` only maps
`O→0`, `I/L→1` on *typed* input, never on generation, so no entropy is lost to the forgiving
reader.

**Envelopes.** A wrap is `base64(12-byte IV ‖ AES-GCM(raw key))` with
`kennelos-vault/wrap/<kind>/<keyId>` as additional data (`:212`), so a recovery wrap cannot be
replayed as a passkey wrap, nor a wrap from a replaced key as the current one. Ciphertext is
`'KVLT' ‖ version ‖ keyId ‖ IV ‖ GCM`, with the whole 33-byte header as additional data
(`:239-265`), and `readVaultHeader` lets a restore say "made under an older key" without
decrypting. `openWith` checks version and `keyId` before it tries (`:271`). The server
mirrors all of this: `checkKeyMatches` on every write (`cloud/src/vault.js:70`), `MAX_WRAP`
256 bytes, a strict `P256_PUBLIC` regex, `PROOF` and `KEY_ID` regexes.

**IVs.** Payloads get a fresh random 96-bit IV per encryption (`:284`) — fine for the few
thousand snapshots a program will ever push. Files are deliberately deterministic
(`:309-315`): `IV = HMAC(ivKey, sha256(plaintext))[0..12]`, so the same document re-encrypts
to the same bytes and the content-addressed `/files` upload dedups. I went looking for the
nonce reuse that pattern invites — the same key encrypting the same plaintext under two
different `keyId`s would repeat an IV under one key and hand an attacker the GHASH subkey —
and it cannot happen: `generateVaultKey` is the only producer of a `keyId` and always mints
both together, and every one of the six `setVaultKey` call sites
(`cloudVault.js:141,169,220,271,330,429`) stores the key beside the `keyId` it was unwrapped
under. What deterministic file encryption does cost is stated in the plan and is real: the
server can see that two of her private documents are byte-identical, and that an unchanged
document was re-uploaded.

**Where keys live.** The vault key is a `CryptoKey` in `device_secrets`, extractable, with the
honest reason written down (`vaultKeyStore.js:9-11`): approving another device has to wrap it,
and the same IndexedDB already holds the private data in the clear. `db.dataTables()` leaves
`device_secrets` out, so it is in no export, snapshot, backup or restore, and
`tests/cloudVault.test.js:332` holds that line. Her Jotform and Stripe API keys live in the
same table by the same rule (`jotformKeyStore.js:7-10`, `stripeKeyStore.js:7-9`).

**Plaintext reaching the server.** `cloud/src/vault.js` stores and returns opaque strings and
never parses one; `accountCheck` is a hash of a hash; `saveRecoveryCheck` is write-once-while-
NULL (`:340`), so no device can swap in a check of its own. `/recover/wrap` for an address with
no account returns a stand-in wrap derived from the address hash (`recovery.js:60-65`) — I
confirmed it is the same 80 characters and the same shape as a real one, so the route says
nothing about who has an account. Nothing in these files logs a body.

**The one place the guarantee is weaker than it reads.** `kekFromPairing` salts the ECDH
shared secret with the 12-character typed code (`:201-207`), and the header comment says this
means "a server that swaps a public key in still can't open what it relays". That is 60 bits
of protection, not an unconditional one: a server that swapped both public keys holds both
shared secrets and can grind the code offline at one HKDF plus one GCM unwrap per guess. 2⁶⁰ is
a long way out of a casual attacker's reach and the window is ten minutes, so I am not raising
it as a finding — but "can't open" overstates it, and if the pairing code is ever shortened for
typability that sentence is the thing someone will read.

**Assisted setup's trade is exactly the one the plan describes.** Plan §4 says that in the
`setup` / `requested` / `helping` windows "someone in control of the server could pose as the
other side and receive the key". The code makes precisely that trade and no larger one: the
asking device posts its pairing code with the request, the server stores it in plaintext in
`vault_pairings.auto_code` (`vault.js:211-217`), and hands it out only to the opposite role and
only while `autoApprovalAllowed` holds (`:232-236`, `assist.js:98-109`). Outside those states
the code is dropped at write time. One residue: the stored plaintext code is not cleared when
the program leaves the window — it sits in D1 until the pairing expires and the daily retention
sweep removes it (`retention.js:138`), so there is a window of up to a day where a row holds a
code whose state no longer permits it. Nothing can read it through the API by then, which is
why it is a note and not a finding.

---

## 1. One support device, two users: the first user's kennel lands in the second's account  (S1, verified)

**Where** `shared/assets/cloudAssistUI.js:36-53` (`openAssistLink`), `:58-66`
(`bootstrapHelper`), `:68-98` (`setUpForHer`), `:100-117` (`joinHer`);
`shared/data/cloud/cloudAuth.js:59-66` (`setHelperSession`);
`shared/data/cloud/cloudBackup.js:746-750` (`prepareDirectJoin`);
`shared/data/cloud/cloudSync.js:441-451,373-407`.

**Scenario** Support finishes helping Dana on their helper browser profile and presses **Hand
back** — but they are on hotel wifi, `endHelp()` throws `CloudOfflineError`, and
`cloudAssistUI.js:148` shows "That didn't work" and **returns without erasing** (finding 8).
Or they simply open the next job's link in the same profile. Either way the device still holds
Dana's records in IndexedDB. They now open Mia's assist link.

`openAssistLink` → `redeemAssistLink` → `setHelperSession` replaces the session with Mia's
program and resets the backup state — and nothing else. The local database is untouched and
`sync_meta` is untouched; there is no check anywhere that the records on this device belong to
the program it has just signed in to. `setAssistReady(null)` then guarantees `bootstrapHelper`
runs its one-time setup again, and because Mia's program is in `setup` it takes `setUpForHer`:
`prepareDirectJoin()` (backup on), the vault on, `enableSync()`. `enableSync` is `joinNow`,
whose own comment says "on the first device the join pulls nothing and **uploads every
record**" (`cloudSync.js:437`), and `joinNow` reaches `pushChanges({ allowShrink: true })`
after `clearSyncMeta()`, so *every* local row counts as new. `joinHer` (the Get-help path) is
the same with `joinSyncFlow({ confirmed: true })` — and `confirmed: true` is what skips the one
dialog that would have told anyone "this device's records the cloud doesn't have go up"
(`cloudSyncUI.js:266-275`).

I drove this on the memory-db + in-process-Worker harness, two assist links on one device with
no hand back between them:

```
Dana: enableSync -> {"status":"on","pulled":0,"keptOurs":0,"pushed":3}
after the 2nd link: programId = d29bfc13-…  | helper: true
Dana rows still in this device db: dogs [ 'd-dana' ] contacts [ 'c-dana' ]
Mia: enableSync -> {"status":"on","pulled":0,"keptOurs":0,"pushed":3}
Mia's program now holds 3 synced records:
  {"tbl":"dogs","id":"d-dana","has_cloud":1,"has_sealed":1}
  {"tbl":"kennels","id":"k-dana","has_cloud":1,"has_sealed":1}
  {"tbl":"contacts","id":"c-dana","has_cloud":1,"has_sealed":1}
```

**Why it matters** Mia's account now holds Dana's kennel, Dana's dog with its private notes,
and Dana's buyer with a phone number and an email address — sealed under *Mia's* vault key, so
Dana's vault gives her no protection at all, and synced down to every device Mia signs in on.
Mia sees another breeder's records as her own starting data; when she takes over she will
archive or delete them, and `adoptOwnKennel` (`cloudBackup.js:735`) may even make Dana's kennel
her own. On the other side, Dana's private records have been copied into a stranger's account
by the one person she trusted to touch them. Nothing anywhere says this happened. The assisted
setup plan's whole premise — "a browser profile kept for her alone" (§1 step 2) — is a
convention with no enforcement behind it, and the two most ordinary slips (an offline hand
back, a hurried second job) break it.

**What I'd do** Make redeeming an assist link on a device that holds records for a different
program a refusal, not a merge: `redeemAssistLink` knows the incoming `programId` and the
session it is replacing, so compare them and, when they differ and the local database is not
empty, erase the device first (the same `appReset.eraseThisDevice` that Hand back runs) or stop
with "This device still holds <name>'s records — hand back first". The cheaper half, worth
doing regardless: stop passing `confirmed: true` to `joinSyncFlow` on the helper paths when the
local database is non-empty, so the "this device's records go up" sentence is actually read.

---

## 2. The manager app can delete and erase any account from a typed email, with erase on by default  (S1, verified)

**Where** `cloud/src/assist.js:285-295` (`deleteFor`), `cloud/src/assistApp.js:164-169` (the
form) and `:182-183` (the call and its toast); `cloud/src/program.js:60-93` (`removeAccount`);
`shared/data/cloud/cloudDevices.js:151-160` (what her device does with it).

**Scenario** Flow step 1 is routine: "Support deletes her old account(s) in the manager app
… with **erase its devices** on." The form is an email box, a checkbox that is `checked` in the
markup, and a box to type `DELETE`. Nothing is shown about the account behind that address —
not when it was made, not how many devices or records it has, not whether support has ever
touched it. `deleteFor` looks the user up by email hash, calls `removeAccount(..., { erase:
body.erase !== false })`, and answers `{ ok: true, devices: n }`.

Support is setting Dana up and knows she has an old account. Dana has used two addresses over
the years and support types the wrong one — or two customers share a surname, or a copy-paste
picks up the line above. The address resolves to a real account belonging to somebody else.
Typing `DELETE` confirms nothing about *which* account, so there is no step at which the
mistake can show. I ran it against the real Worker on an account that had never asked for help
and had no `assist_programs` row at all:

```
assist_programs rows before: 0 | delete -> 200 {"ok":true,"devices":1}
her device next request -> 401 {"error":"account_deleted","erase":true}
```

On that device, `cloudApi` maps the 401 to `CloudAccountDeletedError`, and
`onAccountDeleted` calls `forgetAllPasskeys` and then `eraseThisDevice` — straight into
`appReset.eraseThisDevice`, with no prompt, no confirmation, and no check that this breeder
has a recent backup. Her cloud copy was deleted a moment earlier by the same call, so there is
nothing to restore from either.

**Why it matters** This is the most destructive button in the product and it has the weakest
guard: one free-text field, the dangerous option pre-selected, and no identity confirmation.
K4 found the `/ops` version of this unable to tell two accounts of the same person apart
(`ops.js:322`); the manager app is a second door to the same power with *less* information
than `/ops` offers, and it is the door support is told to use. A breeder whose only copy was on
one laptop loses her entire kennel record, and the only trace is one `assist_events` row for a
program that no longer exists.

**What I'd do** Two steps, both small. Make the delete two calls: a lookup that returns what
`/ops` shows (created-at, record counts, device labels, whether this program is one support set
up) and that support must see before a second call carrying a short-lived token for *that*
account id. And default the erase checkbox to **off**: erasing is the exception for a fresh
start, not the normal case, and the one-line cost of getting it wrong is unbounded.

---

## 3. Behind the licence wall there is no way to her own records, and no export  (S2, verified)

**Where** `shared/assets/licenseGate.js:144-159` (the renewal wall), `:127-139` (the reconnect
wall), `:53-77` (the activation wall), `:40-50` (the overlay), `:221-229` (`ensureLicensed`);
`shared/app.js:156-168`; `shared/assets/app.css:535-545`.

**Scenario** Her card expires while she is at a show. On the fourth day
`offlineVerdict` walls a perfectly good monthly subscription (`license.js:322`: `since >
graceFor(record)`, three days), or the renewal genuinely lapsed, or Lemon Squeezy answered
`valid:false` because a slot was released. `ensureLicensed` paints the overlay and returns
false, so `boot()` stops at `shared/app.js:167` — before `renderNav()`. I loaded the **built
Pro edition** with a lapsed record and the licensing API blocked:

```
wall painted: true
wall title: Your Pro subscription needs attention
wall controls: [ 'Check again', 'Renew Pro →', 'Use a different key' ]
nav children: 0
#btn-backup exists: true  visible: false
  element at its centre point: license-wall
  click BLOCKED: elementHandle.click: Timeout 2000ms exceeded
```

Import/Export's own page module still runs — `#btn-backup` is in the DOM — but the overlay is
`position: fixed; inset: 0; z-index: 11000` and nothing dismisses it, so her backup button sits
two centimetres behind glass. Every page is the same page: the gate runs in `boot()`, which
every page imports. The three ways out are Check again (needs the store to say yes), Renew
(needs money), and Use a different key — which drops her to the **activation wall**, which has
no export either. The reconnect wall a lifetime owner gets says "Nothing has been lost, and
your records are untouched", which is true and also the most frustrating sentence in the app at
that moment.

**Why it matters** The editions plan decided this explicitly, twice: "the records stay
exportable" is written into the lifetime check-in trade-off (§Licensing), and
`site/faq.html:160` promises a visitor "your records are never affected either way". A gate
that she cannot get a backup out of is not the gate that was decided on. The practical outcome
is worse than "inconvenient": the two things a person does when an app they paid for shows a
paywall over their own data are to clear the site data and to reinstall — and clearing site
data on a device whose records were never backed up anywhere is total, silent, permanent loss.
The honest caveat in `license.js:18-23` says the gate "stops ~99%" and is not meant to be a
vault; that argues for giving her the export, not against it.

**What I'd do** Put one more control on all three walls: "Download a backup of this device"
calling the same export the Import/Export page runs. The pattern already exists on the
activation wall, which opens a cloud modal from behind the gate
(`licenseGate.js:86-94` → `cloudBackupUI.openDevicesFromLicenseWall`), so this is a button and
a dynamic import, not a new surface. While there: the renewal wall has no "Free a lost device's
slot" link, so a lapsed subscriber who also lost a device can reach neither her data nor her
slot.

---

## 4. An unfinished takeover leaves support signed in, and she is given no way to end it  (S2, verified)

**Where** `shared/assets/cloudAssistUI.js:210-220` (the recovery-code loop and `markClaimed`),
`:231-239` (`helpSectionHtml`), `:225-229` (`STATE_LINE`); `cloud/src/assist.js:147-155`
(`markClaimed` is the only thing that revokes in `setup`), `:28-29` (the helper session's 90
days), `:175-182` (`endHelp` *would* work for her in `setup`).

**Scenario** Dana signs in, her key arrives, sync joins, and the app asks for her own recovery
code — correctly, because support's temporary one is still live. She is mid-afternoon and busy.
`newRecoveryCodeFlow()` returns false, the fallback asks "Finish setting up?", she taps
**Later**, and `claimAssistedAccount` returns false at `:215` without ever calling
`markClaimed()`.

`markClaimed` is the only call that runs `removeHelpers` while the program is in `setup`. So
support's helper session stays valid for its full 90 days (`assist.js:134`), support's device
keeps syncing every record Dana enters from now on, and the temporary recovery code support's
device minted still opens her vault. She was warned about the code — "until you make your own
recovery code, support's temporary one still works" — but nothing says support is *still in
her account*.

She goes to Settings → Account to end it, and there is no button there. I ran `helpSectionHtml`
for all five states:

```
setup      -> (NO BUTTON)
requested  -> End help
helping    -> End help
idle       -> Get help
null       -> Get help
```

The line she reads is "KennelOS support is setting up your account." The server would accept
her `POST /assist/end` in `setup` perfectly well (`endHelp` has no state guard and revokes
helpers whatever the state) — the UI simply never offers it. Her only route is to re-open the
app and get through the recovery-code step, which is the step she declined.

**Why it matters** The plan's promise is "either of them ends it". For the one state where
support's access is widest — a program support built, before she has her own recovery code —
she has no control at all, and an idle "Later" is enough to reach it. This also keeps the
automatic-pairing window open indefinitely (plan §4's trade), because `setup` never ends on its
own.

**What I'd do** Show **End help** in the `setup` state too, worded for it ("End support's
access"), and say in `STATE_LINE.setup` that support can see and change her records until the
setup is finished or ended. Separately, make the "Later" branch call `markClaimed()` when the
vault is unlocked and sync has joined — support's access is not what the recovery code is
protecting, and the two decisions should not be bundled.

---

## 5. The takeover's pairing asks again on every page load and rate-limits itself out  (S2, verified)

**Where** `shared/data/cloud/cloudAssist.js:104-117` (`unlockAutomatically`, the
unconditional `requestDeviceUnlock` at `:107`); `shared/assets/cloudBackupUI.js:1673-1678`
(`bootCloud` runs `claimAssistedAccount` on every page load);
`shared/assets/cloudAssistUI.js:191-203`; `cloud/src/vault.js:40,203-205`
(`MAX_OPEN_PAIRINGS = 5`); `cloud/src/ratelimit.js:36` (`pairings: 10` per hour);
`shared/assets/cloudBackupUI.js:129,142` (the words she is shown).

**Scenario** Dana signs in and her takeover starts, but support's device isn't open yet, so
`unlockAutomatically` waits. She does what anyone does with a waiting screen: she looks around
the app. Every navigation is a fresh page load in this multi-page app, `bootCloud` runs
`claimAssistedAccount` again, and `unlockAutomatically` calls `requestDeviceUnlock` at once —
it never consults `pendingDeviceUnlock()`, so each load leaves another ten-minute pairing row
open on the server. I drove the real Worker:

```
1: 200 ok      4: 200 ok               9:  429 too_many_pairings
2: 200 ok      5: 200 ok               10: 429 too_many_pairings
3: 200 ok      6: 429 too_many_pairings 11: 429 rate_limited
```

Six page views inside ten minutes is the fifth row too many. `unlockAutomatically`'s catch at
`cloudAssist.js:114` only swallows `VaultSetupError` and `VaultLockedError`, so the
`CloudRequestError` propagates to `claimAssistedAccount:199`, which shows "That didn't
work" with `errorText(e)` — and `errorText` has no case for `too_many_pairings`, so she reads
**"Cloud backup refused that (too_many_pairings)."** Push on to eleven and the hourly bucket
answers `rate_limited`, which *does* have wording: **"Too many codes requested. Wait an hour,
then try again."** She has requested no codes.

Because the cap is per program and per hour, her private records now stay locked for the rest
of that hour no matter what support does, and the modal re-appears on every page load for the
whole time.

**Why it matters** This is the one flow in the app that a brand-new user meets before anything
else, on a program she has not seen yet, and it fails into repo jargon and then into a wrong
explanation. The limits themselves are right — the bug is asking again when a live request is
already open.

**What I'd do** Make `unlockAutomatically` reuse the open request the way `unlockModal` does
(`cloudVaultUI.js:375` starts with `await pendingDeviceUnlock()`), and only ask afresh once it
has expired. Add `too_many_pairings` and a pairing-specific `rate_limited` to `errorText`
("KennelOS is still waiting for an earlier request — give it a few minutes"), and don't put the
failure in a modal that reappears on every navigation.

---

## 6. The two account-recovery messages are attached to the wrong cases  (S2, verified)

**Where** `shared/assets/cloudBackupUI.js:416-423` (`recoveryErrorText`), `:236` (where the
link is offered); `shared/data/cloud/cloudVault.js:494-517` (which error comes from where);
`cloud/src/recovery.js:47-56,75-80`.

**Scenario** Two breeders press "Lost access to your email?" on the sign-in screen. I ran
both against the real Worker through the client modules:

```
(a) no vault at all            -> RecoveryError no_match
(b) right code, no saved check -> RecoveryError not_ready
(c) right code, check saved    -> OK, proven
(d) wrong code, real vault     -> RecoveryError no_match
```

(a) is a breeder who has cloud backup but never turned Sensitive records on. There is no
recovery wrap, so `/recover/wrap` hands back a stand-in nothing opens and the code reads
`no_match` — whose message is **"That recovery code doesn't match this account. Check it and
try again."** She has no recovery code to check. She will type her password, her backup file
name, anything, because the app has told her she has the wrong code rather than that this door
is not for her.

(b) is a breeder with a real vault from before the account-recovery check existed
(`cloud/tests/vault.test.js` and `tests/cloudVault.test.js:637` cover the usual repair: an
unlocked, signed-in device saves it at its next check-in). Her correct code *did* open her real
vault — the server only lacks `recovery_check_hash` — and `not_ready`'s message is **"This
account can't be recovered with a recovery code. Recovery codes come with Sensitive records,
and none has been set up here."** That is false on its face, and it is the text written for case
(a). No next step is offered, and the step that would fix it (open KennelOS on a device that is
still signed in and unlocked) is the exact thing she does not have — that is the premise of the
screen.

**Why it matters** This is the last door in the product: no email, no signed-in device, one
code on a piece of paper. Both of the ways it can fail tell her something untrue, one of them
in a way that invites her to keep guessing. `cloudVault.js:19` documents the two codes
correctly, so this is purely the UI mapping.

**What I'd do** Swap them, and give each a real next step. `no_match` → "We couldn't match that
code to this account. Recovery codes come with Sensitive records; if you never turned that on,
this can't get you back in — sign in on a device that still has your account, or get in touch."
`not_ready` → "That code is right, but this account hasn't been set up for recovery yet. Open
KennelOS on a device that's still signed in (it finishes the setup by itself), then try again"
— and consider letting `/recover/check` accept a correct wrap-opening code as proof when
`recovery_check_hash` is NULL, since opening the real wrap is already the stronger claim.

---

## 7. Assisted setup dead-ends on `pro_required` after the vault is already on  (S2, verified)

**Where** `shared/assets/cloudAssistUI.js:68-98` (`setUpForHer`, the throw at `:86`);
`cloud/src/sync.js:22,26` (every sync route calls `requirePro`);
`cloud/src/license.js:236-266` (`entitlementFor` / `requirePro`).

**Scenario** Support makes Dana's account in the manager app and opens the link. `setUpForHer`
runs `prepareDirectJoin()`, turns the vault on, then calls `enableSync()`. The server's sync
routes need an entitlement for *her* user — a `pro_purchases` row under her email hash, put
there by the Lemon Squeezy webhook, or an email she linked by code. For a brand-new account
whose purchase the server does not know about yet, that is refused. Against the real Worker,
with no purchase row:

```
Dana: enableSync -> {"status":"refused","code":"pro_required"}
```

and with one inserted exactly as the webhook would:

```
Dana: enableSync -> {"status":"on","pulled":0,"keptOurs":0,"pushed":3}
```

What support sees is `setUpForHer`'s own throw, wrapped in an alert titled **"Setup stopped"**
reading **"Couldn't turn on keeping devices in step (pro_required)."** The program is not left
clean: the vault is already on and backup is already enabled on the helper device, and
`setAssistReady(programId)` was never reached — so the next page load runs `bootstrapHelper`
again, skips the vault (now enabled and unlocked), fails `enableSync` again, and shows the same
alert. Support gets that modal on every navigation with no idea what to do about it.

The plan's §1 has support build her program at step 2 and Dana enter her Pro key at step 4, so
"the purchase is already recorded" is an unstated precondition of step 2. It holds when she
bought under the address support typed and the webhook was live at the time; it does not hold
for a purchase made before the webhook existed (those need the `/ops` backfill —
`cloud/src/license.js:111-120`), for a lifetime order that sends no later event, or if support
builds the program before she buys.

**Why it matters** The one flow intended for the least technical users fails with a server
error code in brackets, repeatedly, after leaving the program half-built — and the thing to fix
is on a different screen (`/ops` → backfill, or waiting for her purchase) with nothing pointing
there.

**What I'd do** Check the entitlement before anything is turned on: `setUpForHer` can read
`GET /account/entitlement` first and stop with "This account has no KennelOS Pro purchase on
record yet — check /ops → Pro purchases, or run the backfill" before the vault is created.
Map `pro_required` in `errorText` while you are there. And set `setAssistReady` for the parts
that did succeed so the alert doesn't repeat on every page.

---

## 8. "Their copy of your records is wiped" is a promise the app cannot keep at the moment it makes it  (S3, verified)

**Where** `shared/assets/cloudAssistUI.js:144` (Hand back's wording), `:148-149` (the offline
return), `:258` (her End help wording); `cloud/src/assist.js:62-71` (`removeHelpers`),
`cloud/src/auth.js:140`; `shared/data/cloud/cloudApi.js:81,118-121`;
`shared/data/cloud/cloudDevices.js:129-144`; `cloud/src/assistApp.js:190` (the manager's
toast).

**Scenario** Dana presses **End help** and confirms "Support's access ends now, and their copy
of your records is wiped." The server revokes the helper sessions immediately — that half is
solid, and `cloud/tests/assist.test.js:123,160,173` hold it. The wipe is not a server action
at all: support's device learns of it only when it next makes a request, hears `401
helper_removed`, which `cloudApi` maps to `CloudErasedError`, which fires the erased handler
and runs `appReset.eraseThisDevice`. If support closed that browser profile for the week, her
contacts, prices, financials and notes sit on support's laptop, decrypted, until it is opened
again — and if that profile is never opened again, indefinitely. The manager app's own toast is
more honest about this ("Your device wipes its copy when it next opens"); the sentence she reads
is not.

The sharper half is support's side. `handBack` at `:148`:

```js
try { await endHelp(); } catch (e) { if (e?.name !== 'CloudErasedError') { await alertModal(…); return; } }
await eraseThisDevice();
```

On a flaky connection `endHelp()` throws `CloudOfflineError`, support reads "That didn't work",
and the function **returns** — help is not ended, the session is not revoked, and the records
are not wiped. Hand back is the only control on the helper bar, and it is the one that does
nothing offline. That is the state finding 1 starts from.

**Why it matters** The claim is unconditional and the mechanism is not, in a sentence whose
entire job is to reassure her about someone else holding her buyers' phone numbers.

**What I'd do** Word both confirmations for what happens ("Support's access ends now. Their
copy is wiped the next time their device opens KennelOS."). Make Hand back erase the device
even when the server could not be reached — the session is already dead or will be the moment
support is online, so the local wipe is the part that must not be conditional — and keep the
`endHelp` call pending (the `setPendingEraseAck` pattern in `cloudDevices.js:166-176` is the
model) rather than abandoning it.

---

## 9. A lifetime key whose variant isn't named "lifetime" walls after three days and is sold a renewal  (S3, verified)

**Where** `shared/data/license.js:67-77` (`detectInterval`), `:37-38` (`GRACE_MS`),
`:301-324` (`offlineVerdict`), `:318-321` (the lifetime branch it misses);
`shared/assets/licenseGate.js:124` (`isStaleLifetime`), `:144-159` (the wall it gets);
`pro/editionConfig.js:62-66`.

The plan's "not findings" list puts `yearlyVariantPattern` / `lifetimeVariantPattern` among the
open launch items, so this is here as the answer to the session's question — exactly what the
breeder experiences today when a real variant name doesn't match — plus the one part that is a
defect regardless of what the patterns are set to.

I ran the real functions over ten plausible store names:

| variant name | interval | online | offline, 4 days | offline, 100 days |
|---|---|---|---|---|
| `KennelOS Pro — Lifetime` | lifetime | valid | valid | grace |
| `Pro (Perpetual)` | lifetime | valid | valid | grace |
| **`KennelOS Pro Forever`** | **monthly** | valid | **wall** | **wall** |
| **`One-time purchase`** | **monthly** | valid | **wall** | **wall** |
| `Pro Yearly` / `Pro — Annual` | yearly | valid | valid | wall |
| **`KennelOS Pro (12 months)`** | **monthly** | valid | **wall** | **wall** |
| **`Pro 1 yr`** | **monthly** | valid | **wall** | **wall** |
| `Pro Monthly` / `Pro` | monthly | valid | wall | wall |

So: **nothing is "silently treated as monthly" in a way she notices while online** — an
unmatched name still validates and still says `valid`, because a lifetime key has no expiry and
`onlineVerdict` returns `valid` for `active` with no expiry. The whole cost lands offline.

- A **lifetime** owner whose variant is named "Forever", "One-time" or anything else outside
  `lifetime|perpetual` gets the monthly three-day window: `offlineVerdict` returns `wall` on day
  four, where the correctly-named key is `valid` to day 90 and in `grace` to day 120.
- A **yearly** subscriber whose variant reads "(12 months)" or "1 yr" gets a three-day grace
  instead of seven, so a lapsed renewal walls on day four where the plan promises a week; I
  checked the online verdict too — `expired`, five days past expiry: `KennelOS Pro (12 months)`
  → `wall`, `KennelOS Pro Yearly` → `grace`.

**The part that is a defect whatever the patterns say.** `isStaleLifetime` detects a stale
perpetual key as `interval === 'lifetime' && status === 'active'`. A misread lifetime key has
`interval === 'monthly'`, so `ensureLicensed` sends it to `renderRenewalWall`: a lifetime owner
who has simply been offline for four days is told **"Your Pro subscription needs attention …
Renew to continue"** with a **"Renew Pro →"** checkout button. The editions plan forbids exactly
this in as many words — "The two walls are not interchangeable … a checkout link there would
read as being asked to pay twice." The wall also has no export (finding 3), so a lifetime owner
who paid once up front is looking at a renewal pitch over records she cannot reach.

**What I'd do** Keep the patterns as the launch item they are, but stop deriving "is this
perpetual?" from the variant name alone where a better signal exists: Lemon Squeezy's payload
distinguishes an order from a subscription, so `recordFromPayload` can mark a record whose
`license_key.expires_at` is null and which never had a subscription as perpetual even when the
name doesn't match. At minimum, widen the default to something like
`lifetime|perpetual|forever|one.?time` and `year|annual|12\s*month|1\s*yr`, and add a test that
asserts the wall chosen for a record whose interval was *misread* — the current suite covers
`detectInterval` and both verdicts thoroughly but never the branch that picks the wall.

---

## 10. An erase never reaches a device that stays away more than 90 days, and support is told it will  (S3, verified)

**Where** `cloud/src/program.js:83-84` (the `account_deletions` rows),
`cloud/src/auth.js:125-128` (where they are read), `cloud/src/retention.js:35,135`
(`ACCOUNT_DELETION_KEEP_DAYS = 90`), `cloud/src/assistApp.js:183` (the toast).

**Scenario** Support deletes Dana's old account with erase on, for the fresh start flow step 1.
One of her old devices is the laptop in the whelping room that nobody opens over the summer.
Against the real Worker, with the deletion row aged to 100 days and `runRetention` run:

```
within 90 days -> 401 {"error":"account_deleted","erase":true}
after retention of a 100-day-old deletion -> 401 {"error":"unauthorized"}
```

A plain `unauthorized` is `CloudAuthError`, which `markSessionExpired` handles: the device keeps
every record and offers to sign in again. The erase simply never happens. The manager app told
support "**1 device(s) will be told when they next open**", `assist_programs` and
`assist_events` for that program are gone, and nothing anywhere records that one device was
never reached.

I checked the near-misses the plan asked about, and they are all correct: a plain **sign-out**
leaves the session row in place, so `authenticate` finds it revoked and answers
`unauthorized` — no wipe (`auth.js:141`); the same for `signout-others`
(`revoked_reason = 'others'`). Only the `account_deleted` code reaches
`onAccountDeleted`, and only `erase: true` reaches `eraseThisDevice`
(`cloudDevices.js:156-160`). `deleteAccount` from her own device passes no `erase`, so her own
"Delete my cloud data" never wipes a device. The erase is checked *before* revoked and expired
(`auth.js:134-137`) so a phone back from beyond its 90-day session expiry still hears a device
erase. That half of §2.5 is right.

Nothing warns anyone about a backup before an erase, either: `onAccountDeleted` wipes on the
spot, and the manager form says nothing about her records.

**Why it matters** The honest version of this limit is already written down for device erase
(`site/faq.html:69`: "the erase can't reach a phone that stays offline or never opens KennelOS
again"). Account-deletion erase has the same limit and a hard 90-day edge, but support is told
the opposite. Keeping her records when the erase expires is arguably the *safer* failure — but
support believes a device was wiped when it was not, which is the wrong belief to hold about
somebody else's data.

**What I'd do** Say it in the toast and the form ("Devices that don't open KennelOS within 90
days keep their copy"), and show the expiry in the manager's program card so support can see
whether every device was actually reached. If a longer reach matters, `account_deletions` is one
small row per session — 90 days is a short window for a tool whose whole premise is that a
device may be offline for a season.

---

## 11. The helper device's licence-gate exemption is a `localStorage` flag  (S4, verified)

**Where** `shared/app.js:133` (`isHelperDevice`), `:156` (`isLicenseGated() &&
!isHelperDevice()`); `shared/data/cloud/cloudAuth.js:59-66,139`;
`shared/data/settings.js:756` (`kennelOS.cloudSession`).

The session asked whether a non-helper can reach the path that skips the licence gate. Yes, and
it needs nothing but devtools. `isHelperDevice()` reads `getCloudSession()?.role`, which is a
field of a JSON blob in `localStorage`; the gate never asks the server what role this session
has. On the built Pro edition with a lapsed record and the licensing API blocked:

```
with role:"helper" in the session blob —
  wall painted: false
  nav children: 1
```

Three lines of `localStorage` — a bogus session object with `role: "helper"` — and the wall is
gone. No licence key, no store round trip, no cloud server: `isCloudAvailable()` isn't even
consulted on that branch. `bootstrapHelper()` then fails for want of a token and is swallowed
by the `console.warn` at `shared/app.js:194`, so the app renders as full, unlicensed Pro.

I am filing this S4 and not higher because `license.js:18-23` is explicit that the gate is a
browser-side soft check a technical person can bypass, and the pre-existing bypass (writing a
`proLicense` record) is no harder. What is worth recording is that the helper exemption added a
*second* bypass, reachable without understanding the licence record's shape at all, in the one
file where a future reader would assume the gate is the only thing being decided. It also means
the only escape from finding 3 today is this hole — which is not an escape anybody should have
to find.

**What I'd do** Gate the skip on something the server said: the helper session has a token, so
`isHelperDevice()` could require a token *and* a role, and `bootstrapHelper`'s first call
(`GET /assist/state`) already returns the server's own `role`. Cache that answer and let the
gate skip only on it, failing closed to the ordinary gate.

---

## 12. A helper device can leave a passkey wrap in her vault, and fill every slot  (S4, verified)

**Where** `cloud/src/api.js:37-47` (`OWNER_ONLY`), `cloud/src/vault.js:151-168` (`addWrap`),
`:38` (`MAX_PASSKEYS = 10`), `:185-193` (removal *is* owner-only);
`docs/KennelOS_Assisted_Setup_Plan.md` §3.

The role gate is otherwise exactly what the plan describes, and I checked every route it names
against a live helper session on the real Worker:

```
helper PUT    /vault/wraps/recovery  -> 403 helper_not_allowed
helper DELETE /vault                 -> 403 helper_not_allowed
helper POST   /vault/handoffs        -> 403 helper_not_allowed
helper POST   /auth/signout-others   -> 403 helper_not_allowed
helper DELETE /account               -> 403 helper_not_allowed
helper POST   /account/email         -> 403 helper_not_allowed
helper POST   /vault/wraps           -> 200 ok      ← not in OWNER_ONLY
helper GET    /vault                 -> 200 ok
helper POST   /vault/pairings        -> 200 ok
helper POST   /program/backing-device-> 200 ok      ← K4 finding 13
helper POST   /assist/end            -> 200 ok
```

The one gap is `POST /vault/wraps`. The plan lists "removing a passkey" as refused and says
nothing about adding one, and `removeWrap` is indeed owner-only. So a helper device that holds
the vault key — which it does, by design — can add a passkey wrap of its own: a durable unlock
credential for her vault, created while help was live and still there after it ends. On its own
it grants nothing, because using it needs a session on her account and the helper's is revoked.
Two smaller consequences are real: she will see a passkey in her list she did not make (and
`addPasskey`'s `label` is support-chosen), and `MAX_PASSKEYS` is 10 per vault, so ten calls
leave her unable to add her own (`too_many_passkeys`) with removal needing a fresh sign-in each
time. Nothing in the app does this — `setUpForHer` uses the code-first flow — so it is reachable
only through the API.

**What I'd do** Add `POST /vault/wraps` to `OWNER_ONLY`: nothing on a helper device needs it,
and the plan's §3 list should name it either way. While editing that set, `POST
/program/backing-device` is still open (K4 finding 13).

---

## 13. The manager app's session cannot be revoked  (S4, verified)

**Where** `cloud/src/assist.js:196-210` (`mintCookie` / `cookieValid`), `:357-365` (login and
the check), `:373-374` (logout).

The cookie is `expires.HMAC(OPS_TOKEN, "assist:" + expires)` with a 60-day life, and
`cookieValid` recomputes that HMAC and checks the timestamp — there is no session id, no
nonce, nothing stored server-side. `api/logout` returns a `Max-Age=0` Set-Cookie and nothing
else, so it signs that browser out and leaves the value itself valid for its full 60 days. A
cookie copied off a shared or stolen support laptop keeps working, and the only revocation is
rotating `OPS_TOKEN` — which also locks support out of `/ops`, the page they would go to in
order to do it.

The rest of the manager's auth is sound and worth recording: the token is compared with
`timingSafeEqual`, the cookie is `HttpOnly; Secure; SameSite=Lax; Path=/manager`, every write
is a JSON POST with an `Origin` check on top of Lax (`:368-369`), `/manager/` is the only HTML
this Worker serves *with* a CSP (`:340`), and the push path carries no payload — the service
worker asks `/manager/api/pending` with `credentials: 'same-origin'` and falls back to a
generic notification if the cookie is dead, so a push never leaks a name to a locked screen.

What raises this above a footnote is finding 2: this cookie is the only thing between a
60-day-old browser session and deleting and erasing any KennelOS account.

**What I'd do** Store a random session id server-side (one small table, or reuse
`rate_limits`-style rows) and have logout delete it, so a cookie can be ended without taking
`/ops` with it. Failing that, shorten the life considerably — 60 days is an installed-app
convenience, and the thing it unlocks does not deserve it.

---

## 14. Two statements the next change will be made against  (S4, verified)

**Where** `pro/editionConfig.js:64-66`; `docs/End_State_Design_and_Maintenance_Guide.md`
§30:2389 (the "Pro on the server" bullet).

1. The Pro config's comment above `lifetimeVariantPattern` still reads: "a license that never
   expires and **never needs online re-validation** (no subscription to lapse)". That stopped
   being true when the lifetime check-in landed: `license.js:48-49,318-321` require a
   successful validate every 90 days, then give a month of grace, then wall. The editions plan
   §Licensing records the change and says "Copy that promises otherwise is part of this
   decision", naming `site/faq.html` and `site/pro.html` as corrected — both are now accurate
   (`faq.html:160` matches the constants exactly). This config comment was missed, and it is
   the copy a developer reads while editing the very pattern that decides whether the check-in
   applies (finding 9).
2. The guide's §30 says the server-side entitlement "gates only server features (the online
   waitlist)". It also gates **live sync** (`cloud/src/sync.js:22`: "Every route needs Pro"),
   **alerts** (`notify.js:211,235,387`) and **integrations** (`integrations.js:127`). The
   assisted setup plan §3 has it right ("the server's own Pro checks use her account's
   entitlement"), which is why finding 7 exists at all — someone reading the guide would not
   expect assisted setup to need her purchase on record.

---

## Notes, not findings

**Losing access: every door, and whether it is explained first.** Worth stating as a whole,
because the answer is good. The vault's unlock paths are the recovery code, any passkey, an
ECDH pairing from another unlocked device, and a one-hour handoff code — and the one-way door
is named before she walks through it: `HONEST_LINE` ("If you lose this code and any passkey you
add, we can't open your sensitive records backup. Nobody can…") appears on the recovery-code
screen *and* in the file she saves and prints (`cloudVaultUI.js:35,107,120`), the code cannot
be skipped (its last four characters must be typed back, `:121-122,138`), and the passkey-first
path keeps the code "unsaved" on the device with Today nagging until she saves it
(`vaultKeyStore.js:64-84`, `cloudVault.js:182-201`). Turning it off needs a typed `TURN OFF`
and says what becomes unopenable and that her device's records are untouched
(`:640-658`). A new recovery code warns the old one dies and, if the fresh sign-in is
cancelled, says "Cancelled: your old recovery code still works" (`:632`). A device whose key
the server no longer recognises forgets it and pauses as locked rather than pushing garbage
(`cloudVault.js:85-88`). I could not find a path where an ordinary action destroys her vault
without a typed confirmation.

**Account recovery exists only for vault users.** The "Lost access to your email?" door is
offered whenever the vault is offered (`cloudBackupUI.js:236`), but it only works for an
account that turned Sensitive records on, because the recovery wrap is the proof. A cloud-backup
user with no vault who loses her address and has no signed-in device has no route back at all.
That is inherent to the §2.7 design, not a defect — but it is the gap finding 6's wording is
supposed to explain, and it is the strongest argument for the passkey-first vault being the
default it now is.

**Passkeys on real platforms.** This is handled with more care than I expected. The
create-then-get dance is there for authenticators that only report PRF support at creation
(`vaultPasskey.js:142-157`): a passkey that reports neither `prf.enabled` nor a result is
signalled as unknown and nothing is saved; one that reports `enabled` without a result takes a
second touch to produce it. `userVerification: 'required'` on both create and get,
`residentKey: 'preferred'` with `allowCredentials` always supplied, so a non-discoverable
credential still works. The RP ID is `kennelos.app` for the parent domain and any subdomain
(`:32-35`), which is a registrable suffix of both `pro.` and `lite.`, so one passkey serves both
editions; any other host falls back to its own hostname, so a passkey made on localhost or a
preview origin won't carry over — documented, and the recovery code is always the backstop.
`passkeySupported()` consults `getClientCapabilities()['extension:prf']` and otherwise just
tries. `NotAllowedError`/`AbortError` both read as 'cancelled' with wording that covers "or
none for this account is on this device", which is the honest thing to say since browsers won't
distinguish. Two small rough edges: `createPasskey` names the credential after
`account?.email`, which is null on a helper device and after an email change
(`cloudAuth.js:118` blanks it), so such a passkey shows in the password manager as plain
"KennelOS"; and `forgetAllPasskeys` depends on `signalAllAcceptedCredentials`, which today means
Chrome with Google Password Manager — on iOS/Safari and most desktop managers the passkeys of a
deleted account stay in the keychain for her to delete by hand, which the guide does say
("best effort").

**What a helper can see, and one sentence that oversells the boundary.** A helper device reads
and changes every record through sync, including everything the vault seals, because it holds
the key. `setUpForHer`'s alert tells support "Her Jotform and Stripe keys can only be entered
on her own device" (`cloudAssistUI.js:92`), which is true of the API keys — both live in
`device_secrets` and are in no export, snapshot, sync or restore. But `accounts.username` and
`accounts.password` are ordinary record fields classified `private` in
`syncRegistry.js:324`, so her Stripe and Jotform *dashboard logins* do sync, sealed under the
vault key the helper holds — and `vendorKeyUI.js` puts them on screen beside the steps for
making a key. The boundary that sentence implies is narrower than it sounds. By the plan's own
model ("reads and changes every record") this is in scope rather than a defect, but the wording
invites a false sense of it.

**"Nothing but the one-time link makes a helper" — confirmed.** `redeemLink`
(`assist.js:115-138`) is the only writer of `role = 'helper'`, and `authenticate` reads the
role from the session row, never from the client (`auth.js:132`). Links are minted only by the
manager app behind `OPS_TOKEN` (`newLink`, `startSetup`, `linkFor`), are burned by a `DELETE …
RETURNING`-style check before expiry is tested, so they work exactly once, and are refused for a
program in `idle` — so after she takes over or ends help, an outstanding link is dead. The token
is 64 hex characters, validated by regex on both sides, and `stripAssistToken` removes it from
the address bar so a reload or a screenshot can't replay it. A leaked or forwarded link inside
its 15 minutes is a full helper session on her account, which is inherent to the design; what
bounds it is the 15 minutes, single use, and that the program must already be in a state that
invited help.

**Fresh sign-in.** `requireFreshSignIn` passes with no emailed code for any session created in
the last 15 minutes (`auth.js:174`). A helper session is brand new, so I spent a while on
whether a helper gets a free 15-minute window over the actions that check exists to protect —
replacing the recovery wrap, removing passkeys, turning the vault off, signing other devices
out, deleting the account. It does not: `OWNER_ONLY` is checked in `api.js:82` *before* any of
those handlers run, and the probe in finding 12 confirms all five answer 403. The layering is
the right way round.

**The vault's rate limits** are sensible for what they protect: 30 wrap reads, 10 pairings, 10
handoffs per program per UTC hour, and only `getWrap` and `redeemHandoff` — the two routes that
hand out wrapped bytes — are metered. `MAX_OPEN_PAIRINGS` 5, `MAX_OPEN_HANDOFFS` 5, and both
tables are swept daily. The caps are not the problem in finding 5; asking again when a request
is already open is.

**Mistyping the pairing code is handled well.** The approver cannot check the code, so a wrong
one yields a wrap the asking device can't open. `pollPairing` deletes the row as it answers, so
a failed attempt doesn't leave an open pairing behind, and `unlockModal` shows "The code typed
on the other device didn't match. Here's a new one: type it carefully" with a fresh code
(`cloudVaultUI.js:425-428`). Ten attempts in an hour will still meet the hourly bucket and the
wrong "Too many codes requested" wording, which is the same wording bug as finding 5.

**`cloudVaultUI` and `cloudBackupUI` escaping.** Every user value I traced in these two files
goes through `esc()` — kennel name in the turn-off confirm, the recovery code, the pairing code,
the new email in the recovery screens, passkey labels. The one thing to keep in mind is
`cloudAssistUI.js:130`, which `esc()`es `herName()` (support-typed) correctly.

**`disableVault` and an older snapshot.** Turning the vault off deletes every wrap, so the
sealed part of snapshots already in R2 can never be opened again; they age out on retention.
A restore after that skips the unlock question (`unlockBeforeRestore` returns null when the
vault isn't enabled) and brings back contacts with no phone numbers. The turn-off alert does
tell her to keep a file backup first, which is the right place to say it — but whether the
restore itself explains the blanks is a K2/K3 question (`setCloudRestoredAt` /
`renderPrivateGapHint`), not one I chased here.

**A monthly subscriber in good standing is walled after three days offline.**
`offlineVerdict` gives a monthly record a three-day window from `lastValidated`
(`license.js:322,37`), regardless of the subscription being perfectly current, and the wall she
gets says "We couldn't confirm an active subscription". The editions plan decided that window
deliberately, and `faq.html:160` states it, so it is not a finding — but it is the most innocent
route into finding 3, and it is the one that will happen most often.

---

## Coverage gaps I found (tests that should exist)

- **No test of the licence gate's UI at all.** `tests/license.test.js` and
  `licenseRevalidate.test.js` cover `detectInterval`, both verdicts and the cache rules
  thoroughly (24 cases), but nothing exercises `ensureLicensed`, so nothing asserts which wall
  a given record gets, that a wall offers a route to her data (finding 3), or that a misread
  lifetime key doesn't land on the renewal wall (finding 9).
- **No test that a helper device must not carry records between programs** (finding 1). The
  harness is already there: `tests/cloudClient.test.js:752` builds a support device that puts a
  dog, and a second `redeemAssistLink` plus a `sync_records` assertion is a dozen lines.
- **No client-side test of `claimAssistedAccount`'s recovery-code loop** (finding 4) — in
  particular that declining it leaves help live, and that the Account card offers a way out.
  `helpSectionHtml` is a pure function and should be asserted for all five states.
- **No test of the pairing caps from the client's side** (finding 5): that
  `unlockAutomatically` reuses an open request, and that `errorText` has words for
  `too_many_pairings`.
- **No test of `recoveryErrorText`'s mapping** (finding 6). `cloud/tests/recovery.test.js`
  covers the server's three codes; nothing asserts which sentence each one produces, which is
  where the bug is.
- **No test of the `pro_required` path through assisted setup** (finding 7):
  `cloud/tests/assist.test.js` never gives the account an entitlement, so the suite passes
  while the real flow stops.
- **No test that `OWNER_ONLY` is complete.** `cloud/tests/assist.test.js:102` asserts a fixed
  list of routes answers 403; a test that walks the router's own route table and asserts every
  vault-mutating or account-mutating route is either owner-only or deliberately listed as
  shared would have caught `POST /vault/wraps` (finding 12) and `POST
  /program/backing-device`.
- **No test of the 90-day edge on `account_deletions`** (finding 10):
  `cloud/tests/accountDeletion.test.js` covers the within-window case and
  `retention.test.js` the purge, but not that the purge turns an erase into a plain sign-out.

## What I did not get to

- **Real devices.** Everything about passkeys here is read from the code against what the
  platforms document; I did not drive WebAuthn PRF on an actual iPhone, Android phone or
  desktop password manager, which is the one part of this session that cannot be settled in a
  headless Chromium. README Status already lists real-phone checks as outstanding.
- **The manager app on a phone.** I read `assistApp.js` for its auth, its service worker and
  its push path, but did not open `/manager/` at 320px or install it to a home screen, so I
  have nothing to say about its layout or the iOS install prompt it mentions.
- **The vault's interaction with the restore paths.** Whether a restore after the vault was
  turned off explains the blank private fields it leaves belongs to K2/K3's `cloud-merge` /
  `vault-merge` work; I stopped at the turn-off wording.
- **`/ops`'s own licence and purchase sections.** K4 reviewed `/ops`; I only read the parts
  `cloud/src/license.js` feeds (the backfill and the linked-hash count).
- **The `pro_purchases` backfill against the real Lemon Squeezy API.** I read it and the
  decision behind it but made no live call, so I cannot say whether a pre-webhook lifetime
  order actually comes back in the shape `orderRow` expects — which is the precondition finding
  7 turns on.
