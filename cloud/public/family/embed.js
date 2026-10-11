// The waitlist on a breeder's own website (docs/KennelOS_Integrations_Plan.md §1).
// She pastes, where the form or list should appear:
//
//   <script async src="<the family pages' address>/family/embed.js"
//           data-kennel="kos1_…" data-view="apply"></script>
//
// (the app writes it out for her: cloudConfig.embedSnippet)
// data-view   "apply" (her application form, the default) or "list" (her public list)
// data-theme  "light" (the default), "dark", or "auto" (follow the visitor's setting)
// data-accent a color for buttons and links, like "#7a3e9d"
//
// This script runs on HER page, so it does as little as possible: it puts one frame
// of our page after itself and sets the frame's height from the messages our page
// sends (only messages from our own address, from that frame, are read). Everything
// the family types stays inside the frame, on our address, sealed to her key as on
// the page itself. The server lets the frame show only while she has embedding on.
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || !script.src) return;
  var origin;
  try { origin = new URL(script.src).origin; } catch (e) { return; }

  var kennel = script.getAttribute('data-kennel') || '';
  if (!/^kos1_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(kennel)) return;
  var view = script.getAttribute('data-view') === 'list' ? 'list' : 'apply';
  var theme = script.getAttribute('data-theme');
  theme = theme === 'dark' || theme === 'auto' ? theme : 'light';
  var accent = script.getAttribute('data-accent') || '';
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent)) accent = '';

  var id = 'kos' + Math.random().toString(36).slice(2, 12);
  var src = origin + '/' + view + '/' + encodeURIComponent(kennel) + '?embed=1&frame=' + id + '&theme=' + theme
    + (accent ? '&accent=' + encodeURIComponent(accent) : '');

  var frame = document.createElement('iframe');
  frame.src = src;
  frame.title = view === 'list' ? 'Puppy waitlist' : 'Puppy waitlist application';
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.style.width = '100%';
  frame.style.border = '0';
  frame.style.display = 'block';
  frame.style.minHeight = '320px';
  frame.style.height = '640px'; // until the page says how tall it is
  frame.style.colorScheme = theme === 'auto' ? 'normal' : theme;
  script.parentNode.insertBefore(frame, script.nextSibling);

  window.addEventListener('message', function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data || data.frame !== id) return;
    if (data.type === 'kennelos:height') {
      var h = Math.ceil(Number(data.height));
      if (h > 0 && h < 50000) frame.style.height = h + 'px';
    } else if (data.type === 'kennelos:top') {
      var top = frame.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight) frame.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });
})();
