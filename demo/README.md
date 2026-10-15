# demo/ — KennelOS Demo (seeded, read-only showcase)

The Pro feature set in demo mode: seeded with sample data on load, every write a friendly
no-op, no cloud (`cloudUrl: null`). The build leaves out Import/Export, Settings and the
Assistant console (`DEMO_EXCLUDED_PAGES` in `build/assemble.mjs`).

- `editionConfig.js`: `demoMode: true`, Pro feature flags, nav without Import/Export,
  `liveSync: false`.

How it works: the guide's §0.2 (`docs/End_State_Design_and_Maintenance_Guide.md`).
Why: the Editions Plan's Demo section.
