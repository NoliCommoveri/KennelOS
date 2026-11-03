// Which pages may call this API (plan §6.4). The editions are served from
// GitHub Pages on their own subdomains, so every call is cross-origin and this
// list is the whole of who is allowed to make one.
//
// Only the editions that carry a cloudUrl belong here: Lite and Pro. Demo has
// cloudUrl: null, and the apex (kennelos.app) is the marketing site. The domains
// are the ones .github/workflows/deploy.yml publishes to; tests/cors.test.js
// reads that file and fails if the two drift apart.
export const EDITION_ORIGINS = [
  'https://lite.kennelos.app',
  'https://pro.kennelos.app',
];

// Local development: `python3 -m http.server` / `npx serve` on any port.
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  return EDITION_ORIGINS.includes(origin) || DEV_ORIGIN.test(origin);
}

// Headers for a response to an allowed origin, or none. Authentication is a
// bearer token in Authorization, never a cookie, so credentials stay off.
export function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  if (!isAllowedOrigin(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    vary: 'Origin',
  };
}

// The answer to a preflight (OPTIONS). A disallowed origin gets a bare 403 with
// no CORS headers, which the browser reports as a blocked request.
export function preflight(request) {
  const headers = corsHeaders(request);
  if (!headers['access-control-allow-origin']) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      ...headers,
      'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '86400',
    },
  });
}

// Her KennelPort website (KennelPort plan 3.8): its waitlist page draws her
// application form and sends what a family types straight to these three family
// endpoints, so they answer its requests too. Same-origin elsewhere: the list,
// status and form JSON stay KennelOS's own. They take no cookie and no session,
// so CORS lets a site do only what any program could already do; Turnstile and
// the per-address and per-email limits are the real guard.
export const WEBSITE_PATHS = /^\/f\/(apply\/[^/]+|verify|code)$/;
// A KennelPort site: one label under kennelport.com, https only. Staging's
// KennelPort runs on workers.dev. A breeder's own domain (KennelPort plan 2.4) is
// added by hand to WEBSITE_ORIGINS in wrangler.toml, comma-separated, the same way
// KennelPort's own custom domains are: "https://www.akbostonterriers.com, …".
const KENNELPORT_SITE = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kennelport\.com$/;
export const KENNELPORT_STAGING = 'https://kennelport-staging.kennelport.workers.dev';

export const customWebsiteOrigins = (env) => String(env?.WEBSITE_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean);

export function isWebsiteOrigin(origin, env) {
  if (!origin) return false;
  return KENNELPORT_SITE.test(origin) || origin === KENNELPORT_STAGING || DEV_ORIGIN.test(origin)
    || customWebsiteOrigins(env).includes(origin.toLowerCase());
}

export function websiteCors(request, env) {
  const origin = request.headers.get('Origin');
  if (!isWebsiteOrigin(origin, env)) return {};
  return { 'access-control-allow-origin': origin, vary: 'Origin' };
}

export function websitePreflight(request, env) {
  const headers = websiteCors(request, env);
  if (!headers['access-control-allow-origin']) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: { ...headers, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' },
  });
}
