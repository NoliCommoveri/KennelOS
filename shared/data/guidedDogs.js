// guidedDogs.js — Kels's "Add dogs" task, its data half (the screens are
// assets/guidedDogsUI.js, drawn by the shared step engine assets/kelsSteps.js).
// Several dogs in one go, the way Record a new litter takes several puppies:
//   1. Who are we adding? One row per dog: name and boy or girl, "+ Another dog".
//   2. Any name already on file (dogMatches, outside and pedigree-only dogs
//      too) is asked about first: "We found Bella. Is this her?" A dog that's
//      already hers is left as it is; a pedigree-only one is brought into use
//      with the details she gives (the Dog page's "bring in").
//   3. With more than one dog, what they have in common (breed, status, whose
//      dog, kennel), asked once and filled in on each dog to change.
//   4. Each dog's details, then its parents (a dog on file, one of the dogs
//      being added, or a name typed in, made a pedigree-only dog as the
//      tidy-up does), then one review she approves before anything is written.
//
// Three parts, as in guidedLitter.js: the DRAFT (kept after every step through
// settings.js), pure helpers (steps, checks, review), and saveGuidedDogs(), the
// writes, every one through the repos. The save is RESUMABLE: each record's id
// goes back on the draft as it's made, so a retry never makes anything twice.
// In Lite, the cap stops it: the dogs made so far are kept and linked, and the
// rest aren't added (the UI shows the upgrade notice).
import { dogRepo } from './dogRepo.js';
import { contactRepo } from './contactRepo.js';
import { kennelRepo, seedTestsKennel } from './kennelRepo.js';
import { resolveKennelIdForWrite, SCOPED_OWNERSHIP } from './kennelScope.js';
import { getMyContactId } from './settings.js';
import { CapExceededError } from './repoBase.js';
import { eventRepo } from './eventRepo.js';
import { expenseRepo } from './expenseRepo.js';
import { todayYMD } from './dateUtils.js';
import { SEX, DOG_STATUS, OWNERSHIP_TYPE, descriptor, defaultExpenseCategoryFor } from './vocab.js';
import { dogMatches, fmt } from './guidedLitter.js';

export const DRAFT_VERSION = 1;
export const MAX_DOGS = 20;

// Statuses she can give a dog she's adding. A puppy belongs to a litter (Record
// a new litter); a pedigree-only dog is made from the parents step.
const ADDABLE_STATUSES = ['active_breeding', 'retired_breeding', 'pet_home', 'for_sale', 'deceased'];
const LITE_STATUSES = ['active_breeding', 'retired_breeding', 'deceased'];
export const statusChoices = ({ fullDogStatuses = true } = {}) =>
  DOG_STATUS.filter((s) => (fullDogStatuses ? ADDABLE_STATUSES : LITE_STATUSES).includes(s.value));

// Whose dog: hers, co-owned, or (where the edition has outside dogs) someone else's.
export const ownershipChoices = ({ externalOwnership = true } = {}) =>
  OWNERSHIP_TYPE.filter((o) => ['owned', 'co_owned', ...(externalOwnership ? ['external'] : [])].includes(o.value));

export const OWNER_REQUIRED = ['external'];

const blank = (v) => v == null || String(v).trim() === '';
const trimmed = (v) => (blank(v) ? '' : String(v).trim());
const norm = (s) => trimmed(s).toLowerCase().replace(/\s+/g, ' ');
const key = () => (globalThis.crypto?.randomUUID?.() || `k${Math.random().toString(36).slice(2)}`);
const word = (sex) => (sex === 'female' ? { pronoun: 'she', object: 'her' } : { pronoun: 'he', object: 'him' });

// The fields "what they have in common" fills in on each dog.
export const COMMON_FIELDS = ['breed', 'status', 'ownership_type', 'kennelId', 'ownerId', 'ownerName'];

export function emptyDraft() {
  const now = new Date().toISOString();
  return {
    v: DRAFT_VERSION,
    startedAt: now,
    updatedAt: now,
    step: null,
    label: '',
    history: [],
    dogs: [newDog()],
    common: { breed: '', status: 'active_breeding', ownership_type: 'owned', kennelId: null, ownerId: null, ownerName: '' },
    // The common answers last filled in on the dogs (fillFromCommon).
    applied: {},
    saved: {},
    done: false
  };
}

// A parent: '' = not known, 'dog:<id>' = a dog on file, 'batch:<key>' = one of
// the dogs being added, 'new' = a name she typed (`name`).
const noParent = () => ({ pick: '', name: '' });

export function newDog() {
  return {
    key: key(),
    call_name: '', sex: '', breed: '', date_of_birth: '', registered_name: '', registration_number: '',
    color_markings: '', microchip_id: '', status: '', ownership_type: '',
    ownerId: null, ownerName: '', kennelId: null,
    dam: noParent(), sire: noParent(),
    // Dogs already on file by that name (matchIds, looked up for `matchesFor`),
    // and her answer: null = not asked, 'none' = a different dog, else the
    // dog's id. `bringIn`: the one she picked is pedigree-only, so it's updated.
    matchIds: [], matchesFor: null, match: null, bringIn: false,
    id: null, saved: false
  };
}

// A roster row she left empty (no name, no sex) is just dropped.
const isEmptyRow = (d) => blank(d.call_name) && !d.sex;

// The dogs the save makes (or brings in): every one but those she said are
// already on file.
export const dogsToAdd = (draft) => draft.dogs.filter((d) => !(d.match && d.match !== 'none' && !d.bringIn));
export const dogsAlreadyIn = (draft) => draft.dogs.filter((d) => d.match && d.match !== 'none' && !d.bringIn);

export const dogLabel = (d) => trimmed(d.call_name) || 'this dog';

// After the roster: drop empty rows and look up each name on file. A name that
// hasn't changed keeps her earlier answer.
export function afterRoster(draft, dogsOnFile) {
  draft.dogs = draft.dogs.filter((d) => !isEmptyRow(d));
  for (const d of draft.dogs) {
    const asked = `${norm(d.call_name)}|${d.sex}`;
    if (d.matchesFor === asked) continue;
    d.matchesFor = asked;
    if (d.id && d.id === d.match) d.id = null; // a pedigree dog brought in under the old name
    d.match = null;
    d.bringIn = false;
    d.matchIds = dogMatches(dogsOnFile, { name: d.call_name, sex: d.sex }).map((x) => x.id);
  }
  // A parent pointing at a dog no longer in the batch is cleared.
  const keys = new Set(dogsToAdd(draft).map((d) => d.key));
  for (const d of draft.dogs) {
    for (const role of ['dam', 'sire']) {
      const p = d[role];
      if (p.pick.startsWith('batch:') && (!keys.has(p.pick.slice(6)) || p.pick.slice(6) === d.key)) d[role] = noParent();
    }
  }
  return draft;
}

// Fill each dog's fields from what they have in common: a blank field, or one
// still holding the last common answer, takes the new one. Her own changes on a
// dog are kept. Run after the roster too, so a lone dog gets the defaults.
export function fillFromCommon(draft) {
  const c = draft.common;
  const prev = draft.applied || {};
  for (const d of draft.dogs) {
    for (const k of COMMON_FIELDS) {
      if (blank(c[k])) continue;
      if (blank(d[k]) || d[k] === prev[k]) d[k] = c[k];
    }
    // Only someone else's dog has an owner to ask about.
    if (!OWNER_REQUIRED.includes(d.ownership_type)) { d.ownerId = null; d.ownerName = ''; }
  }
  draft.applied = Object.fromEntries(COMMON_FIELDS.map((k) => [k, c[k]]));
  return draft;
}

// --- Steps --------------------------------------------------------------------

// ctx: { multiKennel (she has more than one own kennel, so a dog of hers is
// asked which) }. Steps for each dog are keyed by its place in draft.dogs.
export function stepsFor(draft) {
  const steps = ['roster'];
  draft.dogs.forEach((d, i) => { if (d.matchIds?.length) steps.push(`match:${i}`); });
  const adding = dogsToAdd(draft);
  if (adding.length > 1) steps.push('common');
  draft.dogs.forEach((d, i) => { if (adding.includes(d)) steps.push(`dog:${i}`, `parents:${i}`); });
  steps.push('review');
  return steps;
}

export const stepIndex = (step) => Number(step.split(':')[1]);

// How many roster rows she may have: MAX_DOGS, or fewer where the edition caps
// dogs (`capStatus`: editionConfig.dogCapStatus(), null when uncapped).
export function maxDogs(capStatus) {
  if (!capStatus) return MAX_DOGS;
  return Math.max(0, Math.min(MAX_DOGS, capStatus.cap - capStatus.current));
}

// One plain-language problem with the step's answers, or null when it's fine.
// ctx: { dogs (on file), multiKennel, ownKennelIds, maxDogs }.
export function stepProblem(step, draft, ctx = {}) {
  const today = todayYMD();
  if (step === 'roster') {
    const rows = draft.dogs.filter((d) => !isEmptyRow(d));
    if (!rows.length) return 'Type the name of a dog you\'re adding.';
    const max = ctx.maxDogs ?? MAX_DOGS;
    if (rows.length > max) {
      return max < MAX_DOGS ? `You have room for ${max} more ${max === 1 ? 'dog' : 'dogs'}. Take ${rows.length - max === 1 ? 'one' : 'some'} off the list.` : `I can add up to ${MAX_DOGS} dogs at a time.`;
    }
    const unnamed = rows.find((d) => blank(d.call_name));
    if (unnamed) return 'Type a name for each dog, or take that row off.';
    const noSex = rows.find((d) => !['male', 'female'].includes(d.sex));
    if (noSex) return `Is ${trimmed(noSex.call_name)} a boy or a girl?`;
    const seen = new Set();
    for (const d of rows) {
      const n = norm(d.call_name);
      if (seen.has(n)) return `Two dogs are named ${trimmed(d.call_name)}. Give each one its own name.`;
      seen.add(n);
    }
    return null;
  }
  if (step === 'common') return null;
  if (step === 'review') {
    return dogsToAdd(draft).length ? null : 'Every dog you named is already in KennelOS, so there\'s nothing new to add. Tap Change to add a different dog.';
  }
  const d = draft.dogs[stepIndex(step)];
  if (!d) return null;
  const name = dogLabel(d);
  if (step.startsWith('match:')) return d.match ? null : 'Tap one of the choices.';
  if (step.startsWith('dog:')) {
    if (blank(d.breed)) return `Type ${name}'s breed.`;
    if (!blank(d.date_of_birth) && d.date_of_birth > today) return 'The birth date can\'t be in the future.';
    if (blank(d.status)) return `Pick ${name}'s status.`;
    if (blank(d.ownership_type)) return `Whose dog is ${name}?`;
    if (OWNER_REQUIRED.includes(d.ownership_type) && !d.ownerId && blank(d.ownerName)) return `Pick ${name}'s owner, or type the owner's name.`;
    if (ctx.multiKennel && SCOPED_OWNERSHIP.has(d.ownership_type) && !(ctx.ownKennelIds || []).includes(d.kennelId)) return `Which of your kennels is ${name} under?`;
    return null;
  }
  if (step.startsWith('parents:')) {
    for (const [role, sex, w] of [['dam', 'female', 'mom'], ['sire', 'male', 'dad']]) {
      const p = d[role];
      if (p.pick === `batch:${d.key}`) return `${name} can't be ${d.sex === 'female' ? 'her' : 'his'} own ${w}.`;
      if (p.pick !== 'new') continue;
      if (blank(p.name)) return `Type the ${w}'s name, or pick "Not known".`;
      const found = dogMatches(ctx.dogs || [], { name: p.name, registeredName: p.name, sex })
        .filter((x) => norm(x.call_name) === norm(p.name) || norm(x.registered_name) === norm(p.name));
      if (found.length) return `${trimmed(p.name)} is already in KennelOS. Pick ${sex === 'female' ? 'her' : 'him'} from the list.`;
      const twin = dogsToAdd(draft).find((x) => x.sex === sex && norm(x.call_name) === norm(p.name));
      if (twin) return `${trimmed(p.name)} is one of the dogs we're adding. Pick ${sex === 'female' ? 'her' : 'him'} from the list.`;
    }
    return null;
  }
  return null;
}

// --- Review -------------------------------------------------------------------

const label = (vocab, v) => (blank(v) ? '' : descriptor(vocab, v).label);

// The parent as she'd say it, for the review. names: { dog(id) → name }.
export function parentText(p, draft, names = {}) {
  if (p.pick === 'new') return `${trimmed(p.name)} (new, for the pedigree)`;
  if (p.pick.startsWith('dog:')) return names.dog?.(p.pick.slice(4)) || 'a dog on file';
  if (p.pick.startsWith('batch:')) return dogLabel(draft.dogs.find((d) => d.key === p.pick.slice(6)) || {});
  return '';
}

// One section per dog: { title, lines, steps: { details, parents } }, then the
// dogs left as they are. names: { dog(id), contact(id), kennel(id) } for records
// on file; `kennelNames` true when she has more than one own kennel.
export function reviewSections(draft, names = {}, { kennelNames = false } = {}) {
  const sections = draft.dogs.map((d, i) => {
    if (!dogsToAdd(draft).includes(d)) return null;
    const lines = [];
    const born = blank(d.date_of_birth) ? '' : `born ${fmt(d.date_of_birth)}`;
    lines.push([label(SEX, d.sex), trimmed(d.breed), born].filter(Boolean).join(', ') + '.');
    const reg = [trimmed(d.registered_name), blank(d.registration_number) ? '' : `#${trimmed(d.registration_number)}`].filter(Boolean).join(' ');
    if (reg) lines.push(`Registered: ${reg}.`);
    const more = [blank(d.color_markings) ? '' : trimmed(d.color_markings), blank(d.microchip_id) ? '' : `microchip ${trimmed(d.microchip_id)}`].filter(Boolean);
    if (more.length) lines.push(`${more.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()));
    const owner = OWNER_REQUIRED.includes(d.ownership_type)
      ? (d.ownerId ? `, owned by ${names.contact?.(d.ownerId) || 'a contact'}` : `, owned by ${trimmed(d.ownerName)} (a new contact)`)
      : '';
    const kennel = kennelNames && SCOPED_OWNERSHIP.has(d.ownership_type) && d.kennelId ? `, ${names.kennel?.(d.kennelId) || ''}` : '';
    lines.push(`${label(DOG_STATUS, d.status)}. ${label(OWNERSHIP_TYPE, d.ownership_type)}${owner}${kennel}.`);
    const dam = parentText(d.dam, draft, names);
    const sire = parentText(d.sire, draft, names);
    lines.push(dam || sire ? `Parents: ${sire || 'dad not known'} × ${dam || 'mom not known'}.` : 'Parents: not known.');
    return {
      title: d.bringIn ? `${dogLabel(d)} (bringing in from the pedigree)` : dogLabel(d),
      lines,
      steps: { details: `dog:${i}`, parents: `parents:${i}` }
    };
  }).filter(Boolean);
  const already = dogsAlreadyIn(draft);
  if (already.length) {
    sections.push({
      title: 'Already in KennelOS',
      lines: already.map((d) => `${names.dog?.(d.match) || dogLabel(d)}: left as ${word(d.sex).pronoun} is.`),
      steps: { details: 'roster' }
    });
  }
  return sections;
}

// --- Saving -------------------------------------------------------------------

function dogFields(d) {
  const fields = {
    call_name: trimmed(d.call_name),
    sex: d.sex,
    breed: trimmed(d.breed),
    status: d.status,
    ownership_type: d.ownership_type
  };
  for (const k of ['date_of_birth', 'registered_name', 'registration_number', 'color_markings', 'microchip_id']) {
    if (!blank(d[k])) fields[k] = trimmed(d[k]);
  }
  return fields;
}

// Write everything the review listed, in order: for each dog its owner (a new
// contact), its typed parents (pedigree-only dogs), then the dog; then the
// parents that are dogs from this same batch. `onProgress(draft)` runs after
// every write so the UI keeps the draft (and its saved ids) current.
// → { made: [dog ids], notMade: [draft dogs], capError } — capError is Lite's
// CapExceededError when the cap stopped it (the rest weren't made).
export async function saveGuidedDogs(draft, { onProgress = () => {} } = {}) {
  const s = draft.saved || (draft.saved = {});
  s.contacts = s.contacts || {};
  s.parents = s.parents || {};
  s.linked = s.linked || {};
  const step = async () => { draft.updatedAt = new Date().toISOString(); await onProgress(draft); };
  const kennels = await kennelRepo.getAll({ includeArchived: false });
  const myContactId = getMyContactId();
  const myContact = myContactId ? await contactRepo.getById(myContactId) : null;
  let capError = null;

  for (const d of dogsToAdd(draft)) {
    if (d.id && d.saved) continue;
    try {
      // Someone else's dog: its owner, a new contact unless she picked one. The
      // same new name for two dogs is one contact.
      let ownerId = null;
      if (OWNER_REQUIRED.includes(d.ownership_type)) {
        ownerId = d.ownerId || s.contacts[norm(d.ownerName)] || null;
        if (!ownerId) {
          const c = await contactRepo.create({ name: trimmed(d.ownerName), contact_type: ['breeder'] });
          ownerId = s.contacts[norm(d.ownerName)] = c.id;
          await step();
        }
      } else if (d.ownership_type === 'owned' && myContact && !myContact.is_archived) {
        ownerId = myContact.id; // the Dog page's prefill for a dog she owns
      }

      // Typed parents: pedigree-only dogs, as the tidy-up makes them. The same
      // name for two dogs (littermates) is one parent.
      const parentIds = {};
      for (const [role, sex] of [['dam', 'female'], ['sire', 'male']]) {
        const p = d[role];
        if (p.pick.startsWith('dog:')) parentIds[role] = p.pick.slice(4);
        if (p.pick !== 'new') continue;
        const k = `${sex}|${norm(p.name)}`;
        if (!s.parents[k]) {
          const made = await dogRepo.create({
            call_name: trimmed(p.name), sex, breed: trimmed(d.breed),
            ownership_type: 'external', status: 'external_reference', pedigree_only: true
          });
          s.parents[k] = made.id;
          await step();
        }
        parentIds[role] = s.parents[k];
      }

      const fields = { ...dogFields(d), owner_contact_id: ownerId };
      if (parentIds.dam) fields.dam_id = parentIds.dam;
      if (parentIds.sire) fields.sire_id = parentIds.sire;
      if (SCOPED_OWNERSHIP.has(d.ownership_type)) fields.kennel_id = d.kennelId || await resolveKennelIdForWrite();
      if (d.bringIn) {
        await dogRepo.update(d.match, { ...fields, pedigree_only: false });
        d.id = d.match;
      } else if (!d.id) {
        // The Dog page's seeding: her kennel's planned tests for this breed.
        const seed = seedTestsKennel(fields, kennels);
        if (seed) fields.planned_tests = kennelRepo.testsForBreed(seed, fields.breed);
        const made = await dogRepo.create(fields);
        d.id = made.id;
      } else {
        await dogRepo.update(d.id, fields);
      }
      d.saved = true;
      await step();
    } catch (e) {
      if (e instanceof CapExceededError) { capError = e; break; }
      throw e;
    }
  }

  // Parents from this same batch, once both are made.
  const byKey = new Map(draft.dogs.map((d) => [d.key, d]));
  for (const d of dogsToAdd(draft)) {
    if (!d.id || s.linked[d.key]) continue;
    const changes = {};
    for (const role of ['dam', 'sire']) {
      const p = d[role];
      if (!p.pick.startsWith('batch:')) continue;
      const parent = byKey.get(p.pick.slice(6));
      if (parent?.id) changes[`${role}_id`] = parent.id;
    }
    if (Object.keys(changes).length) await dogRepo.update(d.id, changes);
    s.linked[d.key] = true;
    await step();
  }

  const made = dogsToAdd(draft).filter((d) => d.id && d.saved);
  draft.done = true;
  await step();
  return { made: made.map((d) => d.id), notMade: dogsToAdd(draft).filter((d) => !made.includes(d)), capError };
}

// --- After the save: when she got them -------------------------------------------
// "Did you buy any of them?" Each dog she bought gets an `acquisition` event
// (the first on its timeline, as the event form makes it: `source` the seller),
// and its price an expense linked to that event (`dog_purchase`, the event
// form's Cost). A rough date is fine; it's the date she gives.
// rows: [{ dogId, name, date, source, price }].

export const canBeBought = (d) => SCOPED_OWNERSHIP.has(d.ownership_type) && !d.pedigree_only;

export function acquisitionProblem(rows, today = todayYMD()) {
  if (!rows.length) return 'Tick the dogs you bought, or tap Skip.';
  for (const r of rows) {
    if (blank(r.date)) return `When did you get ${r.name}? A rough date is fine.`;
    if (r.date > today) return `${r.name}'s date can't be in the future.`;
    if (!blank(r.price) && !(Number(r.price) >= 0)) return `${r.name}'s price must be a number, like 2500.`;
  }
  return null;
}

export function acquisitionEvent(r) {
  const source = trimmed(r.source);
  return {
    subject_type: 'dog', subject_id: r.dogId, event_type: 'acquisition', event_date: r.date,
    title: source ? `Purchased from ${source}` : 'Purchased',
    details: source ? { source } : {}
  };
}

export async function saveAcquisitions(rows) {
  const events = [];
  for (const r of rows) {
    const ev = await eventRepo.create(acquisitionEvent(r));
    if (!blank(r.price)) await expenseRepo.createForEvent(ev, { amount: Number(r.price), category: defaultExpenseCategoryFor('acquisition') });
    events.push(ev);
  }
  return events;
}
