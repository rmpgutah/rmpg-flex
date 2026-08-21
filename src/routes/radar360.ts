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

    // ── Persons with active flags (warrants, officer safety, etc.) ──
    query<{
      id: number; first_name: string | null; last_name: string | null;
      latitude: number | null; longitude: number | null;
      has_warrant: number | null; officer_safety: number | null;
      gang_affiliation: string | null; sex_offender: number | null;
    }>(db,
      `SELECT id, first_name, last_name, latitude, longitude,
              has_warrant, officer_safety, gang_affiliation, sex_offender
       FROM persons
       WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
         AND latitude IS NOT NULL AND longitude IS NOT NULL
         AND (has_warrant = 1 OR officer_safety = 1 OR gang_affiliation IS NOT NULL OR sex_offender = 1)
       ORDER BY officer_safety DESC, has_warrant DESC LIMIT 30`,
      box.minLat, box.maxLat, box.minLng, box.maxLng,
    ).then((rows) => {
      for (const r of rows) {
        if (r.latitude == null || r.longitude == null) continue;
        const flags: string[] = [];
        if (r.officer_safety) flags.push('OFFICER SAFETY');
        if (r.has_warrant) flags.push('WARRANT');
        if (r.gang_affiliation) flags.push('GANG');
        if (r.sex_offender) flags.push('SEX OFFENDER');
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

export default radar360;
