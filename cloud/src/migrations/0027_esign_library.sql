-- The template library (docs/KennelOS_Integrations_Plan.md §2.3b). Additive only.
--
-- KennelOS support builds contract templates in one Firma workspace, the library:
-- the workspace of a KennelOS account support links in the manager app (its own
-- test account). The program it is lives in ops_config (esign_library_program).
-- Support offers each template to every breeder or to breeders it names; a breeder
-- it may reach adds a copy to her own workspace, with its prefilled fields pointed
-- at her workspace's custom fields.

-- A library template support offers. Not listed here = offered to no one.
-- all_breeders = 1: every breeder with e-signing may add it; else only those in
-- esign_library_access. name / description: what breeders see. signs: whether the
-- breeder signs it too, as its signer roles were placed ('none' | 'first' | 'last',
-- Integrations D32); her copy starts with it.
CREATE TABLE esign_library_templates (
  template_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  all_breeders INTEGER NOT NULL DEFAULT 0,
  signs TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A breeder support has named in the manager app, by program, with the name only
-- support sees. Never an email.
CREATE TABLE esign_library_breeders (
  program_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Which named breeders may add which template.
CREATE TABLE esign_library_access (
  template_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (template_id, program_id)
);
CREATE INDEX esign_library_access_program ON esign_library_access (program_id);

-- Each copy a breeder added. template_id is the copy in her workspace, filled in
-- once Firma answers. status: 'copying' (asked Firma), 'mapping' (copied, its
-- prefilled fields being pointed at her fields), 'ready'.
CREATE TABLE esign_library_copies (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  library_template_id TEXT NOT NULL,
  template_id TEXT UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX esign_library_copies_program ON esign_library_copies (program_id, library_template_id);
