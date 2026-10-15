# lite/ — KennelOS Lite (free edition)

Lite ships the shared pages only, with a soft cap (6 counting dogs, 10 litters) and
archive-on-departure. Pro-only files (`shared/data/proPages.js`) are left out of the Lite
build, so they aren't there to unlock.

- `editionConfig.js`: Lite's flags (every Pro feature off, no license gate, no live sync),
  the real cap hooks, the reduced nav, and `cloudUrl` (cloud backup on).
- `editionTour.js`: Lite's guided tour: a smaller sample seed sized to the cap.

`build/assemble.mjs` puts both at their `shared/data/` paths in `dist/lite/`.

What Lite changes, and where: the guide's §0 (`docs/End_State_Design_and_Maintenance_Guide.md`).
Why: `docs/KennelOS_Lite_Pro_Editions_Plan.md` and `docs/KennelOS_Lite_Cap_Enforcement_Spec.md`.
