// waitlistForm.test.js — her own application form (data/waitlistForm.js, Waitlist
// Spec §15.1) and the public list (waitlistRules.publicList, §15.3). The locked
// questions are what the list rules and approval depend on, so they must survive
// any edit; old answers must keep their wording; and the public list must only
// ever show the allow-listed fields, with paused families' numbers skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FORM_QUESTIONS, PUBLIC_LIST_NOTICE, formQuestions, validateQuestions, newQuestion,
  snapshotQuestions, entryQuestions, answerText, missingRequired, guessType,
  proposeQuestionImport, applyQuestionImport, columnsFor, normalizeHeader, isLocked,
  READY_TIMING_LABEL, formFaq, validateFaq, newFaqItem, matchingPrefKeys
} from '../shared/data/waitlistForm.js';
import { publicName, privateName, publicList, publicListText } from '../shared/data/waitlistRules.js';

const ids = (qs) => qs.map((x) => x.id);
let seq = 0;
const makeId = () => `t${++seq}`;

test('no stored form → the defaults, including every locked question and the notice', () => {
  const qs = formQuestions({});
  assert.deepEqual(ids(qs), ids(DEFAULT_FORM_QUESTIONS));
  for (const key of ['name', 'email', 'pref_sex', 'pref_breed', 'pref_purposes', 'pref_colors', 'ready_timing', 'public_notice']) {
    assert.ok(qs.some((x) => x.key === key), key);
  }
  assert.equal(qs.find((x) => x.key === 'public_notice').help, PUBLIC_LIST_NOTICE);
  assert.ok(!qs.some((x) => /program/i.test(x.id)), 'programs are never on the form');
});

test('a deleted locked question comes back, near its old neighbours', () => {
  const stored = DEFAULT_FORM_QUESTIONS.filter((x) => x.key !== 'email' && x.key !== 'public_notice');
  const qs = formQuestions({ form_questions: stored });
  assert.equal(qs[1].key, 'email');
  assert.equal(qs[qs.length - 1].key, 'public_notice');
});

test('a form saved with the old placement question reads it as the purposes question', () => {
  const kept = formQuestions({ form_questions: [{ id: 'pref_placement', key: 'pref_placement', label: 'Pet or show home?', type: 'preference' }] });
  const q = kept.filter((x) => x.key === 'pref_purposes');
  assert.equal(q.length, 1);
  assert.equal(q[0].label, 'Pet or show home?', 'her own wording stays');
  assert.equal(kept.some((x) => x.key === 'pref_placement'), false);
  const old = formQuestions({ form_questions: [{ id: 'pref_placement', key: 'pref_placement', label: 'Pet, show, or breeding?', type: 'preference' }] });
  assert.equal(old.find((x) => x.key === 'pref_purposes').label, DEFAULT_FORM_QUESTIONS.find((x) => x.key === 'pref_purposes').label, 'the old default wording is replaced');
});

test('locked questions can be reworded but keep their type, required flag and key', () => {
  const stored = [
    { id: 'name', key: 'name', label: 'Your full name', type: 'long_text', required: false },
    { id: 'public_notice', key: 'public_notice', label: 'Public list', type: 'short_text', help: 'Our list is public.' }
  ];
  const qs = formQuestions({ form_questions: stored });
  const name = qs.find((x) => x.key === 'name');
  assert.equal(name.label, 'Your full name');
  assert.equal(name.type, 'short_text');
  assert.equal(name.required, true);
  const notice = qs.find((x) => x.key === 'public_notice');
  assert.equal(notice.type, 'notice');
  assert.equal(notice.help, 'Our list is public.');
});

test('blank notice text falls back to her wording; unknown keys and duplicate ids are dropped', () => {
  const qs = formQuestions({ form_questions: [
    { id: 'public_notice', key: 'public_notice', help: '  ' },
    { id: 'x', key: 'program', label: 'Program', type: 'single_choice' },
    { id: 'q1', label: 'A', type: 'short_text' },
    { id: 'q1', label: 'B', type: 'short_text' },
    { id: 'q2', label: 'Sneaky', type: 'preference' }
  ] });
  assert.equal(qs.find((x) => x.key === 'public_notice').help, PUBLIC_LIST_NOTICE);
  assert.ok(!qs.some((x) => x.key === 'program'));
  assert.equal(qs.filter((x) => x.id === 'q1').length, 1);
  assert.equal(qs.find((x) => x.id === 'q2').type, 'short_text', 'a custom question can\'t take a locked-only type');
});

test('validation: wording required, choice questions need options', () => {
  const qs = [{ ...newQuestion('single_choice', makeId), label: 'Size?', options: [] }, { ...newQuestion('short_text', makeId), label: '' }];
  const problems = validateQuestions(qs);
  assert.equal(problems.length, 2);
  assert.equal(newQuestion('checkboxes', makeId).options.length, 1);
  assert.ok(newQuestion('short_text', makeId).id.startsWith('q_'));
});

test('answers keep the wording they were given under', () => {
  const form = formQuestions({});
  const snap = snapshotQuestions(form);
  assert.ok(!snap.some((x) => x.type === 'preference' || x.type === 'notice'));
  const entry = { application: { name: 'Jane', household: 'Two kids' }, application_questions: snap };
  // She later rewords "household" and deletes "other_pets".
  const later = formQuestions({ form_questions: form
    .filter((x) => x.id !== 'other_pets')
    .map((x) => (x.id === 'household' ? { ...x, label: 'Who lives with you?' } : x)) });
  const shown = entryQuestions(entry, later);
  assert.equal(shown.find((x) => x.id === 'household').label, 'Tell us about your household');
  assert.ok(shown.some((x) => x.id === 'other_pets'), 'a deleted question still shows on old entries');
});

test('an entry with no snapshot shows the current form plus stray answers', () => {
  const shown = entryQuestions({ application: { name: 'Jane', favourite_toy: 'Rope' } }, formQuestions({}));
  assert.ok(shown.some((x) => x.id === 'favourite_toy' && x.label === 'Favourite toy'));
  assert.ok(shown.some((x) => x.id === 'about'));
});

test('answer text and required checks', () => {
  assert.equal(answerText({ type: 'checkboxes' }, ['A', 'B']), 'A, B');
  assert.equal(answerText({ type: 'yes_no' }, 'yes'), 'Yes');
  assert.equal(answerText({ type: 'yes_no' }, 'FALSE'), 'No');
  const qs = formQuestions({});
  assert.deepEqual(missingRequired(qs, { email: 'a@b.c' }), ['Name'], 'manual entry only needs the name');
  assert.deepEqual(missingRequired(qs, { name: 'J' }, { manualEntry: false }), ['Email']);
});

test('type guessing from a CSV column', () => {
  assert.equal(guessType(['Yes', 'no', 'YES']).type, 'yes_no');
  assert.equal(guessType(['2', '3', '1.5']).type, 'number');
  assert.equal(guessType(['3/4/2026', '2026-01-02']).type, 'date');
  const cb = guessType(['Fenced yard, Crate', 'Crate', 'Fenced yard']);
  assert.equal(cb.type, 'checkboxes');
  assert.deepEqual(cb.options.sort(), ['Crate', 'Fenced yard']);
  const sc = guessType(['House', 'Apartment', 'House', 'House']);
  assert.equal(sc.type, 'single_choice');
  assert.equal(guessType(['x'.repeat(120)]).type, 'long_text');
  assert.equal(guessType(['Rover', 'Spot']).type, 'short_text');
});

test('importing questions from an old form: map, new, skip', () => {
  const form = formQuestions({});
  const headers = ['Timestamp', 'Full Name', 'Email Address', 'Gender', 'Do you have a fenced yard?', 'Tell us about your household', 'Why this breed?'];
  const rows = [
    { Timestamp: '2026/01/02 10:00', 'Full Name': 'Jane Smith', 'Email Address': 'j@x.com', Gender: 'Female', 'Do you have a fenced yard?': 'Yes', 'Tell us about your household': 'Two kids', 'Why this breed?': 'Love them' },
    { Timestamp: '2026/01/03 10:00', 'Full Name': 'Tom Lee', 'Email Address': 't@x.com', Gender: 'Male', 'Do you have a fenced yard?': 'No', 'Tell us about your household': 'Just me', 'Why this breed?': 'Friends have one' }
  ];
  const props = proposeQuestionImport(headers, rows, form, makeId);
  const by = Object.fromEntries(props.map((p) => [p.header, p]));
  assert.equal(by.Timestamp.action, 'skip');
  assert.equal(by['Full Name'].targetId, 'name');
  assert.equal(by['Email Address'].targetId, 'email');
  assert.equal(by.Gender.targetId, 'pref_sex');
  assert.equal(by['Tell us about your household'].targetId, 'household', 'matched by wording');
  assert.equal(by['Do you have a fenced yard?'].action, 'new');
  assert.equal(by['Do you have a fenced yard?'].question.type, 'yes_no');

  const next = applyQuestionImport(form, props);
  const yard = next.find((x) => x.label === 'Do you have a fenced yard?');
  assert.ok(yard);
  assert.equal(yard.source_header, normalizeHeader('Do you have a fenced yard?'));
  assert.equal(next[next.length - 1].type, 'notice', 'new questions go before the notice');
  assert.equal(next.find((x) => x.id === 'name').source_header, 'full_name');
  assert.deepEqual(columnsFor(next.find((x) => x.id === 'name')).slice(0, 2), ['full_name', 'name']);

  // Re-importing the same file maps every column onto what's already there.
  const again = proposeQuestionImport(headers, rows, formQuestions({ form_questions: next }), makeId);
  assert.ok(again.filter((p) => p.header !== 'Timestamp').every((p) => p.action === 'map'));
  assert.ok(isLocked(next.find((x) => x.id === 'email')));
});

// --- The public list -------------------------------------------------------------

const K = 'k1';
const TODAY = '2026-10-06';
const e = (id, fee, over = {}) => ({
  id, kennel_id: K, status: 'active', is_archived: false, fee_received_date: fee, approved_date: fee,
  created_at: `${fee}T00:00:00Z`, pref_sex: 'any', application: { name: id }, ...over
});

test('public names: first name + last initial, never more', () => {
  assert.equal(publicName('Jane Smith'), 'Jane S.');
  assert.equal(publicName('  jane  van der berg '), 'jane B.');
  assert.equal(publicName('Cher'), 'Cher');
  assert.equal(publicName(''), 'Family');
  assert.equal(publicName('Jane & Tom Smith'), 'Jane S.');
});

test('private names: first letter, an asterisk per hidden letter, last initial', () => {
  assert.equal(privateName('Andrea Kim'), 'A***** K');
  assert.equal(privateName('  jane  van der berg '), 'J*** B');
  assert.equal(privateName('Cher'), 'C***');
  assert.equal(privateName('Al'), 'A*');
  assert.equal(privateName(''), 'Family');
  assert.equal(privateName('Zoë Smith'), 'Z** S', 'counts letters, not bytes');
});

test('public list: a family she let list privately shows masked, same place', () => {
  const entries = [
    e('Ann Avery', '2026-01-01'),
    e('Andrea Kim', '2026-02-01', { private_listing: true }),
    e('Bob Burns', '2026-03-01', { private_request: { requested_date: '2026-02-01' } })
  ];
  const rows = publicList(entries, K, new Map(), { today: TODAY, nameOf: (x) => x.application.name });
  assert.deepEqual(rows.map((r) => `${r.position} ${r.name}`), ['1 Ann A.', '2 A***** K', '3 Bob B.'], 'a request alone changes nothing');
  assert.ok(!/Andrea|Kim/.test(publicListText(rows, {})));
});

test('public list: real positions, paused families hidden with their number skipped', () => {
  const entries = [
    e('Ann Avery', '2026-01-01'),
    e('Bob Burns', '2026-02-01', { pref_sex: 'male' }),
    e('Cat Cole', '2026-03-01', { paused_until: '2026-12-01', pause_reason: 'Chemo' }),
    e('Dee Dunn', '2026-04-01', { listen_mode: 'selected', listen_dam_ids: ['D1'] }),
    e('Eve Ely', '2026-05-01', { status: 'applied' }),
    e('Fay Fox', '2026-06-01', { kennel_id: 'other' })
  ];
  const rows = publicList(entries, K, new Map(), { today: TODAY, nameOf: (x) => x.application.name });
  assert.deepEqual(rows.map((r) => r.position), [1, 2, 4]);
  assert.deepEqual(rows.map((r) => r.name), ['Ann A.', 'Bob B.', 'Dee D.']);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['added', 'name', 'position', 'pref_sex']);
  assert.equal(rows[1].pref_sex, 'male');

  // When the pause ends, she reappears at #3 and nobody else's number moves.
  const later = publicList(entries, K, new Map(), { today: '2026-12-02', nameOf: (x) => x.application.name });
  assert.deepEqual(later.map((r) => `${r.position} ${r.name}`), ['1 Ann A.', '2 Bob B.', '3 Cat C.', '4 Dee D.']);

  const text = publicListText(rows, { kennelName: 'Thornfield', today: TODAY });
  assert.match(text, /^Thornfield Waitlist \(updated 2026-10-06\)/);
  assert.match(text, /#4 Dee D\. · Either · added 2026-04-01/);
  assert.match(text, /Their place is being held/);
  assert.ok(!/Chemo|Cat/.test(text));
  assert.match(publicListText([], {}), /No families to show right now/);

  // The family holding a turn (decided 2026-10-10): their row stays at their number,
  // highlighted online, with their sex and date but "Currently deciding" for the name.
  const turn = publicList(entries, K, new Map(), { today: TODAY, nameOf: (x) => x.application.name, deciding: (x) => x.application.name === 'Bob Burns' });
  assert.deepEqual(turn[1], { position: 2, name: 'Currently deciding', pref_sex: 'male', added: '2026-02-01', deciding: true });
  const turnText = publicListText(turn, {});
  assert.match(turnText, /^#2 Currently deciding · Male · added 2026-02-01$/m);
  assert.ok(!/Bob/.test(turnText));
});

test('readiness is a locked, required question her older stored forms get back', () => {
  const stored = DEFAULT_FORM_QUESTIONS.filter((x) => x.key !== 'ready_timing');
  const qs = formQuestions({ form_questions: [...stored.map((x) => ({ ...x })), ] });
  const ready = qs.find((x) => x.key === 'ready_timing');
  assert.ok(ready, 'put back');
  assert.equal(qs[qs.indexOf(ready) - 1].key, 'pref_colors', 'right after the colors question');
  assert.equal(ready.label, READY_TIMING_LABEL);
  assert.equal(ready.required, true);
  assert.equal(ready.type, 'preference');
  const reworded = formQuestions({ form_questions: [{ id: 'ready_timing', key: 'ready_timing', label: 'When could you buy?', type: 'short_text', required: false }] })
    .find((x) => x.key === 'ready_timing');
  assert.equal(reworded.label, 'When could you buy?');
  assert.equal(reworded.type, 'preference');
  assert.equal(reworded.required, true);
});

test('FAQ: blank items dropped, half-filled items block saving', () => {
  const faq = formFaq({ application_faq: [
    { id: 'a', question: ' Price? ', answer: '$2,500 ' },
    { id: 'b', question: '', answer: '' },
    null,
    { question: 'How it works', answer: 'In order.' }
  ] });
  assert.deepEqual(faq, [
    { id: 'a', question: 'Price?', answer: '$2,500' },
    { id: 'faq_3', question: 'How it works', answer: 'In order.' }
  ]);
  assert.deepEqual(formFaq({}), []);
  assert.equal(validateFaq([{ question: 'Q', answer: '' }, { question: '', answer: '' }, { question: 'Q', answer: 'A' }]).length, 1);
  assert.ok(newFaqItem(() => 'x').id === 'faq_x');
});

test('matching notice covers the offer-filtering preferences; colors only with color matching on', () => {
  assert.deepEqual(matchingPrefKeys({}), ['pref_sex', 'pref_breed', 'pref_purposes']);
  assert.deepEqual(matchingPrefKeys({ color_matching: true }), ['pref_sex', 'pref_breed', 'pref_purposes', 'pref_colors']);
  assert.ok(!matchingPrefKeys({ color_matching: true }).includes('ready_timing'));
});
