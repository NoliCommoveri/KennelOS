# pro/ — KennelOS Pro (paid edition)

Pro is the whole app in `shared/`, behind a Lemon Squeezy license gate. Its no-op cap hooks
mean no cap logic ships in Pro. The Pro-only pages stay in `shared/pages/`, and
`shared/data/proPages.js` lists them for the Lite build to leave out.

- `editionConfig.js`: every feature on, `licenseGate: true` (the only edition with it),
  `liveSync: true`, `licenseConfig` (checkout URL, variant patterns) and `cloudUrl`.

The app is documented in `docs/End_State_Design_and_Maintenance_Guide.md`, which covers
everything Pro ships. Edition differences are in §0, and the license gate in §0.3.
