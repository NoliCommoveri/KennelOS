// nav.js — Furever's navigation. Three regions, all rendered from here:
//
//   0. The CONSTANT BANNER (into <header id="app-banner">) — always on top, above
//      the interior navs. Left: the app title, "Furever" large with "by KennelOS"
//      small on two lines beside it. Right: the family's name ("Carson Family
//      Pets") once set, which links to the Family page (also the entry point to
//      set it up). On mobile the banner hosts the ☰ drawer toggle.
//
//   1. The LEFT SIDEBAR (into <div id="app-nav">) — the app's primary nav:
//        At A Glance · one entry per pet · Add New Pet
//      On narrow screens it becomes a drawer that slides in from the left. The
//      pet entries double as the active-pet picker.
//
//   2. The TOP SUB-NAV (into <div id="app-subnav">) — the pet-scoped page tabs
//        Profile · Reminders · Log
//      shown only while a pet page is open. At A Glance has no sub-nav for now.
import { petRepo } from './data/petRepo.js';
import { householdRepo } from './data/householdRepo.js';
import { getActivePetId, setActivePetId } from './data/settings.js';
import { esc } from './assets/ui.js';

// Pages live one directory deep (/pages/*.html); index.html sits at the app root.
// Links are stored app-root-relative and prefixed at render time so they resolve
// from either level.
function rootPrefix() {
  return location.pathname.includes('/pages/') ? '../' : '';
}

function currentFile() {
  const parts = location.pathname.split('/');
  return parts[parts.length - 1] || 'index.html';
}

// The pet-scoped pages, in tab order. At A Glance (today) is deliberately NOT
// here: it is family-wide and carries no sub-nav.
const PET_TABS = [
  { file: 'profile.html', label: 'Profile' },
  { file: 'reminders.html', label: 'Reminders' },
  { file: 'log.html', label: 'Log' }
];
const PET_FILES = PET_TABS.map((t) => t.file);

// Resolve the active pet: the stored id if it still exists, otherwise the first
// pet (and persist that so the whole app agrees). Returns { pets, activeId }.
async function resolveActive() {
  const pets = await petRepo.getAll();
  let activeId = getActivePetId();
  if (!pets.some((p) => p.id === activeId)) {
    activeId = pets[0] ? pets[0].id : null;
    setActivePetId(activeId);
  }
  return { pets, activeId };
}

function petAvatar(pet) {
  return pet.photo_url
    ? `<img class="side-ava" src="${esc(pet.photo_url)}" alt="" />`
    : `<span class="side-ava" aria-hidden="true">🐾</span>`;
}

export async function renderNav() {
  const prefix = rootPrefix();
  const familyName = await householdRepo.getFamilyName();
  renderBanner(prefix, familyName);
  await renderSidebar(prefix);
  renderSubnav();
  wireDrawer();
}

function renderBanner(prefix, familyName) {
  const host = document.getElementById('app-banner');
  if (!host) return;
  const family = familyName
    ? `<a class="family-badge" href="${prefix}pages/family.html" title="Family & vet info">${esc(familyName)} Family Pets</a>`
    : `<a class="family-badge family-unset" href="${prefix}pages/family.html">＋ Set up your family</a>`;
  host.innerHTML = `
    <div class="banner-inner">
      <button type="button" class="nav-toggle" aria-label="Menu">☰</button>
      <a class="brand" href="${prefix}index.html">
        <span class="brand-paw" aria-hidden="true">🐾</span>
        <span class="brand-name">Furever</span>
        <span class="brand-by"><span>by</span><span>KennelOS</span></span>
      </a>
      ${family}
    </div>`;
  const toggle = host.querySelector('.nav-toggle');
  if (toggle) toggle.addEventListener('click', () => document.body.classList.toggle('nav-open'));
}

async function renderSidebar(prefix) {
  const host = document.getElementById('app-nav');
  if (!host) return;
  const here = currentFile();
  const onPetPage = PET_FILES.includes(here);
  const { pets, activeId } = await resolveActive();

  // At A Glance is lit on today.html; on any pet page the active pet is lit
  // instead (whichever of its tabs is open).
  const glanceActive = here === 'today.html' ? ' active' : '';

  const petLinks = pets.length
    ? pets.map((p) => {
        const lit = onPetPage && p.id === activeId ? ' active' : '';
        return `<a class="side-link${lit}" href="${prefix}pages/profile.html" data-pet="${esc(p.id)}">
                  ${petAvatar(p)}<span class="side-name">${esc(p.name)}</span>
                </a>`;
      }).join('')
    : '';

  host.innerHTML = `
    <a class="side-link${glanceActive}" href="${prefix}pages/today.html">
      <span class="side-ava" aria-hidden="true">✨</span><span class="side-name">At A Glance</span>
    </a>
    ${pets.length ? `<div class="side-label">Pets</div>${petLinks}` : ''}
    <div class="side-add">
      <div class="side-sep"></div>
      <a class="side-link" href="${prefix}pages/addpet.html">
        <span class="side-ava" aria-hidden="true">＋</span><span class="side-name">Add New Pet</span>
      </a>
    </div>`;

  // Clicking a pet re-scopes the whole app before the link navigates.
  host.querySelectorAll('[data-pet]').forEach((el) => {
    el.addEventListener('click', () => setActivePetId(el.getAttribute('data-pet')));
  });
}

function renderSubnav() {
  const host = document.getElementById('app-subnav');
  if (!host) return;
  const here = currentFile();
  if (!PET_FILES.includes(here)) { host.innerHTML = ''; return; }

  const tabs = PET_TABS.map((t) => {
    const active = t.file === here ? ' active' : '';
    return `<a class="subnav-link${active}" href="${t.file}">${t.label}</a>`;
  }).join('');
  host.innerHTML = `<div class="subnav-inner">${tabs}</div>`;
}

// The mobile drawer backdrop, created once. The ☰ toggle (rendered in the banner)
// flips `nav-open` on <body>; the CSS slides the sidebar in from the left. Tapping
// the backdrop closes it.
function wireDrawer() {
  if (document.querySelector('.nav-backdrop')) return;
  const back = document.createElement('div');
  back.className = 'nav-backdrop';
  back.addEventListener('click', () => document.body.classList.remove('nav-open'));
  document.body.appendChild(back);
}
