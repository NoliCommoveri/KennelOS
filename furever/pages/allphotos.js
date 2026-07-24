// allphotos.js — a top-level "Photo Gallery" page, sidebar entry between At A
// Glance and the pet list (not a pet subnav tab, not an At-A-Glance toggle — its
// own standalone spot). Display-only: pick a pet with the tabs below the title
// and browse their photos; there is no add tile and no remove here, on purpose —
// uploading still only happens on that pet's own Photos page (pages/photos.js).
// The selected pet is local view state (`selectedPetId`), independent of the
// app-wide active-pet selection the sidebar's own pet links drive.
import { petRepo } from '../data/petRepo.js';
import { photoRepo } from '../data/photoRepo.js';
import { fileRepo } from '../data/fileRepo.js';
import { getActivePetId } from '../data/settings.js';
import { esc, showError, clearError } from '../assets/ui.js';

const body = document.getElementById('allphotos-body');

let selectedPetId = null;
let galleryUrls = []; // object URLs for the current grid, revoked each render

function revokeGalleryUrls() {
  galleryUrls.forEach((u) => URL.revokeObjectURL(u));
  galleryUrls = [];
}

function petTabsHtml(pets, selectedId) {
  const tabs = pets.map((p) =>
    `<button type="button" class="subnav-link${p.id === selectedId ? ' active' : ''}" data-pet-tab="${esc(p.id)}">${esc(p.name)}</button>`
  ).join('');
  return `<div class="subnav-inner" style="border-bottom:none;padding:0 0 1rem;">${tabs}</div>`;
}

function galleryItemHtml(photo, url) {
  return `
    <div class="gallery-item" data-photo="${esc(photo.id)}" role="button" tabindex="0" aria-label="${esc(photo.caption || 'View photo')}">
      ${url ? `<img src="${esc(url)}" alt="${esc(photo.caption || '')}" />` : ''}
      ${photo.caption ? `<span class="gallery-caption">${esc(photo.caption)}</span>` : ''}
    </div>`;
}

function photoModalHtml(photo, url) {
  return `
    <div class="modal-backdrop" id="photo-view-modal">
      <div class="modal photo-modal" role="dialog" aria-modal="true" aria-labelledby="photo-view-title">
        <button type="button" class="modal-close" id="photo-view-close" aria-label="Close">×</button>
        <h2 class="modal-title" id="photo-view-title">${esc(photo.caption) || 'Photo'}</h2>
        <img src="${esc(url)}" alt="${esc(photo.caption || '')}" />
        ${photo.taken_date ? `<p class="muted" style="margin:.6rem 0 0;">${esc(photo.taken_date)}</p>` : ''}
      </div>
    </div>`;
}

function closePhotoModal() {
  const backdrop = document.getElementById('photo-view-modal');
  if (backdrop) backdrop.remove();
  document.removeEventListener('keydown', onPhotoModalKey);
}

function onPhotoModalKey(e) {
  if (e.key === 'Escape') closePhotoModal();
}

function openPhotoModal(photo, url) {
  closePhotoModal();
  document.body.insertAdjacentHTML('beforeend', photoModalHtml(photo, url));
  const backdrop = document.getElementById('photo-view-modal');
  const closeBtn = document.getElementById('photo-view-close');
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closePhotoModal(); });
  closeBtn.addEventListener('click', closePhotoModal);
  document.addEventListener('keydown', onPhotoModalKey);
  closeBtn.focus();
}

async function render() {
  try {
    clearError();
    const pets = await petRepo.getAll();
    if (!pets.length) {
      body.innerHTML = `<div class="card empty-state">
        <span class="big" aria-hidden="true">🐾</span>
        <h2>No pets yet</h2>
        <p>Add your first pet to start a photo gallery.</p>
        <p><a class="btn btn-primary" href="addpet.html">Add New Pet</a></p>
      </div>`;
      return;
    }

    if (!selectedPetId || !pets.some((p) => p.id === selectedPetId)) {
      const active = getActivePetId();
      selectedPetId = pets.some((p) => p.id === active) ? active : pets[0].id;
    }
    const pet = pets.find((p) => p.id === selectedPetId);

    revokeGalleryUrls();
    const photos = await photoRepo.getByPet(pet.id);
    const withUrls = await Promise.all(photos.map(async (p) => {
      const file = p.file_id ? await fileRepo.getById(p.file_id) : null;
      const url = file && file.blob ? URL.createObjectURL(file.blob) : '';
      if (url) galleryUrls.push(url);
      return { photo: p, url };
    }));

    const galleryHtml = withUrls.length
      ? `<div class="gallery-grid">${withUrls.map(({ photo, url }) => galleryItemHtml(photo, url)).join('')}</div>`
      : `<p class="muted" style="margin:0;">No photos yet for ${esc(pet.name)}.</p>`;

    body.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Photo Gallery</h1>
          <p class="page-subtitle">Add photos on your pet's page.</p>
        </div>
      </div>
      ${pets.length > 1 ? petTabsHtml(pets, pet.id) : ''}
      <div class="card">
        <h2>${esc(pet.name)}'s photos</h2>
        ${galleryHtml}
      </div>`;

    wire(withUrls);
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

function wire(withUrls) {
  body.querySelectorAll('[data-pet-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedPetId = btn.getAttribute('data-pet-tab');
      render();
    });
  });

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
