-- 0094: phone → desktop DL-scan relay queue.
-- A phone scan is INSERTed by POST /api/dl-records/scan-relay and picked
-- up by the same user's desktop via GET /api/dl-records/scan-relay/poll.
-- Rows are short-lived (superseded per-user on each push, aged out at 1h).

CREATE TABLE IF NOT EXISTS dl_scan_relay (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_dl_scan_relay_user ON dl_scan_relay(user_id, consumed_at);
