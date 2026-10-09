// waitlistInbox.test.js — an online application becoming an `applied` entry on
// her device (shared/data/waitlistInbox.js, W2 Plan step 4). The applicant's
// browser is untrusted: only her questions, her choices and the vocab get through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicationToEntry, arrivalDate, ANSWER_LIMITS } from '../shared/data/waitlistInbox.js';
import { formQuestions } from '../shared/data/waitlistForm.js';

const kennel = { id: 'k1', time_zone: 'America/Chicago' };
const form = formQuestions({
  form_questions: [
    ...formQuestions({}),
    { id: 'q_yard', label: 'Fenced yard?', type: 'yes_no' },
    { id: 'q_size', label: 'Home size', type: 'single_choice', options: ['House', 'Apartment'] },
    { id: 'q_pets', label: 'Pets', type: 'checkboxes', options: ['Dog', 'Cat'] },
    { id: 'q_kids', label: 'Children', type: 'number' },
    { id: 'q_move', label: 'Moving date', type: 'date' }
  ]
});
const item = { id: 'inbox-1', name: 'Ann Lee', email: 'Ann@Example.com', createdAt: '2026-10-09T03:30:00.000Z', statusToken: 'a'.repeat(64) };

test('a clean application becomes an applied entry with its link, answers and preferences', () => {
  const e = applicationToEntry(item, {
    answers: { name: 'Ann Lee', email: 'ann@example.com', phone: '555-0100', about: 'We love Bostons', q_yard: 'yes', q_size: 'House', q_pets: ['Dog'], q_kids: '2', q_move: '2026-12-01' },
    prefs: { pref_sex: 'female', pref_breed: 'boston terrier', pref_purposes: ['show', 'pet', 'zoo'], pref_colors: ['Brindle'], ready_timing: '3_months' }
  }, { kennel, form, breeds: ['Boston Terrier'] });
  assert.equal(e.id, 'inbox-1');
  assert.equal(e.kennel_id, 'k1');
  assert.equal(e.status, 'applied');
  assert.equal(e.applied_date, '2026-10-08', 'the arrival day in the kennel\'s time zone');
  assert.equal(e.status_token, 'a'.repeat(64));
  assert.equal(e.source, 'online_form');
  assert.deepEqual(e.application, {
    name: 'Ann Lee', email: 'ann@example.com', phone: '555-0100', about: 'We love Bostons',
    q_yard: 'yes', q_size: 'House', q_pets: ['Dog'], q_kids: '2', q_move: '2026-12-01'
  });
  assert.equal(e.pref_sex, 'female');
  assert.equal(e.pref_breed, 'Boston Terrier', 'her spelling');
  assert.deepEqual(e.pref_purposes, ['pet', 'show'], 'known purposes only, in vocab order');
  assert.deepEqual(e.pref_colors, ['Brindle']);
  assert.equal(e.ready_timing, '3_months');
  assert.ok(e.application_questions.some((q) => q.id === 'q_size'));
});

test('anything off-form, off-choice, oversized or not in the vocab is dropped', () => {
  const e = applicationToEntry(item, {
    answers: {
      email: 'evil@example.com', notes: 'sneaky', status: 'active', q_size: 'Castle', q_pets: ['Dog', 'Lion', 7],
      q_yard: 'maybe', q_kids: 'lots', q_move: 'soon', about: 'x'.repeat(ANSWER_LIMITS.long + 50), phone: { a: 1 }
    },
    prefs: { pref_sex: 'puppy', pref_breed: 'Poodle', pref_purposes: 'pet', ready_timing: 'never', pref_colors: 'red', listen_mode: 'selected' },
    status: 'active', contact_id: 'c1'
  }, { kennel, form, breeds: ['Boston Terrier'] });
  assert.equal(e.application.email, 'ann@example.com', 'the address the server checked, not the sealed one');
  assert.equal('notes' in e.application, false);
  assert.equal('status' in e.application, false);
  assert.equal(e.application.q_size, '');
  assert.deepEqual(e.application.q_pets, ['Dog']);
  assert.equal(e.application.q_yard, '');
  assert.equal(e.application.q_kids, '');
  assert.equal(e.application.q_move, '');
  assert.equal(e.application.about.length, ANSWER_LIMITS.long);
  assert.equal(e.application.phone, '');
  assert.equal(e.status, 'applied');
  assert.equal('contact_id' in e, false);
  assert.equal(e.pref_sex, 'any');
  assert.equal(e.pref_breed, '', 'a breed she doesn\'t have matches nothing, so it\'s left blank');
  assert.deepEqual(e.pref_purposes, []);
  assert.equal(e.ready_timing, null);
  assert.deepEqual(e.pref_colors, []);
  assert.equal(e.listen_mode, 'all');
});

test('a missing or junk payload still gives an entry with the name the server held', () => {
  const e = applicationToEntry({ ...item, statusToken: null }, null, { kennel, form });
  assert.equal(e.application.name, 'Ann Lee');
  assert.equal('status_token' in e, false);
  assert.equal(arrivalDate('nonsense', 'UTC'), null);
  assert.equal(arrivalDate('2026-10-09T03:30:00.000Z', 'Not/AZone'), '2026-10-09');
});
