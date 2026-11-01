-- Emails sent through Resend, counted per month and kind (src/mail.js countMail),
-- so /ops can show month to date. Additive only.
--
-- Counts only: no address, subject or body. `month` is UTC YYYY-MM; `kind` is
-- code | notice | digest | family | test. `first_at` is the first send counted
-- in that row (the counting began when this migration did). Server state, not in
-- the D1 export.
CREATE TABLE IF NOT EXISTS mail_counts (
  month     TEXT NOT NULL,
  kind      TEXT NOT NULL,
  sent      INTEGER NOT NULL DEFAULT 0,
  failed    INTEGER NOT NULL DEFAULT 0,
  first_at  TEXT NOT NULL,
  PRIMARY KEY (month, kind)
);
