-- Dial Connect call recordings, voicemails, transcripts, speed dials, presence.
-- Idempotent CREATE TABLE IF NOT EXISTS (D1 deploy apply is continue-on-error).

CREATE TABLE IF NOT EXISTS dialer_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT,
  direction TEXT NOT NULL DEFAULT 'outbound',
  from_number TEXT,
  to_number TEXT,
  from_name TEXT,
  to_name TEXT,
  agent_user_id INTEGER,
  agent_name TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  started_at TEXT,
  ended_at TEXT,
  duration_seconds INTEGER,
  disposition TEXT,
  notes TEXT,
  tags TEXT,
  starred INTEGER NOT NULL DEFAULT 0,
  call_id INTEGER,
  person_id INTEGER,
  recording_r2_key TEXT,
  recording_content_type TEXT,
  recording_bytes INTEGER,
  recording_source_url TEXT,
  transcript TEXT,
  transcript_confidence REAL,
  transcript_status TEXT DEFAULT 'none',
  callback_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dialer_calls_sid
  ON dialer_calls(call_sid) WHERE call_sid IS NOT NULL AND TRIM(call_sid) != '';
CREATE INDEX IF NOT EXISTS idx_dialer_calls_started ON dialer_calls(started_at);
CREATE INDEX IF NOT EXISTS idx_dialer_calls_status ON dialer_calls(status);
CREATE INDEX IF NOT EXISTS idx_dialer_calls_agent ON dialer_calls(agent_user_id);

CREATE TABLE IF NOT EXISTS dialer_voicemails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT,
  from_number TEXT,
  from_name TEXT,
  to_number TEXT,
  mailbox TEXT,
  duration_seconds INTEGER,
  recording_r2_key TEXT,
  recording_content_type TEXT,
  recording_bytes INTEGER,
  recording_source_url TEXT,
  transcript TEXT,
  transcript_status TEXT DEFAULT 'none',
  urgency TEXT NOT NULL DEFAULT 'normal',
  is_read INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  assigned_user_id INTEGER,
  assigned_name TEXT,
  call_id INTEGER,
  person_id INTEGER,
  notes TEXT,
  heard_at TEXT,
  received_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dialer_vm_received ON dialer_voicemails(received_at);
CREATE INDEX IF NOT EXISTS idx_dialer_vm_read ON dialer_voicemails(is_read, archived);

CREATE TABLE IF NOT EXISTS dialer_speed_dials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  number TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dialer_speed_user ON dialer_speed_dials(user_id, sort_order);

CREATE TABLE IF NOT EXISTS dialer_presence (
  user_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'available',
  message TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
