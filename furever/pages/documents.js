// documents.js — the document vault for the active pet: contracts, registration,
// microchip, insurance, vet records, other. Each row owns exactly one stored file
// (data/fileRepo.js). Add-only + remove (no in-place edit): documentRepo.hardDelete
// is built specifically to delete a document AND its owned file together, so
// "Remove" is a true delete, not an archive — correcting a mistake is remove +
// re-add rather than editing metadata around an unchangeable upload.
//
// Two collapsible buckets, family docs first: "Your documents" (family-owned,
// full add/remove) above "From your breeder" (read-only, replaced wholesale on a
// pack resend). Each bucket defaults OPEN if it has documents, closed if empty.
// "+ New" opens a modal to add a document instead of an inline form.
import { petRepo } from '../data/petRepo.js';
import { documentRepo } from '../data/documentRepo.js';
import { fileRepo } from '../data/fileRepo.js';
import { getActivePetId } from '../data/settings.js';
import { DOC_TYPE, labelFor } from '../data/vocab.js';
import { todayYMD } from '../data/dateUtils.js';
import { esc, badge, showError, clearError } from '../assets/ui.js';

const body = document.getElementById('documents-body');

let confirmId = null; // doc id currently showing the "really remove?" step

const DOC_ICON = {
  contract: '✍️',
  registration: '📜',
  microchip: '🔖',
  insurance: '🛡️',
  vet_record: '🩺',
  other: '📄'
};
const docIcon = (t) => DOC_ICON[t] || DOC_ICON.other;

function typeOptionsHtml() {
  return DOC_TYPE.map((t) => `<option value="${t.value}">${esc(t.label)}</option>`).join('');
}

function docRowHtml(doc) {
  const confirming = doc.id === confirmId;
  const actions = confirming
    ? `<button type="button" class="btn btn-sm btn-danger" data-confirm-remove="${esc(doc.id)}">Really remove?</button>
       <button type="button" class="btn btn-sm" data-cancel-remove="${esc(doc.id)}">Cancel</button>`
    : `<button type="button" class="btn btn-sm" data-download="${esc(doc.id)}">Download</button>
       <button type="button" class="btn btn-sm" data-remove="${esc(doc.id)}">Remove</button>`;
  return `
    <div class="list-row" data-doc="${esc(doc.id)}">
      <span class="doc-icon" aria-hidden="true">${docIcon(doc.doc_type)}</span>
      <div class="grow">
        <strong>${esc(doc.title || labelFor(DOC_TYPE, doc.doc_type))}</strong> ${badge(DOC_TYPE, doc.doc_type)}
        ${doc.doc_date ? `<div class="muted" style="font-size:.85rem;">${esc(doc.doc_date)}</div>` : ''}
      </div>
      ${actions}
    </div>`;
}

// Breeder-published docs (source:'breeder', landed by contentPackFetch.js) are
// read-only: Download only, no edit and no family Remove — a republish blindly
// replaces them (documentRepo.replaceBreederLayer), so a family "Remove" would
// just reappear on the next resend, which reads as a bug (Content Package Fetch
// Mechanism §3.3).
function breederDocRowHtml(doc) {
  return `
    <div class="list-row" data-doc="${esc(doc.id)}">
      <span class="doc-icon" aria-hidden="true">${docIcon(doc.doc_type)}</span>
      <div class="grow">
        <strong>${esc(doc.title || labelFor(DOC_TYPE, doc.doc_type))}</strong> ${badge(DOC_TYPE, doc.doc_type)}
        ${doc.doc_date ? `<div class="muted" style="font-size:.85rem;">${esc(doc.doc_date)}</div>` : ''}
      </div>
      <button type="button" class="btn btn-sm" data-download="${esc(doc.id)}">Download</button>
    </div>`;
}

function bucketSummaryHtml(label, count) {
  return `<summary class="bucket-summary"><span class="bucket-title">${esc(label)}</span><span class="bucket-count">${count ? count : 'nothing yet'}</span></summary>`;
}

function familyBucketHtml(pet, docs) {
  const inner = docs.length
    ? docs.map(docRowHtml).join('')
    : `<p class="muted" style="padding:.5rem .2rem 0;">No documents filed for ${esc(pet.name)} yet.</p>`;
  return `<details class="bucket"${docs.length ? ' open' : ''}>
    ${bucketSummaryHtml('Your documents', docs.length)}
    <div>${inner}</div>
  </details>`;
}

function breederBucketHtml(docs) {
  const note = `<p class="muted" style="margin:0 0 .5rem;">Sent by your breeder and kept up to date automatically — not editable here.</p>`;
  const inner = docs.length
    ? note + docs.map(breederDocRowHtml).join('')
    : note + `<p class="muted" style="margin:0;">Nothing sent yet.</p>`;
  return `<details class="bucket"${docs.length ? ' open' : ''}>
    ${bucketSummaryHtml('From your breeder', docs.length)}
    <div>${inner}</div>
  </details>`;
}

function newDocModalHtml() {
  return `
    <div class="modal-backdrop" id="doc-modal">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="doc-modal-title">
        <button type="button" class="modal-close" id="doc-modal-close" aria-label="Close">×</button>
        <h2 class="modal-title" id="doc-modal-title">Add a document</h2>
        <div id="doc-modal-error" class="error-box"></div>
        <form id="doc-form" class="form-grid">
          <div class="field">
            <label for="d-file">File</label>
            <input id="d-file" name="file" type="file" required />
            <span class="hint">A photo of the paperwork works fine.</span>
          </div>
          <div class="field">
            <label for="d-title">Title</label>
            <input id="d-title" name="title" autocomplete="off" placeholder="e.g. AKC registration" />
          </div>
          <div class="field">
            <label for="d-type">Type</label>
            <select id="d-type" name="doc_type">${typeOptionsHtml()}</select>
          </div>
          <div class="field">
            <label for="d-date">Date</label>
            <input id="d-date" name="doc_date" type="date" max="${todayYMD()}" value="${todayYMD()}" />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save document</button>
          </div>
        </form>
      </div>
    </div>`;
}

function closeDocModal() {
  const backdrop = document.getElementById('doc-modal');
  if (backdrop) backdrop.remove();
  document.removeEventListener('keydown', onDocModalKey);
}

function onDocModalKey(e) {
  if (e.key === 'Escape') closeDocModal();
}

function openDocModal(pet) {
  closeDocModal();
  document.body.insertAdjacentHTML('beforeend', newDocModalHtml());
  const backdrop = document.getElementById('doc-modal');
  const closeBtn = document.getElementById('doc-modal-close');
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeDocModal(); });
  closeBtn.addEventListener('click', closeDocModal);
  document.addEventListener('keydown', onDocModalKey);
  closeBtn.focus();

  const form = document.getElementById('doc-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const fd = new FormData(form);
      const file = fd.get('file');
      if (!file || !(file instanceof File) || !file.size) {
        throw new Error('Please choose a file.');
      }
      const fileRecord = await fileRepo.create({ blob: file, name: file.name, mime: file.type });
      await documentRepo.create({
        pet_id: pet.id,
        doc_type: fd.get('doc_type') || 'other',
        doc_date: fd.get('doc_date') || todayYMD(),
        title: (fd.get('title') || '').toString().trim() || null,
        file_id: fileRecord.id
      });
      closeDocModal();
      render();
    } catch (err) {
      submit.disabled = false;
      showError(err.message || String(err), 'doc-modal-error');
    }
  });
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

    const allDocs = await documentRepo.getByPet(pet.id);
    const breederDocs = allDocs.filter((d) => d.source === 'breeder');
    const familyDocs = allDocs.filter((d) => d.source !== 'breeder');
    if (confirmId && !familyDocs.some((d) => d.id === confirmId)) confirmId = null;

    body.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Documents</h1>
          <p class="page-subtitle">${esc(pet.name)}'s contract, registration, and other paperwork.</p>
        </div>
        <button type="button" class="btn btn-primary" id="btn-new-doc">+ New</button>
      </div>
      ${familyBucketHtml(pet, familyDocs)}
      ${breederBucketHtml(breederDocs)}`;

    wire(pet);
    document.getElementById('btn-new-doc').addEventListener('click', () => openDocModal(pet));
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

function wire(pet) {
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

  body.querySelectorAll('[data-remove]').forEach((el) => {
    el.addEventListener('click', () => { confirmId = el.getAttribute('data-remove'); render(); });
  });
  body.querySelectorAll('[data-cancel-remove]').forEach((el) => {
    el.addEventListener('click', () => { confirmId = null; render(); });
  });
  body.querySelectorAll('[data-confirm-remove]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await documentRepo.hardDelete(el.getAttribute('data-confirm-remove'));
        confirmId = null;
        render();
      } catch (err) {
        showError(err.message || String(err));
      }
    });
  });
}

render();
