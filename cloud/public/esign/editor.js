// The Firma template editor in its own tab (docs/KennelOS_Integrations_Plan.md
// §2.3a, D31). KennelOS's Contract templates opens this page with a 24-hour editor
// token and the template's id in its fragment (#t=…&id=…), which never reaches
// a server log. The page is served sandboxed (cloud/src/firma.js serveEsignEditor):
// it has no origin of its own, so Firma's script, loaded from api.firma.dev, can't
// read this Worker's cookies or storage. Firma's script expects web storage and
// the Locks API, which a sandboxed page refuses, so they're stood in for here, in
// memory, for this tab only.
(function () {
  'use strict';
  var FIRMA_SCRIPT = 'https://api.firma.dev/functions/v1/embed-proxy/template-editor.js';
  // A contract's preview (#t=…&sr=…): a draft signing request, read-only.
  var FIRMA_SR_SCRIPT = 'https://api.firma.dev/functions/v1/embed-proxy/signing-request-editor.js';

  function memoryStorage() {
    var m = new Map();
    return {
      getItem: function (k) { k = String(k); return m.has(k) ? m.get(k) : null; },
      setItem: function (k, v) { m.set(String(k), String(v)); },
      removeItem: function (k) { m.delete(String(k)); },
      clear: function () { m.clear(); },
      key: function (i) { return Array.from(m.keys())[i] || null; },
      get length() { return m.size; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try { void window[name]; } catch (e) {
      try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch (e2) { /* left as is */ }
    }
  });
  try {
    var locks = { request: function (name, a, b) { var cb = typeof a === 'function' ? a : b; return Promise.resolve().then(function () { return cb({ name: name, mode: 'exclusive' }); }); },
      query: function () { return Promise.resolve({ held: [], pending: [] }); } };
    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  } catch (e) { /* left as is */ }

  var params = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  var token = params.get('t') || '';
  var templateId = params.get('id') || '';
  var requestId = params.get('sr') || '';
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* the fragment stays */ }

  function $(id) { return document.getElementById(id); }
  function say(status, note) {
    if ($('status')) $('status').textContent = status;
    if (note != null && $('note')) { $('note').textContent = note; $('note').hidden = !note; }
  }

  // The preview: her template with the contract's values, as the buyer will get it.
  function startPreview() {
    document.title = 'Preview: KennelOS contract';
    say('Opening the preview…', '');
    var s = document.createElement('script');
    s.src = FIRMA_SR_SCRIPT;
    s.onerror = function () { say('The preview didn\'t load', 'Firma couldn\'t be reached. Check your connection, then tap Preview again in KennelOS.'); };
    s.onload = function () {
      if (typeof window.FirmaSigningRequestEditor !== 'function') { s.onerror(); return; }
      say('Preview: your template with this contract\'s details. Nothing has been sent.',
        'This is a draft only you can see. Close this tab and tap Send in KennelOS when it looks right.');
      try {
        new window.FirmaSigningRequestEditor({
          container: '#editor',
          jwt: token,
          signingRequestId: requestId,
          readOnly: true,
          theme: 'light',
          height: 'calc(100vh - 80px)',
          showCloseButton: true,
          onClose: function () {
            $('editor').innerHTML = '';
            say('Closed', 'You can close this tab and go back to KennelOS.');
            try { window.close(); } catch (e) { /* she closes it */ }
          },
          onError: function () { say('Something went wrong', 'The preview stopped. Tap Preview again in KennelOS for a fresh one.'); }
        });
      } catch (e) {
        say('The preview didn\'t start', 'Tap Preview again in KennelOS.');
      }
    };
    document.head.appendChild(s);
  }

  function start() {
    if (token && /^[A-Za-z0-9_-]{1,64}$/.test(requestId)) { startPreview(); return; }
    if (!token || !/^[A-Za-z0-9_-]{1,64}$/.test(templateId)) {
      say('Nothing to open', 'Open this from KennelOS: Contracts, Contract templates, then Place fields on a template.');
      return;
    }
    var s = document.createElement('script');
    s.src = FIRMA_SCRIPT;
    s.onerror = function () { say('The editor didn\'t load', 'Firma\'s editor couldn\'t be reached. Check your connection, then open Place fields again from KennelOS.'); };
    s.onload = function () {
      if (typeof window.FirmaTemplateEditor !== 'function') { s.onerror(); return; }
      say('Place the signature and detail fields, then save.', '');
      try {
        new window.FirmaTemplateEditor({
          container: '#editor',
          jwt: token,
          templateId: templateId,
          theme: 'light',
          height: 'calc(100vh - 42px)',
          showCloseButton: true,
          onSave: function () { say('Saved in Firma. Close this tab when you\'re done, and go back to KennelOS.'); },
          onClose: function (data) {
            if (data && data.hasUnsavedChanges) return;
            $('editor').innerHTML = '';
            say('Done', 'Your template is saved. You can close this tab and go back to KennelOS.');
            try { window.close(); } catch (e) { /* she closes it */ }
          },
          onError: function () { say('Something went wrong', 'The editor stopped. Its link lasts 24 hours: open Place fields again from KennelOS for a fresh one.'); }
        });
      } catch (e) {
        say('The editor didn\'t start', 'Open Place fields again from KennelOS.');
      }
    };
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
