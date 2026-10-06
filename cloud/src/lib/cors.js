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
