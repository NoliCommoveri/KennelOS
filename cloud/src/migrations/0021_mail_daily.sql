-- Emails sent through Resend, counted per UTC day (src/mail.js countMail), so /ops
-- can show yesterday's total and the average per day over the previous 30 days.
-- Additive only.
--
-- Counts only, all kinds together: no address, subject or body. `day` is UTC
-- YYYY-MM-DD; `first_at` is the first send counted in that row (daily counting
-- began when this migration did). One small row per day, kept like mail_counts.
-- Server state, not in the D1 export.
CREATE TABLE IF NOT EXISTS mail_daily (
  day       TEXT PRIMARY KEY,
  sent      INTEGER NOT NULL DEFAULT 0,
  failed    INTEGER NOT NULL DEFAULT 0,
  first_at  TEXT NOT NULL
);
