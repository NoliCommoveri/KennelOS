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
- [ ] **Bump `CACHE_NAME`** in `shared/sw.js` once per shippable batch (clients only pick up
  changed files when it rolls over). The assembler carries the number into every edition.
- [ ] `node --test` → green.
- [ ] `node build/assemble.mjs --release` → **succeeds** (i.e. no launch placeholders remain).
  Until the swaps above are done this FAILS by design — that's the guard working.

> The launch guard: `assemble.mjs` refuses a `--release` build (which the deploy workflow
> uses) while any value in its `LAUNCH_PLACEHOLDERS` list is still present. A plain dev
> build only warns. Trim an entry from that list once its real value has landed.

## 2. External services

- [ ] **Domain** — own `kennelos.app`; DNS `CNAME` records for `lite.` / `pro.` / `demo.`
  pointing at the three GitHub Pages sites.
- [ ] **Lemon Squeezy** — store live; product with monthly/yearly (and lifetime, if sold)
  variants **named to match the regex patterns** in Pro's config; **License Keys enabled**
  on the product; checkout's **post-purchase redirect → `https://pro.kennelos.app/`** so an
  upgrader lands there to activate + import their exported backup.
- [ ] **Dropbox app console** (Pro only — Lite/Demo ship no Dropbox/Assistant) — add the
  production **redirect URIs** for the deployed `import-export.html` and `assistant.html`
  on `pro.kennelos.app`; keep the `http://localhost:8000/…` entries for dev. App-folder
  access type (see the header comment in `shared/data/dropbox.js`).

## 3. Deploy infrastructure (per `build/README.md`)

- [ ] Four publish repos exist: `NoliCommoveri/kennelos-{lite,pro,demo}` **and**
  `NoliCommoveri/KennelOS-Furever` (build output only — never hand-edited; each is
  overwritten on every deploy).
- [ ] **`EDITIONS_DEPLOY_PAT`** secret set in `nolicommoveri/kennelos` — a fine-grained PAT
  with `Contents: Read/Write` scoped to all four repos above. **`[!]` Historically missing
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
- [ ] **Demo** (`demo.kennelos.app`) — auto-seeds on first load; read-only banner; writes are
  blocked with the friendly notice; `import-export.html` 404s.
- [ ] Each edition installs as a PWA with the correct name/icon/title; each origin has its own
  isolated IndexedDB.

## 5. Recurring (every subsequent release)

- [ ] Bump `shared/sw.js` `CACHE_NAME` for the batch.
- [ ] `node --test` green; `node build/assemble.mjs --release` succeeds.
- [ ] Keep the docs true (per CLAUDE.md): editions docs + End-State guide for structural changes.
