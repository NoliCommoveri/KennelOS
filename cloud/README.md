# cloud/: the KennelOS backup API

One Cloudflare Worker with a D1 database and an R2 bucket. It is the only thing that
can reach either. The editions stay on GitHub Pages and call it cross-origin; Demo
never does (`cloudUrl: null`). The design is `docs/KennelOS_Cloud_Phase1_Plan.md` §6.
This file is the map.

```
wrangler.toml          the STAGING Worker: bindings DB (D1) and FILES (R2), the .sql text rule
package.json           wrangler (dev only) and the test script; read by Workers Builds
src/index.js           router: /ops, preflights, /notice, /health, the 503 gate, the API; and the cron
src/api.js             the API's routes (plan §6.1)
src/auth.js            sign-in codes, sessions, sign out
src/ratelimit.js       5 codes/hour per address, 30/hour per IP (both HMAC'd)
src/mail.js            sending a code through Resend; without a key, staging's DEV_OUTBOX shows it on /ops
src/files.js           content-addressed files; R2 verifies the sha256
src/snapshots.js       describe → (vault part) → upload body → commit, with the 409 rule at both
                       steps and, while the program has a vault, the vault_required rule
src/program.js         program state, takeover, delete account
src/devices.js         the device check-in and list, remote erase, Pro-license bookkeeping (plan §2.5)
src/vault.js           the private vault: wraps (recovery, passkeys), turn on/off, second-device
                       pairing (docs/KennelOS_Private_Vault_Plan.md §5, §6); stores only opaque
                       strings. A passkey wrap keeps its credential id and PRF salt; the server
                       never verifies a WebAuthn assertion
src/license.js         the Pro license link (docs/KennelOS_License_Link_Plan.md): Lemon Squeezy's
                       signed webhook, the account's entitlement, requirePro for W2's routes,
                       linking another purchase email by code
src/waitlist.js        the waitlist online, her side (docs/KennelOS_Waitlist_W2_Plan.md): publish /
                       read / take offline a kennel's projection (status-page tokens move to
                       wl_tokens), the encrypted inbox and its ack, the events stream. Pro only
                       (requirePro); writes from the backing device only
src/familyPages.js     the waitlist's family pages: serves public/family/ for /list/<public_id> and
                       /s/<token> (ASSETS binding), their same-origin JSON under /f/ (the public
                       list, one family's status view, See Your Details: a code by email, then
                       a 90-day family session for that browser, and the online application
                       form: its JSON, and a sealed application held until the applicant
                       types the emailed code)
src/familyActions.js   what a signed-in family does on their status page (POST /f/act, /f/message):
                       each action checked against her published list and recorded as an
                       event; a picked pup held (wl_holds) until her device's next publish says
                       it applied the pick (events_through); messages sealed to her key, into
                       the inbox
src/notice.js          service notices (public /notice; set on /ops)
src/retention.js       the daily prune and GC; pickDrops is the pure rule
src/backup.js          /ops export/import of the D1 rows (not R2)
src/gate.js            503 {maintenance:true} until every bundled migration is applied
src/ops.js             /ops: sign-in, migrations, health, outbox, notices, retention, export/import
src/migrate.js         the runner (ported from MCCE): status, drift, atomic apply
src/health.js          bindings, secrets present, schema version, row counts
src/lib/cors.js        the allowed origins (Lite, Pro, localhost)
src/lib/sql.js         statement splitter (ported verbatim from MCCE)
src/migrations/        NNNN_name.sql files + index.js, the ordered list the runner reads
public/family/         the family pages' static files (no build step; strict CSP, so no inline
                       script or style); tests/familyPages.test.js in the repo root pins their labels
tests/                 node --test against a node:sqlite stand-in for D1;
                       tests/helpers/serve.mjs runs the Worker locally to look at the pages
```

## Rules that bite

- **Adding a migration = a new `.sql` file AND its line in `src/migrations/index.js`.**
  On production an applied file is never edited (its checksum is how drift is
  measured). Rules for writing one are at the top of `index.js`.
- **After a deploy that adds a migration, the API answers 503 until someone presses
  Apply pending on `/ops`.** That's deliberate (plan §6.1).
- **Never log** an email address, a code, a token or a request body (plan §6.4).
- **`DEV_OUTBOX = "1"` is staging-only.** The production Worker's config must not carry it.
- **With a vault, a snapshot's vault part lands before its body.** `PUT /snapshots/:id/vault`
  first, then the body PUT commits; the server refuses a snapshot without a vault part
  (or under a replaced key) while the program has a vault. The part is stored at
  `snapshots/<program>/<id>.vault`, and retention, discard and account deletion remove it
  with its snapshot.
- **The Lemon Squeezy webhook keeps hashes, never addresses or keys.** `POST
  /webhooks/lemonsqueezy` is verified by HMAC over the raw body before anything is parsed,
  stores a purchase under the keyed hash of its email, and drops the address. The
  `license_key_*` events carry the full license key: they are not subscribed, and ignored
  if they arrive. Configured by the `LEMONSQUEEZY_WEBHOOK_SECRET` secret and the `LS_*`
  vars in `wrangler.toml`; until they're set it answers 503 and `/ops` says what's missing.
  `/ops`'s one-off **Import from Lemon Squeezy** backfills purchases made before the webhook,
  with a short-lived LS API key that is sent only to `api.lemonsqueezy.com` and never kept.
- **Waitlist writes come from the backing device only** (publish, take offline, inbox ack),
  so one application never becomes two families. A projection is stored without its
  `status_token`s: they move to `wl_tokens`, and one missing from a later publish is revoked.
  A kennel's `public_id` belongs to the first program that publishes it (`409 kennel_taken`).
- **An application reaches her only once confirmed.** `/f/apply` stores it with
  `confirmed_at` NULL; the inbox never returns it until the applicant types the emailed code,
  and retention drops it (and its token) after two days. A publish never deletes the token of
  an application her device hasn't taken in. Production needs `TURNSTILE_SECRET` and
  `TURNSTILE_SITE_KEY` before the form opens there (`503 form_unavailable` until then).
- **An inbox item outlives its ack.** Retention removes an application or family message only
  when it was acknowledged 30+ days ago AND a committed snapshot with a vault part was made
  after the ack; an unacknowledged one never. `GET /waitlist/inbox?all=1` re-fetches them.
- **Upload a document before the snapshot that references it.** Retention gives a file a
  day's grace and then collects anything no snapshot references.
- **No `IN (?, ?, …)` over a list.** D1 allows about 100 bound parameters and the test
  stand-in doesn't enforce that. Pass the list as one JSON parameter through
  `json_each(?)` (plan §6.2).
- **The `[assets]` block serves files only through the Worker** (`run_worker_first`), so /ops and
  the API are never shadowed. Never add `not_found_handling`, and keep `html_handling = "none"`.
  A family page carries a bearer token in its address: keep `no-referrer` on it and its JSON.
- Not part of any edition: no `shared/sw.js` precache entries, and `deploy.yml`
  never touches it.

## Running it locally

```
cd cloud
npm install
npm test
printf 'OPS_TOKEN=devtoken\nEMAIL_HMAC_KEY=devkey\n' > .dev.vars   # git-ignored
npx wrangler dev --local --test-scheduled  # /ops at http://localhost:8787/ops;
                                           # /__scheduled fires the cron
```

## Deploying (operator, in the browser)

The dashboard setup is plan §6.7. In short: the D1 database and R2 bucket named in
`wrangler.toml`; the real `database_id` pasted into `wrangler.toml`; Workers Builds
connected to this repo with root directory `cloud/`; and the secrets `OPS_TOKEN`,
`EMAIL_HMAC_KEY`, `RESEND_API_KEY` and (for the Pro license link) `LEMONSQUEEZY_WEBHOOK_SECRET`,
with the Lemon Squeezy ids in the `LS_*` vars (License Link Plan §7). Then open `/ops` on the Worker's address, sign in, and press
**Apply pending**.
