# KennelOS — Lite / Pro Editions

> **Status: this is now the live plan for THIS repo, and the build has started.** The
> "new repo" this doc refers to is this one. Foundation is in place (app relocated to
> `shared/`, editionConfig injection point wired as a no-op, `lite/pro/demo/` skeletons).
> See the top-level `README.md` for current build status. This document remains the
> authoritative design for what Lite/Pro/Demo should become — read it as the target, and
> the README as the progress.

*Design plan, plain-English throughout; the precise rules are called out where they matter.*

---

## The decision in one line

Ship **two editions of the app** — **Lite** (free) and **Pro** (paid) — where the Pro
features are *physically absent* from the Lite download, Lite carries a **soft cap** on
owned dogs and litters that is self-enforcing in practice, and converting Lite → Pro is a
one-time **export-your-data / import-it** step the app already knows how to do.

---

## Why two editions (this is what kills the hacks)

A single app with locked features can always be pried open, because the Pro code is sitting
right there in what everyone downloads — the lock only *hides* it. Two editions flip that:

> If the stud-services code, the contracts code, the receipts code simply **aren't in the
> Lite download**, there is nothing to unlock. You can't hack your way to a feature that
> isn't in the files.

This is the "Lite edition vs Pro edition" model real software used for decades. It's the
strongest paywall static hosting (GitHub Pages) can give you, because the lock is *"it isn't
here,"* not *"it's here but hidden."*

---

## Why a cap actually holds up here

A number-limit still runs in the browser, so on paper it's "soft." But in **this** app it
behaves like a hard limit, for reasons specific to what the data is:

1. **You can't delete a linked dog.** The app blocks permanently deleting any dog that's
   referenced by a litter, pairing, sale, or event (referential integrity). So a breeder
   can't free a slot by deleting a real dog.
2. **Freeing a slot means destroying the pedigree.** The only workaround — unlinking a dog
   from its litters/pairings first — guts exactly the history a breeder values most. Nobody
   trades their pedigree for one extra slot. **The incentive fights the hack.**
3. **The only way to free a slot makes the dog vanish from your own app.** In Lite there is
   **no manual "archive" button**; the sole path to archive a dog is the **"this dog left my
   program"** action (sold / rehomed / placed), which archives it and removes it from view. A
   departed (archived) dog does **not** count — that's the intended, honest way to free a slot.
   But to get that slot you have to make a *real* dog disappear from your own records: you can't
   breed it, pick it in a pairing, or even open its record. Nobody hides a dog they actually
   have to dodge one slot, so the incentive fights the hack, same as the pedigree point.
4. **Faking a departure corrupts their own records.** Declaring a dog "left my program" when it
   didn't makes a dog you still own vanish from the app you rely on — same self-defeating logic
   as the pedigree point.

Freeing a slot *honestly* means departing a dog (above). The only *dishonest* escapes are
faking a departure — which hides a dog you still have — or **Reset App**, which wipes the entire
program. No one nukes their whole kennel to add a 7th dog. So the cap is technically soft but,
in the hands of the person who actually cares about this data, sturdy — as good as it gets
without a server, and good enough.

---

## The two tiers

| Area | Lite (free) | Pro (paid) |
|---|---|---|
| Owned / co-owned dogs | Up to the cap | Unlimited |
| Litters | Up to the cap | Unlimited |
| Pairings | Unlimited | Unlimited |
| Events / history log | Unlimited | Unlimited |
| Sales → income | ✅ log sales on their pups | ✅ |
| Buyers on a sale | ✅ self + inline "add buyer" | ✅ full Contacts section |
| Contacts section (browse/manage all) | ❌ | ✅ |
| External dogs | ❌ | ✅ |
| Stud services | ❌ | ✅ |
| Contract types (beyond a logged sale) | ❌ | ✅ |
| Kennel management (logos, custom tests) | Startup selections only | ✅ full |
| Companion app (buyer/partner share-out) | ❌ | ✅ |
| Assistant app | ❌ | ✅ |
| Receipts & file storage | ❌ | ✅ |

The through-line: **Lite = keep good basic records; Pro = run it as a business.** The paid
value is *features*, not "more of the same."

Two consequences of "External dogs ❌": in Lite the dog **ownership picker offers only `owned`
and `co_owned`** (external and leased ownership are Pro), and a dog that **leaves the program**
isn't marked "external" — it's **departed (archived and hidden)**, per the cap spec. A browsable
**"dogs I've placed / past dogs" history is therefore a Pro perk**; in Lite the departed dog's
Sale record survives (who bought what), but the dog itself drops out of view.

---

## The cap, defined precisely

"6 adult owned dogs" isn't one field in the app — it's a filtered count. The precise definition
(and the full enforcement design) lives in **`KennelOS_Lite_Cap_Enforcement_Spec.md`**; the
recommended shape:

**Counts toward the cap:** a **non-archived** dog whose **life stage is an adult stage** — active
breeding, retired breeding, pet home, or for sale. (In Lite every dog is `owned`/`co_owned`, so
ownership doesn't need testing — external and leased dogs are Pro-only and can't exist in Lite.)

**Does NOT count:** puppies (so a whole litter never blows the cap), **archived/departed dogs**
(that's how you free a slot — see pillar 3), and deceased dogs (historical; faking it corrupts
records).

### The one wrinkle: a kept puppy growing up (decided — no grandfather)

Your 2 free litters make puppies. Puppies don't count *as puppies* — good. But when a breeder
**keeps** one and it matures, the app changes its life stage on the same record, and it would
now count. An earlier draft floated *grandfathering* home-grown dogs (let a maturing puppy push
you past the cap). **We're not doing that.** By the time a kept puppy matures it's roughly a
year later — the owner has been a Lite user long enough to decide whether to upgrade, so a
maturing puppy that would exceed the cap is exactly the right moment to ask them to.

> **Decided rule:** maturing a kept puppy into an adult life stage is capped just like adding a
> new adult dog. At the cap, the status change is blocked — but as a **clear upgrade nudge with
> an escape**, never a silent dead button:
>
> *"You're at your Lite limit of N adult dogs. To mark this pup grown, upgrade to Pro — or
> archive a dog you no longer keep."*

**The honest downside to accept:** while blocked, that dog stays labelled `puppy` even though
it's grown — a small false record the app is imposing. That's tolerable *because* the block is
a visible prompt with a way out (upgrade, or archive/rehome another dog), not a trap. The dog
only stays mislabelled if the owner actively ignores the nudge, which is their call. We keep the
stricter rule and lean on clear wording rather than a leaky grandfather clause.

---

## Hosting, editions, and origin isolation (decided)

Each edition is its own web app at its own **subdomain of one bought domain** (buy it once the
build is ready — ~$12/yr, and it makes a paid product look like one):

- `kennelos.app` *(or whatever we land on)* → **Lite**, public and free — the front door.
- `pro.kennelos.app` → **Pro**, license-gated on load.
- `demo.kennelos.app` → **Demo**, Pro code with demo mode on.

Why subdomains and not `/lite` `/pro` paths: **subdomains are separate browser origins, so their
IndexedDB is isolated automatically.** The app opens its database by a fixed name
(`new Dexie('KennelOSBreedingApp')`), so two editions on the *same* origin (which is what plain
`*.github.io` paths are) would silently **share one database** — breaking the edition wall and
letting the demo's re-seed clobber real data. Separate origins fix this for free and make the
JSON export/import a genuine bridge (below). **This resolves open-decision #5: walled apart, via
distinct origins.**

*Fallback if the domain is ever dropped:* stay on `*.github.io` but give each edition a
**distinct Dexie database name** (`KennelOS_Lite` / `_Pro` / `_Demo`) — mandatory, not optional,
or they collide. You lose true origin isolation (a devtools user could read across), an
acceptable-but-worse version of the same soft caveat everything else here carries.

## Licensing — Lemon Squeezy yearly keys (decided)

Pro is a **yearly subscription (~$20–30/yr)** sold through **Lemon Squeezy**, unlocked with a
**license key**. This has to work with **no backend of our own** — the app is a static,
offline-first PWA — and Lemon Squeezy fits because its **License API is callable straight from
the browser**: the activate/validate endpoints authenticate with the *license key itself*, not
the store's secret API key, so there's no server to stand up.

- **Activate (first run, online):** Pro asks for the key → `POST /v1/licenses/activate` → on
  success, store the activation record locally (via `settings.js`) with the returned expiry.
- **Offline-first, honored:** don't demand network every launch. Re-validate (`/validate`)
  silently *when online*; honor the cached activation within a **grace window (~21–30 days
  offline)** so a breeder with no signal isn't locked out. When the subscription lapses,
  `/validate` returns expired and Pro drops to a "renew to continue" wall.
- **Renewal** is automatic on Lemon Squeezy's side; the key's status flips and the next
  `/validate` sees it.

**One thing to confirm against current Lemon Squeezy docs at build time:** that the
activate/validate endpoints are CORS-enabled for browser calls and need only the license key
(no store secret). The whole no-backend design rests on that.

**The honest caveat:** the license check runs in the buyer's browser, so a technical person
could bypass it. The audience is dog breeders, not crackers — the key stops ~99%, and the sub is
really paying for updates + hosting-off-their-plate, not uncrackable bytes. Note this pairs with
the absence model: **Lite** (the free tier, where feature-hacking pressure is highest) is
protected by the Pro code genuinely *not being there*; **Pro** leans on the key.

## In-Lite links to Demo and Pro (decided — no email)

Lite is the hub. Because the editions are just web apps at known URLs, Lite links to them
directly (plain cross-origin anchors — nothing special), so there's never a manual email step:

- **"See the full app →"** → `demo.kennelos.app`. The always-on sales tool: one tap, no install,
  no login, and it's already populated (see the Demo section) so they see a *working* kennel.
- **"Upgrade to Pro →"** → the upgrade flow below.

## Converting Lite → Pro (the bridge)

Because the origin wall means **data does not follow the user across origins** (`lite.` and
`pro.` have separate IndexedDB), "Upgrade to Pro" can't be a bare link — that would drop them
into an empty Pro. Good news: **the app already has JSON export and import**, so the bridge is
just sequencing them around the purchase. The "Upgrade to Pro" button runs three steps:

1. **Export your backup first** — Lite triggers its existing JSON export, so the file is in the
   owner's Downloads before they leave.
2. **Go buy** — open the Lemon Squeezy checkout, with its post-purchase redirect set to
   `pro.kennelos.app` so they land in Pro automatically.
3. **In Pro** — paste the license key (from the checkout success page / email) to activate, then
   **Import** the backup they just exported → everything's there, caps lifted, Pro sections
   unlocked.

So the whole move is export-in-Lite → import-in-Pro, bracketing the purchase — both halves the
app already does, with no human in the loop.

---

## The Demo edition (seeded, read-only showcase)

A third thing to hand people — or walk them through yourself — so they can *see* the full app
without installing anything or typing in a single real dog.

**What it is:** the **Pro feature set**, pre-loaded with realistic **sample data**, and
**read-only** — a visitor can click through every page, open dogs, litters, pairings, sales,
Companion, receipts, the works, but **can't change anything.** Your app already ships a
sample-data seed, so the "seeded" half is basically done.

**Why read-only is a clean switch, not a big build:** every change in the app funnels through
one place (the repo layer's create / update / archive / delete). Flip a single "demo mode"
switch and those become friendly no-ops — *"This is a demo — changes aren't saved."* One
chokepoint, so "cannot be edited" is genuinely one lever, not a hundred disabled buttons. On
each visit it re-seeds to the same pristine state, so every viewer sees the same tidy kennel.

**Sample data is the whole point — keep it.** The demo ships *pre-loaded* with a realistic
kennel so visitors picture their own program in that shape: a populated Dogs list, real litters,
pairings, sales, Companion, receipts. The app already ships a sample-data seed, so the "seeded"
half is basically done. (Visitors bring and enter *nothing* — that's what "no data/auth" means
here; it refers to the visitor, not to the demo, which is deliberately full.)

**The honest catch, and how we close it (decided):** the demo is the *one public place the full
Pro feature code lives* (it has to, to show it off). A technical person could, in principle,
flip the read-only switch off in their browser and poke at a working copy. For dog breeders
looking at a showcase that's not a real risk — the same "keeps honest people honest" caveat as
everything else — but we **strip the "save/export my work" paths from the demo build** (resolves
open-decision #8), so an unlocked copy is a dead end. The demo is a shop window, not a vault, and
now there's nothing to carry out of it.

**Bonus:** this doubles as your sales tool — the "try before you buy" for the Lemon Squeezy sub,
reachable straight from Lite's **"See the full app →"** link, so it sells the app for you
anywhere you drop the URL.

---

## How it's laid out (plain English, for the new repo)

Not two copies of the app — that way lies drift. Instead, **one shared core that both
editions import from**, and two thin editions on top. No build step, nothing duplicated.

```
/shared/     the database, the repos, the vocab, and the pages both editions
             have in common — dogs, litters, pairings, events, sales — plus utilities

/lite/       Lite's own home page + navigation, the cap logic, and its own
             service-worker precache list. Ships ONLY the shared pages.

/pro/        Pro's own home page + navigation, plus the extra pages Lite doesn't
             have — Contacts, stud services, contracts, Companion, Assistant,
             receipts/files — and its own service-worker precache list.

/demo/       the Pro edition again, but launched with "demo mode" on: auto-seeds
             sample data, blocks all edits, re-seeds clean each visit. Mostly the
             same files as /pro/ with one flag flipped — not a fourth codebase.
```

The nice part: in Lite, most "gating" isn't a runtime check at all — the Pro pages simply
**aren't in Lite's navigation or its offline file list**, so they were never downloaded. The
cap (and, in Pro, the license check) is the only thing an edition actively enforces.

**Repo layout → deployment:** the four dirs are one repository, but each edition *deploys to its
own origin* (the subdomains above) so their IndexedDB stays isolated. `/demo` is `/pro` with the
demo flag on and the save/export paths omitted. If we ever fall back off the custom domain onto a
single `*.github.io` origin, the editions must instead open **distinct Dexie database names** —
see "Hosting, editions, and origin isolation."

---

## Guardrails carried over from the current app

- **Soft-delete only**; deletes never cascade and never destroy history.
- **Referential integrity via the registry** — every foreign key stays registered (this is
  *why* the cap holds).
- **Archive counts differ by entity, deliberately:** for **dogs**, archived = *departed* and is
  **excluded** from the cap (that's the exit); there is **no manual dog-archive in Lite**, no
  "include archived" toggle, and **no view links to an archived dog's record** (pedigree, sale,
  roster, event log — the name shows but isn't clickable, and no "arch" badge advertises the
  mechanism). For **litters**, archived still counts (there's no litter "departure"). Full rules
  in `KennelOS_Lite_Cap_Enforcement_Spec.md`.
- **IDs are random UUIDs** — no hidden sequence to exploit, and none to lean on either.
- **Service-worker cache discipline, now ×2** — each edition has its own precache list and
  its own cache-name bump. This is the most-forgotten step; there are now two of it.
- **Keep the End-State guide true** — update it in the same change as any structural edit.

---

## Decisions — locked and still open

**Locked (folded into the sections above):**

- **Puppy-grows-up rule (#3)** — *no grandfather.* Maturing a kept puppy is capped like adding a
  new adult; at the cap it's blocked with a clear upgrade nudge + archive escape.
- **Walled apart, via distinct origins (#5)** — each edition on its own subdomain of one bought
  domain, so IndexedDB is isolated automatically; JSON export/import is the upgrade bridge.
- **Pricing / platform (#6)** — Lemon Squeezy **yearly subscription, ~$20–30/yr**, unlocked by a
  browser-validated license key with an offline grace window.
- **Demo behavior (#7)** — strictly **read-only**, re-seeded clean each visit (not a sandbox).
- **Demo hardening (#8)** — **strip** the save/export paths from the demo build; an unlocked copy
  is a dead end.
- **In-Lite links** — Lite links out to Demo and Pro directly; no manual email step.
- **Cap numbers** — **6** counting dogs, **2** litters. `co_owned` **counts**; `deceased` and
  archived/departed dogs **don't**. Full rules in `KennelOS_Lite_Cap_Enforcement_Spec.md`.
- **Exit = archive-on-departure** — sold/rehomed/placed dogs *and sold puppies* are archived and
  hidden; every archive action is gated by a **"this is permanent" confirm** the user must accept.

**Still open (don't block the layout, but pin before shipping):**

1. **Inline "add buyer" in the sale flow** — confirm Lite can create/pick a buyer from inside
   a sale, since the full Contacts section is Pro-only.

---

## The one honest caveat

Reset App still wipes a Lite cap — that's the only escape hatch left, and it's self-defeating
because it destroys the breeder's whole program. Nothing running purely in a browser can beat
that, and for this audience nothing needs to.
