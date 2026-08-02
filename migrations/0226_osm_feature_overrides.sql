-- ============================================================
-- OSM feature overrides — RMPG's internal edit layer over OpenStreetMap
-- ============================================================
-- The OSM overlays are served from immutable PMTiles archives in R2, so a
-- feature cannot be edited in place. Instead every override lives here, keyed
-- by the OpenStreetMap element id (`n83099358` / `w1234` / `r567`) that the
-- pipeline now stamps onto every feature, and is joined over the tile data at
-- render time.
--
-- Why an override table rather than editing the archives:
--   * archives are regenerated wholesale from a fresh OSM extract; any edit
--     written into them would be silently destroyed on the next rebuild
--   * osm_id is stable ACROSS rebuilds, so an override survives a refresh
--   * it keeps a clean provenance line — OSM data stays OSM data, and RMPG's
--     corrections are attributable to a named user with a timestamp
--
-- This is an authoritative law-enforcement record system, so an override never
-- deletes the underlying observation: `hidden` suppresses rendering, and the
-- original OSM values remain in the tiles.

CREATE TABLE IF NOT EXISTS osm_feature_overrides (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,

  -- OpenStreetMap element id, e.g. 'n83099358'. Stable across extract
  -- refreshes; this is the whole reason the pipeline captures it.
  osm_id            TEXT NOT NULL,
  -- Archive/group the feature came from ('safety', 'surveillance', ...).
  -- Denormalised so the client can fetch only the groups it has switched on.
  osm_group         TEXT NOT NULL,
  -- Category within the group ('hydrant', 'alpr', ...).
  osm_cat           TEXT,

  -- ── The override payload ──
  -- Free-text operational note shown in the popup.
  note              TEXT,
  -- JSON object of corrected field values, e.g. {"colour":"red"}. Merged OVER
  -- the OSM tags at display time; OSM values are never destroyed.
  field_overrides   TEXT,
  -- 1 = suppress this feature from rendering (bad data, demolished, duplicate).
  hidden            INTEGER NOT NULL DEFAULT 0,
  -- 1 = an RMPG member physically confirmed this feature on the ground.
  -- The point of the whole layer: distinguishing crowd-sourced from verified.
  verified          INTEGER NOT NULL DEFAULT 0,
  verified_at       TEXT,
  verified_by       INTEGER,

  created_by        INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by        INTEGER,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One override row per feature. An upsert targets this constraint; without it
-- repeated edits would stack duplicate rows and the client would pick one at
-- random.
CREATE UNIQUE INDEX IF NOT EXISTS idx_osm_overrides_osm_id
  ON osm_feature_overrides(osm_id);

-- The client fetches overrides per visible group, so this is the hot path.
CREATE INDEX IF NOT EXISTS idx_osm_overrides_group
  ON osm_feature_overrides(osm_group);

-- Partial indexes: hidden and verified rows are a small minority, and these
-- are the two flags the renderer filters on.
CREATE INDEX IF NOT EXISTS idx_osm_overrides_hidden
  ON osm_feature_overrides(osm_group) WHERE hidden = 1;

CREATE INDEX IF NOT EXISTS idx_osm_overrides_verified
  ON osm_feature_overrides(osm_group) WHERE verified = 1;
