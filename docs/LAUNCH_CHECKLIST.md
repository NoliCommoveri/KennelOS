# KennelOS — launch checklist

The steps to take the three editions (Lite / Pro / Demo) live. Grounded in the
actual repo: file paths and the current placeholder values are named inline.
`[!]` marks something still unset/placeholder in the code today.

The deploy mechanism is `.github/workflows/deploy.yml` (push to `main` → assemble
all three → publish to `kennelos-{lite,pro,demo}`); see `build/README.md`.

---

## 1. Code freeze (in `nolicommoveri/kennelos`, before merging to `main`)

- [x] **`licenseGate: true` is restored in `pro/editionConfig.js`** — it was
  temporarily `false` so `pro.kennelos.app` stayed browsable for live testing;
  that window is closed and Pro gates on a key again. **Consequence to finish
  before/with the next Pro deploy:** the wall is the only way in, so Pro is
  unusable until the Lemon Squeezy store below is live with **License Keys
  enabled** and `licenseConfig.checkoutUrl` points at the real checkout —
  otherwise a visitor gets an activation wall with no key to enter and a dead
  buy link. Live testing of Pro from here on needs a real key (activate, then
  Import/Export → *This device's license* → Release when done).
- [x] **`--release` is restored in `.github/workflows/deploy.yml`** — the guard fails
  a deploy again instead of only warning. Restored alongside the pay gate, because a
  placeholder `checkoutUrl` is no longer a dead link on a browsable app — it would be
  a dead link on the wall standing between a visitor and the whole app. All five
  matrix legs (lite/pro/demo/furever/site) were verified to pass `--release` locally.
  **It scans `editionConfig` only** — the `site/` links below are NOT covered.
- [ ] **`[!]` Swap Lite placeholders** — `lite/editionConfig.js`:
  - [x] `upgradeUrl` — **decided: it stays `https://kennelos.app/upgrade`**, the built
    marketing landing page, rather than pointing straight at a Lemon Squeezy variant.
    That page explains the export/import bridge and offers all three tiers, which a
    single per-variant checkout link cannot. It is therefore a final value, not a
    placeholder, and its entry is trimmed from `LAUNCH_PLACEHOLDERS`. **This makes the
    `site/` checkout links below load-bearing for Lite's whole upgrade funnel.**
  - `demoUrl` (`https://demo.kennelos.app/`) → confirm it's the final Demo origin.
- [ ] **`[!]` Confirm Pro license config** — `pro/editionConfig.js` `licenseConfig`:
  - [x] `checkoutUrl` → **`https://kennelos.app/pro.html#pricing`**, the all-tiers
    pricing section, deliberately *not* a single Lemon Squeezy variant link. One config
    slot feeds both walls — "Buy Pro →" (activation) and "Renew Pro →" (renewal) — so a
    direct variant URL is right for at most one visitor: it would push a lapsed monthly
    subscriber at a $69.99 one-time purchase, or a lifetime owner at a subscription.
    The per-variant links live on that page, one per tier. The old placeholder's entry
    is trimmed from `LAUNCH_PLACEHOLDERS` in `build/assemble.mjs` — mandatory, not
    tidying: the guard matches by substring and `…lemonsqueezy.com/checkout` is a
    **prefix** of every real `…/checkout/buy/<uuid>` URL, so leaving it listed would
    fail every `--release` build forever.
  - `portalUrl` (currently `null`) → set if you offer "Manage subscription", else leave null.
  - **Confirm `yearlyVariantPattern` / `lifetimeVariantPattern`** against your actual Lemon
    Squeezy variant names — the offline grace window (yearly 7d / monthly 3d / lifetime =
    perpetual) depends on these matching the `variant_name` the API returns. The current
    values (`year|annual`, `lifetime|perpetual`) match the tier names the site advertises
    (Monthly / Yearly / Lifetime), so they are probably already right — but the store's
    internal variant names are what actually get matched, and only you can see those. A
    miss is quiet and costly: a yearly key silently falls back to the *monthly* 3-day
    window, and a lifetime key would be treated as a lapsing subscription.
- [ ] **`[!]` Swap the marketing-site placeholders** — `site/` (full list in
  `site/README.md`). These are **not** covered by the `--release` guard (it only scans
  edition configs), so nothing will stop a deploy shipping them:
  - [x] **The six Lemon Squeezy checkout links** (`site/pro.html`,
    `site/upgrade/index.html`) — **seeded with the real per-variant URLs**, one per tier
    on each page: Monthly → `…/buy/4b39c78a-…`, Yearly → `…/buy/98c334e0-…`, Lifetime →
    `…/buy/7f92ce7d-…?enabled=1945407%2C1945410`. These six are the entire Lite→Pro
    funnel (Lite's `upgradeUrl` → `/upgrade`) *and* the destination of Pro's own walls,
    and `--release` does **not** guard them — verify all six by hand after deploy (§4).
  - [x] `admin.kennelos@gmail.com` → the real support address (`about.html`, `faq.html`, `upgrade/index.html`).
  - The placeholder "Who we are" story in `site/about.html`.
  - Drop the "Furever is in active development" line in `site/furever.html` once that origin is live.
  - Re-check the prices/tiers on `site/pro.html` against the live Lemon Squeezy variants.
- [ ] **Bump `CACHE_NAME`** in `shared/sw.js` once per shippable batch (clients only pick up
  changed files when it rolls over). The assembler carries the number into every edition.
- [ ] `node --test` → green.
- [ ] `node build/assemble.mjs --release` → **succeeds** (i.e. no launch placeholders remain).
  Until the swaps above are done this FAILS by design — that's the guard working.

> The launch guard: `assemble.mjs` refuses a `--release` build (which the deploy workflow
> uses) while any value in its `LAUNCH_PLACEHOLDERS` list is still present. A plain dev
> build only warns. Trim an entry from that list once its real value has landed.

## 2. External services

- [ ] **Domain** — own `kennelos.app`; DNS `CNAME` records for `lite.` / `pro.` / `demo.` /
  `furever.` pointing at their GitHub Pages sites, plus the **apex** `kennelos.app` for the
  marketing site — an apex needs GitHub's `A`/`AAAA` records (a `CNAME` isn't legal at the
  apex), optionally with `www.` as a `CNAME` alongside.
- [ ] **Lemon Squeezy** — store live; product with monthly/yearly (and lifetime, if sold)
  variants **named to match the regex patterns** in Pro's config; **License Keys enabled**
  on the product; checkout's **post-purchase redirect → `https://pro.kennelos.app/`** so an
  upgrader lands there to activate + import their exported backup.
- [ ] **Set each variant's activation limit** — this is the only thing that resists casual
  key-sharing, and it's a store setting, not app code. Not 1: `site/faq.html` promises
  breeders a phone *and* a computer, and each browser profile is its own activation.
  The app can release a slot (Import/Export → *This device's license*), so a limit is
  recoverable — but pick a number that leaves room for ordinary re-installs.
- [ ] **Dropbox app console** — *Scoped access*, access type **App folder**, permissions
  `files.content.write` + `files.content.read` (see the header comment in
  `shared/data/dropbox.js`). **Lite ships no Dropbox at all** (`assistant: false`, and
  `assistant.html` is in `PRO_ONLY_STANDALONE`), so it needs nothing here. **Demo is not
  Dropbox-free** despite what this line used to claim: `demo/editionConfig.js` sets
  `assistant: true` and the Demo build ships `assistant.html`, so its Connect button is
  live — either register its URI below or flip Demo's `assistant` flag off.
- [ ] **Redirect URIs** — the URI is `location.origin + location.pathname`
  (`dropboxRedirectUri()`), matched **exactly** by Dropbox, so every page that can start
  an auth flow needs its own entry, character-for-character:

  | | URI |
  |---|---|
  | Pro (prod) | `https://pro.kennelos.app/pages/import-export.html` |
  | Pro (prod) | `https://pro.kennelos.app/assistant.html` |
  | Pro (prod) | `https://pro.kennelos.app/pages/assistant.html` — the Assistant console (Sharing hub) |
  | Demo (prod) | `https://demo.kennelos.app/assistant.html` — only if Demo keeps `assistant: true` |
  | dev, source | `http://localhost:8000/shared/pages/import-export.html` |
  | dev, source | `http://localhost:8000/shared/assistant.html` |
  | dev, source | `http://localhost:8000/shared/pages/assistant.html` |
  | dev, built | `http://localhost:8000/dist/pro/pages/import-export.html` |
  | dev, built | `http://localhost:8000/dist/pro/assistant.html` |
  | dev, built | `http://localhost:8000/dist/pro/pages/assistant.html` |

  Exact-match means `127.0.0.1` is a *different* entry from `localhost`, and a different
  dev port (`npx serve`) is a different entry again — add whichever you actually browse.
- [ ] **`APP_KEY`** (`shared/data/dropbox.js`) matches the app console's *App key*. It's a
  public PKCE client id, safe in the repo — but changing Dropbox accounts means a new app
  and a new key, and **every connected device must reconnect** (refresh tokens are issued
  per-app) while the previous app folder's files stay behind. Never paste an `sl.…` access
  token here: the app mints its own tokens per user and has no slot for one.

## 3. Deploy infrastructure (per `build/README.md`)

- [ ] Five publish repos exist: `NoliCommoveri/kennelos-{lite,pro,demo}`,
  `NoliCommoveri/KennelOS-Furever` **and** `NoliCommoveri/kennelos-site` (the marketing
  website at the apex domain) — build output only, never hand-edited; each is
  overwritten on every deploy. **`[!]` `kennelos-site` is new with the `site/` build:
  create it, or its `deploy.yml` leg fails on push (the others still publish).**
- [ ] **`EDITIONS_DEPLOY_PAT`** secret set in `nolicommoveri/kennelos` — a fine-grained PAT
  with `Contents: Read/Write` scoped to all five repos above. **`[!]` Historically missing
  write access to `KennelOS-Furever`** — its deploy job 403'd on push (`furever/README.md`).
  The furever matrix leg is present and enabled in `deploy.yml`, so it publishes
  automatically once the PAT has write access to `KennelOS-Furever`; until then that one
  leg fails while lite/pro/demo still publish (fail-fast: false). The other three repos
  need the same scope confirmed.
- [ ] Each publish repo: Pages source = `main` / root, custom domain = its subdomain,
  **Enforce HTTPS on**.
- [ ] Merge to `main` → `deploy.yml` assembles (`--release`) and force-publishes all three.

## 3a. Cloud backup production (Cloud Phase 1 plan §6.7, §9 step 6)

The cloud API is **not** deployed by `deploy.yml`. Until every box here is ticked, Lite and
Pro ship with `cloudUrl: null` and no cloud UI appears. Do these in order.

- [ ] **Staging is current:** staging's `/ops` (`kennelos-api-staging.admin-kennelos.workers.dev/ops`)
  shows no pending or drifted migration (`0004_device_erase` is the newest), and a live
  check from a browser that can reach it (`?cloud=staging` on Lite and Pro) passes: sign
  in, back up, restore on a second browser, restore as of, a lost-device erase, and delete.
- [ ] **Cloudflare (dashboard, plan §6.7 step 6):** the `kennelos.app` zone on Cloudflare DNS
  (GitHub Pages records **DNS-only**, so Pages still serves the editions); the Workers
  Paid plan.
- [x] **Production D1 `kennelos-api`** created; its id is in `cloud/wrangler.toml` →
  `[[env.production.d1_databases]]` → `database_id`.
- [ ] **Production R2 `kennelos-files`** created.
- [ ] **Production Worker** via a second Workers Builds connection on this repo: root
  directory `cloud/`, deploy command `npx wrangler deploy --env production`. It creates the
  `kennelos-api` Worker and the **`api.kennelos.app`** custom domain from the config.
- [ ] **Secrets on the production Worker:** `OPS_TOKEN` (new, not staging's),
  `EMAIL_HMAC_KEY` (**generate a new one, store it in the password manager first, then
  paste; it is permanent**: rotating it orphans every account), `RESEND_API_KEY`.
- [ ] **Resend:** `kennelos.app` verified (DKIM + SPF records in Cloudflare DNS), sender
  `signin@kennelos.app`.
- [ ] **`api.kennelos.app/ops`:** sign in with production's `OPS_TOKEN`, press **Apply
  pending**, then Health shows every binding and secret present and no pending migration.
  Send yourself a code from a real address and confirm it arrives (not in spam).
- [ ] **D1 export:** download the first export from `/ops` and keep it with the password
  manager's KennelOS entries.
- [ ] **Go live:** merge the go-live change. It sets `cloudUrl: 'https://api.kennelos.app'`
  in `lite/` and `pro/editionConfig.js` and rewrites the marketing site's "no accounts, no
  cloud" claims, adding `kennelos.app/privacy.html`. That merge deploys the editions and the
  site together.
- [ ] **Smoke test on the real origins:** in Lite and Pro, turn on cloud backup with a real
  email; back up; open the other origin's app (or a second browser) and **sign in and
  restore**; Your devices lists both; erase one and reopen it (wiped); delete the cloud data.
  Demo shows no cloud wording and makes no request to `api.kennelos.app`.

## 4. Post-deploy smoke test (on the real origins)

- [ ] **Lite** (`lite.kennelos.app`) — reduced nav; create dogs → the 7th is blocked with the
  upgrade nudge; **"Upgrade to Pro →" reaches the real checkout**; **"See the full app ↗"**
  reaches Demo; **restoring a >6-active-dog backup is rejected** with the message and nothing
  is written; a ≤6 backup restores; Pro-only page URLs 404; works offline after first load.
- [ ] **Pro** (`pro.kennelos.app`) — activation wall on first load; a **real license key
  activates**; the full app renders; it survives offline within the grace window; a lapsed or
  revoked key shows the renewal wall.
- [ ] **Pro activations** (against the real store, once a key exists) — the activation appears
  in the Lemon Squeezy dashboard under the **name typed on the wall**, not a generic string;
  **Import/Export → "This device's license" → Release** makes it disappear there and drops this
  browser back to the activation wall; the freed slot is re-usable; and **deactivating an
  instance in the dashboard** walls that device on its next load.
- [ ] **Demo** (`demo.kennelos.app`) — auto-seeds on first load; read-only banner; writes are
  blocked with the friendly notice; `import-export.html` 404s.
- [ ] Each edition installs as a PWA with the correct name/icon/title; each origin has its own
  isolated IndexedDB.
- [ ] **Marketing site** (`kennelos.app`) — every page loads; the nav works on mobile; each
  "Get the app" button reaches the right origin; **all six checkout links reach the correct
  Lemon Squeezy variant — click each and confirm the product name and price on the checkout
  match the tier button you pressed** (nothing in the build checks this, and a wrong link
  charges the wrong amount); `kennelos.app/upgrade` resolves (it's the target of Lite's
  Upgrade button) and `kennelos.app/pro.html#pricing` lands on the pricing section (it's the
  target of Pro's activation and renewal walls); a bad URL shows the styled 404; and it does
  **not** offer to install as an app (no manifest/service worker — that's on purpose).

## 5. Recurring (every subsequent release)

- [ ] Bump `shared/sw.js` `CACHE_NAME` for the batch.
- [ ] `node --test` green; `node build/assemble.mjs --release` succeeds.
- [ ] Keep the docs true (per CLAUDE.md): editions docs + End-State guide for structural changes.
