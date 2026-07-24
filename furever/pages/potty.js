// potty.js — the house-training log, shown ONE DAY AT A TIME. The family taps to
// record a successful outside potty or an accident; each tap appends a potty_events
// row (pottyRepo) dated to the day being viewed. Prev/Next step the day; you can't
// look past today. Entries are the family's own high-frequency log — kept in their
// own table so care_events stays the scheduled-care actuals log (schema doc §potty).
import { petRepo } from '../data/petRepo.js';
import { pottyRepo } from '../data/pottyRepo.js';
import { getActivePetId } from '../data/settings.js';
import { POTTY_OUTCOME } from '../data/vocab.js';
import { todayYMD, addDaysToYMD } from '../data/dateUtils.js';
import { esc, badge, showError, clearError } from '../assets/ui.js';

const body = document.getElementById('potty-body');

// The day currently on screen (YYYY-MM-DD). Module state — the family steps it with
// the prev/next controls; it resets to today on each page load.
let viewedDate = todayYMD();

// A friendly label for the viewed day: Today / Yesterday / "Thu, Jul 24".
function dayLabel(ymd) {
  const t = todayYMD();
  if (ymd === t) return 'Today';
  if (ymd === addDaysToYMD(t, -1)) return 'Yesterday';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function tallyHtml(entries) {
  const outside = entries.filter((e) => e.outcome === 'success').length;
  const accidents = entries.filter((e) => e.outcome === 'accident').length;
  return `<div class="potty-tally"><span>🎉 ${outside} outside</span><span>·</span><span>⚠️ ${accidents} accident${accidents === 1 ? '' : 's'}</span></div>`;
}

function entryRowHtml(e) {
  return `
    <div class="list-row potty-row">
      <div class="grow">
        <span class="potty-time">${esc(e.occurred_time || '')}</span>
        ${badge(POTTY_OUTCOME, e.outcome)}
        ${e.notes ? `<div class="sched-note">${esc(e.notes)}</div>` : ''}
      </div>
      <button type="button" class="btn btn-sm" data-remove="${esc(e.id)}">Remove</button>
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

    const entries = await pottyRepo.getByPetAndDate(pet.id, viewedDate);
    const atToday = viewedDate === todayYMD();

    const list = entries.length
      ? `<div>${entries.map(entryRowHtml).join('')}</div>`
      : `<p class="muted" style="padding:.4rem .2rem 0;">No potty breaks logged for this day yet.</p>`;

    body.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Potty</h1>
          <p class="page-subtitle">${esc(pet.name)}'s house-training log.</p>
        </div>
      </div>
      <div class="card">
        <div class="day-nav">
          <button type="button" class="btn btn-sm" id="day-prev" aria-label="Previous day">‹</button>
          <span class="day-label">${esc(dayLabel(viewedDate))}</span>
          <button type="button" class="btn btn-sm" id="day-next" aria-label="Next day"${atToday ? ' disabled' : ''}>›</button>
        </div>
        <div class="potty-actions">
          <button type="button" class="btn btn-primary potty-btn" data-log="success">🎉 Went outside</button>
          <button type="button" class="btn potty-btn" data-log="accident">⚠️ Accident</button>
        </div>
        ${tallyHtml(entries)}
        ${list}
      </div>`;

    wire(pet);
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

function wire(pet) {
  const prev = document.getElementById('day-prev');
  const next = document.getElementById('day-next');
  if (prev) prev.addEventListener('click', () => { viewedDate = addDaysToYMD(viewedDate, -1); render(); });
  if (next) next.addEventListener('click', () => {
    if (viewedDate === todayYMD()) return;
    viewedDate = addDaysToYMD(viewedDate, 1);
    render();
  });

  body.querySelectorAll('[data-log]').forEach((el) => {
    el.addEventListener('click', async () => {
      if (el.disabled) return;
      el.disabled = true;
      try {
        await pottyRepo.log(pet.id, { outcome: el.getAttribute('data-log'), occurred_date: viewedDate });
        render();
      } catch (err) {
        el.disabled = false;
        showError(err.message || String(err));
      }
    });
  });

  body.querySelectorAll('[data-remove]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await pottyRepo.hardDelete(el.getAttribute('data-remove'));
        render();
      } catch (err) {
        showError(err.message || String(err));
      }
    });
  });
}

render();
