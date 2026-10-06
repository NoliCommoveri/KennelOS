// Sign-in rate limits (plan §6.1): per email hash and per caller IP, counted in
// UTC-hour windows. The IP is HMAC'd before it is stored, like the email.
import { hmacHex } from './lib/crypto.js';
import { fail } from './lib/http.js';

export const LIMITS = { email: 5, ip: 30 };

const hourWindow = (now) => `${now.toISOString().slice(0, 13)}:00:00Z`;

async function bump(env, bucket, window) {
  return env.DB.prepare(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET count = count + 1
     RETURNING count`,
  ).bind(bucket, window).first('count');
}

// Counts this attempt and refuses with 429 once either bucket is over its limit.
// The limit applies to any address, so a 429 says nothing about whether an
// account exists.
export async function limitSignIn(env, request, emailHash, now = new Date()) {
  const window = hourWindow(now);
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const ipBucket = `ip:${await hmacHex(env.EMAIL_HMAC_KEY, `ip:${ip}`)}`;
  const [byEmail, byIp] = [await bump(env, `email:${emailHash}`, window), await bump(env, ipBucket, window)];
  if (byEmail > LIMITS.email || byIp > LIMITS.ip) fail(429, 'rate_limited', { retryAfterSeconds: 3600 });
}
