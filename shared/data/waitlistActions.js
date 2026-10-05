// waitlistActions.js — the waitlist's multi-step writes (Waitlist Spec §5–§6;
// End-State guide §29): approve, decline, fee received, withdraw, remove, the
// second-pass undo, re-apply, and the manual position override. Pages call these
// rather than stitching repo writes together, so W1c's offer flow reuses the same
// steps. Every decision comes from waitlistRules.js; this module only writes.
//
// W1 sends nothing: no emails, no status page. She messages families herself.
import { kennelRepo } from './kennelRepo.js';
import { contactRepo } from './contactRepo.js';
import { waitlistEntryRepo } from './waitlistEntryRepo.js';
import { waitlistOfferRepo } from './waitlistOfferRepo.js';
import { waitlistProgramRepo } from './waitlistProgramRepo.js';
import { todayYMD } from './dateUtils.js';
import {
  waitlistConfig, feeForEntry, feeDueDate, anchorDate, canUndoRemoval, passToForgive
} from './waitlistRules.js';

async function load(entryId) {
  const entry = await waitlistEntryRepo.getById(entryId);
  if (!entry) throw new Error('That waitlist entry no longer exists.');
  return entry;
}

function requireStatus(entry, allowed, verb) {
  if (!allowed.includes(entry.status)) throw new Error(`Can't ${verb} a family whose status is "${entry.status}".`);
}

// The context approval needs: the kennel's config and the entry's program.
async function feeContext(entry, programId) {
  const [kennel, program] = await Promise.all([
    kennelRepo.getById(entry.kennel_id),
    programId ? waitlistProgramRepo.getById(programId) : null
  ]);
  return { config: waitlistConfig(kennel), program };
}

// A new Contact from the application answers (Spec §5.2 "creates or links").
function contactFromApplication(app = {}) {
  return {
    name: String(app.name || '').trim(),
    email: String(app.email || '').trim(),
    phone: String(app.phone || '').trim(),
    address: String(app.location || '').trim(),
    contact_type: ['buyer'],
    first_contact_source: String(app.heard_from || '').trim()
  };
}

// Approve an application. `contactId` links an existing contact (a match she
// picked); otherwise a new contact is created from the answers. A fee-waived
// program skips straight onto the list, anchored at the approval date (§5.3).
export async function approve(entryId, { date = todayYMD(), contactId = null, programId } = {}) {
  const entry = await load(entryId);
  requireStatus(entry, ['applied'], 'approve');
  const program_id = programId === undefined ? (entry.waitlist_program_id || null) : (programId || null);
  const { config, program } = await feeContext(entry, program_id);

  let contact_id = contactId || entry.contact_id || null;
  if (!contact_id) contact_id = (await contactRepo.create(contactFromApplication(entry.application))).id;

  const fee = feeForEntry(config, program);
  const changes = {
    contact_id,
    waitlist_program_id: program_id,
    approved_date: date,
    fee_amount: fee,
    fee_credit_policy: config.fee_credit_policy,
    fee_due_date: fee === 0 ? null : feeDueDate(date, config),
    status: 'approved'
  };
  if (fee === 0) {
    Object.assign(changes, { status: 'active', fee_received_date: date, fee_payment_method: 'Waived' });
  }
  return waitlistEntryRepo.update(entryId, changes);
}

export async function decline(entryId, { date = todayYMD() } = {}) {
  const entry = await load(entryId);
  requireStatus(entry, ['applied'], 'decline');
  return waitlistEntryRepo.update(entryId, { status: 'declined', declined_date: date });
}

// Fee received — this fixes the family's place in line (fee_received_date is the
// position anchor, §6.1). Also used with a null fee ("Add to the list").
export async function feeReceived(entryId, { date = todayYMD(), amount, method = '', reference = '' } = {}) {
  const entry = await load(entryId);
  requireStatus(entry, ['approved'], 'mark the fee received for');
  const changes = {
    status: 'active',
    fee_received_date: date,
    fee_payment_method: method,
    fee_payment_reference: reference
  };
  if (amount !== undefined) changes.fee_amount = amount === '' || amount == null ? null : Number(amount);
  return waitlistEntryRepo.update(entryId, changes);
}

export async function markFeeExpired(entryId) {
  const entry = await load(entryId);
  requireStatus(entry, ['approved'], 'expire');
  return waitlistEntryRepo.update(entryId, { status: 'expired' });
}

// The family left the list themselves (they told her).
export async function withdraw(entryId, { date = todayYMD() } = {}) {
  const entry = await load(entryId);
  requireStatus(entry, ['applied', 'approved', 'active'], 'withdraw');
  return waitlistEntryRepo.update(entryId, { status: 'withdrawn', withdrawn_date: date });
}

// She removes a family from the list. Final: coming back means re-applying.
export async function removeByBreeder(entryId, { date = todayYMD() } = {}) {
  const entry = await load(entryId);
  requireStatus(entry, ['active'], 'remove');
  return waitlistEntryRepo.update(entryId, { status: 'removed', removed_date: date, removed_reason: 'by_breeder' });
}

// The 7-day undo on a second-pass removal (§6.4). Forgives the triggering pass so
// the family isn't removed again at once; their anchor is untouched, so they're
// back at their old place.
export async function undoRemoval(entryId, { today = todayYMD() } = {}) {
  const entry = await load(entryId);
  if (!canUndoRemoval(entry, today)) throw new Error('This removal can no longer be undone.');
  const offers = await waitlistOfferRepo.getByEntry(entryId);
  const forgive = passToForgive(entry, offers);
  if (forgive) {
    const note = `Pass forgiven by you on ${today} (removal undone).`;
    await waitlistOfferRepo.update(forgive.id, {
      counts_as_pass: false,
      notes: forgive.notes ? `${forgive.notes}\n${note}` : note
    });
  }
  return waitlistEntryRepo.update(entryId, { status: 'active', removed_date: null, removed_reason: null });
}

// A closed run (placed, removed, withdrawn, declined, expired) → a NEW application
// for the same family on the same kennel's list. New fee, new place (§6.4).
export async function reapply(entryId, { date = todayYMD() } = {}) {
  const entry = await load(entryId);
  if (['applied', 'approved', 'active'].includes(entry.status)) {
    throw new Error('This family is still on the list.');
  }
  return waitlistEntryRepo.create({
    kennel_id: entry.kennel_id,
    contact_id: entry.contact_id || null,
    status: 'applied',
    applied_date: date,
    waitlist_program_id: entry.waitlist_program_id || null,
    application: { ...(entry.application || {}) },
    pref_sex: entry.pref_sex || 'any',
    pref_breed: entry.pref_breed || '',
    pref_placement_type: entry.pref_placement_type || '',
    pref_colors: [...(entry.pref_colors || [])]
  });
}

// Manual position override (§6.1): a date that replaces the fee date for ordering
// only. Pass `null` to clear it. `afterEntryId` takes another family's anchor
// instead ("right after the Smiths") — date-only, so the family lands among that
// family's same-day peers (Spec §14 known limit).
export async function setPositionAnchor(entryId, { date = null, afterEntryId = null } = {}) {
  let anchor = date || null;
  if (afterEntryId) {
    const other = await load(afterEntryId);
    anchor = anchorDate(other) || null;
  }
  return waitlistEntryRepo.update(entryId, { position_anchor_date: anchor });
}
