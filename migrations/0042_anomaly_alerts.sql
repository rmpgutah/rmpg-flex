-- ============================================================
-- 0042_anomaly_alerts.sql
-- ============================================================
-- Backs the dispatch AnomalyAlertBanner (client/src/components/
-- AnomalyAlertBanner.tsx). The banner has shipped for a while but
-- /api/dispatch/anomaly-alerts was implemented nowhere — no table, no
-- detection — so the banner silently showed nothing. This adds the
-- store; the detection pass runs in the Worker's scheduled() cron.
--
-- Columns mirror the client's AnomalyAlert interface exactly so the GET
-- list maps 1:1 with no transform.
--
-- dedup_key + the partial unique index are the core design: a still-
-- active anomaly (e.g. "call 24-00123 unassigned 25 min") must UPDATE on
-- each cron pass, not insert a duplicate. Once acknowledged, the partial
-- index no longer covers it, so the same condition recurring later can
-- raise a fresh alert.

CREATE TABLE IF NOT EXISTS anomaly_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_type TEXT NOT NULL,          -- 'unassigned_call' | 'overdue_onscene' | …
  severity TEXT NOT NULL,            -- 'critical' | 'high' | 'medium' | 'low'
  title TEXT NOT NULL,
  details TEXT,
  zone_beat TEXT,                    -- beat label/id when the anomaly is location-scoped
  dedup_key TEXT,                    -- stable per live condition; drives upsert
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One ACTIVE (unacknowledged) row per condition. Acknowledged rows drop
-- out of the index so a recurrence can re-alert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_dedup_active
  ON anomaly_alerts(dedup_key) WHERE acknowledged_at IS NULL;

-- "Active alerts in the last N hours" — the banner's read query.
CREATE INDEX IF NOT EXISTS idx_anomaly_active
  ON anomaly_alerts(acknowledged_at, created_at DESC);
