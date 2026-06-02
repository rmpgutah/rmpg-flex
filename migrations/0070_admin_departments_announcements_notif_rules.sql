-- 0070 — Backing tables for three admin features that were UI-only shells
-- (write endpoints 404'd against the new Worker; verified live 2026-06-02).
-- Departments, Announcements (+ officer-facing reader), and the Alert Rules
-- engine all needed real storage. Idempotent CREATE TABLE IF NOT EXISTS so
-- re-apply on the dirty prod schema is a no-op.

-- ── Departments ──────────────────────────────────────────────
-- Org structure managed by AdminDepartmentsTab. Self-referential
-- parent_id for hierarchy; manager_id references users(id).
CREATE TABLE IF NOT EXISTS departments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  code        TEXT,
  description TEXT,
  parent_id   INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  manager_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_id);

-- ── Announcements ────────────────────────────────────────────
-- Broadcast messages. target_roles is a JSON array of role strings
-- ('[]' = everyone). starts_at/expires_at bound the active window;
-- the officer-facing reader (GET /announcements) filters on these.
CREATE TABLE IF NOT EXISTS announcements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  body            TEXT,
  type            TEXT NOT NULL DEFAULT 'info',
  priority        TEXT NOT NULL DEFAULT 'normal',
  target_roles    TEXT NOT NULL DEFAULT '[]',
  is_active       INTEGER NOT NULL DEFAULT 1,
  starts_at       TEXT,
  expires_at      TEXT,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active);

-- ── Notification rules (Alert Rules engine) ──────────────────
-- conditions / target_roles / target_user_ids are JSON strings.
-- trigger_event matches the dispatcher engine's emitted event keys
-- (call_created_p1, warrant_created, unit_panic, ...). is_active
-- gates evaluation.
CREATE TABLE IF NOT EXISTS notification_rules (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  description       TEXT,
  trigger_event     TEXT NOT NULL,
  conditions        TEXT NOT NULL DEFAULT '{}',
  target_roles      TEXT NOT NULL DEFAULT '[]',
  target_user_ids   TEXT NOT NULL DEFAULT '[]',
  notification_type TEXT NOT NULL DEFAULT 'in_app',
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name   TEXT,
  last_fired_at     TEXT,
  fire_count        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notif_rules_trigger ON notification_rules(trigger_event, is_active);
