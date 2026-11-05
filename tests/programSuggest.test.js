// programSuggest.test.js — a form question that suggests one of her programs
// ("Are you a military member?" → Yes → Military): the link kept on the form, the
// "Add to [program]?" prompt while the application is open or waiting for its fee,
// and the Yes / No actions through the real repos on the in-memory database.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';
import { programSuggestions, cleanProgramLink, linkAnswerChoices, suggestionWhy } from '../shared/data/programSuggest.js';
import { formQuestions } from '../shared/data/waitlistForm.js';

const military = { id: 'p-mil', kennel_id: 'k1', name: 'Military', is_archived: false };
const programs = new Map([[military.id, military]]);
const askMil = { id: 'q_mil', label: 'Are you a military member?', type: 'yes_no', required: false, help: '', options: [], program_link: { program_id: 'p-mil', answers: ['Yes'] } };
const entry = (over = {}) => ({ id: 'e1', kennel_id: 'k1', status: 'applied', application: { name: 'Lee', q_mil: 'yes' }, ...over });

test('the form keeps a link on her yes/no or choice question, and drops a broken one', () => {
  const qs = formQuestions({ form_questions: [askMil,
    { id: 'q_txt', label: 'Notes', type: 'short_text', program_link: { program_id: 'p-mil', answers: ['Yes'] } },
    { id: 'q_pick', label: 'Branch?', type: 'single_choice', options: ['Army', 'Navy'], program_link: { program_id: 'p-mil', answers: ['Navy', 'Marines'] } },
    { id: 'q_none', label: 'Vet?', type: 'yes_no', program_link: { program_id: 'p-mil', answers: [] } }] });
  assert.deepEqual(qs.find((q) => q.id === 'q_mil').program_link, { program_id: 'p-mil', answers: ['Yes'] });
  assert.equal(qs.find((q) => q.id === 'q_txt').program_link, undefined, 'a short answer can\'t suggest');
  assert.deepEqual(qs.find((q) => q.id === 'q_pick').program_link.answers, ['Navy'], 'only answers still on the question');
  assert.equal(qs.find((q) => q.id === 'q_none').program_link, undefined, 'no answer ticked, no link');
  assert.equal(cleanProgramLink({ key: 'name', type: 'yes_no', program_link: askMil.program_link }), null, 'never a locked question');
  assert.deepEqual(linkAnswerChoices({ type: 'yes_no' }), ['Yes', 'No']);
});

test('the answer that matches suggests the program while applied or approved', () => {
  const [s] = programSuggestions(entry(), [askMil], programs);
  assert.equal(s.program.id, 'p-mil');
  assert.equal(s.answer, 'Yes');
  assert.equal(suggestionWhy(s), 'They answered “Yes” to “Are you a military member?”.');
  assert.equal(programSuggestions(entry({ status: 'approved' }), [askMil], programs).length, 1, 'still asked waiting for the fee');
  for (const status of ['active', 'declined', 'withdrawn', 'expired', 'placed']) {
    assert.equal(programSuggestions(entry({ status }), [askMil], programs).length, 0, `gone once ${status}`);
  }
});

test('no prompt for another answer, a program they have, one she said No to, or an archived one', () => {
  assert.equal(programSuggestions(entry({ application: { q_mil: 'no' } }), [askMil], programs).length, 0);
  assert.equal(programSuggestions(entry({ waitlist_program_id: 'p-mil' }), [askMil], programs).length, 0);
  assert.equal(programSuggestions(entry({ program_suggestions_declined: ['p-mil'] }), [askMil], programs).length, 0);
  assert.equal(programSuggestions(entry(), [askMil], new Map([['p-mil', { ...military, is_archived: true }]])).length, 0);
  assert.equal(programSuggestions(entry(), [askMil], new Map()).length, 0, 'a deleted program');
});

test('a checkboxes question suggests on any ticked answer; one program asked once', () => {
  const branch = { id: 'q_b', label: 'Which apply?', type: 'checkboxes', options: ['Veteran', 'Active duty', 'Neither'], program_link: { program_id: 'p-mil', answers: ['Veteran', 'Active duty'] } };
  const e = entry({ application: { q_mil: 'yes', q_b: ['Neither', 'Veteran'] } });
  const list = programSuggestions(e, [branch, askMil], programs);
  assert.equal(list.length, 1);
  assert.equal(list[0].question.id, 'q_b');
  assert.equal(list[0].answer, 'Veteran');
  assert.equal(programSuggestions(entry({ application: { q_b: 'Veteran, Neither' } }), [branch], programs).length, 1, 'an imported comma list');
});

test('Yes replaces another program, and says so', () => {
  const [s] = programSuggestions(entry({ waitlist_program_id: 'p-other' }), [askMil], programs);
  assert.match(suggestionWhy(s, { id: 'p-other', name: 'Friends' }), /Yes moves them out of Friends\./);
});

// --- The actions ----------------------------------------------------------------

let db; let kennelRepo; let waitlistEntryRepo; let waitlistProgramRepo; let contactRepo; let actions;
let K; let mil; let free; let C;

before(async () => {
  await installMemoryDb();
  ({ db } = await import('../shared/data/db.js'));
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
  ({ waitlistEntryRepo } = await import('../shared/data/waitlistEntryRepo.js'));
  ({ waitlistProgramRepo } = await import('../shared/data/waitlistProgramRepo.js'));
  ({ contactRepo } = await import('../shared/data/contactRepo.js'));
  actions = await import('../shared/data/waitlistActions.js');
});

beforeEach(async () => {
  for (const t of db.tables) await t.clear();
  K = await kennelRepo.create({ kennel_name: 'Thornfield', is_own_kennel: true, waitlist_config: { fee_amount: 300, fee_due_days: 7 } });
  mil = await waitlistProgramRepo.create({ kennel_id: K.id, name: 'Military', fee_override: 150 });
  free = await waitlistProgramRepo.create({ kennel_id: K.id, name: 'Service', fee_override: 0 });
  C = await contactRepo.create({ name: 'Lee' });
});

test('Yes on an open application just takes the program', async () => {
  const e = await waitlistEntryRepo.create({ kennel_id: K.id, status: 'applied', application: { name: 'Lee' } });
  const res = await actions.addSuggestedProgram(e.id, mil.id);
  assert.equal(res.entry.waitlist_program_id, mil.id);
  assert.equal(res.entry.status, 'applied');
  assert.equal(res.onList, false);
});

test('Yes while waiting for the fee changes the fee to the program\'s', async () => {
  const e = await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: C.id, status: 'approved', approved_date: '2026-11-02', fee_amount: 300, fee_due_date: '2026-11-11', application: { name: 'Lee' } });
  const res = await actions.addSuggestedProgram(e.id, mil.id);
  assert.equal(res.feeBefore, 300);
  assert.equal(res.feeAfter, 150);
  assert.equal(res.entry.fee_amount, 150);
  assert.equal(res.entry.fee_due_date, '2026-11-11', 'the pay-by date stays');
  assert.equal(res.entry.status, 'approved');
});

test('Yes to a program that waives the fee puts them on the list', async () => {
  const e = await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: C.id, status: 'approved', approved_date: '2026-11-02', fee_amount: 300, fee_due_date: '2026-11-11', application: { name: 'Lee' } });
  const res = await actions.addSuggestedProgram(e.id, free.id, { date: '2026-11-05' });
  assert.equal(res.onList, true);
  assert.equal(res.entry.status, 'active');
  assert.equal(res.entry.fee_received_date, '2026-11-05');
  assert.equal(res.entry.fee_payment_method, 'Waived');
  assert.equal(res.entry.fee_due_date, null);
});

test('No is remembered, and Yes is refused once they\'re on the list', async () => {
  const e = await waitlistEntryRepo.create({ kennel_id: K.id, status: 'applied', application: { name: 'Lee' } });
  await actions.declineSuggestedProgram(e.id, mil.id);
  await actions.declineSuggestedProgram(e.id, mil.id);
  assert.deepEqual((await waitlistEntryRepo.getById(e.id)).program_suggestions_declined, [mil.id]);
  const on = await waitlistEntryRepo.create({ kennel_id: K.id, contact_id: C.id, status: 'active', application: { name: 'Kim' } });
  await assert.rejects(actions.addSuggestedProgram(on.id, mil.id));
});
