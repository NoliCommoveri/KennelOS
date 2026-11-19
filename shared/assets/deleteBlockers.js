// deleteBlockers.js — a refused Delete, said in words she can see (review K1-7).
//
// A detail page disables Delete while other records still point at this one
// (referenceRegistry.js). A disabled button's tooltip can't be reached on a
// phone, so the reason goes on the page as text, right under the header's
// buttons: what still uses it, and what archiving gives her instead (the wording
// Accounts uses).
import { esc } from './ui.js';
import { blockerList } from '../data/repoBase.js';

export const ARCHIVE_INSTEAD = 'Archive it instead: it keeps its history and drops out of your lists.';

// "Delete is off: this dog is still in use (sire of another dog × 2). Archive it instead: …"
export function blockedDeleteText(blockers, { what = 'it', alt = ARCHIVE_INSTEAD } = {}) {
  if (!blockers?.length) return '';
  return `Delete is off: ${what} is still in use (${blockerList(blockers)}). ${alt}`;
}

// The note as HTML, for a page that builds its own markup (a list row).
export function blockedDeleteNoteHtml(blockers, opts) {
  const text = blockedDeleteText(blockers, opts);
  return text ? `<p class="delete-blocked-note" role="note">${esc(text)}</p>` : '';
}

// Put the note under the page header that holds `actionsEl` (the header's
// buttons), replacing an earlier one; with no blockers, take it away.
export function showDeleteBlockers(actionsEl, blockers, opts) {
  if (!actionsEl) return;
  const header = actionsEl.closest('.page-header') || actionsEl;
  const old = header.nextElementSibling;
  if (old?.classList?.contains('delete-blocked-note')) old.remove();
  const text = blockedDeleteText(blockers, opts);
  if (!text) return;
  const p = document.createElement('p');
  p.className = 'delete-blocked-note';
  p.setAttribute('role', 'note');
  p.textContent = text;
  header.after(p);
}
