-- 0108: Case Management v2 — activity/audit log, investigative tasks, case-to-case links.
-- All additive, idempotent. New columns live in NEW tables (no ALTER on the
-- capped cases/persons/calls_for_service tables). After merge, ALSO apply
-- directly to live D1 785de7ae (see CLAUDE.md) and verify with pragma_table_info.

-- ── Phase 1: per-case activity / audit trail ──────────────────
CREATE TABLE IF NOT EXISTS case_activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL,
  action      TEXT NOT NULL,             -- machine key, e.g. 'case.created', 'status.changed', 'link.added'
  actor_id    INTEGER,
  actor_name  TEXT,                      -- denormalized for display without a users join
  detail      TEXT,                      -- JSON blob, action-specific
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_case_activity_case ON case_activity(case_id, created_at);

-- ── Phase 2: investigative tasks / leads ──────────────────────
CREATE TABLE IF NOT EXISTS case_tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       INTEGER NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'open',     -- open / in_progress / done / canceled
  priority      TEXT NOT NULL DEFAULT 'normal',   -- low / normal / high / urgent
  assignee_id   INTEGER,
  assignee_name TEXT,
  due_date      TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT,
  completed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_case_tasks_case     ON case_tasks(case_id);
CREATE INDEX IF NOT EXISTS idx_case_tasks_assignee ON case_tasks(assignee_id, status);

-- ── Phase 4: case-to-case links (series / related / parent-child) ──
CREATE TABLE IF NOT EXISTS case_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,
  related_case_id INTEGER NOT NULL,
  link_type       TEXT NOT NULL DEFAULT 'related',  -- related / series / parent / child
  created_by      INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (case_id, related_case_id)
);
CREATE INDEX IF NOT EXISTS idx_case_links_case    ON case_links(case_id);
CREATE INDEX IF NOT EXISTS idx_case_links_related ON case_links(related_case_id);
