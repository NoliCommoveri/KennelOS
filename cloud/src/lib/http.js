// Small HTTP helpers shared by the router, the API and /ops.

// A refusal the router turns into `{error: code, ...extra}` with this status.
export class ApiError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function fail(status, code, extra) {
  throw new ApiError(status, code, extra);
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

// A JSON object body, size-capped. Anything else is a 400 or a 413.
export async function readJson(request, maxBytes = 64 * 1024) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) fail(413, 'too_large');
  const text = await request.text();
  if (text.length > maxBytes) fail(413, 'too_large');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(400, 'bad_json');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'bad_json');
  return value;
}

// The declared body length of an upload. Required: R2 needs a known length to
// stream a body, and the caps are checked before a byte is read.
export function contentLength(request, max) {
  const raw = request.headers.get('content-length');
  const len = Number(raw);
  if (raw === null || !Number.isInteger(len) || len <= 0) fail(411, 'length_required');
  if (len > max) fail(413, 'too_large');
  return len;
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}
