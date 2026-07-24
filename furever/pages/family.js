// family.js — the Family & Settings page. Three things the app-wide "whose app is
// this" needs a home for:
//   • the family name  → household singleton (shown as "Carson Family Pets" in the
//     banner), read back live into the nav after a save.
//   • the family's vet → a family-wide contacts row (pet_id null, type 'vet'), the
//     schema's designated home for it (shows for every pet).
//   • the palette      → a simple theme switcher (localStorage, applied instantly).
import { householdRepo } from '../data/householdRepo.js';
import { contactRepo } from '../data/contactRepo.js';
import { getTheme, setTheme, THEMES } from '../data/settings.js';
import { renderNav } from '../nav.js';
import { esc, showError, clearError } from '../assets/ui.js';

const body = document.getElementById('family-body');

// The one family-wide vet contact (pet_id null, type 'vet'), or null.
async function getFamilyVet() {
  const all = await contactRepo.getAll();
  return all.find((c) => c.pet_id == null && c.contact_type === 'vet') || null;
}

function familyCardHtml(household, vet) {
  const fn = household ? household.family_name || '' : '';
  const v = vet || {};
  return `
    <div class="card">
      <h2>Your family</h2>
      <form id="family-form" class="form-grid">
        <div class="field">
          <label for="f-family">Family name</label>
          <input id="f-family" name="family_name" autocomplete="off" value="${esc(fn)}" placeholder="Carson" />
          <span class="hint">Shown in the banner as “<span id="fam-preview">${esc(fn || 'Carson')}</span> Family Pets”.</span>
        </div>

        <div class="section-title" style="margin:.5rem 0 0;">Your vet</div>
        <div class="field">
          <label for="v-name">Vet / clinic name</label>
          <input id="v-name" name="vet_name" autocomplete="off" value="${esc(v.name)}" placeholder="Rivertown Animal Hospital" />
          <span class="hint">Saved for every pet. Leave blank to remove it.</span>
        </div>
        <div class="field">
          <label for="v-phone">Phone</label>
          <input id="v-phone" name="vet_phone" autocomplete="off" value="${esc(v.phone)}" />
        </div>
        <div class="field">
          <label for="v-email">Email</label>
          <input id="v-email" name="vet_email" autocomplete="off" value="${esc(v.email)}" />
        </div>
        <div class="field">
          <label for="v-address">Address</label>
          <input id="v-address" name="vet_address" autocomplete="off" value="${esc(v.address)}" />
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save</button>
          <span id="save-note" class="muted" style="align-self:center;"></span>
        </div>
      </form>
    </div>`;
}

function themeCardHtml() {
  const current = getTheme();
  const swatches = THEMES.map((t) => `
    <button type="button" class="theme-swatch${t.value === current ? ' active' : ''}" data-theme="${t.value}" aria-label="${esc(t.label)} theme">
      <span class="theme-dot" style="background:${t.swatch};"></span>
      <span>${esc(t.label)}</span>
    </button>`).join('');
  return `
    <div class="card">
      <h2>Appearance</h2>
      <p class="muted" style="margin-top:0;">Pick a color palette — it applies right away and works in light or dark mode.</p>
      <div class="theme-swatches">${swatches}</div>
    </div>`;
}

async function render() {
  try {
    clearError();
    const [household, vet] = await Promise.all([householdRepo.get(), getFamilyVet()]);
    body.innerHTML = familyCardHtml(household, vet) + themeCardHtml();
    wireFamilyForm(vet);
    wireThemes();
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

function wireFamilyForm(existingVet) {
  const form = document.getElementById('family-form');
  const preview = document.getElementById('fam-preview');
  const famInput = document.getElementById('f-family');

  famInput.addEventListener('input', () => {
    preview.textContent = famInput.value.trim() || 'Carson';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const fd = new FormData(form);
      const familyName = (fd.get('family_name') || '').toString().trim();
      await householdRepo.save({ family_name: familyName || null });

      // Upsert (or remove) the single family-wide vet contact.
      const vetName = (fd.get('vet_name') || '').toString().trim();
      const vetFields = {
        name: vetName,
        phone: (fd.get('vet_phone') || '').toString().trim() || null,
        email: (fd.get('vet_email') || '').toString().trim() || null,
        address: (fd.get('vet_address') || '').toString().trim() || null
      };
      if (vetName) {
        if (existingVet) await contactRepo.update(existingVet.id, vetFields);
        else await contactRepo.create({ pet_id: null, contact_type: 'vet', ...vetFields });
      } else if (existingVet) {
        await contactRepo.archive(existingVet.id);
      }

      await renderNav(); // banner picks up the new family name
      await render();    // rebuilds the form against the saved state
      const savedNote = document.getElementById('save-note');
      if (savedNote) savedNote.textContent = 'Saved ✓';
    } catch (err) {
      submit.disabled = false;
      showError(err.message || String(err));
    }
  });
}

function wireThemes() {
  body.querySelectorAll('.theme-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTheme(btn.getAttribute('data-theme'));
      body.querySelectorAll('.theme-swatch').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

render();
