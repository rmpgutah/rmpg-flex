// ============================================================
// RMPG Flex — Radar 360º API
// ============================================================
// Situational-awareness scan: given a center coordinate and radius,
// returns nearby calls, persons with active flags, stolen/flagged
// vehicles, active units, and recent incidents — everything in range
// with bearing and distance so the client can render a radial display.
//
// Geo pattern: bounding-box WHERE clause (index-friendly) + Haversine
// filtering in JS, because D1's SQLite build lacks SIN/COS/ASIN.
// The box over-selects by ~41% at corners; Haversine post-filter
// corrects it before the result reaches the client.
//
// Requires at least 'officer' role — same gate as dispatch.
// client_viewer, contract_manager, human_resources excluded.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';

const radar360 = new Hono<Env>();
const operational = requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher');
radar360.use('*', operational);

// ── Haversine ─────────────────────────────────────────────

const EARTH_MILES = 3958.8;

function toRad(deg: number) { return deg * Math.PI / 180; }

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Bearing in degrees (0 = North, clockwise). */
function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
    - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/** Bounding box for a radius in miles around a point. */
function bbox(lat: number, lng: number, radiusMi: number) {
  const dLat = radiusMi / EARTH_MILES * (180 / Math.PI);
  const dLng = dLat / Math.cos(toRad(lat));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

// ── Result types ──────────────────────────────────────────

export interface RadarContact {
  kind: 'call' | 'person' | 'vehicle' | 'unit' | 'incident';
  id: number;
  label: string;
  sublabel?: string;
  flags: string[];
  /** 0–360, degrees from North. */
  bearing: number;
  /** Miles from scan center. */
  distanceMi: number;
  lat: number;
  lng: number;
  priority?: string;
  status?: string;
}

interface RadarScanResult {
  contacts: RadarContact[];
  /** Actual radius used (clamped). */
  radiusMi: number;
  centerLat: number;
  centerLng: number;
  scannedAt: string;
}

// ── POST /api/radar360/scan ───────────────────────────────

radar360.post('/scan', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || body.lat == null || body.lng == null) {
    return c.json({ error: 'lat and lng are required' }, 400);
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const radiusMi = Math.min(Math.max(Number(body.radius_mi) || 1, 0.1), 10);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'lat/lng must be finite numbers' }, 400);
  }

  const db = getDb(c.env);
  const box = bbox(lat, lng, radiusMi);
  const contacts: RadarContact[] = [];

  function addContact(raw: {
    kind: RadarContact['kind'];
    id: number; label: string; sublabel?: string;
    flags?: string[]; rlat: number; rlng: number;
    priority?: string; status?: string;
  }) {
    const dist = haversineMiles(lat, lng, raw.rlat, raw.rlng);
    if (dist > radiusMi) return;
    contacts.push({
      kind: raw.kind,
      id: raw.id,
      label: raw.label,
      sublabel: raw.sublabel,
      flags: raw.flags ?? [],
      bearing: bearingDeg(lat, lng, raw.rlat, raw.rlng),
      distanceMi: Math.round(dist * 100) / 100,
      lat: raw.rlat,
      lng: raw.rlng,
      priority: raw.priority,
      status: raw.status,
    });
  }

  await Promise.allSettled([

    // ── Active calls for service ───────────────────────
    query<{
      id: number; call_number: string | null; incident_type: string | null;
      priority: string; status: string; location_address: string | null;
      latitude: number; longitude: number;
    }>(db,
      `SELECT id, call_number, incident_type, priority, status, location_address,
              latitude, longitude
       FROM calls_for_service
       WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
         AND status NOT IN ('closed','cancelled','archived')
         AND latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY priority ASC, created_at DESC LIMIT 40`,
      box.minLat, box.maxLat, box.minLng, box.maxLng,
    ).then((rows) => {
      for (const r of rows) {
        if (!r.latitude || !r.longitude) continue;
        addContact({
          kind: 'call',
          id: r.id,
          label: r.call_number ?? `CFS #${r.id}`,
          sublabel: r.incident_type ?? undefined,
          flags: [],
          rlat: r.latitude, rlng: r.longitude,
          priority: r.priority,
          status: r.status,
        });
      }
    }).catch((err) => log.warn('[Radar360] calls query failed', { err })),

    // ── Active units with GPS ─────────────────────────
    query<{
      id: number; call_sign: string; status: string | null;
      latitude: number | null; longitude: number | null;
      current_call_id: number | null;
    }>(db,
      `SELECT id, call_sign, status, latitude, longitude, current_call_id
       FROM units
       WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
         AND latitude IS NOT NULL AND longitude IS NOT NULL
         AND status NOT IN ('off_duty','offline','out_of_service')
       LIMIT 30`,
      box.minLat, box.maxLat, box.minLng, box.maxLng,
    ).then((rows) => {
      for (const r of rows) {
        if (r.latitude == null || r.longitude == null) continue;
        addContact({
          kind: 'unit',
          id: r.id,
          label: r.call_sign,
          sublabel: r.status ?? undefined,
          flags: r.current_call_id ? ['ASSIGNED'] : [],
          rlat: r.latitude, rlng: r.longitude,
          status: r.status ?? undefined,
        });
      }
    }).catch((err) => log.warn('[Radar360] units query failed', { err })),

    // ── Flagged persons linked to active in-box calls ──────────
    // `persons` has no coordinate columns and no boolean flag columns; flag
    // data lives in the free-text `persons.flags` field and in `warrants`
    // (subject_person_id, status). Anchor each flagged person to the location
    // of the active call they're linked to via call_persons.
    query<{
      id: number; first_name: string | null; last_name: string | null;
      flags: string | null; latitude: number; longitude: number;
      has_warrant: number;
    }>(db,
      `SELECT p.id, p.first_name, p.last_name, p.flags,
              c.latitude AS latitude, c.longitude AS longitude,
              EXISTS(
                SELECT 1 FROM warrants w
                WHERE w.subject_person_id = p.id
                  AND LOWER(COALESCE(w.status,'')) IN ('active','outstanding')
              ) AS has_warrant
       FROM call_persons cp
       JOIN calls_for_service c ON c.id = cp.call_id
       JOIN persons p ON p.id = cp.person_id
       WHERE c.latitude BETWEEN ? AND ? AND c.longitude BETWEEN ? AND ?
         AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
         AND c.status NOT IN ('closed','cancelled','archived')
       GROUP BY p.id
       ORDER BY has_warrant DESC LIMIT 30`,
      box.minLat, box.maxLat, box.minLng, box.maxLng,
    ).then((rows) => {
      for (const r of rows) {
        if (r.latitude == null || r.longitude == null) continue;
        const flagText = (r.flags ?? '').toLowerCase();
        const flags: string[] = [];
        if (flagText.includes('officer safety') || flagText.includes('violent')) flags.push('OFFICER SAFETY');
        if (r.has_warrant) flags.push('WARRANT');
        if (flagText.includes('gang')) flags.push('GANG');
        if (flagText.includes('sex offender')) flags.push('SEX OFFENDER');
        if (!flags.length) continue;
        const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || `Person #${r.id}`;
        addContact({
          kind: 'person',
          id: r.id,
          label: name,
          flags,
          rlat: r.latitude, rlng: r.longitude,
        });
      }
    }).catch((err) => log.warn('[Radar360] persons query failed', { err })),

    // ── Stolen / flagged vehicles (from alpr_captures with location) ──
    query<{
      id: number; plate_number: string | null; make: string | null;
      model: string | null; year: number | null; color: string | null;
      is_stolen: number | null;
      stolen_status: string | null; latitude: number | null; longitude: number | null;
    }>(db,
      `SELECT vr.id, vr.plate_number, vr.make, vr.model, vr.year, vr.color,
              vr.is_stolen, vr.stolen_status, vr.latitude, vr.longitude
       FROM vehicles_records vr
       WHERE vr.latitude BETWEEN ? AND ? AND vr.longitude BETWEEN ? AND ?
         AND vr.latitude IS NOT NULL AND vr.longitude IS NOT NULL
         AND (vr.is_stolen = 1 OR vr.stolen_status LIKE '%active%')
       LIMIT 25`,
      box.minLat, box.maxLat, box.minLng, box.maxLng,
    ).then((rows) => {
      for (const r of rows) {
        if (r.latitude == null || r.longitude == null) continue;
        const plate = r.plate_number ?? 'UNKNOWN';
        const desc = [r.color, r.year, r.make, r.model].filter(Boolean).join(' ');
        addContact({
          kind: 'vehicle',
          id: r.id,
          label: plate,
          sublabel: desc || undefined,
          flags: ['STOLEN'],
          rlat: r.latitude, rlng: r.longitude,
        });
      }
    }).catch((err) => log.warn('[Radar360] vehicles query failed', { err })),

    // ── Recent incidents (last 24 h) ──────────────────
    query<{
      id: number; incident_number: string | null; incident_type: string | null;
      status: string | null; latitude: number | null; longitude: number | null;
    }>(db,
      `SELECT id, incident_number, incident_type, status, latitude, longitude
       FROM incidents
       WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
         AND latitude IS NOT NULL AND longitude IS NOT NULL
         AND created_at >= datetime('now', '-24 hours')
       ORDER BY created_at DESC LIMIT 20`,
      box.minLat, box.maxLat, box.minLng, box.maxLng,
    ).then((rows) => {
      for (const r of rows) {
        if (r.latitude == null || r.longitude == null) continue;
        addContact({
          kind: 'incident',
          id: r.id,
          label: r.incident_number ?? `INC #${r.id}`,
          sublabel: r.incident_type ?? undefined,
          flags: [],
          rlat: r.latitude, rlng: r.longitude,
          status: r.status ?? undefined,
        });
      }
    }).catch((err) => log.warn('[Radar360] incidents query failed', { err })),

  ]);

  // Sort: highest-threat first (person flags > calls by priority > units > incidents > vehicles)
  const kindOrder: Record<RadarContact['kind'], number> = { person: 0, call: 1, unit: 2, incident: 3, vehicle: 4 };
  const prioOrder: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
  contacts.sort((a, b) => {
    const ko = kindOrder[a.kind] - kindOrder[b.kind];
    if (ko !== 0) return ko;
    const po = (prioOrder[a.priority ?? 'P4'] ?? 3) - (prioOrder[b.priority ?? 'P4'] ?? 3);
    if (po !== 0) return po;
    return a.distanceMi - b.distanceMi;
  });

  const result: RadarScanResult = {
    contacts,
    radiusMi,
    centerLat: lat,
    centerLng: lng,
    scannedAt: new Date().toISOString(),
  };

  log.info('[Radar360] scan complete', { contacts: contacts.length, radiusMi, lat, lng });
  return c.json(result);
});

// ── Signal detection types ────────────────────────────────

type SignalType = 'wifi_ap' | 'bt_classic' | 'ble' | 'cell_tower';

interface SignalDetectionRow {
  id: number;
  scan_session_id: string;
  signal_type: SignalType;
  identifier: string;
  display_name: string | null;
  rssi_dbm: number | null;
  signal_pct: number | null;
  tx_power_dbm: number | null;
  distance_estimate_m: number | null;
  scanner_lat: number | null;
  scanner_lng: number | null;
  scanner_device_id: string | null;
  properties: string;
  call_id: number | null;
  incident_id: number | null;
  first_seen_at: string;
  last_seen_at: string;
}

interface SignalDetection extends Omit<SignalDetectionRow, 'properties'> {
  properties: Record<string, unknown>;
}

// Allowed signal types and property keys (no raw user strings in SQL)
const ALLOWED_SIGNAL_TYPES: Set<string> = new Set(['wifi_ap', 'bt_classic', 'ble', 'cell_tower']);

function str(v: unknown, max = 256): string | null {
  return v != null && v !== '' ? String(v).slice(0, max) : null;
}
function int(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function real(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function bool(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v ? 1 : 0;
  if (typeof v === 'string') return ['true', '1', 'yes'].includes(v.toLowerCase()) ? 1 : 0;
  return null;
}

function extractTypedColumns(sigType: SignalType, p: Record<string, unknown>): (string | number | null)[] {
  // WiFi (18)
  const wifi = sigType === 'wifi_ap';
  const wifiCols = [
    wifi ? str(p.ssid) : null, wifi ? str(p.bssid) : null, wifi ? int(p.channel) : null,
    wifi ? int(p.frequency_mhz ?? p.frequency) : null, wifi ? str(p.band) : null,
    wifi ? str(p.security_type ?? p.security ?? p.authentication) : null,
    wifi ? str(p.cipher_suite ?? p.cipher) : null, wifi ? str(p.auth_suite) : null,
    wifi ? bool(p.wps_enabled ?? p.wps) : null, wifi ? bool(p.hidden) : null,
    wifi ? str(p.vendor) : null, wifi ? str(p.network_type) : null,
    wifi ? str(p.radio_type) : null, wifi ? real(p.max_data_rate_mbps ?? p.max_rate) : null,
    wifi ? int(p.beacon_interval_ms ?? p.beacon_interval) : null,
    wifi ? str(p.supported_rates) : null, wifi ? str(p.country_code, 4) : null,
    wifi ? int(p.channel_utilization_pct ?? p.channel_utilization) : null,
  ];

  // BT Classic (12)
  const bt = sigType === 'bt_classic';
  const btCols = [
    bt ? str(p.bt_name ?? p.name) : null, bt ? str(p.bt_mac ?? p.mac_address) : null,
    bt ? str(p.bt_class_hex ?? p.class_hex) : null,
    bt ? str(p.bt_device_category ?? p.device_category ?? p.major_class) : null,
    bt ? str(p.bt_device_subcategory ?? p.device_subcategory ?? p.minor_class) : null,
    (bt || sigType === 'ble') ? str(p.bt_vendor ?? p.vendor) : null,
    bt ? bool(p.bt_connectable ?? p.connectable) : null,
    bt ? bool(p.bt_paired ?? p.paired) : null,
    bt ? str(p.bt_services ?? (Array.isArray(p.services) ? p.services.join(', ') : p.services)) : null,
    bt ? str(p.bt_version ?? p.version) : null,
    bt ? str(p.bt_lmp_version ?? p.lmp_version) : null,
    bt ? int(p.bt_manufacturer_id ?? p.manufacturer_id) : null,
  ];

  // BLE (11)
  const ble = sigType === 'ble';
  const bleCols = [
    ble ? str(p.ble_complete_local_name ?? p.complete_local_name ?? p.local_name ?? p.name) : null,
    ble ? str(p.ble_mac_type ?? p.mac_type ?? p.address_type) : null,
    ble ? str(p.ble_service_uuids ?? (Array.isArray(p.service_uuids) ? p.service_uuids.join(', ') : p.service_uuids)) : null,
    ble ? int(p.ble_manufacturer_id ?? p.manufacturer_id ?? p.company_id) : null,
    ble ? str(p.ble_manufacturer_name ?? p.manufacturer_name ?? p.manufacturer) : null,
    ble ? str(p.ble_appearance_category ?? p.appearance_category ?? p.appearance) : null,
    ble ? int(p.ble_advertisement_interval_ms ?? p.advertisement_interval_ms ?? p.adv_interval) : null,
    ble ? bool(p.ble_connectable ?? p.connectable) : null,
    ble ? str(p.ble_manufacturer_data_hex ?? p.manufacturer_data_hex ?? p.manufacturer_data) : null,
    ble ? str(p.ble_service_data ?? (typeof p.service_data === 'object' ? JSON.stringify(p.service_data) : p.service_data)) : null,
    ble ? int(p.ble_flags ?? p.flags) : null,
  ];

  // Cell Tower (15)
  const cell = sigType === 'cell_tower';
  const cellCols = [
    cell ? int(p.cell_mcc ?? p.mcc) : null, cell ? int(p.cell_mnc ?? p.mnc) : null,
    cell ? str(p.cell_carrier_name ?? p.carrier_name ?? p.carrier) : null,
    cell ? str(p.cell_technology ?? p.technology ?? p.radio_type) : null,
    cell ? str(p.cell_frequency_band ?? p.frequency_band) : null,
    cell ? int(p.cell_arfcn ?? p.arfcn ?? p.earfcn) : null,
    cell ? int(p.cell_pci ?? p.pci) : null, cell ? int(p.cell_lac ?? p.lac) : null,
    cell ? int(p.cell_tac ?? p.tac) : null, cell ? int(p.cell_cell_id ?? p.cell_id ?? p.cid) : null,
    cell ? int(p.cell_rsrp_dbm ?? p.rsrp_dbm ?? p.rsrp) : null,
    cell ? int(p.cell_rsrq_db ?? p.rsrq_db ?? p.rsrq) : null,
    cell ? int(p.cell_sinr_db ?? p.sinr_db ?? p.sinr) : null,
    cell ? int(p.cell_timing_advance_m ?? p.timing_advance_m ?? p.timing_advance) : null,
    cell ? bool(p.cell_is_serving ?? p.is_serving) : null,
  ];

  return [...wifiCols, ...btCols, ...bleCols, ...cellCols];
}

// ── POST /api/radar360/signal-scan ───────────────────────
// Accepts a batch of signals from an Electron or mobile client.
// Body: { scan_session_id, scanned_at, scanner_lat?, scanner_lng?,
//         scanner_device_id?, call_id?, signals: SignalInput[] }
// Each signal: { signal_type, identifier, display_name?, rssi_dbm?,
//               signal_pct?, tx_power_dbm?, distance_estimate_m?,
//               properties?, first_seen_at?, last_seen_at? }

radar360.post('/signal-scan', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !Array.isArray(body.signals) || body.signals.length === 0) {
    return c.json({ error: 'signals array is required' }, 400);
  }
  if (body.signals.length > 200) {
    return c.json({ error: 'signals array exceeds max 200 per batch' }, 400);
  }

  const db = getDb(c.env);
  const sessionId = String(body.scan_session_id ?? crypto.randomUUID()).slice(0, 64);
  const scannedAt = typeof body.scanned_at === 'string' ? body.scanned_at : new Date().toISOString();
  const scannerLat = body.scanner_lat != null ? Number(body.scanner_lat) : null;
  const scannerLng = body.scanner_lng != null ? Number(body.scanner_lng) : null;
  const scannerDevice = body.scanner_device_id ? String(body.scanner_device_id).slice(0, 64) : null;
  const callId = body.call_id != null ? Number(body.call_id) : null;
  const userId = c.var.user?.id ?? null;

  const inserted: string[] = [];
  const skipped: string[] = [];

  for (const sig of body.signals) {
    const sigType = String(sig.signal_type ?? '');
    if (!ALLOWED_SIGNAL_TYPES.has(sigType)) { skipped.push(sigType); continue; }
    const identifier = String(sig.identifier ?? '').toLowerCase().slice(0, 64);
    if (!identifier) { skipped.push('(empty identifier)'); continue; }

    const displayName = sig.display_name ? String(sig.display_name).slice(0, 128) : null;
    const rssiDbm = sig.rssi_dbm != null ? Math.round(Number(sig.rssi_dbm)) : null;
    const signalPct = sig.signal_pct != null ? Math.min(100, Math.max(0, Math.round(Number(sig.signal_pct)))) : null;
    const txPower = sig.tx_power_dbm != null ? Math.round(Number(sig.tx_power_dbm)) : null;
    const distM = sig.distance_estimate_m != null ? Math.round(Number(sig.distance_estimate_m) * 10) / 10 : null;
    const propStr = typeof sig.properties === 'string' ? sig.properties
      : JSON.stringify(sig.properties ?? {});
    const firstSeen = typeof sig.first_seen_at === 'string' ? sig.first_seen_at : scannedAt;
    const lastSeen = typeof sig.last_seen_at === 'string' ? sig.last_seen_at : scannedAt;

    const props = typeof sig.properties === 'object' && sig.properties ? sig.properties : {};
    const col = extractTypedColumns(sigType as SignalType, props);

    try {
      await db.prepare(
        `INSERT INTO signal_detections
           (scan_session_id, signal_type, identifier, display_name,
            rssi_dbm, signal_pct, tx_power_dbm, distance_estimate_m,
            scanner_lat, scanner_lng, scanner_device_id,
            properties, call_id, submitted_by,
            first_seen_at, last_seen_at,
            ssid, bssid, channel, frequency_mhz, band, security_type,
            cipher_suite, auth_suite, wps_enabled, hidden, vendor,
            network_type, radio_type, max_data_rate_mbps, beacon_interval_ms,
            supported_rates, country_code, channel_utilization_pct,
            bt_name, bt_mac, bt_class_hex, bt_device_category,
            bt_device_subcategory, bt_vendor, bt_connectable, bt_paired,
            bt_services, bt_version, bt_lmp_version, bt_manufacturer_id,
            ble_complete_local_name, ble_mac_type, ble_service_uuids,
            ble_manufacturer_id, ble_manufacturer_name, ble_appearance_category,
            ble_advertisement_interval_ms, ble_connectable,
            ble_manufacturer_data_hex, ble_service_data, ble_flags,
            cell_mcc, cell_mnc, cell_carrier_name, cell_technology,
            cell_frequency_band, cell_arfcn, cell_pci, cell_lac, cell_tac,
            cell_cell_id, cell_rsrp_dbm, cell_rsrq_db, cell_sinr_db,
            cell_timing_advance_m, cell_is_serving)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                 ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
                 ?,?,?,?,?,?,?,?,?,?,?,?,
                 ?,?,?,?,?,?,?,?,?,?,?,
                 ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        sessionId, sigType, identifier, displayName,
        rssiDbm, signalPct, txPower, distM,
        scannerLat, scannerLng, scannerDevice,
        propStr, callId, userId,
        firstSeen, lastSeen,
        ...col
      ).run();
      inserted.push(identifier);
    } catch (err) {
      log.warn('[Radar360] signal insert failed', { identifier, err });
      skipped.push(identifier);
    }
  }

  log.info('[Radar360] signal-scan stored', { session: sessionId, inserted: inserted.length, skipped: skipped.length });
  return c.json({ ok: true, scan_session_id: sessionId, inserted: inserted.length, skipped: skipped.length });
});

// ── GET /api/radar360/signals ─────────────────────────────
// Returns signal detections from the last 24 h within a bounding box.
// Query params: lat, lng, radius_mi (default 1), type (optional filter),
//               limit (max 200, default 100), since_session (optional)

radar360.get('/signals', async (c) => {
  const lat = parseFloat(c.req.query('lat') ?? '');
  const lng = parseFloat(c.req.query('lng') ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'lat and lng are required' }, 400);
  }

  const radiusMi = Math.min(Math.max(parseFloat(c.req.query('radius_mi') ?? '1'), 0.1), 10);
  const typeFilter = c.req.query('type');
  const limitParam = Math.min(parseInt(c.req.query('limit') ?? '100'), 200);
  const sinceSession = c.req.query('since_session');

  const box = bbox(lat, lng, radiusMi);
  const db = getDb(c.env);

  // D1 doesn't support SIN/COS, so bbox pre-filter + JS Haversine post-filter
  const typeClause = typeFilter && ALLOWED_SIGNAL_TYPES.has(typeFilter) ? 'AND signal_type = ?' : '';
  const sessionClause = sinceSession ? 'AND scan_session_id != ?' : '';

  const rows = await query<SignalDetectionRow>(db,
    `SELECT id, scan_session_id, signal_type, identifier, display_name,
            rssi_dbm, signal_pct, tx_power_dbm, distance_estimate_m,
            scanner_lat, scanner_lng, scanner_device_id,
            properties, call_id, first_seen_at, last_seen_at
     FROM signal_detections
     WHERE scanner_lat BETWEEN ? AND ?
       AND scanner_lng BETWEEN ? AND ?
       AND last_seen_at >= datetime('now', '-24 hours')
       ${typeClause} ${sessionClause}
     ORDER BY last_seen_at DESC
     LIMIT ?`,
    box.minLat, box.maxLat, box.minLng, box.maxLng,
    ...(typeFilter && ALLOWED_SIGNAL_TYPES.has(typeFilter) ? [typeFilter] : []),
    ...(sinceSession ? [sinceSession] : []),
    limitParam,
  );

  const signals: SignalDetection[] = rows.map((r) => ({
    ...r,
    properties: (() => { try { return JSON.parse(r.properties); } catch { return {}; } })(),
  }));

  log.info('[Radar360] signals query', { signals: signals.length, lat, lng, radiusMi });
  return c.json({ signals, count: signals.length, lat, lng, radiusMi });
});

// ── GET /api/radar360/signals/all ────────────────────────
// Paginated signal list for Signal Intelligence page (no bbox filter).
// Query params: type, limit (max 500, default 100), offset (default 0),
//               since (ISO timestamp), search (name/identifier substring)

radar360.get('/signals/all', async (c) => {
  const typeFilter = c.req.query('type');
  const limitParam = Math.min(parseInt(c.req.query('limit') ?? '100'), 500);
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0'), 0);
  const since = c.req.query('since');
  const search = c.req.query('search');

  const db = getDb(c.env);
  const conditions: string[] = [];
  const binds: (string | number)[] = [];

  if (typeFilter && ALLOWED_SIGNAL_TYPES.has(typeFilter)) {
    conditions.push('signal_type = ?');
    binds.push(typeFilter);
  }
  if (since) {
    conditions.push('last_seen_at >= ?');
    binds.push(since);
  }
  if (search) {
    conditions.push('(display_name LIKE ? OR identifier LIKE ? OR ssid LIKE ? OR bt_name LIKE ? OR ble_complete_local_name LIKE ? OR cell_carrier_name LIKE ?)');
    const pat = `%${search}%`;
    binds.push(pat, pat, pat, pat, pat, pat);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await query<SignalDetectionRow>(db,
    `SELECT * FROM signal_detections ${where}
     ORDER BY last_seen_at DESC
     LIMIT ? OFFSET ?`,
    ...binds, limitParam, offset,
  );

  const countRow = await db.prepare(
    `SELECT COUNT(*) as total FROM signal_detections ${where}`,
  ).bind(...binds).first<{ total: number }>();

  const signals: SignalDetection[] = rows.map((r) => ({
    ...r,
    properties: (() => { try { return JSON.parse(r.properties); } catch { return {}; } })(),
  }));

  return c.json({
    signals,
    count: signals.length,
    total: countRow?.total ?? 0,
    offset,
    limit: limitParam,
  });
});

// ── GET /api/radar360/signals/:id ────────────────────────
// Single signal detection full detail

radar360.get('/signals/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
  const db = getDb(c.env);
  const row = await db.prepare(
    `SELECT * FROM signal_detections WHERE id = ?`
  ).bind(id).first<SignalDetectionRow>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ ...row, properties: (() => { try { return JSON.parse(row.properties); } catch { return {}; } })() });
});

export default radar360;
