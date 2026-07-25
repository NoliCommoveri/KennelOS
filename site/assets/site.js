/* site.js — the only script on the marketing site.
   Two jobs: toggle the mobile nav, and stamp the current year into the footer.
   Everything else is plain HTML, so every page works with JS off.

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

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
});
