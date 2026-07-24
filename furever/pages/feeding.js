// feeding.js — the pet's feeding setup: their food brand plus a feeding schedule
// chosen from age-driven presets (radio buttons) or written by hand (Custom).
//
// The presets are CONTENT (careLibrary.FEEDING_PLAN), keyed to the life-stage
// brackets in ageBrackets.js, so the schedule is "driven by age": the preset that
// matches the pet's CURRENT age is marked Recommended and pre-selected on first
// visit. These portions are placeholders — real breed/food-specific amounts will
// arrive from the breeder's own feeding guidance (a fetched content pack) later —
// so a Custom option always lets the family override. Only the family's brand +
// choice persist (feedingRepo → the `feeding` row); the presets are never stored.
import { petRepo } from '../data/petRepo.js';
import { feedingRepo } from '../data/feedingRepo.js';
import { getActivePetId } from '../data/settings.js';
import { FEEDING_PLAN, feedingScheduleText } from '../data/careLibrary.js';
import { bracketByValue, ageInMonths, bracketForMonths } from '../data/ageBrackets.js';
import { todayYMD } from '../data/dateUtils.js';
import { esc, showError, clearError } from '../assets/ui.js';

const body = document.getElementById('feeding-body');

// The pet's current life-stage bracket value, or null when no birthday is set.
function currentBracket(pet) {
  const months = ageInMonths(pet.date_of_birth, todayYMD());
  return months == null ? null : bracketForMonths(months).value;
}

function presetRadioHtml(plan, { checked, recommended }) {
  const bracket = bracketByValue(plan.bracket);
  const title = bracket ? bracket.label : plan.bracket;
  const tag = recommended ? ` <span class="tag">Recommended</span>` : '';
  return `
    <label class="radio-row">
      <input type="radio" name="feeding_choice" value="${esc(plan.bracket)}"${checked ? ' checked' : ''} />
      <span class="radio-main">
        <span class="radio-title">${esc(title)}${tag}</span>
        <span class="radio-sub">${esc(feedingScheduleText(plan))}${plan.note ? ` — ${esc(plan.note)}` : ''}</span>
      </span>
    </label>`;
}

function customRadioHtml({ checked, customText }) {
  return `
    <label class="radio-row">
      <input type="radio" name="feeding_choice" value="custom"${checked ? ' checked' : ''} />
      <span class="radio-main">
        <span class="radio-title">Custom</span>
        <span class="radio-sub">Enter your own brand and amounts</span>
      </span>
    </label>
    <div class="custom-schedule-wrap"${checked ? '' : ' hidden'}>
      <input type="text" id="custom-schedule" placeholder="e.g. 1 cup, 2× per day" value="${esc(customText)}" />
    </div>`;
}

// The breeder's own guidance, when the seed packet carried one (Feeding
// Schedules feature, breeder-side). A litter override (free text) renders as a
// short highlighted note; a breed default renders as its weight x age grid.
// Rendered ABOVE the existing age-bracket presets — those keep working exactly
// as before, this is purely additive reference info.
function breederScheduleHtml(fs, breed) {
  if (!fs || (!fs.litterOverride && !fs.breedSchedule)) return '';
  if (fs.litterOverride) {
    return `<div class="card" style="margin-bottom:12px; border-left:3px solid var(--brand, #b06a4f);">
      <h3 style="margin:0 0 6px;">Your breeder's recommendation</h3>
      <p style="margin:0; white-space:pre-wrap;">${esc(fs.litterOverride)}</p>
    </div>`;
  }
  const bs = fs.breedSchedule;
  const cols = bs.ageColumns || [];
  const rowsHtml = (bs.weightRows || []).map((r) => `
    <tr><td style="padding:4px 8px 4px 0; white-space:nowrap;">${esc(r.label)}</td>${
      cols.map((_, i) => `<td style="padding:4px 8px;">${esc((r.amounts || [])[i] || '')}</td>`).join('')
    }</tr>`).join('');
  return `<div class="card" style="margin-bottom:12px; border-left:3px solid var(--brand, #b06a4f);">
    <h3 style="margin:0 0 6px;">Your breeder's feeding guide${breed ? ` for ${esc(breed)}` : ''}</h3>
    ${bs.foodBrand ? `<p class="muted" style="margin:0 0 8px;">${esc(bs.foodBrand)}</p>` : ''}
    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse; font-size:.9rem;">
        <thead><tr><th style="text-align:left; padding:4px 8px 4px 0;">Weight</th>${cols.map((c) => `<th style="text-align:left; padding:4px 8px;">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    ${bs.notes ? `<p class="muted" style="margin:8px 0 0;">${esc(bs.notes)}</p>` : ''}
  </div>`;
}

function formHtml(pet, feeding) {
  const brand = feeding ? (feeding.brand || '') : '';
  const savedChoice = feeding ? feeding.schedule_choice : null;
  const customText = feeding ? (feeding.custom_schedule || '') : '';
  const recommended = currentBracket(pet);
  // First visit (no saved choice): default to the age-appropriate preset.
  const selected = savedChoice || recommended || (FEEDING_PLAN[0] && FEEDING_PLAN[0].bracket) || 'custom';

  const presetRadios = FEEDING_PLAN.map((plan) => presetRadioHtml(plan, {
    checked: selected === plan.bracket,
    recommended: recommended === plan.bracket
  })).join('');

  return `
    <div class="page-header">
      <div>
        <h1>Feeding</h1>
        <p class="page-subtitle">${esc(pet.name)}'s food and daily feeding schedule.</p>
      </div>
    </div>
    <div class="card">
      <form id="feeding-form">
        <div class="field">
          <label for="feeding-brand">Food brand</label>
          <input id="feeding-brand" name="brand" autocomplete="off" value="${esc(brand)}" placeholder="e.g. Purina Pro Plan Puppy" />
        </div>

        <div class="section-title" style="margin:.9rem 0 .3rem;">Feeding schedule</div>
        <p class="muted" style="margin:0 0 .6rem;">Suggested by age — pick the stage that fits, or choose Custom. These are general amounts and will update with your breeder's feeding plan; always follow your vet's advice.</p>
        <div class="radio-group">
          ${presetRadios}
          ${customRadioHtml({ checked: selected === 'custom', customText })}
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save</button>
          <span id="feeding-saved" class="muted" style="align-self:center;"></span>
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
    const feeding = await feedingRepo.getForPet(pet.id);
    const fs = pet.seed && pet.seed.feedingSchedule;
    body.innerHTML = breederScheduleHtml(fs, pet.breed) + formHtml(pet, feeding);
    wireForm(pet);
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

function wireForm(pet) {
  const form = document.getElementById('feeding-form');
  const customWrap = form.querySelector('.custom-schedule-wrap');

  // Reveal the custom text box only while the Custom radio is selected.
  form.querySelectorAll('input[name="feeding_choice"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      customWrap.hidden = radio.value !== 'custom' || !radio.checked;
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const choice = (form.querySelector('input[name="feeding_choice"]:checked') || {}).value || null;
      const brand = form.querySelector('#feeding-brand').value.trim();
      const customText = form.querySelector('#custom-schedule').value.trim();
      await feedingRepo.saveForPet(pet.id, {
        brand: brand || null,
        schedule_choice: choice,
        custom_schedule: choice === 'custom' ? (customText || null) : null
      });
      const saved = document.getElementById('feeding-saved');
      if (saved) saved.textContent = 'Saved ✓';
      submit.disabled = false;
    } catch (err) {
      submit.disabled = false;
      showError(err.message || String(err));
    }
  });
}

render();
