// addpet.js — the "Add New Pet" form (reached from the sidebar). Creates a SELF
// pet (petRepo.create defaults source to 'self'; seeded pets arrive via a breeder
// link, a later step), makes it the active pet, and opens its Profile so the
// family can add a picture and fill in details.
import { petRepo } from '../data/petRepo.js';
import { getActivePetId, setActivePetId } from '../data/settings.js';
import { renderNav } from '../nav.js';
import { SPECIES, SEX } from '../data/vocab.js';
import { todayYMD } from '../data/dateUtils.js';
import { esc, showError, clearError } from '../assets/ui.js';

const body = document.getElementById('addpet-body');

function formHtml() {
  const speciesOpts = SPECIES.map((s) => `<option value="${s.value}"${s.value === 'dog' ? ' selected' : ''}>${esc(s.label)}</option>`).join('');
  const sexOpts = ['<option value="">—</option>', ...SEX.map((s) => `<option value="${s.value}">${esc(s.label)}</option>`)].join('');
  return `
    <div class="card">
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
          <a class="btn" href="today.html">Cancel</a>
        </div>
      </form>
    </div>`;
}

function render() {
  clearError();
  body.innerHTML = formHtml();
  const form = document.getElementById('pet-form');
  document.getElementById('f-name').focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit.disabled) return; // guard double-submit
    submit.disabled = true;
    try {
      const fd = new FormData(form);
      const pet = await petRepo.create({
        name: (fd.get('name') || '').toString().trim(),
        species: fd.get('species') || 'dog',
        date_of_birth: fd.get('date_of_birth') || null,
        sex: fd.get('sex') || null,
        breed: (fd.get('breed') || '').toString().trim() || null
      });
      // A newly added pet becomes the active one and opens on its Profile.
      setActivePetId(pet.id);
      await renderNav();
      location.href = 'profile.html';
    } catch (err) {
      submit.disabled = false;
      showError(err.message || String(err));
    }
  });
}

render();
