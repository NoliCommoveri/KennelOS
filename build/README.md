# build/ — edition assembly

KennelOS ships as three editions off one shared core (see the top-level `README.md`).
There is no bundler or transpiler — the only build step is this small **assemble**
script, which produces a servable, deployable directory per edition.

## Run it

```
node build/assemble.mjs          # assemble all editions -> dist/lite, dist/pro, dist/demo
node build/assemble.mjs lite     # just one
```

`dist/` is git-ignored; it's an output, not source.

## What it does (per edition)

1. **Copy** `shared/` → `dist/<edition>/`. The artifact is shaped exactly like the app
   (root `index.html`, `pages/`, `data/`, `assets/`, `sw.js`), so every existing
   relative path and inter-page link keeps working — this is what Option B buys us
   (no cross-directory link rewrites).
2. **Overlay** `<edition>/editionConfig.js` → `dist/<edition>/data/editionConfig.js`.
   This is the injection point (cap spec §8): Lite's copy carries the reduced nav +
   feature flags; Pro/Demo carry the full/no-op copy. **Pro's build therefore contains
   no cap logic** — the whole point of the editions model.
3. **(Lite only) Exclude** the Pro-only pages listed in `shared/data/proPages.js`
   (`PRO_ONLY_PAGES` + `PRO_ONLY_STANDALONE`) — the `.html`, its `.js` sibling, and the
   standalone Companion/Assistant shells. There is nothing to unlock because the files
   aren't there.
4. **Regenerate** `dist/<edition>/sw.js`: an edition-specific `CACHE_NAME`
   (`kennelos-<edition>-shell-v1`) and a `PRECACHE_URLS` list filtered to the files that
   actually exist in the artifact (so `cache.addAll`, which is atomic, can never fail on
   an excluded path).

## Deploy

Each edition deploys to **its own origin** (a subdomain), so its IndexedDB stays
isolated (editions plan). Point each origin's web root at the matching `dist/<edition>/`.

## Two source-of-truth files — keep them true

- **`shared/data/proPages.js`** — the canonical Pro-only page list. Drives both this
  build's Lite exclusions *and* runtime gating of in-app links to Pro pages (e.g. the
  Import/Export CSV dropdown). Add a page here when it becomes Pro-only.
- **`shared/sw.js`** — the shared/Pro service worker and the precache source the Lite
  `sw.js` is generated from. Edit this one; never hand-edit a `dist/*/sw.js` (it's
  regenerated). When you add/remove an app file, update `shared/sw.js`'s `PRECACHE_URLS`
  as usual — the assembler carries the change into every edition.
