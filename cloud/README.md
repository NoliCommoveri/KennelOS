# cloud/: the KennelOS backup API

One Cloudflare Worker with a D1 database and an R2 bucket. It is the only thing that
can reach either. The editions stay on GitHub Pages and call it cross-origin; Demo
never does (`cloudUrl: null`). The design is `docs/KennelOS_Cloud_Phase1_Plan.md` §6.
This file is the map.

```
wrangler.toml          the STAGING Worker: bindings DB (D1) and FILES (R2), the .sql text rule
package.json           wrangler (dev only) and the test script; read by Workers Builds
src/index.js           router: /ops, CORS preflights, /health, the 503 gate, then the API
src/gate.js            503 {maintenance:true} until every bundled migration is applied
src/ops.js             /ops: OPS_TOKEN sign-in, migration table, Apply pending, health
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
echo OPS_TOKEN=devtoken > .dev.vars        # git-ignored
npx wrangler dev --local                   # then open http://localhost:8787/ops
```

## Deploying (operator, in the browser)

The dashboard setup is plan §6.7. In short: the D1 database and R2 bucket named in
`wrangler.toml`; the real `database_id` pasted into `wrangler.toml`; Workers Builds
connected to this repo with root directory `cloud/`; and the secrets `OPS_TOKEN` and
`EMAIL_HMAC_KEY`. Then open `/ops` on the Worker's address, sign in, and press
**Apply pending**.
