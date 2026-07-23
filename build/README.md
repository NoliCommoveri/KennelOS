# build/ — edition assembly

KennelOS ships as three editions off one shared core (see the top-level `README.md`).
There is no bundler or transpiler — the only build step is this small **assemble**
script, which produces a servable, deployable directory per edition.

## Run it

```
node build/assemble.mjs            # assemble all editions + standalone apps -> dist/*
node build/assemble.mjs lite       # just one
node build/assemble.mjs furever    # the standalone Furever app (see below)
node build/assemble.mjs --release  # + fail on any unresolved launch placeholder
```

**Standalone apps (Furever).** `furever` is **not** an edition of the shared core —
it's a separate app built off `furever/` (its own origin + IndexedDB). It takes a
separate path (`assembleStandalone`): copy `furever/` → `dist/furever/` and vendor
Dexie beside it (from `shared/vendor/`, so still no CDN), with none of the
editionConfig-overlay / manifest-restamp / service-worker-rewrite steps below. It
has no launch placeholders, so `--release` is a no-op for it.

`dist/` is git-ignored; it's an output, not source.

**`--release` (launch guard).** The edition configs carry stand-in URLs until launch
(Lite's `upgradeUrl`, Pro's `licenseConfig.checkoutUrl` — see `LAUNCH_PLACEHOLDERS` in
`assemble.mjs`). A plain build only **warns** if one is still present, so building
editions to test locally keeps working; a `--release` build **fails** on it. The deploy
workflow (`.github/workflows/deploy.yml`) passes `--release`, so a merge to `main` can't
ship a dead upgrade/checkout link. Swap the placeholders (see
`docs/LAUNCH_CHECKLIST.md`) to make a release build pass.

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

## Deploy

Each edition deploys to **its own origin** (a subdomain), so its IndexedDB stays
isolated (editions plan). Live at:

- `lite.kennelos.app` ← `dist/lite/`
- `pro.kennelos.app` ← `dist/pro/`
- `demo.kennelos.app` ← `dist/demo/`
- `furever.kennelos.app` ← `dist/furever/` (the standalone Furever app)

Hosting is GitHub Pages, one app per repo (GitHub Pages allows exactly one custom
domain per repo, so each subdomain needs its own repo):
[`kennelos-lite`](https://github.com/NoliCommoveri/kennelos-lite),
[`kennelos-pro`](https://github.com/NoliCommoveri/kennelos-pro),
[`kennelos-demo`](https://github.com/NoliCommoveri/kennelos-demo), and
[`KennelOS-Furever`](https://github.com/NoliCommoveri/KennelOS-Furever). Each publish
repo holds **only build output** — never hand-edit a file in one of them; it's
overwritten on the next deploy.

`.github/workflows/deploy.yml` in *this* repo (`nolicommoveri/kennelos`) is the deploy
mechanism: on every push to `main`, it runs `node build/assemble.mjs <target>` for all
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

## Two source-of-truth files — keep them true

- **`shared/data/proPages.js`** — the canonical Pro-only page list. Drives both this
  build's Lite exclusions *and* runtime gating of in-app links to Pro pages (e.g. the
  Import/Export CSV dropdown). Add a page here when it becomes Pro-only.
- **`shared/sw.js`** — the shared/Pro service worker and the precache source the Lite
  `sw.js` is generated from. Edit this one; never hand-edit a `dist/*/sw.js` (it's
  regenerated). When you add/remove an app file, update `shared/sw.js`'s `PRECACHE_URLS`
  as usual — the assembler carries the change into every edition.
