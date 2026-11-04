# KennelOS — Assisted setup and ongoing help (plan)

> **Status: planned, nothing built.** Asked by the owner (2026-11-04) for one user who is
> struggling with the setup and wants the owner to configure her program for her (waitlist,
> settings, kennel, records) and to stay on afterwards for future help. Builds on cloud
> accounts and devices (`KennelOS_Cloud_Phase1_Plan.md`, "Phase 1 §N"), the private vault
> (`KennelOS_Private_Vault_Plan.md`, "Vault §N") and live sync
> (`KennelOS_Cloud_Phase2_Sync_Plan.md`, "Sync §N").

## 1. What it is

A user can let **KennelOS support** (the owner, signed in to `/ops`) work in her program as a
**helper device**: a device on her account that syncs like her own, with the vault key, so
it can see and change everything she can, until she removes it. One action on her side
starts it; one button ends it.

- **For her:** one tap to let support in, a code to read out, then a program that's set up
  when she next opens it. Later, a **Remove access** button whenever she wants.
- **For the owner:** her program on a device of his own, edited through the ordinary app,
  synced to her devices as he goes. No backup files, no screen-sharing, no knowing her
  sign-in code.

Not in scope: helpers other than KennelOS support, a helper for accounts without cloud
backup, and anything that lets support reach a program without her starting it.

## 2. The first case (why it's shaped this way)

- She has a Pro license key and a cloud login already.
- She may have entered a dog while trying the app; she has no records she wants kept.
- She wants the owner to stay on for future help, so access lasts until she removes it,
  not for a fixed few days.
- Some of what she wants set up (prices, contacts' details and other **private** fields,
  Phase 1 §5) syncs only inside the vault's sealed part (Sync §4.1). So her program needs the
  vault on, and the helper device needs her vault key.
- The owner knows her personally and is on the phone with her for the start.

## 3. Starting help (her side, then his)

1. **Her prerequisites,** done with him on the phone if needed: cloud backup on, live sync
   on, and the vault on (Vault §2.1). She keeps her own recovery code; support never sees
   it and doesn't need it.
2. **She taps Settings → Cloud → Help from KennelOS support → Let support help.** The
   screen says what it means, in plain words: *"KennelOS support will be able to see and
   change everything in your program, including private details, from their own device,
   until you remove their access. They can't change your email, your sign-in, your vault
   or your license."* She taps **Allow** and her device shows a **help code** (eight
   characters, one hour, one use).
3. **Her device makes the code** the way a vault handoff code is made today (Vault §5.4):
   it wraps her vault key for the code, and the server stores the wrap with a hash of the
   code and the fact that it's a *helper* code. The server never sees the code or the key.
4. **He opens `/ops` → Help a user → enter the code,** in a browser profile kept for her
   alone (§6). Redeeming needs an `/ops` session as well as the code, so a code read out
   or overheard is useless to anyone else.
5. **The server starts a helper session on her program** for that device (§5), and hands
   back the vault wrap once. His device unwraps her vault key, joins her program by live
   sync (Sync §5.5, joining and catching up) and opens it.

Her devices show **KennelOS support** in the device list from then on, labelled as a
helper, with its last activity.

## 4. A clean slate, without wiping anything

She has nothing to keep, but her program may hold a stray dog. **The helper deletes it**
through the ordinary app, and sync carries the deletion to her devices (Sync §5.4). No device wipe:

- a wipe of her device would also drop her vault key and anything kept only on that device,
  so she'd have to unlock again;
- and it wouldn't clear the cloud copy, which would bring the dog straight back.

If a future user has many records to discard, the same holds: delete in the app (or a
helper-only **Clear this program** that archives every record in one go, built only if
it's needed). Nothing in this plan wipes a device except §7's removal of the helper's own.

## 5. What a helper session can and can't do

A helper session is an ordinary session on her program with `role = 'helper'`:

| Can | Can't (owner-only, refused with `helper_not_allowed`) |
|---|---|
| Read and change every record, private ones included, through sync | Change the account's email (Phase 1 §2.6) |
| Upload files and photos | Turn the vault off, replace the recovery wrap, add or remove passkeys (Vault §6.1) |
| Change kennel settings, waitlist setup, forms, templates, everything that syncs | Erase or sign out her devices (Phase 1 §2.5) |
| See her device list (to check her phone is syncing) | Manage the license or its activations |
| End its own access (**Hand back**, §7) | Delete the account, run account recovery (Phase 1 §2.7) |
| | Approve vault pairings or make handoff or help codes |

**Pro without a seat.** The helper device doesn't activate her license and doesn't count
toward her activations. On a helper session the server's answer carries
`helper: { pro: true|false }`, read from her account's license, and the app's license gate
accepts it in place of an activation on that device only, and the server's `requirePro`
on the sync routes (Sync §6.1) reads her account's license for a helper session. If her license lapses, the
helper device falls back to Lite like hers.

**Kept on her device only, so not reachable by a helper:** whatever lives in
`device_secrets` (her Jotform and Stripe keys, Integrations plan D16) and device
preferences in `settings.js`. Those never sync, vault or not. To set up an integration he
walks her through pasting the key on her own device, or she reads it to him and he enters
it on hers when they're together. This plan doesn't change that rule.

## 6. His side

- **One browser profile per user he helps,** named for her. Removing access wipes the
  KennelOS storage of that profile's origin (§7); in his everyday profile it would take
  his own program with it. `/ops → Help a user` says so beside the code box.
- **`/ops → Users I help`:** each program with a helper session: her name as she set it,
  when help started, his device's last sync, and **Hand back** for each.
- **What he changes is listed for her** (§8), so he can always point to what he did.

## 7. Ending help

**She taps Remove access** (Settings → Cloud → Help from KennelOS support), or **he taps
Hand back** on `/ops` or in the app. Either one:

1. revokes the helper session on the server at once (`revoked_reason = 'helper_removed'`):
   every later request from that device meets `401 helper_removed`;
2. deletes any help code or vault wrap still waiting for it;
3. and when his device next opens, it wipes that program's local data and the vault key it
   held, acknowledges, and shows "Your access to <her kennel> has ended." (The same path
   as a device erase, Phase 1 §2.5.)

**Blocking:** Remove access also turns off **Let support help**, so no new help code can be
made until she turns it on again herself. Support has no way to add itself: every start
is a code made on one of her devices.

**Her vault key after removal.** His device held the key while helping. Without a session
it can't download anything, so the key alone opens nothing, and his device wipes it. She
doesn't need a new vault key. If she ever wants one anyway, that's the vault's own re-key
(Vault §6.4), not part of this plan.

## 8. Her view while help is on

Long-running help mustn't nag, so no permanent banner:

- **The device list** shows KennelOS support as a helper, with **Remove access** beside it.
- **Changes by KennelOS support:** a list under Help from KennelOS support of what the
  helper changed, newest first ("Waitlist questions: 3 added · Nov 4"), worked out on her
  device from sync's own record of which device sent each version (`device_id`, Sync §6.2). The server
  can't read private changes and doesn't try.
- **Today, after he's made changes** she hasn't looked at: one line, "KennelOS support
  made 12 changes since you last looked", linking to that list. It goes once she opens it.
- **An app alert** (if she has alerts on, Notifications plan) only when help starts and
  when it ends, not for each change.

## 9. Server (`cloud/`)

One migration (per `CLAUDE.md`, at most one on the branch):

- `sessions.role TEXT NOT NULL DEFAULT 'owner'` (`owner` | `helper`), and
  `sessions.helper_label` for how her devices name it.
- `programs.helper_allowed INTEGER NOT NULL DEFAULT 0`: her **Let support help** switch.
- `help_codes`: `id`, `program_id`, `code_hash`, the vault wrap and its `key_id`,
  `created_at`, `expires_at` (one hour), `redeemed_at`. Read once and deleted, like
  `vault_handoffs`; expired rows go in the daily retention run.

Routes (bearer token; behind the maintenance gate):

| Route | Who | Does |
|---|---|---|
| `PUT /help/allowed {on}` | Owner session | Her switch. Off also revokes any helper session (§7) |
| `POST /help/codes {codeHash, wrapped, keyId}` | Owner session, switch on | Stores a help code. At most one open per program |
| `POST /help/redeem {code}` | `/ops` session | Checks the code and the switch, starts a helper session for the calling device, returns the session token and the wrap, deletes the code |
| `DELETE /help/sessions/:id` | Owner session, or that helper session, or `/ops` | Ends help (§7) |
| `GET /help` | Owner session | Whether the switch is on, the helper session if any (label, started, last seen) |

Every owner-only route in §5's right-hand column checks `role` and refuses a helper with
`403 helper_not_allowed`. Nothing logs a code, a wrap or a body. Rate limits as for vault
handoffs (Vault §6.4). `/ops` gets **Help a user** and **Users I help**, and counts of
helper sessions on its health page.

## 10. Client (`shared/`)

- **Settings → Cloud → Help from KennelOS support:** the switch, **Let support help**
  (shows the code), the helper's line with **Remove access**, and **Changes by KennelOS
  support**.
- **The license gate** accepts a helper session's `helper.pro` (§5).
- **On a helper device:** a slim bar on every page, "Helping <her kennel> · Hand back", so
  he never mistakes her program for his own; and the owner-only screens of §5 hidden.
- **The helper-removed answer** runs the erase path for that program (§7).
- The help code reuses the vault handoff's wrap code (`vaultCrypto`); nothing new in the
  crypto.

Docs in the same change as the build: the End-State guide (cloud section: roles, the
helper bar, the change list), `cloud/README.md` (routes, migration), and the privacy page
(a line that support can help only when the user turns it on, sees what she sees, and that
removing access wipes support's copy).

## 11. Build order

1. Server: the migration, `/help` routes, role checks on owner-only routes, `/ops` screens.
   Tests for each refusal.
2. Client: the Help from KennelOS support screen and the code (her side).
3. Client: redeeming on `/ops`, the helper session's join, the license gate, the helper bar
   (his side).
4. Ending help: Remove access, Hand back, the helper-removed wipe. Test on a real phone
   that his profile's data goes and hers stays.
5. Changes by KennelOS support, the Today line, the start and end alerts.
6. First run with her, on the phone: prerequisites, code, delete the stray dog, set up.

## 12. Open questions

1. The label her devices show: "KennelOS support", or the owner's own name?
2. Should **Let support help** stay on after help starts (so a new code can be made later
   without turning it on again), or switch itself off once a helper is in?
3. Does anyone else ever help (a second support person)? If so, a helper session names who,
   and her list shows each.
4. If she turns on cloud backup only later, is help offered before then with a one-off
   restore instead? (Proposed: no; help needs sync.)
