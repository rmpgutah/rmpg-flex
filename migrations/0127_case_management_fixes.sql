-- ============================================================
-- 0127_case_management_fixes.sql
-- Case management bug fixes + note editing support.
-- Apply to live rmpg-flex DB (785de7ae) after merge.
-- ============================================================

-- Add updated_at to case_notes (needed by PUT /:id/notes/:noteId).
-- D1 ignores a failed ADD COLUMN on re-apply (continue-on-error).
ALTER TABLE case_notes ADD COLUMN updated_at TEXT;

-- Backfill case_person_links from the legacy case_persons table.
-- Older cases linked persons via case_persons (role col); the current
-- Worker reads only case_person_links — this bridges the gap so those
-- legacy-linked persons show up in the Persons tab.
INSERT OR IGNORE INTO case_person_links (case_id, person_id, relationship, created_at)
SELECT cp.case_id, cp.person_id,
       COALESCE(cp.role, 'linked'),
       COALESCE(cp.created_at, datetime('now'))
FROM case_persons cp
WHERE EXISTS (SELECT 1 FROM cases c WHERE c.id = cp.case_id);
