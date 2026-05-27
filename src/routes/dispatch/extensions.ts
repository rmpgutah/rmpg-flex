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
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { requireRole } from '../../middleware/auth';

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

    // Pull available units with GPS. Lean schema stores lat/lng directly on
    // units (no separate gps_locations table on lean D1 — confirmed via
    // sqlite_master inspection). Filter to available + dispatched-but-near
    // statuses so the dispatcher sees who could be repurposed.
    const units = await query<{
      id: number; call_sign: string; status: string; officer_id: number | null;
      latitude: number | null; longitude: number | null; current_call_id: number | null;
      officer_name: string | null; badge_number: string | null;
    }>(db, `
      SELECT u.id, u.call_sign, u.status, u.officer_id,
             u.latitude, u.longitude, u.current_call_id,
             usr.full_name AS officer_name, usr.badge_number
      FROM units u
      LEFT JOIN users usr ON usr.id = u.officer_id
      WHERE u.status IN ('available', 'on_patrol', 'dispatched')
        AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
    `);

    const ranked = units.map((u) => {
      const distM = haversineMeters(call.latitude!, call.longitude!, u.latitude!, u.longitude!);
      const distMi = distM / 1609.34;
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
      };
    }).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, limit);

    return c.json({
      callId: id,
      callNumber: call.call_number,
      callPriority: call.priority,
      callLat: call.latitude,
      callLng: call.longitude,
      recommended: ranked,
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

    await execute(db, "UPDATE units SET audio_mode = ?, updated_at = datetime('now', '-7 hours') WHERE id = ?", mode, unitId);
    return c.json({ success: true, unit_id: unitId, audio_mode: mode });
  } catch (err) {
    console.error('[dispatch] PUT audio-mode error', err);
    return c.json({ error: 'Failed to update audio mode', code: 'AUDIO_MODE_SET_ERR' }, 500);
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
      ${activeOnly ? "WHERE pa.active = 1 AND (pa.expires_at IS NULL OR pa.expires_at >= datetime('now', '-7 hours'))" : ''}
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
        updated_at = datetime('now', '-7 hours')
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
        AND (expires_at IS NULL OR expires_at >= datetime('now', '-7 hours'))`,
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
    const call = await queryFirst<any>(db, 'SELECT * FROM calls_for_service WHERE id = ?', id);
    if (!call) return c.json({ error: 'Call not found', code: 'CALL_NOT_FOUND' }, 404);

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
            AND (expires_at IS NULL OR expires_at >= datetime('now', '-7 hours'))`,
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

    await execute(db, "UPDATE units SET status = ?, last_status_change = datetime('now', '-7 hours'), updated_at = datetime('now', '-7 hours') WHERE id = ?", status, unitId);
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
// sets unit status=dispatched, logs to activity_log. No D1 transactions
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

    const units = await query<{ id: number; call_sign: string; latitude: number; longitude: number }>(db, `
      SELECT id, call_sign, latitude, longitude
      FROM units
      WHERE status = 'available' AND latitude IS NOT NULL AND longitude IS NOT NULL
    `);
    if (units.length === 0) {
      return c.json({ error: 'No available units with GPS positions', code: 'NO_AVAILABLE_UNITS_WITH_GPS' }, 404);
    }

    let nearest = units[0];
    let minMeters = Infinity;
    for (const u of units) {
      const d = haversineMeters(call.latitude, call.longitude, u.latitude, u.longitude);
      if (d < minMeters) { minMeters = d; nearest = u; }
    }
    const minMiles = minMeters / 1609.34;

    const currentUnits = safeJson<number[]>(call.assigned_unit_ids, []);
    if (!currentUnits.includes(Number(nearest.id))) currentUnits.push(Number(nearest.id));

    const now = new Date(Date.now() - 6 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);

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
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
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
// Inserts a row into activity_log scoped to entity_type='call'. Validates
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

    let timestamp = new Date(Date.now() - 6 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
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
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, 'call', ?, ?, ?, ?)
    `, userId, action, call.id, details, c.req.header('CF-Connecting-IP') || 'unknown', timestamp);

    const insertedId = (result as any)?.meta?.last_row_id ?? (result as any)?.lastInsertRowid;
    const entry = await queryFirst<Record<string, unknown>>(db, `
      SELECT al.*, u.full_name AS user_name
      FROM activity_log al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.id = ?
    `, insertedId);

    return c.json(entry ?? { id: insertedId, action, details, created_at: timestamp }, 201);
  } catch (err) {
    console.error('[dispatch] add timeline entry error', err);
    return c.json({ error: 'Failed to add timeline entry', code: 'TIMELINE_ADD_ERROR' }, 500);
  }
});
