# pro/ — KennelOS Pro (paid edition)

Pro is today's full KennelOS app: unlimited dogs/litters and every section. In the
finished layout this dir holds the **Pro-only pages** that Lite doesn't ship —
Contacts/People, full Kennel management, Stud services, Contracts, Companion,
Assistant, Documents/receipts — while the common pages stay in `shared/`.

**Deployment model:** a Pro origin serves `shared/` + `pro/`. Pro is license-gated
on load (Lemon Squeezy key, browser-validated with an offline grace window). Pro's
shipped bytes contain **no cap logic** — its `editionConfig.js` is a no-op.

## What's here today

- `editionConfig.js` — Pro's config: no-op cap hooks + full-feature flags, plus
  `editionFlags.licenseGate: true` and `licenseConfig` (the Lemon Squeezy checkout
  URL + variant→interval pattern). This is the ONLY edition that turns the gate on.
- **License gate (built):** the flow lives in `shared/` so it's edition-agnostic and
  activates only under this config — `shared/data/license.js` (activate/validate calls
  + the offline-grace verdict) and `shared/assets/licenseGate.js` (the activation wall,
  renewal wall, and grace banner), invoked from `shared/app.js`'s `boot()`.

## Not built yet

- Relocation of the Pro-only pages out of `shared/` into here (currently they live in
  `shared/pages/` and are excluded from the *Lite* build — Option B).
- **Launch config:** swap `licenseConfig.checkoutUrl` (and optional `portalUrl`) for the
  real Lemon Squeezy links, and tune `yearlyVariantPattern` to the store's variant names.
