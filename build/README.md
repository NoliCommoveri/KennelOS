# build/ — edition assembly

KennelOS ships as three editions off one shared core (see the top-level `README.md`).
There is no bundler or transpiler — the only build step is this small **assemble**
script, which produces a servable, deployable directory per edition.

## Run it

```
node build/assemble.mjs            # assemble every target -> dist/*
node build/assemble.mjs lite       # just one
node build/assemble.mjs furever    # the standalone Furever app (see below)
node build/assemble.mjs site       # the marketing website (see below)
node build/assemble.mjs --release  # + fail on any unresolved launch placeholder
node build/assemble.mjs --final    # the end-of-life build (see "The final build" below)
```

**Standalone apps (Furever).** `furever` is **not** an edition of the shared core —
it's a separate app built off `furever/` (its own origin + IndexedDB). It takes a
separate path (`assembleStandalone`): copy `furever/` → `dist/furever/` and vendor
Dexie beside it (from `shared/vendor/`, so still no CDN), with none of the
editionConfig-overlay / manifest-restamp / service-worker-rewrite steps below. It
has no launch placeholders, so `--release` is a no-op for it.

**Static sites (the marketing website).** `site` is not an app either — it's the public
website at the apex domain (`site/`, see `site/README.md`). Its assembly is a straight
copy (`assembleStaticSite`): no editionConfig overlay, no manifest/index restamp, no
service-worker rewrite, because it ships none of those by design (it is deliberately
not a PWA). `--release` is a no-op for it too — note that means the checkout-URL
placeholders in `site/pro.html` do **not** fail a release build; they're tracked in
`site/README.md` and the launch checklist instead.

`dist/` is git-ignored; it's an output, not source.

**`--release` (launch guard).** The edition configs carry stand-in URLs until launch
(Lite's `upgradeUrl`, Pro's `licenseConfig.checkoutUrl` — see `LAUNCH_PLACEHOLDERS` in
`assemble.mjs`). A plain build only **warns** if one is still present, so building
editions to test locally keeps working; a `--release` build **fails** on it. The deploy
workflow (`.github/workflows/deploy.yml`) passes `--release`, so a merge to `main` can't
ship a dead upgrade/checkout link. Swap the placeholders (see
`docs/LAUNCH_CHECKLIST.md`) to make a release build pass.

**Import check (every build).** After a target is assembled, `checkImports.mjs` reads
every `.js` file and every `.html` file in its `dist/` folder (vendor aside) and fails the
build if a relative static import, or a relative `<script src>`, names a file that
build doesn't have. That's how a shared page that still imports a Pro-only file shows up
before Lite ships it. Dynamic `import()`s are left out: an edition flag gates them.

**Tests before publish.** The deploy workflow's `test` job runs `node --test` (the app's
and the cloud's suites, Node 22) first; the publish matrix `needs` it, so a red test
publishes nothing.

## What it does (per edition)

1. **Copy** `shared/` → `dist/<edition>/`. The artifact is shaped exactly like the app
   (root `index.html`, `pages/`, `data/`, `assets/`, `sw.js`), so every existing
   relative path and inter-page link keeps working — this is what Option B buys us
   (no cross-directory link rewrites).
2. **Overlay** `<edition>/editionConfig.js` → `dist/<edition>/data/editionConfig.js`.
   This is the injection point (cap spec §8): Lite's copy carries the reduced nav +
   feature flags; Pro/Demo carry the full/no-op copy. **Pro's build therefore contains
   no cap logic** — the whole point of the editions model.
3. **Exclude edition-stripped pages.** *Lite* drops the Pro-only pages listed in
   `shared/data/proPages.js` (`PRO_ONLY_PAGES` + `PRO_ONLY_STANDALONE`) — the `.html`,
   its `.js` sibling, and the standalone Companion/Assistant shells. *Demo* drops the
   Import/Export page (`DEMO_EXCLUDED_PAGES` in `assemble.mjs`) — the save/export path is
   stripped so an unlocked copy is a dead end (editions plan §Demo hardening #8). In both
   cases there's nothing to unlock because the files aren't there; a direct URL 404s.
4. **Stamp the edition identity** into `dist/<edition>/manifest.json` (`name` +
   `short_name` → `KennelOS Lite` / `Pro` / `Demo`) and the root `index.html` `<title>`,
   so an installed edition reads as its own app rather than a generic "KennelOS". Names
   come from `EDITION_NAMES` in `assemble.mjs`; only those keys are touched.
5. **Regenerate** `dist/<edition>/sw.js`: an edition-specific `CACHE_NAME`
   (`kennelos-<edition>-shell-vN`, where **N is carried from the shared `sw.js` cache
   version** — so the one CLAUDE.md `CACHE_NAME` bump rolls every edition over) and a
   `PRECACHE_URLS` list filtered to the files that
   actually exist in the artifact (so `cache.addAll`, which is atomic, can never fail on
   an excluded path).

## Load check (by hand)

`node build/loadCheck.mjs` (after `node build/assemble.mjs`) opens Pro and Lite from
`dist/` in Playwright's Chromium at 390 × 800, with a program on the device (the edition's
sample packet, kept as her own records) and, in Pro, an activated license whose Lemon
Squeezy check is answered `--delay` ms late (3000 by default; no other request leaves the
machine). On Today, Dogs, a dog and a sale it prints when the nav was drawn, first paint,
the layout shift after it (and what moved most), every table read in full more than once
(counted under IndexedDB), and the store calls. `--edition pro|lite`, `--settle <ms>` (how
long to keep watching, default 2000), `--json`, and `--root <checkout>` to measure another
checkout's `dist/` the same way. It's not part of `node --test` and changes nothing; it
needs Playwright and its Chromium (`npx playwright install chromium` where they aren't
there). The numbers vary a little run to run: compare two checkouts in the same session.
What each page loads before anything runs is pinned by `tests/loadBudget.test.js`, which is
in `node --test` (Load Performance plan Phase 0).

## Deploy

Each edition deploys to **its own origin** (a subdomain), so its IndexedDB stays
isolated (editions plan). Live at:

- `lite.kennelos.app` ← `dist/lite/`
- `pro.kennelos.app` ← `dist/pro/`
- `demo.kennelos.app` ← `dist/demo/`
- `furever.kennelos.app` ← `dist/furever/` (the standalone Furever app)
- `kennelos.app` ← `dist/site/` (the marketing website, on the apex domain)

Hosting is GitHub Pages, one app per repo (GitHub Pages allows exactly one custom
domain per repo, so each subdomain needs its own repo):
[`kennelos-lite`](https://github.com/NoliCommoveri/kennelos-lite),
[`KennelOS-pro`](https://github.com/NoliCommoveri/KennelOS-pro),
[`kennelos-demo`](https://github.com/NoliCommoveri/kennelos-demo),
[`KennelOS-Furever`](https://github.com/NoliCommoveri/KennelOS-Furever), and
`kennelos-site` (the apex marketing site — apex domains need GitHub's `A`/`AAAA`
records, not a `CNAME` at the DNS level). Each publish
repo holds **only build output** — never hand-edit a file in one of them; it's
overwritten on the next deploy.

`.github/workflows/deploy.yml` in *this* repo (`nolicommoveri/kennelos`) is the deploy
mechanism: on every push to `main`, once `node --test` passes, it runs `node build/assemble.mjs <target> --release` for all
three editions plus Furever and force-publishes `dist/<target>/` (plus a generated
`CNAME` file) to `main` on the matching publish repo, via
[`peaceiris/actions-gh-pages`](https://github.com/peaceiris/actions-gh-pages) authenticated
with a single repo secret, `EDITIONS_DEPLOY_PAT` — a fine-grained PAT scoped to
`Contents: Read and write` on the publish repos. Each publish repo has GitHub
Pages enabled (Settings → Pages → source = `main` branch, root) with its custom domain
set to match the `CNAME` above and "Enforce HTTPS" on. **Adding Furever requires the PAT
to also cover `KennelOS-Furever`, and that repo to have Pages + the `furever.kennelos.app`
domain + DNS configured** — otherwise its deploy job fails while the editions still ship.

To deploy manually instead of waiting for CI: run `node build/assemble.mjs`, then push
`dist/<edition>/` as the `main` branch of the matching publish repo.

## The final build (if KennelOS ends)

The terms promise that if KennelOS ends, Lite and Pro get a final version that needs no
license key and no server of ours (`site/terms.html` §14, "If KennelOS ends"; §9, "What
lifetime means"). `--final` builds it. After the normal assembly, `finalRelease.mjs`:

- sets `cloudUrl`, `devCloudUrl`, `kennelportUrl`, `devKennelportUrl`, `upgradeUrl` and
  `demoUrl` to `null` in each edition's `editionConfig.js` (no request to any server of ours,
  no link to buy anything), and switches Pro's `licenseGate` to `false`, so Pro opens for
  anyone, with or without a key, with every on-device feature;
- adds `-final` to the edition's `CACHE_NAME`, so every installed app takes the final files the
  next time it opens online, with no manual cache bump.

It throws if a line it rewrites isn't where it expects, so a moved config fails the build.
Furever and the site are built as usual. `tests/finalRelease.test.js` pins it.

**Shutting down, in this order.** The order matters: once Lemon Squeezy stops answering, a
normal Pro build walls on its next check.

1. **Tell users.** Add a `shutdown` notice on `/ops` with the date the online service stops,
   at least **90 days** ahead (terms §14). Stop selling Pro in Lemon Squeezy. Keep the store's
   existing keys working.
2. **Ship the final build before the service stops.** Set the repository variable
   `KENNELOS_FINAL_RELEASE` to `true` (Settings → Secrets and variables → Actions → Variables)
   and run the deploy workflow. Every deploy from then on is final, so a later push can't put
   the license wall back. Check `pro.kennelos.app` opens with no key.
3. **Then the servers.** Only after the final build is live: stop the Worker, cancel what's
   left in Lemon Squeezy, close the store.
4. **Keep the final version online for at least 12 months** (terms §14). GitHub Pages costs
   nothing to leave up. A device that already has it keeps working offline after that.

## Two source-of-truth files — keep them true

- **`shared/data/proPages.js`** — the canonical Pro-only page list. Drives both this
  build's Lite exclusions *and* runtime gating of in-app links to Pro pages (e.g. the
  Import/Export CSV dropdown). Add a page here when it becomes Pro-only.
- **`shared/sw.js`** — the shared/Pro service worker and the precache source the Lite
  `sw.js` is generated from. Edit this one; never hand-edit a `dist/*/sw.js` (it's
  regenerated). When you add/remove an app file, update `shared/sw.js`'s `PRECACHE_URLS`
  as usual — the assembler carries the change into every edition.
