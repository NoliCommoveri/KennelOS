# KennelOS Furever — Installable App + Cloud Backup Plan

Status: **draft for decision** (2026-10-11). Nothing here is built yet.

## Why

A family came back to Furever after a couple of months and everything was gone. Furever
keeps its data only in the phone's browser storage, and browsers delete that:

- **iPhone/iPad Safari** deletes a website's stored data after about 7 days without a visit,
  unless the site was added to the Home Screen as an app. Furever can't install as a proper
  app today (no service worker or manifest; Schema doc "Not built yet").
- **Android Chrome** may clear it when the phone runs short of space, unless persistent
  storage was granted. Furever asks, but Chrome usually says no to a site that isn't installed.

Two fixes, built in this order: make Furever a **real installable app** (most losses stop
here), then offer **optional cloud backup** for families who want their records safe across a
lost or replaced phone.

## Decided (owner, 2026-10-11)

- **A standard app, not the breeder app's privacy model.** No recovery codes, no private vault,
  no end-to-end encryption, no "the server never sees it." The server stores the family's
  backup readable, like thousands of other apps, encrypted at rest by the provider
  (Cloudflare D1/R2). That's said plainly in the privacy policy.
- **Cloud is opt-in, and nothing touches it until the family asks** (decided 2026-10-11). A
  family that never turns on cloud backup uses Furever exactly as today: all on the device,
  and **no request ever reaches our servers or Google's sign-in.** Concretely:
  - **No account is ever made for a family ahead of time**, and none sits waiting to be
    claimed. The server creates the account at the moment the family's own sign-in
    succeeds (they tapped **Turn on cloud backup**, then signed in with Google or with the
    code from their email), never before. Opening the app, installing it, or a breeder
    sending a seed link creates nothing on the server, and neither the breeder nor KennelOS
    can make an account for someone.
  - The one thing held before an account exists: with email sign-in, the pending 6-digit code
    (hashed, with a hash of the address) between "send me a code" and typing it in. It's
    deleted when used or after 10 minutes, and creates no account if they never finish.
    Google sign-in has no such step.
  - The cloud code (`furever/data/cloud/*`) and Google's sign-in library are **loaded only
    when the family taps that button**, never on app start, so a local-only family's phone
    doesn't even download them. No health check, ping, analytics or "is cloud up?" call runs
    in the background.
  - The installable-app work (Part 1) adds no server at all: the app files come from the same
    static host as today.
  - Turning cloud off again (Sign out, or Delete my cloud account) returns the app to
    local-only: no more requests, and Delete removes everything the server held.
- **Sign in with Google is the main way in**, with email for families without a Google
  account (see open question 1 for password vs. emailed code).
- **The breeder never sees a family's data.** A family's cloud backup belongs to the family's
  account only; nothing about it reaches the breeder app or the breeder's account.

## Part 1 — Installable app (no server)

1. **Web app manifest** (`furever/manifest.webmanifest`): name "Furever", standalone display,
   theme color from the default theme, icons (192, 512, maskable 512, apple-touch-icon).
2. **Service worker** (`furever/sw.js`): cache-first precache of every app file, same pattern
   and rules as `shared/sw.js` (one `PRECACHE_URLS` list, a `CACHE_NAME` bumped per shipped
   batch, a precache test like `tests/serviceWorker.test.js`). Furever then works offline.
3. **Install prompt.** Android/desktop Chrome: an "Install Furever" button using the browser's
   install event. iPhone: a short "Share → Add to Home Screen" card, shown in Safari only when
   not already installed. The existing Add-to-Home-Screen nudge settings (`settings.js`) drive
   when it shows.
4. **Keep asking for persistent storage** after install (the existing first-run request
   already does this; installed apps are usually granted it).
5. **Backup reminder** for families without cloud: "Last backup: N days ago" on At A Glance
   after 30 days, opening the existing Download backup. Saving uses the share sheet where
   the phone has one, so the file can go to Files, Google Drive or email.

## Part 2 — Cloud backup

### Accounts and sign-in
- **Sign in with Google**: Google's sign-in button (the Google Identity Services library is
  already vendored at `shared/vendor/gsi/`; Furever gets its own copy) returns a signed ID
  token; the Worker checks it against Google's public keys, the audience (our client id) and
  that the email is verified, then makes or finds the account by Google's user id. Scopes
  `openid email profile` only — no Drive access, so no Google review beyond the standard
  consent-screen branding check. Add `https://furever.kennelos.app` (and localhost) to the
  OAuth client's authorized origins.
- **Email**: see open question 1.
- One account per email: signing in with Google as an address that already has an email
  account signs in to that same account.
- **Sessions**: a bearer token kept on the device, 90 days and sliding (the breeder Worker's
  rule), revocable by "Sign out" or "Sign out everywhere".

### What's backed up and how
- **Everything** in the Furever database: pets, breeder card, family, contacts, care log,
  feeding, potty, training, documents and photos. It's the existing backup file
  (`furever/data/importExport.js`), so restore code already exists.
- **Snapshot = the backup file's JSON without the file bytes**, plus each photo/document file
  uploaded once to R2 by its sha256 (only new files upload; photos are already downscaled
  to ~1600px JPEGs). The breeder Worker's `files.js` does exactly this.
- **Automatic, once they've signed in**: after a change, the app backs up within a few minutes while it's open, and
  when it's put in the background. A "Back up now" button and "Last backed up: …" sit on
  Family & Settings.
- **Kept**: the latest backup plus one per day for the last 7 days and one per week for
  4 weeks (open question 3). Older ones and unreferenced files are deleted by a daily job.
- **Restore**: signing in on a phone with no Furever data offers "Restore your backup from
  <date>?" (pets, photos, documents counts shown). Signing in on a phone that already has
  data offers Restore (replace) or Keep this phone's data (and it becomes the backup).
- **Not live sync.** One phone backs up at a time. If another device backed up more recently
  than this one last restored, the app says so before it overwrites ("This account was last
  backed up from another phone on <date>: restore it, or replace it with this phone's?").
  Two-way sync can come later if families want it.
- **Delete account** deletes every backup and file at once.

### Server
- **Its own Worker, D1 database and R2 bucket** (decided 2026-10-11), in the same Cloudflare
  account as the breeder cloud but sharing nothing with it: family records never sit in the
  breeder database or bucket, either can be moved, deleted or restored without touching the
  other, and a fault in one can't reach the other's data.
  - Source in a new top-level `furever-cloud/` folder (beside `cloud/`), with its own
    `wrangler.toml`, `package.json`, migrations (starting at `0001_schema.sql`), tests and
    README. Deployed as its own Workers Builds project; staging and production each get their
    own Worker + D1 + R2, the same split the breeder cloud uses.
  - Names (proposed): Worker `furever-api` / `furever-api-staging`, D1 `furever` /
    `furever-staging`, R2 `furever-files` / `furever-files-staging`, served at
    `api.furever.kennelos.app` (staging on its `workers.dev` address).
  - Tables: `accounts`, `identities` (google / email), `sessions`, `snapshots`, `files`.
  - Small helpers it needs that already exist in `cloud/src/lib/` (hashing, JSON responses,
    rate limiting, sending mail through Resend) are **copied** into `furever-cloud/src/lib/`
    rather than imported across, so each Worker builds and deploys on its own. Resend can use
    the same account with a Furever sending address and its own API key.
  - CORS allows only `furever.kennelos.app` (and localhost for dev). `cloud/README.md`'s rules
    carry over: a new migration is a new `.sql` file, applied files are never edited, nothing
    logs an email, code, token or request body, rate limits on sign-in.
- **Cost**: R2 storage is about $0.015 per GB per month. 1,000 families at 200 MB each is
  200 GB, about $3/month, plus D1 rows. A per-account cap (open question 4) keeps one family
  from running it up.

### Client
- `furever/data/cloud/` mirrors the breeder layout: one module talks to the network
  (`cloudApi.js`), the rest go through it (`cloudAuth.js`, `cloudBackup.js`). Pages never
  `fetch` directly. `cloudUrl: null` (local dev without a Worker, or a shutdown) hides all
  cloud UI and makes no request.
- Family & Settings gets a **Cloud backup** card. Until the family opts in it's plain local
  text and one **Turn on cloud backup** button: no cloud code loaded, no request made. The
  button loads the cloud modules and offers Sign in with Google / with email; once signed in
  the card shows "Backed up <time>", Back up now, Restore, Sign out, Delete my cloud account.
- `cloudBackup.js` only ever runs on a phone with a signed-in session; app start checks the
  device's own stored session (no request) and, without one, loads nothing cloud.

### Privacy policy and terms
A short Furever page: what's stored (everything in the app, including any contract or vet
record they upload), where (Cloudflare, US/EU), who can see it (the family; not their breeder;
KennelOS staff only to fix a problem they report), how to delete it, and that backups are kept
until they delete the account or it's inactive for N years (open question 5).

## Build order

1. Part 1 (installable app + backup reminder). Ships on its own.
2. Server: the `furever-cloud/` Worker with its own D1 + R2, Google sign-in, sessions,
   snapshot + file endpoints, retention job, tests (`cd furever-cloud && npm test`).
3. Client: sign-in, automatic backup, restore, the Family & Settings card.
4. Email sign-in, privacy page, delete account.

## Open questions

1. **Email sign-in: password, or an emailed 6-digit code?** A password is what the owner asked
   for and what families expect, but it means storing password hashes and building "forgot
   password" (an emailed reset link). An emailed code needs neither, and the breeder Worker
   has one (`cloud/src/auth.js`) to copy, so it's less to build and nothing to leak. Recommendation:
   the emailed code, since Google covers most families.
2. **Sign in with Apple** too? Many iPhone families expect it; it's optional for a web app.
   Recommendation: later, if families ask.
3. **How many backups to keep** (proposed: latest + 7 daily + 4 weekly).
4. **Storage cap per family** (proposed: 1 GB, with a warning at 80%). Free, or part of
   something paid later?
5. **Inactive accounts**: delete after how long without a sign-in (proposed: 3 years, with
   emails at 30 and 7 days before)?
