-- Add business_id FK to serve_queue so corporate-recipient intakes carry
-- a direct link to the businesses record (previously only accessible via
-- the call_businesses junction). Used by enrichment and briefing lookups.
ALTER TABLE serve_queue ADD COLUMN business_id INTEGER REFERENCES businesses(id);
