// contacts.js — the family's contacts (vet, emergency vet, groomer, trainer,
// other). NOT the breeder/breeder's vet — that's seed-layer, shown read-only on
// Profile's Breeder Info card. Family-wide now, not a pet-scoped page: it lives
// under At A Glance (the Due Soon | Contacts toggle, see nav.js), and every
// contact names the specific pets it applies to via `pet_ids` (an array — see
// contactRepo.js). There's no "all pets" magic: a family-wide contact just lists
// every pet at save time, and a pet added later isn't retroactively linked.
//
// Each contact is a collapsible row (native <details>): collapsed shows just its
// type + name and "For <pet names>"; expanding shows the read-only detail. Fields
// only become editable after an explicit "Edit" click, so a stray tap while
// browsing can't change anything. "+ New" opens a modal to add a contact.
import { petRepo } from '../data/petRepo.js';
import { contactRepo } from '../data/contactRepo.js';
import { CONTACT_TYPE } from '../data/vocab.js';
import { esc, badge, showError, clearError } from '../assets/ui.js';

const body = document.getElementById('contacts-body');

let editingId = null; // contact currently showing its inline edit form, or null

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

function petCheckboxesHtml(pets, selectedIds) {
  const set = new Set(selectedIds || []);
  return `<div class="check-list">${pets.map((p) => `
    <label><input type="checkbox" name="pet_ids" value="${esc(p.id)}"${set.has(p.id) ? ' checked' : ''} /> ${esc(p.name)}</label>
  `).join('')}</div>`;
}

function readContactForm(form) {
  const fd = new FormData(form);
  return {
    name: (fd.get('name') || '').toString().trim(),
    contact_type: fd.get('contact_type') || 'other',
    phone: (fd.get('phone') || '').toString().trim() || null,
    email: (fd.get('email') || '').toString().trim() || null,
    address: (fd.get('address') || '').toString().trim() || null,
    pet_ids: fd.getAll('pet_ids')
  };
}

function sortContacts(contacts) {
  const order = new Map(CONTACT_TYPE.map((t, i) => [t.value, i]));
  return [...contacts].sort((a, b) => {
    const oa = order.has(a.contact_type) ? order.get(a.contact_type) : order.size;
    const ob = order.has(b.contact_type) ? order.get(b.contact_type) : order.size;
    if (oa !== ob) return oa - ob;
    return (a.name || '').localeCompare(b.name || '');
  });
}

function petNamesFor(petIds, petsById) {
  return (petIds || []).map((id) => petsById.get(id)).filter(Boolean).map((p) => p.name);
}

function contactSummaryHtml(c, petsById) {
  const names = petNamesFor(c.pet_ids, petsById);
  const forLine = names.length ? `For ${esc(names.join(', '))}` : 'No pets linked';
  return `
    <summary class="bucket-summary">
      <span class="bucket-title">${badge(CONTACT_TYPE, c.contact_type)} ${esc(c.name)}</span>
      <span class="bucket-count">${forLine}</span>
    </summary>`;
}

function contactDetailHtml(c) {
  const reach = [phoneHtml(c.phone), c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '']
    .filter(Boolean).join(' &middot; ');
  return `
    <div>
      ${reach ? `<div>${reach}</div>` : ''}
      ${c.address ? `<div class="muted">${esc(c.address)}</div>` : ''}
      <div class="form-actions">
        <button type="button" class="btn btn-sm" data-edit="${esc(c.id)}">Edit</button>
        <button type="button" class="btn btn-sm" data-remove="${esc(c.id)}">Remove</button>
      </div>
    </div>`;
}

function contactEditFormHtml(c, pets) {
  return `
    <div>
      <div id="edit-error-${esc(c.id)}" class="error-box"></div>
      <form class="form-grid" data-edit-form="${esc(c.id)}">
        <div class="field">
          <label for="ec-name-${esc(c.id)}">Name</label>
          <input id="ec-name-${esc(c.id)}" name="name" required autocomplete="off" value="${esc(c.name)}" />
        </div>
        <div class="field">
          <label for="ec-type-${esc(c.id)}">Type</label>
          <select id="ec-type-${esc(c.id)}" name="contact_type">${typeOptionsHtml(c.contact_type)}</select>
        </div>
        <div class="field">
          <label for="ec-phone-${esc(c.id)}">Phone</label>
          <input id="ec-phone-${esc(c.id)}" name="phone" autocomplete="off" value="${esc(c.phone)}" />
        </div>
        <div class="field">
          <label for="ec-email-${esc(c.id)}">Email</label>
          <input id="ec-email-${esc(c.id)}" name="email" type="email" autocomplete="off" value="${esc(c.email)}" />
        </div>
        <div class="field">
          <label for="ec-address-${esc(c.id)}">Address</label>
          <input id="ec-address-${esc(c.id)}" name="address" autocomplete="off" value="${esc(c.address)}" />
        </div>
        <div class="field">
          <span class="field-label">Applies to</span>
          ${petCheckboxesHtml(pets, c.pet_ids)}
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save changes</button>
          <button type="button" class="btn" data-cancel-edit="${esc(c.id)}">Cancel</button>
        </div>
      </form>
    </div>`;
}

function contactRowHtml(c, pets, petsById) {
  const isEditing = editingId === c.id;
  return `
    <details class="bucket"${isEditing ? ' open' : ''}>
      ${contactSummaryHtml(c, petsById)}
      ${isEditing ? contactEditFormHtml(c, pets) : contactDetailHtml(c)}
    </details>`;
}

function newContactModalHtml(pets) {
  return `
    <div class="modal-backdrop" id="contact-modal">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title">
        <button type="button" class="modal-close" id="contact-modal-close" aria-label="Close">×</button>
        <h2 class="modal-title" id="contact-modal-title">Add a contact</h2>
        <div id="contact-modal-error" class="error-box"></div>
        <form id="new-contact-form" class="form-grid">
          <div class="field">
            <label for="nc-name">Name</label>
            <input id="nc-name" name="name" required autocomplete="off" />
          </div>
          <div class="field">
            <label for="nc-type">Type</label>
            <select id="nc-type" name="contact_type">${typeOptionsHtml('vet')}</select>
          </div>
          <div class="field">
            <label for="nc-phone">Phone</label>
            <input id="nc-phone" name="phone" autocomplete="off" />
          </div>
          <div class="field">
            <label for="nc-email">Email</label>
            <input id="nc-email" name="email" type="email" autocomplete="off" />
          </div>
          <div class="field">
            <label for="nc-address">Address</label>
            <input id="nc-address" name="address" autocomplete="off" />
          </div>
          <div class="field">
            <span class="field-label">Applies to</span>
            ${petCheckboxesHtml(pets, [])}
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Add contact</button>
          </div>
        </form>
      </div>
    </div>`;
}

function closeContactModal() {
  const backdrop = document.getElementById('contact-modal');
  if (backdrop) backdrop.remove();
  document.removeEventListener('keydown', onContactModalKey);
}

function onContactModalKey(e) {
  if (e.key === 'Escape') closeContactModal();
}

function openContactModal(pets) {
  closeContactModal();
  document.body.insertAdjacentHTML('beforeend', newContactModalHtml(pets));
  const backdrop = document.getElementById('contact-modal');
  const closeBtn = document.getElementById('contact-modal-close');
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeContactModal(); });
  closeBtn.addEventListener('click', closeContactModal);
  document.addEventListener('keydown', onContactModalKey);
  closeBtn.focus();

  const form = document.getElementById('new-contact-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      await contactRepo.create(readContactForm(form));
      closeContactModal();
      render();
    } catch (err) {
      submit.disabled = false;
      showError(err.message || String(err), 'contact-modal-error');
    }
  });
}

async function render() {
  try {
    clearError();
    const [pets, contacts] = await Promise.all([petRepo.getAll(), contactRepo.getAll()]);

    if (!pets.length) {
      body.innerHTML = `<div class="card empty-state">
        <span class="big" aria-hidden="true">🐾</span>
        <h2>No pets yet</h2>
        <p>Add your first pet before saving a contact — every contact needs at least one pet to apply to.</p>
        <p><a class="btn btn-primary" href="addpet.html">Add New Pet</a></p>
      </div>`;
      return;
    }

    const petsById = new Map(pets.map((p) => [p.id, p]));
    const sorted = sortContacts(contacts);
    if (editingId && !sorted.some((c) => c.id === editingId)) editingId = null; // removed out from under an open edit

    const listHtml = sorted.length
      ? sorted.map((c) => contactRowHtml(c, pets, petsById)).join('')
      : `<div class="card empty-state"><p class="muted" style="margin:0;">No contacts yet. Tap “+ New” to add your vet, groomer, or trainer.</p></div>`;

    body.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Contacts</h1>
          <p class="page-subtitle">Your vets, groomer, trainer, and other important numbers.</p>
        </div>
        <button type="button" class="btn btn-primary" id="btn-new-contact">+ New</button>
      </div>
      ${listHtml}`;

    wireList(pets);
    document.getElementById('btn-new-contact').addEventListener('click', () => openContactModal(pets));
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

function wireList(pets) {
  body.querySelectorAll('[data-edit]').forEach((el) => {
    el.addEventListener('click', () => { editingId = el.getAttribute('data-edit'); render(); });
  });

  body.querySelectorAll('[data-cancel-edit]').forEach((el) => {
    el.addEventListener('click', () => { editingId = null; render(); });
  });

  body.querySelectorAll('[data-remove]').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.getAttribute('data-remove');
      try {
        await contactRepo.archive(id);
        if (editingId === id) editingId = null;
        render();
      } catch (err) {
        showError(err.message || String(err));
      }
    });
  });

  body.querySelectorAll('[data-edit-form]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = form.getAttribute('data-edit-form');
      const submit = form.querySelector('button[type="submit"]');
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        await contactRepo.update(id, readContactForm(form));
        editingId = null;
        render();
      } catch (err) {
        submit.disabled = false;
        showError(err.message || String(err), `edit-error-${id}`);
      }
    });
  });
}

render();
