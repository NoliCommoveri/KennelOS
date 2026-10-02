// vocab.test.js — the edition-aware event-type list (Show Tracking Spec §7).
// The shared editionConfig is the Pro default (every flag on), so here the
// `show` type must be offered; the "flag off" half is exercised by flipping the
// imported flags object (a live binding — vocab reads it at call time).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES, enabledEventTypes, eventTypesFor, descriptor, defaultExpenseCategoryFor, EXPENSE_CATEGORIES, CONTACT_TYPE } from '../shared/data/vocab.js';
import { editionFlags } from '../shared/data/editionConfig.js';

test('show is offered for dogs when editionFlags.shows is on', () => {
  assert.ok(enabledEventTypes().some((t) => t.value === 'show'));
  assert.ok(eventTypesFor('dog').some((t) => t.value === 'show'));
  assert.ok(!eventTypesFor('litter').some((t) => t.value === 'show'), 'show is dog-subject only');
});

test('show disappears from every type list when its flag is off, but still resolves for badges', () => {
  const was = editionFlags.shows;
  editionFlags.shows = false;
  try {
    assert.ok(!enabledEventTypes().some((t) => t.value === 'show'));
    assert.ok(!eventTypesFor('dog').some((t) => t.value === 'show'));
    // EVENT_TYPES stays complete so a show event restored from a Pro backup still labels.
    assert.ok(EVENT_TYPES.some((t) => t.value === 'show'));
    assert.equal(descriptor(EVENT_TYPES, 'show').label, 'Show');
  } finally {
    editionFlags.shows = was;
  }
});

test('every editionFlag a type names is declared in the shared editionConfig', () => {
  for (const t of EVENT_TYPES.filter((x) => x.editionFlag)) {
    assert.ok(t.editionFlag in editionFlags, `${t.value}: editionFlag "${t.editionFlag}" not declared`);
  }
});

test('show costs default to the show expense category; handler is a contact role', () => {
  assert.equal(defaultExpenseCategoryFor('show'), 'show');
  assert.ok(EXPENSE_CATEGORIES.some((c) => c.value === 'show'));
  assert.ok(CONTACT_TYPE.some((c) => c.value === 'handler'));
});

test('every field default on a type is one of that field\'s own options', () => {
  for (const t of EVENT_TYPES) {
    for (const f of t.fields.filter((x) => x.default !== undefined && x.options)) {
      const values = f.options.map((o) => (o && typeof o === 'object' ? o.value : o));
      assert.ok(values.includes(f.default), `${t.value}.${f.key}: default "${f.default}" not in options`);
    }
  }
});
