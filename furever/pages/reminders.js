// reminders.js — the active pet's live, DERIVED care schedule with a one-tap
// "log done". This is where the "no stored reminders" model is visible: checking
// an item off appends a care_events actual and the schedule recomputes (the item
// clears, or a recurring item rolls its next due forward). Split out of the old
// combined pet page; the logged history now lives on the Log page.
import { petRepo } from '../data/petRepo.js';
import { careEventRepo } from '../data/careEventRepo.js';
import { getActivePetId } from '../data/settings.js';
import { evaluatedForPet, eventTypeForCategory } from '../assets/petSchedule.js';
import { CARE_CATEGORY } from '../data/vocab.js';
import { todayYMD, daysBetween } from '../data/dateUtils.js';
import { esc, badge, relativeDue, showError } from '../assets/ui.js';

const body = document.getElementById('reminders-body');

function schedRowHtml(item) {
  const today = todayYMD();
  let meta;
  if (item.status === 'done') {
    meta = `Done ${esc(item.dueDate)}`;
  } else if (item.status === 'unscheduled') {
    meta = 'Add a birthday to schedule this';
  } else {
    const days = item.dueDate ? daysBetween(today, item.dueDate) : null;
    meta = `Due ${esc(relativeDue(days))} (${esc(item.dueDate)})`;
    if (item.lastDone) meta += ` · last ${esc(item.lastDone)}`;
  }
  const canLog = item.status !== 'unscheduled';
  const logBtn = canLog
    ? `<button type="button" class="btn btn-sm" data-log="${esc(item.itemId)}" data-cat="${esc(item.category)}" data-label="${esc(item.label)}">${item.status === 'done' ? 'Log again' : 'Log done'}</button>`
    : '';
  return `
    <li class="sched-item status-${esc(item.status)}">
      <span class="status-dot" aria-hidden="true"></span>
      <span class="sched-main">
        <span class="sched-label">${esc(item.label)}</span>
        <div class="sched-meta">${meta}</div>
        ${item.note ? `<div class="sched-note">${esc(item.note)}</div>` : ''}
      </span>
      ${badge(CARE_CATEGORY, item.category)}
      ${logBtn}
    </li>`;
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

    const { schedule } = await evaluatedForPet(pet);
    const list = schedule.length
      ? `<ul class="sched-list">${schedule.map(schedRowHtml).join('')}</ul>`
      : `<p class="muted">No schedule for this pet yet.${pet.species !== 'dog' ? ' Full schedules are dog-only for now — you can still log care on the Log page.' : ''}</p>`;

    body.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Reminders</h1>
          <p class="page-subtitle">${esc(pet.name)}'s care schedule — check each item off as it's done.</p>
        </div>
      </div>
      <div class="card">${list}</div>`;

    body.querySelectorAll('[data-log]').forEach((el) => {
      el.addEventListener('click', async () => {
        if (el.disabled) return;
        el.disabled = true;
        try {
          await careEventRepo.logForPlanItem(pet.id, el.getAttribute('data-log'), {
            event_type: eventTypeForCategory(el.getAttribute('data-cat')),
            event_date: todayYMD(),
            title: el.getAttribute('data-label')
          });
          render();
        } catch (err) {
          el.disabled = false;
          showError(err.message || String(err));
        }
      });
    });
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

render();
