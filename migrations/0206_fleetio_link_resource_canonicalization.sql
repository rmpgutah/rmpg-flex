-- Fleet.io link-resource canonicalization.
--
-- `fleetio_links.fleetio_resource` participates in UNIQUE (fleetio_resource,
-- fleetio_id) (migration 0133), so the string is part of a link's identity, not
-- a label. Two writers disagreed on the spelling:
--   • src/routes/fleetio.ts (/seed, /pull) wrote the PLURAL REST path segment
--     ('vehicles', 'fuel_entries')
--   • recordLink() in src/utils/fleetio/sync.ts wrote the SINGULAR internal
--     resource token ('vehicle', 'work_order', 'vendor', 'part')
--
-- Consequences, both live:
--   1. The unique index stopped preventing double-links — ('vehicle', 42) and
--      ('vehicles', 42) are distinct keys for the same remote vehicle.
--   2. /pull's `WHERE fleetio_resource='vehicles'` could not see links the sync
--      engine had created, so it re-processed those vehicles on every run and
--      its fuel-import phase skipped them entirely — their Fleet.io fuel history
--      never landed in RMPG.
--
-- Canonical form is the Fleet.io REST path segment (see
-- src/utils/fleetio/resources.ts, FLEETIO_LINK_RESOURCE), because it's derivable
-- from the endpoint and therefore can't drift again.
--
-- Idempotent: re-running is a no-op once the singular values are gone. Readers
-- still accept the singular spellings (acceptedLinkResources) so a row written
-- by an older Worker bundle mid-deploy resolves either way.
--
-- ⚠️ Apply DIRECTLY to live D1 785de7ae after merge (deploy.yml's migration step
-- is continue-on-error) via scripts/apply-migration.sh, then verify with:
--   SELECT fleetio_resource, COUNT(*) FROM fleetio_links GROUP BY 1;
-- Expect only: vehicles, fuel_entries, work_orders, vendors, parts.

-- Ordered narrowest-first. Each UPDATE is guarded by NOT EXISTS so a row whose
-- canonical twin ALREADY exists (i.e. the same remote record got linked twice
-- under both spellings — exactly what the broken index allowed) is left alone
-- rather than aborting the statement on the unique index. Those survivors are
-- reported by the verification query below and need a human decision.
UPDATE fleetio_links SET fleetio_resource = 'vehicles', updated_at = datetime('now')
WHERE fleetio_resource = 'vehicle'
  AND NOT EXISTS (
    SELECT 1 FROM fleetio_links b
    WHERE b.fleetio_resource = 'vehicles' AND b.fleetio_id = fleetio_links.fleetio_id
  );

UPDATE fleetio_links SET fleetio_resource = 'fuel_entries', updated_at = datetime('now')
WHERE fleetio_resource = 'fuel_entry'
  AND NOT EXISTS (
    SELECT 1 FROM fleetio_links b
    WHERE b.fleetio_resource = 'fuel_entries' AND b.fleetio_id = fleetio_links.fleetio_id
  );

UPDATE fleetio_links SET fleetio_resource = 'work_orders', updated_at = datetime('now')
WHERE fleetio_resource = 'work_order'
  AND NOT EXISTS (
    SELECT 1 FROM fleetio_links b
    WHERE b.fleetio_resource = 'work_orders' AND b.fleetio_id = fleetio_links.fleetio_id
  );

UPDATE fleetio_links SET fleetio_resource = 'vendors', updated_at = datetime('now')
WHERE fleetio_resource = 'vendor'
  AND NOT EXISTS (
    SELECT 1 FROM fleetio_links b
    WHERE b.fleetio_resource = 'vendors' AND b.fleetio_id = fleetio_links.fleetio_id
  );

UPDATE fleetio_links SET fleetio_resource = 'parts', updated_at = datetime('now')
WHERE fleetio_resource = 'part'
  AND NOT EXISTS (
    SELECT 1 FROM fleetio_links b
    WHERE b.fleetio_resource = 'parts' AND b.fleetio_id = fleetio_links.fleetio_id
  );

-- Index on the link lookup the sync engine now performs on every dispatch
-- (rmpg_table + rmpg_id + fleetio_resource) and on its new inverse (inbound
-- Fleet.io id -> RMPG id, used to resolve applyInbound's target row). The
-- existing UNIQUE indexes cover the first two columns and (resource, id)
-- respectively; this covers the reverse direction.
CREATE INDEX IF NOT EXISTS idx_fleetio_links_reverse
  ON fleetio_links (fleetio_resource, fleetio_id, rmpg_table);
