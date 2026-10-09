// waitlistEmails.test.js — the emails her list sends families (W2 Plan §8, step 6;
// shared/data/waitlistEmails.js): her templates over the defaults, placeholders
// filled from her records, no money in any default, and the kinds the server takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMAIL_KINDS, EMAIL_TEMPLATE_KINDS, DEFAULT_EMAIL_TEMPLATES, EMAIL_SUBJECT_MAX, EMAIL_BODY_MAX,
  draftEmail, emailTemplate, fillPlaceholders, placeholderValues, longDate, joinNames, requestPhrase, emailProblem
} from '../shared/data/waitlistEmails.js';

const { EMAIL_KINDS: SERVER_KINDS, MESSAGE_LIMITS } = await import('../cloud/src/waitlist.js');

test('the device and the server agree on the kinds and the limits', () => {
  assert.deepEqual([...EMAIL_KINDS].sort(), [...SERVER_KINDS].sort());
  assert.equal(EMAIL_SUBJECT_MAX, MESSAGE_LIMITS.subjectMax);
  assert.equal(EMAIL_BODY_MAX, MESSAGE_LIMITS.bodyMax);
  for (const { kind } of EMAIL_TEMPLATE_KINDS) assert.ok(DEFAULT_EMAIL_TEMPLATES[kind], kind);
});

test('no default mentions money or replying by email', () => {
  for (const [kind, t] of Object.entries(DEFAULT_EMAIL_TEMPLATES)) {
    const text = `${t.subject}\n${t.body}`;
    assert.doesNotMatch(text, /\$|\bvenmo\b|\bzelle\b|\bpaypal\b|\d+\.\d\d/i, kind);
    assert.doesNotMatch(text, /reply to this email|email us back/i, kind);
  }
});

test('placeholders fill from her records, in any case; unknown ones stay as typed', () => {
  const v = placeholderValues({
    kennelName: 'Thornfield', family: 'Ann Lee', litters: ['Juniper × Ash', 'Willow × Oak'], respondBy: '2026-10-20', position: 4, payBy: '2026-11-01'
  });
  assert.equal(fillPlaceholders('[Kennel Name] [family] [LITTER] [Respond by] [Position][Pay by] [Pups]', v),
    'Thornfield Ann Lee Juniper × Ash and Willow × Oak October 20, 2026 #4 by November 1, 2026 [Pups]');
  const blank = placeholderValues({});
  assert.equal(blank['pay by'], '', 'no due date: nothing');
  assert.equal(blank.family, 'there');
  assert.equal(longDate('2026-01-05'), 'January 5, 2026');
  assert.equal(longDate('soon'), 'soon');
  assert.equal(joinNames(['A', 'B', 'C']), 'A, B and C');
});

test('her wording replaces the default field by field; blank keeps the default', () => {
  const config = { email_templates: { offer: { subject: 'Pick time, [Family]!', body: '' } } };
  assert.equal(emailTemplate(config, 'offer').subject, 'Pick time, [Family]!');
  assert.equal(emailTemplate(config, 'offer').body, DEFAULT_EMAIL_TEMPLATES.offer.body);
  assert.deepEqual(emailTemplate(null, 'declined'), DEFAULT_EMAIL_TEMPLATES.declined);

  const d = draftEmail('offer', { kennelName: 'Thornfield', family: 'Ann Lee', litters: ['Juniper × Ash'], respondBy: '2026-10-20' }, config);
  assert.deepEqual(d, {
    kind: 'offer',
    subject: 'Pick time, Ann Lee!',
    body: "Hi Ann Lee,\n\nIt's your turn to choose a puppy from Juniper × Ash. The puppies available to you are on your status page.\n\nPlease choose your puppy and send your deposit by October 20, 2026, or let us know there if you'd like to pass on this litter.\n\nThornfield"
  });
});

test('a subject stays on one line and within the limits', () => {
  const config = { email_templates: { note: { subject: 'Line one\n[Family]  and more', body: 'x'.repeat(EMAIL_BODY_MAX + 50) } } };
  const d = draftEmail('note', { family: 'Ann' }, config);
  assert.equal(d.subject, 'Line one Ann and more');
  assert.equal(d.body.length, EMAIL_BODY_MAX);
});

test('the approved email names a due date only when there is one', () => {
  assert.match(draftEmail('approved', { kennelName: 'T', family: 'A', payBy: '2026-10-20' }).body, /application fee by October 20, 2026\./);
  assert.match(draftEmail('approved', { kennelName: 'T', family: 'A' }).body, /application fee\. The amount/);
});

test('request phrases, and what makes an edited email unsendable', () => {
  assert.equal(requestPhrase('pause_request', { until: '2026-12-01' }), 'to pause your place until December 1, 2026');
  assert.equal(requestPhrase('listen_change_request', {}), 'to change which litters you wait for');
  assert.match(draftEmail('request_declined', { family: 'Ann', request: requestPhrase('pref_change_request') }).body, /your request to change your preferences, so nothing/);
  assert.equal(emailProblem({ subject: 'Hi', body: 'Text' }), '');
  assert.match(emailProblem({ subject: ' ', body: 'Text' }), /subject is empty/);
  assert.match(emailProblem({ subject: 'Hi', body: '' }), /message is empty/);
});

test("the server fills her published templates exactly as her device does (W2 step 7)", async () => {
  const { fillTemplate } = await import('../cloud/src/serverMoves.js');
  const { serverEmailTemplates, SERVER_EMAIL_KINDS } = await import('../shared/data/waitlistEmails.js');
  const config = { email_templates: { offer: { subject: '[Family], pick from [Litter]!' } } };
  const published = serverEmailTemplates(config);
  assert.deepEqual(Object.keys(published), [...SERVER_EMAIL_KINDS]);
  const facts = { kennelName: 'Thornfield', family: 'Ann Lee', litters: ['Juniper × Ash', 'Willow × Oak'], respondBy: '2026-10-20', payBy: '2026-10-21' };
  for (const kind of SERVER_EMAIL_KINDS) {
    const device = draftEmail(kind, facts, config);
    assert.deepEqual(fillTemplate(published[kind], facts), { subject: device.subject, body: device.body }, kind);
  }
});
