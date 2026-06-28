-- Phase 5 — backwards-compat columns for the EmailIncidentLinks UI.
-- The original Phase 3 email_links table normalized everything into
-- (entity_type, entity_id, entity_ref); the legacy client emits a
-- 'linkType' and 'notes' on POST /link and reads them back on GET.
-- Adding the columns lets the existing client work unchanged.
-- Applied directly to live D1 on 2026-06-08; file is here for fresh DBs.

ALTER TABLE email_links ADD COLUMN notes TEXT;
ALTER TABLE email_links ADD COLUMN link_type TEXT;
