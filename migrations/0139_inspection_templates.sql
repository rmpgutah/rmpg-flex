-- Fleet.io PR 6 — Inspection templates + per-item answers + auto-escalation.
-- Spec: docs/superpowers/specs/2026-06-21-fleetio-integration-design.md (PR 6 row)
--
-- Adds the inspection_templates table (versioned, immutable once submitted-against)
-- and 3 columns on vehicle_inspections so a row can carry:
--   - template_id        which template version was used
--   - items_json         the per-item answers (the heart of the QR pre-trip flow)
--   - escalated_issue_id reference to the fleet_maintenance row created by an
--                        auto-failure cascade (fail_creates_issue=true items)
--
-- Pre-state on live D1 785de7ae (verified 2026-06-21):
--   vehicle_inspections — 14 columns; +3 → 17. Safely under D1 cap.
--   inspection_templates — does not exist.
--
-- Apply DIRECTLY to live D1 785de7ae after merge per
-- [[project-d1-schema-drift-audit]]. `pragma_table_info('vehicle_inspections')`
-- should report 17 cols including the 3 new ones; `SELECT name FROM
-- sqlite_master WHERE name='inspection_templates'` should return one row.

-- ===================================================================
-- inspection_templates — versioned schemas (immutable once submitted-against)
-- ===================================================================
-- schema_json shape (validated by src/utils/inspectionTemplates.ts):
--   {
--     "items": [
--       { "key": "tires",
--         "label": "Tires (tread + pressure)",
--         "type": "yes_no",                       // 'yes_no' | 'pass_fail' | 'text' | 'photo' | 'number'
--         "required": true,
--         "fail_creates_issue": true,             // a 'no' / 'fail' answer auto-creates fleet_maintenance + emits
--         "photo_required_on_fail": true          // operator must attach a photo to proceed past a fail
--       },
--       { "key": "headlights", "label": "Headlights", "type": "pass_fail", "required": true, "fail_creates_issue": true }
--     ]
--   }
-- Versioning rule (enforced in src/routes/inspectionTemplates.ts):
--   Editing a template that has been used by any vehicle_inspections row
--   creates a NEW row with version+1; the old version stays so historical
--   inspections continue to read against the schema they were taken under.

CREATE TABLE IF NOT EXISTS inspection_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                    -- 'Patrol Pre-Trip', 'Heavy Truck DOT'
  description TEXT,
  schema_json TEXT NOT NULL,             -- the canonical list of items + their flags
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  parent_template_id INTEGER,            -- soft FK to the prior version (NULL on v1)
  vehicle_type_code TEXT,                -- optional default: applies to one ref_vehicle_type
  created_by INTEGER,                    -- soft FK -> users(id)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inspection_templates_active
  ON inspection_templates (active, vehicle_type_code)
  WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_inspection_templates_versions
  ON inspection_templates (parent_template_id, version)
  WHERE parent_template_id IS NOT NULL;

-- ===================================================================
-- vehicle_inspections — +3 columns
-- ===================================================================
-- D1 does NOT support `IF NOT EXISTS` on `ALTER TABLE ADD COLUMN`, so a
-- re-apply errors on the already-present columns. This file is the repo
-- record; deploy step is continue-on-error. (Same pattern as 0064 / 0136.)

ALTER TABLE vehicle_inspections ADD COLUMN template_id INTEGER;          -- soft FK -> inspection_templates(id)
ALTER TABLE vehicle_inspections ADD COLUMN items_json TEXT;              -- {[item_key]: {answer, photo_key, notes, failed}}
ALTER TABLE vehicle_inspections ADD COLUMN escalated_issue_id INTEGER;   -- soft FK -> fleet_maintenance(id) when fail_creates_issue triggered

CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_template
  ON vehicle_inspections (template_id)
  WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_escalated
  ON vehicle_inspections (escalated_issue_id)
  WHERE escalated_issue_id IS NOT NULL;
