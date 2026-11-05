# KennelOS — Assisted setup and help from KennelOS support

> **Status: built (2026-11-04), not yet tried with a real user.** Asked by the owner for a
> user who struggles with setup: support sets her program up from a device of its own,
> hands it over, and can come back in when she asks. Builds on cloud accounts and devices
> (`KennelOS_Cloud_Phase1_Plan.md`, "Phase 1 §N"), the private vault
> (`KennelOS_Private_Vault_Plan.md`, "Vault §N") and live sync
> (`KennelOS_Cloud_Phase2_Sync_Plan.md`, "Sync §N").
>
> **Modified:** the first draft of this plan had her start help with a code she reads out,
> and kept her account. The owner's flow (below) has support make the account, and moves
> the vault key between her devices and support's with no typed code (owner's decision,
> 2026-11-04; §4 says what that trades away).

## 1. The flow

1. **Support deletes her old account(s)** in the manager app (or on `/ops`) with **erase its
   devices** on. Her devices wipe themselves when they next open, free their Pro
   activations and drop that account's passkeys (`account_deleted {erase}`).
2. **Support makes her account** in the manager app: her email and a name only support
   sees. The server creates the account and program and gives a **one-time link** (15
   minutes). Support opens it in KennelOS Pro, in a browser profile kept for her alone.
   That device is now a **helper** on her account. It turns on private records (a
   recovery code nobody needs to keep) and keeping devices in step, then support sets
   everything up as she would. Her Jotform and Stripe keys stay hers to enter: they're
   kept only on the device that enters them (Integrations plan D16).
3. **Support tells her to open KennelOS on her devices.** The old ones erase themselves
   (step 1).
4. **She enters her Pro key as a new user**, chooses **I already use KennelOS** and signs
   in with her email.
5. **The app sees it's an assisted account** (`/auth/verify` answers `assisted: true`) and
   runs her takeover in place of a restore:
   - her private records' key comes from support's device by an automatic pairing (§4;
     support's device must be open: the manager app says so the moment she signs in);
   - she joins sync, so every record comes down;
   - she makes **her own recovery code** (required; support's temporary one stops
     working);
   - `POST /assist/claimed` signs support's device out. It wipes its copy when it next
     opens.

   An interrupted takeover finishes on her next load (`bootCloud`).
6. **Later, Get help** (Settings → Account): she presses it, the manager app notifies
   support, support makes a link, opens it on a fresh helper profile, and her app hands
   that device the key by itself while it's open. Either side ends it: her **End help**,
   support's **Hand back** (in-app bar) or **End help** (manager app). Ending signs the
   helper out and its copy is wiped.

## 2. The manager app (`/manager/`, `cloud/src/assist.js`, `assistApp.js`)

An installable page served by the cloud Worker, for support only. Signed in with the ops
token (a 60-day cookie, `Path=/manager`), installable to a phone's home screen, with web
push through the same VAPID key as app alerts.

- **Waiting for you:** users who pressed Get help.
- **Start an assisted setup:** name + email → account and link.
- **Each user:** state (Setting up, Hers, Asked for help, You're helping), when her devices
  were last seen, whether a helper device is signed in, the last events, **Make link**,
  **End help**.
- **Delete an account:** by email, with **erase its devices**, typed DELETE.
- **Notifications** for: she signed in on her device (keep the setup device open), she
  took over, she asked for help, she ended help.

## 3. What a helper can and can't do

A helper session is a session on her account with `role = 'helper'` and the label
"KennelOS support (…)". It reads and changes every record through sync. Refused with
`403 helper_not_allowed`: signing others out, deleting the account, changing its email,
license links, turning the vault off, replacing the recovery wrap, removing a passkey,
making handoff codes, turning sync off everywhere, erasing devices. On support's device the
license gate is skipped: the server's own Pro checks use her account's entitlement. Its website checks
skip it too: support can Connect website (with a code from KennelPort, which an editor of
her site can make) and Update website. That link is the helper device's own: it is wiped with
the device, and each of her devices connects with its own code.

Ending help revokes the helper sessions with `revoked_reason = 'helper_removed'`; the
device's next request hears `401 helper_removed` and runs the device erase.

## 4. The vault key: automatic pairings

The vault's pairing (Vault §5.3) normally needs a 12-character code typed on the approving
device, so a breached server can't swap in its own key. For assisted programs the owner
chose no code: the asking device posts its code with the request (`autoCode`), and the
server shows it only to the other side, only while the program allows it:

| Program state | Who may ask automatically | Who sees the code and approves |
|---|---|---|
| `setup` | her device (owner) | support's device (helper) |
| `requested`, `helping` | support's device (helper) | her device (owner) |
| `idle`, or no assist row | nobody: the code is dropped | — |

Approval runs by itself (`startAssistLoops`, every 5 s while the page is visible). **The
trade-off:** in those windows, someone in control of the server could pose as the other
side and receive the key. Outside them the vault's guarantee is unchanged.

## 5. Server

Migration `0020` (shared with account deletion): `sessions.role`; `assist_programs`
(program, label, state); `assist_links` (one-time, 15 minutes); `assist_events` (kinds
only, 180 days); `assist_push` (the manager's subscriptions); `vault_pairings.auto_code`
and `asker_role`. Deleting an account removes its assist rows. Nothing stores or logs her
email.

Routes: `POST /assist/redeem` (no bearer; the link), `GET /assist/state`,
`POST /assist/claimed`, `POST /assist/help`, `POST /assist/end`; the manager's
`/manager/api/*` (login, programs, start, link, end, delete, push, pending).

## 6. App

`data/cloud/cloudAssist.js` (no DOM) and `assets/cloudAssistUI.js`: the link at boot
(`app.js`, before the license gate), the helper's one-time setup and the "Helping …" bar,
her takeover from "I already use KennelOS", Get help / End help in Settings → Account, and
the automatic approvals.

## 7. Open questions

1. The label her devices show: "KennelOS support", or the owner's own name?
2. Does anyone else ever help? A second support person would need their own sign-in to
   the manager app.
3. Should a user who never had assisted setup see Get help at all, or only invited ones?
   (Built: everyone with keeping devices in step.)
