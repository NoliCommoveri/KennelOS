// pets.js — the roster: every pet in the home, split into "from your breeder"
// (seeded) and "added by you" (self), plus the add-a-pet form for a self-added
// pet. Setting the active pet here re-scopes the whole app (nav picker + pages).
//
// Seeded pets normally arrive via a breeder link (that decoder is a later step);
// this page creates SELF pets only — petRepo.create defaults source to 'self'.
import { petRepo } from '../data/petRepo.js';
import { getActivePetId, setActivePetId } from '../data/settings.js';
import { renderNav } from '../nav.js';
import { SPECIES, SEX, PET_SOURCE } from '../data/vocab.js';
import { todayYMD } from '../data/dateUtils.js';
import { esc, badge, ageLabel, showError, clearError } from '../assets/ui.js';

const body = document.getElementById('pets-body');
const formHost = document.getElementById('pet-form-host');
const addBtn = document.getElementById('btn-add-pet');

function avatarHtml(pet) {
  if (pet.photo_url) return `<img class="avatar" src="${esc(pet.photo_url)}" alt="" />`;
  return `<span class="avatar" aria-hidden="true">🐾</span>`;
}

function metaLine(pet) {
  const bits = [];
  if (pet.breed) bits.push(esc(pet.breed));
  if (pet.sex) bits.push(esc(SEX.find((s) => s.value === pet.sex)?.label || pet.sex));
  if (pet.date_of_birth) {
    const age = ageLabel(pet.date_of_birth, todayYMD());
    bits.push(age ? `${age} old` : esc(pet.date_of_birth));
  }
  return bits.join(' · ');
}

function rowHtml(pet, activeId) {
  const isActive = pet.id === activeId;
  const active = isActive
    ? `<span class="badge badge-green">Active</span>`
    : `<button type="button" class="btn btn-sm" data-activate="${esc(pet.id)}">Set active</button>`;
  return `
    <div class="list-row">
      ${avatarHtml(pet)}
      <div class="grow">
        <div><a href="pet.html" data-open="${esc(pet.id)}"><strong>${esc(pet.name)}</strong></a> ${badge(SPECIES, pet.species)}</div>
        <div class="sched-meta">${metaLine(pet)}</div>
      </div>
      ${active}
    </div>`;
}

function groupHtml(title, pets, activeId) {
  if (!pets.length) return '';
  return `<div class="section-title">${esc(title)}</div>
    <div class="card">${pets.map((p) => rowHtml(p, activeId)).join('')}</div>`;
}

async function render() {
  try {
    const pets = await petRepo.getAll();
    const activeId = getActivePetId();
    if (!pets.length) {
      body.innerHTML = `<div class="card empty-state">
        <span class="big" aria-hidden="true">🐾</span>
        <h2>No pets yet</h2>
        <p>Add your first pet to begin. Later, a link from your breeder will add a puppy here automatically.</p>
      </div>`;
      return;
    }
    const seeded = pets.filter((p) => p.source === 'seeded');
    const self = pets.filter((p) => p.source !== 'seeded');
    body.innerHTML = groupHtml('From your breeder', seeded, activeId)
      + groupHtml('Added by you', self, activeId);

    body.querySelectorAll('[data-activate]').forEach((el) => {
      el.addEventListener('click', async () => {
        setActivePetId(el.getAttribute('data-activate'));
        await renderNav();
        render();
      });
    });
    // Opening a pet also makes it the active one, so its page is scoped to it.
    body.querySelectorAll('[data-open]').forEach((el) => {
      el.addEventListener('click', () => setActivePetId(el.getAttribute('data-open')));
    });
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

function formHtml() {
  const speciesOpts = SPECIES.map((s) => `<option value="${s.value}"${s.value === 'dog' ? ' selected' : ''}>${esc(s.label)}</option>`).join('');
  const sexOpts = ['<option value="">—</option>', ...SEX.map((s) => `<option value="${s.value}">${esc(s.label)}</option>`)].join('');
  return `
    <div class="card">
      <h2>Add a pet</h2>
      <form id="pet-form" class="form-grid">
        <div class="field">
          <label for="f-name">Name</label>
          <input id="f-name" name="name" required autocomplete="off" />
        </div>
        <div class="field">
          <label for="f-species">Species</label>
          <select id="f-species" name="species">${speciesOpts}</select>
          <span class="hint">Dogs get the full care schedule; other species are records-only for now.</span>
        </div>
        <div class="field">
          <label for="f-dob">Date of birth</label>
          <input id="f-dob" name="date_of_birth" type="date" max="${todayYMD()}" />
          <span class="hint">The care schedule is timed from this. You can add it later.</span>
        </div>
        <div class="field">
          <label for="f-sex">Sex</label>
          <select id="f-sex" name="sex">${sexOpts}</select>
        </div>
        <div class="field">
          <label for="f-breed">Breed</label>
          <input id="f-breed" name="breed" autocomplete="off" />
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Add pet</button>
          <button type="button" class="btn" id="btn-cancel">Cancel</button>
        </div>
      </form>
    </div>`;
}

let formOpen = false;
function closeForm() { formOpen = false; formHost.innerHTML = ''; }

function openForm() {
  if (formOpen) return;
  formOpen = true;
  clearError();
  formHost.innerHTML = formHtml();
  const form = document.getElementById('pet-form');
  document.getElementById('btn-cancel').addEventListener('click', closeForm);
  document.getElementById('f-name').focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit.disabled) return; // guard double-submit
    submit.disabled = true;
    try {
      const fd = new FormData(form);
      const data = {
        name: (fd.get('name') || '').toString().trim(),
        species: fd.get('species') || 'dog',
        date_of_birth: fd.get('date_of_birth') || null,
        sex: fd.get('sex') || null,
        breed: (fd.get('breed') || '').toString().trim() || null
      };
      const pet = await petRepo.create(data);
      // First pet becomes the active one automatically.
      if (!getActivePetId()) setActivePetId(pet.id);
      closeForm();
      await renderNav();
      render();
    } catch (err) {
      submit.disabled = false;
      showError(err.message || String(err));
    }
  });
}

addBtn.addEventListener('click', openForm);
render();
