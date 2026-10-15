# KennelOS — Kels Roadmap

What Kels does next, in the order we'd build it. Kels is today's helper (End-State guide §33):
a **scripted** chat, not a model, that walks the breeder through a task and writes through
the same repos as every page. This doc proposes her next tasks and the shared pieces they
need. When one is built, its as-built description goes in the guide (§33) and its history in
`docs/BUILD_LOG.md`; this doc then marks it **Built** with a pointer.

## 1. Where she is

| Task | What it does | Editions |
|---|---|---|
| Record a new litter | Parents, breeding, birth, each pup, plans, prices; resumable draft | All (outside dogs, stud, "let families know": Pro) |
| Check in on a litter | Weights, health care, plans, chips, dates, status; picks, Weaning/Ready/Sold/close; pickup, boarding, delivery | All (open picks: Pro) |
| Tidy up my records | Records that disagree, duplicates, merge | All (stud, contacts, kennels: Pro) |
| Finish an unfinished litter | Resumes the litter draft | All |

The menu has a search box that matches each task's `keywords`, and choices open their
description on the first tap.

## 2. Rules every new task follows

These are settled. A task that can't follow one comes back here before it's built.

1. **Scripted.** Every line is written in the task script. Nothing leaves the device unless the
   task uses a feature that already does (cloud, a vendor), and then only that feature's calls.
2. **Ordinary writes.** Pages → repos → Dexie. A task never writes a table directly, never gets
   its own copy of a rule, and puts any new rule in a pure, tested `data/` module that the
   matching page uses too.
3. **Edition-honest.** A task, step or option for a feature the edition lacks is never shown,
   searched, or mentioned (`editionFlags`, `proPages.js`). In Lite, the cap is never worked
   around. At the cap, Kels shows the standard upgrade notice (`renderUpgradeNudge`) and moves
   on. She never says what doesn't count toward the limit, and never suggests a status,
   ownership or archive to get under it.
4. **One thing at a time, saved as approved.** Each answer is saved when given, or the task
   keeps a resumable draft (`resumable`) when a half-saved state would be wrong.
5. **Kels-only checks stay in Kels.** Her findings aren't Today nudges unless we decide one
   should be.
6. **Every task has `keywords`** in the menu, and every new page a task can open is in
   `PRECACHE_URLS` (and `proPages.js` if Pro-only).

## 3. Proposed tasks, in build order

Sizes: **S** a few days of work, reusing what exists; **M** a new data module and a
script; **L** needs a feature that isn't built yet.

### 3.1 Prep pups for leaving: **M**, Pro (Puppy Record), the rest all editions
The run-up to go-home day for one litter, ending with the printed records.

- **Asks which litter** (litters with pups at home, like the check-in's list), then which
  pups (default: every pup with a sale at Deposit paid or later; any pup can be ticked,
  with or without a sale).
- **Readiness check per pup**, each a one-tap fix or a link:
  - microchip on file;
  - shots and deworming logged (the check-in's health-care forms);
  - a pickup on the calendar (`goHome`);
  - balance paid, or the balance-due date set;
  - contract signed (Pro, `contracts`);
  - registration type on the sale;
  - Furever seed link sent (Pro, `furever`) and feeding schedule set (`feedingSchedule`).
- **Print puppy records:** one file for the chosen pups, one pup per page run, with a page
  break between pups. Today `pages/puppy-record.html?sale=<id>` prints one sale. Build:
  `?dogs=<id>,<id>…` renders each pup's record in its own `<section>` with
  `break-before: page` (not on the first) and prints once (`?autoprint=1`). A pup's sale is
  found from the dog (its live or delivered sale); **a pup with no sale prints too**, without
  the buyer block. `?sale=` keeps working. Kennel fields
  (`puppyRecordShows`) apply to every pup. The same picker goes on the Sales page's Print
  Puppy Record. The whole print step is Pro-only (`editionFlags.puppyRecord`); in Lite the
  readiness check runs and the print option doesn't exist.
- **Keywords:** go home, leaving, pickup day, puppy records, print, packet, paperwork.
- **Open:** include the readiness summary as a cover page for the breeder?

### 3.2 Check account health: **M**
One look at whether her program is safe and working, as findings with fixes (the tidy-up's
pattern: a pure `data/accountHealth.js` of checks, the task asks one at a time).

- **This device:** browser storage is persistent (`navigator.storage.persisted()`, offer
  to request it), space used, the app is up to date (a waiting service worker → reload).
- **Backup:** cloud backup on, last success, paused or behind (`cloudBackup`); no cloud,
  then the last JSON export's age, with an offer to export now.
- **Pro license** (`licenseGate`): active, renewal date, devices using it, and a lost
  device to free (`cloudDevices`).
- **Sensitive records** (Pro): on, recovery code saved, a passkey on this device.
- **Sync** (Pro, after Cloud Phase 2 step 6): in step, changes waiting, devices not seen
  in a while.
- **Connections** (Pro): Stripe, Jotform, Dropbox keys present and still accepted; the
  waitlist online and receiving (`cloudWaitlist`).
- Ends with "All good" or a short list of what's left.
- **Keywords:** backup, safe, license, subscription, storage, sync, devices, health, status.
- **Decided:** "account" is her KennelOS account and this device, as above. The business
  Accounts page (vendor logins, referral codes) isn't part of it.

### 3.3 Set up my waitlist: **M**, Pro (`waitlist`)
The Waitlist page's settings as a conversation, for a breeder starting from nothing. It comes
before Record a sale (§3.5) on purpose: a running waitlist turns picks into sales by itself,
so it saves her more sale entry than a sale task would.

- Which kennel (multi-kennel) → programs (`waitlist_programs`: names, breeds/sex if any) →
  the application fee (`fee_amount`, credit policy, due days, how it's paid: payment
  instructions or a Stripe link, `waitlist_fee_account_id`) → offer rules (`respond_days`,
  `max_passes`, no-response-counts-as-pass, auto offers) → going online (`online`,
  `online_form`, intro text, Facebook button, embed) → bring families she already has
  (adds a few by hand, or opens the waitlist import).
- Each answer saves through `kennelRepo` / `waitlistProgramRepo` with
  `waitlistRules.WAITLIST_CONFIG_DEFAULTS` shown as the suggestion. Online steps need the
  cloud (`isCloudAvailable()`) and are skipped, not shown, without it.
- Re-runnable: on a list that's already set up, she says what's set and asks what to change.
- **Keywords:** waitlist, wait list, applications, deposit list, reservations, families, fee.

### 3.4 Set up another device: **L**, all editions (each branch gated)
Three different things people mean, asked first:

- **"Moving to a new phone or computer"**: in every edition, cloud backup → sign in on the
  new device → restore (Phase 1 §3.4), with a QR or link to the app's address. Without the
  cloud, export a JSON backup here and import it there.
- **"Using KennelOS on two devices"** (Pro): the same, then Sensitive records unlocked on the
  new one. This device approves it with the code the new one shows (`cloudVault`
  "unlocking from another device"), so Kels runs the approve step right here. Then "Keep
  this device in step". The keep-in-step part **needs Cloud Phase 2 step 6** (the sync UI).
  **Decided:** ship the task before that; until then this branch stops after the restore and
  unlock, and says keeping devices in step is coming.
- **"A helper's phone"** (Pro, `assistant`): KennelAssistant: connect Dropbox, send the
  dogs, and how the helper opens it (§26).
- On the new device itself, Kels's menu offers **"Set up this device"** when the program is
  empty and there's no sample data: sign in and restore, or "I'm new" → first-run.
- **Keywords:** new phone, new computer, laptop, tablet, second device, transfer, move,
  restore, helper, sync.

### 3.5 Record a sale: **M**, all editions
Pup → buyer (existing contact, or a new one checked for duplicates with the tidy-up's
matching) → registration type and price (prefilled from the litter's
`expectedPricing`) → deposit → contract (Pro) → payment link (Pro, Stripe) → mark Placed.
Hands off to Prep pups (§3.1) when the litter is near ready.

### 3.6 Log a heat or breeding: **S**
Heat start → (later) breeding dates and method → stud service if outside (Pro) → the
pairing with its due date → an Expected litter. Hands off from the heat→pairing nudge's
situation; the check-in's Expected litter hands off to the birth as today.

### 3.7 Check in on a dog: **S**
The litter check-in's health-care and weight forms for one adult dog, plus health tests
(`planned_tests` → results), and status changes (retire, pet home).

### 3.8 Add dogs: **S**
One dog or several in a row ("Add another?" after each). Typed in (duplicate check first,
`dogMatches`), or from a pedigree photo (`pedigreeImport`), with parents through the
tidy-up's parent steps and the dog's kennel, ownership and status. In Lite, at the cap she
shows the upgrade notice (§2.3) and stops adding.
- **Keywords:** new dog, add dog, bought a dog, new female, new male, stud, import pedigree.

## 4. Shared pieces

- **Search words are ours.** **Decided:** only we add `keywords` (in `TASKS`); breeders
  don't add their own. An empty search that a breeder would plausibly type is a keyword we
  add in the next release.
- **Her favorites first.** Two ways a task moves up her menu, both device-local in
  `settings.js` (her habits on this device, never in a backup or synced):
  - **Star:** a ☆ in the corner of each menu button (its own tap target, so starring never
    opens or starts the task) toggles `kelsFavorites`. Starred tasks sit at the top.
  - **Frequent:** each task start is counted (`kelsTaskUse`: id → dates of recent starts).
    A task started **more than 3 times in the last 60 days** gets a priority override and
    sits just under the starred ones, marked "You use this often". Unused for 60 days, it
    drops back on its own. She can turn a frequent one off ("Don't move this up"), which
    stops it being promoted again until she stars it.
  - **Order:** unfinished work (a resumable draft) → starred → frequent → the state-based
    `priority` the menu uses today. Within a group, the state-based priority decides. A
    task that isn't `available` never shows, starred or not.
  - **Open:** is 60 days the right window, and should a menu with stars show the rest
    folded under "More"?
- **Task handoffs** grow (sale → prep pups; heat → breeding → litter). `handoff(taskId,
  opts)` already exists; each task documents what `opts` it takes.
- **Suggested next task:** the menu's `priority` already reads state. Add "pups leave in a
  week" (prep pups), "backup failing" (account health), and "families waiting, no list set
  up" (waitlist) as priority bumps, never as nudges.
- **One findings framework:** tidy-up and account health share the "findings → ask one at a
  time → fix → look again" loop. Pull it out of `tidyUpUI.js` when the second one is built,
  not before.

## 5. Decisions and open questions

Decided:
- Prep pups prints pups with no sale (no buyer block).
- Account health is her KennelOS account and this device, not the business Accounts page.
- Only we add search keywords.
- Set up another device ships before live sync's step 6, stopping after restore and unlock.
- The order stands: the waitlist (§3.3) before a sale (§3.5), since the waitlist turns
  picks into sales.
- Add dogs takes several in a row.
- Starred and frequent tasks move up the menu (§4).

Open:
1. Prep pups: a cover page with the readiness summary?
2. Frequent tasks: the 60-day window, and folding the rest under "More"?
