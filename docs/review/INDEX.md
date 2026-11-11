# Review findings index

The plan: [`docs/KennelOS_Review_Plan.md`](../KennelOS_Review_Plan.md).
The KennelPort seam has its own plan and its own findings, in the KennelPort repo
(`docs/KennelPort_Review_Plan.md`, `docs/review/`). Findings here live in
`docs/review/findings/KNN-<slug>.md`; each session adds its own row.

| # | Session | Branch | Date | S1 | S2 | S3 | S4 | Findings |
|---|---------|--------|------|----|----|----|----|----------|
| K1 | Schema, repos, registries, referential integrity | `claude/kennelos-data-foundation-review-ttllyu` | 2026-11-08 | 1 | 3 | 3 | 3 | [`K01-data-foundation.md`](findings/K01-data-foundation.md) |
| K2 | Backup, restore, CSV import | `ccr-71bf966b-bik7gj` | 2026-11-09 | 1 | 5 | 6 | 2 | [`K02-backup-import.md`](findings/K02-backup-import.md) |
| K3 | Cloud client: backup, sync, conflicts | `claude/kennelos-cloud-client-review-a6ti1s` | 2026-11-09 | 2 | 6 | 2 | 1 | [`K03-cloud-client.md`](findings/K03-cloud-client.md) |
| K4 | The cloud Worker | `claude/kennelos-cloud-worker-review-l5z99f` | 2026-11-09 | 0 | 6 | 3 | 5 | [`K04-cloud-worker.md`](findings/K04-cloud-worker.md) |
| K5 | Vault, licence, account identity | `claude/kennelos-k5-review-y6hzba` | 2026-11-09 | 2 | 5 | 3 | 4 | [`K05-vault-licence.md`](findings/K05-vault-licence.md) |
| K6 | Waitlist engine: positions, turns, offers | `ccr-8fd56b18-848kuq` | 2026-11-10 | 0 | 3 | 7 | 3 | [`K06-waitlist-engine.md`](findings/K06-waitlist-engine.md) |
| K6b | Picks preview, side sales, undo windows | `claude/kennelos-waitlist-review-qzhan9` | 2026-11-11 | 0 | 5 | 4 | 1 | [`K06b-picks-side-sales-undo.md`](findings/K06b-picks-side-sales-undo.md) (read only: nothing run) |
| K7 | Waitlist online: applications, public list, family pages | `ccr-30110b09-vr8rb2` | 2026-11-10 | 1 | 2 | 10 | 1 | [`K07-waitlist-online.md`](findings/K07-waitlist-online.md) |
| K8 | Family requests, pickup, transport, fees, emails | `ccr-0bd82d66-slnt65` | 2026-11-10 | 2 | 2 | 9 | 2 | [`K08-family-requests.md`](findings/K08-family-requests.md) |
| K9 | Dogs, litters, pairings, events, nudges, Today | `ccr-fbf95967-bqp6ig` | 2026-11-10 | 1 | 2 | 7 | 3 | [`K09-dogs-litters-nudges.md`](findings/K09-dogs-litters-nudges.md) |
| K10 | Money: sales, invoices, contracts, expenses, reports | `ccr-83676c8e-guqnur` | 2026-11-10 | 2 | 3 | 9 | 0 | [`K10-money.md`](findings/K10-money.md) |
| K11 | Kels and the guided tasks | — | — | — | — | — | — | — |
| K12 | Integrations, accounts, notifications | `ccr-7191f2c9-wwbh7v` | 2026-11-10 | 0 | 4 | 9 | 1 | [`K12-integrations-notifications.md`](findings/K12-integrations-notifications.md) |
| K13 | Editions, build, first run, PWA, marketing site | `ccr-4e60dfa4-04mkg9` | 2026-11-11 | 3 | 4 | 7 | 1 | [`K13-editions-build.md`](findings/K13-editions-build.md) |
| K14 | Multi-kennel, shows, identity, Companion, Furever | `ccr-0ac931f8-yhmofp` | 2026-11-11 | 1 | 7 | 8 | 2 | [`K14-scope-companion-furever.md`](findings/K14-scope-companion-furever.md) |
| K15 | UI layer: escaping, accessibility, phone, offline | `ccr-851139a8-181hty` | 2026-11-11 | 0 | 1 | 8 | 2 | [`K15-ui-layer.md`](findings/K15-ui-layer.md) |
| K16 | Consolidation | — | — | — | — | — | — | `SUMMARY.md` |

Baseline when the plan was last brought up to date (2026-11-08, `0328a3f`):
`node --test` 1639 pass, `cd cloud && npm test` 303 pass, `node build/assemble.mjs`
succeeds. (First written 2026-11-03 at 1490 / 279.)
