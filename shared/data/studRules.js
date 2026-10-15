// studRules.js — what a stud service means for the breedings and puppies around
// it (pure; no reads or writes). Read by Today's nudges, the Pairing page, Kels's
// tidy-up and the Dog page, so they agree.
//
// Which dog is the stud isn't stored: it's our dog's sex (`ourRole`: male → our
// stud, female → our dam; the partner's sex when ours has none). `direction` is
// only who travels (vocab STUD_SERVICE_DIRECTION).
//
// With OUR STUD on somebody else's dam, the breeding (Pairing) can still be
// recorded and linked, but the litter is the dam's owner's: nothing asks her to
// record it (`ourStudPairingIds`). When the fee includes a pick of the litter, the
// pick puppy is ours: from 63 days (whelping) + 56 days (ready to leave) after the
// service, Today asks whether it's ready to add to her dogs (`pickDue`), until a
// puppy of that stud out of that dam is on file or the pick is settled.
import { addDaysToYMD } from './dateUtils.js';

export const PICK_FEE_STRUCTURES = ['pick_of_litter', 'flat_plus_pick'];
export const WHELP_DAYS = 63;
export const READY_DAYS = 56;
// pick_status is free text ("pending / claimed" suggested); these end the
// reminder: she has the pick, or isn't getting one ('waived', Today's "Not getting one").
const PICK_SETTLED = ['claimed', 'received', 'picked', 'done', 'waived'];

const ymd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

// `dogs`: a Map of id → dog, or an array of dogs.
const lookup = (dogs) => (dogs instanceof Map ? dogs : new Map((dogs || []).map((d) => [d.id, d])));

// Our dog's part: 'stud' | 'dam' | null (neither dog has a sex on file).
export function ourRole(s, dogs) {
  const byId = lookup(dogs);
  const ours = byId.get(s?.our_dog_id)?.sex;
  if (ours === 'male') return 'stud';
  if (ours === 'female') return 'dam';
  const theirs = byId.get(s?.partner_dog_id)?.sex;
  if (theirs === 'female') return 'stud';
  if (theirs === 'male') return 'dam';
  return null;
}

// The breeding's two dogs. → { sireId, damId }, or null when the role isn't known.
export function studParents(s, dogs) {
  const role = ourRole(s, dogs);
  if (role === 'stud') return { sireId: s.our_dog_id, damId: s.partner_dog_id };
  if (role === 'dam') return { sireId: s.partner_dog_id, damId: s.our_dog_id };
  return null;
}

// The dog that travels: ours (to_partner), theirs (to_us), or null (shipped).
export const travellingDogId = (s) => (s?.direction === 'to_partner' ? s.our_dog_id : s?.direction === 'to_us' ? s.partner_dog_id : null);

// Pairing ids linked to a live stud service where our dog is the stud. → Set
export function ourStudPairingIds(services, dogs) {
  const byId = lookup(dogs);
  return new Set((services || []).filter((s) => s && !s.is_archived && s.pairing_id && ourRole(s, byId) === 'stud').map((s) => s.pairing_id));
}

// The date the service finished, for counting to the pick: returned, else sent. → YMD or null
export const serviceDate = (s) => (ymd(s?.returned_date) ? s.returned_date : ymd(s?.sent_date) ? s.sent_date : null);

// When the pick puppy should be ready: the service date + 63 + 56 days. → YMD or null
export const pickReadyDate = (s) => (serviceDate(s) ? addDaysToYMD(serviceDate(s), WHELP_DAYS + READY_DAYS) : null);

// A puppy of this stud out of this dam, born on or after the service: the pick is on file.
export const pickPupOnFile = (s, dogs) => (dogs || []).some((d) => !d.pedigree_only
  && d.sire_id === s.our_dog_id && d.dam_id === s.partner_dog_id
  && (!ymd(d.date_of_birth) || !serviceDate(s) || d.date_of_birth >= serviceDate(s)));

// A completed stud service of our stud with a pick in its fee whose pick should be
// ready by `today`, not yet on file or settled. `dogs`: every dog (archived too).
export function pickDue(s, dogs, today) {
  if (!s || s.is_archived || s.status !== 'completed' || ourRole(s, dogs) !== 'stud') return false;
  if (!PICK_FEE_STRUCTURES.includes(s.fee_structure) || !s.our_dog_id || !s.partner_dog_id) return false;
  if (PICK_SETTLED.includes(String(s.pick_status || '').trim().toLowerCase())) return false;
  const ready = pickReadyDate(s);
  if (!ready || today < ready) return false;
  return !pickPupOnFile(s, dogs);
}

// The new pick puppy's starting fields (the Dog page's ?pick=<stud service id>):
// ours, a puppy, sired by our stud out of her dam, the stud's breed and kennel,
// born about 63 days after the service (marked estimated, for her to correct).
export function pickPupDefaults(s, stud) {
  const born = serviceDate(s) ? addDaysToYMD(serviceDate(s), WHELP_DAYS) : '';
  return {
    sire_id: s.our_dog_id || '', dam_id: s.partner_dog_id || '',
    ...(born ? { date_of_birth: born, dob_is_estimated: true } : {}),
    status: 'puppy', ownership_type: 'owned', disposition: 'keeping',
    breed: stud?.breed || '', kennel_id: s.kennel_id || stud?.kennel_id || ''
  };
}
