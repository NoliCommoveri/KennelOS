// The ordered migration list /ops applies (plan §6.6). Adding a migration means
// adding its .sql file beside this one AND a line here; the runner only knows
// what this list names.
//
// Rules, in short (the plan has the reasons):
// - pre-launch, 0001 may be edited on staging (it then reads as drifted);
// - from the first real sign-in on production, forward-only and additive, and an
//   applied file is never edited — its checksum is what drift is measured by;
// - no bare `;` worries: src/lib/sql.js understands strings, comments and
//   trigger bodies;
// - PRAGMA foreign_keys=OFF does nothing inside the runner's batch, so a table
//   something references is rebuilt by moving the child table out first;
// - keep LIKE/GLOB patterns under 50 characters (D1 caps them, unpublished).
import schema from './0001_schema.sql';
import backupApi from './0002_backup_api.sql';
import snapshotEdition from './0003_snapshot_edition.sql';
import deviceErase from './0004_device_erase.sql';
import vault from './0005_vault.sql';
import licenseLink from './0006_license_link.sql';
import waitlist from './0007_waitlist.sql';
import familyAccess from './0008_family_access.sql';
import applicationConfirm from './0009_application_confirm.sql';
import familyEmail from './0010_family_email.sql';
import vaultHandoff from './0011_vault_handoff.sql';
import emailChange from './0012_email_change.sql';

export const MIGRATIONS = [
  { id: '0001', name: 'schema', sql: schema },
  { id: '0002', name: 'backup_api', sql: backupApi },
  { id: '0003', name: 'snapshot_edition', sql: snapshotEdition },
  { id: '0004', name: 'device_erase', sql: deviceErase },
  { id: '0005', name: 'vault', sql: vault },
  { id: '0006', name: 'license_link', sql: licenseLink },
  { id: '0007', name: 'waitlist', sql: waitlist },
  { id: '0008', name: 'family_access', sql: familyAccess },
  { id: '0009', name: 'application_confirm', sql: applicationConfirm },
  { id: '0010', name: 'family_email', sql: familyEmail },
  { id: '0011', name: 'vault_handoff', sql: vaultHandoff },
  { id: '0012', name: 'email_change', sql: emailChange },
];
