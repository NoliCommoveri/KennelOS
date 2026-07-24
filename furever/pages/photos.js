// photos.js — the gallery for the active pet. Each photo owns one stored file
// (data/fileRepo.js), downscaled on the way in (assets/ui.js's imageFileToBlob) so
// the blob stays reasonable while still being full-size-viewable, unlike the tiny
// data-URL avatar on the pet record (profile.js). Add-only + remove (no in-place
// edit) — same reasoning as documents.js: photoRepo.hardDelete already deletes the
// row and its file together, so a correction is remove + re-add.
import { petRepo } from '../data/petRepo.js';
import { photoRepo } from '../data/photoRepo.js';
import { fileRepo } from '../data/fileRepo.js';
import { getActivePetId } from '../data/settings.js';
import { todayYMD } from '../data/dateUtils.js';
import { esc, showError, clearError, imageFileToBlob } from '../assets/ui.js';

const body = document.getElementById('photos-body');

let pendingFile = null;      // a File chosen via the Add-Photo tile, not yet saved
let pendingPreviewUrl = '';  // object URL for that file, shown in the pending card
let galleryUrls = [];        // object URLs for the current grid, revoked each render

function revokeGalleryUrls() {
  galleryUrls.forEach((u) => URL.revokeObjectURL(u));
  galleryUrls = [];
}

function revokePending() {
  if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
  pendingFile = null;
  pendingPreviewUrl = '';
}

function pendingCardHtml() {
  return `
    <div class="card">
      <h2>Add photo</h2>
      <img src="${esc(pendingPreviewUrl)}" alt="" style="max-width:100%;max-height:16rem;border-radius:10px;display:block;margin-bottom:.75rem;" />
      <form id="pending-form" class="form-grid">
        <div class="field">
          <label for="p-caption">Caption</label>
          <input id="p-caption" name="caption" autocomplete="off" placeholder="e.g. First day home" />
        </div>
        <div class="field">
          <label for="p-date">Date taken</label>
          <input id="p-date" name="taken_date" type="date" max="${todayYMD()}" value="${todayYMD()}" />
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save photo</button>
          <button type="button" class="btn" id="btn-cancel-pending">Cancel</button>
        </div>
      </form>
    </div>`;
}

function galleryItemHtml(photo, url) {
  return `
    <div class="gallery-item" data-photo="${esc(photo.id)}" role="button" tabindex="0" aria-label="${esc(photo.caption || 'View photo')}">
      ${url ? `<img src="${esc(url)}" alt="${esc(photo.caption || '')}" />` : ''}
      ${photo.caption ? `<span class="gallery-caption">${esc(photo.caption)}</span>` : ''}
    </div>`;
}

// --- View/remove modal -------------------------------------------------------

function photoModalHtml(photo, url) {
  return `
    <div class="modal-backdrop" id="photo-modal">
      <div class="modal photo-modal" role="dialog" aria-modal="true" aria-labelledby="photo-modal-title">
        <button type="button" class="modal-close" id="photo-modal-close" aria-label="Close">×</button>
        <h2 class="modal-title" id="photo-modal-title">${esc(photo.caption) || 'Photo'}</h2>
        <img src="${esc(url)}" alt="${esc(photo.caption || '')}" />
        ${photo.taken_date ? `<p class="muted" style="margin:.6rem 0 0;">${esc(photo.taken_date)}</p>` : ''}
        <div class="form-actions" id="photo-modal-actions" style="margin-top:1rem;">
          <button type="button" class="btn btn-sm" id="photo-modal-remove">Remove</button>
        </div>
      </div>
    </div>`;
}

function closePhotoModal() {
  const backdrop = document.getElementById('photo-modal');
  if (backdrop) backdrop.remove();
  document.removeEventListener('keydown', onPhotoModalKey);
}

function onPhotoModalKey(e) {
  if (e.key === 'Escape') closePhotoModal();
}

function openPhotoModal(photo, url) {
  closePhotoModal();
  document.body.insertAdjacentHTML('beforeend', photoModalHtml(photo, url));
  const backdrop = document.getElementById('photo-modal');
  const closeBtn = document.getElementById('photo-modal-close');
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closePhotoModal(); });
  closeBtn.addEventListener('click', closePhotoModal);
  document.addEventListener('keydown', onPhotoModalKey);
  closeBtn.focus();

  document.getElementById('photo-modal-remove').addEventListener('click', () => {
    const actions = document.getElementById('photo-modal-actions');
    actions.innerHTML = `
      <button type="button" class="btn btn-sm btn-danger" id="photo-modal-remove-confirm">Really remove?</button>
      <button type="button" class="btn btn-sm" id="photo-modal-remove-cancel">Cancel</button>`;
    document.getElementById('photo-modal-remove-cancel').addEventListener('click', () => openPhotoModal(photo, url));
    document.getElementById('photo-modal-remove-confirm').addEventListener('click', async () => {
      try {
        await photoRepo.hardDelete(photo.id);
        closePhotoModal();
        render();
      } catch (err) {
        closePhotoModal();
        showError(err.message || String(err));
      }
    });
  });
}

// --- Main render ---------------------------------------------------------

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

    revokeGalleryUrls();
    const photos = await photoRepo.getByPet(pet.id);
    const withUrls = await Promise.all(photos.map(async (p) => {
      const file = p.file_id ? await fileRepo.getById(p.file_id) : null;
      const url = file && file.blob ? URL.createObjectURL(file.blob) : '';
      if (url) galleryUrls.push(url);
      return { photo: p, url };
    }));

    body.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Photos</h1>
          <p class="page-subtitle">${esc(pet.name)}'s gallery.</p>
        </div>
      </div>
      ${pendingFile ? pendingCardHtml() : ''}
      <div class="card">
        <h2>${esc(pet.name)}'s photos</h2>
        <div class="gallery-grid">
          <div class="gallery-item gallery-add" id="gallery-add" role="button" tabindex="0" aria-label="Add photo">
            <div><span class="ph-icon" aria-hidden="true">📷</span><div>Add Photo</div></div>
          </div>
          ${withUrls.map(({ photo, url }) => galleryItemHtml(photo, url)).join('')}
        </div>
      </div>`;

    wire(pet, withUrls);
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

function wire(pet, withUrls) {
  const addTile = document.getElementById('gallery-add');
  if (addTile) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    addTile.appendChild(input);

    const open = () => input.click();
    addTile.addEventListener('click', open);
    addTile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      revokePending();
      pendingFile = file;
      pendingPreviewUrl = URL.createObjectURL(file);
      render();
    });
  }

  const pendingForm = document.getElementById('pending-form');
  if (pendingForm) {
    pendingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submit = pendingForm.querySelector('button[type="submit"]');
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        const fd = new FormData(pendingForm);
        const blob = await imageFileToBlob(pendingFile);
        const fileRecord = await fileRepo.create({ blob, name: pendingFile.name, mime: 'image/jpeg' });
        await photoRepo.create({
          pet_id: pet.id,
          taken_date: fd.get('taken_date') || todayYMD(),
          caption: (fd.get('caption') || '').toString().trim() || null,
          file_id: fileRecord.id
        });
        revokePending();
        render();
      } catch (err) {
        submit.disabled = false;
        showError(err.message || String(err));
      }
    });
    const cancel = document.getElementById('btn-cancel-pending');
    if (cancel) cancel.addEventListener('click', () => { revokePending(); render(); });
  }

  body.querySelectorAll('.gallery-item[data-photo]').forEach((el) => {
    const id = el.getAttribute('data-photo');
    const hit = withUrls.find((w) => w.photo.id === id);
    if (!hit) return;
    const open = () => openPhotoModal(hit.photo, hit.url);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

render();
