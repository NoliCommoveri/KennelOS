// training.js — Training: a puppy curriculum compiled from AKC and the Kennel
// Club (UK), seeded as CONTENT into training_skills (trainingSkillRepo). The
// track dropdown switches between three programs (age-staged AKC timeline, AKC
// S.T.A.R.'s flat checklist, the Kennel Club's level scheme) that cover a lot of
// the same underlying behaviors under different wording/grouping.
//
// Progress PORTS between tracks: skill_progress is keyed on skill_concept_id
// (trainingContent.js), not the individual skill id, so marking "Sits on cue"
// learned under S.T.A.R. shows the equivalent Timeline/Kennel-Club skill as
// learned too, without the family re-marking it per track. "Last practiced" is
// still shown per literal skill id (practice_logs.skill_id) — that's the honest
// per-checklist-item history; only the learned/in-progress STATE is shared.
import { petRepo } from '../data/petRepo.js';
import { trainingSkillRepo } from '../data/trainingSkillRepo.js';
import { practiceLogRepo } from '../data/practiceLogRepo.js';
import { skillProgressRepo } from '../data/skillProgressRepo.js';
import { PROGRAMS, STAGES, LEVELS, SKILLS, conceptLabel } from '../data/trainingContent.js';
import { getActivePetId } from '../data/settings.js';
import { TRAINING_PROGRAM, TRAINING_CATEGORY, SKILL_STATUS } from '../data/vocab.js';
import { todayYMD, daysBetween } from '../data/dateUtils.js';
import { esc, badge, showError, clearError } from '../assets/ui.js';

const body = document.getElementById('training-body');

// In-memory only — resets to the Timeline on a fresh page load, same as any
// other unsaved UI selection (no need to persist which track a family had open).
let selectedProgramId = PROGRAMS[0].id;

// Every skill id sharing a concept, precomputed once from the static content —
// used to decide "has this behavior been practiced under ANY track" for the
// in_progress fallback when a family un-marks a learned skill.
const SKILL_IDS_BY_CONCEPT = new Map();
for (const s of SKILLS) {
  const list = SKILL_IDS_BY_CONCEPT.get(s.skill_concept_id) || [];
  list.push(s.id);
  SKILL_IDS_BY_CONCEPT.set(s.skill_concept_id, list);
}

function ageInWeeks(dobYMD, todayYmd) {
  if (!dobYMD) return null;
  return Math.floor(daysBetween(dobYMD, todayYmd) / 7);
}

// The AKC Timeline stage matching the pet's current age, or the closest edge
// stage when younger/older than the whole timeline. Null with no DOB on file.
function currentStageId(weeks) {
  if (weeks == null) return null;
  const sorted = [...STAGES].sort((a, b) => a.order - b.order);
  const hit = sorted.find((s) => weeks >= s.min_weeks && weeks <= s.max_weeks);
  if (hit) return hit.id;
  return weeks < sorted[0].min_weeks ? sorted[0].id : sorted[sorted.length - 1].id;
}

function trackOptionsHtml() {
  return TRAINING_PROGRAM.map((p) =>
    `<option value="${esc(p.value)}"${p.value === selectedProgramId ? ' selected' : ''}>${esc(p.label)}</option>`
  ).join('');
}

function sourceLinkHtml(skill) {
  const via = skill.source_id === 'kennel_club_uk' ? 'The Kennel Club (UK)' : 'AKC';
  return `<a class="muted" href="${esc(skill.source_url)}" target="_blank" rel="noopener">via ${esc(via)} ↗</a>`;
}

function stepsHtml(steps) {
  if (!steps || !steps.length) return '';
  const items = steps.map((s) => `<li>${esc(s)}</li>`).join('');
  return `<details><summary>How to teach it</summary><ol style="margin:.4rem 0 0 1.1rem; padding:0;">${items}</ol></details>`;
}

function statusBadgeHtml(status) {
  return badge(SKILL_STATUS, status || 'not_started');
}

function skillRowHtml(skill, progress, lastPracticed, today) {
  const status = progress ? progress.status : 'not_started';
  const learnBtnLabel = status === 'learned' ? 'Undo — not learned yet' : 'Mark as learned';
  const practicedLine = lastPracticed ? `Last practiced ${esc(lastPracticed)}` : 'Not practiced yet';
  return `
    <div class="list-row">
      <div class="grow">
        <div><strong>${esc(skill.title)}</strong></div>
        <div class="sched-meta">${esc(skill.summary)}</div>
        ${stepsHtml(skill.steps)}
        <div class="sched-meta">${practicedLine} · ${sourceLinkHtml(skill)}</div>
        <div class="log-inline">
          <input type="date" class="log-date" value="${today}" max="${today}" aria-label="Practiced on" />
          <button type="button" class="btn btn-sm" data-log-skill="${esc(skill.id)}" data-concept="${esc(skill.skill_concept_id)}">Log practice</button>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:.4rem;">
        ${badge(TRAINING_CATEGORY, skill.category_id)}
        ${statusBadgeHtml(status)}
        <button type="button" class="btn btn-sm" data-toggle-learned="${esc(skill.skill_concept_id)}">${learnBtnLabel}</button>
      </div>
    </div>`;
}

function bucketSummary(label, skills, statusMap) {
  const learned = skills.filter((s) => (statusMap.get(s.skill_concept_id) || {}).status === 'learned').length;
  const tally = learned ? `${learned} of ${skills.length} learned` : `${skills.length}`;
  return `<summary class="bucket-summary"><span class="bucket-title">${esc(label)}</span><span class="bucket-count">${esc(tally)}</span></summary>`;
}

function bucketHtml(label, note, skills, isOpen, statusMap, lastPracticedMap, today) {
  const rows = skills.map((s) => skillRowHtml(s, statusMap.get(s.skill_concept_id), lastPracticedMap.get(s.id), today)).join('');
  return `
    <details class="bucket"${isOpen ? ' open' : ''}>
      ${bucketSummary(label, skills, statusMap)}
      ${note ? `<p class="muted" style="margin:0 0 .5rem;">${esc(note)}</p>` : ''}
      <div>${rows}</div>
    </details>`;
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

    const today = todayYMD();
    const program = PROGRAMS.find((p) => p.id === selectedProgramId) || PROGRAMS[0];
    const [skills, progressRows, practiceLogs] = await Promise.all([
      trainingSkillRepo.getByProgram(program.id),
      skillProgressRepo.statusMapForPet(pet.id),
      practiceLogRepo.getByPet(pet.id)
    ]);
    const statusMap = progressRows; // already a Map keyed by skill_concept_id
    const lastPracticedMap = new Map();
    for (const log of practiceLogs) {
      if (!lastPracticedMap.has(log.skill_id) || log.session_date > lastPracticedMap.get(log.skill_id)) {
        lastPracticedMap.set(log.skill_id, log.session_date);
      }
    }

    let sectionsHtml;
    if (program.structure_type === 'age_stage') {
      const weeks = ageInWeeks(pet.date_of_birth, today);
      const openStageId = currentStageId(weeks);
      sectionsHtml = [...STAGES]
        .filter((st) => st.program_id === program.id)
        .sort((a, b) => a.order - b.order)
        .map((st) => bucketHtml(
          st.label, st.developmental_note,
          skills.filter((s) => s.stage_id === st.id),
          weeks == null ? st.order === 1 : st.id === openStageId,
          statusMap, lastPracticedMap, today
        )).join('');
    } else if (program.structure_type === 'level') {
      // Levels are sequential-by-prerequisite, not age-gated (only Gold has a hard
      // age floor) — so unlike the Timeline there's no "current" level to compute
      // from a birthday; default to the first level open.
      sectionsHtml = [...LEVELS]
        .filter((lv) => lv.program_id === program.id)
        .sort((a, b) => a.order - b.order)
        .map((lv) => bucketHtml(
          `${lv.label} (${lv.typical_age_display})`, lv.notes,
          skills.filter((s) => s.level_id === lv.id),
          lv.order === 1,
          statusMap, lastPracticedMap, today
        )).join('');
    } else {
      // Flat checklist (S.T.A.R.) — no stage/level grouping.
      const learned = skills.filter((s) => (statusMap.get(s.skill_concept_id) || {}).status === 'learned').length;
      sectionsHtml = `
        <p class="muted">${learned} of ${skills.length} learned</p>
        <div class="card">${skills.map((s) => skillRowHtml(s, statusMap.get(s.skill_concept_id), lastPracticedMap.get(s.id), today)).join('')}</div>`;
    }

    body.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Training</h1>
          <p class="page-subtitle">${esc(pet.name)}'s training — house manners, basic cues, and socialization, from AKC and the Kennel Club (UK).</p>
        </div>
      </div>
      <div class="card">
        <div class="field">
          <label for="track-select">Track</label>
          <select id="track-select">${trackOptionsHtml()}</select>
        </div>
        <p class="muted" style="margin:.4rem 0 0;">
          <a href="${esc(program.official_url)}" target="_blank" rel="noopener">View the official program ↗</a> ·
          Marking a skill learned here carries over to the other tracks — they share a lot of the same ground.
        </p>
      </div>
      ${sectionsHtml}`;

    wireForm(pet);
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

function wireForm(pet) {
  const select = document.getElementById('track-select');
  if (select) {
    select.addEventListener('change', () => {
      selectedProgramId = select.value;
      render();
    });
  }

  body.querySelectorAll('[data-log-skill]').forEach((el) => {
    el.addEventListener('click', async () => {
      if (el.disabled) return;
      const row = el.closest('.list-row');
      const dateInput = row ? row.querySelector('.log-date') : null;
      const sessionDate = (dateInput && dateInput.value) || todayYMD();
      const skillId = el.getAttribute('data-log-skill');
      const conceptId = el.getAttribute('data-concept');
      el.disabled = true;
      try {
        await practiceLogRepo.create({ pet_id: pet.id, skill_id: skillId, session_date: sessionDate });
        const existing = await skillProgressRepo.getForConcept(pet.id, conceptId);
        if (!existing || existing.status === 'not_started') {
          await skillProgressRepo.setStatus(pet.id, conceptId, 'in_progress');
        }
        render();
      } catch (err) {
        el.disabled = false;
        showError(err.message || String(err));
      }
    });
  });

  body.querySelectorAll('[data-toggle-learned]').forEach((el) => {
    el.addEventListener('click', async () => {
      if (el.disabled) return;
      const conceptId = el.getAttribute('data-toggle-learned');
      el.disabled = true;
      try {
        const existing = await skillProgressRepo.getForConcept(pet.id, conceptId);
        if (existing && existing.status === 'learned') {
          const practicedIds = new Set((await practiceLogRepo.getByPet(pet.id)).map((l) => l.skill_id));
          const everPracticed = (SKILL_IDS_BY_CONCEPT.get(conceptId) || []).some((id) => practicedIds.has(id));
          await skillProgressRepo.setStatus(pet.id, conceptId, everPracticed ? 'in_progress' : 'not_started');
        } else {
          await skillProgressRepo.setStatus(pet.id, conceptId, 'learned');
        }
        render();
      } catch (err) {
        el.disabled = false;
        showError(err.message || String(err));
      }
    });
  });
}

render();
