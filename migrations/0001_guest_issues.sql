-- Milestone E: guest issue submissions (D1).
-- Emails are private: they live ONLY in this table. Never copy them into
-- responses, GitHub issues, or logs.
CREATE TABLE IF NOT EXISTS guest_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('bug', 'feature', 'question', 'other')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected')),
  issue_number INTEGER,
  ip_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guest_issues_state ON guest_issues (state);
CREATE INDEX IF NOT EXISTS idx_guest_issues_ip_hash ON guest_issues (ip_hash, created_at);
