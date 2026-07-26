# KennelOS — launch checklist

The steps to take the three editions (Lite / Pro / Demo) live. Grounded in the
actual repo: file paths and the current placeholder values are named inline.
`[!]` marks something still unset/placeholder in the code today.

The deploy mechanism is `.github/workflows/deploy.yml` (push to `main` → assemble
all three → publish to `kennelos-{lite,pro,demo}`); see `build/README.md`.

---

## 1. Code freeze (in `nolicommoveri/kennelos`, before merging to `main`)

- [ ] **`[!]` Restore `licenseGate: true` in `pro/editionConfig.js`** — currently
  `false` so `pro.kennelos.app` is browsable for live testing ahead of a real
  Lemon Squeezy store/license. While it's off, **Pro ships fully unlocked to any
  visitor** — no activation wall at all. Flip back to `true` (and re-run/redeploy)
  once the store swaps below are done, before any real user traffic.
- [ ] **`[!]` Restore `--release` in `.github/workflows/deploy.yml`** — currently
  removed from the `Build ${{ matrix.edition }}` step so lite/pro/demo can deploy
  for live testing ahead of the real launch URLs (this bullet). While it's off, the
  launch guard only **warns** instead of failing, so a deploy can ship a dead
  Upgrade/checkout link. Put it back the moment the swaps below land, before real
  user traffic.
- [ ] **`[!]` Swap Lite placeholders** — `lite/editionConfig.js`:
  - `upgradeUrl` (`https://kennelos.app/upgrade`) → the real Lemon Squeezy checkout URL.
  - `demoUrl` (`https://demo.kennelos.app/`) → confirm it's the final Demo origin.
- [ ] **`[!]` Confirm Pro license config** — `pro/editionConfig.js` `licenseConfig`:
  - `checkoutUrl` (`https://kennelos.lemonsqueezy.com/checkout`) → the real store checkout.
  - `portalUrl` (currently `null`) → set if you offer "Manage subscription", else leave null.
  - **Tune `yearlyVariantPattern` / `lifetimeVariantPattern`** to your actual Lemon Squeezy
    variant names — the offline grace window (yearly 7d / monthly 3d / lifetime = perpetual)
    depends on these matching.
- [ ] **`[!]` Swap the marketing-site placeholders** — `site/` (full list in
  `site/README.md`). These are **not** covered by the `--release` guard (it only scans
  edition configs), so nothing will stop a deploy shipping them:
  - The six Lemon Squeezy checkout links (`site/pro.html`, `site/upgrade/index.html`) —
    currently all `https://kennelos.lemonsqueezy.com/checkout`; use the real per-variant URLs.
  - `hello@kennelos.app` → the real support address (`about.html`, `faq.html`, `upgrade/index.html`).
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
  "Get the app" button reaches the right origin; **every checkout link reaches the real Lemon
  Squeezy checkout**; `kennelos.app/upgrade` resolves (it's the target of Lite's Upgrade
  button); a bad URL shows the styled 404; and it does **not** offer to install as an app
  (no manifest/service worker — that's on purpose).

## 5. Recurring (every subsequent release)

- [ ] Bump `shared/sw.js` `CACHE_NAME` for the batch.
- [ ] `node --test` green; `node build/assemble.mjs --release` succeeds.
- [ ] Keep the docs true (per CLAUDE.md): editions docs + End-State guide for structural changes.
