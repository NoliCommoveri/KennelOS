// cloudWaitlist.js — putting her waitlist online (Waitlist W2 Plan §5, §9).
//
// For each own kennel whose list she put online (waitlist_config.online), this
// device builds the allow-listed projection (data/waitlistProjection.js) and
// publishes it whenever it changes; a kennel she takes offline is unpublished.
// The server accepts writes only from the BACKING device (Phase 1 §3.4), so on
// any other device this records "not the backing device" and does nothing else.
//
// Every entry point checks isWaitlistOnlineOffered() (cloud available + the
// release switch) and the session first, so `cloudUrl: null` makes no request.
// Network only through cloudApi. Nothing here ever blocks a page: publishing runs
// in the background and records its own errors in the waitlist-online state.
import * as api from './cloudApi.js';
import { isWaitlistOnlineOffered } from './cloudConfig.js';
import { sessionToken } from './cloudAuth.js';
import {
  getCloudBackupState, getWaitlistOnlineState, updateWaitlistOnlineState, CLOUD_DATA_CHANGED_EVENT
} from '../settings.js';
import { editionFlags } from '../editionConfig.js';
import { kennelRepo } from '../kennelRepo.js';
import { waitlistEntryRepo, newStatusToken } from '../waitlistEntryRepo.js';
import { waitlistOfferRepo } from '../waitlistOfferRepo.js';
import { waitlistProgramRepo } from '../waitlistProgramRepo.js';
import { litterRepo } from '../litterRepo.js';
import { dogRepo } from '../dogRepo.js';
import { saleRepo } from '../saleRepo.js';
import { contactRepo } from '../contactRepo.js';
import { todayYMD } from '../dateUtils.js';
import { waitlistConfig } from '../waitlistRules.js';
import { buildProjection } from '../waitlistProjection.js';

export const WAITLIST_ONLINE_EVENT = 'kennelos:waitlistonline';
// After a change, wait this long for more before publishing (one publish per burst).
export const PUBLISH_DELAY_MS = 20 * 1000;
const LOCK_NAME = 'kennelos-waitlist-publish';

// Why publishing isn't happening, for the settings card. null = fine.
//   'signed-out' | 'backup-off' | 'not-backing' | 'pro-required' | 'kennel-taken' | 'offline' | 'failed'
function errorCode(err) {
  if (err instanceof api.CloudOfflineError) return 'offline';
  if (err instanceof api.CloudAuthError) return 'signed-out';
  if (err?.code === 'not_backing_device') return 'not-backing';
  if (err?.code === 'pro_required') return 'pro-required';
  if (err?.code === 'kennel_taken') return 'kennel-taken';
  return 'failed';
}

export function isOnline(kennel) {
  return Boolean(kennel && kennel.is_own_kennel && !kennel.is_archived && kennel.public_id && waitlistConfig(kennel).online);
}

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Every family on an online list gets its status-page link token, once (W2 Plan
// §4). Written through the repo like any edit, so it rides backup.
export async function ensureStatusTokens(kennel) {
  let minted = 0;
  for (const e of await waitlistEntryRepo.getByKennel(kennel.id)) {
    if (e.status_token) continue;
    await waitlistEntryRepo.update(e.id, { status_token: newStatusToken() });
    minted++;
  }
  return minted;
}

// "New link": the old link stops working at the next publish (now).
export async function replaceStatusToken(entryId) {
  const entry = await waitlistEntryRepo.update(entryId, { status_token: newStatusToken() });
  await syncWaitlistOnline().catch(() => {});
  return entry;
}

// The projection for one kennel, from the database.
export async function projectionFor(kennel, { today = todayYMD() } = {}) {
  const [entries, offers, programsById, litters, dogs, sales, contacts] = await Promise.all([
    waitlistEntryRepo.getByKennel(kennel.id),
    waitlistOfferRepo.getByKennel(kennel.id),
    waitlistProgramRepo.getMapForKennel(kennel.id),
    litterRepo.getAll(),
    dogRepo.getAll({ includeArchived: true }),
    saleRepo.getAll({ includeArchived: true }),
    contactRepo.getAll({ includeArchived: true })
  ]);
  return buildProjection({ kennel, entries, offers, programsById, litters, dogs, sales, contacts, today });
}

let chain = Promise.resolve();
function exclusive(fn) {
  const locks = globalThis.navigator?.locks;
  const run = () => (locks ? locks.request(LOCK_NAME, fn) : fn());
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

// Publish every online kennel whose projection changed, and unpublish every
// kennel taken offline. `force` republishes unchanged ones too. → { status:
// 'skipped' | 'ok' | 'error', reason?, published: [kennelId], unpublished: [kennelId] }
export function syncWaitlistOnline({ force = false } = {}) {
  return exclusive(async () => {
    const result = await syncNow({ force });
    if (result.status !== 'skipped' || result.reason !== 'unavailable') {
      try { globalThis.dispatchEvent?.(new CustomEvent(WAITLIST_ONLINE_EVENT, { detail: result })); } catch { /* no window */ }
    }
    return result;
  });
}

async function syncNow({ force }) {
  if (!isWaitlistOnlineOffered() || !editionFlags.waitlist) return { status: 'skipped', reason: 'unavailable' };
  const kennels = (await kennelRepo.getAll({ includeArchived: true })).filter((k) => k.is_own_kennel);
  const state = getWaitlistOnlineState();
  const wanted = kennels.filter(isOnline);
  const stale = Object.entries(state.kennels).filter(([id, s]) => {
    const k = kennels.find((x) => x.id === id);
    return !k || !isOnline(k) || k.public_id !== s.publicId;
  });
  if (!wanted.length && !stale.length) {
    if (state.lastError) updateWaitlistOnlineState({ lastError: null });
    return { status: 'skipped', reason: 'nothing-online' };
  }

  const token = sessionToken();
  const stop = (reason) => {
    updateWaitlistOnlineState({ lastError: { code: reason, at: new Date().toISOString() } });
    return { status: 'skipped', reason };
  };
  if (!token) return stop('signed-out');
  if (!getCloudBackupState().enabled) return stop('backup-off');

  const published = [];
  const unpublished = [];
  updateWaitlistOnlineState({ lastAttemptAt: new Date().toISOString() });
  try {
    for (const [kennelId, s] of stale) {
      await api.unpublishWaitlist(token, s.publicId);
      const kennelsState = { ...getWaitlistOnlineState().kennels };
      delete kennelsState[kennelId];
      updateWaitlistOnlineState({ kennels: kennelsState });
      unpublished.push(kennelId);
    }
    for (const kennel of wanted) {
      await ensureStatusTokens(kennel);
      const projection = await projectionFor(kennel);
      const hash = await sha256(JSON.stringify(projection));
      const prev = getWaitlistOnlineState().kennels[kennel.id];
      if (!force && prev && prev.hash === hash && prev.publicId === kennel.public_id) continue;
      const res = await api.publishWaitlist(token, kennel.public_id, projection);
      updateWaitlistOnlineState({
        kennels: { ...getWaitlistOnlineState().kennels, [kennel.id]: { publicId: kennel.public_id, hash, version: res.version, publishedAt: res.publishedAt } }
      });
      published.push(kennel.id);
    }
  } catch (err) {
    const code = errorCode(err);
    updateWaitlistOnlineState({ lastError: { code, at: new Date().toISOString() } });
    return { status: 'error', reason: code, published, unpublished };
  }
  updateWaitlistOnlineState({ lastError: null });
  return { status: 'ok', published, unpublished };
}

// What the settings card shows for one kennel.
export function waitlistOnlineStatus(kennel) {
  const state = getWaitlistOnlineState();
  return {
    offered: isWaitlistOnlineOffered() && editionFlags.waitlist,
    online: isOnline(kennel),
    published: state.kennels[kennel.id] || null,
    lastError: state.lastError,
    signedIn: Boolean(sessionToken()),
    backupOn: getCloudBackupState().enabled
  };
}

// Started once per page (cloudBackupUI.bootCloud). Publishes shortly after
// load (catching changes made while signed out or offline: the hash decides),
// then PUBLISH_DELAY_MS after the last data change, and when back online.
export function startWaitlistScheduler({ win = globalThis } = {}) {
  if (!isWaitlistOnlineOffered() || !editionFlags.waitlist) return () => {};
  let timer = null;
  const run = () => { timer = null; syncWaitlistOnline().catch(() => {}); };
  const schedule = (delay = PUBLISH_DELAY_MS) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay);
  };
  const onChange = () => schedule();
  const onOnline = () => schedule(1000);
  win.addEventListener?.(CLOUD_DATA_CHANGED_EVENT, onChange);
  win.addEventListener?.('online', onOnline);
  schedule(2000);
  return () => {
    if (timer) clearTimeout(timer);
    win.removeEventListener?.(CLOUD_DATA_CHANGED_EVENT, onChange);
    win.removeEventListener?.('online', onOnline);
  };
}
