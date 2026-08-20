-- 0216_missing_d1_tables_repair.sql
-- Two tables that route code queries but that exist on NO live table. Found by
-- extending the schema checkers from "column absent" to "TABLE absent" — both
-- scanners had been SILENTLY SKIPPING unknown tables, so this whole class was
-- invisible (it is also how incident_photos in 0214 went unnoticed for so long).

-- call_notes: per-call timestamped notes, referenced by FOUR sites —
--   dispatch/calls.ts:873   copies a merged call's notes onto the master
--   dispatch/calls.ts:1574  note count for the call-detail panel
--   dispatch/extensions.ts:1733  appends "=== Call Notes ===" to a generated
--                                incident's narrative
-- All four are wrapped in .catch(), so the notes silently never copied and the
-- count silently read 0. Columns are exactly what those statements use.
CREATE TABLE IF NOT EXISTS call_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL,
  user_id INTEGER,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_call_notes_call ON call_notes(call_id);
CREATE INDEX IF NOT EXISTS idx_call_notes_created ON call_notes(created_at);

-- protection_orders: backs GET /dispatch/call-links/persons/:id/protection-orders.
-- NOTE: nothing in the app writes to this table yet — there is no intake path
-- for protective orders. Creating it makes that endpoint return an honest empty
-- set ("no active orders") instead of throwing a query error its catch
-- swallowed into the same empty response. Column set is exactly what the one
-- existing query selects and filters on; extend it when an intake path lands.
CREATE TABLE IF NOT EXISTS protection_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_number TEXT,
  respondent_person_id INTEGER,
  protected_person_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  issued_date TEXT,
  expires_at TEXT,
  issuing_court TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_protection_orders_respondent
  ON protection_orders(respondent_person_id);
CREATE INDEX IF NOT EXISTS idx_protection_orders_status ON protection_orders(status);
