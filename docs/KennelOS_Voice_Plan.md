# KennelOS — Voice: plan (calendar feed, Alexa, Siri Shortcuts)

> Status: **plan, nothing built.** Ways to use KennelOS without picking up the phone: a
> calendar feed any assistant can read (§2), an Alexa skill that logs quick records such as
> weight checks, answers waitlist questions and starts waitlist actions that she confirms on
> her phone (§3–§5), reminders on her Echo (§6), and Siri Shortcuts for iPhone (§7). Open
> decisions are in §11.

## 1. Why, and the constraint

- Her hands are full exactly when she has something to record: a litter on the scale, a pup
  in her arms. And waitlist questions ("whose turn is it?") come up away from the phone.
- **The constraint:** KennelOS keeps her records on her device. An Alexa skill runs on
  Amazon's servers and can only reach the KennelOS cloud Worker, so it can only:
  - **read what the server already holds:** the published waitlist projection (turns,
    deadlines, the queue), her alerts (`notify_items`), and for programs on live sync the
    fields classified `cloud` in `shared/data/syncRegistry.js`. `private` fields are
    sealed with her vault key; the server can't read them, so neither can Alexa;
  - **write by queueing:** a record spoken to Alexa is queued on the Worker and **her device
    applies it** on its next sync, the way family button presses (`wl_events`) and the
    KennelAssistant outbox already work.
- **It reuses the KennelAssistant pattern** (`shared/data/assistantSync.js`, guide §26): an
  allow-listed feed her device publishes, and an outbox of events with their own UUIDs that
  her device folds in (importing twice is a no-op), limited to `ASSISTANT_EVENT_TYPES`
  (`weight_check`, `milestone`, `note`, `preventative`, `medication`). Here the feed and the
  outbox live on the Worker instead of Dropbox.
- **Google Assistant is out:** Google shut down third-party Conversational Actions in 2023.

## 2. The calendar feed (no skill)

- A private **calendar subscription link** (`webcal://…/cal/<token>.ics`) of what Today and
  the calendar show: due dates and whelping windows, heats expected, vaccinations and
  preventatives due, offer deadlines, pickup times. Titles only as she'd want them read
  aloud ("Bella due", "Smiths' offer ends"); no prices, no contact details.
- She subscribes in Google or Apple Calendar, links that calendar to Alexa (or Siri, or
  any assistant), and "Alexa, what's on my calendar today?" works with no KennelOS skill.
- **Where it's built:** her device publishes the feed's events (an allow-listed slice, like
  the waitlist projection) to the Worker, which serves the `.ics`. The link carries a long
  random token; **Reset link** in settings replaces it.
- Useful on its own, without any voice assistant.

## 3. The Alexa skill: quick records (weight checks first)

**Talking to it.**
- "Alexa, tell KennelOS Blue boy is one pound four." → "Blue boy, 1 lb 4 oz. Got it."
- A session keeps going for a whole litter: "Next: Red girl, fourteen ounces." "Green boy,
  one pound one." "That's all."
- Weights in pounds and ounces, ounces alone, or grams (converted). Stored as a
  `weight_check` with `weight_lbs` / `weight_oz`, as the app records them (`vocab.js`).
- Other quick records from the same allow-list: "Bella had her heartworm pill"
  (`preventative`), "note for Bella: off her food today" (`note`), "Blue boy's eyes opened"
  (`milestone`).

**Which pup.**
- Names are matched against **the voice feed** (§8): the puppies in her current litters (born,
  not yet placed, under about 16 weeks), by call name and colour/markings, then her adult dogs
  by call name.
- Two matches → Alexa asks back ("Blue boy or Blue girl?"). No match → "I don't know a Blue
  boy; say the name again or check the app", and nothing is recorded.
- Kennels with several litters at once: "…in Bella's litter" narrows it.

**Landing in her records.**
- Each spoken record becomes an event with its own UUID in the Worker's voice outbox
  (`voice_outbox`: program, event JSON, created_at, applied_at). Her device folds them in on
  its next sync through the same import as the KennelAssistant outbox (upsert by id,
  allow-listed types, `settings.markDataChanged()`), then marks them applied.
- **Applied automatically, with undo.** Her phone shows "From Alexa: 6 weights, Tue 7:40 AM"
  with **Undo** and **Edit**: a misheard weight is cheap to fix, and stopping to confirm each
  one would defeat the point.
- The event notes it came from Alexa (`source: 'voice'` inside the event's details), so the
  history shows it.
- Rows are deleted from the Worker once applied, and after 30 days regardless.

## 4. The Alexa skill: waitlist questions

Read from what the server already has (the projection, `notify_items`):
- "Whose turn is it?" / "Who's next for Bella's litter?"
- "When does the Smiths' time run out?"
- "Any new applications?" / "Any new messages?" / "Anything I need to do on the waitlist?"
  (the counts Today's nudges would show; never what a family wrote, which is encrypted to her
  device).
- Answers use families' listed names as the projection already carries them; nothing else.

## 5. The Alexa skill: waitlist actions, confirmed on her phone

- **Voice starts it; a tap confirms it.** Nothing on the waitlist changes on voice alone: a
  misheard family name could give away a turn.
- "Alexa, offer the next family" → "I've sent it to your phone." Her phone gets the push from
  `docs/KennelOS_Mail_Budget_Plan.md` §5.1, opening `next-turn.html` with **Offer & text**
  ready.
- "Give the Smiths another day" → a push opening the same page on **Extend the Smiths**.
- "Record that the Joneses passed" → a push opening their entry with Pass ready.
- On the server these are notification items (`notify.js`), not writes to her records.

### 5.1 "Alexa, update my website"

- Her KennelPort website is fed by **Update website** (End-State guide §35): her device builds
  the bundle (`siteExport.js`, from her own records, some of them private) and sends it with
  that device's website link. The server can't build it, so voice can't publish by itself.
- "Alexa, update my website" → "I've sent it to your phone." A push to **a device linked to
  her website** opens Settings → Your website with **Update website** ready (and the counts
  of what will go). One tap sends it, as the card's button does today. No linked device on
  the account → Alexa says so and nothing is sent.
- "Alexa, update my website **and publish it**" → the same, with **Update and publish** (below)
  ready instead.
- **Publishing live (KennelPort's side).** Today what arrives lands in the website's
  **draft**, and she publishes it in KennelPort Site Manager. For voice (and the card) to push
  changes live, KennelPort accepts a `publish: true` on the update and publishes the draft
  straight after it lands, when her site allows it. That's a **KennelPort change** (its own
  repo and plan), and its setting stays hers: a site set to "review in Site Manager first"
  ignores the flag and says so in the answer. KennelOS side: **Update and publish** beside
  Update website on the Your website card and in Kels's Update my website, offered only when
  the site's facts say it accepts `publish` (as `settings` and `sections` are offered today).
- The push is a notification item (`notify.js`), like §5's actions; nothing about the site is
  stored for voice.

## 6. Reminders on her Echo

- With her permission (Alexa Reminders API), the skill sets reminders on her Echo: "The
  Smiths' deadline ends tonight", "Bella's due date is tomorrow", "Puppy weigh-in at 8".
- Made from the same feed as §2, for the kinds she ticks in settings. Changed or removed
  when the item changes (a turn closed early cancels its reminder).

## 7. Siri Shortcuts (iPhone)

- A shortcut she adds from a link: "Hey Siri, log a weight" → Siri asks which pup and what
  weight → the shortcut posts to the same Worker route the skill uses (§9), with a device
  token she copies from settings.
- Waitlist questions as shortcuts too ("Hey Siri, whose turn is it?"), reading the same
  answers as §4.
- No Apple review, no app store; it costs almost nothing beyond the Alexa work.

## 8. The voice feed (privacy)

- To match names, the Worker needs, per program: for current puppies and her dogs, the
  **id, call name, colour/markings, sex, litter (dam's call name), date of birth, status**.
  The same kind of slice as the KennelAssistant feed (`ASSISTANT_DOG_FIELDS`), smaller.
- **Programs on live sync:** these fields are already `cloud` (readable) on the server; the
  skill reads them there.
- **Other programs:** her device publishes the voice feed (allow-listed, built field by
  field like `waitlistProjection.js`) after changes, only while voice is on.
- Never in it: registration or microchip numbers, owners, buyers, prices, contacts, notes.
- **Turning voice off** deletes the voice feed, the outbox and the account link.
- This is a privacy decision (V1).

## 9. Server

- **Account linking** (Alexa's OAuth): a small authorization endpoint on the Worker. She
  signs in with her KennelOS account (the existing email code) and approves "Alexa can log
  records and read your waitlist". Linking makes a token for that program; unlinking (in
  settings or the Alexa app) revokes it.
- **The skill endpoint:** `POST /voice/alexa`, checking Amazon's request signature, handling
  the intents (log a record, ask about the waitlist, start an action, set a reminder).
- **Siri route:** `POST /voice/log` and `GET /voice/ask`, with a device token from settings.
- **Tables** (one migration): `voice_links` (program, token hash, kind `alexa`/`shortcut`,
  created_at, last_used_at), `voice_feed` (program, body JSON, version, updated_at),
  `voice_outbox` (§3). Never logged: tokens, spoken text, names.
- Rate limits per program like the other routes. Edition and entitlement checks per V2.
- Cloud off (`cloudUrl: null`): no voice UI, no requests.

## 10. Build order

1. **Calendar feed** (§2): useful without voice; also the reminders' source.
2. **Voice feed and outbox** (§8, §3's landing), with the KennelAssistant import reused.
3. **Siri Shortcuts** (§7): the cheapest way to prove logging weights by voice end to end.
4. **Alexa skill:** account linking, weight checks and quick records (§3), then waitlist
   questions (§4), then actions through the phone (§5), then "update my website" (§5.1).
5. **Echo reminders** (§6).
6. Amazon certification, privacy policy and terms updates before the skill is public.

## 11. Decisions

| # | Question | Status |
|---|---|---|
| V1 | The voice feed on the server (call names, colour/markings, litter, birth date, status) | Open: proposed, only while voice is on |
| V2 | Edition and price: Pro feature, a credits pass, or both | Open. Running cost is small (the Worker); certification and support are the real cost |
| V3 | Spoken records applied automatically with undo, not confirmed one by one | Proposed |
| V4 | Waitlist actions only ever confirmed on her phone, never by voice alone | Proposed |
| V5 | Which record types voice may log | Proposed: `ASSISTANT_EVENT_TYPES` as it stands |
| V6 | What the calendar feed includes | Proposed: Today's and the calendar's dated items, titles only |
| V7 | Update and publish (straight live, skipping Site Manager's draft), by voice and on the card | Proposed; needs KennelPort to accept `publish: true` and her site's setting to allow it |
