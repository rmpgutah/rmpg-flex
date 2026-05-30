// ============================================================
// RMPG Flex — Dispatch Extensions (lean API, Spillman-parity gaps)
// ============================================================
// Adds the dispatch features that existed on the legacy Express
// server but never made it into the lean API:
//   - DEV-1: closest-unit recommendation (DI-2)
//   - DEV-2: per-unit audio mode (DI-5)
//   - DEV-3: premise_alerts CRUD (data layer for DI-3 auto-push)
//   - DEV-4: call warnings aggregation (premise + person + warrant)
//   - DEV-5: unit status change
//   - DEV-6: BOLO CRUD
//   - DEV-7: active welfare watches list (supervisor view)
//
// Mounted by src/index.ts under multiple prefixes — each handler
// is on its own Hono so it can mount cleanly under /api/dispatch
// or /api/dispatch/units etc.
// ============================================================

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { requireRole } from '../../middleware/auth';
import { broadcastAll } from '../ws';

const READ_ROLES  = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'];
const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'dispatcher'];
const ADMIN_ROLES = ['admin', 'manager'];

// ─── Helpers ─────────────────────────────────────────────
const EARTH_RADIUS_M = 6371000;
const toRad = (deg: number) => deg * Math.PI / 180;
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const AVG_URBAN_SPEED_MPH = 25;

// ─── GPS freshness ────────────────────────────────────────
// A unit's last fix can be minutes old (lost signal, parked in a garage,
// app backgrounded). Recommending or auto-dispatching a unit whose
// position is stale sends responders to a guess. We compute the age of
// units.gps_updated_at and prefer FRESH units; stale ones are flagged so
// the dispatcher (and the AI) never treat an old fix as current.
const GPS_FRESH_WINDOW_S = 180; // 3 min — default "fresh" cutoff

/** Parse a D1 timestamp ('YYYY-MM-DD HH:MM:SS' UTC, or ISO) to epoch ms. */
function parseUtcMs(ts: string): number {
  let s = ts.trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z'; // stored value is UTC
  return Date.parse(s);
}

/** Age of a GPS fix in seconds; null when never reported / unparseable. */
function gpsAgeSeconds(ts: string | null | undefined, nowMs: number): number | null {
  if (!ts) return null;
  const ms = parseUtcMs(ts);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((nowMs - ms) / 1000));
}

// =====================================================================
// DEV-1: Closest-unit recommendation (DI-2)
// GET /api/dispatch/calls/:id/recommended-units?limit=N
// Mounted under /api/dispatch/calls (alongside existing calls router).
// =====================================================================
export const recommendedUnits = new Hono<Env>();

recommendedUnits.get('/:id/recommended-units', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);
    const call = await queryFirst<{ id: number; call_number: string; latitude: number | null; longitude: number | null; priority: string }>(
      db, 'SELECT id, call_number, latitude, longitude, priority FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
    if (call.latitude == null || call.longitude == null) {
      return c.json({ callId: id, callNumber: call.call_number, recommended: [], reason: 'NO_CALL_GPS' });
    }

    const limit = Math.min(25, Math.max(1, parseInt(c.req.query('limit') || '5', 10)));
    // Caller may widen/narrow the "fresh" window (seconds); default 3 min.
    const freshWindow = Math.min(3600, Math.max(15,
      parseInt(c.req.query('freshWindow') || String(GPS_FRESH_WINDOW_S), 10)));

    // Pull available units with GPS + last-fix timestamp. Lean schema stores
    // lat/lng directly on units. Filter to available + dispatched-but-near
    // statuses so the dispatcher sees who could be repurposed.
    const units = await query<{
      id: number; call_sign: string; status: string; officer_id: number | null;
      latitude: number | null; longitude: number | null; current_call_id: number | null;
      officer_name: string | null; badge_number: string | null; gps_updated_at: string | null;
    }>(db, `
      SELECT u.id, u.call_sign, u.status, u.officer_id,
             u.latitude, u.longitude, u.current_call_id, u.gps_updated_at,
             usr.full_name AS officer_name, usr.badge_number
      FROM units u
      LEFT JOIN users usr ON usr.id = u.officer_id
      WHERE u.status IN ('available', 'on_patrol', 'dispatched')
        AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
    `);

    const now = Date.now();
    const ranked = units.map((u) => {
      const distM = haversineMeters(call.latitude!, call.longitude!, u.latitude!, u.longitude!);
      const distMi = distM / 1609.34;
      const ageS = gpsAgeSeconds(u.gps_updated_at, now);
      const stale = ageS == null || ageS > freshWindow;
      return {
        unit_id: u.id,
        callSign: u.call_sign,
        status: u.status,
        officerName: u.officer_name,
        badgeNumber: u.badge_number,
        currentCallId: u.current_call_id,
        distanceMeters: Math.round(distM),
        distanceMiles: Math.round(distMi * 10) / 10,
        etaMinutes: Math.round((distMi / AVG_URBAN_SPEED_MPH) * 60 * 10) / 10,
        gpsAgeSeconds: ageS,
        gpsStale: stale,
      };
    })
      // Fresh units first (a 0.5 mi unit with a 20-min-old fix is NOT closer
      // than a 2 mi unit reporting live), then by distance within each group.
      .sort((a, b) => (a.gpsStale === b.gpsStale)
        ? a.distanceMeters - b.distanceMeters
        : (a.gpsStale ? 1 : -1))
      .slice(0, limit);

    const freshCount = ranked.filter((r) => !r.gpsStale).length;

    return c.json({
      callId: id,
      callNumber: call.call_number,
      callPriority: call.priority,
      callLat: call.latitude,
      callLng: call.longitude,
      freshWindowSeconds: freshWindow,
      freshCount,
      recommended: ranked,
      ...(freshCount === 0 ? { reason: 'NO_FRESH_UNITS' } : {}),
    });
  } catch (err) {
    console.error('[dispatch] recommended-units error', err);
    return c.json({ error: 'Failed to compute recommended units', code: 'RECOMMEND_ERR' }, 500);
  }
});

// =====================================================================
// DEV-2: Audio mode (DI-5)
// GET /api/dispatch/units/mine/audio-mode
// PUT /api/dispatch/units/:id/audio-mode
// Mounted under /api/dispatch/units (alongside existing units router).
// =====================================================================
export const audioMode = new Hono<Env>();
const VALID_AUDIO_MODES = ['audible', 'silent', 'vibrate'];

audioMode.get('/mine/audio-mode', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const row = await queryFirst<{ id: number; call_sign: string; audio_mode: string | null }>(
      db, 'SELECT id, call_sign, audio_mode FROM units WHERE officer_id = ?', userId);
    if (!row) return c.json({ unit_id: null, call_sign: null, audio_mode: 'audible' });
    return c.json({ unit_id: row.id, call_sign: row.call_sign, audio_mode: row.audio_mode || 'audible' });
  } catch (err) {
    console.error('[dispatch] mine/audio-mode error', err);
    return c.json({ error: 'Failed to fetch audio mode', code: 'AUDIO_MODE_GET_ERR' }, 500);
  }
});

audioMode.put('/:id/audio-mode', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as any;
    const unitId = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(unitId) || unitId <= 0) return c.json({ error: 'Invalid unit id', code: 'INVALID_ID' }, 400);
    const body = await c.req.json().catch(() => ({} as any));
    const mode = String(body.audio_mode || '').toLowerCase();
    if (!VALID_AUDIO_MODES.includes(mode)) {
      return c.json({ error: `audio_mode must be one of ${VALID_AUDIO_MODES.join(', ')}`, code: 'INVALID_AUDIO_MODE' }, 400);
    }
    const unit = await queryFirst<{ id: number; officer_id: number | null }>(db, 'SELECT id, officer_id FROM units WHERE id = ?', unitId);
    if (!unit) return c.json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }, 404);

    // Officers can only change their own unit; supervisors+ can change any
    const canForce = ['admin', 'manager', 'supervisor', 'dispatcher'].includes(user.role);
    if (!canForce && unit.officer_id !== user.id) {
      return c.json({ error: 'Officers may only change their own unit audio mode', code: 'FORBIDDEN_NOT_OWN_UNIT' }, 403);
    }

    await execute(db, "UPDATE units SET audio_mode = ?, updated_at = datetime('now') WHERE id = ?", mode, unitId);
    return c.json({ success: true, unit_id: unitId, audio_mode: mode });
  } catch (err) {
    console.error('[dispatch] PUT audio-mode error', err);
    return c.json({ error: 'Failed to update audio mode', code: 'AUDIO_MODE_SET_ERR' }, 500);
  }
});

// PUT /:id/mileage — CAD "MI" command sets a unit's odometer reading.
// Neither legacy nor the rewrite implemented this before, so the CAD
// command 404'd. units.mileage is REAL; we accept a non-negative number.
audioMode.put('/:id/mileage', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const unitId = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(unitId) || unitId <= 0) return c.json({ error: 'Invalid unit id', code: 'INVALID_ID' }, 400);
    const body = await c.req.json().catch(() => ({} as any));
    const mileage = Number(body.mileage);
    if (!Number.isFinite(mileage) || mileage < 0) {
      return c.json({ error: 'mileage must be a non-negative number', code: 'INVALID_MILEAGE' }, 400);
    }
    const unit = await queryFirst<{ id: number }>(db, 'SELECT id FROM units WHERE id = ?', unitId);
    if (!unit) return c.json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }, 404);
    await execute(db, "UPDATE units SET mileage = ?, updated_at = datetime('now') WHERE id = ?", mileage, unitId);
    return c.json({ success: true, unit_id: unitId, mileage });
  } catch (err) {
    console.error('[dispatch] PUT mileage error', err);
    return c.json({ error: 'Failed to update mileage', code: 'MILEAGE_SET_ERR' }, 500);
  }
});

// =====================================================================
// DEV-3: Premise alerts CRUD (data layer for DI-3 auto-push)
// /api/dispatch/premise-alerts
// =====================================================================
export const premiseAlerts = new Hono<Env>();
const VALID_ALERT_LEVELS = ['info', 'warning', 'critical'];

premiseAlerts.get('/', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const activeOnly = c.req.query('active') !== '0';
    const rows = await query<Record<string, unknown>>(db, `
      SELECT pa.*, u.full_name AS created_by_name
      FROM premise_alerts pa
      LEFT JOIN users u ON u.id = pa.created_by
      ${activeOnly ? "WHERE pa.active = 1 AND (pa.expires_at IS NULL OR pa.expires_at >= datetime('now'))" : ''}
      ORDER BY pa.alert_level = 'critical' DESC, pa.alert_level = 'warning' DESC, pa.created_at DESC
    `);
    return c.json(rows.map((r) => ({ ...r, flags: safeJson(r.flags as string, []) })));
  } catch (err) {
    console.error('[dispatch] premise-alerts list error', err);
    return c.json({ error: 'Failed to list premise alerts', code: 'PA_LIST_ERR' }, 500);
  }
});

premiseAlerts.get('/:id', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const row = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM premise_alerts WHERE id = ?', id);
    if (!row) return c.json({ error: 'Premise alert not found', code: 'PA_NOT_FOUND' }, 404);
    return c.json({ ...row, flags: safeJson(row.flags as string, []) });
  } catch (err) {
    console.error('[dispatch] premise-alerts get error', err);
    return c.json({ error: 'Failed to fetch premise alert', code: 'PA_GET_ERR' }, 500);
  }
});

premiseAlerts.post('/', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const body = await c.req.json().catch(() => ({} as any));
    const address = String(body.address || '').trim();
    const title = String(body.title || '').trim();
    const alert_level = String(body.alert_level || 'info').toLowerCase();
    if (!address || !title) return c.json({ error: 'address and title are required', code: 'PA_MISSING_FIELDS' }, 400);
    if (!VALID_ALERT_LEVELS.includes(alert_level)) {
      return c.json({ error: `alert_level must be one of ${VALID_ALERT_LEVELS.join(', ')}`, code: 'PA_INVALID_LEVEL' }, 400);
    }

    const result = await execute(db, `
      INSERT INTO premise_alerts
        (address, latitude, longitude, alert_type, alert_level, title, description,
         flags, expires_at, created_by, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      address,
      body.latitude != null ? Number(body.latitude) : null,
      body.longitude != null ? Number(body.longitude) : null,
      body.alert_type || 'caution',
      alert_level,
      title,
      body.description || null,
      JSON.stringify(Array.isArray(body.flags) ? body.flags : []),
      body.expires_at || null,
      userId);
    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM premise_alerts WHERE id = ?', result.meta.last_row_id);
    return c.json({ ...created, flags: safeJson(created?.flags as string, []) }, 201);
  } catch (err) {
    console.error('[dispatch] premise-alerts create error', err);
    return c.json({ error: 'Failed to create premise alert', code: 'PA_CREATE_ERR' }, 500);
  }
});

premiseAlerts.put('/:id', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const before = await queryFirst<any>(db, 'SELECT * FROM premise_alerts WHERE id = ?', id);
    if (!before) return c.json({ error: 'Premise alert not found', code: 'PA_NOT_FOUND' }, 404);

    const b = await c.req.json().catch(() => ({} as any));
    const alert_level = b.alert_level ? String(b.alert_level).toLowerCase() : before.alert_level;
    if (!VALID_ALERT_LEVELS.includes(alert_level)) {
      return c.json({ error: `alert_level must be one of ${VALID_ALERT_LEVELS.join(', ')}`, code: 'PA_INVALID_LEVEL' }, 400);
    }
    await execute(db, `
      UPDATE premise_alerts SET
        address = ?, latitude = ?, longitude = ?, alert_type = ?, alert_level = ?,
        title = ?, description = ?, flags = ?, expires_at = ?, active = ?,
        updated_at = datetime('now')
      WHERE id = ?`,
      b.address ?? before.address,
      b.latitude !== undefined ? (b.latitude != null ? Number(b.latitude) : null) : before.latitude,
      b.longitude !== undefined ? (b.longitude != null ? Number(b.longitude) : null) : before.longitude,
      b.alert_type ?? before.alert_type,
      alert_level,
      b.title ?? before.title,
      b.description !== undefined ? (b.description || null) : before.description,
      Array.isArray(b.flags) ? JSON.stringify(b.flags) : before.flags,
      b.expires_at !== undefined ? (b.expires_at || null) : before.expires_at,
      b.active != null ? (b.active ? 1 : 0) : before.active,
      id);
    const after = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM premise_alerts WHERE id = ?', id);
    return c.json({ ...after, flags: safeJson(after?.flags as string, []) });
  } catch (err) {
    console.error('[dispatch] premise-alerts update error', err);
    return c.json({ error: 'Failed to update premise alert', code: 'PA_UPDATE_ERR' }, 500);
  }
});

premiseAlerts.delete('/:id', requireRole(...ADMIN_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const before = await queryFirst(db, 'SELECT * FROM premise_alerts WHERE id = ?', id);
    if (!before) return c.json({ error: 'Premise alert not found', code: 'PA_NOT_FOUND' }, 404);
    await execute(db, 'DELETE FROM premise_alerts WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    console.error('[dispatch] premise-alerts delete error', err);
    return c.json({ error: 'Failed to delete premise alert', code: 'PA_DELETE_ERR' }, 500);
  }
});

// GET /api/dispatch/premise-alerts/near?lat=&lng=&radius=  — proximity lookup
premiseAlerts.get('/near/scan', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const lat = parseFloat(c.req.query('lat') || '');
    const lng = parseFloat(c.req.query('lng') || '');
    const radius = Math.min(5000, Math.max(10, parseInt(c.req.query('radius') || '50', 10)));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return c.json({ error: 'lat and lng required (numeric)', code: 'PA_BAD_COORDS' }, 400);
    }
    const dLat = radius / 111000;
    const dLng = radius / (111000 * Math.max(0.01, Math.cos(toRad(lat))));
    const candidates = await query<any>(db, `
      SELECT * FROM premise_alerts
      WHERE active = 1
        AND latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
        AND (expires_at IS NULL OR expires_at >= datetime('now'))`,
      lat - dLat, lat + dLat, lng - dLng, lng + dLng);
    const within = candidates
      .map((p: any) => ({ ...p, flags: safeJson(p.flags, []), distance_meters: Math.round(haversineMeters(lat, lng, p.latitude, p.longitude)) }))
      .filter((p: any) => p.distance_meters <= radius)
      .sort((a: any, b: any) => a.distance_meters - b.distance_meters);
    return c.json({ count: within.length, radius_meters: radius, alerts: within });
  } catch (err) {
    console.error('[dispatch] premise-alerts/near error', err);
    return c.json({ error: 'Failed to scan premise alerts', code: 'PA_SCAN_ERR' }, 500);
  }
});

// =====================================================================
// DEV-4: Call warnings (aggregated safety briefing)
// GET /api/dispatch/calls/:id/warnings
// =====================================================================
export const callWarnings = new Hono<Env>();

callWarnings.get('/:id/warnings', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);
    const base = await queryFirst<any>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    if (!base) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
    // Tactical flags overflowed to calls_for_service_ext when the base table hit
    // the D1 100-col cap (see calls.ts UPDATABLE_CALL_COLUMNS_EXT). The write path
    // stores e.g. `hazmat` in ext, so the safety briefing must merge ext over base
    // — same precedence as GET /calls/:id — or those flags read as stale 0.
    let ext: Record<string, unknown> | null = null;
    try { ext = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service_ext WHERE id = ?', id); }
    catch { /* ext table may not exist in dev */ }
    const call = { ...base, ...(ext || {}) };

    const warnings: Array<{ type: string; label: string; severity: 'critical' | 'high' | 'medium'; source: string }> = [];

    // ── Call flags ──
    if (call.weapons_involved && !['', '0', 'none', 'None'].includes(String(call.weapons_involved))) {
      warnings.push({ type: 'ARMED', label: 'ARMED / WEAPONS', severity: 'critical', source: 'call' });
    }
    if (call.domestic_violence) warnings.push({ type: 'DV', label: 'DOMESTIC VIOLENCE', severity: 'high', source: 'call' });
    if (call.injuries_reported) warnings.push({ type: 'INJURIES', label: 'INJURIES REPORTED', severity: 'high', source: 'call' });
    if (call.alcohol_involved) warnings.push({ type: 'ALCOHOL', label: 'ALCOHOL INVOLVED', severity: 'medium', source: 'call' });
    if (call.drugs_involved) warnings.push({ type: 'DRUGS', label: 'DRUGS INVOLVED', severity: 'medium', source: 'call' });
    if (call.mental_health_crisis) warnings.push({ type: 'MENTAL_HEALTH', label: 'MENTAL HEALTH CRISIS', severity: 'high', source: 'call' });
    if (call.officer_safety_caution) warnings.push({ type: 'OFC_SAFETY', label: 'OFFICER SAFETY CAUTION', severity: 'critical', source: 'call' });
    if (call.hazmat) warnings.push({ type: 'HAZMAT', label: 'HAZMAT', severity: 'critical', source: 'call' });

    // ── Premise alerts within 50m ──
    if (call.latitude != null && call.longitude != null) {
      const dLat = 50 / 111000;
      const dLng = 50 / (111000 * Math.max(0.01, Math.cos(toRad(call.latitude))));
      try {
        const candidates = await query<any>(db, `
          SELECT id, address, latitude, longitude, alert_level, title, description
          FROM premise_alerts
          WHERE active = 1
            AND latitude BETWEEN ? AND ?
            AND longitude BETWEEN ? AND ?
            AND (expires_at IS NULL OR expires_at >= datetime('now'))`,
          call.latitude - dLat, call.latitude + dLat,
          call.longitude - dLng, call.longitude + dLng);
        for (const a of candidates) {
          const d = haversineMeters(call.latitude, call.longitude, a.latitude, a.longitude);
          if (d <= 50) {
            const sev: 'critical' | 'high' | 'medium' = a.alert_level === 'critical' ? 'critical' : a.alert_level === 'warning' ? 'high' : 'medium';
            warnings.push({
              type: 'PREMISE',
              label: `PREMISE: ${a.title}`.toUpperCase(),
              severity: sev,
              source: `${a.address} (${Math.round(d)}m)`,
            });
          }
        }
      } catch { /* premise_alerts may not exist in dev */ }
    }

    // ── Linked persons (incident_persons via incidents.call_id) ──
    try {
      const linkedPersons = await query<any>(db, `
        SELECT p.first_name, p.last_name
        FROM incident_persons ip
        JOIN persons p ON ip.person_id = p.id
        JOIN incidents i ON ip.incident_id = i.id
        WHERE i.call_id = ?
        LIMIT 100`, id);
      // The lean persons table may not have caution_flags / is_sex_offender / etc.
      // columns yet; surface presence as a soft hint only.
      if (linkedPersons.length > 0) {
        warnings.push({
          type: 'LINKED_PERSONS',
          label: `${linkedPersons.length} LINKED PERSON${linkedPersons.length !== 1 ? 'S' : ''}`,
          severity: 'medium',
          source: 'incident_persons',
        });
      }
    } catch { /* incidents may not be linked yet */ }

    // ── Active warrants for any linked person ──
    try {
      const warrants = await query<any>(db, `
        SELECT w.warrant_number, w.type, w.subject_person_id, p.first_name, p.last_name
        FROM warrants w
        LEFT JOIN persons p ON w.subject_person_id = p.id
        WHERE w.status = 'active'
          AND w.subject_person_id IN (
            SELECT ip.person_id FROM incident_persons ip
            JOIN incidents i ON ip.incident_id = i.id
            WHERE i.call_id = ?
          )
        LIMIT 50`, id);
      for (const w of warrants) {
        warnings.push({
          type: 'WARRANT',
          label: `ACTIVE WARRANT: ${(w.type || 'unknown').toUpperCase()}`,
          severity: 'critical',
          source: `${w.first_name || ''} ${w.last_name || ''}`.trim() || w.warrant_number,
        });
      }
    } catch { /* warrants schema variance */ }

    // ── Incident-type hints ──
    const itype = (call.incident_type || '').toLowerCase();
    if ((itype.includes('shooting') || itype.includes('shots_fired')) && !warnings.find((w) => w.type === 'ARMED')) {
      warnings.push({ type: 'ARMED', label: 'POSSIBLE WEAPONS', severity: 'critical', source: 'Incident type' });
    }
    if (itype.includes('hazmat') || itype.includes('bomb')) {
      if (!warnings.find((w) => w.type === 'HAZMAT')) {
        warnings.push({ type: 'HAZMAT', label: 'HAZMAT/EXPLOSIVES', severity: 'critical', source: 'Incident type' });
      }
    }
    if (itype.includes('barricade') || itype.includes('hostage') || itype.includes('standoff')) {
      warnings.push({ type: 'BARRICADE', label: 'BARRICADED SUBJECT', severity: 'critical', source: 'Incident type' });
    }

    return c.json(warnings);
  } catch (err) {
    console.error('[dispatch] warnings error', err);
    return c.json({ error: 'Failed to compute warnings', code: 'WARN_ERR' }, 500);
  }
});

// =====================================================================
// DEV-5: Unit status change
// PUT /api/dispatch/units/:id/status
// =====================================================================
export const unitStatus = new Hono<Env>();
const VALID_UNIT_STATUSES = ['available', 'dispatched', 'enroute', 'onscene', 'busy', 'off_duty', 'out_of_service', 'on_patrol'];

unitStatus.put('/:id/status', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as any;
    const unitId = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(unitId) || unitId <= 0) return c.json({ error: 'Invalid unit id', code: 'INVALID_ID' }, 400);

    const body = await c.req.json().catch(() => ({} as any));
    const status = String(body.status || '').toLowerCase();
    if (!VALID_UNIT_STATUSES.includes(status)) {
      return c.json({ error: `status must be one of ${VALID_UNIT_STATUSES.join(', ')}`, code: 'INVALID_STATUS', valid: VALID_UNIT_STATUSES }, 400);
    }

    const unit = await queryFirst<any>(db, 'SELECT id, officer_id FROM units WHERE id = ?', unitId);
    if (!unit) return c.json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }, 404);

    // Officers can only change their own unit; supervisors+ can change any
    const supervisorRoles = ['admin', 'manager', 'supervisor', 'dispatcher'];
    if (!supervisorRoles.includes(user.role) && unit.officer_id !== user.id) {
      return c.json({ error: 'Officers may only change their own unit status', code: 'FORBIDDEN_NOT_OWN_UNIT' }, 403);
    }

    await execute(db, "UPDATE units SET status = ?, last_status_change = datetime('now'), updated_at = datetime('now') WHERE id = ?", status, unitId);
    const updated = await queryFirst<any>(db, 'SELECT * FROM units WHERE id = ?', unitId);
    return c.json(updated);
  } catch (err) {
    console.error('[dispatch] unit status error', err);
    return c.json({ error: 'Failed to update unit status', code: 'UNIT_STATUS_ERR' }, 500);
  }
});

// =====================================================================
// DEV-6: BOLO CRUD
// /api/dispatch/bolos
// =====================================================================
export const bolos = new Hono<Env>();
const VALID_BOLO_TYPES = ['person', 'vehicle', 'other'];
const VALID_BOLO_STATUSES = ['active', 'expired', 'cancelled'];

bolos.get('/', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const status = c.req.query('status');
    const type = c.req.query('type');
    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (status) { where += ' AND status = ?'; params.push(status); }
    else { where += " AND status = 'active'"; }
    if (type) { where += ' AND type = ?'; params.push(type); }
    const rows = await query<Record<string, unknown>>(db, `
      SELECT b.*, u.full_name AS issued_by_name
      FROM bolos b LEFT JOIN users u ON u.id = b.issued_by
      ${where} ORDER BY b.priority = 'P1' DESC, b.priority = 'P2' DESC, b.created_at DESC`,
      ...params);
    return c.json(rows);
  } catch (err) {
    console.error('[dispatch] bolos list error', err);
    return c.json({ error: 'Failed to list BOLOs', code: 'BOLO_LIST_ERR' }, 500);
  }
});

bolos.get('/:id', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const row = await queryFirst(db, 'SELECT * FROM bolos WHERE id = ?', id);
    if (!row) return c.json({ error: 'BOLO not found', code: 'BOLO_NOT_FOUND' }, 404);
    return c.json(row);
  } catch (err) {
    return c.json({ error: 'Failed to fetch BOLO', code: 'BOLO_GET_ERR' }, 500);
  }
});

bolos.post('/', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const body = await c.req.json().catch(() => ({} as any));
    const type = String(body.type || '').toLowerCase();
    const title = String(body.title || '').trim();
    if (!type || !title) return c.json({ error: 'type and title are required', code: 'BOLO_MISSING_FIELDS' }, 400);
    if (!VALID_BOLO_TYPES.includes(type)) return c.json({ error: `type must be one of ${VALID_BOLO_TYPES.join(', ')}`, code: 'BOLO_INVALID_TYPE' }, 400);

    const year = new Date().getFullYear().toString().slice(-2);
    const [{ max }] = await query<{ max: string | null }>(db, "SELECT MAX(bolo_number) AS max FROM bolos WHERE bolo_number LIKE ?", `${year}-BOLO-%`);
    const seq = max ? String(parseInt(max.split('-BOLO-')[1] || '0', 10) + 1).padStart(5, '0') : '00001';
    const bolo_number = `${year}-BOLO-${seq}`;

    const result = await execute(db, `
      INSERT INTO bolos (bolo_number, type, title, description, subject_description, vehicle_description, photo_url, status, priority, issued_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      bolo_number, type, title,
      body.description || null,
      body.subject_description || null,
      body.vehicle_description || null,
      body.photo_url || null,
      body.priority || 'P3',
      userId,
      body.expires_at || null);
    const created = await queryFirst(db, 'SELECT * FROM bolos WHERE id = ?', result.meta.last_row_id);
    return c.json(created, 201);
  } catch (err) {
    console.error('[dispatch] bolos create error', err);
    return c.json({ error: 'Failed to create BOLO', code: 'BOLO_CREATE_ERR' }, 500);
  }
});

bolos.put('/:id', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const before = await queryFirst<any>(db, 'SELECT * FROM bolos WHERE id = ?', id);
    if (!before) return c.json({ error: 'BOLO not found', code: 'BOLO_NOT_FOUND' }, 404);
    const b = await c.req.json().catch(() => ({} as any));
    const status = b.status ? String(b.status).toLowerCase() : before.status;
    if (!VALID_BOLO_STATUSES.includes(status)) return c.json({ error: `status must be one of ${VALID_BOLO_STATUSES.join(', ')}`, code: 'BOLO_INVALID_STATUS' }, 400);

    await execute(db, `
      UPDATE bolos SET
        title = ?, description = ?, subject_description = ?, vehicle_description = ?,
        photo_url = ?, status = ?, priority = ?, expires_at = ?
      WHERE id = ?`,
      b.title ?? before.title,
      b.description !== undefined ? (b.description || null) : before.description,
      b.subject_description !== undefined ? (b.subject_description || null) : before.subject_description,
      b.vehicle_description !== undefined ? (b.vehicle_description || null) : before.vehicle_description,
      b.photo_url !== undefined ? (b.photo_url || null) : before.photo_url,
      status,
      b.priority || before.priority,
      b.expires_at !== undefined ? (b.expires_at || null) : before.expires_at,
      id);
    return c.json(await queryFirst(db, 'SELECT * FROM bolos WHERE id = ?', id));
  } catch (err) {
    console.error('[dispatch] bolos update error', err);
    return c.json({ error: 'Failed to update BOLO', code: 'BOLO_UPDATE_ERR' }, 500);
  }
});

bolos.delete('/:id', requireRole(...ADMIN_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
    const before = await queryFirst(db, 'SELECT * FROM bolos WHERE id = ?', id);
    if (!before) return c.json({ error: 'BOLO not found', code: 'BOLO_NOT_FOUND' }, 404);
    await execute(db, 'DELETE FROM bolos WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: 'Failed to delete BOLO', code: 'BOLO_DELETE_ERR' }, 500);
  }
});

// =====================================================================
// DEV-7: Active welfare watches (supervisor view)
// GET /api/dispatch/welfare/active
// Mounted under /api/dispatch/welfare (alongside the welfare router).
// =====================================================================
export const welfareActive = new Hono<Env>();

welfareActive.get('/active', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    // Pull all officers currently on a P1/P2 onscene call — those are the
    // ones who SHOULD have an active DO watch. For each, query the DO
    // directly to read its state. Cheap because DO state is in-memory + SQLite.
    const candidates = await query<{ id: number; full_name: string; call_sign: string; current_call_id: number | null }>(db, `
      SELECT u.id, u.full_name AS full_name, un.call_sign, un.current_call_id
      FROM users u
      JOIN units un ON un.officer_id = u.id
      WHERE un.status = 'onscene' AND un.current_call_id IS NOT NULL`);

    const watches: any[] = [];
    for (const cand of candidates) {
      try {
        const id = (c.env as any).WELFARE_WATCH.idFromName(`u-${cand.id}`);
        const stub = (c.env as any).WELFARE_WATCH.get(id);
        const r = await stub.fetch('https://do/state', { method: 'GET' });
        const state = await r.json();
        if (state && !state.idle) {
          watches.push({
            user_id: cand.id,
            officer_name: cand.full_name,
            call_sign: cand.call_sign,
            current_call_id: cand.current_call_id,
            watch: state,
          });
        }
      } catch { /* DO unreachable / state error — skip */ }
    }

    return c.json({ count: watches.length, watches });
  } catch (err) {
    console.error('[dispatch] welfare/active error', err);
    return c.json({ error: 'Failed to list active welfare watches', code: 'WELFARE_ACTIVE_ERR' }, 500);
  }
});

// ─── Helper: safe JSON parse ─────────────────────────────
function safeJson<T>(s: string | null | undefined, fb: T): T {
  if (!s) return fb;
  try { return JSON.parse(s) as T; } catch { return fb; }
}

// UTC wall-clock timestamp string ("YYYY-MM-DD HH:MM:SS"), matching SQLite's
// datetime('now'). The app standard is UTC storage + browser-local display
// (the client's parseTimestamp reads naive strings as UTC). The previous
// `Date.now() - 6h` "MST" form stored local time, which the display layer then
// mis-read as UTC and rendered ~6h off (wrong call/on-scene timers, timeline
// entries before the call's own created_at). Always store UTC here.
const utcNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// Canonical updated-call payload: bare base row (no JOINs) so we stay under the
// D1 100-column result-set cap. The client maps this through mapDbCall(), which
// only reads base columns, so a flat SELECT * is sufficient.
async function fetchCallRow(db: D1Database, id: number) {
  return queryFirst<Record<string, unknown>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
}

// =====================================================================
// DEV-8: Closest-unit suggestion (single-result analogue to recommended-units)
// GET /api/dispatch/calls/:id/closest-unit
// Ported from legacy/server-vps/src/routes/dispatch/callActions.ts:2305.
// Returns the single nearest AVAILABLE unit plus the next two alternatives —
// used by the dispatcher's "find nearest" button as a fast pre-assign hint.
// =====================================================================
export const closestUnit = new Hono<Env>();

closestUnit.get('/:id/closest-unit', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);
    }
    const call = await queryFirst<{ id: number; call_number: string; latitude: number | null; longitude: number | null }>(
      db, 'SELECT id, call_number, latitude, longitude FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
    if (call.latitude == null || call.longitude == null) {
      return c.json({ error: 'Call has no GPS coordinates', code: 'NO_CALL_COORDS' }, 400);
    }

    const units = await query<{
      id: number; call_sign: string; status: string; latitude: number | null; longitude: number | null;
      officer_id: number | null; officer_name: string | null;
    }>(db, `
      SELECT u.id, u.call_sign, u.status, u.latitude, u.longitude,
             u.officer_id, usr.full_name AS officer_name
      FROM units u
      LEFT JOIN users usr ON u.officer_id = usr.id
      WHERE u.status = 'available'
        AND u.latitude IS NOT NULL
        AND u.longitude IS NOT NULL
    `);

    if (units.length === 0) {
      return c.json({ call_id: call.id, suggestion: null, reason: 'No available units with GPS' });
    }

    const ranked = units.map((u) => ({
      ...u,
      distance_miles: haversineMeters(call.latitude!, call.longitude!, u.latitude!, u.longitude!) / 1609.34,
    })).sort((a, b) => a.distance_miles - b.distance_miles);

    return c.json({
      call_id: call.id,
      call_number: call.call_number,
      suggestion: ranked[0],
      alternatives: ranked.slice(1, 3),
    });
  } catch (err) {
    console.error('[dispatch] closest-unit error', err);
    return c.json({ error: 'Failed to compute closest unit', code: 'CLOSEST_UNIT_ERROR' }, 500);
  }
});

// =====================================================================
// DEV-9: Auto-assign nearest unit to call
// POST /api/dispatch/calls/:id/auto-assign
// Ported from legacy/server-vps/src/routes/dispatch/callActions.ts:1734.
// Finds nearest AVAILABLE unit by haversine, mutates: appends to
// call.assigned_unit_ids JSON array, flips call status pending→dispatched,
// sets unit status=dispatched, logs to audit_log. No D1 transactions
// (D1 doesn't support multi-statement transactions over its HTTP gateway);
// failure between writes is logged but not rolled back — acceptable for
// dispatch reassign which is idempotent on the client side.
// =====================================================================
export const autoAssign = new Hono<Env>();

autoAssign.post('/:id/auto-assign', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);

    const call = await queryFirst<{
      id: number; call_number: string | null; latitude: number | null; longitude: number | null;
      assigned_unit_ids: string | null; dispatched_at: string | null;
    }>(db, 'SELECT id, call_number, latitude, longitude, assigned_unit_ids, dispatched_at FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);
    if (call.latitude == null || call.longitude == null) {
      return c.json({ error: 'Call has no GPS coordinates — cannot auto-assign', code: 'CALL_HAS_NO_GPS' }, 400);
    }

    const units = await query<{ id: number; call_sign: string; latitude: number; longitude: number; gps_updated_at: string | null }>(db, `
      SELECT id, call_sign, latitude, longitude, gps_updated_at
      FROM units
      WHERE status = 'available' AND latitude IS NOT NULL AND longitude IS NOT NULL
    `);
    if (units.length === 0) {
      return c.json({ error: 'No available units with GPS positions', code: 'NO_AVAILABLE_UNITS_WITH_GPS' }, 404);
    }

    // Prefer units reporting a FRESH fix — dispatching to a stale position
    // sends the responder to where the unit *was*, not where it is. Fall back
    // to stale units only if nobody is reporting live (flagged in the result).
    const nowMs = Date.now();
    const fresh = units.filter((u) => {
      const age = gpsAgeSeconds(u.gps_updated_at, nowMs);
      return age != null && age <= GPS_FRESH_WINDOW_S;
    });
    const pool = fresh.length > 0 ? fresh : units;
    const usedStaleFallback = fresh.length === 0;

    let nearest = pool[0];
    let minMeters = Infinity;
    for (const u of pool) {
      const d = haversineMeters(call.latitude, call.longitude, u.latitude, u.longitude);
      if (d < minMeters) { minMeters = d; nearest = u; }
    }
    const minMiles = minMeters / 1609.34;
    const nearestGpsAge = gpsAgeSeconds(nearest.gps_updated_at, nowMs);

    const currentUnits = safeJson<number[]>(call.assigned_unit_ids, []);
    if (!currentUnits.includes(Number(nearest.id))) currentUnits.push(Number(nearest.id));

    const now = utcNow();

    await execute(db, `
      UPDATE calls_for_service
      SET status = CASE WHEN status = 'pending' THEN 'dispatched' ELSE status END,
          assigned_unit_ids = ?,
          dispatched_at = COALESCE(dispatched_at, ?)
      WHERE id = ?
    `, JSON.stringify(currentUnits), now, call.id);

    await execute(db, `
      UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = ? WHERE id = ?
    `, call.id, now, nearest.id);

    if (userId != null) {
      await execute(db, `
        INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'auto_assigned', 'call', ?, ?, ?)
      `, userId, call.id, `Auto-assigned nearest unit ${nearest.call_sign} (${minMiles.toFixed(2)} mi) to ${call.call_number ?? '#' + call.id}`,
        c.req.header('CF-Connecting-IP') || 'unknown');
    }

    const updated = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM calls_for_service WHERE id = ?', call.id);

    return c.json({
      ...(updated || {}),
      auto_assigned_unit: nearest.call_sign,
      distance_miles: Math.round(minMiles * 100) / 100,
      gps_age_seconds: nearestGpsAge,
      gps_stale: usedStaleFallback,
    });
  } catch (err) {
    console.error('[dispatch] auto-assign error', err);
    return c.json({ error: 'Failed to auto-assign', code: 'AUTOASSIGN_ERROR' }, 500);
  }
});

// =====================================================================
// DEV-10: Manual timeline entry
// POST /api/dispatch/calls/:id/timeline
// Ported from legacy/server-vps/src/routes/dispatch/callLifecycle.ts:551.
// Inserts a row into audit_log scoped to entity_type='call'. Validates
// details length and any user-supplied created_at (1-min future skew allowed
// to handle client/server clock drift without rejecting legitimate writes).
// =====================================================================
export const callTimeline = new Hono<Env>();

callTimeline.post('/:id/timeline', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    if (userId == null) return c.json({ error: 'Unauthenticated', code: 'NO_AUTH' }, 401);

    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);

    const call = await queryFirst<{ id: number }>(db, 'SELECT id FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

    const body = await c.req.json<{ action?: string; details?: string; created_at?: string }>();
    const action = body.action ?? 'note_added';
    const details = body.details;

    if (!details || typeof details !== 'string' || details.length === 0) {
      return c.json({ error: 'details is required', code: 'DETAILS_REQUIRED' }, 400);
    }
    if (details.length > 5000) {
      return c.json({ error: 'details must be 5000 characters or fewer', code: 'DETAILS_TOO_LONG' }, 400);
    }

    let timestamp = utcNow();
    if (body.created_at) {
      if (typeof body.created_at !== 'string' || body.created_at.length > 50) {
        return c.json({ error: 'created_at must be a valid date string', code: 'CREATEDAT_INVALID' }, 400);
      }
      const parsed = new Date(body.created_at);
      if (Number.isNaN(parsed.getTime())) {
        return c.json({ error: 'created_at is not a valid date', code: 'CREATEDAT_INVALID' }, 400);
      }
      if (parsed.getTime() > Date.now() + 60_000) {
        return c.json({ error: 'created_at cannot be in the future', code: 'CREATEDAT_FUTURE' }, 400);
      }
      timestamp = body.created_at;
    }

    const result = await execute(db, `
      INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, 'call', ?, ?, ?, ?)
    `, userId, action, call.id, details, c.req.header('CF-Connecting-IP') || 'unknown', timestamp);

    const insertedId = (result as any)?.meta?.last_row_id ?? (result as any)?.lastInsertRowid;
    const entry = await queryFirst<Record<string, unknown>>(db, `
      SELECT al.*, u.full_name AS user_name
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.id = ?
    `, insertedId);

    return c.json(entry ?? { id: insertedId, action, details, created_at: timestamp }, 201);
  } catch (err) {
    console.error('[dispatch] add timeline entry error', err);
    return c.json({ error: 'Failed to add timeline entry', code: 'TIMELINE_ADD_ERROR' }, 500);
  }
});

// PUT /api/dispatch/calls/:id/timeline/:entryId — edit a timeline entry.
// Ported from legacy callLifecycle.ts:479. Only `details` is editable —
// created_at is an immutable audit-log timestamp. The entry is matched by
// (id, entity_type='call', entity_id) so one call can't edit another's rows.
callTimeline.put('/:id/timeline/:entryId', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    const entryId = parseInt(c.req.param('entryId') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);
    if (!Number.isFinite(entryId) || entryId <= 0) return c.json({ error: 'Invalid timeline entry ID', code: 'INVALID_TIMELINE_ENTRY_ID' }, 400);

    const entry = await queryFirst<{ id: number }>(db,
      'SELECT id FROM audit_log WHERE id = ? AND entity_type = ? AND entity_id = ?', entryId, 'call', id);
    if (!entry) return c.json({ error: 'Timeline entry not found', code: 'TIMELINE_ENTRY_NOT_FOUND' }, 404);

    const body = await c.req.json<{ details?: string }>();
    if (body.details === undefined) return c.json({ error: 'No fields to update', code: 'NO_FIELDS_TO_UPDATE' }, 400);
    if (typeof body.details !== 'string' || body.details.length > 5000) {
      return c.json({ error: 'details must be a string of 5000 characters or less', code: 'DETAILS_INVALID' }, 400);
    }

    await execute(db, 'UPDATE audit_log SET details = ? WHERE id = ?', body.details, entryId);

    const updated = await queryFirst<Record<string, unknown>>(db,
      'SELECT al.*, u.full_name AS user_name FROM audit_log al LEFT JOIN users u ON u.id = al.user_id WHERE al.id = ?', entryId);
    return c.json(updated ?? { id: entryId, details: body.details });
  } catch (err) {
    console.error('[dispatch] edit timeline entry error', err);
    return c.json({ error: 'Failed to update timeline entry', code: 'TIMELINE_UPDATE_ERROR' }, 500);
  }
});

// DELETE /api/dispatch/calls/:id/timeline/:entryId — delete a timeline entry.
// Ported from legacy callLifecycle.ts:526. Client (handleDeleteTimeline) only
// checks for a non-error response, so { success: true } is the contract.
callTimeline.delete('/:id/timeline/:entryId', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    const entryId = parseInt(c.req.param('entryId') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);
    if (!Number.isFinite(entryId) || entryId <= 0) return c.json({ error: 'Invalid timeline entry ID', code: 'INVALID_TIMELINE_ENTRY_ID' }, 400);

    const entry = await queryFirst<{ id: number }>(db,
      'SELECT id FROM audit_log WHERE id = ? AND entity_type = ? AND entity_id = ?', entryId, 'call', id);
    if (!entry) return c.json({ error: 'Timeline entry not found', code: 'TIMELINE_ENTRY_NOT_FOUND' }, 404);

    await execute(db, 'DELETE FROM audit_log WHERE id = ?', entryId);
    return c.json({ success: true });
  } catch (err) {
    console.error('[dispatch] delete timeline entry error', err);
    return c.json({ error: 'Failed to delete timeline entry', code: 'TIMELINE_DELETE_ERROR' }, 500);
  }
});

// =====================================================================
// DEV-11: Call action cluster — the call-lifecycle endpoints the lean API
// never ported from the legacy Express server. All mount under
// /api/dispatch/calls and operate on a single call by :id.
//
//   POST   /:id/revert-status      — step status back one stage
//   POST   /:id/le-notification    — record law-enforcement notification
//   POST   /:id/transfer           — move a call between two units
//   POST   /:id/broadcast-note     — add a note + WS-broadcast to all units
//   PUT    /:id/notes/:noteId      — edit a note in the JSON notes array
//   DELETE /:id/notes/:noteId      — delete a note from the JSON notes array
//   POST   /:id/generate-incident  — spawn a draft incident from a cleared call
//
// Ported from legacy/server-vps/src/routes/dispatch/{callActions,callLifecycle}.ts.
// D1 has no multi-statement transactions, so writes run sequentially (no
// rollback) — acceptable here: each handler's writes are independent and a
// partial failure surfaces as a 500 the client retries. activity_log → audit_log,
// req.user!.userId → c.get('userId'), req.ip → CF-Connecting-IP header.
// Every handler returns the updated base call row (mapDbCall-compatible) so the
// client can splice it into state without a refetch — see the client hooks
// useDispatchCallActions / useDispatchNotesActions / useDispatchMultiUnitActions.
// =====================================================================
export const callActions = new Hono<Env>();

// POST /:id/revert-status — step the call back one stage in the status chain.
// Re-dispatches assigned units only when reverting out of cleared/closed, and
// only if the unit isn't already committed to another call (guarded UPDATE).
callActions.post('/:id/revert-status', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);

    const call = await queryFirst<{ id: number; status: string; call_number: string; assigned_unit_ids: string | null }>(
      db, 'SELECT id, status, call_number, assigned_unit_ids FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

    const statusChain: Record<string, string> = {
      dispatched: 'pending', enroute: 'dispatched', onscene: 'enroute',
      cleared: 'onscene', closed: 'cleared',
    };
    const previousStatus = statusChain[call.status];
    if (!previousStatus) return c.json({ error: `Cannot revert from status "${call.status}"`, code: 'CANNOT_REVERT_STATUS' }, 400);

    const timestampField: Record<string, string> = {
      dispatched: 'dispatched_at', enroute: 'enroute_at', onscene: 'onscene_at',
      cleared: 'cleared_at', closed: 'closed_at',
    };
    const tsField = timestampField[call.status];
    const now = utcNow();

    await execute(db,
      `UPDATE calls_for_service SET status = ?${tsField ? `, ${tsField} = NULL` : ''}, updated_at = ? WHERE id = ?`,
      previousStatus, now, id);

    // Re-dispatch units when stepping out of cleared/closed.
    const revertedUnitIds: number[] = [];
    if (call.status === 'cleared' || call.status === 'closed') {
      const unitIds = safeJson<number[]>(call.assigned_unit_ids, []);
      const prevUnitStatus = previousStatus === 'onscene' ? 'onscene' : previousStatus === 'enroute' ? 'enroute' : 'dispatched';
      for (const unitId of unitIds) {
        const res = await execute(db,
          `UPDATE units SET status = ?, current_call_id = ?, last_status_change = ?
           WHERE id = ? AND (current_call_id IS NULL OR current_call_id = ?)`,
          prevUnitStatus, id, now, unitId, id);
        if (((res as any)?.meta?.changes ?? 0) > 0) revertedUnitIds.push(unitId);
      }
    }

    if (userId != null) {
      await execute(db,
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, 'status_reverted', 'call', ?, ?, ?)`,
        userId, id, `${call.call_number} status reverted from ${call.status} to ${previousStatus}`,
        c.req.header('CF-Connecting-IP') || 'unknown');
    }

    const updated = await fetchCallRow(db, id);
    broadcastAll('dispatch_update', { action: 'call_status_changed', call: updated, status: previousStatus });
    for (const unitId of revertedUnitIds) {
      const unit = await queryFirst<Record<string, unknown>>(db,
        `SELECT u.*, usr.full_name AS officer_name FROM units u LEFT JOIN users usr ON usr.id = u.officer_id WHERE u.id = ?`, unitId);
      if (unit) broadcastAll('dispatch_update', { action: 'unit_status_changed', unit });
    }
    return c.json(updated);
  } catch (err) {
    console.error('[dispatch] revert-status error', err);
    return c.json({ error: 'Failed to revert status', code: 'REVERT_STATUS_ERROR' }, 500);
  }
});

// POST /:id/le-notification — record that an outside law-enforcement agency was
// notified. Client sends { agency }; case_number/notes are optional extras.
callActions.post('/:id/le-notification', requireRole(...READ_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);

    const call = await queryFirst<{ id: number }>(db, 'SELECT id FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

    const body = await c.req.json<{ agency?: string; case_number?: string }>().catch(() => ({} as { agency?: string; case_number?: string }));
    const { agency, case_number } = body;
    if (agency != null && (typeof agency !== 'string' || agency.length > 200)) {
      return c.json({ error: 'Agency must be 200 characters or less', code: 'INVALID_AGENCY' }, 400);
    }
    if (case_number != null && (typeof case_number !== 'string' || case_number.length > 100)) {
      return c.json({ error: 'Case number must be 100 characters or less', code: 'INVALID_CASE_NUMBER' }, 400);
    }

    const now = utcNow();
    const agencyName = agency || 'Local PD';
    await execute(db,
      `UPDATE calls_for_service
       SET le_notified = 1, le_agency = ?, le_case_number = ?, updated_at = ?
       WHERE id = ?`,
      agencyName, case_number || null, now, id);

    if (userId != null) {
      await execute(db,
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
         VALUES (?, 'le_notification', 'call', ?, ?, ?, ?)`,
        userId, id, `LE notified: ${agencyName}${case_number ? ` (Case #${case_number})` : ''}`,
        c.req.header('CF-Connecting-IP') || 'unknown', now);
    }

    const updated = await fetchCallRow(db, id);
    broadcastAll('dispatch_update', { action: 'call_updated', call: updated });
    return c.json(updated);
  } catch (err) {
    console.error('[dispatch] le-notification error', err);
    return c.json({ error: 'Failed to record LE notification', code: 'LE_NOTIFICATION_ERROR' }, 500);
  }
});

// POST /:id/transfer — move a call from one unit to another. Frees the source
// unit, dispatches the target, and rewrites assigned_unit_ids.
callActions.post('/:id/transfer', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);

    const call = await queryFirst<{ id: number; call_number: string; assigned_unit_ids: string | null }>(
      db, 'SELECT id, call_number, assigned_unit_ids FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

    const body = await c.req.json<{ from_unit_id?: number | string; to_unit_id?: number | string }>().catch(() => ({} as { from_unit_id?: number | string; to_unit_id?: number | string }));
    const fromUnitId = Number(body.from_unit_id);
    const toUnitId = Number(body.to_unit_id);
    if (!Number.isFinite(fromUnitId) || !Number.isFinite(toUnitId) || fromUnitId <= 0 || toUnitId <= 0) {
      return c.json({ error: 'from_unit_id and to_unit_id are required', code: 'TRANSFER_UNITS_REQUIRED' }, 400);
    }

    const fromUnit = await queryFirst<{ id: number; call_sign: string }>(db, 'SELECT id, call_sign FROM units WHERE id = ?', fromUnitId);
    const toUnit = await queryFirst<{ id: number; call_sign: string }>(db, 'SELECT id, call_sign FROM units WHERE id = ?', toUnitId);
    if (!fromUnit || !toUnit) return c.json({ error: 'Unit not found', code: 'UNIT_NOT_FOUND' }, 404);

    let units = safeJson<number[]>(call.assigned_unit_ids, []).filter((u) => u !== fromUnitId);
    if (!units.includes(toUnitId)) units.push(toUnitId);

    const now = utcNow();
    await execute(db, 'UPDATE calls_for_service SET assigned_unit_ids = ?, updated_at = ? WHERE id = ?', JSON.stringify(units), now, id);
    await execute(db, `UPDATE units SET status = 'available', current_call_id = NULL, last_status_change = ? WHERE id = ?`, now, fromUnitId);
    await execute(db, `UPDATE units SET status = 'dispatched', current_call_id = ?, last_status_change = ? WHERE id = ?`, id, now, toUnitId);

    if (userId != null) {
      await execute(db,
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, 'call_transferred', 'call', ?, ?, ?)`,
        userId, id, `Transferred ${call.call_number} from ${fromUnit.call_sign} to ${toUnit.call_sign}`,
        c.req.header('CF-Connecting-IP') || 'unknown');
    }

    const updated = await fetchCallRow(db, id);
    broadcastAll('dispatch_update', { action: 'call_updated', call: updated });
    for (const unitId of [fromUnitId, toUnitId]) {
      const unit = await queryFirst<Record<string, unknown>>(db,
        `SELECT u.*, usr.full_name AS officer_name FROM units u LEFT JOIN users usr ON usr.id = u.officer_id WHERE u.id = ?`, unitId);
      if (unit) broadcastAll('dispatch_update', { action: 'unit_status_changed', unit });
    }
    return c.json(updated);
  } catch (err) {
    console.error('[dispatch] transfer error', err);
    return c.json({ error: 'Failed to transfer call', code: 'TRANSFER_CALL_ERROR' }, 500);
  }
});

// POST /:id/broadcast-note — append a flagged note and WS-broadcast it so every
// dispatcher/MDT sees it live. Client sends { message }.
callActions.post('/:id/broadcast-note', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);

    const call = await queryFirst<{ id: number; call_number: string; notes: string | null; assigned_unit_ids: string | null }>(
      db, 'SELECT id, call_number, notes, assigned_unit_ids FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

    const body = await c.req.json<{ message?: string }>().catch(() => ({} as { message?: string }));
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (message.length < 2 || message.length > 2000) {
      return c.json({ error: 'message is required (2-2000 chars)', code: 'MESSAGE_INVALID' }, 400);
    }

    const now = utcNow();
    const notes = safeJson<any[]>(call.notes, []);
    notes.push({ id: `bn-${Date.now()}`, author: 'DISPATCH BROADCAST', text: message, timestamp: now, broadcast: true });
    await execute(db, 'UPDATE calls_for_service SET notes = ?, updated_at = ? WHERE id = ?', JSON.stringify(notes), now, id);

    const updated = await fetchCallRow(db, id);
    const unitIds = safeJson<number[]>(call.assigned_unit_ids, []);
    broadcastAll('dispatch_update', { action: 'call_updated', call: updated });
    broadcastAll('dispatch_update', {
      action: 'dispatch_broadcast', call_id: id, call_number: call.call_number, message, unit_ids: unitIds,
    });
    return c.json(updated);
  } catch (err) {
    console.error('[dispatch] broadcast-note error', err);
    return c.json({ error: 'Failed to broadcast note', code: 'BROADCAST_NOTE_ERROR' }, 500);
  }
});

// PUT /:id/notes/:noteId — edit a note inside the JSON notes array (admin/manager).
callActions.put('/:id/notes/:noteId', requireRole(...ADMIN_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const user = c.get('user') as { username?: string } | undefined;
    const id = parseInt(c.req.param('id') || '', 10);
    const noteId = c.req.param('noteId');
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);

    const call = await queryFirst<{ id: number; notes: string | null }>(db, 'SELECT id, notes FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

    const body = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }));
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length < 1) return c.json({ error: 'text is required', code: 'TEXT_REQUIRED' }, 400);

    const notes = safeJson<any[]>(call.notes, []);
    const idx = notes.findIndex((n) => String(n.id) === String(noteId));
    if (idx === -1) return c.json({ error: 'Note not found', code: 'NOTE_NOT_FOUND' }, 404);

    const now = utcNow();
    notes[idx] = { ...notes[idx], text, edited_at: now, edited_by: user?.username || 'admin' };
    await execute(db, 'UPDATE calls_for_service SET notes = ?, updated_at = ? WHERE id = ?', JSON.stringify(notes), now, id);

    const updated = await fetchCallRow(db, id);
    broadcastAll('dispatch_update', { action: 'call_updated', call: updated });
    return c.json(updated);
  } catch (err) {
    console.error('[dispatch] edit note error', err);
    return c.json({ error: 'Failed to edit note', code: 'EDIT_NOTE_ERROR' }, 500);
  }
});

// DELETE /:id/notes/:noteId — remove a note from the JSON notes array (admin/manager).
callActions.delete('/:id/notes/:noteId', requireRole(...ADMIN_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    const noteId = c.req.param('noteId');
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);

    const call = await queryFirst<{ id: number; notes: string | null }>(db, 'SELECT id, notes FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

    const notes = safeJson<any[]>(call.notes, []);
    const idx = notes.findIndex((n) => String(n.id) === String(noteId));
    if (idx === -1) return c.json({ error: 'Note not found', code: 'NOTE_NOT_FOUND' }, 404);

    notes.splice(idx, 1);
    const now = utcNow();
    await execute(db, 'UPDATE calls_for_service SET notes = ?, updated_at = ? WHERE id = ?', JSON.stringify(notes), now, id);

    const updated = await fetchCallRow(db, id);
    broadcastAll('dispatch_update', { action: 'call_updated', call: updated });
    return c.json(updated);
  } catch (err) {
    console.error('[dispatch] delete note error', err);
    return c.json({ error: 'Failed to delete note', code: 'DELETE_NOTE_ERROR' }, 500);
  }
});

// Shared incident-generation logic behind two routes:
//   POST /:id/generate-incident   — post-clear action; requires cleared/closed.
//   POST /:id/promote-to-incident — CAD "PI" command; promotes a LIVE call,
//                                   so it does NOT require cleared/closed.
// Both build a draft incident from the call, dedup on call_id (409), and
// write an audit row. Kept as one helper so the two routes can't drift.
async function generateIncidentFromCall(c: Context<Env>, requireCleared: boolean) {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    if (userId == null) return c.json({ error: 'Unauthenticated', code: 'NO_AUTH' }, 401);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);

    const call = await queryFirst<Record<string, any>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

    if (requireCleared && !['cleared', 'closed'].includes(call.status)) {
      return c.json({ error: 'Can only generate incident reports from cleared or closed calls', code: 'CALL_NOT_CLEARED' }, 400);
    }

    const existing = await queryFirst<{ id: number; incident_number: string }>(db, 'SELECT id, incident_number FROM incidents WHERE call_id = ?', id);
    if (existing) {
      return c.json({ error: 'An incident report already exists for this call', incident_id: existing.id, incident_number: existing.incident_number }, 409);
    }

    // Incident number: YY-RMP-NNNNN (matches src/routes/incidents.ts convention).
    const year = new Date().getFullYear().toString().slice(-2);
    const [{ max }] = await query<{ max: string | null }>(db,
      'SELECT MAX(incident_number) AS max FROM incidents WHERE incident_number LIKE ?', `${year}-RMP-%`);
    const seq = max ? String(parseInt(max.split('-RMP-')[1] || '0', 10) + 1).padStart(5, '0') : '00001';
    const incidentNumber = `${year}-RMP-${seq}`;

    // Build narrative template from call data (carries detail the lean incidents
    // schema can't hold as columns).
    const flagLabels: Array<[string, string]> = [
      ['alcohol_involved', 'Alcohol'], ['drugs_involved', 'Drugs'], ['domestic_violence', 'Domestic Violence'],
      ['injuries_reported', 'Injuries'], ['mental_health_crisis', 'Mental Health Crisis'],
      ['juvenile_involved', 'Juvenile'], ['felony_in_progress', 'Felony In Progress'],
      ['officer_safety_caution', 'Officer Safety Caution'], ['k9_requested', 'K9'], ['ems_requested', 'EMS'],
    ];
    const activeFlags = flagLabels.filter(([k]) => call[k]).map(([, label]) => label);

    const np: string[] = [];
    np.push(`Incident generated from dispatch call ${call.call_number}.`);
    np.push(`\nCall Type: ${(call.incident_type || '').replace(/_/g, ' ').toUpperCase()}`);
    np.push(`Priority: ${call.priority}`);
    np.push(`Location: ${call.location_address || 'Unknown'}`);
    if (call.caller_name) np.push(`Caller: ${call.caller_name}${call.caller_phone ? ` (${call.caller_phone})` : ''}`);
    if (call.description) np.push(`\nCall Description: ${call.description}`);
    if (call.disposition) np.push(`Disposition: ${call.disposition}`);
    if (activeFlags.length) np.push(`Flags: ${activeFlags.join(', ')}`);
    np.push(`\nCall Timeline:`);
    if (call.created_at) np.push(`  Created: ${call.created_at}`);
    if (call.dispatched_at) np.push(`  Dispatched: ${call.dispatched_at}`);
    if (call.enroute_at) np.push(`  En Route: ${call.enroute_at}`);
    if (call.onscene_at) np.push(`  On Scene: ${call.onscene_at}`);
    if (call.cleared_at) np.push(`  Cleared: ${call.cleared_at}`);
    np.push(`\n--- Officer narrative below ---\n`);
    const narrative = np.join('\n');

    const result = await execute(db,
      `INSERT INTO incidents (incident_number, call_id, incident_type, priority, status, location_address, latitude, longitude, narrative, officer_id)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
      incidentNumber, id, call.incident_type, call.priority || 'P3',
      call.location_address || null, call.latitude ?? null, call.longitude ?? null, narrative, userId);
    const incidentId = result.meta.last_row_id;

    await execute(db,
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, 'incident_created', 'incident', ?, ?, ?)`,
      userId, incidentId, `Generated ${incidentNumber} from call ${call.call_number}`,
      c.req.header('CF-Connecting-IP') || 'unknown');

    const incident = await queryFirst<Record<string, unknown>>(db, `
      SELECT i.*, o.full_name AS officer_name, c.call_number
      FROM incidents i
      LEFT JOIN users o ON o.id = i.officer_id
      LEFT JOIN calls_for_service c ON c.id = i.call_id
      WHERE i.id = ?`, incidentId);
    return c.json(incident ?? { id: incidentId, incident_number: incidentNumber }, 201);
  } catch (err) {
    console.error('[dispatch] generate-incident error', err);
    return c.json({ error: 'Failed to generate incident', code: 'GENERATE_INCIDENT_ERROR' }, 500);
  }
}

// Post-clear: requires the call to be cleared/closed first.
callActions.post('/:id/generate-incident', requireRole('admin', 'manager', 'supervisor', 'officer'),
  (c) => generateIncidentFromCall(c, true));

// CAD "PI" command: promote a live call to an incident report immediately,
// without first clearing it. Same dedup + audit behavior.
callActions.post('/:id/promote-to-incident', requireRole('admin', 'manager', 'supervisor', 'officer'),
  (c) => generateIncidentFromCall(c, false));

// POST /:id/send-to-serve — seed a serve_queue entry from a dispatch call
// (DispatchPage "Send to Serve Queue" button). The create-side mirror of
// legacy's GET /:id/serve-link, which reads the same row back. Dedups on
// call_id so a double-click doesn't create two jobs. Neither backend
// implemented this before → the button 404'd. Returns the serve_queue row
// (the client stores it as `serveLink`).
callActions.post('/:id/send-to-serve', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    if (userId == null) return c.json({ error: 'Unauthenticated', code: 'NO_AUTH' }, 401);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);

    const call = await queryFirst<Record<string, any>>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

    // Dedup: one serve job per call. Return the existing row if present.
    const existing = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM serve_queue WHERE call_id = ?', id);
    if (existing) return c.json(existing, 200);

    const result = await execute(db,
      `INSERT INTO serve_queue (
         call_id, officer_id, created_by, recipient_address, recipient_lat, recipient_lng,
         property_id, priority, status, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'normal', 'pending', ?, datetime('now'), datetime('now'))`,
      id, userId, userId,
      call.location_address ?? null, call.latitude ?? null, call.longitude ?? null,
      call.property_id ?? null,
      `Created from dispatch call ${call.call_number}`);

    try {
      await execute(db,
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, 'serve_queued', 'serve_queue', ?, ?, ?)`,
        userId, result.meta.last_row_id, `Sent call ${call.call_number} to serve queue`,
        c.req.header('cf-connecting-ip') || 'unknown');
    } catch { /* audit non-fatal */ }

    const created = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM serve_queue WHERE id = ?', result.meta.last_row_id);
    return c.json(created ?? { id: result.meta.last_row_id }, 201);
  } catch (err) {
    console.error('[dispatch] send-to-serve error', err);
    return c.json({ error: 'Failed to send to serve queue', code: 'SEND_TO_SERVE_ERR' }, 500);
  }
});

// PATCH /:id/pin — pin/unpin a call to the top of the dispatch queue.
// `pinned` lives on calls_for_service_ext (the base table is at the D1
// 100-column cap), so we upsert the ext row. Nobody implemented this
// before → the DispatchPage pin toggle 404'd and the optimistic update
// always reverted. The list query (GET /calls) reads cfse.pinned and
// sorts pinned-first so the state persists across refreshes.
callActions.patch('/:id/pin', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id') || '', 10);
    if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid call id', code: 'INVALID_ID' }, 400);
    const body = await c.req.json().catch(() => ({} as any));
    const pinned = body.pinned ? 1 : 0;

    const call = await queryFirst<{ id: number }>(db, 'SELECT id FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

    await execute(db, 'INSERT OR IGNORE INTO calls_for_service_ext (id) VALUES (?)', id);
    await execute(db, 'UPDATE calls_for_service_ext SET pinned = ? WHERE id = ?', pinned, id);
    return c.json({ success: true, id, pinned: Boolean(pinned) });
  } catch (err) {
    console.error('[dispatch] pin error', err);
    return c.json({ error: 'Failed to toggle pin', code: 'PIN_ERR' }, 500);
  }
});
