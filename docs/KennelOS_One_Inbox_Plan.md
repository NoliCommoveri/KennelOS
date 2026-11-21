# KennelOS — One inbox: every message in one place (plan)

> Status: **plan only, nothing built** (the owner, 2026-11-21). Work goes on `next`. The owner:
> KennelPort should send more back, messages above all, so a breeder who uses both products
> never manages messages in two places. KennelOS's half is here; KennelPort's half goes in its
> own contract plan (`docs/plans/kennelos-contract.md` in the KennelPort repo, §5 below).

## 1. Today

- **Status-page messages** reach KennelOS already: a family writes on their status page
  (`POST /f/message`, `cloud/src/familyActions.js`), the Worker seals it to her key and puts it in
  the waitlist inbox, and her device takes it in (`data/waitlistInbox.js`). A person's page shows
  one thread (the prototype's Messages screen).
- **Her replies** go by email: her device writes it, the Worker sends it with the status-link
  footer (`POST /waitlist/messages`).
- **KennelPort's messages** (its contact form, and families on her puppy portal) stay on
  KennelPort. She answers them there.

## 2. What changes

- **One Messages screen in KennelOS:** every thread, newest first, one per person, whatever the
  source: status page, KennelPort contact form, puppy portal, and breeder shares
  (`docs/KennelOS_Breeder_To_Breeder_Plan.md`). Unread first; a person's page keeps its thread.
- **KennelPort forwards each new message to the KennelOS cloud,** sealed to her key the same way
  status-page messages are, so neither server holds readable text at rest. It lands in the same
  inbox, tagged with where it came from.
- **Replies go back the way the message came:** a portal message is answered on the portal, a
  contact-form message by email, a status-page message as today. The family never sees two
  products.
- **A contact-form message from someone new** is a person in People (D8: one person, one page),
  checked against everyone she has (D24's match rules) before a new person is made.
- **When both are linked, KennelOS is the home for messages.** KennelPort's own message view
  shows the thread read-only with "Answered in KennelOS", so nothing is answered twice.
- **Home:** a **Messages** tile with the unread count, a stable tile while any message channel
  is on (UI Redesign Plan D28).

## 3. Later, from KennelPort

After messages, in this order: contact-form enquiries as leads (with the source "Website"), and
portal activity (a family opened an update). Visit counts only if KennelPort can give them
without tracking families.

## 4. Editions, cloud and privacy

- **Pro with cloud and a linked site** for KennelPort's messages; status-page messages stay as
  they are. `cloudUrl: null`: no Messages screen beyond a person's own thread, no requests.
- A message's text is never logged on either server (cloud README rule), and only her devices
  can open it.
- **Worker cost:** one write per message forwarded and one read when her device takes in the
  inbox, which it already does; no request per page open.
- **Server:** the inbox gains a source tag and a reply route per source; if that needs a
  migration it counts toward `next`'s one.

## 5. KennelPort's half (a brief for its contract plan)

1. On a new contact-form or portal message for a linked site: seal it to the kennel's public key
   (the one status-page messages use) and post it to the KennelOS cloud, with the source, a
   thread id and the family's portal id or the sender's email.
2. Take replies from KennelOS on the portal (by thread id) and send contact-form replies by email.
3. Show those threads read-only, marked "Answered in KennelOS", while the site is linked.
4. Unlinking stops forwarding; messages already forwarded stay in KennelOS.

## 6. Open questions (the owner's)

1. Do messages from before the link (on KennelPort already) come across once, or only new ones?
   Recommended: only new ones; old ones stay on KennelPort.
2. Is the read-only view on KennelPort enough, or should she be able to answer there too?
   Recommended: read-only, so there's one place to answer.
