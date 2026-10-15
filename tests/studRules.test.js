// studRules.test.js — our stud's outside breedings (outgoing stud services): their
// litters are never asked for, and a pick-of-litter fee brings a "ready to add your
// pick puppy?" reminder 63 + 56 days after the service (shared/data/studRules.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../shared/data/studRules.js';

const DOGS = [{ id: 'stud', sex: 'male' }, { id: 'dam', sex: 'female' }, { id: 'ourDam', sex: 'female' }, { id: 'theirStud', sex: 'male' }];
const svc = (o = {}) => ({ id: 's', direction: 'to_us', status: 'completed', fee_structure: 'pick_of_litter', our_dog_id: 'stud', partner_dog_id: 'dam', sent_date: '2026-01-01', returned_date: '2026-01-05', ...o });

test('ourRole: our dog\'s sex, else the partner\'s opposite', () => {
  assert.equal(S.ourRole(svc(), DOGS), 'stud');
  assert.equal(S.ourRole(svc({ our_dog_id: 'ourDam', partner_dog_id: 'theirStud' }), DOGS), 'dam');
  assert.equal(S.ourRole(svc({ our_dog_id: 'x' }), DOGS), 'stud', 'ours has no sex: the partner is the dam');
  assert.equal(S.ourRole(svc({ our_dog_id: 'x', partner_dog_id: 'y' }), DOGS), null);
  assert.deepEqual(S.studParents(svc({ our_dog_id: 'ourDam', partner_dog_id: 'theirStud' }), DOGS), { sireId: 'theirStud', damId: 'ourDam' });
});

test('who travels: either way for either role', () => {
  assert.equal(S.travellingDogId(svc({ direction: 'to_partner' })), 'stud');
  assert.equal(S.travellingDogId(svc({ direction: 'to_us' })), 'dam');
  assert.equal(S.travellingDogId(svc({ direction: 'shipped' })), null);
});

test('ourStudPairingIds: live services where our dog is the stud, with a breeding', () => {
  const ids = S.ourStudPairingIds([svc({ pairing_id: 'p1' }), svc({ pairing_id: 'p2', our_dog_id: 'ourDam', partner_dog_id: 'theirStud' }), svc({ pairing_id: 'p3', is_archived: true }), svc()], DOGS);
  assert.deepEqual([...ids], ['p1']);
});

test('pick ready 63 + 56 days after the service (returned, else sent)', () => {
  assert.equal(S.pickReadyDate(svc()), '2026-05-04');
  assert.equal(S.pickReadyDate(svc({ returned_date: null })), '2026-04-30');
  assert.equal(S.pickReadyDate(svc({ returned_date: null, sent_date: null })), null);
});

test('pickDue: outgoing, completed, a pick in the fee, ready, not on file or settled', () => {
  assert.equal(S.pickDue(svc(), DOGS, '2026-05-03'), false, 'not ready yet');
  assert.equal(S.pickDue(svc(), DOGS, '2026-05-04'), true);
  assert.equal(S.pickDue(svc({ fee_structure: 'flat_plus_pick' }), DOGS, '2026-06-01'), true);
  assert.equal(S.pickDue(svc({ fee_structure: 'flat_fee' }), DOGS, '2026-06-01'), false);
  assert.equal(S.pickDue(svc({ our_dog_id: 'ourDam', partner_dog_id: 'theirStud' }), DOGS, '2026-06-01'), false, 'their pick from our litter isn\'t ours to add');
  assert.equal(S.pickDue(svc({ status: 'in_progress' }), DOGS, '2026-06-01'), false);
  assert.equal(S.pickDue(svc({ pick_status: 'Claimed' }), DOGS, '2026-06-01'), false);
  assert.equal(S.pickDue(svc({ pick_status: 'waived' }), DOGS, '2026-06-01'), false);
  assert.equal(S.pickDue(svc({ pick_status: 'pending' }), DOGS, '2026-06-01'), true);
});

test('a pup of that stud out of that dam, born after the service, settles it', () => {
  const pup = { id: 'pup', sire_id: 'stud', dam_id: 'dam', date_of_birth: '2026-03-07' };
  assert.equal(S.pickDue(svc(), [...DOGS, pup], '2026-06-01'), false);
  assert.equal(S.pickDue(svc(), [...DOGS, { ...pup, date_of_birth: '2025-03-07' }], '2026-06-01'), true, 'an older litter of the same pair');
  assert.equal(S.pickDue(svc(), [...DOGS, { ...pup, pedigree_only: true }], '2026-06-01'), true);
  assert.equal(S.pickDue(svc(), [...DOGS, { ...pup, dam_id: 'other' }], '2026-06-01'), true);
});

test('pickPupDefaults: ours, a puppy, the pair, the stud\'s breed, estimated birth', () => {
  assert.deepEqual(S.pickPupDefaults(svc({ kennel_id: 'K' }), { breed: 'Boston Terrier' }), {
    sire_id: 'stud', dam_id: 'dam', date_of_birth: '2026-03-09', dob_is_estimated: true,
    status: 'puppy', ownership_type: 'owned', disposition: 'keeping', breed: 'Boston Terrier', kennel_id: 'K'
  });
});
