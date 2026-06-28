-- Replay idempotency: mark rows already sent to Iceberg so re-runs skip them
ALTER TABLE vehicle_sightings ADD COLUMN analytics_replayed_at TEXT;
ALTER TABLE audit_log ADD COLUMN analytics_replayed_at TEXT;
ALTER TABLE gps_breadcrumbs ADD COLUMN analytics_replayed_at TEXT;
ALTER TABLE calls_for_service ADD COLUMN analytics_replayed_at TEXT;
ALTER TABLE citations ADD COLUMN analytics_replayed_at TEXT;
ALTER TABLE incidents ADD COLUMN analytics_replayed_at TEXT;

-- Confidence audit trail: preserve raw value before MIN(·,0.84) correction
ALTER TABLE vehicle_sightings ADD COLUMN original_confidence REAL;
ALTER TABLE alpr_captures ADD COLUMN original_plate_confidence REAL;

CREATE INDEX IF NOT EXISTS idx_vs_replay ON vehicle_sightings(analytics_replayed_at, id) WHERE analytics_replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_al_replay ON audit_log(analytics_replayed_at, id) WHERE analytics_replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gps_replay ON gps_breadcrumbs(analytics_replayed_at, id) WHERE analytics_replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cfs_replay ON calls_for_service(analytics_replayed_at, id) WHERE analytics_replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cit_replay ON citations(analytics_replayed_at, id) WHERE analytics_replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_inc_replay ON incidents(analytics_replayed_at, id) WHERE analytics_replayed_at IS NULL;
