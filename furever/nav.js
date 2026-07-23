// nav.js — Furever's top navigation, injected into the <div id="app-nav"></div>
// every page includes. Standalone: no editions/cap/demo coupling (unlike the
// breeder app's nav).
//
// The nav also hosts the APP-WIDE ACTIVE-PET PICKER. Furever is scoped to one pet
// at a time (schema doc §"the pet is the app-wide scope"): pick a pet here and
// every page shows that pet. The choice lives in settings.js (localStorage), not
// a table, so it survives reloads; changing it reloads the page so the now-scoped
// view re-renders against the new pet.
import { petRepo } from './data/petRepo.js';
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

const NAV_ITEMS = [
  { path: 'pages/today.html', label: 'Today' },
  { path: 'pages/pet.html', label: 'My Pet' },
  { path: 'pages/pets.html', label: 'Pets' }
];

// pet.html is the active-pet detail; keep "My Pet" lit while inside it.
const HUB_CHILDREN = {
  'pages/pet.html': []
};

function isActive(item, here) {
  const file = item.path.split('/').pop();
  if (file === here) return true;
  return (HUB_CHILDREN[item.path] || []).includes(here);
}

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

export async function renderNav(targetId = 'app-nav') {
  const host = document.getElementById(targetId);
  if (!host) return;
  const prefix = rootPrefix();
  const here = currentFile();
  const { pets, activeId } = await resolveActive();

  const links = NAV_ITEMS.map((item) => {
    const active = isActive(item, here) ? ' active' : '';
    return `<a class="nav-link${active}" href="${prefix}${item.path}">${item.label}</a>`;
  }).join('');

  const petPicker = pets.length
    ? `<div class="nav-pet">
         <label for="nav-pet-select">Pet</label>
         <select id="nav-pet-select" aria-label="Active pet">
           ${pets.map((p) => `<option value="${esc(p.id)}"${p.id === activeId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
         </select>
       </div>`
    : '';

  host.innerHTML = `
    <nav class="nav-inner">
      <a class="nav-brand" href="${prefix}index.html"><span class="paw">🐾</span> Furever</a>
      <div class="nav-links">${links}${petPicker}</div>
      <button type="button" class="nav-toggle" aria-label="Menu" aria-expanded="false">☰</button>
    </nav>`;

  wireToggle(host);
  wirePetPicker(host);
}

function wireToggle(host) {
  const inner = host.querySelector('.nav-inner');
  const btn = host.querySelector('.nav-toggle');
  if (!inner || !btn) return;
  btn.addEventListener('click', () => {
    const open = inner.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

// Switching the active pet re-scopes the whole app, so reload the current page to
// re-render its now-scoped view.
function wirePetPicker(host) {
  const sel = host.querySelector('#nav-pet-select');
  if (!sel) return;
  sel.addEventListener('change', () => {
    setActivePetId(sel.value);
    location.reload();
  });
}
