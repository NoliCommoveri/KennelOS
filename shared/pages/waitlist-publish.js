// waitlist-publish.js — publishing one kennel's waitlist (Waitlist Spec §15.3; W2
// Plan §9; End-State guide §29), reached from the Waitlist page's Manage menu.
// Two ways, one page: the Online list (the waitlist online, only where it's
// offered: its card is waitlistOnlineUI.js, which used to live on the Kennel page)
// and, under it, the list as text to copy (allow-listed fields only, paused
// families and families between turns left out). Pro-only page (proPages.js).
import { waitlistEntryRepo } from '../data/waitlistEntryRepo.js';
import { waitlistOfferRepo } from '../data/waitlistOfferRepo.js';
import { waitlistProgramRepo } from '../data/waitlistProgramRepo.js';
import { contactRepo } from '../data/contactRepo.js';
import { litterRepo } from '../data/litterRepo.js';
import { dogRepo } from '../data/dogRepo.js';
import { saleRepo } from '../data/saleRepo.js';
import { kennelRepo } from '../data/kennelRepo.js';
import { waitlistConfig, entryName, publicList, publicListText, placeHidden } from '../data/waitlistRules.js';
import { editionFlags } from '../data/editionConfig.js';
import { isWaitlistOnlineOffered } from '../data/cloud/cloudConfig.js';
import { esc, fmtDate, param, todayYMD } from '../assets/ui.js';
import { resolveWaitlistKennel, mountKennelPicker } from '../assets/waitlistUI.js';

const els = {
  title: document.getElementById('pub-title'),
  back: document.getElementById('back-link'),
  picker: document.getElementById('pub-kennel-picker'),
  online: document.getElementById('pub-online'),
  text: document.getElementById('pub-text'),
  error: document.getElementById('page-error')
};
const showError = (msg) => { els.error.innerHTML = `<div class="inline-error">${esc(msg)}</div>`; };

// The waitlist online: only where it's offered (Pro, cloud available, its release
// switch or staging); its UI is imported only then.
function mountOnline(kennel) {
  if (!editionFlags.waitlist || !isWaitlistOnlineOffered()) return;
  els.online.hidden = false;
  import('../assets/waitlistOnlineUI.js')
    .then((m) => m.mountWaitlistOnline(els.online, kennel, {
      onSaved: async () => { mountOnline(await kennelRepo.getById(kennel.id)); await renderText(kennel); }
    }))
    .catch((err) => { els.online.innerHTML = `<p class="field-hint">The online list couldn't load: ${esc(err.message || String(err))}</p>`; });
}

// The public list as text (Spec §15.3), the same families and fields as online.
async function renderText(kennel) {
  const [entries, offers, programs, contacts, litters, dogs, sales] = await Promise.all([
    waitlistEntryRepo.getByKennel(kennel.id),
    waitlistOfferRepo.getByKennel(kennel.id),
    waitlistProgramRepo.getMapForKennel(kennel.id),
    contactRepo.getAll({ includeArchived: true }),
    litterRepo.getAll(),
    dogRepo.getAll({ includeArchived: true }),
    saleRepo.getAll({ includeArchived: true })
  ]);
  const today = todayYMD();
  const contactsById = new Map(contacts.map((c) => [c.id, c]));
  const rows = publicList(entries, kennel.id, programs, {
    today, config: waitlistConfig(kennel), nameOf: (e) => entryName(e, contactsById.get(e.contact_id)),
    // Same as online: a family in their turn, or after passing until those litters close.
    hidden: (e) => Boolean(placeHidden(e, offers, litters, dogs, sales))
  });
  const text = publicListText(rows, { kennelName: kennel.kennel_name, today, fmtDate });
  els.text.innerHTML = `
    <h2 style="margin-top:0;">Copy the list as text</h2>
    <p class="field-hint">Paste this on Facebook or your website. It shows first names with a last initial, sex preference and the date each family was added. Contact details and programs are left out, and so are paused families and families between turns (holding a turn, or after passing until that litter closes). It's a snapshot: copy it again after the list changes.</p>
    <textarea id="pub-text-body" readonly style="width:100%;min-height:220px;font-family:inherit;">${esc(text)}</textarea>
    <div class="form-actions"><button class="btn btn-primary btn-sm" id="pub-copy">Copy</button><span class="field-hint" id="pub-copied"></span></div>`;
  els.text.querySelector('#pub-copy').addEventListener('click', async () => {
    const ta = els.text.querySelector('#pub-text-body');
    const note = els.text.querySelector('#pub-copied');
    try {
      await navigator.clipboard.writeText(text);
      note.textContent = 'Copied.';
    } catch {
      ta.select();
      note.textContent = document.execCommand('copy') ? 'Copied.' : 'Copying isn\'t allowed here. Select the text and copy it yourself.';
    }
  });
}

async function main() {
  const { kennel, own } = await resolveWaitlistKennel(param('kennel'));
  if (!kennel) {
    els.text.innerHTML = '<div class="empty-state">Set up your kennel first — each of your kennels keeps its own waitlist.</div>';
    return;
  }
  mountKennelPicker(els.picker, { kennel, own });
  els.back.href = `waitlist.html?kennel=${encodeURIComponent(kennel.id)}`;
  if (own.length > 1) els.title.textContent = `Publish ${kennel.kennel_name}'s list`;
  mountOnline(kennel);
  await renderText(kennel);
}

main().catch((e) => showError(e.message || String(e)));
