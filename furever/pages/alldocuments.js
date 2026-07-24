// alldocuments.js — the At A Glance "Documents" toggle: every pet's paperwork in
// one place, display-only. Bucketed by pet (family + breeder docs mixed together,
// newest first — same order documentRepo.getByPet already returns; nothing here
// is editable either way, so there's no reason to separate them). Every bucket
// starts collapsed, always, regardless of how many documents it holds. No
// add/edit/remove here — that's still pages/documents.js, the pet-scoped vault;
// this is purely a read view with a Download action, same non-destructive read
// the vault itself allows.
import { petRepo } from '../data/petRepo.js';
import { documentRepo } from '../data/documentRepo.js';
import { fileRepo } from '../data/fileRepo.js';
import { DOC_TYPE, labelFor } from '../data/vocab.js';
import { esc, badge, showError, clearError } from '../assets/ui.js';

const body = document.getElementById('alldocs-body');

const DOC_ICON = {
  contract: '✍️',
  registration: '📜',
  microchip: '🔖',
  insurance: '🛡️',
  vet_record: '🩺',
  other: '📄'
};
const docIcon = (t) => DOC_ICON[t] || DOC_ICON.other;

function docRowHtml(doc) {
  return `
    <div class="list-row" data-doc="${esc(doc.id)}">
      <span class="doc-icon" aria-hidden="true">${docIcon(doc.doc_type)}</span>
      <div class="grow">
        <strong>${esc(doc.title || labelFor(DOC_TYPE, doc.doc_type))}</strong> ${badge(DOC_TYPE, doc.doc_type)}
        ${doc.source === 'breeder' ? '<span class="badge badge-neutral">From breeder</span>' : ''}
        ${doc.doc_date ? `<div class="muted" style="font-size:.85rem;">${esc(doc.doc_date)}</div>` : ''}
      </div>
      <button type="button" class="btn btn-sm" data-download="${esc(doc.id)}">Download</button>
    </div>`;
}

// Always starts collapsed — a glance view, not a worklist, so nothing forces
// itself open even when a pet does have documents.
function petBucketHtml(pet, docs) {
  const inner = docs.length
    ? docs.map(docRowHtml).join('')
    : `<p class="muted" style="padding:.5rem .2rem 0;">No documents filed for ${esc(pet.name)} yet.</p>`;
  return `<details class="bucket">
    <summary class="bucket-summary"><span class="bucket-title">${esc(pet.name)}</span><span class="bucket-count">${docs.length ? docs.length : 'nothing yet'}</span></summary>
    <div>${inner}</div>
  </details>`;
}

function wireDownloads() {
  body.querySelectorAll('[data-download]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        const doc = await documentRepo.getById(el.getAttribute('data-download'));
        const file = doc && doc.file_id ? await fileRepo.getById(doc.file_id) : null;
        if (!file || !file.blob) throw new Error('That file could not be found.');
        const url = URL.createObjectURL(file.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name || 'document';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        showError(err.message || String(err));
      }
    });
  });
}

async function render() {
  try {
    clearError();
    const pets = await petRepo.getAll();
    if (!pets.length) {
      body.innerHTML = `<div class="card empty-state">
        <span class="big" aria-hidden="true">🐾</span>
        <h2>No pets yet</h2>
        <p>Add your first pet to start filing documents.</p>
        <p><a class="btn btn-primary" href="addpet.html">Add New Pet</a></p>
      </div>`;
      return;
    }

    const docsByPet = await Promise.all(pets.map((p) => documentRepo.getByPet(p.id)));

    body.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Documents</h1>
          <p class="page-subtitle">Every pet's paperwork, at a glance.</p>
        </div>
      </div>
      ${pets.map((p, i) => petBucketHtml(p, docsByPet[i])).join('')}`;

    wireDownloads();
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

render();
