// today.js — the family-wide "what's due soon" home, the one cross-pet view
// (schema doc §active-pet scope). Reads schedule.familyDueSoon via the shared
// petSchedule helper: overdue + due-soon items across every pet, no rows stored.
import { familyFeed } from '../assets/petSchedule.js';
import { setActivePetId } from '../data/settings.js';
import { CARE_CATEGORY } from '../data/vocab.js';
import { todayYMD, daysBetween } from '../data/dateUtils.js';
import { esc, badge, relativeDue, showError } from '../assets/ui.js';

const body = document.getElementById('today-body');

function rowHtml(item) {
  const today = todayYMD();
  const days = item.dueDate ? daysBetween(today, item.dueDate) : null;
  const statusClass = item.status === 'overdue' ? 'status-overdue' : 'status-due_soon';
  return `
    <button type="button" class="sched-item ${statusClass}" data-pet="${esc(item.petId)}" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;font:inherit;color:inherit;">
      <span class="status-dot" aria-hidden="true"></span>
      <span class="sched-main">
        <span class="sched-label">${esc(item.petName)} — ${esc(item.label)}</span>
        <span class="sched-meta"> · ${esc(relativeDue(days))}</span>
      </span>
      ${badge(CARE_CATEGORY, item.category)}
    </button>`;
}

async function render() {
  try {
    const { feed, petCount } = await familyFeed();

    if (petCount === 0) {
      body.innerHTML = `
        <div class="card empty-state">
          <span class="big" aria-hidden="true">🐾</span>
          <h2>Welcome to Furever</h2>
          <p>Add your first pet to start a lifelong care calendar — vaccines, deworming,
             vet visits, and more, all timed from their birthday.</p>
          <p><a class="btn btn-primary" href="addpet.html">Add a pet</a></p>
        </div>`;
      return;
    }

    if (feed.length === 0) {
      body.innerHTML = `
        <div class="card empty-state">
          <span class="big" aria-hidden="true">✅</span>
          <h2>All caught up</h2>
          <p>Nothing is due in the next two weeks. Open a pet to see their full schedule.</p>
        </div>`;
      return;
    }

    body.innerHTML = `<div class="card">${feed.map(rowHtml).join('')}</div>`;

    // Clicking a due item re-scopes the app to that pet and opens its reminders.
    body.querySelectorAll('.sched-item[data-pet]').forEach((el) => {
      el.addEventListener('click', () => {
        setActivePetId(el.getAttribute('data-pet'));
        location.href = 'reminders.html';
      });
    });
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

render();
