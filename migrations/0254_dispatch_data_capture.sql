-- ============================================================
-- 0254: Dispatch data capture — subject linking + session state
-- ============================================================

-- Links persons to calls in a structured role (caller/suspect/victim/
-- witness/contact). Replaces the loose caller_name/caller_phone text
-- fields on calls_for_service with a fully normalized FK to persons.
CREATE TABLE IF NOT EXISTS cfs_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL REFERENCES calls_for_service(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,

  -- Role of this person in this call
  role TEXT NOT NULL DEFAULT 'contact'
    CHECK(role IN ('caller','suspect','victim','witness','contact','reporting_party','bystander')),

  -- Narrative capture (free-form, dispatcher-entered during call)
  relationship_to_call TEXT,         -- "lives at the address", "reported the theft", etc.
  description_narrative TEXT,        -- physical description as spoken by caller
  last_seen_location TEXT,
  last_seen_at TEXT,                 -- ISO 8601
  direction_of_travel TEXT,
  vehicle_description TEXT,          -- free-text vehicle desc if not linked to vehicles_records

  -- Cross-links to other tables set after capture
  vehicle_record_id INTEGER REFERENCES vehicles_records(id) ON DELETE SET NULL,
  warrant_id INTEGER REFERENCES warrants(id) ON DELETE SET NULL,
  person_intel_id INTEGER REFERENCES person_intelligence(id) ON DELETE SET NULL,

  -- Disposition
  located INTEGER NOT NULL DEFAULT 0,    -- 1 = officer located this person
  arrested INTEGER NOT NULL DEFAULT 0,
  disposition TEXT,

  -- Metadata
  captured_by INTEGER REFERENCES users(id),
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cfs_subjects_call ON cfs_subjects(call_id);
CREATE INDEX IF NOT EXISTS idx_cfs_subjects_person ON cfs_subjects(person_id);
CREATE INDEX IF NOT EXISTS idx_cfs_subjects_role ON cfs_subjects(role);
CREATE INDEX IF NOT EXISTS idx_cfs_subjects_vehicle ON cfs_subjects(vehicle_record_id);

-- Tracks structured data-entry sessions during active calls.
-- Stores form state as JSON so the dispatcher can save progress and
-- return to a partially-filled form across reconnects.
CREATE TABLE IF NOT EXISTS dispatch_capture_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id INTEGER NOT NULL REFERENCES calls_for_service(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  dispatcher_id INTEGER REFERENCES users(id),

  -- Current capture state (caller / subject / vehicle panels)
  caller_data TEXT NOT NULL DEFAULT '{}',    -- JSON: caller identity data
  subjects_data TEXT NOT NULL DEFAULT '[]',  -- JSON: array of subject capture objects
  vehicles_data TEXT NOT NULL DEFAULT '[]',  -- JSON: array of vehicle objects
  notes TEXT,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','submitted','superseded')),
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dcs_call ON dispatch_capture_sessions(call_id);
CREATE INDEX IF NOT EXISTS idx_dcs_dispatcher ON dispatch_capture_sessions(dispatcher_id);
CREATE INDEX IF NOT EXISTS idx_dcs_status ON dispatch_capture_sessions(status);

-- Audit log for all PII / skip-tracer queries. Required for law
-- enforcement data governance: every officer-initiated query against
-- persons / dl_records / skip_tracer / person_intel must be logged.
CREATE TABLE IF NOT EXISTS subject_query_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queried_by INTEGER NOT NULL REFERENCES users(id),
  query_type TEXT NOT NULL,         -- 'name','phone','dob','plate','email','address','cross_ref'
  query_input TEXT NOT NULL,        -- normalized query string (may be JSON for multi-field)
  hit_count INTEGER NOT NULL DEFAULT 0,
  source_tables TEXT NOT NULL DEFAULT '[]',  -- JSON array: which tables returned rows
  call_id INTEGER REFERENCES calls_for_service(id) ON DELETE SET NULL,
  dossier_id INTEGER REFERENCES person_intelligence(id) ON DELETE SET NULL,
  queried_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sql_queried_by ON subject_query_log(queried_by);
CREATE INDEX IF NOT EXISTS idx_sql_query_type ON subject_query_log(query_type);
CREATE INDEX IF NOT EXISTS idx_sql_call ON subject_query_log(call_id);
CREATE INDEX IF NOT EXISTS idx_sql_queried_at ON subject_query_log(queried_at);
