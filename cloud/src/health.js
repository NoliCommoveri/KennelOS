// What /ops shows about the bindings and the data. Counts only, never rows.
import { migrationStatus } from './migrate.js';
import { mailMode } from './mail.js';
import { licenseConfig } from './license.js';

export const TABLES = ['users', 'login_codes', 'sessions', 'programs', 'snapshots', 'files', 'snapshot_files', 'notices', 'device_erasures',
  'vaults', 'vault_wraps', 'vault_pairings', 'vault_handoffs', 'pro_purchases', 'license_links', 'license_link_codes',
  'wl_projection', 'wl_tokens', 'wl_inbox', 'wl_events', 'wl_holds', 'wl_messages',
  'wl_family_codes', 'wl_family_sessions', 'wl_senders'];

export async function healthCheck(env) {
  const out = {
    d1: { bound: Boolean(env.DB), reachable: false, error: null },
    r2: { bound: Boolean(env.FILES), reachable: false, error: null },
    secrets: {
      OPS_TOKEN: Boolean(env.OPS_TOKEN),
      EMAIL_HMAC_KEY: Boolean(env.EMAIL_HMAC_KEY),
      LEMONSQUEEZY_WEBHOOK_SECRET: Boolean(env.LEMONSQUEEZY_WEBHOOK_SECRET),
    },
    license: (({ ready, storeId, productIds, testMode }) => ({ ready, storeSet: Boolean(storeId), products: productIds.size, testMode }))(licenseConfig(env)),
    mail: mailMode(env),
    schema_version: null,
    counts: {},
  };

  if (env.DB) {
    try {
      await env.DB.prepare('SELECT 1').first();
      out.d1.reachable = true;
      const applied = (await migrationStatus(env.DB)).filter((m) => m.state === 'applied');
      out.schema_version = applied.length ? applied[applied.length - 1].id : null;
      const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
      const present = new Set(results.map((r) => r.name));
      for (const t of TABLES) {
        out.counts[t] = present.has(t) ? (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first('n')) : null;
      }
    } catch (err) {
      out.d1.error = String(err?.message ?? err);
    }
  }

  if (env.FILES) {
    try {
      await env.FILES.list({ limit: 1 });
      out.r2.reachable = true;
    } catch (err) {
      out.r2.error = String(err?.message ?? err);
    }
  }

  return out;
}
