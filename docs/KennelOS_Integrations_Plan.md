# KennelOS Integrations — research & plan

> **Status: approved 2026-10-10, every §8 decision as recommended, and every design choice in
> §0–§7 as written. Nothing is built yet; §6 is the build order, one reviewable PR per step.**
> It covers five asks: (1) the
> waitlist embedded on breeders' own websites, (2) Jotform / DocuSign contracts, (3) referral-use
> notifications + thank-yous, (4) payment links through the breeder's own Stripe / Square, and
> (5) processing fees on sales (e.g. Good Dog's 6.25%). §8 records the decisions taken.
> Still open inside a step: DocuSign's own-key vs Partner Program route (only if D5 ever
> brings DocuSign in), and confirming Stripe / Square live-animal terms before step 6 (D8).
>
> Builds on: the Worker (`cloud/`, `docs/KennelOS_Cloud_Phase1_Plan.md`), the online waitlist
> (`docs/KennelOS_Waitlist_W2_Plan.md`, "W2 §N"), Accounts (End-State guide §32), Financials
> (guide §21) and the Invoice (guide §24).
>
> **Research caveat.** Vendor facts below come from vendor docs and support answers found on
> 2026-10-10, and several sources disagreed with each other (marked *unverified*). Re-check each
> vendor's current docs and terms before building its step. Sources are at the end.

---

## 0. The shape every integration shares

KennelOS keeps its data on the breeder's device, and the only server is the opt-in Worker. Each
integration here needs at least one of three things the device can't do alone:

| Need | Why the device can't | Where it goes |
|---|---|---|
| **Receive a webhook** (form signed, payment made) | A phone has no public address and is often asleep | A Worker route |
| **Hold an API secret / OAuth token** for her Stripe, Square or DocuSign account | A secret in the page would leak to anyone who reads it, and the token must work while she's offline | Worker storage, encrypted |
| **Serve a page to the public** (embedded waitlist) | Same as above | The Worker's family pages (W2 §3) |

So every item except §5 (fees) is **Pro + cloud**: it follows the W2 pattern exactly. Her device
stays the source of truth, the Worker only relays, and changes come back to her device as an
**event stream** that the backing device applies (W2 §6).

**Proposed common pieces** (built once, in the first step that needs them):

- **`int_connections`** (new migration): `program_id`, `provider` (`stripe`/`square`/`docusign`/
  `jotform`), the provider's account id, the token **encrypted with a Worker secret** (never sent
  back to a device), scopes, `connected_at`, `revoked_at`. **Disconnect** revokes at the provider
  and deletes the row. Account deletion deletes every row.
- **`int_events`** (`seq`, provider, kind, the KennelOS record id, a small payload: status, amount,
  fee, date). It never holds names, emails or document contents. Devices read it with
  `GET /integrations/events?since=` like `wl_events`. A new pure reducer,
  `shared/data/integrationEvents.js`, turns each event into a repo call: Contract → `signed`,
  Sale → `deposit_paid`, and so on. When the record has changed on her device since the event's
  basis, the event becomes a **Today suggestion** instead of an automatic write (same rule as
  W2 §6).
- **Webhook routes** `POST /hooks/<provider>/<connection secret>`. Each one checks the provider's
  signature where the provider signs (Stripe, Square, DocuSign Connect HMAC). Jotform doesn't
  sign (*unverified*; a 2020 support answer), so its URL carries a 256-bit secret per connection.
  Each route is rate-limited, logs nothing from the body (the `cloud/README.md` rule), and is
  idempotent on the provider's event id.
- **How a record is matched.** We put the KennelOS record's UUID (`sale_id` / `contract_id`) in
  the provider's metadata / hidden field when the link or envelope is made. It is opaque, and the
  provider hands it back in its webhook, so no matching by name or email is ever needed.
- **`cloudUrl: null` still works.** With no cloud, none of this renders. The no-server "Level 0"
  options below (paste your own link) still work, because they're just stored URLs.

**The privacy line, to agree on (D1).** Making a payment link or contract envelope **sends buyer
data (name, email, price, pup) to her vendor account**. That is her choice and her account,
which is a different thing from KennelOS's cloud. The Worker only relays the request; it keeps
the correlation id + status, not the data. **What's new is that the Worker holds tokens that can
act on her Stripe / DocuSign account.** That is a real trust step past "the server stores an
encrypted backup", and the setup screen should say so plainly.

---

## 1. Waitlist embedded on a breeder's existing website

### What exists
The online application form is already live at `https://apply.kennelos.app/apply/<public_id>`,
with the public list at `/list/<public_id>` (W2 §3). It's a small plain page, encrypted to her
form key in the applicant's browser, with Turnstile spam checks. **Today it sends
`frame-ancestors 'none'`** (`cloud/src/familyPages.js` `APPLY_CSP`), so it **cannot be framed by
another site at all**, by design.

### Options

| | How the breeder adds it | Works on | Notes |
|---|---|---|---|
| **A. Button / link** | Paste a link or a styled "Apply for a puppy" button | Everything, including Facebook, Linktree, email | Works today. Opens our page in a new tab. Zero risk. |
| **B. iframe snippet** | Paste `<iframe src="…/apply/<id>?embed=1">` | WordPress, Wix (its "Embed HTML" element is itself an iframe), GoDaddy, Weebly, Squarespace (*iframes/JS on Core plan and up, unverified*) | Fixed height unless (C). Needs the CSP change below. |
| **C. Script snippet** (recommended) | Paste one `<script src="https://apply.kennelos.app/embed.js" data-kennel="<id>" data-view="apply">` | Any builder that allows a script; on Wix it runs inside Wix's own frame, so it falls back to a fixed height | The script inserts the iframe and resizes it from `postMessage` height messages, the standard pattern. |

**Not recommended: a "native" widget** (our script drawing the form straight into her page's
DOM). Her page's own scripts and CSS would then share the page with an application being
encrypted, and her theme would break our layout. An iframe keeps the encryption, Turnstile and
CSP on our origin, and her site never sees the answers. That isolation **is** the privacy
property.

### What changes (small)
1. **Framing allowed, opt-in per kennel.** `wl_kennels` gains an **embed** switch and an optional
   list of her site origins (D2). `frame-ancestors` becomes `'self' https://her-site.com …` when
   she lists origins, `*` when she turns embed on with no list, and stays `'none'` when embed is
   off (the default).
   Clickjacking risk is low (a form she fills in herself, no logged-in state), and Turnstile
   works inside iframes.
2. **`?embed=1` mode** on `apply.html` / `list.html`: drops our header/footer and posts
   `{type:'kennelos:height', h}` to the parent whenever its height changes.
3. **After submit**, the page navigates to the status page (`apply.js` →
   `location.assign('/s/<token>')`). Inside a frame that would put her private status page inside
   someone's website, and its session in **partitioned** third-party storage (`session.js` uses
   `localStorage`). In embed mode the page instead shows "Application sent. Check your email to
   confirm," with a button that opens the status page in a new tab (`target=_blank`).
4. **`cloud/public/embed.js`**: ~60 lines, no dependencies. Reads `data-kennel` / `data-view`
   (`apply` | `list`) / optional `data-theme`, inserts the iframe, listens for height messages
   **only from our origin**, and sets `title` for screen readers.
5. **Her side (Pro):** Waitlist settings gets an **"Add to your website"** card with the link,
   the button HTML and the script snippet, each with **Copy**, plus short per-builder notes
   (WordPress: Custom HTML block; Wix: Embed → Embed HTML; Squarespace: Code block).
6. **Light theming (optional):** `data-accent="#3a6"` passed through as a query param the page
   applies as one CSS variable. Nothing else is configurable, which keeps the page ours.

**Size:** one PR, mostly the Worker + `cloud/public/`. It needs a `wl_kennels` column (additive
migration) and an "embed" toggle in the projection's `kennel` block. No `shared/sw.js` change:
family pages aren't an edition.

---

## 2. Contracts out for signature: Jotform and DocuSign

### What she wants
From a Sale / Contract: make a signable document with the facts filled in → get the buyer's URL
→ be told when it's signed → the Contract moves to `signed` (with `signed_date` and
`document_url`). `CONTRACT_STATUS` already has `draft → sent → signed / declined`, so no new
vocab is needed beyond the provider fields in §2.4.

### 2.1 Jotform: what the research says
- **Jotform Sign (their e-sign product) has no API to create or send a document from a
  template** in the recent support answers (Oct 2025, Jan 2026); one older answer said otherwise.
  Its only automation is a **webhook when *every* signer has finished**, with the document id and
  a download link to the signed PDF. So "create from a sale" can't be automated with Jotform Sign.
- **A plain Jotform *form* can carry an e-signature field**, and forms **can be prefilled by
  URL parameters** (`?buyerName=…&price=…&saleRef=<uuid>`). That is Jotform's documented prefill
  method, and it needs **no API call and no server at all.** Forms also have **submission
  webhooks** (`POST /form/{id}/webhooks`), with the hidden `saleRef` field coming back in the
  payload. (*Unverified:* webhooks fire only for submissions made through the form, not ones made
  via the API. That's fine here.)
- Jotform webhooks are **not signed** (*unverified*), hence the secret-in-URL route.

**So the Jotform path is a contract *form*, not Jotform Sign:**
- **Level 0 (no server, could even be Lite, D4):** on the Contract she picks a saved
  **contract form** (her Jotform form URL + a field map, set up once), and **Send for signature**
  builds the prefilled URL on her device: buyer name, email, pup, price, deposit, registration,
  and the hidden `saleRef` / `contractRef`. She copies or emails it, and the Contract goes to
  `sent`. She marks it signed herself.
- **Level 1 (Pro + cloud):** a one-time **Connect Jotform** step registers our webhook on that
  form (API key pasted once, kept encrypted on the Worker, or she pastes the webhook URL into
  Jotform herself and we hold nothing). On submission, an event → Contract `signed`,
  `signed_date`, and `document_url` = the submission's PDF link (*check the link stays valid and
  is private*).
- **Caveats:** URL prefill puts the values **in the link** (visible to anyone who has it, and
  kept in browser history). That's acceptable for a buyer's own contract, but **never prefill
  private-tier fields** (notes, end reasons). A URL also has a length limit, so prefill only short
  facts. A prefilled field the buyer can edit should be **read-only** in her form; that's a
  Jotform form setting, and our setup notes say so.

### 2.2 DocuSign: what the research says
- The eSignature REST API does exactly what she wants: **create an envelope from a template,
  prefill tabs by data label, send (status `sent`)**, then either **email signing** (DocuSign
  emails the buyer) or **embedded signing** (`createRecipientView` returns a short-lived signing
  URL; *its expiry is unverified, commonly cited as minutes*; with `clientUserId` set, DocuSign's
  automatic reminders don't apply). Status comes back by **Connect** webhooks
  (`envelope-completed`, `-declined`, `-voided`) with **HMAC signing**.
- **The blocker is DocuSign's commercial model:**
  - A **public integration** (many customers each authorizing their own DocuSign account, which
    is us) **requires joining the DocuSign Partner Program** and passing a **go-live review**.
  - The alternative is **"bring your own key"**: each breeder makes her own integration key in
    her DocuSign account (a "private custom integration") and pastes it in. That's workable but
    unfriendly for a non-technical breeder.
  - **Her DocuSign plan must include API access.** The API plans cost from **~$50–75/month for
    ~40 envelopes** (sources disagree, *unverified*). Whether ordinary Standard / Business Pro
    plans permit a third-party API integration is **unverified**. Connect is reportedly bundled
    with higher tiers only.
- **Verdict:** technically the best fit, commercially the worst for small breeders. Build it
  only if real customers already pay for DocuSign with API access (D5).

### 2.3 Worth knowing: cheaper e-sign APIs with the same shape
Same flow as DocuSign (template → prefill → link or email → signed webhook), priced per document
(*vendor pricing pages, verify*):
- **SignWell**: first **25 API documents/month free**, then ~$0.85 each, falling with volume.
- **BoldSign**: ~$0.75 per request, with embedded signing and webhooks.
- **Dropbox Sign** (HelloSign): from ~$75–100/month; free test mode.

If she just wants "contracts signed and tracked", **one of these behind the same adapter is
likely the better first e-sign provider**, and DocuSign can be a second adapter later (D5).

### 2.4 Data model (additive)
On **Contract** (plain fields, no index needed, no new block; classify in `syncRegistry.js`, D9):
- `esign_provider` (`jotform`/`docusign`/`signwell`/…), `esign_ref` (the provider's envelope /
  submission id), `esign_url` (the buyer's signing URL, when the provider gives a durable one),
  `esign_sent_at`.
- `document_url` (exists) receives the signed PDF link; `signed_date` (exists) the completion
  date.

The **contract form / template map** (provider, template or form id, field → KennelOS fact) would
live on the **Account** for that vendor (§32 already lists vendors she has logins with) or in a
small settings record (D6). It would map only facts the Contract already reaches through its Sale
/ Contact / Dog. A **pure** builder (`shared/data/esignFields.js`) would make the values, so it
can be unit-tested the same way `companionExport.js`'s allow-list is.

### 2.5 Flow (Level 1, any provider)
```
Contract (draft) ── Send for signature ──▶ device builds fields (pure)
   │                                            │
   │  Jotform: prefilled URL on device ─────────┤ (no server call)
   │  DocuSign/SignWell: POST /integrations/esign/send ──▶ Worker ──▶ provider (her token)
   ▼                                                           ◀── envelope id / signing URL
Contract = sent, esign_ref, esign_url ──▶ she sends URL (or provider emails buyer)
   …buyer signs…  provider ──webhook──▶ /hooks/<p>/<secret> ──▶ int_events
backing device ◀── GET /integrations/events ── Contract = signed, signed_date, document_url
```

---

## 3. Referral-use notifications + thank-you messages

### What the research says
- **Amazon Associates** has **no postback or conversion API**. Reporting is aggregate, in
  Associates Central, by tracking ID. Amazon's operating policy **forbids sub-tags associated
  with a specific end user**. So "Jane used my Amazon link" **cannot be known** from Amazon, and
  trying to tag each family breaks Amazon's terms.
- **Chewy** runs its affiliate program mainly through **Partnerize** (also listed on Impact),
  ~4% commission, ~15-day cookie (*figures vary by source*). Networks like **Impact** do offer
  **postbacks** (a webhook per conversion) with **sub-IDs**. But per-person sub-IDs raise the
  same privacy / terms question, and the breeder would need affiliate network approval, which is
  separate from Chewy's breeder or rescue programs.
- **Breeder programs** (Embark Breeder Affiliate: 10% or a free test per 10 sold, buyer discount
  code, **quarterly** commission; Purina Pro Club: points when a new owner buys after a starter
  kit; Royal Canin: varies by country) report through **their own portals and statements**,
  not webhooks.

**Bottom line: no major program will tell us *which buyer* used the code.** Real-time
per-buyer "they used it → thank them" isn't available, and building it on Amazon would break
its terms. What *is* achievable:

### Proposed instead
1. **Share-out first (closes the open item in guide §32).** Each Account's `referral_link` /
   `referral_code` / `referral_instructions` gets a **"Share with families"** switch. Switched-on
   accounts show on the family's Companion page and status page as "Our recommended
   products," with Copy buttons. This is pure client + projection work, and probably the part
   that actually earns her money.
2. **A thank-you sent at the right moment, not on detection.** "Thanks for getting
   Bella's food through our Chewy link, it helps the kennel" works as a **go-home follow-up**
   (a reminder N days after `delivered`), or as a one-tap **Thank** on a Contact when the
   buyer tells her or she sees a sale in her portal. It goes out through her own email (mailto /
   copy text) at Level 0, or the W2 kennel-name mailer at Level 1 (D7).
3. **Referral income in Financials.** A program payout (Embark quarterly, Chewy monthly) is
   logged against the Account. Proposal: an **income** row type `referral` (a new small table,
   `referral_payouts`: `account_id` FK → Accounts in `ACCOUNT_REFERENCES`, date, amount, note),
   so it lands in Earned income and the Overview. A CSV import from the program's statement could
   follow.
4. **Later, only if a breeder's program is on Impact / Partnerize:** a postback route on the
   Worker that logs "a conversion on your Chewy link" (amount, date, *no* person) to
   `int_events` → a Today note "Someone bought through your Chewy link 🎉". Per-family
   attribution only where the network's terms allow a sub-ID per family and she turns it on.

---

## 4. Payment links through her own Stripe / Square

**The money never touches KennelOS.** She has her own Stripe or Square account; we only **make
the link** and **listen for "paid"**. No platform fee, no funds flow through us, which keeps us
out of money-transmitter territory.

### What the research says
- **Stripe**: Connect with **Standard accounts via OAuth** (her existing account; the charge is
  a **direct charge** on her account under her branding). The **Payment Links API** creates a
  link with an amount, `metadata` (copied onto the PaymentIntent), `on_behalf_of`, and
  **`restrictions.completed_sessions.limit = 1`** so a deposit link can't be paid twice. Paid is
  `checkout.session.completed` (signed webhook). The fee is on the charge's balance
  transaction. List price ~2.9% + 30¢ US online.
- **Square**: OAuth with `ORDERS_WRITE` + `PAYMENTS_WRITE`; **CreatePaymentLink** with
  **`quick_pay`** (name + amount: "Deposit: Bella / Litter B"). `payment.created` /
  `payment.updated` webhooks (HMAC-signed); `processing_fee` on the payment (a forum report says
  sandbox webhooks omit it, so we'd read the payment back). **Payment Links 3.3% + 30¢** on the
  free plan since Oct 2025 (2.9% + 30¢ on Plus).
- **⚠️ Live-animal sales and processor terms (D8).** Stripe's published list names **"Animals"
  as prohibited only in Japan**. I found no US ban in Stripe's or Square's published policy, but
  both reserve the right to decline industries for card-network reasons. **PayPal** reportedly
  **excludes live animals from Seller Protection** (forum reports, *unverified*). Breeders should
  check their own account's terms. We should **not market this as "accept card payments for
  puppies"** until it's verified with Stripe / Square directly. Chargebacks on a $3,000 puppy
  are a real risk for her; the deposit link page should show her refund / deposit policy text.

### Proposed levels
- **Level 0 (no server, could be Lite, D4):** an Account (type `software`/new `payments`) can
  hold her **own static payment link** (Stripe / Square / PayPal / Venmo / Zelle instructions).
  The Sale page and the Invoice get **"Send payment link"**: copy the link + amount + a message.
  She still taps **Deposit received** herself, as today.
- **Level 1 (Pro + cloud):** **Connect Stripe** / **Connect Square** (OAuth). On a Sale:
  **Request deposit** / **Request balance** → Worker creates a one-use link for exactly that
  amount, with `sale_id` + component in metadata → the link is copied, or emailed by the W2
  mailer. Paid webhook → `int_events` → the backing device sets `deposit_date` / status
  `deposit_paid` (or `balance_paid_date` / `paid_in_full`), `payment_method` = "Credit/debit
  card", `payment_reference` = the provider's payment id, **and the processing fee**
  (feeds §5 automatically).
- **Waitlist application fee:** the same Level 1 link can be shown on the family's status page
  while the fee is unpaid. This would **reopen W2's Q6** ("fee received stays her tap"), so it's
  her call (D8).
- **Refunds stay in her Stripe / Square dashboard.** We'd only record a refund event as a note
  (and suggest the Sale status), never issue one.

### Data model (additive)
On **Sale**: `payment_link_url`, `payment_link_ref`, `payment_link_component`
(`deposit`/`balance`), `payment_link_created_at`, all plain. The paid event writes existing
fields. (D9 classifies them; `payment_link_url` is harmless, the rest are probably cloud.)

---

## 5. Processing fees: gross-up pricing and true net income

### The problem, in her example
A breeder sells through **Good Dog**, which keeps **6.25%** (her figure; the published terms
vary by source and payment method, so it must be configurable). She passes the fee to the buyer
as a higher price. Her **income is price − fee**. Today KennelOS has no fee concept: Financials
counts the full `price` as income.

### The arithmetic matters
If the fee is a percentage of the **price the buyer pays**, adding the percentage on top
**doesn't fully recover it**:

| Wants to net | "Add 6.25%" price | Good Dog keeps | She nets | Correct price `N ÷ (1 − 0.0625)` | She nets |
|---|---|---|---|---|---|
| $3,000.00 | $3,187.50 | $199.22 | **$2,988.28** | **$3,200.00** | $3,000.00 |

With a fixed part too (Stripe 2.9% + 30¢): `price = (N + fixed) ÷ (1 − pct)`. So the app should
**compute the gross-up**, not leave it to mental math.

### Proposal
**On Account** (the vendor already lives there, §32: Good Dog, and Stripe / Square once
connected), new plain fields:
- `fee_percent` (e.g. `6.25`), `fee_fixed` (e.g. `0.30`), `fee_note` (free text: "card only; ACH
  free").
- `fee_passed_to_buyer_default` (bool): whether she normally grosses up.

**On Sale**, new plain fields:
- `sales_channel_account_id`: **indexed FK → Account** ("Sold / paid through: Good Dog").
  This needs a `db.version(N)` index block (additive), its line in **`ACCOUNT_REFERENCES`**, and
  the guide's data-model + schema sections. (Or leave it unindexed if we never filter on it, D10.)
- `processing_fee_amount`: **a stored snapshot** of the fee on this sale. This is deliberately
  *not* derived from the Account's current rate, because rates change and a 2026 sale must keep
  its 2026 fee. It is not a back-pointer, it's a fact of the sale. Filled automatically by a
  Stripe / Square paid event (§4), suggested from the Account's rate otherwise, always editable.
- `fee_passed_to_buyer` (bool, defaults from the Account).

**Sale form behavior:**
- Picking a channel with a fee shows **"Fee: $200.00 (6.25%) · You net $3,000.00"** under the
  price.
- With **pass to buyer** on, a **"Price to net $___"** helper sets the price by the correct
  formula (only into a still-prefilled price, like `saleDefaults.js` does for the full-reg
  surcharge, never clobbering a deliberate edit).
- Litter defaults (`expected_price_*`) stay her *net* asking price. The grossed-up price is
  per sale, because only some sales go through Good Dog.

**Financials (`incomeView.js`):** a new component **`processing_fee`**, a negative line on the
sale, earned when the payment it rode on is earned. So **Earned income = what she actually
received**, the Overview Net is right, and the Litter P&L is right. Recommended over making the
fee an Expense row (D11): the money was never in her hands to spend, it's withheld at source,
and it belongs to the sale's own math. (For taxes she still sees the gross price and the fee
separately, the way the 1099-K reports gross.)

**Invoice / receipt (§24):** shows the **buyer's price** (gross). Optionally a line "includes
$200.00 marketplace / processing fee", off by default (D11). It never shows her net.

**Edition:** fees are pure local data, no server → **Lite too?** (D4). In Lite there's no
Accounts page today (Pro-only), so Lite would need the fee fields on the Sale alone.

**As built (step 1, 2026-10-10).** As above, with these details settled in the build
(End-State guide §21.1):
- The fee is computed on the sale **price** only (transport and boarding aren't in the base),
  and is always editable to what was actually charged.
- In Income, the fee is split across the sale's cash components in proportion to their size.
  Each share is earned, anticipated or dropped with the payment it came out of: a cancelled
  sale keeps only the paid share's fee, a lost sale none. Each share is filed under that
  payment's date in the P&L.
- The fee stays out of `saleComponents`, so invoices, receipts, `paidOnSale` and Receivables
  show the buyer's full amounts.
- The invoice "includes $X fee" line (D11, off by default) is **not built**. Nothing shows the
  fee on a buyer-facing document.
- Lite: no channel picker. The helper takes a typed rate.
- `db.version(3)` adds the `sales.sales_channel_account_id` index (D10), so a backup's
  `schema_version` now reads 3; older files still restore.

---

## 6. Suggested build order

Each step is one reviewable PR, ordered by value ÷ effort and by dependency.

| # | Step | Server? | Size |
|---|---|---|---|
| 1 | **Processing fees** (§5): Account fee fields, Sale channel + fee snapshot, gross-up helper, `processing_fee` income component, guide + registries. **Built 2026-10-10** (End-State guide §21.1) | No | M |
| 2 | **Waitlist embed** (§1): CSP opt-in, `?embed=1`, `embed.js`, "Add to your website" card | Worker (small) | S |
| 3 | **Referral share-out** (§3.1) + go-home thank-you reminder (§3.2) | No (projection only) | S |
| 4 | **Level 0 links**: stored payment link (§4) + Jotform prefilled contract form (§2.1) | No | S–M |
| 5 | **Integration plumbing** (§0): `int_connections`, `int_events`, hooks routes, `integrationEvents.js` reducer | Worker | M |
| 6 | **Stripe Connect + Square** payment links with paid webhooks (§4), auto fee capture into §5 | Worker | L |
| 7 | **Jotform Level 1** webhook → Contract signed (§2.1) | Worker | S (after 5) |
| 8 | **E-sign API provider**: SignWell / BoldSign first, or DocuSign if D5 says so (§2.2–2.3) | Worker | L |
| 9 | Referral payouts in Financials (§3.3); network postbacks only on demand (§3.4) | Optional | S–M |

Every step that adds a file updates `shared/sw.js` `PRECACHE_URLS` (Pro-only files also into
`proPages.js`) and asks before the `CACHE_NAME` bump; every new field is classified in
`syncRegistry.js` (and `cloud/scripts/cloud-fields.mjs` regenerated when cloud fields change);
every new FK lands in `referenceRegistry.js` + the guide; every Worker table is a new migration
+ its `index.js` line.

---

## 7. Risks

- **Holding vendor tokens** makes the Worker a higher-value target. Mitigations: encrypt at rest
  with a Worker secret, keep scopes minimal (Stripe: create payment links + read charges; no
  payouts), never log, revoke on disconnect / account deletion / lapsed license, and make
  `/ops` show counts only.
- **Webhook spoofing**: verify signatures; for unsigned Jotform, a per-connection secret path +
  only accept a `contractRef` that's an open `sent` contract on her account.
- **Vendor drift**: each adapter is a small module behind one interface
  (`send`/`verify`/`toEvent`), with recorded sample payloads in `cloud/tests/`.
- **Processor policy on live animals** (§4): verify before marketing.
- **Backup compatibility**: every new field is optional and read with a default; no
  `BACKUP_FORMAT_VERSION` bump expected.

---

## 8. Decisions (all taken as recommended, 2026-10-10)

| # | Question | Decision |
|---|---|---|
| D1 | OK for the Worker to hold OAuth tokens / API keys that act on her Stripe / Square / e-sign accounts (encrypted, minimal scope)? | Yes, with the plain-language setup notice |
| D2 | Waitlist embed: let any site frame it when she turns it on, or require her to list her site's address? | Optional list; `*` when blank, since there's no logged-in state to clickjack |
| D3 | Embed the public list too, or only the application form? | Both (same mechanism, `data-view`) |
| D4 | Do the no-server Level 0 features (stored payment link, prefilled Jotform link, fees) ship in **Lite** too? | Fees + payment link: yes (small, local, no cap impact); Jotform: Pro |
| D5 | First e-sign provider: Jotform form (L0 → L1) only, add **SignWell/BoldSign**, or go for **DocuSign** (Partner Program + her API plan)? | Jotform now; SignWell or BoldSign next; DocuSign only if paying customers already have API plans |
| D6 | Where the contract template / field map lives: on the vendor's Account, or a settings record? | On the Account (it's per vendor, and Accounts already holds vendor facts) |
| D7 | Thank-you messages: her own email (copy / mailto) or the KennelOS kennel-name mailer? | Copy / mailto first; mailer when W2's mailer is live for her |
| D8 | Payments: verify Stripe / Square live-animal terms before building? Allow pay-online for the **waitlist application fee** (reopens W2 Q6)? | Verify first; app fee online = yes, opt-in |
| D9 | Cloud vs private tier for the new fields (fee %, fee amount, channel, e-sign refs, payment-link refs) Follow the existing split (`syncRegistry.js`: `sales.price` / `deposit_amount` are private, `status` / dates are cloud). So `processing_fee_amount` is **private**, like `price`. `sales_channel_account_id`, `fee_passed_to_buyer`, and the Account's `fee_percent` / `fee_fixed` (a vendor's public rate) are **cloud**. E-sign / payment-link refs are **cloud**, so any device can match an incoming event; `payment_link_url` is cloud too |
| D10 | Index `Sale.sales_channel_account_id` (filter Financials by channel) or keep it plain? | Index it (a "Good Dog sales" filter is likely wanted); additive `version(N)` block |
| D11 | Fee as a negative income component (recommended) or an Expense row? Show "includes fee" on the invoice? | Income component; invoice line off by default |

---

## Sources (researched 2026-10-10)

- Jotform prefill and webhooks: [prefill via URL parameters](https://eu.jotform.com/fr/answers/13973971-prepopulating-form-via-url-parameters), [webhook from prefill](https://jotform.com/answers/3778846-form-prefill-prefilling-a-form-from-a-webhook-request), [webhook guide (Rollout)](https://rollout.com/integration-guides/jotform/quick-guide-to-implementing-webhooks-in-jotform), [webhook security](https://www.jotform.com/answers/2598619-webhook-security)
- Jotform Sign API: [sending via API](https://www.jotform.com/answers/26822631-sending-signature-requests-via-api), [create via API](https://www.jotform.com/answers/35218401-create-a-sign-document-via-api), [API support](https://www.jotform.com/answers/22471091-jotform-sign-api-support), [tracking via API](https://www.jotform.com/answers/4871361-track-jotform-sign-documents-via-api)
- DocuSign: [Envelopes:create](https://developers.docusign.com/docs/esign-rest-api/reference/envelopes/envelopes/create/), [templates](https://developers.docusign.com/docs/esign-rest-api/esign101/concepts/templates/creating/), [embedded signing view](https://www.docusign.com/blog/developers/deep-dive-the-embedded-signing-recipient-view), [embedded reminders](https://community.docusign.com/esignature-api-63/automated-reminders-for-hybrid-embedded-recipients-27579), [Go-Live](https://developers.docusign.com/platform/go-live/), [public integration / own-account](https://community.docusign.com/go-live-70/go-live-for-a-public-integration-when-every-customer-uses-their-own-docusign-account-27596), [developer pricing](https://ecom.docusign.com/plans-and-pricing/developer), [API pricing (Signeasy)](https://signeasy.com/blog/business/docusign-api-pricing), [Connect HMAC](https://www.esign.ai/blog/docusign-connect-securing-webhooks-hmac-signature-verification-code)
- Other e-sign APIs: [SignWell pricing (Verdocs)](https://verdocs.com/blog/signwell-pricing), [BoldSign vs Dropbox Sign](https://boldsign.com/alternatives/hellosign-dropbox-sign-api/), [Dropbox Sign API (SignWell)](https://www.signwell.com/resources/dropbox-sign-api/)
- Stripe: [restricted businesses](https://stripe.com/legal/restricted-businesses), [direct charges](https://stripe.com/docs/connect/direct-charges), [PaymentLink object](https://www.rubydoc.info/github/stripe/stripe-ruby/Stripe/PaymentLink), [fees (NerdWallet)](https://www.nerdwallet.com/business/software/learn/stripe-fees)
- Square: [Checkout API](https://developer.squareup.com/docs/checkout-api-overview), [CreatePaymentLink](https://developer.squareup.com/reference/square/checkout-api/create-payment-link), [payment link webhooks](https://developer.squareup.com/forums/t/which-webhook-event-will-use-after-payment-received-for-payment-link/22282), [sandbox webhook fields](https://developer.squareup.com/forums/t/checkout-create-payment-link-the-sandbox-environment-webhook-is-missing-parameters/19182), [Payment Links fees](https://Square.com/us/en/payment-links), [fees (NerdWallet)](https://www.nerdwallet.com/business/software/learn/square-fees)
- PayPal and live animals (anecdotal): [MorphMarket forum](https://community.morphmarket.com/t/paypal-alternative-payment-methods-apms-and-the-risks-for-live-animal-transactions/52004)
- Good Dog: [terms of service](https://www.gooddog.com/terms-of-service), [fee breakdown (third party)](https://www.petscare.com/news/faq/how-much-is-the-gooddog-fee), [a breeder's buyer guide](https://redrockdoodles.com/wp-content/uploads/2024/03/Payment-on-Good-Dog_-Buyer-Info-1.pdf)
- Affiliate programs: [Amazon Associates policies](https://affiliate-program.amazon.com/help/operating/policies), [Amazon has no postback (AnyTrack)](https://readme.anytrack.io/docs/amazon), [Chewy program (Lasso)](https://getlasso.co/affiliate/chewy/), [Chewy networks (AvidAffiliate)](https://avidaffiliate.com/programs/chewy-com/), [Impact partner postbacks](https://help.impact.com/partner/what-would-you-like-to-learn-about/platform-features/action-management/event-notifications-and-postbacks/introduction-to-postbacks-for-partners), [Embark Breeder Affiliate](https://help.embarkvet.com/hc/en-us/articles/34222040390939-Tell-me-more-about-Embark-s-Breeder-Affiliate-Program), [Purina Pro Club breeder referral](https://www.purina.ca/breeder-referral)
- Embedding: [iframe resize via postMessage](https://labs.thisdot.co/blog/using-message-events-to-resize-an-iframe), [Squarespace JS/iframe plans](https://cloutly.com/blog/add-google-reviews-to-squarespace/)
