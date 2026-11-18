// theme.js — the family pages' palette (family.css html[data-theme]): Classic (the
// default, the KennelOS app's colours), Ivory or Blush, as this browser's family
// chose it on their status page. A per-browser convenience in localStorage: it
// may be missing or blocked, and the page reads fine in Classic then.
export const THEMES = ['classic', 'ivory', 'blush'];
const KEY = 'kos-family-theme';

export function savedTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES.includes(t) ? t : 'classic';
  } catch { return 'classic'; }
}

// Sets the page's palette (Classic: no attribute) and ticks its swatch.
export function applyTheme(theme) {
  const t = THEMES.includes(theme) ? theme : 'classic';
  if (t === 'classic') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  document.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themePick === t)));
}

// The swatches at the page's foot: a tap applies and remembers that palette.
export function wireThemePicker() {
  applyTheme(savedTheme());
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-theme-pick]');
    if (!b) return;
    applyTheme(b.dataset.themePick);
    try { localStorage.setItem(KEY, b.dataset.themePick); } catch { /* not kept: fine */ }
  });
}
