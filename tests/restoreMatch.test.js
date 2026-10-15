// restoreMatch.test.js — the rules that pair records each device entered on its
// own (data/restoreMatch.js, End-State guide §10), the merge of a pair, and the
// re-key that gives a pair one id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMatches, mergePair, rekey, askKey } from '../shared/data/restoreMatch.js';

const r = (id, extra = {}) => ({ id, is_archived: false, updated_at: '2026-01-01T00:00:00Z', ...extra });
const plan = (local, incoming, answers) => planMatches({ local, incoming, answers });
const pairsOf = (p, table) => p.pairs.filter((x) => x.table === table).map((x) => [x.localId, x.fileId]);

test('kennels: her own by name or public id; one each with different names is a question; outside by name', () => {
  assert.deepEqual(pairsOf(plan({ kennels: [r('a', { kennel_name: 'Thornfield', is_own_kennel: true })] },
    { kennels: [r('b', { kennel_name: ' thornfield ', is_own_kennel: true })] }), 'kennels'), [['a', 'b']]);
  const p = plan({ kennels: [r('a', { kennel_name: 'Thornfield Kennels', is_own_kennel: true })] },
    { kennels: [r('b', { kennel_name: 'Thornfield', is_own_kennel: true })] });
  assert.deepEqual(p.asks.map((q) => q.key), [askKey('kennels', 'b')]);
  const out = plan({ kennels: [r('a', { kennel_name: 'Smith Kennels', website: 'smith.com' })] },
    { kennels: [r('b', { kennel_name: 'Smith Kennels', website: 'other.com' })] });
  assert.equal(out.pairs.length, 0);
  assert.equal(out.asks.length, 1, 'same name, different website: asked');
});

test('contacts: name + email or phone is the same; a shared phone alone is asked; both differing is two', () => {
  const me = r('a', { name: 'Jane Smith', email: 'JANE@x.com', phone: '(555) 123-4567' });
  assert.equal(plan({ contacts: [me] }, { contacts: [r('b', { name: 'jane smith', phone: '+1 555.123.4567' })] }).pairs.length, 1);
  assert.equal(plan({ contacts: [me] }, { contacts: [r('b', { name: 'John Smith', phone: '5551234567' })] }).asks.length, 1);
  const two = plan({ contacts: [me] }, { contacts: [r('b', { name: 'Jane Smith', email: 'j@y.com', phone: '555 000 0000' })] });
  assert.equal(two.pairs.length + two.asks.length, 0);
});

test('dogs: registered name (titles ignored), number or microchip; never across a known sex or a different birthday', () => {
  const zoey = r('a', { call_name: 'Zoey', sex: 'female', registered_name: 'Thornfield Zoey' });
  assert.equal(plan({ dogs: [zoey] }, { dogs: [r('b', { sex: 'female', registered_name: 'CH Thornfield Zoey' })] }).pairs.length, 1);
  assert.equal(plan({ dogs: [r('a', { microchip_id: '985-112' })] }, { dogs: [r('b', { microchip_id: '985112' })] }).pairs.length, 1);
  assert.equal(plan({ dogs: [zoey] }, { dogs: [r('b', { sex: 'male', registered_name: 'Thornfield Zoey' })] }).pairs.length, 0);
  assert.equal(plan({ dogs: [{ ...zoey, date_of_birth: '2024-01-01' }] },
    { dogs: [r('b', { registered_name: 'Thornfield Zoey', date_of_birth: '2024-02-01' })] }).pairs.length, 0);
});

test('two candidates are a question, never a guess; her answer pairs one, and "none" pairs nothing', () => {
  const local = { dogs: [r('a', { call_name: 'Bella', breed: 'Lab', sex: 'female' }), r('c', { call_name: 'Bella', breed: 'Lab', sex: 'female' })] };
  const incoming = { dogs: [r('b', { call_name: 'Bella', breed: 'Lab', sex: 'female' })] };
  const p = plan(local, incoming);
  assert.deepEqual(p.asks.map((q) => q.candidates), [['a', 'c']]);
  assert.deepEqual(pairsOf(plan(local, incoming, { [askKey('dogs', 'b')]: 'c' }), 'dogs'), [['c', 'b']]);
  const none = plan(local, incoming, { [askKey('dogs', 'b')]: 'none' });
  assert.equal(none.pairs.length + none.asks.length, 0);
});

test('sales: same pup and buyer; a resale after a return is asked; several each side pair by closest date', () => {
  const ids = { dogs: [r('d')], contacts: [r('c')] };
  const sale = (id, extra) => r(id, { dog_id: 'd', buyer_contact_id: 'c', ...extra });
  assert.equal(plan({ ...ids, sales: [sale('a', { price: 1000 })] }, { ...ids, sales: [sale('b', { price: 1200 })] }).pairs.length, 1, 'price never tells them apart');
  assert.equal(plan({ ...ids, sales: [sale('a', { sale_date: '2026-01-01', status: 'returned' })] },
    { ...ids, sales: [sale('b', { sale_date: '2026-04-01', status: 'deposit_paid' })] }).asks.length, 1);
  const p = plan({ ...ids, sales: [sale('a1', { sale_date: '2026-01-01' }), sale('a2', { sale_date: '2026-06-01' })] },
    { ...ids, sales: [sale('b2', { sale_date: '2026-06-03' }), sale('b1', { sale_date: '2026-01-02' })] });
  assert.deepEqual(pairsOf(p, 'sales').sort(), [['a1', 'b1'], ['a2', 'b2']]);
});

test('events: same subject, type and date, unless a short detail differs (two weight checks are two)', () => {
  const ids = { dogs: [r('d')] };
  const ev = (id, details) => r(id, { subject_type: 'dog', subject_id: 'd', event_type: 'weight_check', event_date: '2026-05-01', details });
  assert.equal(plan({ ...ids, events: [ev('a', { time_of_day: 'AM' })] }, { ...ids, events: [ev('b', { time_of_day: 'AM', weight_lbs: 3 })] }).pairs.length, 1);
  assert.equal(plan({ ...ids, events: [ev('a', { time_of_day: 'AM' })] }, { ...ids, events: [ev('b', { time_of_day: 'PM' })] }).pairs.length, 0);
});

test('mergePair: blanks fill, newer wins, lists join, notes keep both, created_at is the earlier', () => {
  const here = r('x', { call_name: 'Zoey', color_markings: 'red', notes: 'Shy at first.', planned_tests: ['hips'], created_at: '2025-01-01', updated_at: '2026-03-01' });
  const file = r('x', { call_name: 'Zoey', color_markings: 'gold', microchip_id: '985', notes: 'Loves water.', planned_tests: ['eyes', 'hips'], created_at: '2025-06-01', updated_at: '2026-01-01' });
  const m = mergePair(here, file, { table: 'dogs' });
  assert.equal(m.color_markings, 'red');
  assert.equal(m.microchip_id, '985');
  assert.deepEqual(m.planned_tests, ['hips', 'eyes']);
  assert.equal(m.notes, 'Shy at first.\n\nLoves water.');
  assert.equal(m.created_at, '2025-01-01');
  assert.equal(m.updated_at, '2026-03-01');
});

test('rekey: whole values, ids inside strings and keys, nested; untouched values stay the same object', () => {
  const oldId = '11111111-1111-4111-8111-111111111111';
  const newId = '22222222-2222-4222-8222-222222222222';
  const remap = new Map([[oldId, newId]]);
  const row = { id: oldId, list: [oldId, 'x'], nested: { a: oldId }, key: `jotform:${oldId}`, [`promote:${oldId}`]: 1 };
  assert.deepEqual(rekey(row, remap), { id: newId, list: [newId, 'x'], nested: { a: newId }, key: `jotform:${newId}`, [`promote:${newId}`]: 1 });
  const untouched = { id: 'z', n: { a: 1 } };
  assert.equal(rekey(untouched, remap), untouched);
});
