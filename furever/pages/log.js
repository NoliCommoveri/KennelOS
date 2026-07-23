// log.js — the active pet's care history: the append-only care_events actuals,
// newest first. "What happened", the counterpart to the Reminders page's "what's
// due". Split out of the old combined pet page.
import { petRepo } from '../data/petRepo.js';
import { careEventRepo } from '../data/careEventRepo.js';
import { getActivePetId } from '../data/settings.js';
import { CARE_EVENT_TYPE, labelFor } from '../data/vocab.js';
import { esc, badge, showError } from '../assets/ui.js';

const body = document.getElementById('log-body');

function eventRowHtml(e) {
  return `
    <div class="list-row">
      <div class="grow">
        <div><strong>${esc(e.title || labelFor(CARE_EVENT_TYPE, e.event_type))}</strong></div>
        <div class="sched-meta">${esc(e.event_date)}</div>
        ${e.details ? `<div class="sched-note">${esc(e.details)}</div>` : ''}
      </div>
      ${badge(CARE_EVENT_TYPE, e.event_type)}
    </div>`;
}

async function render() {
  try {
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

    const events = await careEventRepo.getByPet(pet.id);
    const header = `
      <div class="page-header">
        <div>
          <h1>Log</h1>
          <p class="page-subtitle">${esc(pet.name)}'s care history — everything that's been logged.</p>
        </div>
      </div>`;

    if (!events.length) {
      body.innerHTML = header + `<div class="card empty-state">
        <span class="big" aria-hidden="true">📖</span>
        <h2>Nothing logged yet</h2>
        <p>Check an item off on the <a href="reminders.html">Reminders</a> page to start the record.</p>
      </div>`;
      return;
    }

    body.innerHTML = header + `<div class="card">${events.map(eventRowHtml).join('')}</div>`;
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

render();
