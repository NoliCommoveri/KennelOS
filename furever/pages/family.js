// family.js — the Family & Settings page. Three things the app-wide "whose app is
// this" needs a home for:
//   • the family name  → household singleton (shown as "Carson Family Pets" in the
//     banner), read back live into the nav after a save.
//   • the family's vet → a family-wide contacts row (pet_id null, type 'vet'), the
//     schema's designated home for it (shows for every pet).
//   • the palette      → a simple theme switcher (localStorage, applied instantly).
import { householdRepo } from '../data/householdRepo.js';
import { contactRepo } from '../data/contactRepo.js';
import { getTheme, setTheme, THEMES, getLastBackupDate } from '../data/settings.js';
import { requestPersistentStorage, isStoragePersisted } from '../data/db.js';
import { getResetCounts, resetApp } from '../data/appReset.js';
import { downloadBackup, readBackupFile, inspectBackup, restoreBackup } from '../data/importExport.js';
import { renderNav } from '../nav.js';
import { esc, showError, clearError } from '../assets/ui.js';

const body = document.getElementById('family-body');

// The one family-wide vet contact (pet_id null, type 'vet'), or null.
async function getFamilyVet() {
  const all = await contactRepo.getAll();
  return all.find((c) => c.pet_id == null && c.contact_type === 'vet') || null;
}

function familyCardHtml(household, vet) {
  const fn = household ? household.family_name || '' : '';
  const v = vet || {};
  return `
    <div class="card">
      <h2>Your family</h2>
      <form id="family-form" class="form-grid">
        <div class="field">
          <label for="f-family">Family name</label>
          <input id="f-family" name="family_name" autocomplete="off" value="${esc(fn)}" placeholder="Carson" />
          <span class="hint">Shown in the banner as “<span id="fam-preview">${esc(fn || 'Carson')}</span> Family Pets”.</span>
        </div>

        <div class="section-title" style="margin:.5rem 0 0;">Your vet</div>
        <div class="field">
          <label for="v-name">Vet / clinic name</label>
          <input id="v-name" name="vet_name" autocomplete="off" value="${esc(v.name)}" placeholder="Rivertown Animal Hospital" />
          <span class="hint">Saved for every pet. Leave blank to remove it.</span>
        </div>
        <div class="field">
          <label for="v-phone">Phone</label>
          <input id="v-phone" name="vet_phone" autocomplete="off" value="${esc(v.phone)}" />
        </div>
        <div class="field">
          <label for="v-email">Email</label>
          <input id="v-email" name="vet_email" autocomplete="off" value="${esc(v.email)}" />
        </div>
        <div class="field">
          <label for="v-address">Address</label>
          <input id="v-address" name="vet_address" autocomplete="off" value="${esc(v.address)}" />
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save</button>
          <span id="save-note" class="muted" style="align-self:center;"></span>
        </div>
      </form>
    </div>`;
}

function themeCardHtml() {
  const current = getTheme();
  const swatches = THEMES.map((t) => `
    <button type="button" class="theme-swatch${t.value === current ? ' active' : ''}" data-theme="${t.value}" aria-label="${esc(t.label)} theme">
      <span class="theme-dot" style="background:${t.swatch};"></span>
      <span>${esc(t.label)}</span>
    </button>`).join('');
  return `
    <div class="card">
      <h2>Appearance</h2>
      <p class="muted" style="margin-top:0;">Pick a color palette — it applies right away and works in light or dark mode.</p>
      <div class="theme-swatches">${swatches}</div>
    </div>`;
}

// --- Keeping your data safe (storage durability) ---------------------------
// Furever asks for durable storage silently once on first run (app.js). If the
// browser didn't grant it then, this is the family's way to ask again — and to
// see that their data is protected.
function storageCardHtml(persisted) {
  return `
    <div class="card">
      <h2>Keeping your data safe</h2>
      <p class="muted" style="margin-top:0;">
        Everything in Furever lives on this device, in this browser. Ask your
        browser to hold onto it so it isn’t cleared to free up space.
      </p>
      <div class="form-actions" style="align-items:center;">
        <button type="button" id="persist-btn" class="btn"${persisted ? ' disabled' : ''}>
          ${persisted ? 'Your data is protected ✓' : 'Keep my data safe'}
        </button>
        <span id="persist-note" class="muted" style="align-self:center;"></span>
      </div>
    </div>`;
}

// --- Backup & restore --------------------------------------------------------
// A full JSON export/import of everything in Furever (data/importExport.js) — the
// family's own copy, independent of the browser's storage surviving. Restore is a
// two-step flow: pick a file → see a row-count preview → confirm merge/replace,
// the same "see it, then commit" shape as the danger-zone reset below.
function backupCardHtml(lastBackupIso) {
  const last = lastBackupIso
    ? new Date(lastBackupIso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';
  return `
    <div class="card">
      <h2>Backup &amp; restore</h2>
      <p class="muted" style="margin-top:0;">
        Download everything in Furever — every pet, photo, document, and care
        history — as one file you keep. Save it somewhere safe (cloud storage,
        email it to yourself); restoring it, even on a new phone, brings
        everything back.
      </p>
      <div class="form-actions" style="align-items:center;">
        <button type="button" id="btn-backup" class="btn btn-primary">Download backup</button>
        <span class="muted">Last backup: ${esc(last)}</span>
      </div>
      <div class="section-title">Restore from a file</div>
      <div class="field">
        <input type="file" id="restore-file" accept="application/json" />
      </div>
      <div id="restore-preview"></div>
    </div>`;
}

// --- Danger zone (hard reset) ----------------------------------------------
function dangerCardHtml() {
  return `
    <div class="card danger-card">
      <h2>Reset app</h2>
      <p class="muted" style="margin-top:0;">
        Erase <strong>everything</strong> in Furever on this device — every pet,
        photo, document, and all your care history — and start over from a blank
        app. This can’t be undone.
      </p>
      <div id="reset-controls" class="form-actions">
        <button type="button" id="reset-start" class="btn btn-danger">Reset app…</button>
      </div>
    </div>`;
}

async function render() {
  try {
    clearError();
    const [household, vet, persisted] = await Promise.all([
      householdRepo.get(), getFamilyVet(), isStoragePersisted()
    ]);
    body.innerHTML = familyCardHtml(household, vet) + themeCardHtml()
      + storageCardHtml(persisted) + backupCardHtml(getLastBackupDate()) + dangerCardHtml();
    wireFamilyForm(vet);
    wireThemes();
    wireStorage();
    wireBackup();
    wireDanger();
  } catch (err) {
    showError(err.message || String(err));
    body.innerHTML = '';
  }
}

function wireFamilyForm(existingVet) {
  const form = document.getElementById('family-form');
  const preview = document.getElementById('fam-preview');
  const famInput = document.getElementById('f-family');

  famInput.addEventListener('input', () => {
    preview.textContent = famInput.value.trim() || 'Carson';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const fd = new FormData(form);
      const familyName = (fd.get('family_name') || '').toString().trim();
      await householdRepo.save({ family_name: familyName || null });

      // Upsert (or remove) the single family-wide vet contact.
      const vetName = (fd.get('vet_name') || '').toString().trim();
      const vetFields = {
        name: vetName,
        phone: (fd.get('vet_phone') || '').toString().trim() || null,
        email: (fd.get('vet_email') || '').toString().trim() || null,
        address: (fd.get('vet_address') || '').toString().trim() || null
      };
      if (vetName) {
        if (existingVet) await contactRepo.update(existingVet.id, vetFields);
        else await contactRepo.create({ pet_id: null, contact_type: 'vet', ...vetFields });
      } else if (existingVet) {
        await contactRepo.archive(existingVet.id);
      }

      await renderNav(); // banner picks up the new family name
      await render();    // rebuilds the form against the saved state
      const savedNote = document.getElementById('save-note');
      if (savedNote) savedNote.textContent = 'Saved ✓';
    } catch (err) {
      submit.disabled = false;
      showError(err.message || String(err));
    }
  });
}

function wireThemes() {
  body.querySelectorAll('.theme-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTheme(btn.getAttribute('data-theme'));
      body.querySelectorAll('.theme-swatch').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function wireStorage() {
  const btn = document.getElementById('persist-btn');
  if (!btn || btn.disabled) return; // already protected — nothing to ask for
  const note = document.getElementById('persist-note');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const granted = await requestPersistentStorage();
    if (granted) {
      btn.textContent = 'Your data is protected ✓';
      if (note) note.textContent = '';
    } else {
      btn.disabled = false;
      if (note) note.textContent = 'Your browser didn’t grant this. Adding Furever to your home screen helps.';
    }
  });
}

function wireBackup() {
  const backupBtn = document.getElementById('btn-backup');
  backupBtn.addEventListener('click', async () => {
    backupBtn.disabled = true;
    try {
      await downloadBackup();
      render(); // refresh the "Last backup" line
    } catch (err) {
      backupBtn.disabled = false;
      showError(err.message || String(err));
    }
  });

  const fileInput = document.getElementById('restore-file');
  const preview = document.getElementById('restore-preview');
  let pendingBackup = null;

  function renderPreview(info) {
    const total = Object.values(info.counts).reduce((a, b) => a + b, 0);
    const rows = Object.entries(info.counts)
      .filter(([, n]) => n > 0)
      .map(([name, n]) => `<div class="detail-row" style="font-size:.9rem;padding:.3rem 0;"><span class="detail-key">${esc(name)}</span><span class="detail-val">${n}</span></div>`)
      .join('');
    const when = info.exported_at ? new Date(info.exported_at).toLocaleString() : 'an unknown date';
    preview.innerHTML = `
      <div class="card" style="margin-top:.75rem;background:var(--surface-2);box-shadow:none;">
        <p class="muted" style="margin-top:0;">Exported ${esc(when)} — ${total} record(s).</p>
        ${rows || '<p class="muted">This backup is empty.</p>'}
        ${info.unknownTables.length ? `<p class="muted">Ignoring unrecognized data: ${esc(info.unknownTables.join(', '))}.</p>` : ''}
        <div class="form-actions" id="restore-actions">
          <button type="button" class="btn" id="btn-merge">Merge into current data</button>
          <button type="button" class="btn btn-danger" id="btn-replace">Replace all data</button>
        </div>
      </div>`;
    document.getElementById('btn-merge').addEventListener('click', () => renderConfirm('merge', info));
    document.getElementById('btn-replace').addEventListener('click', () => renderConfirm('replace', info));
  }

  function renderConfirm(mode, info) {
    const actions = document.getElementById('restore-actions');
    const text = mode === 'replace'
      ? 'This replaces ALL current data with the file’s contents. This can’t be undone.'
      : 'This merges the file’s records into your current data — anything with a matching id is overwritten.';
    actions.innerHTML = `
      <p class="danger-confirm-text" style="flex-basis:100%;">${esc(text)}</p>
      <button type="button" class="btn btn-danger" id="btn-restore-confirm">${mode === 'replace' ? 'Yes, replace everything' : 'Yes, merge'}</button>
      <button type="button" class="btn" id="btn-restore-cancel">Cancel</button>`;
    document.getElementById('btn-restore-cancel').addEventListener('click', () => renderPreview(info));
    document.getElementById('btn-restore-confirm').addEventListener('click', async () => {
      const confirmBtn = document.getElementById('btn-restore-confirm');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Working…';
      try {
        const result = await restoreBackup(pendingBackup, mode);
        const total = result.reduce((n, r) => n + r.count, 0);
        preview.innerHTML = `<p class="muted">Restore complete — ${total} record(s) loaded. Reloading…</p>`;
        setTimeout(() => location.reload(), 1000);
      } catch (err) {
        showError(err.message || String(err));
        renderPreview(info);
      }
    });
  }

  fileInput.addEventListener('change', async () => {
    clearError();
    preview.innerHTML = '';
    pendingBackup = null;
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      const obj = await readBackupFile(file);
      const info = inspectBackup(obj);
      pendingBackup = obj;
      renderPreview(info);
    } catch (err) {
      showError(err.message || String(err));
    }
  });
}

function wireDanger() {
  const start = document.getElementById('reset-start');
  if (!start) return;
  start.addEventListener('click', async () => {
    const controls = document.getElementById('reset-controls');
    let total = 0;
    try {
      const counts = await getResetCounts();
      total = Object.values(counts).reduce((a, b) => a + b, 0);
    } catch { /* fall back to a generic confirm below */ }
    const amount = total === 0 ? 'everything' : total === 1 ? '1 record' : `all ${total} records`;
    controls.innerHTML = `
      <p class="danger-confirm-text">
        This permanently erases ${esc(amount)} and can’t be undone. Are you sure?
      </p>
      <div class="form-actions">
        <button type="button" id="reset-cancel" class="btn">Keep my data</button>
        <button type="button" id="reset-confirm" class="btn btn-danger">Yes, erase everything</button>
      </div>`;
    document.getElementById('reset-cancel').addEventListener('click', render);
    document.getElementById('reset-confirm').addEventListener('click', async () => {
      const confirmBtn = document.getElementById('reset-confirm');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Erasing…';
      try {
        await resetApp();
        // Back to the exact first-run state — reload via the front door so the
        // sidebar, active pet, and first-run flows all rebuild from scratch.
        location.replace('../index.html');
      } catch (err) {
        showError(err.message || String(err));
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Yes, erase everything';
      }
    });
  });
}

render();
