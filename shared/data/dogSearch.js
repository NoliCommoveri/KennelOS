// dogSearch.js — the one way Kels looks for a dog that's already on file, before
// she makes a new one (Add dogs, the litter task's new mom or dad, the tidy-up's
// parents, a typed ancestor). Pure (tests/dogSearch.test.js).
//
// 1. Names, both ways and fuzzy: every name she typed (call name, registered
//    name) against both names of every dog. Titles in front of a registered
//    name ("GCH CH …") are ignored, and so are case, spacing and punctuation.
//    A name hits when it's the same, or when every word of the shorter one is
//    in the longer one, each word the same or nearly ("Zoey" finds "Zoe", and
//    "Thornfield Zoey Mae"; "Bella" finds "Belle").
// 2. Then the other facts decide how sure it is:
//    - the same registration number is that dog (`certain`), name or not;
//    - two different registration numbers are two dogs (never offered);
//    - a sex that doesn't fit is never offered (unknown fits either);
//    - a name plus the same breed or birthday is `likely`;
//    - a name alone, or with a different breed or birthday, is `possible`.
// A registration number is compared without spaces, punctuation or an "AKC" in
// front, so "AKC SR-123456/01" and "sr12345601" are one number. Nothing here
// changes what's stored: a number or name is kept as she typed it.
import { normReg } from './pedigreeImport.js';
import { splitTitles } from './pedigreeParse.js';

const STRENGTH_ORDER = { certain: 0, likely: 1, possible: 2 };

// "GCH CH Thornfield Zoey-Mae" → "thornfield zoey mae".
export function nameKey(name) {
  const plain = splitTitles(String(name || '')).name || String(name || '');
  return plain.toLowerCase().replace(/[’‘`´']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Edit distance, for "nearly the same word".
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

// The same word, or nearly: one letter off for words of 4+ letters, or one the
// start of the other for 3+ ("zoe" / "zoey").
function wordHit(x, y) {
  if (x === y) return true;
  const short = Math.min(x.length, y.length);
  if (short >= 3 && (x.startsWith(y) || y.startsWith(x)) && Math.abs(x.length - y.length) <= 2) return true;
  return short >= 4 && lev(x, y) <= 1;
}

// 'exact' | 'partial' | null for two name keys.
export function nameHit(a, b) {
  if (!a || !b) return null;
  if (a === b) return 'exact';
  const aw = a.split(' ');
  const bw = b.split(' ');
  const [shorter, longer] = aw.length <= bw.length ? [aw, bw] : [bw, aw];
  return shorter.every((w) => longer.some((v) => wordHit(w, v))) ? 'partial' : null;
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const sexFits = (want, d) => !want || want === 'unknown' || !d.sex || d.sex === 'unknown' || d.sex === want;

// Dogs on file that may be the one she's typing, surest first:
// [{ dog, strength: 'certain'|'likely'|'possible', exact (a name the same),
//    agrees: ['registration number'|'breed'|'birthday'], differs: [...] }].
// typed: { callName, registeredName, registrationNumber, breed, dateOfBirth, sex };
// `excludeIds`: dogs not to offer (the dog itself).
export function findDogMatches(dogs, typed = {}, { excludeIds = [] } = {}) {
  const typedNames = [typed.callName, typed.registeredName].map(nameKey).filter((k) => k.length >= 2);
  const reg = normReg(typed.registrationNumber);
  const out = [];
  for (const d of dogs) {
    if (!d || d.is_archived || excludeIds.includes(d.id) || !sexFits(typed.sex, d)) continue;
    const dReg = normReg(d.registration_number);
    if (reg && dReg && reg !== dReg) continue; // two numbers, two dogs
    const sameNumber = Boolean(reg && dReg && reg === dReg);
    const dogNames = [d.call_name, d.registered_name].map(nameKey).filter(Boolean);
    let hit = null;
    for (const t of typedNames) {
      for (const n of dogNames) {
        const h = nameHit(t, n);
        if (h === 'exact') hit = 'exact';
        else if (h && !hit) hit = h;
      }
    }
    if (!sameNumber && !hit) continue;
    const agrees = [];
    const differs = [];
    if (sameNumber) agrees.push('registration number');
    if (typed.breed && d.breed) (norm(typed.breed) === norm(d.breed) ? agrees : differs).push('breed');
    if (typed.dateOfBirth && d.date_of_birth) (typed.dateOfBirth === d.date_of_birth ? agrees : differs).push('birthday');
    const strength = sameNumber ? 'certain'
      : agrees.length && !differs.length ? 'likely'
        : 'possible';
    out.push({ dog: d, strength, exact: hit === 'exact', agrees, differs });
  }
  const label = (m) => m.dog.call_name || m.dog.registered_name || '';
  return out.sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength]
    || (b.exact - a.exact) || label(a).localeCompare(label(b)));
}

// What she'll be shown about a match: "Same breed and birthday" / "Different
// breed". '' when nothing but the name.
export function matchReason(m) {
  const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
  return [
    m.agrees.length ? `Same ${list(m.agrees)}` : '',
    m.differs.length ? `Different ${list(m.differs)}` : ''
  ].filter(Boolean).join('; ');
}
