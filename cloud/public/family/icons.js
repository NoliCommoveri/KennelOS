// icons.js — the small line icons by the family pages' section headings, and the
// paw used sparingly as an ornament. Drawn here (no icon font, no outside requests);
// each is a 24×24 stroke drawing in currentColor, so CSS sets its colour.
// sectionIcon(title) → the icon for a section by its heading, or '' for none.

const svg = (body, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

// A paw: four toes and a pad, filled.
export const PAW_BODY = '<g fill="currentColor" stroke="none"><ellipse cx="6.2" cy="10.2" rx="1.9" ry="2.4"/><ellipse cx="9.6" cy="6.4" rx="1.9" ry="2.5"/><ellipse cx="14.4" cy="6.4" rx="1.9" ry="2.5"/><ellipse cx="17.8" cy="10.2" rx="1.9" ry="2.4"/><path d="M12 11.2c-2.6 0-5.2 3.1-5.2 5.3 0 1.7 1.3 2.6 2.8 2.6 1 0 1.6-.5 2.4-.5s1.4.5 2.4.5c1.5 0 2.8-.9 2.8-2.6 0-2.2-2.6-5.3-5.2-5.3z"/></g>';
export const paw = (cls = 'ico') => svg(PAW_BODY, cls);

const ICONS = {
  paw: PAW_BODY,
  // a trophy-like ribbon: their place
  place: '<circle cx="12" cy="9" r="5"/><path d="M9 13.5 7.5 21l4.5-2.5 4.5 2.5L15 13.5"/>',
  star: '<path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  gift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5V20h14v-7.5M12 8.5V20M12 8.5c-1.5-3.5-5.5-4-5.5-1.5S10 8.5 12 8.5zm0 0c1.5-3.5 5.5-4 5.5-1.5S14 8.5 12 8.5z"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  truck: '<path d="M3 6.5h11v9.5H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  chat: '<path d="M4 5.5h16v10H9l-5 4z"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r=".9"/><circle cx="4.8" cy="12" r=".9"/><circle cx="4.8" cy="17.5" r=".9"/>',
  shield: '<path d="M12 3.5 19 6v6c0 4.5-3 7.4-7 8.5-4-1.1-7-4-7-8.5V6z"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  sparkle: '<path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M6.5 17.5 9 15M15 9l2.5-2.5"/>',
};

// Which icon goes with which heading, and the section's kind (its tint): `wait` for
// their place and turn, `pups` for puppies and litters, `soon` for what's coming,
// `extra` for extras and products, `money`, `home` for pickup and transport, and
// `note` for the rest.
const BY_TITLE = [
  [/^current position/i, 'place', 'wait'],
  [/^the wait is over/i, 'star', 'wait'],
  [/^featured pup/i, 'paw', 'pups'],
  [/^available puppies/i, 'paw', 'pups'],
  [/^coming up/i, 'calendar', 'soon'],
  [/^extras/i, 'gift', 'extra'],
  [/^recommended/i, 'heart', 'extra'],
  [/^your payments|application fee/i, 'card', 'money'],
  [/^pickup/i, 'home', 'home'],
  [/^getting your pup home/i, 'truck', 'home'],
  [/^your companion/i, 'phone', 'note'],
  [/^what you asked for|review your preferences/i, 'list', 'note'],
  [/^emails from/i, 'mail', 'note'],
  [/^send .* a message/i, 'chat', 'note'],
  [/polic/i, 'shield', 'note'],
  [/^alert|pause/i, 'bell', 'wait'],
  [/^backing out/i, 'shield', 'note'],
  [/^thank you for applying/i, 'sparkle', 'wait'],
];

// → { icon: '<svg…>', kind } for a heading (its text, tags removed), or null.
export function sectionIcon(title) {
  const text = String(title || '').replace(/<[^>]*>/g, '').trim();
  const hit = BY_TITLE.find(([re]) => re.test(text));
  if (!hit) return null;
  return { icon: `<span class="sec-ico">${svg(ICONS[hit[1]])}</span>`, kind: hit[2] };
}
