# Review findings index

The plan: [`docs/KennelOS_Review_Plan.md`](../KennelOS_Review_Plan.md).
The KennelPort seam has its own plan and its own findings, in the KennelPort repo
(`docs/KennelPort_Review_Plan.md`, `docs/review/`). Findings here live in
`docs/review/findings/KNN-<slug>.md`; each session adds its own row.

| # | Session | Branch | Date | S1 | S2 | S3 | S4 | Findings |
|---|---------|--------|------|----|----|----|----|----------|
| K1 | Schema, repos, registries, referential integrity | — | — | — | — | — | — | — |
| K2 | Backup, restore, CSV import | — | — | — | — | — | — | — |
| K3 | Cloud client: backup, sync, conflicts | — | — | — | — | — | — | — |
| K4 | The cloud Worker | — | — | — | — | — | — | — |
| K5 | Vault, licence, account identity | — | — | — | — | — | — | — |
| K6 | Waitlist engine: positions, turns, offers | — | — | — | — | — | — | — |
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

Baseline when the plan was written (2026-11-03): `node --test` 1490 pass,
`cd cloud && npm test` 279 pass, `node build/assemble.mjs` succeeds. Branch
`ccr-89772d54-uk9tma`, clean.
