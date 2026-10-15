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
| Tidy up my records | Records that disagree, duplicates, merge, vets missing from contacts | All (stud, contacts, kennels, vets: Pro) |
| Finish an unfinished litter | Resumes the litter draft | All |
| Set up my waitlist | The fee (Stripe in the chat), offers, going online (cloud backup first), programs, existing families; re-runnable | Pro |
| Check account health | This device, backups, license, Sensitive records, connections, the online waitlist; each finding with its fix | All (license, Sensitive records, connections, waitlist: where offered) |
| Add dogs | One or several: a roster of names, a dog on file it may be asked about after its details (one of hers filled in, a pedigree-only one brought into use), what they share asked once, each dog's details and parents, review; resumable draft; then each dog's papers | All (someone else's dog, documents: Pro) |
| Finding Something | Where a page, a place on it, or a record is, with a button to it; a question or two when there are many; deep in levels | All (people, kennels, Pro pages: Pro) |
| Pups are going home | Optional checks to tick, remembered on the device (chips, litter registration number, pups' registered names and numbers, feeding); pups Available or Placed with no sale (record the sale or change the plan); readiness per pup with fixes (shots, deworming, drop-off date, balance, contract, registration); a payment request then an invoice for each balance owed; the puppy records with a cover page | All (contract, feeding, payment requests, invoices, Furever, print: Pro) |

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
7. **She talks like a person.** Every task opens with a line that says yes to it ("Sure
   thing, let's get those pups ready to go home!"), acknowledges each answer, moves between
   steps in her own words, and closes warmly. Every message carries a couple of warm words
   for the breeder (her work, her pups), **never more than one phrase or sentence** of it;
   the rest is the task. Sent straight to a task, she still asks "What can I help you do
   today?" first. Every new task (not a resumed one) starts with `chat.intro(opener)`: its
   own opener, then the standard "I'll ask you some questions…  Sound good?"
   (`KELS_INTRO`), answered **Sounds great, let's start!** / **Never mind**.
8. **Help-me-do fixes happen in the chat.** Anything she can finish in a form panel (a
   contract's status, a registration type, a date, a note) is collected and saved there.
   Leaving Kels for a page makes the breeder start the task over, so a fix opens a page
   only when it can't be done in the chat (a table editor, a vendor's e-sign send), and she
   says so first.
9. **A new tab is announced and waits for an OK.** Before opening one (printing, Furever),
   she says what's about to open and that she'll be waiting here, and opens it only on
   **Okay, open it**, from that tap.
10. **Reuse before writing, and share what's repeated.** Before building a step, look for
    the same job in the other Kels scripts and in the pages (finding a dog on file, making
    a dog, an ancestor, a kennel or a contact, filing a document, logging an event or its
    cost, a form's fields). If it exists, use it. If it exists as a copy in another place,
    or the new step would make a second one, it becomes one shared function: a pure,
    tested `data/` module for the rule, `assets/kelsSteps.js` for the chat pieces. Every
    place then calls it, and the copies are removed in the same change. The shared pieces
    so far: `kelsSteps` (the step engine, the form helpers, `kennelNameField`,
    `contactFields`, `breedPicker`), `dogSearch` (`findDogMatches`, `similarNamed`,
    `normReg`, `breedChoices`),
    `dogRepo.createPedigreeOnly`, `kennelRepo.findOrCreateOutside` and `seedTestsKennel`,
    `expenseRepo.createForEvent`, `documentModal`'s `storeDocumentFile` and
    `createDocument`, `kelsFindings`. A task's write-up says which ones it uses and what it
    added.

## 3. Proposed tasks, in build order

Sizes: **S** a few days of work, reusing what exists; **M** a new data module and a
script; **L** needs a feature that isn't built yet.

### 3.1 Pups are going home (was "Prep pups for leaving"): **M**, Pro (Puppy Record), the rest all editions — **Built**
As built: End-State guide §33 ("Pups are going home") and the Puppy Record section;
history in `docs/BUILD_LOG.md`. **Modified:** the Furever link isn't tracked, so it's
offered at the end rather than checked; "a pickup on the calendar" is a drop-off date (the
`placement` event, the only go-home date the app keeps), scheduled from the task; the
Sales picker's cover page is an option, off by default.

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
- **Cover page** (decided): the file opens with a page for the breeder, not the families: the
  litter, the date, and each chosen pup's readiness (what's done, what's missing, the
  pickup date and family). Then the pups' records follow, one per page run. Only the cover
  page needs the readiness rules, so they live in a pure `data/` module the cover page and
  Kels both read.

### 3.2 Check account health: **M** — **Built**
As built: End-State guide §33 ("Check account health"); history in `docs/BUILD_LOG.md`. The
findings loop is now `assets/kelsFindings.js`, shared with the tidy-up (§4). **Modified:**
sync isn't checked yet (Phase 2 step 6); Dropbox isn't tested live (nothing cheap to ask);
decided thresholds: a backup file older than 14 days without cloud backup, a device unseen
60 days, vendor keys tested live once per run.

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

### 3.3 Set up my waitlist: **M**, Pro (`waitlist`) — **Built**
As built: End-State guide §33 ("Set up my waitlist"); history in `docs/BUILD_LOG.md`.
**Modified:** settings are grouped, one screen per part with checkboxes for the on/off
rules, not one question each; going online first offers to turn on cloud backup when
it's off; Stripe for the fee connects in the chat; an existing family is added in the chat
(her application form); a spreadsheet still opens the import.

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
Hands off to Pups are going home (§3.1) when the litter is near ready.

### 3.6 Log a heat or breeding: **S**
Heat start → (later) breeding dates and method → stud service if outside (Pro) → the
pairing with its due date → an Expected litter. Hands off from the heat→pairing nudge's
situation; the check-in's Expected litter hands off to the birth as today.

### 3.7 Check in on a dog: **S**
The litter check-in's health-care and weight forms for one adult dog, plus health tests
(`planned_tests` → results), and status changes (retire, pet home).

### 3.8 Add dogs: **M** — **Built** (but its history step)
As built: End-State guide §33 ("Add dogs"); history in `docs/BUILD_LOG.md`. **Modified:**
several dogs are taken the litter task's way, not "Add another?" after each: one roster of
names (boy / girl) first, then what they have in common asked once and filled in on each,
then each dog's details and parents, then one review and save (a resumable draft, on the
litter task's step engine, `assets/kelsSteps.js`). A typed parent is a pedigree-only dog;
a parent can be another dog in the same batch. In Lite the roster has only as many rows as
she has room for. Of the history, the purchase ("Did you buy any of them?", a rough date
is fine: an `acquisition` event and its price as an expense) and their shots (a fixed
checklist, each good for 1 / 3 / 5 years or lifetime, with a reminder on Today when due)
are asked now, and who bred each dog (her kennel, or another breeder's kennel and the
breeder as a contact, Pro). The pedigree photo
isn't offered yet, and the rest of the history waits for Add new events (§3.10).

One dog or several in a row ("Add another?" after each). Typed in (duplicate check first,
`dogMatches`), or from a pedigree photo (`pedigreeImport`), with parents through the
tidy-up's parent steps and the dog's kennel, ownership and status. In Lite, at the cap she
shows the upgrade notice (§2.3) and stops adding.
- **Then, for each dog, optional:**
  - **Documents** (Pro, `documents`): upload its registration, pedigree, health certificates,
    contract… one or several, each filed on the dog with its type (`documentRepo` /
    `fileRepo`, as the Documents page files them).
  - **History** (all editions): its past events, through "Add new events" (§3.10) handed
    the new dog, so shots, health tests, heats and the rest come in the same way as there.
- **Keywords:** new dog, add dog, bought a dog, new female, new male, stud, import pedigree,
  registration papers, health records.

### 3.9 Add my other accounts: **S**, Pro (`accounts`)
The business Accounts page (registries, marketplaces, suppliers, labs, insurance, payment and
form services) as a conversation, for a breeder entering the logins and referral codes she
keeps elsewhere, one or several in a row ("Add another?" after each), like Add dogs.
- Per account: what it is (`ACCOUNT_TYPE`) and its name → website, username, password,
  customer / member ID → a referral link or code and its instructions, if she has one → notes.
  Saved through `accountRepo`, each when she approves it. A name she already has is checked
  first, so nothing is entered twice.
- A **Payment service** or **Form service** offers to connect Stripe / Jotform right there,
  the same in-chat steps as account health's "Help me replace it" (§3.2, built), so nothing
  sends her to another page.
- **Not** her KennelOS account (that's §3.2). The private fields stay private, as on the
  Accounts page (`syncRegistry`).
- **Keywords:** accounts, logins, passwords, AKC, registry, marketplace, supplier, referral,
  referral code, Stripe, Jotform, insurance.

### 3.10 Add new events: **S**
Log what happened, for one or several dogs, one event or several in a row ("Add another?"),
without opening each dog's page. Also how Add dogs (§3.8) brings in a new dog's history.
- **Which dogs** (search, or her own / a litter's pups) → **what happened** (`EVENT_TYPES`
  for dogs, grouped as the timeline groups them; only the types this edition has: `show`
  needs `shows`) → that type's own fields, date, and end date for a span type → saved, one
  event per dog, through `eventRepo` (`careEvents`'s pattern, now for every type).
- Breeding events (`breeding_tie`, `progesterone_test`, `ultrasound`, `pregnancy_update`)
  belong to a pairing and stay with Log a heat or breeding (§3.6); a litter's
  `whelping_summary` stays with the litter.
- **Keywords:** add event, log, record, history, shots, vaccine, vet visit, health test,
  weight, heat, medication, note, show.

### 3.11 Help me find / do / understand: **L**, all editions — Find: steps 1–2 **Built**
As built: End-State guide §33 ("Finding Something", "The top"); history in
`docs/BUILD_LOG.md`. **Modified:** Find has no `KELS_INTRO` (§2.7), since it asks one thing
and builds nothing; synonyms and slips are their own lower passes, after her words
themselves at every level (a typo or a synonym never hides an exact word deeper down); a
search that finds nothing offers View your dogs / Manage your litters / See your finances /
See your contacts / Sharing your pups, or new words. Still to build: steps 3–4.

Kels as a navigator and a knowledge base, not only task scripts. **Find** is first; **Understand**
comes later.

**Her first message** (decided): "Hi, I'm Kels, your personal KennelOS agent! I'm here to
help you manage your kennel :) What do you need help with first?" with two buttons,
**Finding Something** and **Doing Something** (the task list as today). An unfinished draft
is offered as a third button at the top, so it's never hidden behind "Doing Something".
After a task: "What else can I help you with?" and the same buttons.

**Finding Something.** She types words ("receipts", "zoey", "zoey rabies", "where's my vet"),
and Kels says where it is, with a button that opens it.
- **Three sources, ranked together:**
  - **Places** (the cheat sheet, decided): `data/kelsKnowledge.js`, written by us, not read
    from the pages. Each entry is `{ id, title, where, keywords, href, flag? }`, and its
    `where` is the plain sentence she says. The hub pages and the reports
    (`reportCatalog.REPORTS`) come in automatically. Tests check every `href` exists, is
    precached, and is gated like its page.
  - **Records:** dogs, people, kennels, litters (then sales, contracts, documents,
    expenses, accounts, waitlist entries), each as a candidate with its detail page.
  - **Her tasks:** a task's label and `keywords`. A match offers to start it.
- **Deep, in levels** (decided): every field can be searched, but in three levels, and a
  deeper one is only used when the levels above don't match every word she typed.
  Level 1: a record's names and numbers, a place's title and keywords. Level 2: secondary
  details (breed, color, kennel, contact type, email). Level 3: notes, and a dog's events
  (titles, details, notes). After a level-1 or -2 answer she offers **Look deeper**.
- **Matching** each typed word: the same word, the start of one, a slip or sound-alike
  (`dogSearch`'s word match, shared), or a synonym from our list (receipt → expense).
  Little words ("my", "where", "the") are ignored. A candidate matching more of her words
  comes first; within that, the score.
- **Narrowing:** one clear match is said with **Take me there** (and **Not it**). More than
  four: she asks one question that splits them, from what's actually there: which kind (a
  dog, a person, a page…), then the kind's own split (a dog: hers or someone else's, boy or
  girl, breed; a person: what they are to her; a litter: which year). At most two
  questions, then the top four and **Show more**.
- **Edition-honest:** a place whose page is Pro-only, or whose `flag` is off, isn't in
  Lite; record kinds the edition lacks aren't searched.
- **Landing** (decided): the button opens the page (a record's detail page, a hub with its
  tab in the URL where the page reads one). Pointing at the exact card is later.
- **Not now** (decided): no record of searches that found nothing.

**Help me understand…** (later): what something means, in a few plain sentences, with
the button to see it; the same catalog with `kind: 'understand'` entries.

**Build steps:** (1) the shared word match, the engine (`data/kelsFind.js`), the cheat
sheet, the first message and Finding Something; (2) dogs (with their events, deep),
people, kennels, litters; (3) sales, contracts, documents, expenses and receipts,
accounts, waitlist entries; (4) a record and a topic together ("zoey shots" → her health
history) and landing on the card.

- **Keywords:** help, find, where is, how do I, what is, explain, show me.

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
  - **Open:** once she has starred tasks, should the rest fold under "More"?
- **Task handoffs** grow (sale → prep pups; heat → breeding → litter). `handoff(taskId,
  opts)` already exists; each task documents what `opts` it takes.
- **Suggested next task:** the menu's `priority` already reads state. Add "pups leave in a
  week" (prep pups), "backup failing" (account health), and "families waiting, no list set
  up" (waitlist) as priority bumps, never as nudges.
- **One findings framework:** tidy-up and account health share the "findings → ask one at a
  time → fix → look again" loop: `assets/kelsFindings.js` (`FindingsTask`). Built.

## 5. Decisions and open questions

Decided:
- Kels's voice (§2.7): a couple of warm words in every message, never more than one phrase
  or sentence. The tasks built before the rule haven't been swept for it yet.
- Pups are going home prints pups with no sale (no buyer block).
- Account health is her KennelOS account and this device, not the business Accounts page.
- Only we add search keywords.
- Set up another device ships before live sync's step 6, stopping after restore and unlock.
- The order stands: the waitlist (§3.3) before a sale (§3.5), since the waitlist turns
  picks into sales.
- Add dogs takes several at once (a roster of names first, as the litter takes its puppies),
  and offers each dog's documents (Pro) and its history (through Add new events, still to
  build).
- Add my other accounts (§3.9) and Add new events (§3.10) are on the list, after Add dogs.
- Starred and frequent tasks move up the menu (§4); "frequent" means more than 3 starts in
  the last 60 days.
- Pups are going home's print opens with a cover page of each pup's readiness, for the breeder.

- Kels opens with "What do you need help with first?": **Finding Something** / **Doing
  Something** (§3.11). Find searches places (a cheat sheet we write), records and tasks,
  deep in levels; the button opens the page.

Open:
1. Once she has starred tasks, should the rest of the menu fold under "More"?
