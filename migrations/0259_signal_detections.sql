-- Radar 360º Signal Intelligence: RF/electronic signal detections
-- Stores WiFi APs, Bluetooth Classic, BLE, and cell tower observations
-- captured by field devices (Electron desktop or mobile). All 50 identifiable
-- attributes are stored in a `properties` JSON column alongside common fields.
--
-- identifier = MAC address (BSSIDs, BT MAC) or cell key (MCC-MNC-CellID).
-- Dedup is by (scan_session_id, signal_type, identifier).

CREATE TABLE IF NOT EXISTS signal_detections (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_session_id     TEXT    NOT NULL,                -- UUID grouping one full scan pass
  signal_type         TEXT    NOT NULL
    CHECK(signal_type IN ('wifi_ap','bt_classic','ble','cell_tower')),

  -- Common identity
  identifier          TEXT    NOT NULL,                -- MAC/BSSID/cell key (dedup)
  display_name        TEXT,                            -- SSID / device name / carrier

  -- Signal quality (common across all types)
  rssi_dbm            INTEGER,                         -- Received signal strength (dBm)
  signal_pct          INTEGER,                         -- 0–100 scale (for UI bars)
  tx_power_dbm        INTEGER,                         -- Advertised TX power if known
  distance_estimate_m REAL,                            -- Estimated metres from scanner

  -- Scanner location at time of detection
  scanner_lat         REAL,
  scanner_lng         REAL,
  scanner_device_id   TEXT,                            -- Toughbook hostname / device tag

  -- Type-specific attributes (JSON with up to 50 named fields; see below)
  properties          TEXT    NOT NULL DEFAULT '{}',

  -- Optional linkage to a call or incident
  call_id             INTEGER REFERENCES calls_for_service(id) ON DELETE SET NULL,
  incident_id         INTEGER REFERENCES incidents(id) ON DELETE SET NULL,
  submitted_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Temporal
  first_seen_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Primary access patterns
CREATE INDEX IF NOT EXISTS idx_sigdet_session
  ON signal_detections(scan_session_id);
CREATE INDEX IF NOT EXISTS idx_sigdet_type_time
  ON signal_detections(signal_type, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sigdet_scanner_loc
  ON signal_detections(scanner_lat, scanner_lng, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sigdet_call
  ON signal_detections(call_id)
  WHERE call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sigdet_identifier
  ON signal_detections(signal_type, identifier, last_seen_at DESC);

-- ── properties JSON schema by signal_type ───────────────────────────────
--
-- wifi_ap:
--   channel INT, frequency_mhz INT, band TEXT ('2.4'|'5'|'6'),
--   security_type TEXT, cipher_suite TEXT, auth_suite TEXT,
--   wps_enabled INT, hidden INT, vendor TEXT, network_type TEXT,
--   radio_type TEXT, max_data_rate_mbps REAL, beacon_interval_ms INT,
--   supported_rates TEXT, country_code TEXT, channel_utilization_pct INT,
--   bss_load_station_count INT, spectrum_management INT
--
-- bt_classic:
--   bt_class_hex TEXT, bt_device_category TEXT, bt_device_subcategory TEXT,
--   bt_vendor TEXT, bt_connectable INT, bt_paired INT,
--   bt_services TEXT (JSON array of UUIDs/names), bt_version TEXT,
--   bt_lmp_version INT, bt_manufacturer_id INT
--
-- ble:
--   ble_mac_type TEXT ('public'|'random_static'|'random_resolvable'|'random_non_resolvable'),
--   ble_service_uuids TEXT (JSON array), ble_manufacturer_id INT,
--   ble_manufacturer_name TEXT, ble_appearance_category TEXT,
--   ble_advertisement_interval_ms INT, ble_connectable INT,
--   ble_manufacturer_data_hex TEXT, ble_service_data TEXT (JSON),
--   ble_flags INT, ble_complete_local_name TEXT
--
-- cell_tower:
--   cell_mcc INT, cell_mnc INT, cell_carrier_name TEXT,
--   cell_technology TEXT ('GSM'|'UMTS'|'LTE'|'NR'),
--   cell_frequency_band TEXT, cell_arfcn INT, cell_pci INT,
--   cell_lac INT, cell_tac INT, cell_cell_id INT,
--   cell_rsrp_dbm INT, cell_rsrq_db INT, cell_sinr_db INT,
--   cell_timing_advance_m INT, cell_is_serving INT
