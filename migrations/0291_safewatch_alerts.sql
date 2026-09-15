-- ============================================================
-- 0291_safewatch_alerts.sql
-- SafeWatch inbound alert quarantine (team3-safewatch integration)
-- ------------------------------------------------------------
-- Inbound-ONLY. SafeWatch pushes community reports (source_kind
-- 'community') and aggregated third-party feed items (source_kind
-- 'feed') into RMPG Flex. Nothing about RMPG operations is ever
-- sent outbound to SafeWatch.
--
-- This is UNTRUSTED PUBLIC INPUT landing in a law-enforcement
-- system, so it is quarantined here and NEVER auto-promoted into
-- calls_for_service / public_tips / investigative_tips. A
-- supervisor triages each row; promotion is a deliberate human act
-- recorded via status + reviewed_by + promoted_tip_id.
--
-- New table, so the D1 100-column cap is not in play (14 columns).
-- ============================================================

CREATE TABLE IF NOT EXISTS safewatch_alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Caller-supplied stable id. UNIQUE per source so retries/replays
  -- of the same alert converge on one row instead of duplicating.
  external_id     TEXT NOT NULL,
  -- Provenance. 'community' = a resident reported it through the
  -- SafeWatch app; 'feed' = SafeWatch aggregated it from an upstream
  -- publisher, named in `source` (e.g. 'nws', 'slcpd', 'uhp').
  source_kind     TEXT NOT NULL DEFAULT 'community'
                  CHECK(source_kind IN ('community','feed')),
  source          TEXT NOT NULL DEFAULT 'safewatch',
  alert_type      TEXT,
  severity        TEXT NOT NULL DEFAULT 'info'
                  CHECK(severity IN ('info','advisory','urgent')),
  headline        TEXT NOT NULL,
  body            TEXT,
  location_text   TEXT,
  latitude        REAL,
  longitude       REAL,
  -- Free-text contact the reporter chose to supply. Community only,
  -- always optional, never required for triage.
  reporter_contact TEXT,
  occurred_at     TEXT,
  received_at     TEXT NOT NULL DEFAULT (datetime('now')),
  status          TEXT NOT NULL DEFAULT 'new'
                  CHECK(status IN ('new','reviewed','promoted','dismissed')),
  reviewed_by     INTEGER,
  reviewed_at     TEXT,
  promoted_tip_id INTEGER,
  -- Original JSON as received, for provenance and re-parsing if the
  -- upstream schema shifts.
  raw_payload     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_safewatch_alerts_ext
  ON safewatch_alerts(source, external_id);

CREATE INDEX IF NOT EXISTS idx_safewatch_alerts_status
  ON safewatch_alerts(status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_safewatch_alerts_kind
  ON safewatch_alerts(source_kind, received_at DESC);
