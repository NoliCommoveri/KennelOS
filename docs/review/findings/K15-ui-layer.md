# K15 — The UI layer: escaping, accessibility, phone, offline

Reviewed: read in full `shared/assets/ui.js` (289), `listView.js` (276), `chartView.js`
(394), `printView.js` (64), `shared/app.js` (239), `shared/index.html` (24), `sw.js`'s
install and fetch handlers (563); `reportView.js` (331), `timeline.js` (162), `pedigree.js`
(323) and `nav.js` (124) through the scanner and by the lines it or a browser run pointed
at; `assets/app.css` (1336) by token, media query and the rules a finding rests on. By
scanner: all 172 scripts under `shared/pages` and `shared/assets` plus `nav.js`, `app.js`
and `assistant.js`; the inline script of `shared/companion-view.html` (549 lines);
`cloud/public/family` (8 files); `furever/` (47 files). By browser: all 87 pages. The
newest screens by name: `pages/do-not-sell.js`, `pages/dog-cards.js`,
`assets/picksPreviewModal.js` (457), `assets/sideSaleUI.js`, `assets/qaListEditor.js`
(through `kennel.html#waitlist-settings`), `cloud/public/family/list.js` + `common.js`
(the program badge bubble), `assets/cloudAssistUI.js` (the helper bar).
Contract read: guide §12 (service worker), §13 (UI layer), §16 invariants 1 and 4; plan
§0, §0a; the dataviz guidance (its palette validator, mark and interaction rules).
Verified by: `node --test` → 1649 pass; `node build/assemble.mjs` → every edition builds.
Baseline green. `cd cloud && npm test` not run (no Worker code in scope, and
`cloud/node_modules` isn't installed in this session). Scratch work, all in my scratchpad
and not the repo: the scanner below, its fixture (11 planted misses → 11 flags), and
Playwright (Chromium, headless) against `python3 -m http.server` at the repo root: a sweep
of all 87 pages with 586 text values replaced by a proof string; an accessibility sweep of
all 87; a form-label audit of 11 form pages; keyboard and dialog runs on Dogs and a dog's
page; three phone sweeps of all 87 pages (320px, 320px with long names, 390px); the newest
screens at 320px; the public list from `cloud/public` with `/f/list` stubbed; the helper
bar on `dist/pro` with a faked helper session and every outside request refused; four
reports on an emulated touch phone; the waitlist entry page for all eight sample families
(three tabs each) with every dialog its buttons open, before and after a pick, at 320px;
all 87 pages with the service worker serving and the network off; cloud sign-in offline on `dist/lite`; and three two-tab runs of the schema
hand-off, with `db.js` given one extra empty version block in flight. The chart palette
went through the dataviz validator; the chart renderers through 13 edge cases in Node.
The local server was stopped at its time limit near the end; the runs after that used a
server started and stopped inside the command. Main was merged in after the first push
(K6b's findings and `KennelOS_Waitlist_Fixes_Plan.md` had landed): no text conflict, and
the entry-page run above is the part those two documents leave to K15. On localhost `/shared/` offers the cloud
screens (`devCloudUrl`); a signed-out page sends nothing off the machine (checked by
refusing and logging every outside request).

Screenshots: [`K15-ten-pages-320.jpg`](K15-ten-pages-320.jpg) (the ten busiest pages at
320 × 568) and [`K15-reported-320.jpg`](K15-reported-320.jpg) (what findings 1, 2, 5, 6,
7 and 9 describe).

| # | Sev | Where | What | Verified? |
|---|-----|-------|------|-----------|
| 1 | S2 | shared/data/db.js:225; shared/app.js:124 | While a storage update waits on another copy, only the first page says so; every later page and a reload show an empty list and no message | verified |
| 2 | S3 | shared/assets/ui.js:109 | No dialog takes the keyboard: focus stays behind it, Tab leaves it, Enter twice stacks two, and none of the 38 dialogs has a name | verified |
| 3 | S3 | shared/assets/listView.js:207,226; reportView.js:306 | Records in lists and reports open only with a pointer: no link in any row, sortable headers aren't focusable | verified |
| 4 | S3 | record forms; listView.js:65; reportView.js:103 | 123 of 203 form fields have a label a screen reader can't tie to them; 33 search boxes have a placeholder and no name | verified |
| 5 | S3 | listView.js:135,201; app.css:402; 14 pages | At 320px 14 of 87 pages scroll sideways (Financials, Pairings, Litters, Board, Invoice among them); at 390px four still do | verified |
| 6 | S3 | pages/kennel.html header; pedigree.html:34 | A long kennel name or registered name pushes the Kennel page's header and the Pedigree picker off the screen | verified |
| 7 | S3 | shared/assets/picksPreviewModal.js:199-227 | On a phone the picks preview is 4,453px tall and its only two buttons are at the bottom | verified |
| 8 | S3 | shared/assets/app.css:13,485,808 | Field hints and "faint" text are 12px at 3.07:1 on white (2.87:1 on the page background), in 585 places | verified (calculated) |
| 9 | S3 | shared/assets/chartView.js:298,310,374 | On a phone, ranked-bar labels lose their beginning, and a column's or a line's value shows only on hover | verified |
| 10 | S4 | pages/dog.js:296 and seven more | Eight links take whatever scheme the value has (a Dog Card can supply one); two ids are interpolated unescaped. Extends K14 §17 with the full list | verified |
| 11 | S4 | shared/data/db.js:233; shared/app.js:128 | "Updated in another tab… can no longer be saved" isn't true: the old tab saves, and keeps running old code on the newer database | verified |

## The escaping scanner, and what it cleared

The scanner is at the end of this file (`k15-escape-scan.cjs`, with its fixture and the
allow file). It parses the code rather than matching lines: from every place HTML is made
it walks each value back to where it came from, across functions, callers and files.

```
node --expose-internals k15-escape-scan.cjs --allow k15-allow.json
```

**Result: no place where a typed or received value reaches HTML unescaped.**

| | Count |
|---|---|
| Scripts scanned as roots (of 341 parsed for tracing) | 172 |
| HTML template literals | 2,503, of which **791 multi-line** |
| Other sinks: `innerHTML` / `insertAdjacentHTML` right-hand sides, tagged concatenations | 652 |
| `listView` `cell` functions | 32 |
| HTML handed over by name (Kels: `chat.say`, `chat.panel`, `chat.form`, `{ title, html }` screens) | 783 |
| `${…}` expressions in those templates | **5,961** |
| Cleared by the scanner | **5,622**: 2,312 `esc(…)`; 1,138 constants; 761 calls to a builder whose own sources clear; 475 conditionals of cleared parts; 307 variables traced to cleared sources; 265 parameters traced to every caller; 252 `.map().join()` builders; 98 `encodeURIComponent`; 14 others |
| Flagged for a person | 339 expressions = 252 source→use pairs = **160 distinct sources** |
| Of those, cleared by reading (reasons in the allow file) | 150 sources |
| Kept, as finding 10 | 8 link sources (escaped, but the value chooses the scheme) and 2 ids interpolated without `esc()` |

What the 150 were: 42 numbers the data layer computed (counts, fees, miles, an index);
18 `vocab.js` rows or tables of literals (`descriptor()` falls back to the constant
`badge-gray`); 17 links the code builds (`page.html?id=` + `encodeURIComponent`, `mailto:`
+ encoded parts); 16 strings written in the code at every call site; 17 escaped where they
are built, in a helper the tracer couldn't follow (a dynamic import, a `this` field); 9
parts of the Kels chat contract, each caller of which is scanned as a sink; 8 keys the code
makes itself; 6 image sources; 5 chart colours and sizes; 4 `blob:` or bundled URLs; 4
links already checked for http(s); 2 values validated before use (`calendar.js:28`
`isMonth`); 1 `listView` pass-through; 1 device-written timestamp.

**`listView` cells** (the rule names them): all 32 `cell` functions return escaped values,
badges or built links; none returns a field raw. `reportView`'s `value` contract holds:
the framework escapes it (`reportView.js:277`).

**Other roots.** `shared/companion-view.html` (the one page whose content arrives in a
link): 64 sinks, 0 flags; I read its unescaped-looking concatenations and each variable is
escaped where it is set (`:183-197`, `:224`, `:411-412`, `:529-530`). `cloud/public/family`
(the public list, application and status pages): 519 expressions, 15 flags, all cleared by
reading (nine link starts: the breeder's own links, payment links and paths the code
builds, all `target=_blank rel=noopener`; one constant class list; five built or constant
values); `list.js`, which draws the program badge bubble, has none. `furever/`: 353
expressions, 20 flags, all image sources, links the code builds, counts or constants.

**The same thing, tried rather than read.** I appended
`"><img src=x onerror="window.__xss=…">'O'Brien & <b>Sons</b>` to every free-text value in
every table (586 values: names, notes, titles, breeds, colours, addresses, answers,
labels), opened all 87 pages, opened every collapsed card, row detail and the first Edit
form on each, and looked for an `<img src="x">` or a `<b>` in the DOM. None on any page;
no page threw on that data.

**Limits of the scanner**, so a clean run isn't over-read: it follows `this.method()` and
functions passed as parameters, but not methods on other objects, dynamic imports, or
values parked on `this` or the DOM; those come out as flags, never as cleared. Three
hand-overs are known to it by name only (`METHOD_SINKS`, `OBJECT_SINK_KEYS`): a new
chat-like object would be invisible until added. The context check (unquoted attribute,
`on*` handler, URL start) reads template literals, not `'<a href="' + x` concatenations.

## 1. While a storage update waits, only the first page says so  (S2, verified)
**Where** `shared/data/db.js:221-229`: `upgradeBlocked` is set only by Dexie's `blocked`
event. `shared/app.js:120-125`: the banner is drawn on that event, or when the flag is
already set. `listView.js:269-274`: a list paints nothing until its first load resolves.
**Scenario** A version with a new `db.version(N)` block reaches her phone while an older
copy still holds the database and doesn't let go: a copy from before the hand-off was
built, or the installed app frozen in her recent apps. She opens KennelOS. Today shows the
amber bar, "KennelOS is updating its storage. Close every other KennelOS tab or window…
this page carries on by itself once they are closed." She taps Dogs instead. The bar is
gone. The page has its heading, its buttons and its filter tabs, and no list, no
"Loading…", no message. Contacts and Financials are the same; so is a reload. Her dogs
look gone, and the natural next moves are Restore or Reset.
Reproduced in Chromium: a second connection that ignores `versionchange` holds the sample
database; the app tab gets `db.js` with one extra empty version block. First page:
banner. Dogs, Contacts, Financials, then a reload, in the same tab: no banner, 0 rows, the
words "updating", "storage" and "Loading" nowhere on the page. When the other connection
closed, the open page filled in by itself (26 rows), as the banner promises.
**Why it matters** Chromium fires `blocked` for the first open request only; a later page
starts a new request that waits in line without the event. The one page that explains
what is happening is the one she is least likely to still be on. Schema versions 6 and 7
both shipped this month.
**What I'd do** Don't rest on the event alone: if the database hasn't opened about two
seconds after the page starts, show the same bar, and clear it on `ready`. Let the list
frameworks show "Loading…" until the first load returns. Re-check on an iPhone, where the
frozen-app case is the likely one.

## 2. No dialog takes the keyboard  (S3, verified)
**Where** `shared/assets/ui.js:109-115` (`mountModal`) and the four helpers built on it
(`:124-203`); 38 `class="modal" role="dialog" aria-modal="true"` markups across pages and
assets, none with `aria-labelledby` or `aria-label` (0 matches). Only `promptModal`
focuses anything (`ui.js:177`).
**Scenario** A dog's page, keyboard only. Tab to **Archive**, Enter: the dialog appears and
focus stays on the Archive button behind it. Enter again, as anyone would when nothing
seemed to happen: a second identical dialog on top of the first (two `#cm-confirm`
buttons). Reaching the dialog's own Archive button took 17 Tabs through the page behind.
**+ Add Event**: 11 Tabs to get into the form, and Tab walks straight back out (33 of the
next 50 stops were outside it). Escape closes both, as the modal rules say, but focus
lands on "Ask Kels" or the page's last button, not on the button she started from. For a
screen reader `aria-modal="true"` declares the page behind gone while focus is still on
it, and the dialog is announced with no name.
**Why it matters** Every confirmation of an archive, a delete, a hand-back or a sale goes
through these. The picks preview and the side-sale dialog (the newest two) behave the
same, and so does every one of the 21 kinds of dialog the waitlist entry page opens: in
none was focus inside it, and none had a name. K6b §9 says the same of the preview from
the code.
**What I'd do** In `mountModal`, and in one small helper the hand-built overlays call:
remember `document.activeElement`, give the heading an id and point `aria-labelledby` at
it, move focus to the first control, keep Tab inside, restore focus on close. Ignore a
second open of the same dialog while one is up.

## 3. Records in lists and reports open only with a pointer  (S3, verified)
**Where** `listView.js:207-211` (the row's click handler is on the `<tr>`), `:226-239`
(sorting is a click on a `<th>`: no button, no `tabindex`, no `aria-sort`);
`reportView.js:302-308`; `pages/waitlist.js:50` (`<tr class="clickable" data-href>`);
the click-only headers `div.collapsible-header` (`pages/dog.js:105`, and on contact,
litter and pairing), `div.r-header` (companion, furever, breed feeding schedules) and
`tr.expand-summary` (today).
**Scenario** Dogs at desktop width: 60 Tab presses from the top never stop inside the
table of 26 dogs, and the table holds no link to any dog. At phone width each row's ▸ is a
stop; Enter opens the row's extra columns, which hold no link either. So with a keyboard,
or switch access that walks focusable items, she can search and filter the list and
cannot open a dog. The same holds on 33 pages: every list and report built on the two
list frameworks, plus the waitlist (8 rows, 0 links) and the board. Dogs' seven sortable
headers can't be reached at all.
**Why it matters** For someone who can't use a pointer this is a dead end on the app's
main path; for everyone else nothing is wrong, which is why it has gone unseen.
**What I'd do** Make the first cell's text a real link to the record and keep the row
click as a convenience; put a `<button>` in each sortable header and set `aria-sort`;
turn the click-only headers into buttons.

## 4. Most form fields have a label a screen reader can't hear  (S3, verified)
**Where** The record forms are built as `<div class="field"><label>Name *</label><input
id="f-name">`: a label with no `for`, not wrapping its input (`pages/kennels.js:61`,
`ui.js:163-164`, `sideSaleUI.js:95-101`, and every `f-…` form). `listView.js:65-69` and
`reportView.js:103-105`: the search box has a placeholder and nothing else.
`importView.js:32`: the file input has nothing.
**Scenario** Measured on the New dog, contact, litter, pairing, sale, contract, stud
service and waitlist entry forms plus Settings, Do not sell and Dog cards: **123 of 203**
visible fields have a visible label that isn't tied to them (New litter: 28 of 31). On
the first screen of all 87 pages: 33 search boxes named only by a placeholder, 12 file
inputs and 5 other controls with no name at all (`accounts.html` `#type-filter`, the two
link-contract selects on Stud services, two textareas on Waitlist publish). VoiceOver
reads "text field" 28 times down the litter form. Tapping a label doesn't put the cursor
in its field. The waitlist entry page's dialogs repeat it: Review sale & send 9 of 10
fields, Add a credit 4 of 8, Fee received 4 of 4, the side sale 3 of 4.
**What I'd do** Add `for=` where the forms are built (the ids exist), an `aria-label` from
the placeholder in the two list frameworks (two lines cover 33 pages), and an
`aria-label` on the file inputs.

## 5. At 320px, 14 of 87 pages scroll sideways  (S3, verified; screenshots)
**Where** `listView.js:135,201` and `app.css:402`: a list's `<table class="data">` sits in
a plain `<div>`, so a table wider than the phone widens the page instead of scrolling in
its own box. The rest are single elements; widths are what the page measured beyond the
screen.

| Page | 320px | 390px | What sticks out |
|---|---|---|---|
| pedigree | +96 | +26 | `select#ped-root` (`pedigree.html:34`), as wide as its longest option |
| stud-service | +94 | | a status badge and a button in the header row |
| invoice | +82 | +47 | `#inv-pay-link` in the button row; the totals table |
| pairings | +77 | +7 | the list's table |
| board | +76 | +6 | the board's table |
| stud-services | +62 | | `select.link-contract-select` |
| puppy-growth-report | +56 | | `select#growth-litter` (`puppy-growth-report.js:38`) |
| financials | +41 | | the Overview's stat tiles ("ANTICIPATED INCOME $5,796.0…" is cut) |
| returns-report | +28 | | a filter `select` |
| waitlist-form | +27 | | the `#wf-kels` button |
| litters | +18 | | the list's table |
| accounts | +16 | | the card grid (K12 §11 has this one) |
| puppy-record | +9 | | `#pr-fields` |
| dogs | +2 | | the ▸ column |

Of the ten busiest pages (Today, Dogs, Dog, Breeding, Litter, Contacts, Waitlist,
Waitlist entry, Sale, Financials), eight fit; Dogs is 2px over and Financials 41px. The
nav is 52px on every page and its menu works.
**Also on the ten busiest pages** Two controls are under the 24px minimum: the ▸ that
opens a row's hidden columns is 19 × 26 (45 of them; `app.css:435`), and the card
collapse arrow is 16 × 24 (20 of them; `app.css:248`). On a phone the ▸ is the only way
to see the columns a list hides.
**What I'd do** Wrap `listView`'s table in a box with `overflow-x: auto` (one line; fixes
Pairings, Litters and Dogs), and give the board's and the invoice's tables the same box.
`max-width: 100%` on selects in toolbars and headers. Let the stat grid fall to one
column. Pad the two toggles to 24px.

## 6. A long name pushes the header and the picker off the screen  (S3, verified)
**Where** `pages/kennel.html`'s header (`#kennel-title`, the name line, the "Scope the app
to <name>" button); `pages/pedigree.html:34` (`#ped-root`).
**Scenario** A kennel named "Thornfield Golden Retrievers of the Northern Highlands &
Family Kennels" (70 characters). At 320px the Kennel page is 284px wider than the phone:
its own title is cut to "Kennel Overview and Setti", and the name and the scope button
run off the right. A dog with a 90-character registered name (titles in front and
behind, which is what registered names look like): the Pedigree page's dog picker is
870px wide, the page 620px too wide. The Dogs list goes from +2 to +61. The nav and its
brand line are unaffected.
**What I'd do** `overflow-wrap: anywhere` on page headers, let that one button wrap, and
`max-width: 100%` with an ellipsis on the picker.

## 7. On a phone the picks preview's two buttons are eight screens down  (S3, verified)
**Where** `shared/assets/picksPreviewModal.js:199-227`: one body, with **Open picks now**
and **Cancel** as its last line (`:227`). `app.css:651-671`: the overlay scrolls; a dialog
has no maximum height and no fixed foot.
**Scenario** 320 × 568, the sample's Summer litter. The dialog fits the width (288px) and
is 4,453px tall. She opens it to check who is first. Nothing
at the top closes it; the backdrop is a 16px strip down each side; the two buttons are
after the turn order, every pup, the excluded families, the checks and the settings.
**With K6b §9** K6b read this dialog and marked its phone layout "suspected", not having
been able to open it. Measured here, with the sample's data: it fits the width, its four
tables are 244px wide inside the 288px dialog and nothing scrolls sideways, so the tables
don't need a scroll box at this size (12 pups and 60 families weren't tried). The height
is the problem. One correction to K6b §9 and to step 10 of the Waitlist Fixes Plan ("Ask
first; Escape; tables in the scroll box"): Escape already closes the preview. `ui.js:90-101`
sends a backdrop click to the top dialog, which is the close at `picksPreviewModal.js:77`,
so Escape is one more way to lose an unsaved settings change, and the "ask first" has to
cover it rather than Escape being added.
**What I'd do** Keep the two buttons in a foot that stays on screen (and a ✕ at the top),
and start "the settings that decide this" closed on a narrow screen.

## 8. Hints are 12px at 3.07:1  (S3, verified by calculation)
**Where** `app.css:13` `--text-faint: #8a94a1`; `:485` `.field-hint { font-size: 12px;
color: var(--text-faint); }`; `:808` `.faint`. 585 uses across pages and assets.
`chartView.js:34` uses the same grey for axis numbers.
**Scenario** `#8a94a1` on white is 3.07:1 and on the page background (`#f6f7f9`) 2.87:1;
text this size needs 4.5:1. The hints are where the app explains its rules: "Outside the
turn order: nobody's turn changes and it never counts as a pass", "One family holds a
turn at a time across all your open litters". Twelve-pixel pale grey, on a phone, outdoors.
The amber badge's text (`--warn` on `--warn-soft`) is 4.02:1. Everything else I measured
passes: body text 15.6, muted text 5.76, the primary button 5.99, the nav 8.36.
**What I'd do** Point `.field-hint` at `--text-muted`, which already passes, and keep the
faint grey for decoration.

## 9. Charts on a phone: labels lose their beginning, values need a hover  (S3, verified)
**Where** `chartView.js:298` (the label column of a ranked-bar chart is capped at 40% of
the width), `:310` (each label is drawn right-aligned at that column's edge and never
shortened), `:374-375` (the tooltip is wired to `pointermove` and `pointerleave` only).
**Scenario** Health gaps at 320px. The chart is 216px wide and its label column 79px.
"Companion Animal Eye Exam (CAER)" starts 106px to the left of the chart and the edge of
the screen cuts it to "n Animal Eye Exam (CAER)"; "Holter Monitor (ARVC)" and "OFA
Cardiac (Advanced)" run over the card's border. The same on P&L and Expenses ("Foster
compensation", "Shows & handling"). These are the sample's own names. And a tap on a bar
or a column shows no tooltip on any of the four reports I tried, so on a touch screen a
column's or a line point's exact figure can't be read from the chart. The table under
every report has the numbers and ranked bars print their value, so nothing is lost
outright.
**What I'd do** Under about 360px put each label on its own line above its bar, or cut it
with an ellipsis and keep the full text in the row's tooltip. Show the tooltip on
`pointerdown` as well, until the next tap.

## 10. Eight links take whatever scheme the value has  (S4, verified; extends K14 §17)
**Where** Unchecked: `pages/dog.js:296` (`dog.url`), `pages/contract.js:132`
(`document_url`), `pages/litter.js:210` and `pages/litters.js:60` (`photos_url`),
`pages/sale.js:452` (`payment_link_url`), `assets/websiteCard.js:78` (`kennel.website`)
and `:87` (`site.website`), `assets/vendorKeyUI.js:44` (`account.website`). Already
checked for http(s), for comparison: `pages/accounts.js:60,108`, `pages/contact.js:111`,
`data/contractForms.js:22`, `data/waitlistProjection.js:108`, `data/siteExport.js:412`.
**Scenario** A Dog Card from another breeder carries `photosUrl` as plain text
(`data/dogCard.js:70,92-98`: trimmed, nothing else). I built a card with
`javascript:…` in it through the data layer in one browser profile and applied it in
another: the new dog's page shows the URL row as `<a href="javascript:…" target="_blank"
rel="noopener noreferrer">`. Clicking it opened a blank tab and the script did not run
(Chromium). So she is protected today by `rel=noopener` on each of the eight links, not
by a check, and K14 §17 says the same of `dog.js` and the companion view. This is the
whole list, from the scanner's URL rule, so one helper can close all of it.
Two ids are also interpolated without `esc()`: `assets/guidedFormUI.js:51-133`
(`gf-…-${x.id}`, 17 uses) and `assets/guidedPeopleUI.js:211` (`gp-x-${c.id}`). They are
built-in keys and UUIDs in practice; a restore doesn't check an id's shape, so only a
hand-edited backup could put markup there.
**What I'd do** One `safeHref()` in `ui.js` (http, https, mailto, tel; anything else shows
as text) at the eight sites, and the same check where the value is saved or received.
`esc()` at the two id sites, to match the other 2,312.

## 11. "Can no longer be saved" isn't true  (S4, verified)
**Where** `shared/data/db.js:231-233` (Dexie's default on `versionchange` is to close;
the app adds the notice), `shared/app.js:127-129` (the notice).
**Scenario** Tab A has a new contact half typed. Tab B loads the next version and its
upgrade runs. A shows "KennelOS was updated in another tab. Reload this page to keep
working; anything not yet saved on this page can no longer be saved." I tapped Save on A
anyway: the contact was saved, A moved to its page, and A went on to list all 26 dogs
from the upgraded database with the old code. Dexie reopens at whatever version is
installed rather than refusing.
**Why it matters** Harmless while version blocks only add tables and indexes, which is the
rule. The first block that rewrites records meets old tabs still writing the old shape
after the rewrite ran, and the notice has told her that can't happen. Today's cost is
smaller: a breeder who believes the notice retypes something she could have saved.
**What I'd do** Make it true (after `versionchange`, that tab refuses writes until it is
reloaded), or say what is true: "Reload before you carry on."

## Notes, not findings

- **Where escaping rests on convention.** `chat.say(html)`, `chat.panel(html)`,
  `chat.form({ title, html })` and Kels's `{ title, html }` screens take markup by
  agreement ("trusted markup: callers esc() every user value", `kelsChat.js:79`). There
  are 783 such hand-overs and all are clean. The natural slip is a plain sentence with a
  name in it, `chat.say(\`Done, ${dog.call_name} is saved.\`)`: no tag, so no reviewer's
  eye and no line-based grep catches it. The scanner does, by name. A `sayText()` beside
  `say()` would remove the temptation.
- **`fmtDate` returns a non-date untouched** (`ui.js:59-64`), so it is not an escaper.
  Every use in markup is wrapped in `esc()` or goes through `reportView`'s `value`, except
  `websiteCard.js:84`, whose input this device wrote.
- **No Content-Security-Policy** on any page shell. GitHub Pages can't send the header,
  but a `<meta http-equiv>` with `script-src 'self'` would be a second fence behind
  `esc()`; the app has no inline scripts outside `companion-view.html` and `index.html`.
- **Layering** (invariant 1). No page imports `db.js` or touches `localStorage`. Two
  assets come close: `accountHealthUI.js:15` imports `requestPersistentStorage` from
  `db.js`, and `cloudSyncUI.js:442-452` keeps a scroll position in `sessionStorage`.
- **Dead code.** `pages/kennel.js:74` `row()` has no caller.
- **Accessibility basics that pass.** Every page has `lang`, a title, and one `<h1>`
  (`puppy-record` prints one per pup). All 57 tables have header cells. No image lacks
  `alt`; no button or link lacks a name. `app.css` never removes an outline, so the
  browser's focus ring shows everywhere. The app has no dark mode (`prefers-color-scheme`
  appears nowhere), so there is no second palette to check.
- **Offline.** With the service worker installed (451 entries, `kennelos-shell-v113`) and
  the network off: all 87 pages opened, none threw, none stayed on "Loading…", no request
  failed; the root URL and a URL with a query string work. A page that doesn't exist (an
  old bookmark, a renamed page) gets the browser's own error page, since there is no
  fallback. On `dist/lite`, "Turn on cloud backup" with no network said "No internet
  connection (or cloud backup is briefly down for maintenance). Try again shortly." in
  0.6 seconds and gave the button back. No page had to say it was offline: none asks the
  network for anything while signed out.
- **The newest screens at 320px.** Do not sell and Dog cards (send, and after making a
  card) fit, with no scanner flag and no layering break. The side-sale dialog fits (288px
  wide, taller than the screen, scrolls), and a double tap on **Record the sale** made one
  sale. Waitlist settings (the policies editor's home) fits. The helper bar fits and
  wraps; a long name makes it a 100px bar that stays at the top. The public list's
  program bubble stays on screen for the first and the last row (19 to 259px of 320) and
  opens below the icon; Escape doesn't close it (a tap elsewhere does). My stubbed list
  scrolled 31px sideways with a 42-character family name; I did not check how the server
  shortens names, so that is unconfirmed.
- **The waitlist entry page at 320px** (left to K15 by K6's "what I did not get to" and by
  the Waitlist Fixes Plan §7). All eight sample families, Details, Interact and History:
  24 views, none scrolls sideways. Every dialog a button on those tabs opens, 21 kinds:
  add a credit, leaving the list, add to do-not-sell, close application, approve, fee
  received, offer their turn, picked a pup, pick recorded, review sale & send, deposit
  received, change pup, passed, no response, no deposit, void, undo a pass, move their
  place, side sale, end the sale, communicate. Each is 288px wide with nothing sticking
  out and no sideways scroll; no page threw. Five are taller than a 568px screen and
  scroll: add a credit, offer their turn, the side sale and communicate end 22 to 180px
  below the first screen, and Review sale & send is 1,309px. Not reached, because the sample has no family in that state: restoring a lost
  pup, Change pup with another pup to switch to, the request dialogs (back out, pickup,
  extras), and a History tab with a dozen offers.
- **Hand-offs from other sessions.** K6 left "type a hostile value into a live form" to
  this session: the scanner and the 586-value sweep cover where a value is drawn; I
  stored the values rather than typing them, which exercises the same templates. K2
  noted tap targets on Import/Export (25 to 30px buttons) and Dog cards (13 × 13
  checkboxes) without filing them: the same bare 13 × 13 checkboxes are on the ten
  busiest pages (six of them), beside the two toggles in finding 5. K3 noted that a save
  after "Updated on another device" overwrites the pulled change; I didn't look at that
  (finding 11 is the storage-update notice, a different one).
- **The nav at 320px.** 52px tall on every page; the menu button is labelled, sets
  `aria-expanded`, and opens from the keyboard. Escape doesn't close it. Open, it is
  taller than a 568px screen and scrolls with the page.
- **Ask Kels** is a fixed 72 × 72 button. `main` has 104px of bottom padding, so nothing
  at the end of a page sits under it; mid-page it covers whatever scrolls beneath (Dogs'
  "All" tab on the first screen at 320px).
- **Dogs at 320px** opens on seven buttons and five tabs; the first dog is on the second
  screen.
- **Charts that pass.** The eight series colours pass the dataviz validator: lightness
  band, chroma, colour-blind separation (worst adjacent pair ΔE 9.1), normal-vision
  separation. Three are under 3:1 against white (`#1baf7a`, `#eda100`, `#e87ba4`), which
  the guidance allows when values are labelled or a table is present; both are. No
  renderer produced a broken coordinate for one point, one category, all zeros, all
  negatives, a text value, 60 categories at 320px or a 90-character label; empty data
  gives the empty-state sentence. Axes carry units where the number alone wouldn't
  (`$`, `lb`, "Age (days)", `%`, "days"). Past eight pups the growth chart draws the rest
  grey rather than reuse a colour (`puppy-growth-report.js:22`); `colorFor`
  (`chartView.js:44`) would cycle, but no caller sends it more than eight. Every chart
  has its table underneath.
- **Dialogs that can't be dismissed** (`data-no-dismiss`) are made in two places: the
  required kennel setup (`kennelSetupUI.js:54`) and cloud dialogs opened as not
  dismissible (`cloudBackupUI.js:157`). I didn't open them to check each has a way out.

## Coverage gaps I found (tests that should exist)

- **Nothing guards escaping.** The scanner could run as a check with its allow file,
  failing on a new open flag; it needs `--expose-internals` or acorn, so it may suit a
  release step better than `node --test`. Short of that, a test that every `cell:`
  function and every `chat.say(` argument is one of: a literal, `esc(…)`, or a call.
- **The schema hand-off has no test for a second page.** A unit test with Dexie's events
  faked: `blocked` never fires, the open doesn't settle, and the notice must still appear.
- **Dialogs.** `mountModal`'s markup can be tested as a string: a heading id and a
  matching `aria-labelledby`.
- **Charts at phone width.** `tests/chartView.test.js` renders at the default 640px; a
  case at 216px asserting no label starts left of 0.
- **A sideways-scroll check.** The 60-line probe used here (page `scrollWidth` against
  the viewport, with the elements that cause it) could live beside the build and run
  over `dist/pro` before a release.

## What I did not get to

- **Real devices and other browsers.** Everything here is headless Chromium. The two
  results that rest on browser behaviour, finding 1 (`blocked` fires once) and finding 10
  (`javascript:` doesn't run through `rel=noopener`), want a look in Safari on an iPhone.
  No screen reader was run; finding 2's and 4's claims are from the markup and the focus
  order.
- **`reportView.js`, `timeline.js`, `pedigree.js`, `nav.js` line by line.** They went
  through the scanner and the browser runs; I read only the lines those pointed at.
- **Dialogs at 320px beyond these.** I opened the confirm, the event form, the picks
  preview, the side sale and the waitlist entry page's 21. Dialogs on other pages (sale,
  litter, contract, kennel, the cloud screens) weren't opened on a phone. The Kels tasks
  were scanned, not driven.
- **Deeper states at 320px.** The phone sweeps saw each page's first screen, plus the
  waitlist entry's three tabs. Edit forms were audited for labels at desktop width only;
  the Kennel page's other 13 sections weren't opened on a phone.
- **Lite and Demo.** The sweeps ran on `/shared/` (Pro's surface). Lite's cap banners at
  phone width, and Demo's read-only strip, weren't looked at.
- **The policies editor in use.** Its section fits at 320px; I didn't add, edit or reorder
  a policy, or try it from the keyboard.
- **The helper bar in use.** Drawn with a faked session; hand-back and the one-time setup
  weren't driven.
- **Slow networks.** Only on and off; no throttled run for spinners.
- **The rest of §0a on the newest screens** (scope, editions, half-finished writes): those
  rules belong to K6b, K7 and K14; here they got layering, escaping, phone and the
  side-sale double submit.

## The scanner

Run it from the repo root. `k15-allow.json` holds the 160 sources judged by hand, each
with its reason; without it the scanner prints all 252 flags. A flag that isn't in the
allow file is new since this session. An allow entry that matches nothing is listed at
the end of a run (the code under it changed).

<details>
<summary><code>k15-escape-scan.cjs</code> (the scanner)</summary>

````js
#!/usr/bin/env node
// k15-escape-scan.cjs — the K15 escaping scanner (a review tool; not part of the app).
//
//   node --expose-internals k15-escape-scan.cjs [roots…] [--allow allow.json] [--list] [--json]
//
// Run from the repo root. Nothing to install: it uses the acorn parser that ships
// inside Node (hence --expose-internals); with `npm i acorn` the flag isn't needed.
// Default roots: shared/pages shared/assets shared/nav.js shared/app.js shared/assistant.js
// Other roots that work: cloud/public/family, or one .html file (its inline <script>s).
//   --list   every ${…} in every HTML template, with its context and verdict
//   --allow  a JSON map of flags already judged by hand: "<file>|<expr>" (one use),
//            "<file>|<expr>|<src file>|<src expr>" (one use from one source), or
//            "@<src file>|<src expr>" (every use that source reaches) → the reason
//   --json   the open flags as JSON, with those three keys ready to paste
//
// What it does. It parses every .js file under shared/ (vendor skipped), then in
// the root files treats as an HTML SINK:
//   - the right side of `x.innerHTML =` / `+=`, `x.outerHTML =`,
//   - the html argument of insertAdjacentHTML / document.write,
//   - every template literal whose text holds a tag (`<p`, `</td`), wherever it
//     goes (returned, pushed, passed to a modal or card builder),
//   - every string concatenation with a tag in one of its literals,
//   - the return value of every `cell:` function (listView's raw-HTML contract),
//   - HTML handed over by name where no assignment shows it: chat.say(html),
//     chat.panel(html), chat.form({ title, html }) and any object literal holding
//     both `title` and `html` (a Kels screen). See METHOD_SINKS / OBJECT_SINK_KEYS.
// For each sink it walks the expression back to where its values come from:
// through ?: || && +, .map().join(), local variables (init, later `=`/`+=`,
// `.push()`), arrays of objects built in the same function, calls to functions it
// can find (same file, imported, `this.method()` up the class chain: their return
// values, with each parameter traced to every caller's argument, and a function
// passed in as a parameter traced to the function each caller passes).
// A value is CLEARED when every source is one of
//   esc(...) · a number/boolean · a constant (a literal, or a table of literals
//   such as vocab.js) · a nested builder whose own sources clear.
// Anything else is a FLAG: a record field, an unresolved call, a parameter with
// no visible caller, location.*, JSON.stringify, an error message.
// It also reads the HTML around each ${…} in a template: an unquoted attribute,
// an on* handler, a <script>/<style> body, a bare spot inside a tag, and a URL
// attribute whose value starts the URL are flagged even when the value is escaped
// (esc() does not make those safe).
//
// Limits (read before trusting a clean run). It does not follow methods on
// objects other than `this` (`repo.get()`), dynamic imports, dynamic property
// names, or values stored on `this`/the DOM and read back: those come out as
// FLAGs, never as cleared. `.toLocaleString` and friends are assumed to be called
// on a number or a date. The HTML-context check reads template literals only,
// not `'<a href="' + x + '">'` concatenations. A new by-name hand-over (a second
// chat-like object) is invisible until it is added to METHOD_SINKS.
// Self-check: the fixture in the findings file (11 planted misses) must give 11 flags.
'use strict';
const fs = require('fs');
const path = require('path');
let acorn;
try { acorn = require('acorn'); } catch { acorn = require('internal/deps/acorn/acorn/dist/acorn'); }

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const opt = (f) => argv.includes(f);
const optVal = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const allowFile = optVal('--allow');
const rootArgs = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--allow');
const ROOTS = rootArgs.length ? rootArgs : ['shared/pages', 'shared/assets', 'shared/nav.js', 'shared/app.js', 'shared/assistant.js'];
const INDEX_DIRS = ['shared', ...ROOTS.filter((r) => !r.startsWith('shared'))];

// Names that escape. Every definition found is printed so a reader can check it.
const ESCAPERS = new Set(['esc', 'escapeHtml', 'escHtml', 'escAttr', 'htmlAttr']);
// Pass a value through untouched when it isn't what they expect; reported as their own class.
const PASSTHROUGH = new Set(['fmtDate']);
// HTML handed over through an object method or an object field, which the tracer cannot
// follow by itself, so it is told by name. Each entry: argument index, then an optional field.
//   chat.say(html) · chat.panel(html) · chat.form({ title, html })        (assets/kelsChat.js)
const METHOD_SINKS = { say: [[0]], panel: [[0]], form: [[0, 'title'], [0, 'html']] };
// An object literal holding ALL of these keys is a Kels screen ({ title, html, read… },
// assets/kelsSteps.js StepConversation): both values are written with innerHTML.
const OBJECT_SINK_KEYS = ['title', 'html'];
const ITER = new Set(['map', 'flatMap', 'forEach', 'filter', 'find', 'some', 'every', 'findIndex', 'findLast', 'sort', 'toSorted']);
const KEEP = new Set(['filter', 'slice', 'reverse', 'sort', 'toSorted', 'toReversed', 'trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase',
  'toString', 'substring', 'substr', 'at', 'charAt', 'normalize', 'repeat', 'flat', 'split', 'pop', 'shift', 'find', 'findLast', 'toLocaleUpperCase', 'toLocaleLowerCase']);
const KEEP_ARGS = new Set(['concat', 'padStart', 'padEnd']);
const SAFE_METHODS = new Set(['toFixed', 'toPrecision', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toISOString', 'toDateString',
  'getFullYear', 'getMonth', 'getDate', 'getTime', 'getDay', 'getHours', 'getMinutes', 'getSeconds', 'indexOf', 'lastIndexOf', 'findIndex', 'charCodeAt',
  'codePointAt', 'localeCompare', 'includes', 'startsWith', 'endsWith', 'some', 'every', 'has', 'test', 'format', 'now', 'isArray', 'isFinite', 'isInteger', 'isNaN',
  'getUTCFullYear', 'getUTCMonth', 'getUTCDate', 'getUTCDay', 'getUTCHours', 'getUTCMinutes', 'getTimezoneOffset', 'matches', 'contains', 'hasAttribute', 'search',
  'createObjectURL']);
const SAFE_GLOBAL_FNS = new Set(['Number', 'parseInt', 'parseFloat', 'Boolean', 'isNaN', 'isFinite', 'encodeURIComponent', 'encodeURI', 'BigInt']);
const SAFE_GLOBAL_OBJ = new Set(['Math', 'Number', 'Date', 'Intl', 'performance']);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'data', 'xlink:href', 'srcset', 'srcdoc']);
const SCOPES = new Set(['Program', 'BlockStatement', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'CatchClause', 'SwitchStatement', 'StaticBlock']);

// ---------------------------------------------------------------- loading
const mods = new Map();
const unparsed = [];
function walkFiles(p, out = []) {
  const st = fs.statSync(p);
  if (st.isFile()) { if (/\.(js|mjs|html)$/.test(p)) out.push(path.resolve(p)); return out; }   // .html only when named as a root
  for (const name of fs.readdirSync(p)) {
    if (name === 'vendor' || name === 'node_modules' || name.endsWith('.html')) continue;
    walkFiles(path.join(p, name), out);
  }
  return out;
}
function link(node, parent, mod) {
  node.parent = parent; node.mod = mod;
  if (node.type === 'CallExpression') mod.calls.push(node);
  else if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') mod.writes.push(node);
  for (const k in node) {
    if (k === 'parent' || k === 'mod' || k === 'loc' || k[0] === '_') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') link(c, node, mod); }
    else if (v && typeof v.type === 'string') link(v, node, mod);
  }
}
function load(file) {
  file = path.resolve(file);
  if (mods.has(file)) return mods.get(file);
  let mod = null;
  if (fs.existsSync(file) && !/[\\/]vendor[\\/]/.test(file)) {
    try {
      let src = fs.readFileSync(file, 'utf8');
      // An .html root: keep only its inline <script> bodies, blanking the rest so line numbers hold.
      if (file.endsWith('.html')) {
        let out = ''; let last = 0;
        const blank = (t) => t.replace(/[^\n]/g, ' ');
        for (const m of src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
          const start = m.index + m[0].indexOf('>') + 1;
          out += blank(src.slice(last, start)) + m[1] + ';';
          last = start + m[1].length + 1;
        }
        src = out + blank(src.slice(last));
      }
      let ast;
      try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true }); }
      catch (e) { if (!file.endsWith('.html')) throw e; ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true }); }
      mod = { file, rel: path.relative(ROOT, file), src, ast, calls: [], writes: [] };
      link(ast, null, mod);
    } catch (e) { unparsed.push(`${path.relative(ROOT, file)}: ${e.message}`); }
  }
  mods.set(file, mod);
  return mod;
}
const text = (n) => n.mod.src.slice(n.start, n.end);
const short = (n, max = 90) => { const t = text(n).replace(/\s+/g, ' '); return t.length > max ? t.slice(0, max - 1) + '…' : t; };
const where = (n) => `${n.mod.rel}:${n.loc.start.line}`;
const isFn = (n) => !!n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');

// ---------------------------------------------------------------- scopes
function patternNames(pat, out = [], pth = [], def = null) {
  if (!pat) return out;
  if (pat.type === 'Identifier') out.push({ name: pat.name, path: pth, def });
  else if (pat.type === 'AssignmentPattern') patternNames(pat.left, out, pth, pat.right);
  else if (pat.type === 'RestElement') patternNames(pat.argument, out, [...pth, '…'], null);
  else if (pat.type === 'ObjectPattern') {
    for (const p of pat.properties) {
      if (p.type === 'RestElement') patternNames(p.argument, out, [...pth, '…'], null);
      else patternNames(p.value, out, [...pth, p.computed ? '?' : (p.key.name ?? String(p.key.value))], null);
    }
  } else if (pat.type === 'ArrayPattern') pat.elements.forEach((e, i) => e && patternNames(e, out, [...pth, i], null));
  return out;
}
function declsOf(scope) {
  if (scope._decls) return scope._decls;
  const d = scope._decls = new Map();
  const add = (name, b) => { if (!d.has(name)) d.set(name, Object.assign(b, { name, scope })); };
  const addVar = (vd, extra = {}) => {
    for (const dec of vd.declarations) for (const p of patternNames(dec.id)) add(p.name, { kind: 'var', declarator: dec, path: p.path, def: p.def, isConst: vd.kind === 'const', ...extra });
  };
  const addStmt = (s) => {
    if (!s) return;
    if ((s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration') && s.declaration) s = s.declaration;
    if (s.type === 'VariableDeclaration') addVar(s);
    else if (s.type === 'FunctionDeclaration' && s.id) add(s.id.name, { kind: 'func', fn: s });
    else if (s.type === 'ClassDeclaration' && s.id) add(s.id.name, { kind: 'class', node: s });
    else if (s.type === 'ImportDeclaration') for (const sp of s.specifiers) add(sp.local.name, { kind: 'import', spec: sp, source: s.source.value });
  };
  if (isFn(scope)) {
    scope.params.forEach((p, i) => { for (const pn of patternNames(p)) add(pn.name, { kind: 'param', fn: scope, index: i, path: pn.path, def: pn.def, rest: p.type === 'RestElement' }); });
    if (scope.type === 'FunctionExpression' && scope.id) add(scope.id.name, { kind: 'func', fn: scope });
  } else if (scope.type === 'Program' || scope.type === 'BlockStatement' || scope.type === 'StaticBlock') scope.body.forEach(addStmt);
  else if (scope.type === 'ForStatement') { if (scope.init && scope.init.type === 'VariableDeclaration') addVar(scope.init); }
  else if (scope.type === 'ForOfStatement' || scope.type === 'ForInStatement') {
    if (scope.left.type === 'VariableDeclaration') {
      for (const dec of scope.left.declarations) for (const p of patternNames(dec.id)) add(p.name, { kind: scope.type === 'ForOfStatement' ? 'forof' : 'forin', loop: scope, path: p.path });
    }
  } else if (scope.type === 'CatchClause') { for (const p of patternNames(scope.param)) add(p.name, { kind: 'catch' }); }
  else if (scope.type === 'SwitchStatement') scope.cases.forEach((c) => c.consequent.forEach(addStmt));
  return d;
}
function resolveLocal(id) {
  for (let s = id.parent; s; s = s.parent) {
    if (isFn(s) || SCOPES.has(s.type)) { const b = declsOf(s).get(id.name); if (b) return b; }
  }
  return null;
}
function exportOf(mod, name, seen = new Set()) {
  if (!mod || seen.has(mod.file + '|' + name)) return null;
  seen.add(mod.file + '|' + name);
  for (const s of mod.ast.body) {
    if (s.type === 'ExportNamedDeclaration') {
      if (s.declaration) {
        const d = s.declaration;
        if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id && d.id.name === name) return declsOf(mod.ast).get(name);
        if (d.type === 'VariableDeclaration' && d.declarations.some((x) => patternNames(x.id).some((p) => p.name === name))) return declsOf(mod.ast).get(name);
      }
      for (const sp of s.specifiers || []) {
        if ((sp.exported.name ?? sp.exported.value) !== name) continue;
        if (s.source) return exportOf(load(path.resolve(path.dirname(mod.file), s.source.value)), sp.local.name ?? sp.local.value, seen);
        return follow(declsOf(mod.ast).get(sp.local.name));
      }
    } else if (s.type === 'ExportAllDeclaration' && s.source && !s.exported) {
      const r = exportOf(load(path.resolve(path.dirname(mod.file), s.source.value)), name, seen);
      if (r) return r;
    } else if (s.type === 'ExportDefaultDeclaration' && name === 'default') {
      const d = s.declaration;
      if (isFn(d)) return { kind: 'func', fn: d, name: 'default', scope: mod.ast };
      if (d.type === 'Identifier') return follow(declsOf(mod.ast).get(d.name));
    }
  }
  return null;
}
// An import binding → the declaration it names (null when it can't be found: vendor, namespace).
function follow(b) {
  let guard = 0;
  while (b && b.kind === 'import' && guard++ < 10) {
    if (b._target !== undefined) return b._target;
    const mod = b.scope.mod;
    const target = load(path.resolve(path.dirname(mod.file), b.source));
    const imported = b.spec.type === 'ImportSpecifier' ? (b.spec.imported.name ?? b.spec.imported.value) : b.spec.type === 'ImportDefaultSpecifier' ? 'default' : null;
    const t = imported && target ? exportOf(target, imported) : null;
    b._target = t || null;
    if (!t) return b.spec.type === 'ImportNamespaceSpecifier' && target ? { kind: 'namespace', target, name: b.name } : null;
    b = t;
  }
  return b;
}
const resolve = (id) => follow(resolveLocal(id));
function fnOf(b) {
  if (!b) return null;
  if (b.kind === 'func') return b.fn;
  if (b.kind === 'var' && !b.path.length && isFn(b.declarator.init)) return b.declarator.init;
  return null;
}
function writesTo(b) {
  if (b._writes) return b._writes;
  const mod = b.scope.mod;
  b._writes = mod.writes.filter((w) => w.left.name === b.name && resolveLocal(w.left) === b);
  b._pushes = mod.calls.filter((c) => c.callee.type === 'MemberExpression' && !c.callee.computed && (c.callee.property.name === 'push' || c.callee.property.name === 'unshift')
    && c.callee.object.type === 'Identifier' && c.callee.object.name === b.name && resolveLocal(c.callee.object) === b);
  return b._writes;
}
// `this.x(…)` → the method x of the class the call sits in, or of a class it extends
// (or of the object literal, for `{ say() {…}, form() { this.say() } }`).
function classMethod(cls, name, depth = 0) {
  if (!cls || depth > 6) return null;
  const m = cls.body.body.find((x) => x.type === 'MethodDefinition' && !x.computed && x.key.name === name && x.kind === 'method');
  if (m) return m.value;
  if (cls.superClass && cls.superClass.type === 'Identifier') { const b = resolve(cls.superClass); if (b && b.kind === 'class' && b.node) return classMethod(b.node, name, depth + 1); }
  return null;
}
function methodOfThis(call) {
  const c = call.callee;
  if (c.type !== 'MemberExpression' || c.computed || c.object.type !== 'ThisExpression') return null;
  for (let p = call.parent; p; p = p.parent) {
    if (p.type === 'ClassBody') return classMethod(p.parent, c.property.name);
    if (p.type === 'ObjectExpression' && p.properties.some((x) => x.type === 'Property' && x.method)) {
      const m = p.properties.find((x) => x.type === 'Property' && !x.computed && (x.key.name ?? x.key.value) === c.property.name && isFn(x.value));
      if (m) return m.value;
    }
  }
  return null;
}
function fnName(fn) {
  if (fn.id) return fn.id.name;
  const p = fn.parent;
  if (p && p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
  if (p && p.type === 'Property' && !p.computed) return p.key.name ?? String(p.key.value);
  if (p && p.type === 'MethodDefinition') return p.key.name;
  return '(anonymous)';
}

// ---------------------------------------------------------------- constants
// Is this expression developer-written constant data (never a record)?
const constBusy = new Set();
function isConst(n) {
  if (!n) return true;
  if (n._const !== undefined) return n._const;
  if (constBusy.has(n)) return true;
  constBusy.add(n);
  const r = isConst0(n);
  constBusy.delete(n);
  n._const = r;
  return r;
}
function isConst0(n) {
  switch (n.type) {
    case 'Literal': return true;
    case 'TemplateLiteral': return n.expressions.every(isConst);
    case 'UnaryExpression': case 'UpdateExpression': return true;
    case 'BinaryExpression': return n.operator !== '+' || (isConst(n.left) && isConst(n.right));
    case 'ConditionalExpression': return isConst(n.consequent) && isConst(n.alternate);
    case 'LogicalExpression': return n.operator === '&&' ? isConst(n.right) : isConst(n.left) && isConst(n.right);
    case 'ArrayExpression': return n.elements.every((e) => !e || isConst(e.type === 'SpreadElement' ? e.argument : e));
    case 'ObjectExpression': return n.properties.every((p) => p.type === 'SpreadElement' ? isConst(p.argument) : isConst(p.value));
    case 'ArrowFunctionExpression': case 'FunctionExpression': return true;   // a function printed is its source, not data
    case 'MemberExpression': return n.property.name === 'length' && !n.computed ? true : isConst(n.object);
    case 'ChainExpression': return isConst(n.expression);
    case 'Identifier': {
      if (n.name === 'undefined' || n.name === 'NaN' || n.name === 'Infinity') return true;
      const b = resolve(n);
      if (!b) return false;
      if (b.kind === 'var') {
        if (b.path.length) return isConst(b.declarator.init);
        const writes = writesTo(b).length;                                    // also fills b._pushes
        return (b.isConst || !writes) && !!b.declarator.init && isConst(b.declarator.init) && !b._pushes.length;
      }
      if (b.kind === 'forof') return isConst(b.loop.right);
      if (b.kind === 'param') {
        const cb = callbackOf(b.fn);
        if (cb && cb.iter && cb.argIdx === 0) return b.index === 1 || (b.index === 0 && isConst(cb.call.callee.object));
        return false;
      }
      return false;
    }
    case 'CallExpression': {
      const c = n.callee;
      if (c.type === 'MemberExpression' && !c.computed) {
        const m = c.property.name;
        if (c.object.type === 'Identifier' && c.object.name === 'Object' && !resolveLocal(c.object)) return ['entries', 'values', 'keys', 'freeze'].includes(m) && isConst(n.arguments[0]);
        if (KEEP.has(m) || m === 'entries' || m === 'keys' || m === 'values') return isConst(c.object);
        if (m === 'join') return isConst(c.object) && isConst(n.arguments[0]);
        if (c.object.type === 'Identifier' && SAFE_GLOBAL_OBJ.has(c.object.name) && !resolveLocal(c.object)) return true;
        if (['toFixed', 'toPrecision', 'getFullYear', 'getMonth', 'getDate', 'getTime', 'indexOf', 'includes', 'startsWith', 'endsWith', 'has', 'test'].includes(m)) return true;
      }
      if (c.type === 'Identifier' && !resolveLocal(c) && ['Number', 'parseInt', 'parseFloat', 'Boolean'].includes(c.name)) return true;
      return false;
    }
    default: return false;
  }
}
function callbackOf(fn) {
  const p = fn.parent;
  if (!p || p.type !== 'CallExpression' || !p.arguments.includes(fn)) return null;
  const c = p.callee;
  const m = c.type === 'MemberExpression' && !c.computed ? c.property.name : null;
  return { call: p, method: m, iter: !!m && ITER.has(m), argIdx: p.arguments.indexOf(fn) };
}

// ---------------------------------------------------------------- classification
// cls(node) → the list of sources that are NOT cleared ("leaks"). [] means cleared.
//   { kind:'raw'|'date', node, why }          a value that reaches HTML unescaped
//   { kind:'param', fn, index, path, node }   depends on a caller's argument
const memo = new Map();
const busy = new Set();
const raw = (node, why) => [{ kind: 'raw', node, why }];
function cls(n) {
  if (!n) return [];
  if (memo.has(n)) return memo.get(n);
  if (busy.has(n)) return [];
  busy.add(n);
  const r = cls0(n);
  busy.delete(n);
  memo.set(n, r);
  return r;
}
const arg = (a) => (a && a.type === 'SpreadElement' ? a.argument : a);
function cls0(n) {
  switch (n.type) {
    case 'Literal': return [];
    case 'TemplateLiteral': return n.expressions.flatMap(cls);
    case 'ConditionalExpression': return [...cls(n.consequent), ...cls(n.alternate)];
    case 'LogicalExpression': return n.operator === '&&' ? cls(n.right) : [...cls(n.left), ...cls(n.right)];
    case 'BinaryExpression': return n.operator === '+' ? [...cls(n.left), ...cls(n.right)] : [];
    case 'UnaryExpression': case 'UpdateExpression': return [];
    case 'SequenceExpression': return cls(n.expressions[n.expressions.length - 1]);
    case 'AssignmentExpression': return cls(n.right);
    case 'AwaitExpression': return cls(n.argument);
    case 'ChainExpression': return cls(n.expression);
    case 'ArrayExpression': return n.elements.flatMap((e) => (e ? cls(arg(e)) : []));
    case 'Identifier': return clsIdent(n);
    case 'MemberExpression': return clsMember(n);
    case 'CallExpression': return clsCall(n);
    case 'NewExpression': return n.callee.type === 'Identifier' && ['Date', 'Number'].includes(n.callee.name) ? [] : raw(n, 'new …');
    case 'ArrowFunctionExpression': case 'FunctionExpression': return [];
    default: return raw(n, n.type);
  }
}
function clsIdent(n) {
  if (n.name === 'undefined' || n.name === 'NaN' || n.name === 'Infinity') return [];
  if (isConst(n)) return [];
  const b = resolve(n);
  if (!b) return raw(n, resolveLocal(n) ? 'import not found' : 'global');
  switch (b.kind) {
    case 'func': case 'class': case 'namespace': return [];
    case 'catch': return raw(n, 'caught error');
    case 'forin': return raw(n, 'for-in key');
    case 'forof': return elementOf(b.loop.right, b.path, n);
    case 'param': return clsParam(b, n);
    case 'var': {
      if (b.path.length) return clsPath(b.declarator.init, b.path, n) || raw(n, 'destructured from data');
      const out = b.declarator.init ? [...cls(b.declarator.init)] : [];
      for (const w of writesTo(b)) out.push(...cls(w.right));
      for (const p of b._pushes) for (const a of p.arguments) out.push(...cls(arg(a)));
      // a for-of / for-in loop variable declared without `const` in the head is not handled; flagged by the member rule
      return out;
    }
    default: return raw(n, b.kind);
  }
}
function clsParam(b, ref) {
  const out = b.def ? [...cls(b.def)] : [];
  const cb = callbackOf(b.fn);
  if (cb) {
    if (cb.iter && cb.argIdx === 0) {
      if (b.index === 1 && !b.path.length) return out;                       // the index
      if (b.index === 0) return [...out, ...elementOf(cb.call.callee.object, b.path, ref)];
    }
    if (cb.method === 'from' && cb.argIdx === 1) {                           // Array.from(x, (el, i) => …)
      if (b.index === 1 && !b.path.length) return out;
      if (b.index === 0) return [...out, ...elementOf(cb.call.arguments[0], b.path, ref)];
    }
    return [...out, ...raw(ref, cb.method === 'then' ? 'async result' : `callback param (${cb.method || 'call'})`)];
  }
  out.push({ kind: 'param', fn: b.fn, index: b.index, path: b.path, node: ref, rest: b.rest });
  return out;
}
// One element (or a field of it) of an array-ish expression.
function elemPath(arr, pth, ref, depth = 0) {
  if (!arr || depth > 8) return null;
  const all = (list, f) => { const out = []; for (const x of list) { const r = f(x); if (!r) return null; out.push(...r); } return out; };
  switch (arr.type) {
    case 'ArrayExpression': return all(arr.elements.filter(Boolean), (e) => (e.type === 'SpreadElement' ? elemPath(e.argument, pth, ref, depth + 1) : clsPath(e, pth, ref)));
    case 'ConditionalExpression': return all([arr.consequent, arr.alternate], (x) => elemPath(x, pth, ref, depth + 1));
    case 'LogicalExpression': return all(arr.operator === '&&' ? [arr.right] : [arr.left, arr.right], (x) => elemPath(x, pth, ref, depth + 1));
    case 'AwaitExpression': return elemPath(arr.argument, pth, ref, depth + 1);
    case 'Identifier': {
      const b = resolve(arr);
      if (!b || b.kind !== 'var' || b.path.length || !b.declarator.init) return null;
      const srcs = [b.declarator.init, ...writesTo(b).map((w) => w.right)];
      const a = all(srcs, (x) => elemPath(x, pth, ref, depth + 1));
      if (!a) return null;
      const pushed = all(b._pushes.flatMap((c) => c.arguments), (e) => (e.type === 'SpreadElement' ? elemPath(e.argument, pth, ref, depth + 1) : clsPath(e, pth, ref)));
      return pushed ? [...a, ...pushed] : null;
    }
    case 'CallExpression': {
      const c = arr.callee;
      if (c.type === 'MemberExpression' && !c.computed) {
        const m = c.property.name;
        if ((m === 'map' || m === 'flatMap') && isFn(arr.arguments[0])) return all(returnsOf(arr.arguments[0]), (r) => (m === 'flatMap' ? elemPath(r, pth, ref, depth + 1) : clsPath(r, pth, ref)));
        if (KEEP.has(m)) return elemPath(c.object, pth, ref, depth + 1);
        if (m === 'concat') return all([c.object, ...arr.arguments], (x) => elemPath(x, pth, ref, depth + 1));
      }
      return null;
    }
    default: return null;
  }
}
function elementOf(arr, pth, ref) {
  if (isConst(arr)) return [];
  if (pth.length) return elemPath(arr, pth, ref) || raw(ref, 'record field');
  const inner = cls(arr);   // the element itself is used as HTML: fine when the array holds built HTML
  return inner.map((l) => (l.kind === 'raw' ? { ...l, use: ref } : l));
}
function clsMember(n) {
  const prop = n.computed ? (n.property.type === 'Literal' ? n.property.value : null) : n.property.name;
  if (prop === 'length' || prop === 'size') return [];
  if (isConst(n)) return [];
  if (prop !== null) {
    const r = clsPath(n.object, [prop], n); if (r) return r;
    const root = memberRoot(n);
    if (root) { const e = elemPath(root.arr, root.path, n); if (e) return e; }
  }
  return raw(n, 'record field');
}
// `r.a.b` where r is the element of `xs.map((r) => …)` / `for (const r of xs)` → { arr: xs, path: ['a','b'] }
function memberRoot(n) {
  const pth = [];
  let o = n;
  while (o.type === 'MemberExpression') {
    if (o.computed && o.property.type !== 'Literal') return null;
    pth.unshift(o.computed ? o.property.value : o.property.name);
    o = o.object;
  }
  if (o.type !== 'Identifier') return null;
  const b = resolve(o);
  if (!b) return null;
  if (b.kind === 'forof') return { arr: b.loop.right, path: [...b.path, ...pth] };
  if (b.kind === 'param') {
    const cb = callbackOf(b.fn);
    if (cb && cb.iter && cb.argIdx === 0 && b.index === 0) return { arr: cb.call.callee.object, path: [...b.path, ...pth] };
  }
  return null;
}
// The value at expr.path, when expr can be traced to an object literal (or a parameter).
function clsPath(expr, pth, ref, depth = 0) {
  if (!expr || depth > 12) return null;
  switch (expr.type) {
    case 'ObjectExpression': {
      let found = null; let spread = false;
      for (const p of expr.properties) {
        if (p.type === 'SpreadElement') { spread = true; continue; }
        const k = p.computed ? (p.key.type === 'Literal' ? String(p.key.value) : null) : (p.key.name ?? String(p.key.value));
        if (k === String(pth[0])) found = p;
      }
      if (found) return pth.length === 1 ? cls(found.value) : clsPath(found.value, pth.slice(1), ref, depth + 1);
      return spread ? null : [];
    }
    case 'ArrayExpression': {
      if (typeof pth[0] !== 'number' || expr.elements.some((e) => e && e.type === 'SpreadElement')) return null;
      const el = expr.elements[pth[0]];
      if (!el) return [];
      return pth.length === 1 ? cls(el) : clsPath(el, pth.slice(1), ref, depth + 1);
    }
    case 'Identifier': {
      const b = resolve(expr);
      if (!b) return null;
      if (b.kind === 'var' && !b.path.length && b.declarator.init && !writesTo(b).length) return clsPath(b.declarator.init, pth, ref, depth + 1);
      if (b.kind === 'param' && !callbackOf(b.fn) && !b.rest) return [{ kind: 'param', fn: b.fn, index: b.index, path: [...b.path, ...pth], node: ref }];
      return null;
    }
    case 'ConditionalExpression': {
      const a = clsPath(expr.consequent, pth, ref, depth + 1); const b = clsPath(expr.alternate, pth, ref, depth + 1);
      return a && b ? [...a, ...b] : null;
    }
    case 'LogicalExpression': {
      const b = clsPath(expr.right, pth, ref, depth + 1);
      if (expr.operator === '&&') return b;
      const a = clsPath(expr.left, pth, ref, depth + 1);
      return a && b ? [...a, ...b] : null;
    }
    case 'AwaitExpression': return clsPath(expr.argument, pth, ref, depth + 1);
    case 'MemberExpression': {
      if (expr.computed && expr.property.type !== 'Literal') return null;
      return clsPath(expr.object, [expr.computed ? expr.property.value : expr.property.name, ...pth], ref, depth + 1);
    }
    case 'CallExpression': {
      const fn = expr.callee.type === 'Identifier' ? fnOf(resolve(expr.callee)) : null;
      if (!fn) return null;
      const rets = returnsOf(fn);
      if (!rets.length) return null;
      const out = [];
      for (const r of rets) { const l = clsPath(r, pth, ref, depth + 1); if (!l) return null; out.push(...l); }
      return mapParams(out, expr, fn);
    }
    default: return null;
  }
}
function returnsOf(fn) {
  if (fn._rets) return fn._rets;
  const out = fn._rets = [];
  if (fn.body.type !== 'BlockStatement') { out.push(fn.body); return out; }
  (function visit(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n !== fn.body && isFn(n)) return;
    if (n.type === 'ReturnStatement') { if (n.argument) out.push(n.argument); return; }
    for (const k in n) {
      if (k === 'parent' || k === 'mod' || k === 'loc' || k[0] === '_') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v.type === 'string') visit(v);
    }
  })(fn.body);
  return out;
}
const fnLeaks = (fn) => returnsOf(fn).flatMap(cls);
// Turn "depends on fn's parameter" leaks into leaks about this call's arguments.
function mapParams(leaks, call, fn) {
  const out = [];
  for (const l of leaks) {
    if (l.kind !== 'param' || l.fn !== fn) { out.push(l); continue; }
    const args = call.arguments;
    const spreadBefore = args.slice(0, l.index + 1).some((a) => a.type === 'SpreadElement');
    if (l.rest || spreadBefore) { out.push({ kind: 'raw', node: call, why: 'spread/rest argument', use: l.use || l.node }); continue; }
    const a = args[l.index];
    if (!a) continue;                                                        // undefined → the default, already counted
    if (l.callOf) {                                                          // the argument is a function; its return value is the HTML
      const f = fnAt(a, l.path);
      if (f === undefined) continue;
      if (!f) { out.push({ kind: 'raw', node: a, why: `function ${l.path.join('.') || 'argument'} not found at this call`, use: l.use || l.node }); continue; }
      for (const g of fnLeaks(f)) out.push(g.kind === 'param' && g.fn === f ? { kind: 'raw', node: g.node, why: 'record field (in a callback handed to a builder)' } : g);
      continue;
    }
    const got = l.path.length ? clsPath(a, l.path, a) : cls(a);
    if (!got) { out.push({ kind: 'raw', node: a, why: `field .${l.path.join('.')} of an argument`, use: l.use || l.node }); continue; }
    for (const g of got) out.push({ ...g, use: l.use || l.node, node: g.kind === 'param' ? g.node : g.node });
  }
  return out;
}
// A binding that holds a function handed in by the caller → the "trace it at each call" leak.
function paramFn(b) {
  if (!b) return null;
  if (b.kind === 'param' && !callbackOf(b.fn) && !b.rest) return { kind: 'param', fn: b.fn, index: b.index, path: b.path, callOf: true, def: b.def };
  if (b.kind === 'var' && b.path.length && b.declarator.init && b.declarator.init.type === 'Identifier') {
    const pb = resolve(b.declarator.init);
    if (pb && pb.kind === 'param' && !callbackOf(pb.fn) && !pb.rest) return { kind: 'param', fn: pb.fn, index: pb.index, path: [...pb.path, ...b.path], callOf: true, def: b.def };
  }
  return null;
}
// The function at expr.path: a node, undefined when the field is absent, null when it can't be traced.
function fnAt(expr, pth, depth = 0) {
  if (!expr || depth > 8) return null;
  if (!pth.length) {
    if (isFn(expr)) return expr;
    if (expr.type === 'Identifier') { const b = resolve(expr); const f = fnOf(b); if (f) return f; if (b && b.kind === 'var' && !b.path.length && b.declarator.init) return fnAt(b.declarator.init, pth, depth + 1); }
    if (expr.type === 'Literal' || (expr.type === 'Identifier' && expr.name === 'undefined')) return undefined;
    return null;
  }
  if (expr.type === 'ObjectExpression') {
    let spread = false;
    for (const p of expr.properties) {
      if (p.type === 'SpreadElement') { spread = true; continue; }
      const k = p.computed ? null : (p.key.name ?? String(p.key.value));
      if (k === String(pth[0])) return fnAt(p.value, pth.slice(1), depth + 1);
    }
    return spread ? null : undefined;
  }
  if (expr.type === 'Identifier') { const b = resolve(expr); if (b && b.kind === 'var' && !b.path.length && b.declarator.init && !writesTo(b).length) return fnAt(b.declarator.init, pth, depth + 1); }
  return null;
}
function clsCall(n) {
  const c = n.callee;
  const A = (i) => (n.arguments[i] ? cls(arg(n.arguments[i])) : []);
  if (c.type === 'Identifier') {
    const local = resolveLocal(c);
    const b = follow(local);
    const declName = b ? b.name : c.name;
    if (ESCAPERS.has(declName) || ESCAPERS.has(c.name)) return [];
    if (!local) {
      if (SAFE_GLOBAL_FNS.has(c.name)) return [];
      if (c.name === 'String') return A(0);
      return raw(n, 'global call');
    }
    if (PASSTHROUGH.has(declName)) { const inner = A(0); return inner.length ? [{ kind: 'date', node: n, why: `${declName}() returns a non-date untouched` }] : []; }
    const fn = fnOf(b);
    if (fn) return mapParams(fnLeaks(fn), n, fn);
    const pf = paramFn(b);
    if (pf) return [...(pf.def && isFn(pf.def) ? fnLeaks(pf.def) : []), { ...pf, node: n }];
    return raw(n, 'unresolved call');
  }
  if (c.type === 'MemberExpression') {
    const m = c.computed ? null : c.property.name;
    const o = c.object;
    if (o.type === 'Identifier' && !resolveLocal(o)) {
      if (SAFE_GLOBAL_OBJ.has(o.name)) return [];
      if (o.name === 'JSON') return raw(n, 'JSON.' + m);
      if (o.name === 'Object' && ['entries', 'values', 'keys'].includes(m)) return isConst(n) ? [] : raw(n, 'Object.' + m + ' of data');
      if (o.name === 'String' && m === 'fromCharCode') return [];
    }
    if (o.type === 'Identifier') {                                            // ns.esc(), ns.builder()
      const b = resolve(o);
      if (b && b.kind === 'namespace' && m) {
        const t = exportOf(b.target, m);
        if (ESCAPERS.has(m)) return [];
        const fn = fnOf(t);
        if (fn) return mapParams(fnLeaks(fn), n, fn);
      }
    }
    if (o.type === 'ThisExpression') { const fn = methodOfThis(n); if (fn) return mapParams(fnLeaks(fn), n, fn); }
    if (o.type === 'Identifier' && o.name === 'Promise' && !resolveLocal(o) && (m === 'all' || m === 'resolve')) return A(0);
    if (m === 'join') return [...cls(o), ...A(0)];
    if (m === 'map' || m === 'flatMap') {
      const f = n.arguments[0];
      if (!f) return cls(o);
      if (isFn(f)) return fnLeaks(f);
      if (f.type === 'Identifier') {
        const fb = resolve(f);
        if (ESCAPERS.has(fb ? fb.name : f.name)) return [];
        const fn = fnOf(fb);
        const pf = paramFn(fb);
        if (pf) return [{ ...pf, node: n }];
        if (fn) {
          return fnLeaks(fn).flatMap((l) => {
            if (l.kind !== 'param' || l.fn !== fn) return [l];
            if (l.index === 1) return [];
            if (l.index === 0) return elementOf(o, l.path, l.node).map((x) => ({ ...x, use: l.use || l.node }));
            return raw(n, 'map callback arg');
          });
        }
      }
      return raw(n, 'map with an unresolved callback');
    }
    if (m === 'replace' || m === 'replaceAll') {
      const r = n.arguments[1];
      return [...cls(o), ...(r && isFn(r) ? fnLeaks(r) : A(1))];
    }
    if (m && KEEP.has(m)) return cls(o);
    if (m && KEEP_ARGS.has(m)) return [...cls(o), ...n.arguments.flatMap((a) => cls(arg(a)))];
    if (m && SAFE_METHODS.has(m)) return [];
    if (o.type === 'Identifier' && m) {                                       // opts.note(x) where opts is a parameter
      const b = resolve(o);
      if (b && b.kind === 'param' && !callbackOf(b.fn) && !b.rest) return [{ kind: 'param', fn: b.fn, index: b.index, path: [...b.path, m], node: n, callOf: true }];
    }
    return raw(n, 'method call');
  }
  if (isFn(c)) return mapParams(fnLeaks(c), n, c);                            // IIFE
  return raw(n, 'call');
}

// ---------------------------------------------------------------- HTML context of a ${…}
function ctxPrefix(tpl, uptoExpr) {
  let pre = '';
  for (let p = tpl.parent, child = tpl; p; child = p, p = p.parent) {      // a template nested in another's ${…}
    if (isFn(p) || p.type === 'CallExpression' || p.type === 'Property') break;
    if (p.type === 'TemplateLiteral') { pre = ctxPrefix(p, p.expressions.indexOf(child)); break; }
  }
  for (let i = 0; i <= uptoExpr; i++) pre += (tpl.quasis[i].value.cooked ?? tpl.quasis[i].value.raw) + (i < uptoExpr ? '\u0001' : '');
  return pre;
}
function htmlCtx(pre) {
  const lower = pre.toLowerCase();
  for (const t of ['script', 'style']) {
    const o = lower.lastIndexOf('<' + t); const c = lower.lastIndexOf('</' + t);
    if (o > c && lower.indexOf('>', o) !== -1) return { where: t };
  }
  const lt = pre.lastIndexOf('<'); const gt = pre.lastIndexOf('>');
  if (lt <= gt || !/^<[a-zA-Z]/.test(pre.slice(lt))) return { where: 'text' };
  const tag = pre.slice(lt);
  let i = tag.search(/[\s/]/);
  if (i < 0) return { where: 'tagname' };
  while (i < tag.length) {
    while (i < tag.length && /[\s/]/.test(tag[i])) i++;
    if (i >= tag.length) return { where: 'tag' };
    let j = i;
    while (j < tag.length && !/[\s=]/.test(tag[j])) j++;
    const attr = tag.slice(i, j).toLowerCase();
    if (j >= tag.length) return { where: 'tag' };                            // still inside an attribute NAME
    let k = j;
    while (k < tag.length && /\s/.test(tag[k])) k++;
    if (tag[k] !== '=') { i = k; continue; }
    k++;
    while (k < tag.length && /\s/.test(tag[k])) k++;
    if (k >= tag.length) return { where: 'attr', attr, quote: '', before: '' };
    const q = tag[k];
    if (q === '"' || q === "'") {
      const end = tag.indexOf(q, k + 1);
      if (end < 0) return { where: 'attr', attr, quote: q, before: tag.slice(k + 1) };
      i = end + 1;
    } else {
      let e = k;
      while (e < tag.length && !/\s/.test(tag[e])) e++;
      if (e >= tag.length) return { where: 'attr', attr, quote: '', before: tag.slice(k) };
      i = e;
    }
  }
  return { where: 'tag' };
}
// In a tag but outside a value (`<input ${x}>`): fine when x is itself markup written here
// (a literal or a template supplying whole attributes), not a value.
function tagSafe(n, depth = 0) {
  if (!n || depth > 8) return false;
  if (n.type === 'Literal' || n.type === 'TemplateLiteral' || isConst(n)) return true;
  if (n.type === 'ConditionalExpression') return tagSafe(n.consequent, depth + 1) && tagSafe(n.alternate, depth + 1);
  if (n.type === 'LogicalExpression') return (n.operator === '&&' || tagSafe(n.left, depth + 1)) && tagSafe(n.right, depth + 1);
  if (n.type === 'Identifier') {
    const b = resolve(n);
    if (b && b.kind === 'var' && !b.path.length) return [b.declarator.init, ...writesTo(b).map((w) => w.right)].every((x) => !x || tagSafe(x, depth + 1));
    if (b && b.kind === 'param' && b.def) return 'param';
  }
  if (n.type === 'CallExpression' && n.callee.type === 'Identifier') { const fn = fnOf(resolve(n.callee)); if (fn) return returnsOf(fn).every((r) => tagSafe(r, depth + 1)); }
  return false;
}
// Does the string this expression makes begin with text written in the code (so the
// value cannot choose the URL's scheme)?
function startsFixed(n, depth = 0) {
  if (!n || depth > 8) return false;
  switch (n.type) {
    case 'Literal': return typeof n.value === 'string' ? n.value.length > 0 : true;
    case 'TemplateLiteral': return n.quasis[0].value.raw.length > 0 || (n.expressions.length > 0 && startsFixed(n.expressions[0], depth + 1));
    case 'BinaryExpression': return n.operator !== '+' || startsFixed(n.left, depth + 1);
    case 'ConditionalExpression': return startsFixed(n.consequent, depth + 1) && startsFixed(n.alternate, depth + 1);
    case 'LogicalExpression': return (n.operator === '&&' || startsFixed(n.left, depth + 1)) && startsFixed(n.right, depth + 1);
    case 'AwaitExpression': return startsFixed(n.argument, depth + 1);
    case 'Identifier': {
      if (isConst(n)) return true;
      const b = resolve(n);
      if (b && b.kind === 'var' && !b.path.length && b.declarator.init) return [b.declarator.init, ...writesTo(b).map((w) => w.right)].every((x) => startsFixed(x, depth + 1));
      return false;
    }
    case 'CallExpression': {
      const c = n.callee;
      if (c.type === 'Identifier') {
        if (ESCAPERS.has(c.name) || c.name === 'String') return startsFixed(n.arguments[0], depth + 1);
        if (c.name === 'encodeURIComponent') return true;                    // ':' is encoded, so no scheme
        const fn = fnOf(resolve(c));
        if (fn) return returnsOf(fn).length > 0 && returnsOf(fn).every((r) => startsFixed(r, depth + 1));
      }
      if (c.type === 'MemberExpression' && !c.computed && c.property.name === 'createObjectURL') return true;   // blob:
      return isConst(n);
    }
    default: return isConst(n);
  }
}
function contextFlag(expr, ctx) {
  if (isConst(expr)) return null;
  if (ctx.where === 'script' || ctx.where === 'style') return `inside <${ctx.where}>`;
  if (ctx.where === 'tagname') return 'in a tag name';
  if (ctx.where === 'tag') { const t = tagSafe(expr); return t === true ? null : t === 'param' ? 'attributes passed in by the caller (check each call)' : 'in a tag, outside any attribute value'; }
  if (ctx.where === 'attr') {
    if (ctx.quote === '') return `unquoted attribute ${ctx.attr}=`;
    if (ctx.attr.startsWith('on')) return `inside the ${ctx.attr} handler`;
    if (URL_ATTRS.has(ctx.attr) && ctx.before.replace(/\u0001/g, '') === '' && !startsFixed(expr)) return `starts the ${ctx.attr} URL (the value chooses the scheme)`;
  }
  return null;
}

// ---------------------------------------------------------------- run
const hasTag = (s) => /<\/?[a-zA-Z!]/.test(s);
for (const d of INDEX_DIRS) if (fs.existsSync(d)) walkFiles(d).forEach(load);
const rootFiles = new Set(ROOTS.flatMap((r) => (fs.existsSync(r) ? walkFiles(r) : [])));
rootFiles.forEach(load);

const callsByFn = new Map();          // fn node → [{ call, mode }]
function indexCalls() {
  callsByFn.clear();
  for (const mod of mods.values()) {
    if (!mod) continue;
    for (const c of mod.calls) {
      let fn = null;
      if (c.callee.type === 'Identifier') fn = fnOf(resolve(c.callee));
      else if (c.callee.type === 'MemberExpression' && !c.callee.computed && c.callee.object.type === 'Identifier') {
        const b = resolve(c.callee.object);
        if (b && b.kind === 'namespace') fn = fnOf(exportOf(b.target, c.callee.property.name));
      }
      if (!fn) fn = methodOfThis(c);
      if (fn) { if (!callsByFn.has(fn)) callsByFn.set(fn, []); callsByFn.get(fn).push({ call: c, mode: 'call' }); }
      const m = c.callee.type === 'MemberExpression' && !c.callee.computed ? c.callee.property.name : null;
      if (m && ITER.has(m) && c.arguments[0] && c.arguments[0].type === 'Identifier') {
        const f = fnOf(resolve(c.arguments[0]));
        if (f) { if (!callsByFn.has(f)) callsByFn.set(f, []); callsByFn.get(f).push({ call: c, mode: 'iter' }); }
      }
    }
  }
}

const flags = new Map();              // key → flag
const census = { templates: 0, multiline: 0, exprs: 0, verdicts: {}, sinks: 0, cells: 0, named: 0 };
const listing = [];
const escDefs = [];
function addFlag(leak, sinkNode, sinkKind) {
  const use = leak.use || leak.node;
  const key = `${where(use)}:${use.start}|${where(leak.node)}:${leak.node.start}|${leak.kind}`;
  if (flags.has(key)) return;
  flags.set(key, { kind: leak.kind, why: leak.why, use, src: leak.node, sinkNode, sinkKind });
}
const seenParams = new Set();
const work = [];
function handle(leaks, sinkNode, sinkKind) {
  for (const l of leaks) {
    if (l.kind === 'param') {
      const key = `${where(l.fn)}:${l.fn.start}#${l.index}.${l.path.join('.')}@${l.node.start}`;
      if (!seenParams.has(key)) { seenParams.add(key); work.push({ l, sinkNode, sinkKind }); }
    } else addFlag(l, sinkNode, sinkKind);
  }
}
function verdict(e, leaks) {
  if (leaks.some((l) => l.kind !== 'param')) return 'FLAG';
  if (leaks.length) return 'caller-supplied (traced)';
  let n = e;
  if (n.type === 'ChainExpression') n = n.expression;
  if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && ESCAPERS.has(n.callee.name)) return 'esc';
  if (isConst(n)) return n.type === 'Literal' && typeof n.value === 'number' ? 'number' : 'constant';
  if (n.type === 'TemplateLiteral') return 'nested template';
  if (n.type === 'ConditionalExpression' || n.type === 'LogicalExpression') return 'conditional of cleared parts';
  if (n.type === 'BinaryExpression' || n.type === 'UnaryExpression' || n.type === 'UpdateExpression') return 'number';
  if (n.type === 'MemberExpression' && !n.computed && (n.property.name === 'length' || n.property.name === 'size')) return 'number';
  if (n.type === 'CallExpression') {
    const c = n.callee;
    if (c.type === 'MemberExpression' && !c.computed) {
      const m = c.property.name;
      if (m === 'join' || m === 'map') return 'nested builder (.map/.join)';
      if (SAFE_METHODS.has(m) || (c.object.type === 'Identifier' && SAFE_GLOBAL_OBJ.has(c.object.name))) return 'number';
      return 'nested builder (' + m + ')';
    }
    if (c.type === 'Identifier') {
      if (SAFE_GLOBAL_FNS.has(c.name)) return c.name.startsWith('encodeURI') ? 'encodeURIComponent' : 'number';
      return 'nested builder (function)';
    }
  }
  if (n.type === 'Identifier') return 'variable traced to cleared sources';
  if (n.type === 'MemberExpression') return 'field traced to cleared sources';
  return 'other cleared';
}
function censusTemplate(tpl, kind) {
  const multi = tpl.loc.start.line !== tpl.loc.end.line;
  census.templates++; if (multi) census.multiline++;
  tpl.expressions.forEach((e, i) => {
    const leaks = cls(e);
    const v = verdict(e, leaks);
    const ctx = htmlCtx(ctxPrefix(tpl, i));
    const cf = contextFlag(e, ctx);
    census.exprs++;
    census.verdicts[v] = (census.verdicts[v] || 0) + 1;
    if (cf) addFlag({ kind: 'context', node: e, why: cf }, tpl, kind);
    listing.push({ at: where(e), multi, v, ctx: ctx.where === 'attr' ? `attr ${ctx.attr}=${ctx.quote || '(unquoted)'}` : ctx.where, expr: short(e, 70) });
  });
}
function visit(n, f) {
  if (!n || typeof n.type !== 'string') return;
  f(n);
  for (const k in n) {
    if (k === 'parent' || k === 'mod' || k === 'loc' || k[0] === '_') continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach((c) => visit(c, f)); else if (v && typeof v.type === 'string') visit(v, f);
  }
}
const isSinkProp = (m) => m.type === 'MemberExpression' && !m.computed && (m.property.name === 'innerHTML' || m.property.name === 'outerHTML');
for (const mod of mods.values()) {
  if (!mod) continue;
  visit(mod.ast, (n) => {
    if ((n.type === 'FunctionDeclaration' && n.id && ESCAPERS.has(n.id.name)) || (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && ESCAPERS.has(n.id.name) && isFn(n.init))) {
      escDefs.push(`${where(n)}  ${short(n, 150)}`);
    }
  });
  if (!rootFiles.has(mod.file)) continue;
  visit(mod.ast, (n) => {
    if (n.type === 'AssignmentExpression' && isSinkProp(n.left)) { census.sinks++; handle(cls(n.right), n, n.left.property.name); }
    else if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed) {
      const m = n.callee.property.name;
      if (m === 'insertAdjacentHTML' && n.arguments[1]) { census.sinks++; handle(cls(n.arguments[1]), n, m); }
      else if ((m === 'write' || m === 'writeln') && /document|doc$/.test(text(n.callee.object))) { census.sinks++; n.arguments.forEach((a) => handle(cls(arg(a)), n, 'document.write')); }
      else if (Object.hasOwn(METHOD_SINKS, m) && !(n.callee.object.type === 'Identifier' && fnOf(resolve(n.callee.object)))) {
        for (const [idx, key] of METHOD_SINKS[m]) {
          const a = n.arguments[idx];
          if (!a || a.type === 'SpreadElement') continue;
          census.named++;
          const got = key ? clsPath(a, [key], a) : cls(a);
          handle(got || raw(a, `.${m}() argument field ${key} not traceable`), n, `.${m}()`);
        }
      }
    } else if (n.type === 'TemplateLiteral' && n.parent.type !== 'TaggedTemplateExpression') {
      const quasi = n.quasis.map((q) => q.value.raw).join('');
      const direct = (n.parent.type === 'AssignmentExpression' && isSinkProp(n.parent.left));
      if (hasTag(quasi) || direct) { censusTemplate(n, 'html template'); handle(cls(n), n, 'html template'); }
    } else if (n.type === 'BinaryExpression' && n.operator === '+' && !(n.parent.type === 'BinaryExpression' && n.parent.operator === '+')) {
      let tagged = false;
      (function parts(x) { if (x.type === 'BinaryExpression' && x.operator === '+') { parts(x.left); parts(x.right); } else if (x.type === 'Literal' && typeof x.value === 'string' && hasTag(x.value)) tagged = true; })(n);
      if (tagged) { census.sinks++; handle(cls(n), n, 'html concatenation'); }
    } else if (n.type === 'ObjectExpression' && OBJECT_SINK_KEYS.every((k) => n.properties.some((p) => p.type === 'Property' && !p.computed && p.key.name === k))) {
      for (const p of n.properties) if (p.type === 'Property' && !p.computed && OBJECT_SINK_KEYS.includes(p.key.name)) { census.named++; handle(cls(p.value), p, `{ ${p.key.name}: } of a Kels screen`); }
    } else if (n.type === 'Property' && !n.computed && (n.key.name === 'cell') && isFn(n.value)) {
      census.cells++;
      for (const l of fnLeaks(n.value)) {
        if (l.kind === 'param' && l.fn === n.value) addFlag({ kind: 'raw', node: l.node, why: 'listView cell: record field' }, n, 'cell');
        else handle([l], n, 'cell');
      }
    }
  });
}
// Parameters that reach a sink: follow them to every call site, until nothing new turns up.
indexCalls();
let rounds = 0;
while (work.length && rounds++ < 200000) {
  const { l, sinkNode, sinkKind } = work.pop();
  const sites = callsByFn.get(l.fn) || [];
  if (!sites.length) {
    const cbProp = l.fn.parent && (l.fn.parent.type === 'Property' || l.fn.parent.type === 'MethodDefinition');
    addFlag({ kind: 'raw', node: l.node, why: `parameter of ${fnName(l.fn)}() — ${cbProp ? 'an object method' : 'no caller found in the scanned files'}` }, sinkNode, sinkKind);
    continue;
  }
  for (const s of sites) {
    if (s.mode === 'iter') {
      if (l.index === 1) continue;
      const got = l.index === 0 ? elementOf(s.call.callee.object, l.path, l.node) : raw(s.call, 'iterator callback arg');
      handle(got.map((g) => ({ ...g, use: l.use || l.node })), sinkNode, sinkKind);
    } else handle(mapParams([l], s.call, l.fn), sinkNode, sinkKind);
  }
}

// ---------------------------------------------------------------- report
const allow = allowFile ? JSON.parse(fs.readFileSync(allowFile, 'utf8')) : {};
const usedAllow = new Set();
const lineText = (n) => n.mod.src.split('\n')[n.loc.start.line - 1].trim();
const rows = [...flags.values()].map((f) => {
  const key = `${f.use.mod.rel}|${short(f.use, 200)}`;
  const srcKey = `${f.use.mod.rel}|${short(f.use, 200)}|${f.src.mod.rel}|${short(f.src, 200)}`;
  const fromKey = `@${f.src.mod.rel}|${short(f.src, 200)}`;                    // clears every use this source reaches
  const hit = [srcKey, key, fromKey].find((k) => allow[k] !== undefined);
  if (hit) usedAllow.add(hit);
  return { ...f, key, srcKey, fromKey, reason: hit ? allow[hit] : null };
}).sort((a, b) => (a.use.mod.rel + String(a.use.start).padStart(8, '0')).localeCompare(b.use.mod.rel + String(b.use.start).padStart(8, '0')));
const open = rows.filter((r) => r.reason === null);

if (opt('--json')) {
  console.log(JSON.stringify(open.map((r) => ({ key: r.key, srcKey: r.srcKey, fromKey: r.fromKey, kind: r.kind, why: r.why, at: where(r.use), expr: short(r.use, 200), src: r.src !== r.use ? `${where(r.src)} ${short(r.src, 120)}` : null, sink: `${r.sinkKind} @ ${where(r.sinkNode)}`, line: lineText(r.use).slice(0, 220) })), null, 1));
} else {
  if (opt('--list')) for (const l of listing) console.log(`${l.at}\t${l.multi ? 'multi' : 'single'}\t${l.ctx}\t${l.v}\t${l.expr}`);
  console.log(`\nEscapers found (check each one really escapes & < > " '):`);
  escDefs.forEach((d) => console.log('  ' + d));
  console.log(`\nFiles parsed: ${[...mods.values()].filter(Boolean).length} (${rootFiles.size} roots)${unparsed.length ? `; could not parse: ${unparsed.join('; ')}` : ''}`);
  console.log(`HTML template literals in the roots: ${census.templates} (${census.multiline} multi-line); other sinks: ${census.sinks} innerHTML/insertAdjacentHTML/concatenations, ${census.cells} listView cell functions, ${census.named} by-name hand-overs (chat.say/panel/form, Kels screens)`);
  console.log(`\${…} expressions in those templates: ${census.exprs}`);
  for (const [k, v] of Object.entries(census.verdicts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
  const byKind = {};
  for (const r of open) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  console.log(`\nFlags: ${rows.length} distinct source→use pairs; ${rows.length - open.length} cleared by the allow file; ${open.length} open ${JSON.stringify(byKind)}\n`);
  for (const r of open) {
    console.log(`${where(r.use)}  [${r.kind}: ${r.why}]  \${${short(r.use, 80)}}`);
    if (r.src !== r.use) console.log(`      ← ${where(r.src)}  ${short(r.src, 100)}`);
    console.log(`      ${lineText(r.use).slice(0, 160)}`);
  }
  const stale = Object.keys(allow).filter((k) => !usedAllow.has(k));
  if (stale.length) console.log(`\nAllow entries that matched nothing (code changed?): ${stale.length}\n  ` + stale.slice(0, 40).join('\n  '));
}
````

</details>

<details>
<summary><code>fixture/bad.js</code> (11 planted misses; run the scanner with the fixture's folder as its root and it must print 11 flags)</summary>

````js
// Save as <scratch>/fixture/bad.js with the two imports pointing at shared/assets, then:
//   node --expose-internals k15-escape-scan.cjs <scratch>/fixture
import { esc, cardShell, confirmModal, fmtDate } from '../../shared/assets/ui.js';
import { createListView } from '../../shared/assets/listView.js';
const KIND = [{ value: 'a', label: 'A' }];
function rowHtml(d) { return `<tr><td>${d.name}</td><td>${esc(d.note)}</td></tr>`; }           // 1 miss: d.name
function wrap(title, body) { return `<section><h2>${title}</h2>${body}</section>`; }
export async function draw(el, dogs, kennel, chat) {
  el.innerHTML = `
    <h1>${esc(kennel.kennel_name)}</h1>
    <p class=${esc(kennel.tone)}>unquoted attr</p>                                              
    <a href="${esc(kennel.website)}">site</a>                                                   
    <a href="dog.html?id=${encodeURIComponent(kennel.id)}">ok link</a>
    <select>${KIND.map((k) => `<option value="${k.value}">${k.label}</option>`).join('')}</select>
    <table>${dogs.map(rowHtml).join('')}</table>
    ${wrap(esc(kennel.kennel_name), `<p>${dogs.length} dogs</p>`)}
    ${wrap(kennel.kennel_name, '<p>fine</p>')}                                                  
    <span>${fmtDate(kennel.founded)}</span>                                                     
    <button onclick="go('${esc(kennel.id)}')">x</button>`;                                      
  let html = '';
  for (const d of dogs) html += '<li>' + d.call_name + '</li>';                                 // miss via concat
  el.insertAdjacentHTML('beforeend', html);
  const parts = [];
  parts.push(`<b>${esc(kennel.kennel_name)}</b>`);
  parts.push(kennel.motto);                                                                     // miss via push
  el.querySelector('p').innerHTML = parts.join('');
  await chat.say(`Saved ${kennel.kennel_name}.`);                                               // miss: no tag, by-name sink
  await chat.form({ title: `About ${esc(kennel.kennel_name)}`, html: cardShell(kennel.kennel_name, '') });  // miss: cardShell title is raw HTML
  await confirmModal({ title: `Delete ${kennel.kennel_name}?`, message: kennel.motto });        // fine: confirmModal escapes
  createListView({ mount: el, columns: [
    { header: 'Name', cell: (d) => d.name },                                                    // miss: cell
    { header: 'Note', cell: (d) => esc(d.note) },
    { header: 'Link', cell: (d) => `<a href="dog.html?id=${encodeURIComponent(d.id)}">${esc(d.name)}</a>` }
  ], load: async () => dogs });
}
````

</details>

<details>
<summary><code>k15-allow.json</code> (every flag judged by hand, by source, with the reason)</summary>

````json
{
 "@shared/assets/accountHealthUI.js|lead": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/chartView.js|s": "chart specs are built by the report pages from code: colours are SERIES_COLORS or a literal, height a literal (read every charts: block)",
 "@shared/assets/chartView.js|series[p.si]": "chart specs are built by the report pages from code: colours are SERIES_COLORS or a literal, height a literal (read every charts: block)",
 "@shared/assets/chartView.js|spec.height": "chart specs are built by the report pages from code: colours are SERIES_COLORS or a literal, height a literal (read every charts: block)",
 "@shared/assets/chartView.js|spec.color": "chart specs are built by the report pages from code: colours are SERIES_COLORS or a literal, height a literal (read every charts: block)",
 "@shared/assets/chartView.js|fn(spec, width)": "chart specs are built by the report pages from code: colours are SERIES_COLORS or a literal, height a literal (read every charts: block)",
 "@shared/assets/cloudBackupUI.js|v": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/cloudBackupUI.js|stripBtn[0]": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/cloudSyncUI.js|v": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/documentModal.js|objUrl": "a blob: URL the browser made, or a file bundled with the app",
 "@shared/assets/dogCheckinUI.js|p.avgDays": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/editionLinks.js|ui.handoffCodeHtml(code)": "escaped where it is built (read the helper)",
 "@shared/assets/eventForm.js|f": "a key or id the code makes itself (crypto.randomUUID, a draft row key, event-<server seq>), never typed or received",
 "@shared/assets/guidedFormUI.js|x.id": "NOTE (finding 1b): an id interpolated without esc(); a UUID in practice",
 "@shared/assets/guidedLitterUI.js|r.word": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/assets/guidedLitterUI.js|r.possessive": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/assets/guidedLitterUI.js|r.pronoun": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/assets/guidedLitterUI.js|G.recordedPupCount(draft)": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/guidedLitterUI.js|i": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/guidedLitterUI.js|esc(litterHref)": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/assets/guidedPeopleUI.js|p.key": "a key or id the code makes itself (crypto.randomUUID, a draft row key, event-<server seq>), never typed or received",
 "@shared/assets/guidedPeopleUI.js|i": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/guidedPeopleUI.js|places.get(x.entry.id)": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/guidedShareUI.js|esc(h.mailto)": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/assets/guidedShareUI.js|esc(h.sms)": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/assets/healthTestsUI.js|dogs.reduce((n, d) => n + unloggedPlanned(d, tests, testMatchTokensOf).length, 0)": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/importView.js|esc(listHref)": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/assets/importView.js|r": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/importView.js|r.index": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/importView.js|r.status": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/assets/importView.js|f.index": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/kelsChat.js|new URL(`../${KELS.photo}`, import.meta.url).href": "a blob: URL the browser made, or a file bundled with the app",
 "@shared/assets/kelsChat.js|esc(kelsPhotoUrl())": "a blob: URL the browser made, or a file bundled with the app",
 "@shared/assets/kelsChat.js|title": "the Kels chat contract, checked by its own rule (chat.say / panel / form and { title, html } screens are scanned as sinks at every caller)",
 "@shared/assets/kelsChat.js|html": "the Kels chat contract, checked by its own rule (chat.say / panel / form and { title, html } screens are scanned as sinks at every caller)",
 "@shared/assets/kelsChat.js|opener": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/kelsChat.js|how": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/kelsFindings.js|w.allDone(this.fixed)": "the Kels chat contract, checked by its own rule (chat.say / panel / form and { title, html } screens are scanned as sinks at every caller)",
 "@shared/assets/kelsFindings.js|w.nothingDone": "the Kels chat contract, checked by its own rule (chat.say / panel / form and { title, html } screens are scanned as sinks at every caller)",
 "@shared/assets/kelsFindings.js|w.stopped(this.fixed)": "the Kels chat contract, checked by its own rule (chat.say / panel / form and { title, html } screens are scanned as sinks at every caller)",
 "@shared/assets/kelsFindings.js|w.stoppedEmpty": "the Kels chat contract, checked by its own rule (chat.say / panel / form and { title, html } screens are scanned as sinks at every caller)",
 "@shared/assets/kelsSetupUI.js|this.name": "escaped where it is built (read the helper)",
 "@shared/assets/kelsSetupUI.js|logoPreview(this.kennel, { max: 120 })": "escaped where it is built (read the helper)",
 "@shared/assets/kelsSetupUI.js|LOGO_ACCEPT": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/assets/kelsSetupUI.js|logoPreview({ ...kennel, logo_data_url: root._logo }, { max: 120 })": "an <img src>: a data: URL she uploaded; a script URL does not run in an image",
 "@shared/assets/kelsSetupUI.js|nudgeFields(this.kennel, { on: this.kennel.promote_nudge_enabled ?? true })": "escaped where it is built (read the helper)",
 "@shared/assets/kelsSetupUI.js|puppyRecordFieldsHtml(this.kennel)": "escaped where it is built (read the helper)",
 "@shared/assets/kelsSetupUI.js|esc(href)": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/assets/guidedPeopleUI.js|c.id": "NOTE (finding 1b): an id interpolated without esc(); a UUID in practice",
 "@shared/assets/guidedDogsUI.js|d.key": "a key or id the code makes itself (crypto.randomUUID, a draft row key, event-<server seq>), never typed or received",
 "@shared/assets/guidedDogsUI.js|this.data": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/kelsSteps.js|this.current.title": "the Kels chat contract, checked by its own rule (chat.say / panel / form and { title, html } screens are scanned as sinks at every caller)",
 "@shared/assets/kelsSteps.js|this.current.html": "the Kels chat contract, checked by its own rule (chat.say / panel / form and { title, html } screens are scanned as sinks at every caller)",
 "@shared/assets/kennelSettingsFields.js|esc(kennel.logo_data_url)": "an <img src>: a data: URL she uploaded; a script URL does not run in an image",
 "@shared/assets/kennelTree.js|fam.rows": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/listView.js|c.className": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/listView.js|c.cell(r)": "listView hands cell() through raw by design; the 32 cell functions are scanned as sinks themselves",
 "@shared/assets/litterCheckinUI.js|{ weaning: `They're ${esc(age)} and still marked Whelped. Move the litter to Weaning?`, ready: s.reopen ? `A puppy is available again, but the litter is marked ${esc(C.statusLabel(this.litter.status)…": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/litterCheckinUI.js|C.plural(entered.length, 'weight')": "escaped where it is built (read the helper)",
 "@shared/assets/dogCheckinUI.js|f": "a key or id the code makes itself (crypto.randomUUID, a draft row key, event-<server seq>), never typed or received",
 "@shared/assets/litterCheckinUI.js|f": "a key or id the code makes itself (crypto.randomUUID, a draft row key, event-<server seq>), never typed or received",
 "@shared/assets/waitlistReviewUI.js|quote(miles0)?.fee": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/waitlistReviewUI.js|r": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/notificationsUI.js|name": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/notificationsUI.js|push.devices": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/onboardingUI.js|b.value": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/onboardingUI.js|b.label": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/onboardingUI.js|photo": "a blob: URL the browser made, or a file bundled with the app",
 "@shared/assets/picksPreviewModal.js|attr": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/picksPreviewModal.js|x.used": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/picksPreviewModal.js|x.max": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/picksPreviewModal.js|n": "escaped where it is built (read the helper)",
 "@shared/assets/picksPreviewModal.js|t.passes.used": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/picksPreviewModal.js|t.passes.max": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/picksPreviewModal.js|s.pups": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/picksPreviewModal.js|s.families": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/ui.js|d.badge": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/assets/pickupTimesPanel.js|booked.get(s.id)": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/pickupTimesPanel.js|s.capacity": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/pickupTransportStep.js|attrs": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/prepPupsUI.js|ask[0]": "escaped where it is built (read the helper)",
 "@shared/assets/prepPupsUI.js|esc(href)": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/assets/priceListEditor.js|sec.dataset.idx": "a key or id the code makes itself (crypto.randomUUID, a draft row key, event-<server seq>), never typed or received",
 "@shared/assets/printView.js|esc(kennel.logo_data_url)": "an <img src>: a data: URL she uploaded; a script URL does not run in an image",
 "@shared/pages/kennel.js|{ ...POLICY_LIST, note: policyNote(c) }": "escaped where it is built (read the helper)",
 "@shared/assets/reportView.js|c.className": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/assets/tidyUpUI.js|f": "the Kels chat contract, checked by its own rule (chat.say / panel / form and { title, html } screens are scanned as sinks at every caller)",
 "@shared/assets/tidyUpUI.js|Array.from({ length: n }, (_, i) => `<div class=\"gl-plan-row\"> <input id=\"tp-name-${i}\" type=\"text\" autocomplete=\"off\" placeholder=\"Puppy ${f.actual + i + 1}\" aria-label=\"Puppy ${i + 1}: name\"> <sele…": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/tidyUpUI.js|R": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/assets/vendorKeyUI.js|steps": "escaped where it is built (read the helper)",
 "@shared/assets/vendorKeyUI.js|esc(site)": "FINDING 1: a web address she typed or received, linked with whatever scheme it has",
 "@shared/assets/waitlistPicksPanel.js|q.litterPosition": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/waitlistReviewUI.js|this.skipped": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/waitlistReviewUI.js|b.days": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/waitlistReviewUI.js|res.boardingDays": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/waitlistSetupUI.js|attrs": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/pages/waitlist-entry.js|quote()?.fee": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/assets/websiteCard.js|esc(offer.current)": "FINDING 1: a web address she typed or received, linked with whatever scheme it has",
 "@shared/assets/websiteCard.js|fmtDate(link.last_sent_at.slice(0, 10))": "written by this device as an ISO time, in device-only settings",
 "@shared/assets/websiteCard.js|esc(site.website || '#')": "FINDING 1: a web address she typed or received, linked with whatever scheme it has",
 "@shared/assets/kelsSetupUI.js|logoUses(editionFlags)": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/data/kelsSetup.js|words[words.length - 1]": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/data/waitlistRules.js|list[0]": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/data/waitlistRules.js|list[list.length - 1]": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/nav.js|prefix": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/pages/accounts.js|esc(site)": "checked for http(s) before it is linked",
 "@shared/pages/accounts.js|esc(f.url)": "checked for http(s) before it is linked",
 "@shared/pages/accounts.js|s.count": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/pages/calendar.js|d.badge": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/data/calendarMath.js|Array(firstWeekday).fill(null)": "validated before use (isMonth) or read back from the page itself",
 "@shared/assets/ui.js|new URLSearchParams(location.search).get(name)": "validated before use (isMonth) or read back from the page itself",
 "@shared/pages/companion.js|esc(mailto)": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/pages/companion.js|esc(sms)": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/pages/contact.js|esc(href)": "checked for http(s) before it is linked",
 "@shared/pages/contract.js|descriptor(SEX, d.sex).label[0]": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/pages/contract.js|esc(c.document_url)": "FINDING 1: a web address she typed or received, linked with whatever scheme it has",
 "@shared/pages/contract.js|esc(url)": "checked for http(s) before it is linked",
 "@shared/pages/dashboard.js|href": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/pages/documents.js|esc(file.thumbnail)": "an <img src>: a data: URL she uploaded; a script URL does not run in an image",
 "@shared/pages/dog-cards.js|sent.reduce((n, d) => n + d.events.length, 0)": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/pages/dog-cards.js|p.ancestors.total": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/pages/dog-cards.js|p.ancestors.added": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/pages/dog-cards.js|p.ancestors.matched": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/pages/dog.js|p.notCounted": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/pages/dog.js|d.badge": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/pages/dog.js|esc(d.url)": "FINDING 1: a web address she typed or received, linked with whatever scheme it has",
 "@shared/pages/dogs.js|d.label[0]": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/pages/dogs.js|d.badge": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/pages/expense-import.js|r": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/pages/financials.js|esc(row.href)": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/data/csvImportHelp.js|Object.keys(HELP)": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/pages/import-batch.js|esc(href)": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/pages/import-export.js|n": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/pages/import-export.js|cloudUI.resetSignOutFieldHtml()": "escaped where it is built (read the helper)",
 "@shared/pages/invoice.js|esc(d.issuer.logo)": "an <img src>: a data: URL she uploaded; a script URL does not run in an image",
 "@shared/pages/kennel-tests-import.js|state.result.breedsAdded": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/pages/kennel-tests-import.js|state.result.testsAdded": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/pages/kennel.js|valueHtml": "escaped where it is built (read the helper)",
 "@shared/pages/kennel.js|href": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/pages/litter.js|esc(l.photos_url)": "FINDING 1: a web address she typed or received, linked with whatever scheme it has",
 "@shared/pages/litters.js|esc(l.photos_url)": "FINDING 1: a web address she typed or received, linked with whatever scheme it has",
 "@shared/pages/puppy-record.js|c.cards": "escaped where it is built (read the helper)",
 "@shared/pages/puppy-record.js|esc(ownKennel.logo_data_url)": "an <img src>: a data: URL she uploaded; a script URL does not run in an image",
 "@shared/pages/puppy-record.js|sireHtml": "escaped where it is built (read the helper)",
 "@shared/pages/puppy-record.js|damHtml": "escaped where it is built (read the helper)",
 "@shared/pages/reports.js|esc(r.href)": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/pages/sale.js|st.n": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/pages/sale.js|esc(s.payment_link_url)": "FINDING 1: a web address she typed or received, linked with whatever scheme it has",
 "@shared/pages/stud-service.js|descriptor(SEX, d.sex).label[0]": "a vocab.js row or a table of literals in the same file (descriptor() falls back to the constant badge-gray; label[0] is one character)",
 "@shared/pages/today.js|esc(n.subjectHref)": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/pages/today.js|esc(row.href)": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/pages/today.js|href": "a link the code builds: a page name plus encodeURIComponent(id), or mailto:/sms: plus encoded parts",
 "@shared/pages/waitlist-entry.js|r.id": "a key or id the code makes itself (crypto.randomUUID, a draft row key, event-<server seq>), never typed or received",
 "@shared/pages/waitlist-entry.js|r.text": "escaped where it is built (read the helper)",
 "@shared/pages/waitlist-entry.js|r.buttons": "escaped where it is built (read the helper)",
 "@shared/pages/waitlist-entry.js|r.kind": "a key or id the code makes itself (crypto.randomUUID, a draft row key, event-<server seq>), never typed or received",
 "@shared/pages/waitlist-entry.js|request": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/pages/waitlist-entry.js|attr": "a string written in the code at every call site (checked by reading the callers)",
 "@shared/pages/waitlist-entry.js|counts[t.id]": "a number the data layer computed (a count, an index, a fee, miles, days)",
 "@shared/pages/waitlist-programs.js|ctx.counts.get(p.id)": "a number the data layer computed (a count, an index, a fee, miles, days)"
}
````

</details>
