-- Radar 360º — Promote type-specific fields from the JSON `properties` blob
-- to dedicated columns on signal_detections. 56 new columns across 4 signal
-- types: WiFi (18), BT Classic (12), BLE (11 unique + bt_vendor shared),
-- Cell Tower (15). Total with existing 19 columns = 75 (under the 100-col cap).
--
-- Each ALTER is independent; D1 rejects IF NOT EXISTS on ADD COLUMN, so
-- failures from re-apply are expected and harmless.

-- ── WiFi AP columns (18) ────────────────────────────────────────────────
ALTER TABLE signal_detections ADD COLUMN ssid TEXT;
ALTER TABLE signal_detections ADD COLUMN bssid TEXT;
ALTER TABLE signal_detections ADD COLUMN channel INTEGER;
ALTER TABLE signal_detections ADD COLUMN frequency_mhz INTEGER;
ALTER TABLE signal_detections ADD COLUMN band TEXT;
ALTER TABLE signal_detections ADD COLUMN security_type TEXT;
ALTER TABLE signal_detections ADD COLUMN cipher_suite TEXT;
ALTER TABLE signal_detections ADD COLUMN auth_suite TEXT;
ALTER TABLE signal_detections ADD COLUMN wps_enabled INTEGER;
ALTER TABLE signal_detections ADD COLUMN hidden INTEGER;
ALTER TABLE signal_detections ADD COLUMN vendor TEXT;
ALTER TABLE signal_detections ADD COLUMN network_type TEXT;
ALTER TABLE signal_detections ADD COLUMN radio_type TEXT;
ALTER TABLE signal_detections ADD COLUMN max_data_rate_mbps REAL;
ALTER TABLE signal_detections ADD COLUMN beacon_interval_ms INTEGER;
ALTER TABLE signal_detections ADD COLUMN supported_rates TEXT;
ALTER TABLE signal_detections ADD COLUMN country_code TEXT;
ALTER TABLE signal_detections ADD COLUMN channel_utilization_pct INTEGER;

-- ── Bluetooth Classic columns (12) ──────────────────────────────────────
ALTER TABLE signal_detections ADD COLUMN bt_name TEXT;
ALTER TABLE signal_detections ADD COLUMN bt_mac TEXT;
ALTER TABLE signal_detections ADD COLUMN bt_class_hex TEXT;
ALTER TABLE signal_detections ADD COLUMN bt_device_category TEXT;
ALTER TABLE signal_detections ADD COLUMN bt_device_subcategory TEXT;
ALTER TABLE signal_detections ADD COLUMN bt_vendor TEXT;
ALTER TABLE signal_detections ADD COLUMN bt_connectable INTEGER;
ALTER TABLE signal_detections ADD COLUMN bt_paired INTEGER;
ALTER TABLE signal_detections ADD COLUMN bt_services TEXT;
ALTER TABLE signal_detections ADD COLUMN bt_version TEXT;
ALTER TABLE signal_detections ADD COLUMN bt_lmp_version TEXT;
ALTER TABLE signal_detections ADD COLUMN bt_manufacturer_id INTEGER;

-- ── BLE columns (11 unique; bt_vendor shared above) ─────────────────────
ALTER TABLE signal_detections ADD COLUMN ble_complete_local_name TEXT;
ALTER TABLE signal_detections ADD COLUMN ble_mac_type TEXT;
ALTER TABLE signal_detections ADD COLUMN ble_service_uuids TEXT;
ALTER TABLE signal_detections ADD COLUMN ble_manufacturer_id INTEGER;
ALTER TABLE signal_detections ADD COLUMN ble_manufacturer_name TEXT;
ALTER TABLE signal_detections ADD COLUMN ble_appearance_category TEXT;
ALTER TABLE signal_detections ADD COLUMN ble_advertisement_interval_ms INTEGER;
ALTER TABLE signal_detections ADD COLUMN ble_connectable INTEGER;
ALTER TABLE signal_detections ADD COLUMN ble_manufacturer_data_hex TEXT;
ALTER TABLE signal_detections ADD COLUMN ble_service_data TEXT;
ALTER TABLE signal_detections ADD COLUMN ble_flags INTEGER;

-- ── Cell Tower columns (15) ─────────────────────────────────────────────
ALTER TABLE signal_detections ADD COLUMN cell_mcc INTEGER;
ALTER TABLE signal_detections ADD COLUMN cell_mnc INTEGER;
ALTER TABLE signal_detections ADD COLUMN cell_carrier_name TEXT;
ALTER TABLE signal_detections ADD COLUMN cell_technology TEXT;
ALTER TABLE signal_detections ADD COLUMN cell_frequency_band TEXT;
ALTER TABLE signal_detections ADD COLUMN cell_arfcn INTEGER;
ALTER TABLE signal_detections ADD COLUMN cell_pci INTEGER;
ALTER TABLE signal_detections ADD COLUMN cell_lac INTEGER;
ALTER TABLE signal_detections ADD COLUMN cell_tac INTEGER;
ALTER TABLE signal_detections ADD COLUMN cell_cell_id INTEGER;
ALTER TABLE signal_detections ADD COLUMN cell_rsrp_dbm INTEGER;
ALTER TABLE signal_detections ADD COLUMN cell_rsrq_db INTEGER;
ALTER TABLE signal_detections ADD COLUMN cell_sinr_db INTEGER;
ALTER TABLE signal_detections ADD COLUMN cell_timing_advance_m INTEGER;
ALTER TABLE signal_detections ADD COLUMN cell_is_serving INTEGER;

-- ── Additional indexes for column-level queries ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_sigdet_ssid
  ON signal_detections(ssid) WHERE ssid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sigdet_bssid
  ON signal_detections(bssid) WHERE bssid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sigdet_bt_mac
  ON signal_detections(bt_mac) WHERE bt_mac IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sigdet_vendor
  ON signal_detections(vendor) WHERE vendor IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sigdet_distance
  ON signal_detections(distance_estimate_m) WHERE distance_estimate_m IS NOT NULL;
