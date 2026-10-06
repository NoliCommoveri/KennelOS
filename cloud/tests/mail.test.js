import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, call, lastCode } from './helpers/env.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function captureFetch(status = 200) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init, body: JSON.parse(init.body) });
    return new Response('{}', { status });
  };
  return sent;
}

test('with RESEND_API_KEY the code is emailed through Resend, not put in the outbox', async () => {
  const env = await makeEnv({ RESEND_API_KEY: 're_test', MAIL_FROM: 'KennelOS <signin@kennelos.app>' });
  const sent = captureFetch();
  const res = await call(env, 'POST', '/auth/start', { body: { email: ' Jen@Example.com ' } });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.equal(sent[0].init.headers.authorization, 'Bearer re_test');
  assert.deepEqual(sent[0].body.to, ['jen@example.com']);
  assert.equal(sent[0].body.from, 'KennelOS <signin@kennelos.app>');
  const code = sent[0].body.subject.match(/\d{6}/)[0];
  assert.match(sent[0].body.text, new RegExp(code));
  assert.match(sent[0].body.text, /10 minutes/);
  assert.equal(sent[0].body.html, undefined, 'plain text only');
  assert.equal(lastCode(env), undefined, 'nothing in the outbox');

  // And the emailed code signs in.
  const v = await call(env, 'POST', '/auth/verify', { body: { email: 'jen@example.com', code } });
  assert.equal(v.status, 200);
});

test('a Resend failure is a 502, and the address is not logged', async () => {
  const env = await makeEnv({ RESEND_API_KEY: 're_test' });
  captureFetch(422);
  const logged = [];
  const realError = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    const res = await call(env, 'POST', '/auth/start', { body: { email: 'jen@example.com' } });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, 'email_failed');
  } finally {
    console.error = realError;
  }
  assert.doesNotMatch(logged.join('\n'), /jen@example\.com/);
});
