/* site.js — the only script on the marketing site.
   Three jobs: toggle the mobile nav, stamp the current year into the footer, and
   open a native <dialog> from a link with data-dialog="<id>" (the link's href is
   the no-JS fallback). Everything else is plain HTML, so every page works with JS off.

   Deliberately NOT here: no service-worker registration and no manifest — the
   marketing site is a plain website, not a PWA (that's the app's job, and an
   installable site would compete with the real app's install prompt). */

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  document.querySelectorAll('[data-dialog]').forEach((link) => {
    const dialog = document.getElementById(link.dataset.dialog);
    if (!dialog || typeof dialog.showModal !== 'function') return; // the href still works
    link.addEventListener('click', (e) => { e.preventDefault(); dialog.showModal(); });
    dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
    // A click on the backdrop (the dialog element itself, outside its content) closes it.
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  });

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
});
