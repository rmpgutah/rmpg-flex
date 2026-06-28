-- ============================================================
-- 0038_radio.sql
-- ============================================================
-- Radio console backing tables: channels, transmissions, recordings.
-- Mirrors the prep work in client/src/pages/radio/ (constants, helpers,
-- components) that was sitting unused without an entry point.
--
-- Three tables, no FKs across them at delete-time (transmissions
-- intentionally outlive their channel — a deleted channel must not
-- erase audit history):
--   radio_channels       — operator-visible channels (Dispatch Main,
--                          Tac-1, Site-B, etc). Soft-delete via
--                          archived_at so transmission joins keep
--                          working without ON DELETE CASCADE.
--   radio_transmissions  — append-only TX log. Source can be the
--                          live WebSocket (ws.ts) or a manual log
--                          entry from the console. duration_seconds
--                          + transcript power the LiveTab search.
--   radio_recordings     — user-saved/bookmarked transmissions.
--                          Many-to-one against transmissions
--                          (one tx, many user saves with their own
--                          notes/labels).
--
-- All idempotent (CREATE TABLE IF NOT EXISTS + CREATE INDEX
-- IF NOT EXISTS) so re-applying after the deploy pipeline's
-- continue-on-error path is safe.
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  frequency TEXT,
  talkgroup TEXT,
  color TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_radio_channels_active ON radio_channels(archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_radio_channels_sort ON radio_channels(sort_order, id);

-- Transmissions — append-only audit log. NOT cascaded on channel
-- delete: a tx must survive its channel for compliance review.
CREATE TABLE IF NOT EXISTS radio_transmissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER REFERENCES radio_channels(id),
  user_id INTEGER REFERENCES users(id),
  unit_label TEXT,
  transmitted_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  duration_seconds REAL NOT NULL DEFAULT 0,
  transcript TEXT,
  audio_url TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  call_id INTEGER REFERENCES calls_for_service(id)
);

CREATE INDEX IF NOT EXISTS idx_radio_tx_channel_time ON radio_transmissions(channel_id, transmitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_radio_tx_user_time ON radio_transmissions(user_id, transmitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_radio_tx_time ON radio_transmissions(transmitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_radio_tx_call ON radio_transmissions(call_id);

-- Per-user saved/bookmarked transmissions. Cascades on tx delete
-- so a purged tx removes orphaned bookmarks (recordings are
-- pointers, not the source of truth — the tx row IS the record).
CREATE TABLE IF NOT EXISTS radio_recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transmission_id INTEGER NOT NULL REFERENCES radio_transmissions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT,
  notes TEXT,
  color TEXT,
  bookmark_seconds REAL,
  loop_start_seconds REAL,
  loop_end_seconds REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_radio_rec_user ON radio_recordings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_radio_rec_tx ON radio_recordings(transmission_id);

-- Seed one default channel so a fresh deploy isn't an empty console.
INSERT INTO radio_channels (name, description, is_default, sort_order)
  SELECT 'Dispatch Main', 'Primary dispatch channel', 1, 0
   WHERE NOT EXISTS (SELECT 1 FROM radio_channels);
