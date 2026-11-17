# KennelOS — Security hardening: plan

> Status: **plan, nothing done.** Make KennelOS harder to copy and reverse engineer: stop
> publishing the source and its documentation, ship code that's hard to read, keep whatever is
> worth protecting on the server, and have clear legal grounds against copies. Open decisions
> are in §8.

## 1. Where things stand

- **The source repo, `NoliCommoveri/KennelOS`, is public.** Anyone can read and clone the
  whole app, the cloud Worker (routes, `/ops`, the manager app, every migration), every plan
  and spec, the End-State guide (a complete manual for the code), the build log and
  `CLAUDE.md`.
- **The publish repos** (`KennelOS-lite`, `-pro`, `-demo`, `-Furever`, `-site`) are public,
  because GitHub Pages on a free plan serves only public repos. Their history holds every
  build ever deployed.
- **No repo has a `LICENSE` file**, and `site/terms.html` doesn't forbid copying, redistributing
  or reverse engineering. Copyright still applies by default, but nothing says so.
- **The shipped code is the source as written:** about 102,000 lines of app JavaScript, about
  18,600 of them comments that explain why each part works and which plan it follows.
- **What's already right:** no server secret is in the app (Firma's key, the ops token and
  the signing secrets are Worker secrets); the Worker rate-limits and logs no emails, codes,
  tokens or bodies; Lite doesn't ship Pro's pages; Pro's license check runs in the browser
  with an honest "stops ~99%" caveat.

**The limit to be honest about:** code that runs in a browser can always be read by someone
determined. The goals are to stop handing out the blueprint, make the shipped code costly to
understand, keep what matters on the server, and make copying clearly unlawful.

## 2. Make the source repo private

The single biggest step, and nearly free.

1. **Scan for secrets first** (GitHub secret scanning, or a scan of the full history). Any
   secret ever committed is treated as leaked and **rotated**, whatever the repo's visibility
   afterwards.
2. **Check what depends on it being public:** nothing in the code links to its raw files.
   Things that read it with their own access keep working once it's private: the deploy
   workflow (it pushes builds with `EDITIONS_DEPLOY_PAT`), Cloudflare Workers Builds (its
   GitHub app), and Claude Code sessions. Check KennelPort's sessions or docs, if they read
   KennelOS's docs from GitHub.
3. **GitHub Actions minutes:** private repos get a limited number of free minutes a month.
   Check that the `test` and `deploy` jobs per merge fit, or trim them (e.g. skip Furever
   and site builds when their folders didn't change).
4. **Forks:** if the repo has public forks, they stay public after the switch. Check the forks
   list first.
5. **Settings → General → Danger zone → Change visibility → Private.**

What's already out (clones, forks, caches) can't be called back. This stops exposure from now on.

## 3. Licenses and terms

- A proprietary `LICENSE` in every repo: "Copyright © KennelOS. All rights reserved. No
  license is granted to copy, modify, distribute or host this software."
- A section in `site/terms.html`: no copying, redistributing, hosting copies, reverse
  engineering, or getting around license, credit or edition checks.
- The point is recourse: a clear license and terms make a **DMCA takedown** of a copy on
  GitHub or another host straightforward.

## 4. Ship minified code

- A **minify step in `build/assemble.mjs` for `dist/` only**, with esbuild or terser: comments
  removed, whitespace removed, local names shortened. **One output file per source file, no
  bundling**, export names kept, so the multi-page ES-module structure, the service worker's
  paths and dynamic imports all stay as they are.
- **No source maps** published.
- **The source stays as it is:** no build step for development, tests still run on the source
  with no dependencies. The minifier is a dependency of the deploy only, and `--release`
  builds run it.
- **Checks:** `build/checkImports.mjs` runs on the minified output, and a browser test loads
  each edition's main pages from `dist/` with no console errors before publishing.
- **Costs:** the first build-time dependency; error reports from users point into minified
  files (kept traceable by recording which build a device runs, already known from
  `CACHE_NAME`).
- **Full obfuscation** (e.g. javascript-obfuscator) goes further but makes files bigger and
  slower and can break things. At most for the license and entitlement modules, if ever.

## 5. Host the editions off public repos

- **Cloudflare Pages:** the deploy workflow uploads each `dist/<edition>/` directly (a
  Cloudflare API token as an Actions secret). Free, the same custom domains, and the publish
  repos can be made private or deleted. KennelOS already runs on Cloudflare for the Worker.
- **Or GitHub Pages from private repos:** needs a paid GitHub plan.
- Either way the site still serves the code it runs; this only stops browsing the full tree
  and its build history on GitHub. It's worth doing with §4, and a smaller step than §2.
- A hosting move touches DNS, the deploy workflow and `build/README.md`'s deploy section, and
  each edition must keep its own origin (its own IndexedDB).

## 6. Keep what's worth protecting on the server

The credits plan (`docs/KennelOS_Credits_Plan.md` §7) is built around this:
- Credits are a server-side ledger; every spend happens on the Worker.
- The device holds only an **entitlement token the server signed** (ECDSA P-256), so editing
  browser storage can't grant anything.
- **Feature packs:** code for a feature a Lite program hasn't paid for is never on its device;
  the Worker serves it only to an entitled program.
- Every paid server action (e-sign, family pages, sync, support) checks the database, never
  the device's word.

The same principle applies to future work: when a feature is valuable enough to protect,
put the part that matters behind the Worker.

## 7. Not worth doing

Detecting the browser's developer tools, anti-debugging tricks, or encrypting the JavaScript.
All are easy to get around, hurt speed and offline use, and trouble real users more than
anyone copying the app.

## 8. Order and decisions

**Order:** §2 and §3 first (mostly settings, an afternoon), then §4, then §6 with the credits
plan. §5 when hosting is revisited, ideally alongside §4.

| # | Question | Status |
|---|---|---|
| S1 | Make `NoliCommoveri/KennelOS` private | Proposed, after the secret scan and checks in §2 |
| S2 | Proprietary LICENSE files and a terms section | Proposed |
| S3 | Minify `dist/` in the release build | Proposed: esbuild or terser, per file, no bundling, no source maps |
| S4 | Move edition hosting to Cloudflare Pages, or pay for private GitHub Pages | Open |
| S5 | Obfuscate the license and entitlement modules | Not now |
| S6 | Keep `site` and Furever's publish repos public | Open (the marketing site has nothing to protect) |
