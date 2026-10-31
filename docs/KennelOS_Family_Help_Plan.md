# KennelOS Family Help — plan: Kels on the family pages

Kels answers families' common questions on the waitlist's family pages: the public list
(`/list/<public_id>`) and a family's status page (`/s/<token>`). Two layers, each useful
alone:

1. **Scripted Kels** (no AI, no running cost): suggested questions for what's on the
   family's page, a search box, and "Show me where". Answers come from the KennelOS cheat
   sheet and the breeder's own FAQ.
2. **"Ask in your own words"** (Claude Haiku 5.5, through the cloud server): a typed
   question answered from the same sources, falling back to Layer 1 when it's off or busy.

Edition: Pro, with the waitlist online (the family pages exist only then). Nothing changes
for a breeder whose list isn't online.

## 1. Who she is

She's **Kels**, speaking for the kennel. Her opening line, `[Kennel Name]` filled in from
the published projection:

> Hi there! I'm Kels, and I'm here to help answer the most commonly asked questions on
> behalf of [Kennel Name]. If your question is one I'm not trained to answer, I'll help you
> get a message to the breeder. Sound good?

Replies: **Sounds good** (opens the panel's suggestions) / **No thanks** (closes it).
Her photo is the app's `assets/kels.png`, copied to `cloud/public/family/`.

## 2. "Get a message to the breeder"

When Kels has no answer (no topic matched, or Layer 2 says it isn't sure):
- **Status page, signed in:** "Want to ask the breeder?" scrolls to the existing message
  box and fills it with the question for the family to send. Nothing is sent without
  their tap.
- **Status page, not signed in:** Sign In first (the existing See Your Details code), then
  as above.
- **Public list (a visitor, or a family not signed in):** "Already on the list? Sign in to
  message the breeder", plus, when the breeder has them on, "Apply" (the online form) and
  "Message us on Facebook" (`kennel.messenger`). Without any of those: "Contact the breeder
  directly."

## 3. The cheat sheet (you write it)

`docs/KennelOS_Family_Help.md`: plain markdown, one entry per question, the same for every
kennel:

```markdown
## What does it mean when it's my turn?
when: turn
also: offer, pick, choose, deposit
show: offers

When it's your turn, you can pick a pup from the litters listed…
```

- `## …`: the question as a family would ask it (the suggestion button's words).
- `when:` (optional): which page states it's suggested in: `turn`, `waiting`, `paused`,
  `applied`, `approved`, `placed`, `visitor` (public list, not signed in), `anyone`
  (default). Several allowed, comma-separated.
- `also:` (optional): extra search words.
- `show:` (optional): the page section "Show me where" scrolls to (a fixed list the pages
  define: `offers`, `place`, `prefs`, `pause`, `message`, `list`, `apply`, …).
- The answer: plain text, short paragraphs. `[Kennel Name]` is filled in. No HTML.

`node cloud/scripts/family-help.mjs > cloud/public/family/helpTopics.js` turns it into the
data file the pages load (the `cloud-fields.mjs` pattern); a test fails if they drift.
The breeder's own FAQ (already published as `kennel.form.faq`) is added after the cheat
sheet's entries, searchable the same way, `when: anyone`.

## 4. Layer 1: scripted Kels

- A **"Questions? Ask Kels"** button, bottom right on both pages (her photo), opening a
  panel: intro the first time per browser (remembered in that browser only), then up to
  four **suggested questions** for the page's state (§3 `when:`), and a **search box**
  (every typed word must start a word in the question, `also:` or the answer, as the
  app's Understanding Something search).
- Picking one shows the answer and, with `show:`, **Show me where** (scrolls to that part
  of the page and highlights it briefly). Then "Anything else?" with the suggestions again.
- New files: `cloud/public/family/kels.js` and its styles in `family.css` (the pages' CSP
  allows no inline script or style), `helpTopics.js`, `kels.png`. Loaded by `list.html`
  and `status.html` (and the embedded versions).
- Never sends anything anywhere; no server change.

## 5. Layer 2: "Ask in your own words"

- Below the search box when the breeder has it on: "Ask in your own words".
- `POST /f/ask {public_id, status_token?, session?, question}` on the Worker →
  Claude Haiku 5.5 (`claude-haiku-5-5`, effort `low`) with: Kels's instructions and the
  cheat sheet (cached prefix), the breeder's FAQ, a short summary of what's already on
  that family's page (their place, an open turn's litters and respond-by date, their
  pause date; nothing they can't already see), and the question. Answer: two or three
  sentences, plus the topic it drew on (structured output: `{ answer, topic_id | null,
  unsure }`), so Show me where still works. `unsure` → §2.
- **Rules in the prompt:** answer only from the sources given; never promise a pup, a
  place, a price or a date the sources don't state; never act for the family; say it isn't
  sure rather than guess.
- **Key:** `ANTHROPIC_API_KEY` as a Worker secret; health on `/ops`. Off without it.
- **Limits:** 20 questions per family session (or IP, on the public list) per day, and a
  per-kennel daily cap. Over a limit, or on any error: Layer 1's search results instead.
- **Privacy:** the panel says "Your question is sent to our AI provider to answer it. It
  isn't stored." Questions and answers are never stored or logged (cloud rules).
- **Who turns it on:** each breeder, in Waitlist settings ("Let Kels answer families'
  questions in their own words"), published in her projection. Off by default.

## 6. Cost (Claude Haiku 5.5: $0.10 / $0.50 per million input / output tokens)

About $0.0007 per question uncached, about $0.0002 with the cheat sheet cached
(~5,000-token cheat sheet + FAQ, ~700 tokens of page summary and question, ~150 out).
1,000 questions a month ≈ $0.20–0.70; 100,000 ≈ $20–70. The daily limits cap it.

## 7. Decisions

- **D1 — Name and intro:** Kels, with §1's intro. *Decided (owner).*
- **D2 — Who turns on Layer 2:** each breeder, off by default. *Decided (owner).*
- **D3 — The cheat sheet's home and format:** §3. *Decided (owner).*
- **D5 — Layer 2's limit:** 20 questions per family session (or IP) per day, plus the
  per-kennel daily cap. *Decided (owner).*
- **D4 — Does Layer 2 ship with Layer 1, or after real families have used Layer 1?**
  *Recommendation:* after, so the cheat sheet is filled in from what families actually ask.

## 8. Build order

1. Cheat sheet format, converter and its test; a starter `docs/KennelOS_Family_Help.md`
   with a few entries to show the shape (you write the rest).
2. Layer 1 on both pages, with §2's message handoff. Browser-tested with the local Worker
   (`cloud/tests/helpers/serve.mjs`).
3. Layer 2: the route, prompt, limits, Waitlist settings switch, `/ops` health.
4. End-State guide §29, `cloud/README.md`, BUILD_LOG.
