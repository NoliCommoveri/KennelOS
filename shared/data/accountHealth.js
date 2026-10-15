// accountHealth.js — Kels's "Check account health", the data half (pure). Is her
// KennelOS program safe and working: this device, its backup, her Pro license,
// Sensitive records, and her connections. "Account" is her KennelOS account and
// this device, never the business Accounts page (decided).
//
// assets/accountHealthUI.js gathers the facts (each read can fail offline, and a
// failed one is null, so its checks are skipped, never guessed) and asks her about
// each finding in HEALTH_KINDS order, one at a time, with its fix. No reads or
// writes here.
//
// facts: {
//   update:   { waiting } | null          a new version is downloaded, not running yet
//   storage:  { persisted, usage, quota } | null   navigator.storage
//   cloud:    { available, backup } | null  backup = cloudBackup.getBackupStatus()
//   lastExportAt: ISO | null               the last JSON backup file (settings.getLastBackupDate)
//   license:  { gated, state, record } | null       license.evaluateLicense(), gated = Pro's gate on
//   devices:  [listDevices row] | null    signed in only
//   vault:    { offered, status, unsavedCode } | null   status = cloudVault.vaultStatus()
//   keys:     [{ account: { id, name }, vendor: 'stripe' | 'jotform', ok, message }]   ok null = couldn't ask
//   waitlists:[{ kennel: { id, kennel_name }, status }]  waitlistOnlineStatus, online kennels only
// }

export const DAY_MS = 86400000;
// No cloud backup: a JSON backup file older than this is a finding (decided).
export const EXPORT_MAX_DAYS = 14;
// Another device on the account unseen this long is "lost" (decided).
export const DEVICE_LOST_DAYS = 60;
// Browser storage this full is worth a word.
export const STORAGE_FULL_SHARE = 0.8;
// Cloud backup with changes waiting this long is behind (the Import/Export card's "Not backed up for n days").
export const BACKUP_BEHIND_DAYS = 1;

// The order she raises them in: things that put records at risk first.
export const HEALTH_KINDS = Object.freeze([
  'storage-persist', 'backup-paused', 'backup-off', 'backup-behind', 'export-old',
  'vault-locked', 'recovery-unsaved', 'license-grace', 'update',
  'device-lost', 'key-rejected', 'waitlist-signed-out', 'waitlist-error',
  'vault-off', 'passkey-none', 'storage-full'
]);

const ageDays = (iso, now) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? (now - t) / DAY_MS : Infinity;
};

// Cloud backup is on and doing its job, so a JSON file isn't needed.
export const cloudBacksUp = (cloud) => Boolean(cloud?.available && cloud.backup?.enabled && !cloud.backup.paused);

// → [{ kind, key, …details }] in HEALTH_KINDS order. `key` is unique per finding
// and carries what it was raised on, so "Don't ask me again" on one lost device
// doesn't silence another.
export function healthFindings(facts = {}, now = Date.now()) {
  const out = [];
  const add = (kind, extra = {}, keyBit = '') => out.push({ kind, key: keyBit ? `${kind}:${keyBit}` : kind, ...extra });
  const { update, storage, cloud, license, devices, vault, keys = [], waitlists = [] } = facts;

  if (update?.waiting) add('update');
  if (storage?.persisted === false) add('storage-persist');
  if (storage?.quota > 0 && storage.usage / storage.quota >= STORAGE_FULL_SHARE) add('storage-full', { usage: storage.usage, quota: storage.quota });

  const b = cloud?.available ? cloud.backup : null;
  if (b) {
    if (!b.enabled) {
      // Records that moved to Pro back up from there; nothing to fix here.
      if (b.movedToEdition !== 'pro') add('backup-off');
    } else if (b.paused) {
      add('backup-paused', { code: b.lastError?.code || null }, b.lastError?.code || '');
    } else if (!b.lastPushedAt || (b.dirty && ageDays(b.lastPushedAt, now) > BACKUP_BEHIND_DAYS)) {
      add('backup-behind', { lastPushedAt: b.lastPushedAt || null });
    }
  }
  if (!cloudBacksUp(cloud) && ageDays(facts.lastExportAt, now) > EXPORT_MAX_DAYS) {
    add('export-old', { lastExportAt: facts.lastExportAt || null });
  }

  if (license?.gated && license.state === 'grace') add('license-grace', { expiresAt: license.record?.expiresAt || null });

  for (const d of devices || []) {
    if (d.thisDevice || d.erase || d.status === 'signed-out-here') continue;
    if (ageDays(d.lastSeenAt, now) >= DEVICE_LOST_DAYS) add('device-lost', { device: d }, d.id);
  }

  const v = vault?.offered ? vault.status : null;
  if (v) {
    if (!v.enabled) add('vault-off');
    else {
      if (!v.unlocked) add('vault-locked');
      if (vault.unsavedCode || !v.recovery) add('recovery-unsaved', { unsavedCode: Boolean(vault.unsavedCode) });
      if (v.passkeySupported && !(v.passkeys || []).length) add('passkey-none');
    }
  }

  for (const k of keys) if (k.ok === false) add('key-rejected', { account: k.account, vendor: k.vendor, message: k.message || '' }, `${k.vendor}:${k.account.id}`);

  for (const w of waitlists) {
    if (!w.status?.online) continue;
    if (!w.status.signedIn) add('waitlist-signed-out', { kennel: w.kennel }, w.kennel.id);
    else if (w.status.lastError) add('waitlist-error', { kennel: w.kennel, error: w.status.lastError }, w.kennel.id);
  }

  const rank = (f) => HEALTH_KINDS.indexOf(f.kind);
  return out.sort((a, b2) => rank(a) - rank(b2));
}

// "12 MB", "1.4 GB".
export function bytesText(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

// What's fine, for her closing "All good": short plain-text lines, only for what
// was checked. `fmtDate(iso)` formats a date for her.
export function healthGoodLines(facts = {}, fmtDate = (iso) => String(iso).slice(0, 10)) {
  const lines = [];
  const { storage, cloud, license, vault } = facts;
  if (storage?.persisted) lines.push('This browser keeps your records safe from clean-ups.');
  if (storage?.usage != null) lines.push(`Your records use ${bytesText(storage.usage)} on this device.`);
  if (cloudBacksUp(cloud) && cloud.backup.lastPushedAt) lines.push(`Cloud backup is on, last backed up ${fmtDate(cloud.backup.lastPushedAt)}.`);
  else if (facts.lastExportAt) lines.push(`Your last backup file is from ${fmtDate(facts.lastExportAt)}.`);
  if (license?.gated && license.state === 'valid') {
    const r = license.record || {};
    lines.push(r.interval === 'lifetime' ? 'Your Pro license is lifetime.' : r.expiresAt ? `Your Pro license is active and renews ${fmtDate(r.expiresAt)}.` : 'Your Pro license is active.');
  }
  if (vault?.offered && vault.status?.enabled && vault.status.unlocked) lines.push('Sensitive records are backed up, encrypted.');
  const okKeys = (facts.keys || []).filter((k) => k.ok);
  if (okKeys.length) lines.push(`${okKeys.map((k) => k.account.name).join(', ')} ${okKeys.length === 1 ? 'is' : 'are'} connected and working.`);
  return lines;
}
