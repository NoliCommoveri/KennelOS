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
| Add people | A roster of names and what each is to her, her vet if she has none, each person's details (one in her contacts filled in), breeders' kennels (new and on file); review; resumable draft; then her dogs' breeder kennels, and buyers onto the waitlist | Pro (waitlist: where offered) |
| Set up my application form | Her saved form or the standard one, the locked questions' wording, her own questions, their order, an FAQ, the form as families see it; resumable draft; then its link online, Sensitive records backup, the fee and its payment account, an applicant | Pro (online, Sensitive records, payment accounts: where offered) |
| Understanding Something | How the app works as an FAQ: topics, their questions, a search over the questions only; each answer with a Show me | All (waitlist, stud, foster, Companion, multi-kennel topics: Pro) |
| Pups are going home | Optional checks to tick, remembered on the device (chips, litter registration number, pups' registered names and numbers, feeding); pups Available or Placed with no sale (record the sale or change the plan); readiness per pup with fixes (shots, deworming, drop-off date, balance, contract, registration); a payment request then an invoice for each balance owed; the puppy records with a cover page | All (contract, feeding, payment requests, invoices, Furever, print: Pro) |
| Getting Started | A new breeder's first run: logo, lifecycle nudges, preferred tests (add, remove, rename), Puppy Record fields, another kennel for a separate side of the business, Google Drive for Furever, Dropbox for KennelAssistant, backup; each saved as answered; then Add dogs or Add people | All but Demo (Lite: backup, then Add dogs; the rest Pro) |

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
    `kennelPicker`, `contactFields`, `addContactInChat`, `VET_WHY`, `breedPicker`),
    `contactSearch` (`findContactMatches`, `hasVet`), `kelsApplicant.askApplicant`,
    `waitlistFeeStep.askWaitlistFee`, `kelsBackupSteps` (`offerCloudBackup`,
    `offerSensitiveRecords`), `dogSearch` (`findDogMatches`, `similarNamed`,
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
`docs/BUILD_LOG.md`. **Modified:** Find's intro (§2.7) is its own how-it-works line
(`KELS_FIND_INTRO`: it searches features and records, and asks when there are several)
in place of `KELS_INTRO`, since it builds nothing; synonyms and slips are their own lower passes, after her words
themselves at every level (a typo or a synonym never hides an exact word deeper down); a
search that finds nothing offers View your dogs / Manage your litters / See your finances /
See your contacts / Sharing your pups, or new words. Still to build: steps 3–4.

Kels as a navigator and a knowledge base, not only task scripts. **Find** is first; **Understand**
is §3.14.

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

**Help me understand…** is its own task now: §3.14.

**Build steps:** (1) the shared word match, the engine (`data/kelsFind.js`), the cheat
sheet, the first message and Finding Something; (2) dogs (with their events, deep),
people, kennels, litters; (3) sales, contracts, documents, expenses and receipts,
accounts, waitlist entries; (4) a record and a topic together ("zoey shots" → her health
history) and landing on the card.

- **Keywords:** help, find, where is, how do I, what is, explain, show me.

### 3.12 Add people: **M**, Pro (`contacts.html`) — **Built**
As built: End-State guide §33 ("Add people"); history in `docs/BUILD_LOG.md`. **Modified:**
the roster asks one main type per person, the rest are ticked on their details; "what they
share" is only how she met them; the vet she has in her contacts can be picked and tagged
Vet; a spreadsheet of contacts isn't offered (the Contacts import is still the way). The
tidy-up's duplicate-contacts finding keeps its own rule (the same name plus one shared
detail): it compares two records on file, not a person being typed, so only the
normalizers are shared.

Contacts as a conversation, for a breeder bringing in the people she already deals with:
one or several, taken the way Add dogs (§3.8) takes dogs, not "Add another?" after each.
- **A roster first:** names, and for each what they are to her (`CONTACT_TYPE`: buyer, vet,
  breeder, co-owner, groomer, handler, referrer, other; several allowed). What they share
  (a type, how she met them, `first_contact_source`) is asked once and filled in on each.
- **A vet, if she has none:** when the roster has no vet and no contact on file is one, she
  asks once, "Do you have a vet you'd like to add?", and a yes adds one to the roster.
- **Each person's details:** phone, email, address, Facebook (the Contact page's fields),
  then notes.
- **Breeders and their kennels:** for each breeder on the roster (and each breeder contact
  on file with no kennel, `Contact.kennel_id` empty), "Do they have a kennel?": pick an
  outside kennel she has, or name a new one (`kennelNameField`,
  `kennelRepo.findOrCreateOutside`, as the tidy-up and Add dogs do), and the contact is
  linked to it.
- **Already on file?** Each name is checked before anything is saved, with the one shared
  contact match (§4, "Adding a person"): a likely match asks **Same person** (fills in what
  the record is missing, never overwrites) / **Someone new**.
- **Review, then save** through `contactRepo`, one resumable draft (`kelsSteps`), as Add dogs.
- **Then, the dogs they bred:** when a kennel was made or linked above and she has dogs
  with no breeder kennel (owned or co-owned, not pedigree-only, `breeder_kennel_id` empty),
  "Do you want to link any kennels to dogs you own as the kennel who bred it?": her dogs as a
  checklist, each with the kennel it came from (the kennels from this run first, any
  outside kennel she has), saved through `dogRepo.update`. **Skip** leaves them as they are.
  Not asked when no dog is missing one.
- **Then, for someone wanting a pup** (Pro with `waitlist`, a list set up): **Put them on
  the waitlist?** asks her application in the chat (the shared applicant step, §4) and saves
  an `applied` entry linked to the contact just made. Without a waitlist, the question
  isn't asked.
- **A spreadsheet** of contacts opens the contact import (a page of its own; leaves Kels, §2.8).
- **Keywords:** add person, add people, contact, contacts, new buyer, vet, groomer, co-owner,
  handler, family, applicant, phone number, email, breeder, kennel, bred by.

### 3.13 Set up my application form: **M**, Pro (`waitlist`) — **Built**
As built: End-State guide §33 ("Set up my application form"); history in
`docs/BUILD_LOG.md`. **Modified:** after the save she also offers Sensitive records backup
(cloud backup first; applications hold families' details) and the application fee with its
payment account (Set up my waitlist's fee step, now shared, `assets/waitlistFeeStep.js`,
which also takes another payment service by name and link). "Where she's starting" is asked
only when she has a form of her own. Set up my waitlist offers this task at its end.

The Waitlist form page (`waitlist-form`) as a conversation: the questions families answer
when they apply, and the FAQ above them, for one kennel. Set up my waitlist (§3.3) hands
off to it where it now only says where to change the form.
- **Which kennel** (multi-kennel), then **where she's starting:** our standard form
  (`DEFAULT_FORM_QUESTIONS`), the form she has now (re-runnable, §3.3's pattern: she says
  what's there and asks what to change). **Not yet** (decided): an old form's spreadsheet;
  the Waitlist form page's question import still does that, and she says so.
- **The locked questions** (name, email, the preferences, `ready_timing`, the public-list
  notice) are shown together, once: "These are how the list works, so they stay. Want to
  reword any?" Only the wording changes.
- **Her own questions:** keep / reword / drop each standard one; then **Add a question**:
  the question, its kind (`WAITLIST_QUESTION_TYPE`; the choices one per line for a choice
  kind), required or not, help text. Order: a review screen with ↑/↓, as on the page.
- **FAQ** (`application_faq`): a few common ones offered to start from (price, when pups go
  home, the fee), each answer hers; or her own.
- **Review:** the whole form as a family sees it (the same fields as the Waitlist entry page,
  `assets/waitlistApplicationForm.js`), then saved once through `kennelRepo`, checked by
  `validateQuestions` / `validateFaq`. One resumable draft until then, since a half-saved
  form could go live mid-edit when her list is online.
- **Then:** with the list online, the link to the form (`waitlistOnlineUI`'s); **Add an
  applicant now?** runs the shared applicant step (§4) with the form she just made.
- **Keywords:** application, application form, form, questions, questionnaire, apply,
  waitlist form, FAQ, puppy application.

### 3.14 Help me understand: **M**, all editions (how my kennel is doing: Pro, `reports`) — A step 1 and B (steps 3–4) **Built**
As built: End-State guide §33 ("Understanding Something"); history in `docs/BUILD_LOG.md`.
**Modified:** "How the app works" is **How KennelOS works**, under a third button on her
first screen, **Understanding Something** (below), organized as an FAQ (topics → questions → answer, with **Show me**) with a
search over those entries only; Find doesn't search them. The entries are their own module,
`data/kelsUnderstand.js`, not `kind: 'understand'` places in the cheat sheet. The topics
below were replaced by the filter "only what a breeder who has used other apps would still
get wrong here" (the as-built list is in the module); Lite's limit isn't one.
**B as built:** End-State guide §33 ("How my business is doing") and §31 (the shared
report loaders and figures); history in `docs/BUILD_LOG.md`. **Modified:** every report Kels
quotes loads through `data/reportSources.js` and its tiles' figures come from
`data/reportFigures.js`, shared with the page, rather than `kennelInsights` reading rows
the pages build; the intro drops "how this year's money compares to last year's" until
step 5; Breeding-Dog Return, Heat Cycles, Health-Testing Gaps, Receivables, Waitlist Today
and Demand vs Supply have no range, so their sentences are lifetime or as of today;
Placements' registration split stands in for "Limited pups brought in…". Decided: the
minimums (2 litters, 3 decided breedings, 3 sales), "no litter" = live, owned or co-owned
females at Active breeding past her kennel's female promote age, comparison with the
range before after the first release, and Lite has no B. Still to build: step 2 (her own
records worked through) and step 5 (against the range before).

Two things a breeder means by "help me understand", asked first:
**How the app works** ("why is this family fourth?", "what counts as income?") and
**How my kennel is doing** ("how are my dogs doing?"). Both are read-only: she explains,
shows the numbers and offers the page, and never changes a record. Both answer in plain
sentences a breeder would say out loud, never field names or ids.

**A. How the app works.** A topic in a few plain sentences, with a **Show me** button to
where it lives, and, where it helps, the same rule worked through on one of her own
records.
- **Topics** are `kind: 'understand'` entries in `data/kelsKnowledge.js` (the cheat sheet
  Find already searches, §3.11), so Find's search reaches them too ("how does the waitlist
  work" lands on the topic, not just the page). Each is `{ id, title, keywords, explain,
  href, flag?, example? }`. `explain` is written by us, a few sentences; `example` (optional)
  names the rule function that works it through on her data.
- **First topics** (one sentence each here; the entry says it properly):
  - **What's linked to what:** a dog's litters, pairings, sales, events, expenses and
    documents; a litter's dam, sire, pairing and pups; a sale's pup, family, contract and
    payments; why archiving a dog keeps its litters and sales (soft delete, §7).
  - **A dog's life in one record:** puppy → kept or placed → breeding → retired is a status
    change on the same dog, never a new one.
  - **The waitlist:** how position is decided (an ahead program first, then the anchor date,
    else the fee date, then same-day payment order), what makes a family eligible for a
    litter (sex, breed, purposes, color only when matching is on; not paused; listening for
    those parents), turns and offers, passes, and when the application fee comes off the
    pup's price.
  - **Income:** there's no income ledger; it's read from sales, stud services and fees on
    every load. Earned (paid, or the sale has passed that step) vs anticipated, why a
    returned sale keeps only what was paid, why a lost sale counts nothing, why pick value
    isn't money in, processing fees taken off, and Net = earned − spent.
  - **Expenses:** every cost hangs on a dog, litter, pairing or her kennel; mileage; an
    event's cost; a stud fee she paid is an expense, one she earned is income.
  - **Reports:** each is worked out fresh from her records; the date range; why a report
    and the Financials Overview always agree.
  - **Kennels and scope** (multi-kennel), **backups and cloud**, **Sensitive records** (Pro),
    **sharing with families** (Pro), each where the edition has it.
- **Her own records, worked through** (`example`): "Why is the Smith family fourth?" →
  the three families ahead and the reason each is ahead ("the Lees paid their fee on March 2,
  you on March 9"). "Why is Bella's balance anticipated?" → its parts and which are paid.
  "Why isn't the Joneses' fee counted twice?" → the credit on their sale. Each answer comes
  from a small pure `explain…` function **next to the rule it explains**
  (`waitlistRules.explainPosition`, `incomeView.explainComponent`…), tested with the rule,
  so an explanation can never drift from what the app does (§2.2). She reaches these from
  the topic ("Want me to show you on one of yours?" → pick the record) and from Find when a
  record and a "why" are typed together ("why smith fourth").
- **Edition-honest:** a topic for a feature the edition lacks isn't there. In Lite, the
  cap is explained only as the upgrade notice does (§2.3): no "what doesn't count".

**B. How my kennel is doing.** She asks what about (**My dogs**, **Money**, **Litters &
pups**, **Sales & the waitlist**, **Shows & stud**, or **The whole picture**) and for when
(this year by default; last 12 months, last year, all time, as `reportMath.rangeFor`'s
presets), and gets back a short summary in plain sentences:

> Here's how your dogs did this year. Your most prolific dam is Bella, with 2 litters and
> 14 puppies. Your highest-earning sire is Duke: his pups brought in $18,400. Rosie was bred
> in April but didn't take, and Maple hasn't been bred this year. Want more, or the report?

- **Every sentence comes from a report.** A pure `data/kennelInsights.js` turns the
  reports' own rows into sentences; it never computes a figure itself. Each insight is
  `{ id, topic, text, tone, value, dogIds, source: { href, range } }`, and its **See the
  report** button opens that report with the same range (and the dog, where the report
  filters by one). If a question needs a figure no report has, the figure is added to the
  report first, so she can always see where Kels got it.
- **My dogs** (from Dam & Sire Production, Breeding-Dog Return, Pairing Success, Heat Cycles,
  Health-Testing Gaps):
  - most prolific dam and sire (puppies born, then litters), and the best live-birth rate;
  - highest-earning dam and sire (their pups' income plus stud fees), and the best and
    worst return after their own costs ("Rosie's costs are more than her pups have brought
    in so far");
  - a breeding dog with **no litter in the range**, said as what happened: bred and didn't
    take (a failed pairing), or not bred at all. Never "failed to produce". Needs the
    production report to list breeding-status dogs with no litter in the range (it lists
    only dogs with a litter today);
  - the sire with the lowest conception rate, only past a minimum number of breedings;
  - a heat due in the next month; health tests planned but not logged;
  - back-to-back litters and lifetime-litter flags, said as the report says them (a prompt
    to look, never a judgment).
- **Money** (P&L by Month, Litter P&L, Expenses by Category, Receivables, Pricing,
  Placements): net for the range and against the one before, the best month, the biggest
  cost, the most and least profitable litter, what's owed and how overdue, what her pups
  brought in by registration ("Limited pups brought in $7,500, Full $2,800"), and whether
  a Full registration is selling for more ("Full sells for $300 more than Limited").
- **Litters & pups** (Litters Over Time, Live-Birth Summary, Puppy Growth): litters and pups
  against the range before, the live-birth rate, average litter size, a pup falling behind
  its littermates.
- **Sales & the waitlist** (Placements, Waitlist Funnel, Applications, Waitlist Today,
  Offers & Removals, Demand vs Supply, Lead Sources, Returns), each line from the report
  named:
  - *Placements:* pups placed and average price, and how many went with each registration
    ("You placed 4 pups: 3 on Limited, 1 on Full").
  - *Applications:* how often families apply ("a new application about every 30 days"),
    how many she approves, how fast they pay the fee, and what they ask for: a boy or a
    girl, what the pup is for (pet, show…), any parents or only certain ones, and the dogs
    they name most ("2 families asked only for Juniper's pups").
  - *Waitlist Today:* who's waiting now for a girl, a boy or either, how long they've
    waited, how many are paused, and applications still to review or with a fee due.
  - *Offers & Removals:* the share of offers accepted, passed or unanswered, families who
    passed at least once, why they passed, and families removed for not following the
    list's rules, apart from ones she removed.
  - *Funnel, Demand vs Supply, Lead Sources, Returns:* where families drop off, families
    waiting against pups available ("6 families want a girl; you have 2"), the top lead
    source and referrer, returns.
- **Shows & stud** (Show Record, Stud Services, Stud Results): points and titles, stud fees
  earned, services that produced a litter.
- **The whole picture:** the top one or two from each topic, then **Year in Review**.
- **How she says it:**
  - at most four or five sentences per topic, the most telling first (a new high or low,
    a change against the range before, then the rest); **Tell me more** gives the next few;
  - names, rounded money and plain counts; a rate with its count ("3 of 4 breedings took");
  - **too little to say is said:** under a minimum (one litter, two breedings) she says
    it's too early to compare instead of ranking; a tie is said as a tie;
  - kind and factual about a dog that's behind, never blaming; welfare flags as prompts;
  - a topic with nothing in the range says so and offers a longer range.
- **Scope:** her active kennel scope, as every report reads it (multi-kennel, §31). Kennel
  check-ins stay in Kels (§2.5): nothing here becomes a Today nudge.
- **Edition:** Pro and Demo (`editionFlags.reports`, the reports are Pro-only). Lite: see
  §5 Open.

**Where she starts it** (decided): **Understanding Something**, the third button on her
first screen. She asks "Yes, absolutely! Which is your question about?": **How KennelOS
works** (A) / **How my business is doing** (B). Each has its own intro the first time it's
picked (A: "I'm on it! I can explain the rules KennelOS follows behind the scenes…",
`kelsChat.KELS_UNDERSTAND_INTRO`; B, below), and **Something else** after an answer comes
back to the question. Lite has no B, so it skips the question and starts A. The intros name
nothing Lite lacks. Both halves ship before the button launches; until B is built the
question isn't asked anywhere.

**B's intro** (decided wording): "**Ready when you are!** I can tell you how your business is
doing, like who your most productive dam is or how this year's money compares to last
year's. Pick what you'd like to know about and for what dates, and I'll sum it up in plain
words. Every number comes straight from your reports, so I'll always show you which one.
Sound good?" Its half joins `kelsUnderstandUI.HALVES` (flag `reports`).

**Build steps:** (1) the topics and their entries, reached from Find and the task;
(2) her own records worked through, starting with waitlist position and income; (3) the
kennel check-up, **My dogs** first (and the production report's no-litter rows); (4) Money,
Litters & pups, Sales & the waitlist, Shows & stud, The whole picture; (5) against the range
before.

- **Keywords:** understand, explain, how does, why, what does, what counts, how am I doing,
  how's my kennel, my dogs, best dam, best sire, most prolific, earnings, summary, check-up,
  stats.

### 3.15 Getting Started: **S**, all editions but Demo (most parts Pro) — **Built**
As built: End-State guide §33 ("Getting Started"); history in `docs/BUILD_LOG.md`. A new
breeder's first run through her kennel's settings after the first-run kennel setup, each
part saved as answered and skippable, then a handoff to Add dogs or Add people. It sits
near the top of her menu until she has her first dog record.
Shared pieces it added: `assets/kennelSettingsFields.js` (the Kennel page's logo, nudge and
Puppy Record fields, now one copy), `kelsBackupSteps.cloudBackupOn`. **Decided:** it never starts on
its own; the first page after the first-run kennel setup (after the tour, or Start my
kennel) shows a Meet Kels card whose **Try Getting Started** opens it.

### 3.16 Review my waitlist: **M**, Pro (`waitlist`) — **Proposed, not decided**
Her day-to-day waitlist work as one conversation, offered once a list is set up (priority
high while anything is waiting on her, like the Today `waitlist-*` nudges). Every action is
an existing `waitlistActions` call; the task adds no data. Each step is skipped when it has
nothing, and each item has **Skip for now**, so she can stop at any point.

Opening: "Here's what's waiting on you: 2 new applications, 1 fee to check, picks to open
on Daisy's litter, 1 family's turn to offer, 3 new messages." (Sales to cancel aren't
counted: only she knows.) Then **Start with the first** /
**Pick one** (the list as choices) / **Not now**. Order, most time-sensitive first:

1. **Family requests and messages** (unread `messages`, pending pref / pause / listen /
   Companion-link requests). Messages first because a family backing out, or an answer
   about an offer, changes the steps after it. One family at a time: "Sarah Lee wrote on
   her status page (Oct 29): …" → **Write back** (Communicate…: an email that also shows
   on their status page) / **Mark read** / **Open their page**. A request: "Sarah asked to
   pause until March 1." → **Approve** / **Decline** (the nudge's actions and emails).
2. **Sales to cancel or void** (asked every time, since nothing in the app knows yet):
   "Do you need to cancel or void any sales? For example a family backed out, or a pup
   died or can't go home." → **Yes** / **No**. Yes → her open sales as choices (pup, family,
   litter) → "What happened?":
   - **The family backed out** → `cancelled`. "Their deposit stays as income." Then, with
     the pup still here: "Offer [pup] to the next family?" (step 5 for that litter).
   - **The pup died** → `voided`, `pup_died`; then **Record [pup]'s death** (date, cause).
   - **The pup failed a health check** → `voided`, `failed_health_check`; then **Put
     [pup] on Health hold**.
   - **The pup came back after going home** → `returned`, then the reason: **A health
     problem (within the guarantee)** / **The family's choice**.
   - **Something else** → **Cancel** or **Void** with the Other reason.

   When the family lost their pup through no fault of theirs (`isLostSale`): "Put the
   Kims back in line in their old place?" → **Yes, carry their $500 to their next pup** /
   **Yes, I'm refunding it** / **No** (`restoreAfterLostSale`). Each saves through the
   Sale page's own path (end reason required, as there). Then "Any other sales to cancel
   or void?" until **No, that's all**.
3. **Offers past their deadline** (`waitlist-offer-overdue`). "The Kims' time to pick from
   Daisy's litter ran out yesterday." → **They picked** (pup + deposit) / **Count it as a
   pass** / **Give them more time**. Then step 5's "offer the next family?" for that
   litter, straight away.
4. **Open picks** (`waitlist-open-picks`: `accept_deposits_date` reached, picks not open).
   "You planned to start taking deposits on Daisy's litter today. 3 girls and 2 boys are
   available. Open picks?" → **Open picks** (`openPicks`, which offers the first turn when
   automatic offers are on) / **Not yet, remind me in a few days** / **Change the date**.
5. **Turns waiting on her** (auto offers off for that moment, a litter with pups and
   nobody holding a turn). "Next in line for Daisy's litter is the Garcias (want a girl,
   waiting 8 months). Offer it to them?" → **Offer it** (`offerNext`, then the offer
   email) / **Offer someone else** (the list, `offerTo`) / **Not yet**.
6. **New applications** (`applied`). One at a time, the application as on the entry page:
   "Jordan Price applied Oct 28 for a male, pet home, has a fenced yard." → **Approve**
   (program, then the fee request) / **Decline** (editable message) / **Ask a question**
   (goes to their status page) / **Decide later**.
7. **Fees to check** (`approved`, fee not received; overdue first). "Jordan's $100 fee:
   asked for Oct 20, due Nov 3." → **Received** (amount prefilled, date, method) / **Not
   yet** / **Remove them** (only once overdue, `markFeeExpired`).
8. **"Ready now?" unanswered and recent removals** (`waitlist-ready-overdue`,
   `waitlist-removed` inside its undo window). → **Remove them** / **Wait longer**; a
   removal: **Keep it** / **Undo**.
9. Close: "That's everything on your waitlist for today." (or "…I left 2 for later.") and
   back to the menu.

Each step ends "Anything else here?" only where there can be more than one (as the
preventatives loop does).
- **Keywords:** waitlist, applications, fees, deposits, picks, offers, messages, turns,
  backed out, cancel a sale, void, pup died, refund.
- **Open questions:** whether messages lead (proposed) or sit at the end; whether "remind me in a few days" on open picks moves `accept_deposits_date` or only
  snoozes the nudge.

## 4. Shared pieces

- **Search words are ours.** **Decided:** only we add `keywords` (in `TASKS`); breeders
  don't add their own. An empty search that a breeder would plausibly type is a keyword we
  add in the next release.
- **Her favorites first** — **Built** (the Doing Something list; End-State guide §33,
  `data/kelsFavorites.js`). Two ways a task moves up her menu, both device-local in
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
  - **Decided:** the rest never folds under "More", and starred tasks stay in the Doing
    Something list (no shortcuts on her first screen).
- **Adding a person** — **Built** with Add people (End-State guide §33): `contactSearch`, the
  applicant step `assets/kelsApplicant.js`, and `kelsSteps`' `kennelPicker` /
  `addContactInChat` (the tidy-up's add-a-contact and its vet's, the litter task's and Add
  dogs' kennel pickers, now one each). `contactFields` stayed the short form; Add people
  asks the rest itself. §3.13 uses the applicant step; Record a sale's buyer (§3.5) is next. Three jobs
  that today are separate copies become one each:
  - **Their fields:** `kelsSteps.contactFields` grows to the Contact page's fields (type,
    address, Facebook, notes), each opt-in, so the short form the tidy-up and Add dogs use
    stays as it is.
  - **Already on file?** `waitlistRules.contactMatches` (exact email, then exact name) and
    the tidy-up's `duplicateContactFindings` (same name plus one shared detail) are two
    rules for one question. One pure `data/contactSearch.js` (`findContactMatches`, using
    `dogSearch`'s word match for slips) serves the waitlist's approval, the tidy-up, and
    Kels; the copies go in the same change. **Decided:** a matching email or phone is a
    match; a matching or near-matching name alone is a "maybe this is them", never assumed.
  - **The applicant step:** Set up my waitlist's **Add one by hand** (her application in the
    chat, the program, when they applied, notes, saved `applied`) moves into `kelsSteps` as
    one step any task can run, given a contact or not. Add people, Set up my application
    form and Set up my waitlist all call it.
- **Task handoffs** grow (sale → prep pups; heat → breeding → litter; waitlist → application
  form; add people → applicant). `handoff(taskId,
  opts)` already exists; each task documents what `opts` it takes.
- **Suggested next task:** the menu's `priority` already reads state. Add "pups leave in a
  week" (prep pups), "backup failing" (account health), and "families waiting, no list set
  up" (waitlist) as priority bumps, never as nudges.
- **One findings framework:** tidy-up and account health share the "findings → ask one at a
  time → fix → look again" loop: `assets/kelsFindings.js` (`FindingsTask`). Built.

## 5. Decisions and open questions

Decided:
- Help me understand B (§3.14): rank only past 2 litters, 3 decided breedings, 3 sales;
  "no litter" counts Active breeding females of breeding age only; against the range before
  ships after the first release; Lite has no B.
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

- Starred tasks stay in the Doing Something list: no shortcuts on her first screen, and
  the rest of the list never folds under "More".

- Add people (§3.12) is Pro only: Lite has no Contacts pages.
- An applicant added from Add people is linked to the contact she just made, at once.
  Everywhere else she still picks the contact when she approves the application.
- One contact match rule (§4): a matching email or phone is the same person; a matching or
  near-matching name alone is offered as "maybe this is them", never assumed.
- Set up my application form (§3.13) doesn't take an old form's spreadsheet yet; that stays
  on the Waitlist form page.
- How the app works (§3.14 A) is **How KennelOS works** under **Understanding Something**, a
  third button on her first screen: an FAQ of only the rules a breeder who has used other
  apps would still get wrong here, searched on its own. The button first asks which half
  (A or B); Lite has no B and goes straight to A. Both ship before it launches.
- Help me understand (§3.14) has two flows: how the app works (topics, and the rules worked
  through on her own records), and how her kennel is doing (plain sentences, each from a
  report, with the report a tap away).

Open:
- **Which kennels the "bred it" step offers** (§3.12): proposed, the kennels from this run
  first, then every outside kennel she has; never her own (a dog she bred is the litter
  task's), and only dogs with no breeder kennel (one already set is never changed here).

