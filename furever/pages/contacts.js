// contacts.js — the family's own contacts for the active pet (vet, emergency vet,
// groomer, trainer, other). NOT the breeder/breeder's vet — that's seed-layer,
// shown read-only on Profile's Breeder Info card. A contact here can be scoped
// to just this pet or to "All pets" (contacts.pet_id nullable, schema §contacts);
// the family-wide vet set on Family & Settings shows up here too, editable in
// place. Remove is a soft archive (contactRepo is not a hard-delete leaf we treat
// that way — family.js already archives the vet on clear, so this page matches it).
import { petRepo } from '../data/petRepo.js';
import { contactRepo } from '../data/contactRepo.js';
import { getActivePetId } from '../data/settings.js';
import { CONTACT_TYPE } from '../data/vocab.js';
import { esc, badge, showError, clearError } from '../assets/ui.js';

const body = document.getElementById('contacts-body');

let editingId = null; // contact currently loaded into the form, or null for "add new"

function phoneHtml(phone) {
  const p = (phone || '').trim();
  if (!p) return '';
  return `<a href="tel:${encodeURIComponent(p)}">${esc(p)}</a>`;
}

function typeOptionsHtml(selected) {
  return CONTACT_TYPE.map((t) =>
    `<option value="${t.value}"${t.value === selected ? ' selected' : ''}>${esc(t.label)}</option>`
  ).join('');
}

function formHtml(pet, existing) {
  const c = existing || {};
  const allPets = existing ? existing.pet_id == null : false;
  return `
    <div class="card">
      <h2>${existing ? 'Edit contact' : 'Add a contact'}</h2>
      <form id="contact-form" class="form-grid">
        <div class="field">
          <label for="c-name">Name</label>
          <input id="c-name" name="name" required autocomplete="off" value="${esc(c.name)}" />
        </div>
        <div class="field">
          <label for="c-type">Type</label>
          <select id="c-type" name="contact_type">${typeOptionsHtml(c.contact_type)}</select>
        </div>
        <div class="field">
          <label for="c-phone">Phone</label>
          <input id="c-phone" name="phone" autocomplete="off" value="${esc(c.phone)}" />
        </div>
        <div class="field">
          <label for="c-email">Email</label>
          <input id="c-email" name="email" type="email" autocomplete="off" value="${esc(c.email)}" />
        </div>
        <div class="field">
          <label for="c-address">Address</label>
          <input id="c-address" name="address" autocomplete="off" value="${esc(c.address)}" />
        </div>
        <div class="field">
          <label><input type="checkbox" name="all_pets"${allPets ? ' checked' : ''} /> Applies to all pets, not just ${esc(pet.name)}</label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">${existing ? 'Save changes' : 'Add contact'}</button>
          ${existing ? '<button type="button" class="btn" id="btn-cancel-edit">Cancel</button>' : ''}
        </div>
      </form>
    </div>`;
}

function contactRowHtml(c, pet) {
  const scope = c.pet_id == null ? `<span class="badge badge-neutral">All pets</span>` : '';
  const reach = [phoneHtml(c.phone), c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '']
    .filter(Boolean).join(' &middot; ');
  return `
    <div class="list-row" data-contact="${esc(c.id)}">
      <div class="grow">
        <strong>${esc(c.name)}</strong> ${badge(CONTACT_TYPE, c.contact_type)} ${scope}
        ${reach ? `<div class="muted" style="font-size:.85rem;">${reach}</div>` : ''}
        ${c.address ? `<div class="muted" style="font-size:.85rem;">${esc(c.address)}</div>` : ''}
      </div>
      <button type="button" class="btn btn-sm" data-edit="${esc(c.id)}">Edit</button>
      <button type="button" class="btn btn-sm" data-remove="${esc(c.id)}">Remove</button>
    </div>`;
}

function listHtml(pet, contacts) {
  if (!contacts.length) {
    return `<div class="card"><p class="muted" style="margin:0;">No contacts yet for ${esc(pet.name)}.</p></div>`;
  }
  return `<div class="card"><h2>${esc(pet.name)}'s contacts</h2>${contacts.map((c) => contactRowHtml(c, pet)).join('')}</div>`;
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

    const contacts = await contactRepo.getForPet(pet.id);
    const existing = editingId ? contacts.find((c) => c.id === editingId) || null : null;
    if (editingId && !existing) editingId = null; // it was removed out from under an open edit

    body.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Contacts</h1>
          <p class="page-subtitle">${esc(pet.name)}'s vet, groomer, and other important numbers.</p>
        </div>
      </div>
      ${formHtml(pet, existing)}
      ${listHtml(pet, contacts)}`;

    wire(pet, existing);
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

function wire(pet, existing) {
  const form = document.getElementById('contact-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const fd = new FormData(form);
      const data = {
        name: (fd.get('name') || '').toString().trim(),
        contact_type: fd.get('contact_type') || 'other',
        phone: (fd.get('phone') || '').toString().trim() || null,
        email: (fd.get('email') || '').toString().trim() || null,
        address: (fd.get('address') || '').toString().trim() || null,
        pet_id: fd.get('all_pets') ? null : pet.id
      };
      if (existing) await contactRepo.update(existing.id, data);
      else await contactRepo.create(data);
      editingId = null;
      render();
    } catch (err) {
      submit.disabled = false;
      showError(err.message || String(err));
    }
  });

  const cancel = document.getElementById('btn-cancel-edit');
  if (cancel) cancel.addEventListener('click', () => { editingId = null; render(); });

  body.querySelectorAll('[data-edit]').forEach((el) => {
    el.addEventListener('click', () => {
      editingId = el.getAttribute('data-edit');
      render();
    });
  });

  body.querySelectorAll('[data-remove]').forEach((el) => {
    el.addEventListener('click', async () => {
      try {
        await contactRepo.archive(el.getAttribute('data-remove'));
        if (editingId === el.getAttribute('data-remove')) editingId = null;
        render();
      } catch (err) {
        showError(err.message || String(err));
      }
    });
  });
}

render();
