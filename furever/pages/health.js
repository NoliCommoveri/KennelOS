// health.js — the merged Reminders + Log page. It shows the active pet's DERIVED
// care schedule (schedule.js — nothing stored) BUCKETED BY LIFE STAGE, and lets
// the family log an item done with a chosen "completed on" date right beside it.
// Below the schedule sits the care history — the logged actuals (the old Log page).
//
// Two behaviors worth calling out:
//   • Age brackets (ageBrackets.js): each schedule item is grouped by the age it
//     comes due at (from its offset, so bucketing works even before a birthday is
//     set). Every bucket is collapsible; only the pet's CURRENT age bucket is open
//     on load, the rest collapsed — the family sees "what's happening now" first.
//   • Inline completed-on: instead of a one-tap "log today", each item carries a
//     date input (defaulting to today) so the family can record the real date it
//     was done. Logging appends a care_events actual exactly as before, so the
//     derived reminder clears / a recurring item rolls forward.
import { petRepo } from '../data/petRepo.js';
import { careEventRepo } from '../data/careEventRepo.js';
import { getActivePetId } from '../data/settings.js';
import { itemsForPet, eventTypeForCategory } from '../assets/petSchedule.js';
import { evaluateSchedule } from '../data/schedule.js';
import { AGE_BRACKETS, offsetToMonths, ageInMonths, bracketForMonths } from '../data/ageBrackets.js';
import { CARE_CATEGORY, CARE_EVENT_TYPE, labelFor } from '../data/vocab.js';
import { todayYMD, daysBetween } from '../data/dateUtils.js';
import { esc, badge, relativeDue, showError } from '../assets/ui.js';

const body = document.getElementById('health-body');

// Family-authored plans anchored to a start date have no "age" meaning; they land
// in a trailing bucket after the life-stage brackets.
const OTHER_GROUP = { value: 'other', label: 'Custom & ongoing' };
const GROUP_ORDER = [...AGE_BRACKETS, OTHER_GROUP];

// The life-stage bucket a schedule item belongs to. DOB-anchored items bucket by
// the age they first come due at (offset → months); everything else is 'other'.
function bucketFor(normItem) {
  if (normItem.anchor === 'dob') return bracketForMonths(offsetToMonths(normItem.offset)).value;
  return OTHER_GROUP.value;
}

function metaFor(item, today) {
  if (item.status === 'done') return `Completed ${esc(item.dueDate)}`;
  if (item.status === 'unscheduled') return 'Add a birthday to schedule this';
  const days = item.dueDate ? daysBetween(today, item.dueDate) : null;
  let m = `Due ${esc(relativeDue(days))} (${esc(item.dueDate)})`;
  if (item.lastDone) m += ` · last ${esc(item.lastDone)}`;
  return m;
}

// One schedule row: the item, its status/meta, and — unless it can't be scheduled
// yet — an inline "completed on" date + log button.
function itemRowHtml(item, today) {
  const canLog = item.status !== 'unscheduled';
  const logControls = canLog
    ? `<div class="log-inline">
         <input type="date" class="log-date" value="${today}" max="${today}" aria-label="Completed on" />
         <button type="button" class="btn btn-sm" data-log="${esc(item.itemId)}" data-cat="${esc(item.category)}" data-label="${esc(item.label)}">${item.status === 'done' ? 'Log again' : 'Mark done'}</button>
       </div>`
    : '';
  return `
    <li class="sched-item status-${esc(item.status)}">
      <span class="status-dot" aria-hidden="true"></span>
      <span class="sched-main">
        <span class="sched-label">${esc(item.label)}</span>
        <div class="sched-meta">${metaFor(item, today)}</div>
        ${item.note ? `<div class="sched-note">${esc(item.note)}</div>` : ''}
      </span>
      ${badge(CARE_CATEGORY, item.category)}
      ${logControls}
    </li>`;
}

// The collapsed/expanded summary line for a bucket: its label plus a small tally so
// a collapsed bucket still says what's inside.
function bucketSummary(label, items) {
  const done = items.filter((i) => i.status === 'done').length;
  const todo = items.length - done;
  const parts = [];
  if (todo) parts.push(`${todo} to do`);
  if (done) parts.push(`${done} done`);
  const tally = parts.length ? parts.join(' · ') : `${items.length}`;
  return `<summary class="bucket-summary"><span class="bucket-title">${esc(label)}</span><span class="bucket-count">${esc(tally)}</span></summary>`;
}

function bucketHtml(group, items, isOpen, today) {
  const rows = items.map((i) => itemRowHtml(i, today)).join('');
  return `
    <details class="bucket"${isOpen ? ' open' : ''}>
      ${bucketSummary(group.label, items)}
      <ul class="sched-list">${rows}</ul>
    </details>`;
}

function historyRowHtml(e) {
  return `
    <div class="list-row">
      <div class="grow">
        <div><strong>${esc(e.title || labelFor(CARE_EVENT_TYPE, e.event_type))}</strong></div>
        <div class="sched-meta">${esc(e.event_date)}</div>
        ${e.details ? `<div class="sched-note">${esc(typeof e.details === 'string' ? e.details : '')}</div>` : ''}
      </div>
      ${badge(CARE_EVENT_TYPE, e.event_type)}
    </div>`;
}

function historyHtml(events) {
  if (!events.length) {
    return `<details class="bucket"><summary class="bucket-summary"><span class="bucket-title">Care history</span><span class="bucket-count">nothing yet</span></summary>
      <p class="muted" style="padding:.5rem .2rem 0;">Mark an item done above to start the record.</p></details>`;
  }
  return `<details class="bucket"><summary class="bucket-summary"><span class="bucket-title">Care history</span><span class="bucket-count">${events.length}</span></summary>
    <div>${events.map(historyRowHtml).join('')}</div></details>`;
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

    const today = todayYMD();
    const [items, events] = await Promise.all([itemsForPet(pet), careEventRepo.getByPet(pet.id)]);
    const normById = new Map(items.map((it) => [it.itemId, it]));
    const evaluated = evaluateSchedule(items, pet, events, today);

    // Group the evaluated items into their life-stage buckets, preserving the
    // engine's within-group ordering (overdue → done).
    const groups = new Map(GROUP_ORDER.map((g) => [g.value, []]));
    for (const ev of evaluated) {
      const norm = normById.get(ev.itemId);
      const bucket = norm ? bucketFor(norm) : OTHER_GROUP.value;
      groups.get(bucket).push(ev);
    }

    // Which bucket to auto-expand: the pet's current age bucket. With no DOB there's
    // no current age, so fall back to the first non-empty bucket.
    const ageMonths = ageInMonths(pet.date_of_birth, today);
    let currentBucket = ageMonths == null ? null : bracketForMonths(ageMonths).value;
    if (currentBucket == null || !(groups.get(currentBucket) || []).length) {
      const firstNonEmpty = GROUP_ORDER.find((g) => (groups.get(g.value) || []).length);
      currentBucket = firstNonEmpty ? firstNonEmpty.value : null;
    }

    const bucketsHtml = GROUP_ORDER
      .filter((g) => groups.get(g.value).length)
      .map((g) => bucketHtml(g, groups.get(g.value), g.value === currentBucket, today))
      .join('');

    const scheduleSection = bucketsHtml
      ? bucketsHtml
      : `<div class="card"><p class="muted">No schedule for this pet yet.${pet.species !== 'dog' ? ' Full schedules are dog-only for now — you can still log care below.' : ''}</p></div>`;

    body.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Health</h1>
          <p class="page-subtitle">${esc(pet.name)}'s care schedule by age — mark each item done as it happens.</p>
        </div>
      </div>
      ${scheduleSection}
      ${historyHtml(events)}`;

    wireLogButtons(pet);
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

function wireLogButtons(pet) {
  body.querySelectorAll('[data-log]').forEach((el) => {
    el.addEventListener('click', async () => {
      if (el.disabled) return;
      const row = el.closest('.sched-item');
      const dateInput = row ? row.querySelector('.log-date') : null;
      const eventDate = (dateInput && dateInput.value) || todayYMD();
      el.disabled = true;
      try {
        await careEventRepo.logForPlanItem(pet.id, el.getAttribute('data-log'), {
          event_type: eventTypeForCategory(el.getAttribute('data-cat')),
          event_date: eventDate,
          title: el.getAttribute('data-label')
        });
        render();
      } catch (err) {
        el.disabled = false;
        showError(err.message || String(err));
      }
    });
  });
}

render();
