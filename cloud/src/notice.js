// Service notices (plan §2.1, §6.1; Proposal §2a): the in-app channel for
// anything the operator must tell every user, including a shutdown. Public and
// cacheable. Set and removed on /ops.
export const LEVELS = ['info', 'warning', 'shutdown'];

export async function activeNotices(env, now = new Date()) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT id, level, message, until FROM notices WHERE until IS NULL OR until > ? ORDER BY created_at DESC',
    ).bind(now.toISOString()).all();
    return results;
  } catch {
    // Before 0002 is applied there is no table; no notices is the honest answer.
    return [];
  }
}

export async function addNotice(env, { level, message, until }) {
  if (!LEVELS.includes(level)) throw new Error(`Level must be one of ${LEVELS.join(', ')}.`);
  const text = String(message ?? '').trim();
  if (!text) throw new Error('A message is required.');
  let untilIso = null;
  if (until) {
    const t = Date.parse(until);
    if (Number.isNaN(t)) throw new Error('That end date did not parse.');
    untilIso = new Date(t).toISOString();
  }
  await env.DB.prepare('INSERT INTO notices (id, level, message, until, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), level, text.slice(0, 1000), untilIso, new Date().toISOString()).run();
}

export async function removeNotice(env, id) {
  await env.DB.prepare('DELETE FROM notices WHERE id = ?').bind(String(id)).run();
}
