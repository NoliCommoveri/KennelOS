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
src/vault.js           the private vault: wraps, turn on/off, second-device pairing
                       (docs/KennelOS_Private_Vault_Plan.md §5, §6); stores only opaque strings
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
tests/                 node --test against a node:sqlite stand-in for D1
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
- **Upload a document before the snapshot that references it.** Retention gives a file a
  day's grace and then collects anything no snapshot references.
- **No `IN (?, ?, …)` over a list.** D1 allows about 100 bound parameters and the test
  stand-in doesn't enforce that. Pass the list as one JSON parameter through
  `json_each(?)` (plan §6.2).
- **Never add `not_found_handling`** if this Worker ever gets an `[assets]` block.
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
`EMAIL_HMAC_KEY` and `RESEND_API_KEY`. Then open `/ops` on the Worker's address, sign in, and press
**Apply pending**.
