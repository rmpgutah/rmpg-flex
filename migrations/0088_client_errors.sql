-- 0088_client_errors.sql
-- Client-side crash telemetry. ErrorBoundary has POSTed crash reports to
-- /api/admin/health/client-error since it shipped, but a proxy stub swallowed
-- them with a fake 200 — no report was ever stored (2026-06-10 audit). This
-- table backs the real handler in src/routes/admin.ts. Applied directly to
-- live 785de7ae on 2026-06-10; recorded here for local-dev parity. Idempotent.
CREATE TABLE IF NOT EXISTS client_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  message TEXT,
  stack TEXT,
  component_stack TEXT,
  url TEXT,
  client_timestamp TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_client_errors_created ON client_errors(created_at);
