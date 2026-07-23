// ui.js — tiny, dependency-free view helpers shared by Furever's pages. Pages do
// hand-built innerHTML, so every user-supplied value must pass through esc()
// (same escaping rule as the breeder core, CLAUDE.md §Escaping).

// HTML-escape a value for safe interpolation into innerHTML. Non-strings become
// '' so a null/undefined field can't print "null".
export function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A colored badge from a vocab entry. `vocab` is one of the arrays in vocab.js;
// `value` is the stored code. Falls back to a neutral badge for unknown codes so
// the UI never crashes on legacy data.
export function badge(vocab, value) {
  const hit = vocab.find((v) => v.value === value);
  const cls = hit ? hit.badge : 'badge-neutral';
  const label = hit ? hit.label : (value || '—');
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

// Show a user-facing error in a page's <div class="error-box"> (repos throw
// friendly Error messages; we surface the message, never a stack). Returns false
// so callers can `return showError(...)` from a failed submit handler.
export function showError(message, hostId = 'page-error') {
  const host = document.getElementById(hostId);
  if (host) {
    host.className = 'error-box';
    host.textContent = message;
  }
  return false;
}

export function clearError(hostId = 'page-error') {
  const host = document.getElementById(hostId);
  if (host) host.textContent = '';
}

// Friendly relative wording for a YYYY-MM-DD due date vs today's YMD. Used by the
// schedule views so "due in 3 days" / "5 days overdue" read naturally.
export function relativeDue(days) {
  if (days == null) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days overdue`;
}

// Age in whole months/years from a YYYY-MM-DD DOB to today, for a pet header.
export function ageLabel(dobYMD, todayYMD) {
  if (!dobYMD) return '';
  const [by, bm, bd] = dobYMD.split('-').map(Number);
  const [ty, tm, td] = todayYMD.split('-').map(Number);
  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months -= 1;
  if (months < 0) return '';
  if (months < 24) return `${months} mo`;
  const years = Math.floor(months / 12);
  return `${years} yr`;
}
