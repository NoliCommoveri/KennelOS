// pet.js — the active pet's home: identity, the live derived schedule (with a
// one-tap "log done" that appends an actual and clears/rolls the item), and the
// care history. This is where the "no stored reminders" model is visible:
// checking an item off writes a care_events row, and the schedule recomputes.
import { petRepo } from '../data/petRepo.js';
import { careEventRepo } from '../data/careEventRepo.js';
import { getActivePetId } from '../data/settings.js';
import { evaluatedForPet, eventTypeForCategory } from '../assets/petSchedule.js';
import { SPECIES, SEX, CARE_CATEGORY, CARE_EVENT_TYPE, labelFor } from '../data/vocab.js';
import { todayYMD, daysBetween } from '../data/dateUtils.js';
import { esc, badge, ageLabel, relativeDue, showError } from '../assets/ui.js';

const body = document.getElementById('pet-body');

function headerHtml(pet) {
  const bits = [badge(SPECIES, pet.species)];
  if (pet.sex) bits.push(badge(SEX, pet.sex));
  const sub = [];
  if (pet.breed) sub.push(esc(pet.breed));
  if (pet.date_of_birth) {
    const age = ageLabel(pet.date_of_birth, todayYMD());
    sub.push(`born ${esc(pet.date_of_birth)}${age ? ` · ${age} old` : ''}`);
  }
  const avatar = pet.photo_url
    ? `<img class="avatar" style="width:3.2rem;height:3.2rem;" src="${esc(pet.photo_url)}" alt="" />`
    : `<span class="avatar" style="width:3.2rem;height:3.2rem;font-size:1.6rem;" aria-hidden="true">🐾</span>`;
  return `
    <div class="card" style="display:flex;gap:.9rem;align-items:center;">
      ${avatar}
      <div class="grow">
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
          <h1 style="margin:0;font-size:1.35rem;">${esc(pet.name)}</h1>
          ${bits.join(' ')}
        </div>
        <div class="sched-meta">${sub.join(' · ') || 'No birthday set yet'}</div>
      </div>
    </div>`;
}

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

function historyHtml(events) {
  if (!events.length) return `<div class="card"><h2>Care history</h2><p class="muted">No care logged yet. Check an item off above to start the record.</p></div>`;
  const rows = events.slice(0, 30).map((e) => `
    <div class="list-row">
      <div class="grow">
        <div><strong>${esc(e.title || labelFor(CARE_EVENT_TYPE, e.event_type))}</strong></div>
        <div class="sched-meta">${esc(e.event_date)}</div>
      </div>
      ${badge(CARE_EVENT_TYPE, e.event_type)}
    </div>`).join('');
  return `<div class="card"><h2>Care history</h2>${rows}</div>`;
}

async function render() {
  try {
    const petId = getActivePetId();
    const pet = petId ? await petRepo.getById(petId) : null;
    if (!pet) {
      body.innerHTML = `<div class="card empty-state">
        <span class="big" aria-hidden="true">🐾</span>
        <h2>No pet selected</h2>
        <p>Add a pet or pick one from the menu to see its care schedule.</p>
        <p><a class="btn btn-primary" href="pets.html">Go to Pets</a></p>
      </div>`;
      return;
    }

    const { schedule, events } = await evaluatedForPet(pet);
    const list = schedule.length
      ? `<ul class="sched-list">${schedule.map(schedRowHtml).join('')}</ul>`
      : `<p class="muted">No schedule for this pet yet.${pet.species !== 'dog' ? ' Full schedules are dog-only for now — you can still log care and keep records.' : ''}</p>`;

    body.innerHTML = headerHtml(pet)
      + `<div class="section-title">Care schedule</div><div class="card">${list}</div>`
      + historyHtml(events);

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
