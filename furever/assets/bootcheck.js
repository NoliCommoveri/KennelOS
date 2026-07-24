// bootcheck.js — a classic (non-module) guard that surfaces a fatal module-load
// failure instead of leaving a page stuck on its "Loading…" placeholder.
//
// The app's pages are ES modules. If a <script type="module"> — or anything it
// imports, e.g. the vendored Dexie — fails to load (a 404, an offline first
// visit, a wrong MIME type), the module code never executes and therefore can't
// render its own error: the page just sits on "Loading…" with an empty nav. This
// runs FIRST (a classic script executes during head parse, before the deferred
// modules), registers a capture-phase listener for the script element's `error`
// event, and reveals a message if boot fails.
(function () {
  // Apply the saved palette synchronously, before any CSS paints, so there's no
  // flash of the default theme. Classic script (no imports) — reads the same
  // localStorage key settings.js writes ('warm' = the base :root, no attribute).
  try {
    var theme = localStorage.getItem('furever.theme');
    if (theme && theme !== 'warm') document.documentElement.setAttribute('data-theme', theme);
  } catch (e) { /* private mode / storage blocked — fall back to default */ }

  var shown = false;
  function fail() {
    if (shown) return;
    shown = true;
    var box = document.getElementById('page-error');
    if (box) {
      box.className = 'error-box';
      box.textContent = 'Couldn’t load the app. Please refresh — if it keeps happening you may be offline, or a file failed to load.';
    }
    ['today-body', 'profile-body', 'reminders-body', 'log-body', 'addpet-body', 'family-body'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
    console.error('[Furever] a module script failed to load — the app could not boot.');
  }
  window.addEventListener('error', function (e) {
    if (e && e.target && e.target.tagName === 'SCRIPT') fail();
  }, true);
})();
