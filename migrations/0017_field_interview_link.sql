-- ============================================================
-- Migration 0017 — incident_links CHECK expansion for FI cards (NB-5)
-- ============================================================
-- Rebuilds incident_links with 'field_interview' in the linked_type
-- CHECK constraint. SQLite cannot ALTER a CHECK in place.
-- ============================================================

CREATE TABLE IF NOT EXISTS incident_links_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  linked_type TEXT NOT NULL CHECK(linked_type IN ('incident','call','case','warrant','citation','arrest','field_interview')),
  linked_id INTEGER NOT NULL,
  link_reason TEXT,
  added_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(incident_id, linked_type, linked_id)
);

INSERT INTO incident_links_new (id, incident_id, linked_type, linked_id, link_reason, added_by, created_at)
SELECT id, incident_id, linked_type, linked_id, link_reason, added_by, created_at FROM incident_links;

DROP TABLE incident_links;
ALTER TABLE incident_links_new RENAME TO incident_links;
