# Review findings index

The plan: [`docs/KennelOS_Review_Plan.md`](../KennelOS_Review_Plan.md).
The KennelPort seam has its own plan and its own findings, in the KennelPort repo
(`docs/KennelPort_Review_Plan.md`, `docs/review/`). Findings here live in
`docs/review/findings/KNN-<slug>.md`; each session adds its own row.

| # | Session | Branch | Date | S1 | S2 | S3 | S4 | Findings |
|---|---------|--------|------|----|----|----|----|----------|
| K1 | Schema, repos, registries, referential integrity | `claude/kennelos-data-foundation-review-ttllyu` | 2026-11-08 | 1 | 3 | 3 | 3 | [`K01-data-foundation.md`](findings/K01-data-foundation.md) |
| K2 | Backup, restore, CSV import | `ccr-71bf966b-bik7gj` | 2026-11-09 | 1 | 5 | 6 | 2 | [`K02-backup-import.md`](findings/K02-backup-import.md) |
| K3 | Cloud client: backup, sync, conflicts | — | — | — | — | — | — | — |
| K4 | The cloud Worker | — | — | — | — | — | — | — |
| K5 | Vault, licence, account identity | — | — | — | — | — | — | — |
| K6 | Waitlist engine: positions, turns, offers | — | — | — | — | — | — | — |
| K6b | Picks preview, side sales, undo windows | — | — | — | — | — | — | — |
| K7 | Waitlist online: applications, public list, family pages | — | — | — | — | — | — | — |
| K8 | Family requests, pickup, transport, fees, emails | — | — | — | — | — | — | — |
| K9 | Dogs, litters, pairings, events, nudges, Today | — | — | — | — | — | — | — |
| K10 | Money: sales, invoices, contracts, expenses, reports | — | — | — | — | — | — | — |
| K11 | Kels and the guided tasks | — | — | — | — | — | — | — |
| K12 | Integrations, accounts, notifications | — | — | — | — | — | — | — |
| K13 | Editions, build, first run, PWA, marketing site | — | — | — | — | — | — | — |
| K14 | Multi-kennel, shows, identity, Companion, Furever | — | — | — | — | — | — | — |
| K15 | UI layer: escaping, accessibility, phone, offline | — | — | — | — | — | — | — |
| K16 | Consolidation | — | — | — | — | — | — | `SUMMARY.md` |

Baseline when the plan was last brought up to date (2026-11-08, `0328a3f`):
`node --test` 1639 pass, `cd cloud && npm test` 303 pass, `node build/assemble.mjs`
succeeds. (First written 2026-11-03 at 1490 / 279.)
