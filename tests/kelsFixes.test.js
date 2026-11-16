// kelsFixes.test.js — review fix step 11 (K11, Kels and the guided tasks): a draft
// over records that are gone (K11-2), a litter recorded since (K11-3), the
// helper's entries imported again (K11-4), the form changed on its page (K11-7),
// the remembered vet answer (K11-15), Getting Started's place and puppy records
// (K11-11, K11-12), a draft an update can't keep (K11-16) and the tour's place by
// step id (K11-18).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryDb } from './support/memoryDb.js';

let tables, G, settings, ie, assist, form, people, setup, prf, wizard, WIZARD_STEPS;

before(async () => {
  ({ tables } = await installMemoryDb());
  G = await import('../shared/data/guidedLitter.js');
  settings = await import('../shared/data/settings.js');
  ie = await import('../shared/data/importExport.js');
  assist = await import('../shared/data/assistantSync.js');
  form = await import('../shared/data/guidedForm.js');
  people = await import('../shared/data/guidedPeople.js');
  setup = await import('../shared/data/kelsSetup.js');
  prf = await import('../shared/data/puppyRecordFields.js');
  wizard = await import('../shared/data/wizardState.js');
  ({ WIZARD_STEPS } = await import('../shared/data/editionTour.js'));
});

beforeEach(() => {
  for (const t of Object.values(tables)) t.rows.clear();
  localStorage.clear();
});

// --- K11-2 -----------------------------------------------------------------------

const hasOnly = (ids) => (kind, id) => ids.includes(`${kind}:${id}`);

test('a draft whose mom and dad are gone asks for them again, keeping the rest', () => {
  const d = { ...G.emptyDraft(), damId: 'bella', sireId: 'duke', litterChoice: 'L1', whelpDate: '2026-11-01', alive: '3', kennelId: 'k1' };
  d.pups = [{ key: 'a', id: null }, { key: 'b', id: 'oldpup' }];
  const has = hasOnly(['kennel:k1']);
  const { gone, madeGone } = G.goneDraftRefs(d, has);
  assert.deepEqual(gone, ['mom', 'dad', 'litter']);
  assert.equal(madeGone, false);
  G.clearGoneDraftRefs(d, has);
  assert.deepEqual([d.damId, d.sireId, d.litterChoice, d.kennelId], [null, null, null, 'k1']);
  assert.equal(d.whelpDate, '2026-11-01');
  assert.equal(d.pups[1].id, null);
});

test('a draft whose save already made a record that is gone cannot be finished', () => {
  const d = { ...G.emptyDraft(), damId: 'bella', sireId: 'duke', saved: { litterId: 'L-made' } };
  assert.equal(G.goneDraftRefs(d, hasOnly(['dog:bella', 'dog:duke'])).madeGone, true);
  assert.equal(G.goneDraftRefs(d, hasOnly(['dog:bella', 'dog:duke', 'litter:L-made'])).madeGone, false);
});

test('a Replace restore and Clear sample data drop every Kels draft', async () => {
  settings.setGuidedLitterDraft({ v: 2, step: 'review' });
  settings.setGuidedDogsDraft({ v: 2 });
  settings.setGuidedPeopleDraft({ v: 1 });
  settings.setGuidedFormDraft({ v: 1 });
  const file = { schema_version: 1, collections: { kennels: [{ id: 'k', kennel_name: 'K', is_own_kennel: true, created_at: 'x', updated_at: 'x' }] } };
  await ie.restoreBackup(file, 'merge');
  assert.ok(settings.getGuidedLitterDraft(), 'a merge keeps them');
  await ie.restoreBackup(file, 'replace');
  assert.deepEqual([settings.getGuidedLitterDraft(), settings.getGuidedDogsDraft(), settings.getGuidedPeopleDraft(), settings.getGuidedFormDraft()], [null, null, null, null]);

  const { seedSampleData, clearSampleData } = await import('../shared/data/sampleData.js');
  for (const t of Object.values(tables)) t.rows.clear();
  await seedSampleData();
  settings.setGuidedLitterDraft({ v: 2, step: 'review' });
  const res = await clearSampleData({ archiveConflicting: true });
  assert.equal(res.cleared, true);
  assert.equal(settings.getGuidedLitterDraft(), null);
});

// --- K11-3 -----------------------------------------------------------------------

test('a litter of the same parents recorded since the draft began is found', () => {
  const d = { ...G.emptyDraft(), damId: 'bella', sireId: 'duke', whelpDate: '2026-11-02', startedAt: '2026-11-10T00:00:00.000Z' };
  const litter = (over) => ({ id: 'x', dam_id: 'bella', sire_id: 'duke', whelp_date: '2026-11-01', created_at: '2026-11-11T00:00:00.000Z', is_archived: false, ...over });
  assert.equal(G.litterRecordedSince(d, [litter()])?.id, 'x');
  assert.equal(G.litterRecordedSince(d, [litter({ created_at: '2026-11-01T00:00:00.000Z' })]), null, 'older than the draft: the match step asks');
  assert.equal(G.litterRecordedSince(d, [litter({ whelp_date: '2026-10-01' })]), null, 'a different litter of theirs');
  assert.equal(G.litterRecordedSince({ ...d, notThisLitter: 'x' }, [litter()]), null, 'she said it isn\'t this one');
  assert.equal(G.litterRecordedSince({ ...d, saved: { litterId: 'x' } }, [litter()]), null, 'the one this draft made');
});

// --- K11-4 -----------------------------------------------------------------------

test('an entry already imported is left as she has it; one she deleted is not New', () => {
  const ev = { id: 'e1', updated_at: '2026-11-01T00:00:00.000Z' };
  const mine = { id: 'e1', updated_at: '2026-11-02T00:00:00.000Z' };
  assert.equal(assist.outboxStatus(ev, { dog: {}, existing: mine }), 'already');
  assert.equal(assist.outboxStatus({ ...ev, updated_at: '2026-11-03T00:00:00.000Z' }, { dog: {}, existing: mine }), 'update');
  assert.equal(assist.outboxStatus(ev, { dog: {}, imported: new Set(['e1']) }), 'removed');
  assert.equal(assist.outboxStatus(ev, { dog: {} }), 'new');
});

test('importing writes only new and changed entries, and remembers them', async () => {
  tables.events.rows.set('e1', { id: 'e1', subject_type: 'dog', subject_id: 'd', event_type: 'weight', event_date: '2026-11-01', title: 'Weight', details: { weight_lbs: 2 }, notes: 'fixed it', updated_at: '2026-11-02T00:00:00.000Z' });
  const rows = [
    { status: 'already', event: { id: 'e1', subject_type: 'dog', subject_id: 'd', event_type: 'weight', event_date: '2026-11-01', title: 'Weight', details: { weight_lbs: 12 } } },
    { status: 'new', event: { id: 'e2', subject_type: 'dog', subject_id: 'd', event_type: 'weight', event_date: '2026-11-03', title: 'Weight', pending: 1 } }
  ];
  const result = await assist.importAssistantEvents(rows);
  assert.equal(result.imported, 1);
  assert.equal(tables.events.rows.get('e1').details.weight_lbs, 2, 'her correction stays');
  assert.equal(tables.events.rows.get('e1').notes, 'fixed it');
  assert.equal('pending' in tables.events.rows.get('e2'), false);
  assert.deepEqual(settings.getAssistantImportedIds(), ['e2']);
});

// --- K11-7 -----------------------------------------------------------------------

test('a form draft knows when the saved form changed since it began', () => {
  const kennel = { id: 'k', kennel_name: 'K', waitlist_config: {} };
  const draft = form.emptyDraft(kennel);
  assert.equal(form.formChangedSince(draft, kennel), false);
  const changed = { ...kennel, waitlist_config: { application_faq: [{ id: 'f1', question: 'When?', answer: 'Spring' }] } };
  assert.equal(form.formChangedSince(draft, changed), true);
  form.keepDraftOverSaved(draft, changed);
  assert.equal(form.formChangedSince(draft, changed), false, 'asked once');
  const again = form.emptyDraft(kennel);
  form.restartFromSaved(again, changed);
  assert.equal(again.faq[0].answer, 'Spring');
});

// --- K11-15 ----------------------------------------------------------------------

test('"No vet to add" in Tidy up stops Add people asking', () => {
  const draft = people.emptyDraft();
  assert.ok(people.stepsFor(draft, { contacts: [] }).includes('vet'));
  assert.ok(!people.stepsFor(draft, { contacts: [], vetDeclined: true }).includes('vet'));
  assert.equal(people.NO_VET_KEY, 'tidy:novet');
});

// --- K11-11, K11-12 --------------------------------------------------------------------

test('Getting Started picks up at the first part not answered', () => {
  const parts = ['logo', 'nudges', 'tests', 'puppy-record', 'backup'];
  assert.equal(setup.resumeSetupAt(parts, []), 0);
  assert.equal(setup.resumeSetupAt(parts, ['logo', 'nudges']), 2);
  assert.equal(setup.resumeSetupAt(parts, parts), 0);
  settings.markKelsSetupPart('k1', 'logo');
  assert.deepEqual(settings.getKelsSetupDone('k1').parts, ['logo']);
  settings.markKelsSetupPart('k1', 'backup', { complete: true });
  assert.equal(settings.anyKelsSetupComplete(), true);
  assert.equal(setup.setupPriority({ dogs: [], complete: true }), setup.SETUP_PRIORITY);
  assert.equal(setup.setupPriority({ dogs: [] }), setup.SETUP_PRIORITY_NEW);
});

test('the puppy record part can say what is left off now', () => {
  assert.deepEqual(prf.puppyRecordLeftOff({ puppy_record_fields: null }), []);
  const left = prf.puppyRecordLeftOff({ puppy_record_fields: { buyer: false, microchip: false } });
  assert.ok(left.includes('Buyer'));
  assert.ok(left.includes('Puppy Information: Microchip ID'));
});

// --- K11-16 ----------------------------------------------------------------------

test('a draft an update can\'t keep is let go with a word', () => {
  settings.setGuidedLitterDraft({ v: 1, label: 'Bella\'s litter', saved: { litterId: 'L1' } });
  settings.retireDraft('guidedLitterDraft', settings.getGuidedLitterDraft(), 'litter');
  assert.equal(settings.getGuidedLitterDraft(), null);
  const [note] = settings.takeKelsDraftNotice();
  assert.match(note, /Bella's litter.*already saved/);
  assert.deepEqual(settings.takeKelsDraftNotice(), [], 'said once');
});

// --- K11-18 ----------------------------------------------------------------------

test('the tour keeps its place by step id', () => {
  wizard.startWizard();
  wizard.advanceWizard();
  wizard.advanceWizard();
  const at = WIZARD_STEPS[2].id;
  assert.equal(settings.getWizardStepIdRaw(), at);
  // A release moved the stops: the stored index points elsewhere, the id still finds it.
  settings.setWizardStepIndexRaw(0);
  assert.equal(wizard.currentStep().id, at);
});
