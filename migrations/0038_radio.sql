-- ============================================================
-- migrations/0038_radio.sql — Radio subsystem schema
-- ============================================================
--
-- Backs the /api/radio/* routes in src/routes/radio.ts (PR #661).
--
-- Target DB: NEW-Worker (`8893480a-…`) because the new worker (rmpg-flex-api)
-- is the only handler for /api/radio/*. The legacy `rmpg-flex` Worker has no
-- radio routes — patching the live DB (`785de7ae-…`) would create tables
-- nothing reads. See [[project-live-d1-schema-patches]] for the rule.
--
-- IMPORTANT: this schema was deployed to 8893480a-… in a prior session
-- (memory entry dated 2026-05-27). This file is a faithful record of what
-- is live, not the speculative design I originally wrote — verified on
-- 2026-05-27 via pragma_table_info. CREATE TABLE IF NOT EXISTS makes this
-- safe to re-run.
--
-- Three tables:
--   1. radio_channels       — operator-visible channels; soft-delete via
--                             archived_at so audit history survives.
--                             Talkgroup + color + is_default support DMR
--                             and trunked radio layouts beyond plain MHz.
--   2. radio_transmissions  — append-only TX log; FK to channels intentionally
--                             NOT cascaded (a dispatcher archiving a channel
--                             must not erase transmissions — evidence /
--                             discovery requirement). Optional call_id links
--                             tx back to a CFS for incident reconstruction.
--   3. radio_recordings     — per-user bookmarks; cascades on tx delete.
--                             bookmark_seconds + loop_start_seconds +
--                             loop_end_seconds support audio scrubbing
--                             playback ("repeat the 12-15s segment").
--
-- DEFAULT timestamps use `datetime('now','localtime')` which on Cloudflare
-- Workers is UTC (no system local TZ). The /src/ handlers explicitly INSERT
-- `datetime('now', '-7 hours')` for MST year-round (matches the 2026-05-26
-- timezone cutover). The schema DEFAULT is only used when a handler omits
-- an explicit timestamp.
--
-- Total indexes: 2 channels + 5 transmissions + 2 recordings = 9.
-- ============================================================

CREATE TABLE IF NOT EXISTS radio_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  -- Free-form: "155.010" (analog MHz), "DMR Color 2 TG 4002" (trunked),
  -- "Channel 7" (label-only).
  frequency TEXT,
  -- Talkgroup ID for DMR / trunked systems.
  talkgroup TEXT,
  -- UI accent color (hex) for the channel chip in the picker.
  color TEXT,
  -- One channel marked as the default that auto-loads in RadioPage.
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- NULL = active. Setting this archives without deleting (tx history
  -- still references the row).
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by INTEGER REFERENCES users(id)
);

-- Active-channel listing (most common read).
CREATE INDEX IF NOT EXISTS idx_radio_channels_active
  ON radio_channels(archived_at) WHERE archived_at IS NULL;
-- Order-by-sort path for the picker.
CREATE INDEX IF NOT EXISTS idx_radio_channels_sort
  ON radio_channels(sort_order, id);

CREATE TABLE IF NOT EXISTS radio_transmissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- No CASCADE — channel archival must not erase tx history.
  channel_id INTEGER REFERENCES radio_channels(id),
  user_id INTEGER REFERENCES users(id),
  -- Denormalized unit label (e.g. "U07", "K9-2"). Fast filter without join,
  -- and survives user-reassignment-of-units.
  unit_label TEXT,
  transmitted_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  -- Real seconds with fractional precision (1.5 = 1500ms).
  duration_seconds REAL NOT NULL DEFAULT 0,
  -- Optional speech-to-text result.
  transcript TEXT,
  -- Pointer to stored audio in R2 (or wherever); NULL if audio not retained.
  audio_url TEXT,
  -- Integer priority (0=normal, 1=urgent, 2=emergency). Allows arithmetic
  -- comparisons in WHERE filters ("priority > 0").
  priority INTEGER NOT NULL DEFAULT 0,
  -- Free-form tags (CSV or JSON, handler's choice).
  tags TEXT,
  -- Optional link back to the CFS the transmission relates to — lets the
  -- incident detail panel pull the radio chatter for that call.
  call_id INTEGER REFERENCES calls_for_service(id)
);

-- Per-user feed: "what did unit X say?"
CREATE INDEX IF NOT EXISTS idx_radio_transmissions_user
  ON radio_transmissions(user_id);
-- CFS detail panel: "radio chatter for call N"
CREATE INDEX IF NOT EXISTS idx_radio_tx_call
  ON radio_transmissions(call_id);
-- Channel feed (primary read): "what happened on channel X recently?"
CREATE INDEX IF NOT EXISTS idx_radio_tx_channel_time
  ON radio_transmissions(channel_id, transmitted_at DESC);
-- Global recent feed across channels (admin views, system-wide search).
CREATE INDEX IF NOT EXISTS idx_radio_tx_time
  ON radio_transmissions(transmitted_at DESC);
-- Officer history with chronology.
CREATE INDEX IF NOT EXISTS idx_radio_tx_user_time
  ON radio_transmissions(user_id, transmitted_at DESC);

CREATE TABLE IF NOT EXISTS radio_recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Cascade: orphan bookmarks are meaningless.
  transmission_id INTEGER NOT NULL REFERENCES radio_transmissions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT,
  notes TEXT,
  color TEXT,
  -- Marker position (seconds into the tx audio).
  bookmark_seconds REAL,
  -- Loop range for "repeat this segment" playback.
  loop_start_seconds REAL,
  loop_end_seconds REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Per-user bookmark listing with chronology.
CREATE INDEX IF NOT EXISTS idx_radio_rec_user
  ON radio_recordings(user_id, created_at DESC);
-- Reverse lookup: "is this tx already bookmarked by anyone?"
CREATE INDEX IF NOT EXISTS idx_radio_rec_tx
  ON radio_recordings(transmission_id);
