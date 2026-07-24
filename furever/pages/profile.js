// profile.js — a pet's landing page and "face" in the app: a large Add-Picture
// box on top, then the pet's details at a generous size, with inline editing.
// The photo is stored downscaled in pet.photo_url (the same field the sidebar
// avatar and other pages read), so no separate blob wiring is needed here.
import { petRepo } from '../data/petRepo.js';
import { breederRepo } from '../data/breederRepo.js';
import { getActivePetId } from '../data/settings.js';
import { renderNav } from '../nav.js';
import { SPECIES, SEX, PET_SOURCE, labelFor } from '../data/vocab.js';
import { todayYMD, parsePartialDate, formatPartialDate } from '../data/dateUtils.js';
import { esc, ageLabel, imageFileToDataUrl, showError, clearError } from '../assets/ui.js';

const body = document.getElementById('profile-body');

function photoBoxHtml(pet) {
  if (pet.photo_url) {
    return `
      <div class="photo-box has-photo" id="photo-box" role="button" tabindex="0" aria-label="Change picture">
        <img src="${esc(pet.photo_url)}" alt="Photo of ${esc(pet.name)}" />
        <span class="ph-change">Change picture</span>
      </div>`;
  }
  return `
    <div class="photo-box" id="photo-box" role="button" tabindex="0" aria-label="Add picture">
      <div class="ph-inner">
        <span class="ph-icon" aria-hidden="true">📷</span>
        <div class="ph-text">Add Picture</div>
      </div>
    </div>`;
}

function detailRow(key, val) {
  if (!val) return '';
  return `<div class="detail-row"><span class="detail-key">${esc(key)}</span><span class="detail-val">${val}</span></div>`;
}

// The age/breeder line under the name: age (derived from DOB) on the left,
// the breeder's kennel name on the right when this pet came from one — same
// line, so the two never compete for vertical space on a small screen.
function metaRowHtml(pet, breeder) {
  const age = pet.date_of_birth ? ageLabel(pet.date_of_birth, todayYMD()) : '';
  const kennelName = breeder && breeder.kennel_name;
  if (!age && !kennelName) return '';
  return `
    <div class="profile-meta-row">
      <span class="profile-age">${age ? `${esc(age)} old` : ''}</span>
      <span class="profile-breeder">${kennelName ? esc(kennelName) : ''}</span>
    </div>`;
}

function detailsHtml(pet, breeder) {
  const rows = [];
  rows.push(detailRow('Species', esc(labelFor(SPECIES, pet.species))));
  if (pet.breed) rows.push(detailRow('Breed', esc(pet.breed)));
  if (pet.sex) rows.push(detailRow('Sex', esc(labelFor(SEX, pet.sex))));
  if (pet.date_of_birth) rows.push(detailRow('Birthday', esc(pet.date_of_birth)));
  if (pet.joined_family_date) rows.push(detailRow('Joined family', esc(formatPartialDate(pet.joined_family_date))));
  rows.push(detailRow('Added', esc(labelFor(PET_SOURCE, pet.source))));

  return `
    <h1 class="profile-name">${esc(pet.name)}</h1>
    ${metaRowHtml(pet, breeder)}
    <div class="pill-row" style="margin-bottom:.5rem;">
      <button type="button" class="btn btn-sm" id="btn-edit">Edit details</button>
    </div>
    ${pet.date_of_birth ? '' : '<p class="muted">Add a birthday to unlock the care schedule on the Reminders page.</p>'}
    <div class="detail-list">${rows.join('')}</div>`;
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function editFormHtml(pet) {
  const speciesOpts = SPECIES.map((s) => `<option value="${s.value}"${s.value === pet.species ? ' selected' : ''}>${esc(s.label)}</option>`).join('');
  const sexOpts = ['<option value="">—</option>', ...SEX.map((s) => `<option value="${s.value}"${s.value === pet.sex ? ' selected' : ''}>${esc(s.label)}</option>`)].join('');
  const { year: joinedYear, month: joinedMonth } = parsePartialDate(pet.joined_family_date);
  const joinedMonthOpts = ['<option value="">— (year only)</option>', ...MONTH_LABELS.map((label, i) => {
    const value = String(i + 1).padStart(2, '0');
    return `<option value="${value}"${value === joinedMonth ? ' selected' : ''}>${label}</option>`;
  })].join('');
  return `
    <div class="card">
      <h2>Edit ${esc(pet.name)}</h2>
      <form id="edit-form" class="form-grid">
        <div class="field">
          <label for="f-name">Name</label>
          <input id="f-name" name="name" required autocomplete="off" value="${esc(pet.name)}" />
        </div>
        <div class="field">
          <label for="f-species">Species</label>
          <select id="f-species" name="species">${speciesOpts}</select>
          <span class="hint">Dogs get the full care schedule; other species are records-only for now.</span>
        </div>
        <div class="field">
          <label for="f-dob">Date of birth</label>
          <input id="f-dob" name="date_of_birth" type="date" max="${todayYMD()}" value="${esc(pet.date_of_birth)}" />
          <span class="hint">The care schedule is timed from this.</span>
        </div>
        <div class="field">
          <label for="f-sex">Sex</label>
          <select id="f-sex" name="sex">${sexOpts}</select>
        </div>
        <div class="field">
          <label for="f-breed">Breed</label>
          <input id="f-breed" name="breed" autocomplete="off" value="${esc(pet.breed)}" />
        </div>
        <div class="field">
          <label for="f-joined-year">Joined the family</label>
          <div class="joined-inputs">
            <select id="f-joined-month" name="joined_month">${joinedMonthOpts}</select>
            <input id="f-joined-year" name="joined_year" type="number" inputmode="numeric" min="1900" max="${todayYMD().slice(0, 4)}" placeholder="Year" value="${esc(joinedYear)}" />
          </div>
          <span class="hint">Just a year is fine — month is optional, no day needed.</span>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save</button>
          <button type="button" class="btn" id="btn-cancel">Cancel</button>
        </div>
      </form>
    </div>`;
}

async function render() {
  try {
    clearError();
    const petId = getActivePetId();
    const pet = petId ? await petRepo.getById(petId) : null;
    if (!pet) {
      body.innerHTML = `<div class="card empty-state">
        <span class="big" aria-hidden="true">🐾</span>
        <h2>No pet selected</h2>
        <p>Pick a pet from the menu, or add your first one.</p>
        <p><a class="btn btn-primary" href="addpet.html">Add New Pet</a></p>
      </div>`;
      return;
    }

    const breeder = pet.breeder_id ? await breederRepo.getById(pet.breeder_id) : null;
    body.innerHTML = photoBoxHtml(pet) + detailsHtml(pet, breeder);
    wirePhoto(pet);
    wireEdit(pet);
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

// The picture box: a hidden file input driven by clicking (or keying) the box.
// The chosen image is downscaled to a data URL and saved to the pet record.
function wirePhoto(pet) {
  const box = document.getElementById('photo-box');
  if (!box) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  box.appendChild(input);

  const open = () => input.click();
  box.addEventListener('click', open);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      clearError();
      const dataUrl = await imageFileToDataUrl(file);
      await petRepo.update(pet.id, { photo_url: dataUrl });
      await renderNav(); // refresh the sidebar avatar too
      render();
    } catch (err) {
      showError(err.message || String(err));
    }
  });
}

function wireEdit(pet) {
  const btn = document.getElementById('btn-edit');
  if (!btn) return;
  btn.addEventListener('click', () => openEdit(pet));
}

function openEdit(pet) {
  clearError();
  // Keep the photo box; swap the details block for the form.
  body.innerHTML = photoBoxHtml(pet) + editFormHtml(pet);
  wirePhoto(pet);
  const form = document.getElementById('edit-form');
  document.getElementById('btn-cancel').addEventListener('click', render);
  document.getElementById('f-name').focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const fd = new FormData(form);
      const joinedYear = (fd.get('joined_year') || '').toString().trim();
      const joinedMonth = (fd.get('joined_month') || '').toString().trim();
      await petRepo.update(pet.id, {
        name: (fd.get('name') || '').toString().trim(),
        species: fd.get('species') || 'dog',
        date_of_birth: fd.get('date_of_birth') || null,
        sex: fd.get('sex') || null,
        breed: (fd.get('breed') || '').toString().trim() || null,
        joined_family_date: joinedYear ? (joinedMonth ? `${joinedYear}-${joinedMonth}` : joinedYear) : null
      });
      await renderNav(); // name/avatar may have changed
      render();
    } catch (err) {
      submit.disabled = false;
      showError(err.message || String(err));
    }
  });
}

render();
