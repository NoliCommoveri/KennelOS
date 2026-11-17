# KennelOS — Credits: plan

> Status: **plan, nothing built.** One currency, **credits**, that a breeder buys and then spends
> on any extra KennelOS offers: 30-day passes that add features, per-use services the server
> performs, and add-ons beyond a free amount. Lite and Pro stay two separate apps. Everything a
> credit buys is decided and enforced **on the server**; feature code a Lite program hasn't
> paid for is never on its device. Payment starts manual (she pays outside the app, support
> marks it received); Lemon Squeezy is the future state (§11). Open decisions are in §13.

## 1. Why

The app has grown far past what Pro was priced for, and some of it (e-sign, a voice assistant,
support's time) costs KennelOS money each time it's used. Credits let:
- **Lite programs** rent the Pro features they need without moving to Pro;
- **every program** pay for what costs per use (e-sign over the allowance, voice, support);
- **features move to credits** (payment schedules, extra waitlist programs) without a new
  edition, a new checkout or a new license type.

One currency for everything: she never holds "e-sign credits" and "voice credits" separately.

## 2. The currency

- **1 credit = $0.35, fixed (D1).** The value of a credit never changes. Repricing means
  changing what an item costs in the catalog (§8.3), so a balance she holds is never worth less.
- **Sizing anchor:** Pro is expected to move to about **$8–10 a month** (D2), about 23–29
  credits. Lite passes are sized so that **any three of them cost roughly 75–90% of Pro**: a
  Lite program that wants most of Pro is nudged to Pro, and one that wants a single feature
  pays a fair slice.
- **Packs (D5, amounts proposed):**

  | Pack | Price | Credits | Effective per credit |
  |---|---|---|---|
  | Small | $7 | 20 | $0.35 |
  | Medium | $21 | 60 + 4 bonus | $0.33 |
  | Large | $35 | 100 + 10 bonus | $0.32 |
  | Program | $105 | 300 + 45 bonus | $0.30 |

  A minimum of $7 keeps manual matching worth the effort (§5).
- **Terms (D6, open):** whether credits expire (proposed: 24 months after purchase, oldest
  first), whether unspent credits are refundable (proposed: within 30 days of purchase, never
  after any were spent from that purchase), no cash value, not transferable between programs.
  `site/terms.html` gets a Credits section before the first credit is sold.

## 3. Who can use credits

| | Credits |
|---|---|
| **Lite** | Yes, with a cloud account. Buys Lite passes (§4.3), the both-edition items (§4.4) and add-ons. |
| **Pro** | Yes, with a cloud account. The license still opens the app; credits buy the both-edition items and per-use services. |
| **Demo** | No cloud, so no buying. Whether Demo shows the catalog as a read-only "what you could add" page is D11. |
| **`cloudUrl: null`** | No credits UI and no requests, as with every cloud feature. The app runs exactly as its edition ships. |
| **Support (helper sessions)** | May not buy or spend (`403 helper_not_allowed`, D13). Support grants credits from the manager app instead (§8.4). |

A balance belongs to the **program** (the cloud account), not a device: every device signed in
to the account sees the same balance and the same passes.

## 4. What's free, what Pro includes, and the catalog

### 4.1 Never charged, in either edition
Dogs, litters, pairings, heats and health events, the pedigree, sales with payments received,
expenses and the basic financials, Today, the calendar and reminders, pasted contract-form
links, CSV import, JSON export and backup, cloud backup, the Kels setup tasks, and **seeing and
exporting anything she ever created** (§6.4).

### 4.2 What the Pro subscription includes
Everything Pro ships today **except** the items in §4.4, plus a monthly allowance of
**10 e-sign sends** (the current `ESIGN_DEFAULT_MONTHLY_LIMIT`) and **1 waitlist program**
(D7, D8). Pro programs spend credits only on §4.4 and §4.5.

### 4.3 Lite passes (30 days)
Pro features a Lite program can add. Each is a **pack** (§7.3): its code arrives from the
server only while she holds the pass. Credits proposed; dollars at $0.35.

| Pass | What's in it (`editionFlags` it turns on) | Credits | ≈ $ |
|---|---|---|---|
| **Waitlist** | Waitlist pages, programs (1 included), application form, picks and the picks preview, side sales, pickup times, do-not-sell, Kels's waitlist tasks (`waitlist`) | 9 | 3.15 |
| **Waitlist Online** (needs Waitlist) | The published list, online application, family pages and requests, the puppy portal, waitlist emails, notifications. Server routes accept the pass where they now `requirePro` | 6 | 2.10 |
| **Reports** | All reports and Year in review (`reports`) | 6 | 2.10 |
| **People** | Contacts, contact import (`contactsSection`) | 4 | 1.40 |
| **Contracts** | Contracts pages, contract templates; sends are per use (§4.5) (`contracts`, `documents`) | 5 | 1.75 |
| **Stud services** | Stud service pages, import, reports (`studServices`) | 4 | 1.40 |
| **Invoicing** | Invoices and receipts, receipt attachments, extra charges (`invoicing`, `receiptAttach`, `extraCharges`) | 4 | 1.40 |
| **Shows** | Show tracking, title points, "Log the title?" (`shows`) | 3 | 1.05 |
| **Live sync** | Live updates between devices; server-only, no pack (`liveSync`) | 5 | 1.75 |
| **Business toolkit** | Accounts and referral codes, foster whelps, external ownership, feeding schedules, puppy record, companion share-out (`accounts`, `fosterArrangement`, `externalOwnership`, `feedingSchedule`, `puppyRecord`, `companion`) | 4 | 1.40 |
| **Unlimited roster** | Lifts the 6-dog / 10-litter cap while held (D19) | 5 | 1.75 |

Not offered to Lite: multi-kennel, the KennelPort website link, Dog Cards, Furever and the
Assistant console. Those are reasons to move to Pro. There is **no all-access pass in Lite**:
all-access is what Pro is.

### 4.4 Both editions (moved to credits)
| Item | Model | Credits | ≈ $ |
|---|---|---|---|
| **Payment schedules** (several due dates on a sale, saved schedules, final-payment methods) | 30-day pass, a pack in both editions | 4 | 1.40 |
| **Extra waitlist program** (beyond the 1 included) | Add-on, each, per 30 days | 1 | 0.35 |

### 4.5 Per use (both editions)
Per-use items are only things **the server does**, so the server can charge at the moment it
does them (D4). A feature that runs on her device is a pass, never per use.

| Item | Credits | ≈ $ | Notes |
|---|---|---|---|
| **E-sign send** beyond the allowance | 2 | 0.70 | Firma costs about 5¢. Countersignature and the emailed signed copy included. Charged when Firma accepts the send, reserved while a preview is open (the existing "held" logic) |
| **Library contract template** (adding one) | 3 | 1.05 | §2.3b of the Integrations plan |
| **Assisted setup session** | 60 | 21.00 | Support's time, through the manager app |
| **Custom website domain** (Pro) | 30 once | 10.50 | Support adds it to `WEBSITE_ORIGINS` by hand today |
| **Voice assistant** | TBD | — | Priced from its real cost; see `docs/KennelOS_Voice_Plan.md` (V2) |

Later candidates, once there's a meter for them: cloud storage over a free amount, live sync
devices over a free number, and emails to families over an allowance. Emails
are priced only once there's a real per-email cost (enough programs sharing a paid email plan,
or a pay-per-use provider): below that, a block of emails at a credit's price can't cover the
step to a paid plan. Until then the daily limit is handled by `docs/KennelOS_Mail_Budget_Plan.md`.

## 5. Buying credits (manual payment)

1. **She picks a pack** in Settings → Credits. The server creates a **request**: pack, credits,
   price, status `awaiting_payment`, and a **memo code** (`KOS-` + 4 characters, no name in it).
2. **She sees how to pay:** the amount, the code to put in the payment's memo, and support's
   payment details (Zelle and any other methods, text set in `/ops`, D15), each with a Copy
   button. The request waits under "Waiting for payment" with a Cancel button.
3. **The manager app's Credits tab** lists open requests (program label, pack, amount, code,
   age) and pushes a notification for each new one.
4. **Support matches the payment** in the bank and presses **Mark received** (method, amount
   received). The server writes the ledger's `purchase` row and closes the request in one
   batch, then emails her ("25 credits added") and refreshes her token (§7.2).
5. **Unpaid requests expire** after 7 days (D18), by the hourly cron. Support can cancel one,
   or **Reverse** a credited one (a bounced or recalled payment) with a `reversal` row; a
   reversal may take the balance below zero, and a negative balance blocks spending until
   it's covered.

Nothing about the payer is stored: no name, bank, phone or handle. The request keeps the method
and amount only. Logs carry no codes, emails or bodies (`cloud/README.md`).

## 6. Spending credits

### 6.1 Passes
- **Buy** from Settings → Credits or from an unlock prompt (§9.3). The server checks the
  balance, writes a `spend` row and extends the pass by 30 days from its current end (or from
  now), in one batch.
- **Auto-renew** (off by default, D17): the hourly cron renews a pass on its last day if the
  balance covers it; if not, it emails a warning 7 days and 1 day before the end.
- **Renewing early** stacks: 30 days are added to the current end.

### 6.2 Per use
The charge happens **inside the server action itself** (the Firma send, the template copy), in
the same batch that records the action, keyed by the action's id so a retry never charges
twice. Not enough credits → the action is refused with `402 credits_needed` and the app shows
the unlock prompt.

### 6.3 Add-ons
Counted per 30 days like a pass, with a quantity (`extra_waitlist_programs: 2`). Lowering the
quantity takes effect at the next renewal.

### 6.4 When a pass lapses
- **Her records never lock** (D9, proposed): for **90 days** after a pass ends, its pack stays
  on her devices and opens **view-only** (every button that writes is disabled, with a "Renew
  to edit" note). After that the pack is removed. The records stay in her database, her
  backups, her exports and her sync the whole time; renewing brings the pages back.
- **Pages families see** (Waitlist Online's list, application and family pages) get a
  **7-day grace** after the pass ends (D10), then say "This waitlist isn't taking applications
  right now," never an error.
- **Lite's roster cap** returns when Unlimited roster lapses, under the existing cap rules:
  nothing is removed, she just can't add a dog into the counted set or an 11th litter.

## 7. Keeping it on the server

The rule: **anything a credit buys is decided by the server.** The device holds only what the
server signed for it, and code for features she hasn't paid for never reaches it.

### 7.1 The ledger
- An append-only `credit_ledger` on the Worker's database. **The balance is the sum of its
  rows**, never a stored number, so it can't drift and every credit has a reason.
- Every write that touches credits (a purchase, a spend, a grant, a reversal, an expiry) is a
  ledger row written in the same D1 batch as the change it pays for.
- Rows the device can't see: support's notes. Rows it can: date, kind, amount, what it was for.

### 7.2 Signed entitlements
- The server issues an **entitlement token**: the program id, the edition it was issued for,
  each pass and add-on with its end date, the per-use allowances left this month, when it was
  issued and when it must be refreshed by. It's signed with an **ECDSA P-256** private key
  held as a Worker secret (`ENTITLEMENT_SIGNING_KEY`, with a key id so it can be rotated).
- The app checks the signature with the **public key built into each edition** (WebCrypto,
  supported by every browser the app runs in). Editing browser storage can't grant a pass:
  an edited token fails the check.
- **Offline:** a pass in a valid token works offline until its end date. The token is
  refreshed on every online open and after every purchase or spend. The device keeps the
  latest time it has seen; a clock moved back more than a day makes it ask the server again
  before trusting a pass.
- Server routes never trust the token: they read entitlements from the database directly.
  The token only tells the device what to show.

### 7.3 Feature packs, delivered on demand
This is what keeps Lite's "the code isn't there" protection while letting Lite rent Pro
features.

- **A pack** is a named group of app files (pages, page scripts, assets) that one pass unlocks.
  `shared/data/packs.js` lists them, the same way `proPages.js` lists Pro-only files. A pack's
  data-layer modules stay shared, exactly as Pro's repos ship in Lite today.
- **The build** (`build/assemble.mjs`): for each edition, a pack the edition **includes** is
  copied in as normal files (Pro includes most packs). A pack the edition doesn't include is
  left out of `dist/<edition>/` and written to `dist/packs/<edition>/<CACHE_NAME>/<pack>/`
  instead. `build/checkImports.mjs` extends to check that shipped files reach a pack only
  through a dynamic import guarded by `featureOn()`.
- **The deploy** uploads `dist/packs/` to an R2 bucket (a new Cloudflare token as a GitHub
  Actions secret). Packs are versioned by `CACHE_NAME`, so a device always gets files built
  with the version it's running; the last few versions are kept so devices that haven't
  updated still work.
- **The Worker** serves `GET /packs/<edition>/<version>/<pack>/<path>` only to a signed-in
  device whose program holds that pass (read from the database, not the token), with
  `Cache-Control: private, no-store` for anything else.
- **The service worker** makes pack files appear at their normal app paths: a request for
  `/pages/reports.html` or `/pages/reports.js` is answered from the pack's cache, or fetched
  from the Worker with the device's session when online and entitled, or answered with an
  "Unlock this in Settings → Credits" page. Page code doesn't change: the same imports as in
  Pro, the files just arrive differently.
- **One cache per pack**, `kennelos-pack-<pack>-<CACHE_NAME>`, in Cache Storage, apart from
  the database. Removing a pack is `caches.delete()` of that one cache and never touches
  IndexedDB.
- **The service worker checks the token on every pack request**, not only when it fetches:
  past the pass's end date it serves the view-only pack (§6.4), and after the view-only
  window the unlock page. A pack whose cache wasn't deleted is dead weight, never a working
  feature. The end date is inside the signed token, so this holds offline, and the date can't
  be moved without the server's signature.
- **On lapse** the pack switches to view-only (§6.4). After 90 days the app deletes the pack's
  cache on its next open; the Worker already refuses to send it again (it checks the
  database).
- **App updates.** `shared/sw.js`'s activate step deletes every cache that isn't the current
  `CACHE_NAME` (or the notifications cache), so packs from the old version go with it, which
  is right: packs are built per version. But a device with an active pass must not be left
  without its pack after an update. So while a new version **installs** online, the service
  worker fetches the new version of every pack the device holds an active or view-only pass
  for, into the new version's pack caches, and the install fails (keeping the old version
  running) if any of those fetches does. Activate then deletes the old version's pack caches
  together with the old shell, only once the new ones are in place.
- **Why leaving the data behind is safe:** packs hold only screens. The data layer (repos,
  schema, `referenceRegistry.js`) ships in every edition, so with a pack gone Lite still
  enforces the same rules on those rows (a hard delete that would orphan them is still
  refused), and its JSON backups, cloud backup and sync carry them like any other table.
  Renewing brings the screens back over the same rows; moving to Pro shows them with nothing
  to restore.
- **Pro** uses the same mechanism for the §4.4 packs (payment schedules), which are left out
  of Pro's static files too.

### 7.4 The honest caveat
Once a paying program has a pack, its files are in that browser's cache, and a technical person
could copy them and patch the checks to keep using them after the pass ends. That is the same
level of protection Pro's license already accepts. What this plan guarantees is that **a
program that never paid never has the code**, and that **nothing the server does** (sends,
emails, family pages, sync, support) can be had without credits.

## 8. Server

### 8.1 Tables (one migration)
- `credit_ledger`: id, program_id, delta (integer credits), kind (`purchase`, `spend`,
  `refund`, `grant`, `reversal`, `expire`), ref_type, ref_id, note (support only), created_at.
  Unique on (program_id, kind, ref_type, ref_id) so a retried write can't double-count.
- `credit_requests`: id, program_id, pack_id, credits, price_cents, memo_code (unique),
  status (`awaiting_payment`, `credited`, `cancelled`, `expired`, `reversed`), method,
  received_cents, created_at, expires_at, resolved_at.
- `credit_items`: the catalog (§8.3): key, kind (`pass`, `use`, `addon`), credits,
  period_days, editions, included_by_edition (JSON), active.
- `credit_packs`: id, credits, bonus, price_cents, active, ls_variant_id (null until §11).
- `program_entitlements`: program_id, item_key, until, quantity, auto_renew, updated_at.
  Primary key (program_id, item_key).

### 8.2 Routes
- `GET /credits`: balance, passes and add-ons, the catalog for her edition, open requests,
  recent ledger rows, and a fresh entitlement token.
- `POST /credits/requests` {pack_id}; `DELETE /credits/requests/:id` (her own, while open).
- `POST /credits/passes` {item_key}; `PATCH /credits/passes/:item_key` {auto_renew, quantity}.
- `GET /packs/...` (§7.3).
- Manager: `/manager/api/credits/*`: open requests, mark received, cancel, reverse, grant,
  look up a program's balance and ledger.
- Existing routes change: the Firma send replaces its monthly-limit refusal with "allowance,
  then credits"; library template copies charge; W2 waitlist routes accept the Waitlist Online
  pass where they now call `requirePro`; sync accepts the Live sync pass for Lite.
- Cron (the existing hourly one): expire unpaid requests, auto-renew, lapse warnings, expire
  old credits if D6 says so.

### 8.3 `/ops`
The catalog and the packs (credits, price, active), the payment instructions text, the
included amounts per edition, and the signing key's rotation. Changing a price never touches a
balance or a pass already bought.

### 8.4 The manager app
A **Credits** tab beside Templates: open requests with Mark received / Cancel, recent credited
requests with Reverse, and **Grant credits** to a program by its KennelOS email (for gifts,
apologies, and converting the demo users' gifted year, D16). Each new request sends a push.

## 9. App

### 9.1 Modules
- `shared/data/entitlements.js` (no DOM): checks and caches the token through `settings.js`,
  `has(item)`, `mode(item)` (`full`, `view`, `none`), `refresh()`.
- `featureOn(flag)`: `editionFlags[flag] || entitlements.has(<the pass for flag>)`. Every read
  of a flag a pass can turn on goes through it. The shared core stays edition-agnostic: what
  each edition includes for free is declared in its `editionConfig.js` (`includedItems`), not
  in shared code.
- `shared/data/packs.js`: the pack registry (§7.3).
- `shared/data/cloud/cloudApi.js`: the new calls (still the only module that touches the
  network).

### 9.2 Settings → Credits
Balance; **Buy credits** (packs → the payment instructions and memo code); **Waiting for
payment**; **My passes** (end dates, Renew, auto-renew); **History** (the ledger rows she can
see). Hidden without a cloud account, and in Demo per D11.

### 9.3 Unlock prompts
Where Lite now hides a Pro link or shows the upgrade nudge, it shows both choices: **Add
Reports for 6 credits (30 days)** and **Upgrade to Pro**. A `402 credits_needed` from a
per-use action opens the same prompt with the item's price.

### 9.4 What never goes in a file
The entitlement token and the pack cache are device-only: never in a JSON backup, never synced,
cleared by Reset App (the next online open fetches them again).

## 10. Rules this touches

- **Service worker:** pack files are removed from the generated `PRECACHE_URLS` of an edition
  that doesn't include them, and `shared/sw.js` gains the pack handler (§7.3). New app files
  (the Credits UI, `entitlements.js`, `packs.js`) go into `PRECACHE_URLS` when added.
- **"No CDN, offline after first load":** packs come from KennelOS's own Worker and are cached
  for offline use once fetched. This is a documented exception for paid packs only; the free
  app still needs nothing from the network.
- **Editions docs and the End-State guide** (§0 especially) get the packs model when it's built.
- **Backups and sync registries:** no new synced fields; nothing here is in a file (§9.4).
- **The final release** (`build/assemble.mjs --final`, terms §14): final **Pro** includes every
  pack as normal files, unlocked. Final **Lite** ships as today; a Lite program that had passes
  moves to the free final Pro with a JSON export (D12). The terms say what happens to unspent
  credits if KennelOS ends.

## 11. Future: Lemon Squeezy

The Worker already receives Lemon Squeezy's signed webhooks (`POST /webhooks/lemonsqueezy`,
`cloud/src/license.js`). Credit packs become Lemon Squeezy products, and `credit_packs.
ls_variant_id` maps each one:
- **Buy credits** opens the Lemon Squeezy checkout for the pack, with the program id passed as
  custom checkout data (not the email).
- The `order_created` webhook writes the `purchase` row, idempotent on the order id; a
  `order_refunded` webhook writes a `reversal`.
- Lemon Squeezy is the merchant of record, so sales tax and receipts are handled.
- Manual payment can stay as a second method, or be retired. No other part of this plan
  changes: the ledger doesn't care how a purchase arrived.

## 12. Build order

1. **Ledger and buying:** the migration, the catalog in `/ops`, manual requests, the manager
   app's Credits tab, Settings → Credits showing balance and requests. No spending yet. Grant
   the demo users their credits (D16).
2. **Signed entitlements:** the token, `entitlements.js`, `featureOn()`, My passes.
3. **Per use:** e-sign sends over the allowance, library templates, assisted setup.
4. **Server-only passes:** Live sync for Lite, then Waitlist Online's server routes (it needs
   the Waitlist pack before it's useful to Lite, so it ships to Lite with step 6).
5. **Packs:** the build split, R2 upload, the Worker route, the service worker handler. First
   pack: **Reports** (read-only, self-contained, a good test).
6. **The rest of the packs:** Shows, Invoicing, People, Contracts, Stud services, Business
   toolkit, Waitlist (+ Online), Unlimited roster; payment schedules in both editions.
7. **Auto-renew, lapse warnings and view-only mode.**
8. **Voice assistant:** its own plan, priced from its real cost.

Later: Lemon Squeezy packs (§11).

## 13. Decisions

| # | Question | Status |
|---|---|---|
| D1 | What a credit is worth | **Decided:** $0.35, fixed forever; prices change in the catalog |
| D2 | Pro's price, for sizing Lite passes | **Assumption:** about $8–10 a month |
| D3 | One app with credits, or keep Lite and Pro | **Decided:** keep two apps |
| D4 | Per use only for server actions; device features only as passes delivered as packs | Proposed |
| D5 | Pack sizes, prices and bonuses (§2) | Open |
| D6 | Do credits expire? Refunds? | Open. Proposed: 24 months, oldest first; refundable within 30 days if none spent |
| D7 | Payment schedules and extra waitlist programs on credits in Pro too | Owner asked for it; confirm Pro's included amount (proposed: 1 program, no schedules) |
| D8 | E-sign allowance per edition | Open. Proposed: Pro 10 a month, Lite 0 |
| D9 | What she sees after a pass lapses | Proposed: view-only for 90 days, then the pack is removed; records always kept and exportable |
| D10 | Family-facing pages after Waitlist Online lapses | Proposed: 7-day grace, then a polite "not taking applications" page |
| D11 | Demo shows the catalog? | Open |
| D12 | The final release | Proposed: final Pro includes every pack unlocked; final Lite unchanged |
| D13 | Support helpers buying or spending | Proposed: refused; support grants instead |
| D14 | The currency's name | Open. "Credits" in this plan |
| D15 | Payment methods offered for manual payment | Open (Zelle; others?) |
| D16 | The demo users' gifted year | Open: convert what's left into credits, or a grant equal to the passes they use |
| D17 | Auto-renew default | Proposed: off |
| D18 | How long an unpaid request waits | Proposed: 7 days |
| D19 | Unlimited roster as a Lite pass, or keep the cap firm | Proposed: offer it |
