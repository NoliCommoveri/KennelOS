# KennelOS — UI redesign to the forest look (plan)

> Status: **plan only, nothing built** (2026-11-19). Work goes on `next` (CLAUDE.md "Next
> release").
>
> **The approved design is the prototype**: `docs/design/forest-look-prototype.html`, published
> for the owner as the artifact "KennelOS Forest Look",
> https://claude.ai/artifact/1fhGXn25fAQVyJjcXSUxLa (from 2026-11-20). Every session that changes
> the prototype publishes it there (CLAUDE.md). It began as the 2026-11-18 design (artifact
> `Qon8foccjzDmQc4ssLcua1`, now out of date), with D8's one person page, D9's Pricing and
> schedules and D10's + drawn in, and its icons built into the page instead of loaded from a CDN.
> Open it and use the bar at the top (Phone / Desktop, Planned shown / hidden, View as, Design
> notes). The repo copy is what builds are checked against.
>
> **Filling in the stubs** (2026-11-20 on): the repo copy draws screens the artifact left as
> `stub:` placeholders, in its own components and tokens: Reminders, Coming up, Calendar,
> Notifications and Kennels; Add dog, Edit dog, Add
> event, Log a test, Pedigree and Dog card; Add litter, Add pairing and Add expense; on a
> person's page, Offers & passes, Fee, Messages, Status page and History; Add family, Side
> sale, Programs and a program; Add sale, Add person, Do not sell, a sale's Payments, Contracts
> (the list, a contract, Send for signature, its details), Add entry, the Financials year,
> Accounts and an account; Backup & Restore, Import / Export, Danger zone, Sharing, Storage,
> Documents and Kels. Each is the owner's to approve or change, like any
> screen; until she has seen it, it's a proposal (§2.5).
>
> **Decisions:** the fidelity rule in §2 and D1–D10 (§8) are the owner's (2026-11-19).

## 1. What changes

From the prototype's Design notes, which are part of this plan:

- **Shell.** A forest-green header band and a tab bar (a left rail on desktop) on every
  screen, drawn by `nav.js`. One back history across tabs: every screen after the first has
  a back arrow that returns where she came from, at the same scroll position.
- **Tabs.** Home, Waitlist, Dogs, Litters, Business, More (program types can swap Waitlist
  for Studs and reorder tabs; `docs/KennelOS_Program_Types_Plan.md`).
- **Where things moved** (the Design notes table):

  | Today | Forest look |
  |---|---|
  | Today | Home: count tiles, This week, Coming up |
  | People › Waitlist | Its own tab, second after Home: Needs you, then Selling now |
  | Dogs | Dogs; the Dog page becomes a hub with one screen per job |
  | Breeding | Litters: Litters, Pairings, Active breeding; the Litter page becomes a hub |
  | People | Business › People |
  | Placements & Contracts | Business › Sales & Placements, Stud Services, Contracts |
  | Financials, Reports | Business › Financials (with an Entries ledger), Reports |
  | Storage, Sharing, Import/Export | More |
  | Settings, the Kennel page's setting cards, on/off boxes on other pages | More › Setup |

- **One job per screen.** Long pages become a hub: who or what it is, what needs
  attention, one tile per job, tiles that don't apply hidden. Dog: 13 stacked sections →
  10 tiles. Litter: 6 → 8, with Go-home and Weigh puppies as new screens.
- **Filters.** One filter sheet for every list: date range, then that list's fields;
  active filters as removable chips with "N of M shown".
- **Search.** A search button in every header (a box with `/`, Ctrl+K or Cmd+K on desktop)
  over screens, records, settings questions and reports, grouped by kind, matches
  highlighted, recent searches kept.
- **Setup.** Settings get one home, More › Setup: what's left to finish, then one row per
  area with a summary of the answers; each area is questions with the answer beside them.
  The only switches are in **What you use**. One exception (D9): her usual prices, deposit,
  timing and ways to pay live on Business › **Pricing and schedules**, and Setup's row for
  them opens that screen.
- **Planned features** keep the places the prototype reserves for them (dashed outline,
  footnote). Nothing planned ships as a placeholder (D5).

## 2. The fidelity rule: build what was approved, not a simpler version

The owner has had builds that kept the idea of an approved design and dropped its detail.
In this redesign **the prototype is the spec for how things look**, down to the pixel, and
a screen isn't done until it matches it.

1. **Every value comes from the prototype.** Font family, size, weight, line height,
   letter spacing, color (text, background, border, icon), padding, margin, gap, radius,
   shadow, icon and its size, and the order and content of each row, tile, pill and header.
   Nothing is rounded, merged into a nearby value, swapped for a system default or "close
   enough". 13.5px stays 13.5px; `#1f5c3d` stays `#1f5c3d`.
2. **The tokens are copied, not rewritten.** The prototype's `:root` block (light, dark,
   and `[data-theme="dark"]`) moves into `shared/assets/app.css` with the same names and
   values. Component CSS (`.appbar`, `.tab`, `.card`, `.row`, `.row-ic`, `.sec-tile`,
   `.tile`, `.pill`, `.chip`, `.fbar`, `.sheet`, `.timeline`, `.kpi`, `.facts`, `.rung`,
   `.q-row`, `.switch`, `.coi-grid` and the rest) is copied rule for rule, then adapted only
   where the real markup needs a different selector.
3. **Every state the prototype draws is built**: phone and desktop (the 760px container
   breakpoint), dark mode, hover and focus, empty states, badges, the active tab marker,
   the filter count, the toast.
4. **A departure needs the owner's yes first.** If real data or a real constraint makes a
   screen differ (a field the prototype doesn't have, a longer name, an accessibility
   need), stop and ask, with a screenshot of both. Once approved, it is listed in
   `docs/design/departures.md` (screen, what differs, why, date approved), and §6's check
   allows exactly that difference and nothing else.
5. **Pages the prototype doesn't draw** (most of today's 174 pages) use only the
   prototype's tokens and components: no new colors, sizes or one-off styles. The closest
   prototype screen is named as the model for each, in the phase that converts it.
   Prototype screens marked `stub:` are placeholders, not designs; their real look is
   built from the components and shown to the owner before it's merged.
6. **"Done" is measured, not judged.** A phase is done when §6's checks pass with no
   unlisted differences and the owner has seen the side-by-side screenshots.

## 3. The design values (from the prototype)

The full set is the prototype's `:root`; these are the ones most often lost.

| Token / part | Light | Dark |
|---|---|---|
| `--forest` header band | `#1d4a33` | `#173a28` |
| `--forest-deep` tab bar / rail | `#163b28` | `#112d1f` |
| `--bg` page (warm ivory) | `#f5f2e7` | `#131a16` |
| `--surface` cards | `#fffdf7` | `#1b241f` |
| `--surface-2` | `#f0ecdf` | `#222d27` |
| `--line` / `--line-strong` | `#e2dccb` / `#cfc7b2` | `#2f3b34` / `#3e4c44` |
| `--ink` / `--muted` / `--faint` | `#1b2a21` / `#5b685f` / `#8a948b` | `#e7ece5` / `#a2b1a6` / `#7d8b81` |
| `--primary` / `--primary-soft` | `#1f5c3d` / `#dfeadb` | `#4fa676` / `#23362b` |
| Active-tab marker, badges, bell dot | `#e9b45e` | same |
| Pill pairs | green, blue, rose, amber, gray, red, violet (`--p-*-bg` / `--p-*-fg`) | each has a dark pair |

| Text | Font | Size / weight |
|---|---|---|
| Body | Inter | 14px / 400, line height 1.4 |
| Header title (`.appbar h1`) | Figtree | 21px / 700, letter spacing −.01em (the brand's size, D12) |
| Brand | Figtree | 21px / 800 (19px in the rail) |
| Home "Today" | Figtree | 24px / 800 |
| Section heading (`.section-h h2`) | Figtree | 17px / 700, primary-colored icon |
| Dog name on its hub | Figtree | 22px / 800 |
| Row title / subline | Inter | 14.5px / 600; 12.5px muted |
| Big rows title | Figtree | 16px / 700 |
| Tile / section tile title | Figtree | 15px / 700; subline 12px / 12.5px muted |
| KPI value | Figtree | 22px / 800, tabular numbers |
| Group label | Inter | 11.5px / 700, uppercase, .07em |
| Tab label | Inter | 11px / 600 phone; 14px desktop |
| Pill | Inter | 12px / 600 |

| Shape | Value |
|---|---|
| Card radius `--r` / `--r-sm` | 12px / 8px |
| Row icon | 36×36, radius 10px (42×42 in big rows) |
| Chips, pills | radius 999px |
| Card shadow | `0 1px 2px rgba(40,45,30,.06), 0 1px 1px rgba(40,45,30,.04)` |
| Screen padding | 14px 14px 24px phone; 20px 24px 28px desktop, content max 1000px |
| Rail width | 216px |
| Icons | Lucide, 18px default, 22px tabs and header buttons, 24px header title |

Today's app (`shared/assets/app.css`) is a different design: `#f6f7f9` page, `#2f6f4f`
accent, system font at 15px, 8px radius, no dark mode. None of its values carry over where
the prototype has its own.

## 3.1 Components: one piece for each job

The goal is one unified, cohesive look across the whole app: the same kind of thing always
looks and works the same way, on every screen. So the display components are tracked here,
by the job each one does, and **nothing new is made until we've checked that an existing
piece can't do the job** (D18).

**For every new field, control or display** (in the prototype or the build):
1. **Name the job.** What is she doing: picking one of a few fixed choices, flipping a
   two-way switch next to a value, typing an amount, turning something on or off, opening
   a record, reading a status?
2. **Find it in the table below** and use that component's helper and class, as is. Vary it
   only through the options it already has (a tone, a sub-note, multi-select), never with
   new CSS on top.
3. **If nothing fits**, don't make it yet. Say why each close match doesn't work and bring
   the proposal to the owner. Once approved, it's drawn in the prototype and added to this
   table in the same change, so the next screen can reuse it.
4. **Each prototype batch is checked for duplicates** before it's committed: no class that
   repeats an existing one, no second way of drawing the same job.

| Job | Component (prototype helper · class) | Use it for | Not for |
|---|---|---|---|
| Open a record or screen | `row()` · `.row` in `.card .rows` | Any list of things to tap: icon, title, subline, end value | Read-only lines |
| Read-only line in a list | `srow()` · `.row.static` | A fact or a sentence shown as a row; optional tone and end value (a due date and its amount, a signer) | Anything tappable |
| Main navigation rows | `.big-rows` | A hub's top-level rows (Business, More) | Ordinary lists |
| A hub's sections | `tiles()` · `.sec-grid` / `.sec-tile` | A record's sections with a one-line status | Settings |
| A setting she answers | `qRow()` · `.q-row` | One question that saves at once: an amount, time or list she can name opens to chips and + (D10); fixed phrase answers open to a radio list | Form fields saved with Save |
| Two options, one required (named) | `fChips()` with two options draws `fSeg()` · `.seg` | Kennel / Third party, Round trip / One way, + / −, $ / % | Yes / No; a choice that can be left blank |
| Yes or no, one required | `fChips()` with Yes / No draws `fSwitch()` · `.f-switch` + `.switch` | Offered on new sales, Shown to families, Requestable | A choice with a "neither" or blank |
| Three or more fixed choices | `fChips()` · `.chip` | Flat / Per day / Per mile, Same as group / … | Lists that grow with her records |
| Several of a few choices | `fChips({ multi })` · `.chip` | Ticking any number (add-ons on a sale, what a due date covers) | Long lists |
| On or off in a list, saved at once | `.switch-row` · `.switch` | Feature and trait switches | |
| One of several, each needing a line (trial) | `fRadio()` · `.radios` / `.radio` | Options that are phrases or need a short explanation; an option that can't apply is disabled with why (a price rule's type, an add-on's When paid and Due dates) | Short choices: chips |
| A list that grows with her records | `fSel()` · `select` (groups as `{ group, opts }`), filter dropdowns (D11) | Dogs, groups, partners, families, schedules. Dogs: Sires, then Dams, each alphabetical | Two or three fixed choices |
| Text, number, date, time | `fIn()` · label above the input, hint as `<small>` | Every typed value | |
| Longer text | `fText()` · `textarea` | Notes, messages | |
| Fields side by side | `.dates` | Two or three short fields that belong together | Labels long enough to wrap at phone width (stack them) |
| A section of a form | `formCard(title, inner, sub)` · `.card.app-card` | Each group of fields, with a short note on the right | |
| Save and Cancel | `saveBar()` · `.actions-2` | The end of every form | |
| The header's one action | `addBtn()` · `.bar-btn` | New, Edit (at most one, with search and back) | A second action: use a row or a link |
| A link to another screen or action | `setLink()` · `.set-link` | "Edit default add-ons", "New schedule" | The main action |
| A heading with an action | `.label-row` + `.group-label` + `.set-link` | A section heading that adds to it (Saved schedules, Price rules) | |
| Section heading | `.group-label` (between cards), `.section-h` (inside a card, with a count) | | |
| A status | `pill([label, tone])` · `.pill` | Status and kind tags, the fixed tones only | Sentences |
| A short summary | `facts()` · `.facts` | Key and value pairs at the top of a record | Long lists |
| Big numbers | `.kpis` / `.kpi` | Totals at the top of a money screen | |
| A hint | `.f-hint` | One short line under a field or card (D14) | Warnings |
| A note, result or warning | `.stub-note` (`.warn` for amber) | A worked result, a heads-up, a conflict | Hints |
| Nothing yet | `empty()` · `.card.empty` | An empty list, with its one action | |
| Delete or end | `delRow()` · `.big-rows.danger` | The destructive action, last on the screen | |
| Repeating steps | `stepCards()` · one `.card.app-card` per step, Remove in its head, Add below with the total | A payment plan's payments, a schedule's due dates | |
| Edit in place | `.rem` + `.q-edit` | A row that opens to edit one item (a sale's add-ons) | Whole records: open their screen |
| A record's header | `.hub-head` | Its name, pills and one-line facts | |
| Filters | `filterBar()` + the filter sheet | Every list that can be filtered (D11) | |
| Sort | **Sort** at the top of the filter sheet: `ddBox` with `.dd-opt.one` (the date range's single pick), from the list's `FDEF[key].sorts`, the first its default; a sort she picks shows as a chip; the button reads **Sort & filter** (D22) | Any list she'd order more than one way (People, a person picker) | Column headers (tables only, live's `listView`) |
| Choose a person | `personPicker()`: the filter bar, its box also the new person's name, then matching people as rows with `personBadge()` (#2 on the list, Fee due, Applied, Client, Care team), then New person's details | Every place a person is chosen: a sale's buyer, Do not sell (D21) | A `<select>` of people, or groups by kind of record |
| History | `timeline()` | Events by date | |
| Confirmation | `toast()` | "Saved", "Added", errors ("Name is required") | |

**The two-option rule (D19).** Whenever there are exactly two options and one is required,
it's a toggle: Yes / No (or On / Off) is a switch, and two named options are a `.seg`. Chips
are for three or more options, for choosing several, or for a choice that can be left blank
or has a "neither". `fChips()` applies the rule itself, so a two-option field can't come out
as chips by accident. A question row (`qRow`) whose answers are fixed phrases ("Same for both
sexes" / "Different prices") opens to a radio list, since phrases don't fit a toggle.

## 4. What the prototype loads that the app can't

The app has no CDN (CLAUDE.md). The prototype loads Figtree and Inter from Google Fonts
and Lucide from unpkg. The build vendors them:
- **Fonts:** Figtree 500/600/700/800 and Inter 400/500/600 as woff2 in
  `shared/vendor/fonts/` (both SIL OFL), with `@font-face` in `app.css`, in
  `PRECACHE_URLS`. Same weights only; no faux bold.
- **Icons:** the Lucide icons the prototype uses (same names, same version 0.460.0, ISC
  license) as an SVG sprite or module in `shared/vendor/`, drawn with the same stroke and
  sizes. An icon swapped for an emoji or a different set is a departure (§2.4).

## 5. Phases

Each phase is one or more PRs into `next`, each with §6's checks and screenshots.

0. **Foundation.** Tokens, fonts, icons, component CSS copied in (§2.2); the design check
   (§6) built and run against the prototype itself. No page changes yet.
1. **Shell.** `nav.js` draws the header band, tab bar and rail; back history; search
   button (search itself in phase 2). Every page gets the shell.
2. **Home and search.** Count tiles, This week, Coming up; the search overlay.
3. **Dogs.** The list (tabs Puppies / Breeding / Not breeding / External / All, the table
   with wide-only columns), the Dog hub and its section screens, History as the timeline.
4. **Litters.** Litters, Pairings, Active breeding; the Litter hub; Go-home and Weigh
   puppies.
5. **Waitlist tab.** Needs you (with the tab badge), Selling now, The list, Applications,
   Fees due, Family requests, Turn order, Picks preview, Programs.
6. **Business.** Sales & Placements, People, Financials (KPIs, chart, categories), Entries,
   Reports, Accounts, Extra charges, Pricing and schedules (D9), Stud services, Contracts.
7. **More and Setup.** Setup's areas and questions, What you use; Backup, Import/Export,
   Sharing, Danger zone. Needs D2.
8. **Filters everywhere.** The shared filter sheet replaces each list's own controls.
9. **The rest.** Every page not yet converted, by §2.5.

Program types' screens (How you breed, View as) and Line Management's (Lines, pair check,
pairing finder, Relatives, Traits, Genetics, Births, Score puppies, Breeding program) are
built with their own plans' phases, to the same rule.

## 6. How a screen is checked against the prototype

1. **Token test** (`tests/designTokens.test.js`): reads the `:root` blocks from the
   prototype and from `shared/assets/app.css` and fails on any token that is missing or has
   a different value.
2. **Style comparison** (`build/designCheck.mjs`, Playwright, the pre-installed Chromium):
   opens a prototype screen and the matching app page with the Demo seed (the prototype's
   sample program, Thornfield Kennels, uses the Demo seed's names), at the phone frame
   (400px wide) and desktop (1180px), light and dark. For each pair of matching elements
   in a map (`docs/design/screenMap.json`: prototype screen + selector ↔ app page +
   selector), it compares the computed font family, size, weight, line height, letter
   spacing, color, background, border, padding, gap, radius, shadow, and icon name and size,
   and prints every difference. Any difference not in `docs/design/departures.md` fails.
3. **Side-by-side screenshots**: the same script saves prototype | app images per screen,
   phone and desktop, to show the owner in the PR (shown, not committed).
4. **In each PR description**: the screens converted, the check's output (zero unlisted
   differences), and links to the screenshots.

A screen with no entry in the map isn't converted yet, so the map also tracks progress.

## 7. Edition and architecture notes

- Shared core stays edition-agnostic: Lite's fewer tabs and tiles come from lists in
  `editionConfig.js`; What you use shows Lite's Pro-only features as locked (Design notes,
  "Lite edition").
- Multi-page stays: hubs and section screens are pages (or one page per hub with the
  section in the address, D3), not a SPA router. The one back history works across page
  loads.
- Pages still go through repos; settings moved into Setup go through `settings.js` or the
  kennel record's repo.
- The UI rule on buttons holds: the prototype's headers carry at most one action plus the
  search and back buttons.

## 8. Decisions (owner, 2026-11-19)

- **D1. Dark mode.** The prototype has it (following the device, plus a forced theme);
  today's app doesn't. **Decided: build it**, since it's in the approved design.
- **D2. Where Setup's answers are stored.** The Design notes propose program-wide answers
  on the kennel record (so they sync) and device-only ones in `settings.js`. Moving a
  setting into synced data is a privacy decision (`syncRegistry.js`). **Decided: each
  setting that would move into synced data is listed for the owner, and she answers before
  phase 7 starts.**
- **D3. Hub addresses.** A page per section screen, or one page per hub with the section in
  the address (`dog.html?id=…#history`). **Decided: one page per hub.**
- **D4. Fonts and load budgets.** The two font families add weight to the first load;
  `build/loadCheck.mjs`'s budgets are raised to fit, or the fonts load after first paint
  with matching fallback metrics so nothing moves (Load Performance plan Phase 1).
  **Decided: load after first paint, with matching fallback metrics.**
- **D5. Planned placeholders.** **Decided: they never ship.** the "Planned: hidden" view is
  the build target; each feature's own plan builds its tile or row.
- **D6. Order of the switch.** All phases land on `next` and are released together, or
  the shell and tokens are released first. **Decided: together**: half the app in the old
  look is worse than either.
- **D7. Furever and the family pages.** Not in the prototype. **Decided: they keep their
  own themes.**
- **D8. One person, one page.** **Decided: a person's details live in one place and she
  works with that person on one page.** There is no applicant page apart from the person's
  page: a waitlist family, an application, a row in People and a sale's buyer all open the
  same page, and their applications, place in line, offers, sales, contracts and payments show
  there as parts of that person. Their name, email, phone and address appear once on it, and
  changing them there changes them everywhere (emails, sign-in codes, contracts, sales,
  invoices, the portal).
  - **Never two sets.** No screen shows a second set of details that looks like it should
    do something but doesn't. What a family first typed on an application is part of their
    answers, never a competing name, email or phone.
  - **Her terms, not ours.** Breeders aren't expected to understand how records are stored,
    and no screen explains it. The screens are designed to fit how she thinks about people,
    so they look like the data was built that way.
    **Applies to every screen, not only people (the owner, 2026-11-20):** no copy exists to
    tell her about the plumbing: where a file or record is kept or filed ("in Poppy's
    documents"), that it's on this device or in the cloud, what moves where on a merge, what is
    or isn't stored, or which service carries it ("through your Dropbox"). A line stays only
    when it changes what she decides or does (Replace deletes what's on this phone; a reset
    can't be undone).
  - **Change it where she is.** Where she'd reasonably believe a page is the place to change
    something (an applicant's email, on that applicant's page), it is. She's never sent to
    another page to change it.
  - **The prototype** (2026-11-19) draws it: one person page (`S.person`) opened from the
    Waitlist, People, a sale and search. The top card holds their name (the header), email,
    phone and address; **Edit** in the header opens **Their details** (`S.personedit`), whose
    Save changes them everywhere. Their application (`S.personsec`, answers only, no name,
    email or phone repeated), offers, fee, sale, go-home, contract, messages, status page and
    History are tiles. Every waitlist family and client is a row in People. Design notes:
    "One person, one page". Phases 5 and 6 build it.
- **D9. Pricing and schedules.** **Decided: her usual price, deposit, timing and ways to pay
  sit with her saved payment schedules, on one screen, Business › Pricing and schedules.**
  They're settings, but ones she changes often, and to her a "payment schedule" means all of
  it: her usual price (and male and female prices when they differ, and the full
  registration surcharge), her usual deposit, when it and the balance are due, and how
  families pay. The screen opens on "A usual sale" in a sentence, then those answers as
  question rows (the same rows as Setup) and the saved schedules, the usual one marked.
  New sales start from these; any one sale can still differ. Setup's row for them opens the
  same screen (not a copy), and Setup keeps Invoices & receipts for the invoice footer and
  receipt wording. In the prototype: `S.pricing`; a litter's Pricing links to it with
  "Change your usual prices". Whether these answers sync is part of D2's list. **New
  schedule** sits on the Saved schedules heading, not in the header.
- **D10. Her own answers.** **Decided: every answer that's an amount, a time or a list she'd
  name herself ends in a +** (no label: the + is enough; its accessible name is "Add your
  own"). She types her own, it's selected, and it's one of her choices from then on. The
  choices shown are only common starting points: a few typical values for the breed and
  program type, her current answer, and every value she has added. Amounts are tidied as
  she'd write them ($450, +$750). A question whose answers are fixed (yes or no, same or
  different, the waitlist's rules about how offers go out) keeps its choices and has no +.
  In the prototype: `qRow`, `OWN_VALUE` lists which questions take one. This holds in Setup
  and on every screen with question rows.
  - **Why.** The waitlist family page edited the application's copy of name, email and phone
    while emails, codes and contracts read the contact's, so a corrected email changed
    nothing and nothing said so. The live app's stopgap (on `main`, 2026-11-19) has that page
    show and edit the contact's details; the redesign removes the split.
- **D11. Filters: dropdowns, and dam and sire (2026-11-20).** The owner: some filters are
  better as dropdowns than buttons, and a litter filter is by **dam and sire independently**,
  picking as few or as many of each as she likes. **Drawn as:** short, fixed choices (status,
  sex, kind) stay chips; the date range is a one-pick dropdown; any list that grows with her
  records (dams, sires, families, categories, event types, who was paid) is a dropdown where
  she ticks any number, with a find box past eight and a count beside each. Dogs, Litters and
  Sales filter by Dam and Sire; there is no Litter filter. Which groups are dropdowns is the
  prototype's `FDEF[...].dd`. The chips-or-dropdown rule is a proposal for her to confirm.
- **D12. Header title and back arrow (2026-11-20).** The owner: every screen's header title is
  the same size as the KennelOS PRO brand (21px, was 23px), and the back arrow sits tighter to
  the edge and the title (`.appbar .back-btn`, margin 0 −6px 0 −8px). A long title wraps
  beside the header button instead of running under it.
- **D13. What the app fills in, she can change (2026-11-20).** The owner: "I should be able to
  modify basically anything I need to." Every amount, date or choice a screen fills in for
  her (a price from the litter, a deposit from her usual, a due date from her rules) is a
  starting point shown in a field she can change on that screen, with a line saying where it
  came from; changing it there changes only this record, never the setting it came from.
  First applied to Side sale (price, deposit, deposit due, go-home, payment schedule, notes);
  every sale and money screen in the Business batch follows it.
- **D14. Short copy (2026-11-20).** The owner: hints and notes are a few plain words, like
  "Prefilled from the litter" and "Custom for this sale", not sentences that explain how
  things work. A line earns its place only if she'd otherwise get it wrong.
  **Tone (same day):** written for business owners, in the register of professional
  software: labels and statuses ("Status", "Position: #8", "Fee waived (Military)",
  "Next pass removes them from the list."), errors as "Name is required", confirmations as
  "Saved". No addressing her as "you" to explain, no "they"/"them" chattiness, no reassurance
  ("they're told kindly"), no describing how the app works inside.
- **D15. Add-ons (2026-11-20).** The owner: "extras" are **Add-ons** on screen (stored
  names stay as they are), and transport and boarding after go-home show as add-ons wherever
  she adds them to a sale or sets defaults, though their data stays where it is. One screen
  controls every cost outside the base price: Business › **Add-ons** for defaults (Setup's
  transport and boarding rows open it), and a sale's **Add-ons** for that sale (each amount
  editable per D13, boarding by days, one-time charges, the sale's total). The Business table
  of §1 reads Business › Add-ons where it said Extra charges.
  **Groups and rules (same day):** the owner: the add-on fields the live price list has stay
  settable here, styled the new way. Business › Add-ons lists add-ons by **group**; each group
  has its status-page link and link text, request and cancel ages, when it's paid (with the
  balance or a payment plan) and own due dates or the sale's schedule, and each add-on can
  follow its group or set its own, plus a description families see, requestable on the status
  page, and boarding days. Transport and boarding sit in a fixed **Go-home** group that
  can't be edited or take other add-ons. Pricing and schedules shows **Add-on payments**,
  each opening the group or add-on (one place stores it). A sale's Add-ons lists them by
  group. In the prototype: `S.addons`, `S.addongroup`, `S.addon`, `ADDON_GROUPS`.
- **D16. Transport and pickup places (2026-11-20).** The owner: transport's live settings are
  in the prototype, and a new choice is added. Business › Add-ons › **Transport** holds the
  fee per mile, round trip or one way, no charge under, the families it's offered to (living
  at least so many miles away), the "in touch" limit, where miles start (her standard pickup
  place), a distance check (Mapbox's Get driving miles, or Open in Maps) and what families
  see on the status page. **New:** **Handled by**, kennel or third party; for a third party,
  one of her Transport accounts or unknown, and a **referral reward** per partner (per
  booking or a percent of their price), so the screen tracks rewards expected and received.
  A sale's Transport records the same per sale. Setup › Go-home › **Pickup places** is its
  own screen: places, the standard one, shown or hidden, and the pickup change cutoff.
  **Same day:** transport is **Per mile** or a **Flat fee** (new: live has only per mile; a
  flat fee fills each sale's fee, and miles still decide who's offered it), and a sale's
  Transport links to Transport settings and Pickup places.
  In the prototype: `S.transport`, `S.partner`, `S.pickupplaces`, `S.place`.
  **Open:** the new fields (a sale's transport handled by, partner, their price, reward
  received; an Account's reward) need sync classes (`syncRegistry.js`) and a place in
  the Income view before they're built.
- **D17. Price rules (2026-11-20).** The owner: kennel-wide prices stay (D9) and grow into
  **price rules** on Pricing and schedules. A litter's price starts from her usual price, or
  a **breed** rule's own male and female prices (which replace the usual); every other rule
  that fits adds an amount or a percent of that starting price: an **imported parent**
  (either, the dam or the sire; live `Dog.imported`), or **parent scores** on her traits
  (a quality trait or the overall average, by the parents' average, both at least, or either
  at least). The litter's Pricing shows the working; a litter's own price, and every
  existing sale, keeps its own. In the prototype: `PRICE_RULES`, `S.pricerule`,
  `ruledPrice`. **For the build:** the rules fill the litter's `expected_price_male` /
  `_female` (what every sale, the waitlist's turn prices and her website already read), so
  nothing downstream changes; when they fill it (on creating the litter, and again while
  she hasn't set her own) and the new kennel fields (`price_rules`, and the usual price
  itself) need sync classes. Breed needs each litter's breed (from its parents). Other
  rule kinds (health results) fit the same shape.
  **Same day:** more rule kinds: **a parent** (a specific dog as the dam or sire), **parent
  title** (any title or one, `Dog.titles`, held by either, the dam, the sire or both), and
  **registry** (`Dog.registry`, AKC, CKC, UKC or not registered, for either, the dam, the
  sire or both); imported parent also takes Both. Any rule but a breed can **add or
  subtract**. Color is left out for now: the owner is looking into standard and
  non-standard colored parents (as Boston Terrier pricing does) before deciding it.
- **Field coverage: Pricing and sales (2026-11-20).** Traced against live so nothing
  automation reads is lost; now in the prototype:
  - Saved schedules (`S.schedule`, live `Kennel.payment_schedules`): due (`at_weeks`,
    `on_date`, `before_pickup`, `at_pickup`), `n` / `due_date`, `covers`, percent of total or
    remaining (`basis`) or an amount that earlier money can or can't cover (`prior_funds`);
    the last step is always 100% of all.
  - Pricing and schedules: payment instructions (`waitlist_config.payment_instructions`) and
    the final payment (`Kennel.final_payment_methods`).
  - A litter's Pricing: deposit and full registration by sex (`expected_deposit_*`,
    `full_reg_surcharge_*`), and its dates (`accept_deposits_date`, `picks_open_time`,
    `estimated_ready_date`), which the offers, countdowns, pickup times and boarding read.
  - Sale details (`S.saleedit`): `status`, `sale_date`, `registration_type` (all four),
    `price`, deposit (`deposit_amount`, `deposit_date`, `deposit_paid_via_account_id`),
    `payment_schedule` or `balance_due_date`, `balance_paid_date`,
    `balance_paid_via_account_id`, `sales_channel_account_id`, `processing_fee_amount`,
    `fee_passed_to_buyer`, `lead_source`, `referred_by_contact_id`, `end_reason`, `end_note`,
    `refund_amount`, `refund_date`, `notes`. Payments (`payments[]`) are a row still to draw.
  - Side sale: Co-own and None registrations, and "Also set the pup's registration"
    (live `updateRegistration`).
  - Boarding on a sale: per Day / Week / Month and a duration note
    (`deferred_boarding_frequency`, `deferred_boarding_duration_days`).
  **Open for the owner:** (1) "Used on new sales" puts a saved schedule on every new sale;
  live decided a sale never starts with one (Payment Schedule plan D23). (2) Pricing's
  Deposit due is live's turn length (`respond_days`, the waitlist's "Time to answer an
  offer"): one setting shown in two places, or two settings. (3) Her usual price, deposit,
  ready age, deposits-open and balance-due rules are new kennel fields (live keeps these per
  litter or per sale), each needing a sync class.
- **D18. Share components (2026-11-20).** The owner: share and reuse where able, for one
  unified, cohesive look across the whole app. The display components are tracked by job in
  §3.1; every new field or piece is checked against that list first, reuses the one that
  fits, and a new piece is made only once we've verified none does (and the owner agrees).
  The build follows the same rule in `shared/assets/app.css`.
- **D19. Two options are a toggle; one step component (2026-11-20).** The owner: anytime
  there are two options and one is required, it's a switch or toggle; a choice with a
  "neither", or one that can be left blank, is different. Yes / No is a switch, two named
  options are a `.seg`, built into `fChips()` (§3.1). Repeating payment steps (an add-on's
  payment plan and a saved schedule's due dates) share `stepCards()`: one card per step.
- **D20. Price rules look at the parent or the pup; radio lists on trial (2026-11-20).**
  The owner: a rule first picks **Parent** or **Pup**, then what to look at: **Name** (a
  specific dog; was "A parent"), **Breed**, **Registry**, **Title**, **Imported**, **Scores**.
  For a pup, Name, Title and Imported are greyed out (parents only). A pup breed rule sets
  the base price (as D17's breed rule did); a parent breed rule adds or subtracts by which
  parent (a Poodle sire, say); pup registry and pup scores (her puppy evaluations) adjust
  each pup's own price. **For the build:** parent rules fill the litter's expected prices as
  in D17; pup rules are applied on top when a sale's price is prefilled (`saleDefaults`'s
  `expectedPricing`), so the litter keeps one stored price per sex. The rule type is a
  **radio list**, tried here and on an add-on's Payment card (When paid, Due dates) for the
  owner to compare with chips; §3.1 lists it as a trial component until she decides.
  **Same day:** question rows with fixed phrase answers (Setup, Pricing and schedules, a
  litter's Pricing split) open to a radio list; questions she can answer with her own value
  keep chips and +. A list of dogs is grouped **Sires, then Dams**, alphabetical in each.
- **D21. One sale screen; people as one list (2026-11-20).** The owner: she never sees a
  difference that comes from how records are kept. A sale to a waitlist family is drawn on the
  same Add sale screen as any other, never named as a side sale; what's different shows only as
  notes (what doesn't match, another claim, a held pup, their open turn). Choosing a person is
  one list, not "Waitlist" and "People": waitlist families are people too; where they stand is a
  badge, and the order and filters do the rest. The live-app change is
  `docs/KennelOS_Unified_Sale_Plan.md`.
- **D22. Sorts and filters on a person list (2026-11-20).** The owner: a list of people sorts
  (Waitlist first, Name A–Z, Name Z–A) and filters (applied: on the list, fee due, applied,
  haven't applied). Live sorts only by table column headers, which card lists don't have, so
  Sort joins the shared filter sheet as its first dropdown (§3.1). People and the person picker
  have it; other lists gain their sorts as they're converted (phase 8).
- **D23. Add-ons on a sale; one-off add-ons (2026-11-20).** The owner: a sale's add-ons, on Add
  sale and on a saved sale's Add-ons screen, show only the ones on that sale, with **+ Add**
  (her add-ons by name, and a one-time charge) and **Edit amounts** on each. Transport and
  boarding are the sale's own and just change. An add-on from her list at another price asks
  to **make a one-off add-on**, prefilled with everything else the same, because contracts
  (an Extra agreement's `extra_list_id`) and the statement read the list row live: a one-time
  charge would lose that. Before making one, a one-off from the same add-on with the same values
  is used instead, so two sales at $120 share "Photo session ($120)". One-offs are never offered
  (status pages, her website, new sales, the + list, Pricing's Add-on payments); Business ›
  Add-ons › **One-off add-ons** lists them with the sales using each. In the prototype:
  `addonPicker`, `adDo`, `S.saleaddons`, `S.oneoffs`, `oneOffs`, `sameOneOff`.
  **For the build:** a row of `Kennel.extra_charge_list` gains `one_off` (boolean) and
  `base_list_id` (the row it came from); both private like the list (`syncRegistry`), optional
  in backups. Every place that offers extras skips `one_off` rows: the status page's requestable
  extras, the website feed, new-sale presets and pickers; contracts' form-kind pick
  (`extraChoices`) lists them under their base. The match is on name, group, unit, price,
  description, days and payment rules. A one-off is written when the sale is saved, so a sale
  she abandons leaves none (the prototype makes it at once).
- **D24. Possible duplicates on the hubs (2026-11-20; drawn, for the owner's review).** The
  owner: a hub with possible duplicates shows one row ("2 dogs may be entered twice") that opens
  them for that kind of record; none, no row. Hubs: Dogs (dogs), People (contacts and kennels),
  Litters (litters and pairings), Sales, Financials (expenses); the Waitlist keeps its own
  applied-twice row. Events, documents and contracts stay in Import / Export's full check. The
  screen: one card per pair, Not the same or Merge (keep which, which value wins), as
  `recordMerge.js` does today. **Rules for the build:** the counts come from `duplicateScan.js`,
  run on the device in the background a few seconds after a data change (and after a sync), one
  table at a time; a hub reads the saved count, so nothing is scanned on a page open and the row
  never appears after first paint (Load Performance Phase 1); a stale count shows no row until
  the next visit. The saved counts are device-only: never `markDataChanged()`, never backed up or
  synced, so they cause no Worker requests. Adding a record checks only that record against its
  own table, using the same rules. **On an add form (the owner, 2026-11-20):** a certain match
  (the same email or phone; the same registration number or registered name) leads with **Use
  [name]** as the main button beside **Create new**; a name alone is a quieter "Possible match"
  line. Neither blocks saving: Save becomes **Save anyway**.
- **D25. Documents for more than a dog; smaller files (the owner, 2026-11-20; planned, not
  built).** Asked by the owner. Nothing here is drawn or decided past what's written; the open
  questions are at the end.
  - **Today, in live:** a document must belong to one dog (`documentRepo` refuses one without
    `dog_id`); a contract's signed copy is a dog's document with a `contract_id` back-link. The
    only other stored files are an expense's receipt (`receipt_file_id`, not listed in Documents)
    and the kennel logo. Papers about the kennel, a litter, a person or a whole stud service have
    nowhere to go.
  - **Who a document belongs to:** one owner: a dog, the kennel, a litter, a person, a sale or a
    stud service. Additive only: `dog_id` stays for a dog's document (a shipped field is never
    renamed), and new optional `owner_type` + `owner_id` name any other owner, with a compound
    index in a new `db.version` block. Each owner is a new `referenceRegistry.js` entry (an owner
    can't be hard-deleted while it has documents); the fields are classified in `syncRegistry.js`
    (making them `cloud` is a privacy decision, to surface). Backups: check before building that
    an older build reading a file with a non-dog document skips it rather than failing; if it
    can't, that decides whether the backup format version is bumped.
  - **Types by owner:** a dog keeps today's six. The kennel adds License or inspection,
    Insurance, Breeder program; a litter adds Litter registration and Litter vet check; a person
    adds Application and Proof of payment; a sale or stud service uses Contract and Other.
  - **Screens:** Documents groups by owner (the kennel first, then dogs, litters, people), with a
    "Belongs to" filter in the shared sheet. A Documents tile on the litter page, the person page
    and a sale, and a Documents row in Setup › Your kennel. A litter's documents also show on each
    of its pups' Documents as "From the litter", worked out when shown, never stored twice.
  - **Smaller files.** Already: photos and screenshots become a compressed PDF (`pdfBuild.js`:
    longest edge 2,000 px, JPEG 0.8, a 320 px thumbnail), and the cloud stores each file once by
    its SHA-256 (`cloud/src/files.js`), refusing files over 25 MB. To add:
    - **Scanned PDFs are compressed too.** An uploaded PDF over about 1.5 MB that is mostly page
      images is re-rendered page by page and rebuilt with `pdfBuild.js`'s settings, showing the
      size before and after; she can keep the original instead. Needs a PDF renderer vendored
      into `shared/vendor/` (pdf.js) and loaded only on that path, so no page carries it.
    - **Never touched:** a PDF with text (e-sign output, a registry's certificate) or any signed
      contract. They're already small, and re-rendering would flatten the text and break a
      signature's validity.
    - **One copy on the phone:** a file attached twice (one stud contract on the stud and the
      bitch) is stored once, by SHA-256, and deleted only when its last document goes. That
      changes today's rule that a file belongs to exactly one document (`referenceRegistry.js`'s
      Document note), so the guide changes with it.
    - **Storage shows what's used:** on this device and in cloud backup, with the largest
      files first, so she can find the one 20 MB scan.
  - **Worker cost:** a file goes to the cloud once (already content-addressed); compression
    makes each upload smaller. Nothing here adds a request per page open.
  - **Open (the owner's):** (1) Can one document belong to two owners (the stud contract on both
    dogs), or does it have one owner and show elsewhere as a link? Recommended: one owner, with
    the litter-to-pups case shown as above. (2) Is compressing a scan automatic, or offered with
    the sizes? Recommended: automatic, with "Keep the original" on the same screen. (3) Does
    Lite get documents beyond dogs, or is it Pro (`proPages.js`, `editionConfig.js`)?

- **D26. Hubs built one way; a stage bar (the owner, 2026-11-21).** The owner: tiles aren't
  the problem, tiles repeating each other are; a breeder changes everything live lets her
  change, grouped sensibly, reached the same way on a dog, a litter, a pairing and a sale.
  - **A hub** is a header card (who or what it is), a **stage bar**, anything needing
    attention, then tiles. The header holds no add or Edit button.
  - **The stage bar** says where the record is in its life, the next step as a button, and the
    stage itself tapped to pick any stage. Colour: blue coming, amber waiting on her, green done,
    grey ended. The steps are the ones live's status rules prompt for: a litter's Expected →
    Whelped (Record the birth) → Weaning → Ready → Sold (when every pup has a plan) → Closed
    (live's close rule); a pairing's Planned (Log a breeding, which marks it Bred) → Confirmed
    pregnant (adds the expected litter) or Not pregnant → Whelped (Record the birth), an ended
    pairing taking its expected litter off; a sale's Deposit pending → Deposit paid → Paid in
    full, which follow the money, then Mark delivered (live's delivery questions: owner,
    leaves her dogs, close the litter), with returned / cancelled / voided in Details › Edit
    (they ask why); a puppy's plan (Undecided, Available, Keeping, Health hold; Placed from a
    sale). An adult dog has no bar; its status changes stay in Edit with live's prompts.
  - **Details** on every hub holds what it is, with Edit (and Archive or Delete at its foot).
    Every other tile holds one group and edits only that, Edit in its own header (a sale's
    **Price & payments**: price, deposit, channel). A pairing gets a hub: Details, Pairing
    check, Breeding (the dam's heat, progesterone, breedings, ultrasounds), Litter.
  - **A row in a list opens to change or delete it:** events, expenses, documents, payments.
    Money received opens to where it was recorded.

## 9. Carry-over notes

Gaps in the live app to close when the screen that has them is rebuilt. Each is the owner's or
found in the code; none is built yet.

- **C1. Pedigree import doesn't find a parent typed by call name (the owner, 2026-11-20).** In
  live, Kels's litter task asks only for an outside sire's or dam's call name (registered name and
  number are optional), so she often saves "Titan" with neither. The pedigree import
  (`data/pedigreeImport.js` `planImport`) matches a chart's dogs by registration number, then
  by registered name, never by call name, so the same Titan arriving on a chart as "Meadow
  Ridge Titan of the Hill" becomes a second, pedigree-only dog. When pedigree import is brought
  into the redesign:
  - A chart dog that matches nothing by number or registered name is also compared with dogs
    that have neither (a call name only), by `dogSearch`'s word match. The strongest clue is
    position: the chart's sire or dam where the dog the chart is for already has a sire or dam
    recorded. A match goes to the import's review ("Same as your Titan?"), never automatically.
  - Choosing it fills the existing dog's blanks (registered name, number, color, birth date)
    from the chart, as the import already does for a matched dog, and its ancestors hang off that
    dog. Nothing it has is overwritten.
  - Kels's outside-parent step and Add dog's outside dog offer the registered name and number
    (still optional), so fewer dogs are saved with a call name only.
  - Possible duplicates (D24) also raises a call-name-only dog and a pedigree-only dog whose
    registered name contains that call name, with the same breed and sex, as a **Possible**
    pair, so ones already split can be merged.
