# pro/ — KennelOS Pro (paid edition)

Pro is today's full KennelOS app: unlimited dogs/litters and every section. In the
finished layout this dir holds the **Pro-only pages** that Lite doesn't ship —
Contacts/People, full Kennel management, Stud services, Contracts, Companion,
Assistant, Documents/receipts — while the common pages stay in `shared/`.

**Deployment model:** a Pro origin serves `shared/` + `pro/`. Pro is license-gated
on load (Lemon Squeezy key, browser-validated with an offline grace window). Pro's
shipped bytes contain **no cap logic** — its `editionConfig.js` is a no-op.

## What's here today (foundation)

- `editionConfig.js` — Pro's no-op config (identical semantics to the shared default).

## Not built yet

- Relocation of the Pro-only pages out of `shared/` into here.
- The Pro home page + full nav, its own `sw.js`, and the license-gate flow.
