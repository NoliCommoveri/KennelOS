# KennelOS — Waitlist Policies: plan

> Status: **plan, not built** (2026-11-05). Where a breeder's policies live in KennelOS, how
> she writes them, and where families read them on the waitlist pages: the public list,
> the application, and their status page. Decisions marked **Open** need the owner.

## 1. What this is

Her policies in plain words: health guarantee, deposits and refunds, spay/neuter and
registration, take-back, visits, pickup and shipping. Families ask about them before they
apply and again at the moments that cost money (their turn, the deposit, backing out).
Today the pieces are scattered across settings that each answer one moment:

| Today | Where she sets it | Where families see it |
|---|---|---|
| Application FAQ (`waitlist_config.application_faq`) | Application form page | The application only (`/f/form`, apply page) |
| Fee refund / credit policy (`fee_credit_policy`, `fee_credit_toward`) | Waitlist settings › Fees & payment | Their fee and deposit lines |
| Back-out text (`back_out_policy_text`) | Waitlist settings › Backing out | Their **Need to back out?** card only |
| Payment instructions, extras intro | Fees & payment; Public list & family pages | The cards that use them |

Nothing gathers them into one place a family can read before applying, or come back to
later. Her contract is per sale and legal; policies are the plain-language promises
families read first. This plan adds **one ordered list of policies per kennel**, shown on
all three pages, and leaves the existing moment-specific texts where they are.

## 2. Where it lives: the recommendation

**Data:** `Kennel.waitlist_config.policies`, an ordered list `[{ id, heading, body }]`,
default `[]`, plus `policies_updated` (`YYYY-MM-DD`, set when she saves a change).

- Same shape as `application_faq` (heading/question, body/answer), so the list editor,
  validation (`validateFaq`-style: both or neither) and the families' expander look are
  shared, not rebuilt.
- In `waitlist_config` because everything the family pages show is set there, per kennel
  (multi-kennel stays right: each kennel its own policies), and the projection already
  reads it. A new key inside `waitlist_config` needs **no schema block, no new table, no
  FK**; missing keys read from `WAITLIST_CONFIG_DEFAULTS`, so older backups and builds are
  fine (backups stay backward compatible).
- `waitlist_config` is already a `cloud` field (`syncRegistry.js`), and policies are public
  text meant for families, so nothing new is classified. Surface anyway when built: this
  text leaves her device on every publish, like the FAQ.

**Where she edits it:** a new group, **Policies**, in **Kennel › Waitlist settings**,
between *Fees & payment* and *Turns & offers* (it reads as "what you promise" before "how
turns work"). Shown only while the waitlist is online (`isWaitlistOnlineOffered()`), like
*Backing out*: without the online list there's no page to show it on.

- Rows: heading + body, up/down, delete, **+ Add a policy**, the FAQ editor's controls.
  Extract that editor from `pages/waitlist-form.js` into a shared asset
  (`assets/qaListEditor.js`) and use it in both places.
- **Start from common topics** (only while the list is empty): adds Health guarantee,
  Deposits and refunds, Spay/neuter and registration, Take-back, Visits, Pickup and
  shipping, each with an empty body and a one-line hint of what families want to know.
  Headings only; she writes every word (nothing invented in her name).
- Under the list: *"Your contract is the final word. Keep these in step with it."*

**Rejected places, and why**

- *The Application form page, beside the FAQ:* policies matter long after applying (turn,
  deposit, back-out, pickup), and the form page is about questions to ask. Sharing the
  editor gives the same convenience without the wrong home.
- *Contracts:* per-sale legal documents, signed later; families need the promises before
  they apply. A contract can link to or repeat them; it doesn't hold them.
- *A Kennel field outside `waitlist_config`:* would be a second place family-page content
  is set, and a new field to classify, for no gain.
- *Folding them into the FAQ:* her FAQ is questions; policies are commitments she may
  point to later ("see our refund policy"). Two lists, one look.

## 3. Where families read it

**Published:** `projection.kennel.policies` (and `policies_updated`) when the list is
non-empty; absent otherwise. Server (`familyPages.js`) passes it on unchanged to:

1. **Public list** (`/list/<public_id>`): a collapsible card **Our policies** under the
   intro and Apply button, before Available / Upcoming and the list, closed by default,
   each policy its own expander (the apply page's FAQ look). Visitors see it without
   signing in.
2. **Application** (`/f/form`, apply page): **Our policies** after the FAQ, same
   expanders. **Open (Q2):** an *"I've read the policies"* tick before Send.
3. **Status page, My page**: a **Policies** card, closed, near the end (after Pickup /
   Extras / Need to back out?, before Messages), with *"Updated Nov 5"* when
   `policies_updated` is set. Plus short links at the moments that cost money, each opening
   that card at the right policy:
   - their turn and pick (*"Before you choose: deposits and refunds"*),
   - the deposit card,
   - **Need to back out?** (its own `back_out_policy_text` stays first, then *"Our full
     policies"*).
   Links name policies by heading match (`deposit`, `refund`); none matched = the card.
4. **Her website feed** (`/f/site`): included, so a KennelPort site can show them
   (section 4).
5. **Kels (Family Help plan):** each policy becomes a searchable help entry, `when:
   anyone`, after the cheat sheet and her FAQ, so "what's your refund policy?" finds it.

**Not shown:** `back_out_policy` rows (her private outcome rules) never leave her device,
as today.

## 4. KennelPort

Her KennelPort website already has a **Policies** page (`expanders`, page `policies`)
edited in the Site Manager. Two lists for the same promises will drift.

**Recommended (Open, Q1):** KennelOS is the source while her site is linked. The website
feed brings `policies`; KennelPort's Policies page offers **Use my KennelOS policies**,
and after that shows the feed's list (her KennelPort edits as suggestions back, the portal
plan's 3.1 rule: KennelOS feeds, her site's edits win). An unlinked site keeps its own.
Built on the KennelPort side, after KennelOS publishes them.

## 5. Build steps (KennelOS)

1. `WAITLIST_CONFIG_DEFAULTS.policies = []`, `policies_updated: null`; `waitlistPolicies(config)`
   (clean, ordered, ids) and `validatePolicies` in `waitlistForm.js` beside `formFaq`.
   Tests: cleaning, validation, defaults on an old config.
2. Shared editor (`assets/qaListEditor.js`) out of `waitlist-form.js`; the FAQ uses it
   unchanged (its tests still pass).
3. Kennel › Waitlist settings › **Policies** group: editor, Start from common topics,
   `policies_updated` on save. Kels knowledge entry; tour step if the tour covers
   Waitlist settings.
4. Projection: `kennel.policies`, `kennel.policies_updated` (absent when empty); in the
   form section too. Test: shape, absent when empty, multi-kennel kept apart.
5. Family pages: list card, apply section, status card and the three links. Browser-test
   with the local Worker (`cloud/tests/helpers/serve.mjs`) at phone width.
6. `/f/site` feed: include `policies`. Kels Layer 1 entries.
7. Docs: End-State guide §29 (the field, the group, the pages), `cloud/README.md` if the
   feed shape is listed there, Waitlist spec cross-reference, BUILD_LOG.

No migration, no new page, no `PRECACHE_URLS` change unless step 2's asset is new (it is:
add it to `shared/sw.js` `PRECACHE_URLS`). Ask before the SW cache bump.

## 6. Open questions

- **Q1 — KennelPort:** KennelOS as the source of her website's Policies page while linked
  (section 4), or two separate lists?
- **Q2 — Acknowledge at apply:** an *"I've read the policies"* tick on the application
  (stored on the entry as `policies_read: date`), or just show them?
- **Q3 — Changed policies:** when she edits them, tell families on the list (a line on
  their page, *"Our policies were updated Nov 5"*, until they open the card), or only the
  date on the card?
- **Q4 — Fee and back-out wording:** keep the fee refund line and back-out text as their
  own settings (recommended: they're used at specific moments), or replace them with
  links to matching policies?
- **Q5 — Lite:** Lite has no online waitlist pages, so nothing to show. Confirm Pro only.
