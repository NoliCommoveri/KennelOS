// guidedForm.test.js — Kels's "Set up my application form", its data half
// (data/guidedForm.js): where she starts, what each step refuses, the edits (add,
// remove, retype, move, FAQ), and the one save, through the REAL kennel repo
// against support/memoryDb.js. Nothing is written before the save.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let g; let wf; let kennelRepo;
let n = 0;
const id = () => `t${++n}`;

before(async () => {
  await installMemoryDb();
  g = await import('../shared/data/guidedForm.js');
  wf = await import('../shared/data/waitlistForm.js');
  ({ kennelRepo } = await import('../shared/data/kennelRepo.js'));
});

const newKennel = (config) => kennelRepo.create({ kennel_name: 'Elm', is_own_kennel: true, ...(config ? { waitlist_config: config } : {}) });

test('a kennel with no form of its own starts from the standard form, without asking', async () => {
  const k = await newKennel();
  const d = g.emptyDraft(k);
  assert.equal(d.start, 'standard');
  assert.deepEqual(g.stepsFor(d), ['locked', 'questions', 'order', 'faq', 'review']);
  assert.deepEqual(d.questions.map((x) => x.id), wf.DEFAULT_FORM_QUESTIONS.map((x) => x.id));
});

test('her own form: "where do we start?", hers or the standard one (her FAQ kept)', async () => {
  const mine = [{ id: 'yard', label: 'Fenced yard?', type: 'yes_no' }];
  const faq = [{ id: 'f1', question: 'Price?', answer: '$2,500' }];
  const k = await newKennel({ form_questions: mine, application_faq: faq });
  const d = g.emptyDraft(k);
  assert.equal(d.start, '');
  assert.deepEqual(g.stepsFor(d), ['start', 'locked', 'questions', 'order', 'faq', 'review']);
  assert.match(g.stepProblem('start', d), /Tap one/);
  g.startFrom(d, k, 'mine');
  assert.deepEqual(g.ownQuestions(d).map((x) => x.id), ['yard']);
  assert.ok(g.lockedQuestions(d).some((x) => x.key === 'email'), 'locked questions restored');
  g.startFrom(d, k, 'standard');
  assert.ok(!d.questions.some((x) => x.id === 'yard'));
  assert.deepEqual(d.faq.map((x) => x.question), ['Price?']);
});

test('edits: a new question goes above the notice; retype gives choices; locked ones never come off; move', async () => {
  const d = g.emptyDraft(await newKennel());
  const x = g.addQuestion(d, 'short_text', id);
  assert.equal(d.questions[d.questions.length - 1].type, 'notice');
  assert.equal(d.questions[d.questions.length - 2], x);
  g.setType(x, 'single_choice');
  assert.deepEqual(x.options, ['Option 1']);
  g.setType(x, 'long_text');
  assert.deepEqual(x.options, []);
  g.removeQuestion(d, 'email');
  assert.ok(d.questions.some((q) => q.id === 'email'), 'locked');
  g.removeQuestion(d, x.id);
  assert.ok(!d.questions.includes(x));
  const first = d.questions[0].id;
  g.move(d, first, -1);
  assert.equal(d.questions[0].id, first, 'nothing above the first');
  g.move(d, first, 1);
  assert.equal(d.questions[1].id, first);
});

test('steps refuse: blank locked wording, a blank or choice-less question, half an FAQ', async () => {
  const d = g.emptyDraft(await newKennel());
  g.lockedQuestions(d)[0].label = ' ';
  assert.match(g.stepProblem('locked', d), /some wording/);
  g.lockedQuestions(d)[0].label = 'Your name';
  assert.equal(g.stepProblem('locked', d), null);
  const x = g.addQuestion(d, 'checkboxes', id);
  assert.match(g.stepProblem('questions', d), /some wording/);
  x.label = 'Activities?';
  x.options = [' '];
  assert.match(g.stepProblem('questions', d), /"Activities\?" needs at least one choice/);
  x.options = ['Hiking'];
  assert.equal(g.stepProblem('questions', d), null);
  g.addFaq(d, g.FAQ_STARTERS[0], id);
  assert.match(g.stepProblem('faq', d), /Type your answer to "What is your price range\?"/);
  d.faq[0].answer = 'From $2,000.';
  assert.equal(g.stepProblem('faq', d), null);
});

test('save: one write over the latest config (other settings kept); locked questions restored; done', async () => {
  const k = await newKennel({ fee_amount: 50 });
  const d = g.emptyDraft(k);
  const x = g.addQuestion(d, 'yes_no', id);
  x.label = 'Fenced yard?';
  g.addFaq(d, 'When do puppies go home?', id).answer = 'At 8 weeks.';
  g.addFaq(d, '', id); // blank: dropped
  d.questions = d.questions.filter((q) => q.key !== 'pref_colors'); // restored by the page's rule
  await kennelRepo.update(k.id, { waitlist_config: { fee_amount: 75 } }); // changed meanwhile
  const saved = await g.saveGuidedForm(d);
  const c = saved.waitlist_config;
  assert.equal(c.fee_amount, 75);
  assert.ok(c.form_questions.some((q) => q.label === 'Fenced yard?'));
  assert.ok(c.form_questions.some((q) => q.key === 'pref_colors'));
  assert.deepEqual(c.application_faq.map((f) => f.question), ['When do puppies go home?']);
  assert.equal(d.done, true);
  assert.equal(g.pendingFormDraft(d), null);
});

test('save refuses a form that can\'t be saved, and writes nothing', async () => {
  const k = await newKennel();
  const d = g.emptyDraft(k);
  g.addQuestion(d, 'short_text', id);
  await assert.rejects(g.saveGuidedForm(d), /needs some wording/);
  assert.equal((await kennelRepo.getById(k.id)).waitlist_config?.form_questions, undefined);
});
