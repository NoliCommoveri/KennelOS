# KennelOS — UI redesign to the forest look (plan)

> Status: **plan only, nothing built** (2026-11-19). Work goes on `next` (CLAUDE.md "Next
> release").
>
> **The approved design is the prototype**: `docs/design/forest-look-prototype.html`, a
> copy of the owner's artifact "KennelOS Forest Look" (claude.ai artifact
> `Qon8foccjzDmQc4ssLcua1`, version of 2026-11-18). Open it in a browser and use the bar at
> the top (Phone / Desktop, Planned shown / hidden, View as, Design notes). If the owner
> changes the artifact, copy it in again and note the date here; the repo copy is what
> builds are checked against.
>
> **Decisions:** the fidelity rule in §2 and D1–D7 (§8) are the owner's (2026-11-19).

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
  The only switches are in **What you use**.
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
| Header title (`.appbar h1`) | Figtree | 23px / 700, letter spacing −.01em |
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
   Reports, Accounts, Extra charges, Payment schedules, Stud services, Contracts.
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
