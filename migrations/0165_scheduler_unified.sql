-- 0165: Unified Scheduler — custom scheduled events + shift briefings
--
-- scheduler_events: generic calendar items created from Dispatch (call_id),
-- Serve Intake / Process Server (serve_queue_id), or standalone. The unified
-- agenda (/api/scheduler/agenda) merges these with serve_attempt_schedules,
-- shift_plans and court_events. Reminders fire via the every-minute cron
-- (src/utils/schedulerReminders.ts), mirroring serve_attempt_schedules.
CREATE TABLE IF NOT EXISTS scheduler_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT NOT NULL,          -- YYYY-MM-DD (America/Denver)
  start_time TEXT,                   -- HH:MM
  end_time TEXT,                     -- HH:MM
  officer_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  call_id INTEGER,                   -- calls_for_service link (dispatch follow-up)
  serve_queue_id INTEGER,            -- serve_queue link
  case_id INTEGER,
  location TEXT,
  category TEXT DEFAULT 'general',   -- general|follow_up|court|meeting|patrol|maintenance
  status TEXT DEFAULT 'scheduled',   -- scheduled|completed|cancelled
  notify_at TEXT,                    -- YYYY-MM-DDTHH:MM Denver local; NULL = no reminder
  notified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scheduler_events_date ON scheduler_events(event_date, status);
CREATE INDEX IF NOT EXISTS idx_scheduler_events_officer ON scheduler_events(officer_id, event_date);
CREATE INDEX IF NOT EXISTS idx_scheduler_events_notify ON scheduler_events(notify_at, notified, status);

-- shift_briefings: persisted briefings for ShiftBriefingsPage (the page shipped
-- long ago but its /api/shift-briefings backend never existed).
CREATE TABLE IF NOT EXISTS shift_briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  briefing_number TEXT,
  title TEXT NOT NULL,
  shift_type TEXT DEFAULT 'day',     -- day|swing|night
  content TEXT NOT NULL,             -- markdown or JSON (generated briefings)
  created_by INTEGER REFERENCES users(id),
  acknowledged_by TEXT DEFAULT '[]', -- JSON array of user ids
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shift_briefings_created ON shift_briefings(created_at);
