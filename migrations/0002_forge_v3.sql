-- V3: Forge administration, featured repositories, and audit logging (D1).
--
-- Apply with:
--   npx wrangler d1 migrations apply ankworks_forge --remote
--
-- These tables hold ONLY Forge's own configuration. No GitHub token, session
-- cookie, access token, or guest email is ever written here. The audit log
-- stores the actor's GitHub id and login, the action, the target, and the
-- outcome — never a secret, and never a private request header.

-- Explicitly authorized Forge administrators.
-- Membership in the AnkWorks organization is verified separately at request
-- time; a row here only marks the account as an authorized Forge admin.
CREATE TABLE IF NOT EXISTS forge_admins (
  github_id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  added_by INTEGER
);

-- Featured (pinned) repositories on the organization dashboard.
-- `repo` is the repository NAME only (validated against GitHub's naming rules).
-- `position` controls ordering; lower comes first.
CREATE TABLE IF NOT EXISTS featured_repos (
  repo TEXT PRIMARY KEY,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  added_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_featured_repos_position ON featured_repos (position, repo);

-- Promotional banners configured by Forge admins.
CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  destination_url TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  position TEXT NOT NULL CHECK (position IN ('home-top', 'home-inline', 'repo-header', 'sidebar', 'footer')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_banners_enabled ON banners (enabled, start_at, end_at);

-- Announcements (maintenance, incidents, releases, platform updates).
-- Distinct from banners: announcements are operational notices, never paid.
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warning', 'critical')),
  priority INTEGER NOT NULL DEFAULT 0,
  start_at TEXT NOT NULL,
  end_at TEXT,
  dismissible INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members', 'admins')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_announcements_enabled ON announcements (enabled, priority DESC, start_at);

-- Clearly labeled sponsored placements. Never rendered without a "Sponsored" label.
CREATE TABLE IF NOT EXISTS advertisements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  image_url TEXT,
  destination_url TEXT NOT NULL,
  placement TEXT NOT NULL DEFAULT 'sidebar' CHECK (placement IN ('home-top', 'sidebar', 'repo-sidebar', 'footer')),
  alt_text TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_advertisements_enabled ON advertisements (enabled, placement, start_at);

-- Audit trail for administrative actions. Never publicly readable.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_login TEXT,
  action TEXT NOT NULL,
  target TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'denied', 'error')),
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_id, created_at DESC);
