// appShell.test.js — the shell's two watchers (shared/assets/appShell.js; Review
// Remainder plan §H): a new version reaching an open page (K13-10, R5), and durable
// storage asked for only once there's something to keep (K13-13).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  watchForUpdates, updateReaction, moduleFailed, askPersistenceWhenKept, _resetAppShell
} from '../shared/assets/appShell.js';

// Just enough of a window for the watcher: a document with a body, listeners, and
// a service-worker container whose controllerchange the test fires.
function fakeWindow({ controller = {}, modal = false, onLine = true } = {}) {
  const listeners = {};
  const docListeners = {};
  const body = { children: [], insertBefore(el) { this.children.unshift(el); }, get firstChild() { return this.children[0] || null; } };
  const makeEl = () => {
    const el = {
      id: '', className: '', attrs: {}, innerHTML: '', clicks: [],
      setAttribute(k, v) { this.attrs[k] = v; },
      querySelector: () => ({ addEventListener: (_t, fn) => el.clicks.push(fn) })
    };
    return el;
  };
  const document = {
    body,
    createElement: makeEl,
    getElementById: (id) => body.children.find((c) => c.id === id) || null,
    querySelector: (sel) => (sel === '.modal-overlay' && modal ? {} : null),
    addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); }
  };
  const win = {
    document,
    reloads: 0,
    location: { reload() { win.reloads++; } },
    navigator: {
      onLine,
      serviceWorker: { controller, addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); } }
    },
    fire: (t) => (listeners[t] || []).forEach((fn) => fn()),
    type: () => (docListeners.input || []).forEach((fn) => fn())
  };
  return win;
}
const strip = (win) => win.document.getElementById('app-update-notice');

beforeEach(() => _resetAppShell());

test('update: an idle page reloads by itself when a new version takes over', () => {
  const win = fakeWindow();
  watchForUpdates(win);
  win.fire('controllerchange');
  assert.equal(win.reloads, 1);
  assert.equal(strip(win), null);
});

test('update: a page she has typed in shows the strip and is never reloaded', () => {
  const win = fakeWindow();
  watchForUpdates(win);
  win.type();
  win.fire('controllerchange');
  assert.equal(win.reloads, 0);
  assert.ok(strip(win), 'the strip is shown');
  assert.match(strip(win).innerHTML, /KennelOS was updated\./);
  assert.match(strip(win).innerHTML, />Reload</);
  strip(win).clicks[0]();
  assert.equal(win.reloads, 1, 'Reload reloads');
  win.fire('controllerchange');
  assert.equal(win.document.body.children.length, 1, 'one strip, not two');
});

test('update: an open modal counts as unsaved work', () => {
  const win = fakeWindow({ modal: true });
  watchForUpdates(win);
  win.fire('controllerchange');
  assert.equal(win.reloads, 0);
  assert.ok(strip(win));
});

test('update: the first install claiming a page with no worker is not an update', () => {
  const win = fakeWindow({ controller: null });
  watchForUpdates(win);
  win.fire('controllerchange');
  assert.equal(win.reloads, 0);
  assert.equal(strip(win), null);
  win.fire('controllerchange'); // a real update later in the same page's life
  assert.equal(win.reloads, 1);
  assert.equal(updateReaction({ hadController: true, busy: true }), 'notice');
});

test('update: a lazy module that fails to load shows the strip; other errors, or offline, show nothing', () => {
  const win = fakeWindow();
  moduleFailed(new Error('Stripe said no'), win);
  assert.equal(strip(win), null, 'not a module error');
  moduleFailed(new SyntaxError("The requested module '../data/settings.js' does not provide an export named 'X'"), win);
  assert.ok(strip(win));
  const fetchFail = fakeWindow();
  moduleFailed(new TypeError('Failed to fetch dynamically imported module: https://pro.kennelos.app/data/x.js'), fetchFail);
  assert.ok(strip(fetchFail));
  const offline = fakeWindow({ onLine: false });
  moduleFailed(new TypeError('Failed to fetch dynamically imported module'), offline);
  assert.equal(strip(offline), null, 'offline: a reload can’t help');
});

function persistHarness({ records = false, asked = false } = {}) {
  const h = { asked, requests: 0, listeners: {} };
  h.win = { addEventListener: (t, fn, opts) => { h.listeners[t] = { fn, opts }; } };
  h.opts = {
    asked: () => h.asked,
    markAsked: () => { h.asked = true; },
    request: () => { h.requests++; },
    hasRecords: async () => records,
    eventName: 'kennelos:datachanged',
    win: h.win
  };
  return h;
}

test('persistence: not asked on a first visit, then asked once when her first record is saved', async () => {
  const h = persistHarness();
  await askPersistenceWhenKept(h.opts);
  assert.equal(h.requests, 0, 'persist() isn’t called before the first record');
  assert.equal(h.asked, false);
  assert.deepEqual(h.listeners['kennelos:datachanged'].opts, { once: true });
  h.listeners['kennelos:datachanged'].fn();
  assert.equal(h.requests, 1);
  assert.equal(h.asked, true);
  h.listeners['kennelos:datachanged'].fn();
  assert.equal(h.requests, 1, 'only once');
});

test('persistence: a load that already holds records asks at once; a device already asked never asks again', async () => {
  const withRecords = persistHarness({ records: true });
  await askPersistenceWhenKept(withRecords.opts);
  assert.equal(withRecords.requests, 1);
  const done = persistHarness({ records: true, asked: true });
  await askPersistenceWhenKept(done.opts);
  assert.equal(done.requests, 0);
  assert.deepEqual(done.listeners, {});
  const closed = persistHarness();
  closed.opts.hasRecords = async () => { throw new Error('DatabaseClosedError'); };
  await askPersistenceWhenKept(closed.opts);
  assert.equal(closed.requests, 0);
  assert.equal(closed.asked, false, 'the next load asks');
});
