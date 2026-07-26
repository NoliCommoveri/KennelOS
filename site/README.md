# site/ — the KennelOS marketing website

The public website at the apex domain (`kennelos.app`): who we are, what the app
does, the editions comparison, a page per edition, the Furever app, an FAQ, and the
Lite → Pro upgrade landing page. Every "Get the app" button points **out** of here at
an edition's own origin.

**This is a website, not an app.** Deliberately **not a PWA**: no `manifest.json`, no
service worker, no Dexie, no offline caching. A visitor should never be prompted to
install the marketing site, and the site must never sit in a cache competing with the
real apps. That also means **`shared/sw.js`'s `PRECACHE_URLS` has nothing to do with
this folder** — the CLAUDE.md service-worker rule doesn't apply to files under
`site/`, and adding a page here never needs a `CACHE_NAME` bump.

## Layout

```
index.html        Home — what KennelOS is, features, the three editions, how to start
editions.html     The full Lite / Pro / Demo comparison table
lite.html         Lite: what's included, the limits stated plainly, what's not in it
pro.html          Pro: the added feature set, pricing tiers, how licensing works
demo.html         The read-only seeded demo
furever.html      KennelOS Furever (the free family app) + the Pro hand-off link
about.html        Who we are, what we believe, how it's funded, privacy
faq.html          Data, devices, offline, the cap, upgrading, licensing, refunds
upgrade/          Landing page for Lite's "Upgrade to Pro →" button (kennelos.app/upgrade)
404.html          GitHub Pages 404 (uses root-absolute paths — it can be served from any depth)
robots.txt        + sitemap.xml
assets/site.css   The whole design system (borrows the app's tokens from shared/assets/app.css)
assets/site.js    Mobile nav toggle + footer year. Every page works with JS off.
assets/icons/     Copies of the app icons (favicon / apple-touch)
```

Header and footer markup are **repeated inline on each page** rather than injected by
JS — a marketing page should render (and be crawlable) with no script. Eight pages of
duplication is the cheaper trade; if it grows past that, template it at build time
rather than at runtime.

## Local preview

Serve the repo root and open the folder (never `file://`):

```
python3 -m http.server 8000     # then http://localhost:8000/site/
```

The one thing that doesn't work locally is `/upgrade` as a bare path — Pages resolves
that to `upgrade/index.html`; locally use `site/upgrade/`. The `404.html` links use
root-absolute paths, so it also looks right only on the deployed origin.

## Build & deploy

`node build/assemble.mjs site` copies `site/` → `dist/site/` (that's the entire build —
no overlay, no exclusions, no service-worker rewrite). `.github/workflows/deploy.yml`
publishes `dist/site/` to `NoliCommoveri/kennelos-site` with a `CNAME` of
`kennelos.app`, exactly like the editions.

Prerequisites before that leg can succeed (see `docs/LAUNCH_CHECKLIST.md` §3): the
publish repo exists, `EDITIONS_DEPLOY_PAT` has `Contents: Read/Write` on it, Pages is
enabled with the apex custom domain, and DNS points `kennelos.app` at it (apex domains
need GitHub's `A`/`AAAA` records, not a `CNAME`).

## Placeholders to swap before launch

Marked inline with `<!-- LAUNCH PLACEHOLDER -->`. Note the assembler's `--release`
guard only scans edition configs, so **nothing here fails a release build** — these are
on you:

- **Lemon Squeezy checkout URLs** — `pro.html` (3 tiers) and `upgrade/index.html`
  (3 tiers) all point at `https://kennelos.lemonsqueezy.com/checkout`. Swap each for
  its real per-variant checkout link.
- **`hello@kennelos.app`** — `about.html`, `faq.html`, `upgrade/index.html`. Use the
  real support address.
- **The "Who we are" section** in `about.html` — a generic placeholder story, flagged
  with an HTML comment. Write the real one; it's the page people read before trusting
  you with a decade of pedigrees.
- **Furever's status** — `furever.html` says "in active development" and links to
  `furever.kennelos.app`. Drop that line once the origin is live.

## Keeping it true

The site states facts about the product — the cap numbers, what's in each edition,
prices, the grace windows. When any of those change in the app, they change here too:

- Cap numbers (`lite/editionConfig.js`) → `lite.html`, `editions.html`, `faq.html`.
- Pro-only page list (`shared/data/proPages.js`) → the comparison table in
  `editions.html` and the "not in Lite" list in `lite.html`.
- Prices / tiers / grace windows (`docs/KennelOS_Lite_Pro_Editions_Plan.md`
  §Licensing) → `pro.html`, `upgrade/index.html`, `editions.html`, `faq.html`.
