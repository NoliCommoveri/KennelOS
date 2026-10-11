// Embed mode for /apply and /list (docs/KennelOS_Integrations_Plan.md §1): the
// page shown inside the breeder's own website by /family/embed.js, as
// `?embed=1&frame=<id>`. It then:
//   - drops its own title and footer (her page has its own) and its background;
//   - takes her theme (`theme=light|dark|auto`, light unless she says otherwise,
//     so a light website doesn't get a dark form) and one accent color;
//   - tells the page around it how tall it is, so the frame grows with it;
//   - opens anything that leaves the form (her status page, the form from the
//     list) in a new tab, never inside her site.
// Only the height and "scroll to me" go to the page around it, nothing typed.
const params = new URLSearchParams(location.search);

export const EMBEDDED = params.get('embed') === '1';
const FRAME = /^[a-z0-9]{1,40}$/i.test(params.get('frame') || '') ? params.get('frame') : '';
const framed = EMBEDDED && window.parent !== window;

function tell(type, extra = {}) {
  // The height isn't a secret, and her site's address isn't known here: '*'.
  if (framed) window.parent.postMessage({ type, frame: FRAME, ...extra }, '*');
}

// Is this #rgb / #rrggbb color light (relative luminance above 0.4)?
function isLight(hex) {
  const h = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}

export function setupEmbed() {
  if (!EMBEDDED) return;
  const root = document.documentElement;
  root.classList.add('embedded');
  const theme = params.get('theme');
  root.classList.add(`theme-${theme === 'dark' || theme === 'auto' ? theme : 'light'}`);
  const accent = params.get('accent') || '';
  if (/^#[0-9a-f]{6}$/i.test(accent) || /^#[0-9a-f]{3}$/i.test(accent)) {
    root.style.setProperty('--accent', accent);
    // Text on her color: white on a dark one, near-black on a light one, whatever
    // the theme (the theme's own choice suits only the theme's own accent).
    root.style.setProperty('--on-accent', isLight(accent) ? '#111111' : '#ffffff');
  }
  if (!framed) return;
  let last = 0;
  const report = () => {
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    if (height === last) return;
    last = height;
    tell('kennelos:height', { height });
  };
  new ResizeObserver(report).observe(document.body);
  report();
}

// A new step (the code to confirm, a result): bring the frame's top into view on
// her page, the way the page itself scrolls to the top when it isn't framed.
export function toTop() {
  if (framed) tell('kennelos:top');
  else window.scrollTo(0, 0);
}

// A link that leaves this page opens in a new tab when framed.
export function outward(a) {
  if (!EMBEDDED || !a) return;
  a.target = '_blank';
  a.rel = 'noopener';
}
