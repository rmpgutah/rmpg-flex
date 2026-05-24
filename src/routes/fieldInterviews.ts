// ============================================================
// RMPG Flex — Field Interviews (Cloudflare Worker)
// ============================================================
// Officer-initiated contact records: GPS, subject details, vehicle,
// disposition. Phase 1 RMS port per the retirement plan.
//
// Migration: 0025_field_interviews.sql.
//
// Bug fix during port: legacy GET filters and /stats GROUP BY both
// referenced `fi.disposition` directly, but the actual DB column is
// `action_taken` (legacy POST/PUT mapped the body alias `disposition`
// → `action_taken` but the read-side queries didn't follow suit). This
// port queries `action_taken` everywhere and keeps `disposition` as a
// write-side alias only. Contract preserved; bug silently fixed.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const fi = new Hono<Env>();

// ── Helpers ─────────────────────────────────────────────────

/** Generate next FI number: FI-YY-NNNNN. Scans the latest existing
 *  fi_number for the current year and increments. Caller serializes
 *  via INSERT immediately after — concurrent writers in the same
 *  millisecond would collide on the UNIQUE constraint and 500; the
 *  legacy behavior was identical (worth a follow-up to bake a UUID
 *  fallback if the FI-card workflow ever goes multi-officer-realtime,
 *  but for now the single-officer-at-a-call cadence is fine). */
async function generateFiNumber(db: ReturnType<typeof getDb>): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  const prefix = `FI-${yy}-`;
  const row = await queryFirst<{ fi_number: string }>(
    db,
    `SELECT fi_number FROM field_interviews
     WHERE fi_number LIKE ?
     ORDER BY id DESC LIMIT 1`,
    `${prefix}%`,
  );

  let seq = 1;
  if (row?.fi_number) {
    const parts = row.fi_number.split('-');
    const parsed = parseInt(parts[2], 10);
    seq = isNaN(parsed) ? 1 : parsed + 1;
  }
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

/** RFC-4180 CSV escape (same pattern audit.ts uses). FI narratives
 *  routinely contain commas + newlines + officer quoted speech —
 *  a naive join(',') would corrupt rows. */
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = typeof v === 'string' ? v : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

// ── GET / — paginated list with filters ─────────────────────
fi.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const q = c.req.query.bind(c.req);
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    if (q('officer_id')) { conditions.push('fi.officer_id = ?'); params.push(q('officer_id')); }
    if (q('person_id')) { conditions.push('fi.person_id = ?'); params.push(q('person_id')); }
    if (q('date_from')) { conditions.push('fi.date >= ?'); params.push(q('date_from')); }
    if (q('date_to')) { conditions.push('fi.date <= ?'); params.push(q('date_to')); }
    // Legacy `disposition` filter → action_taken column (see header note)
    if (q('disposition')) { conditions.push('fi.action_taken = ?'); params.push(q('disposition')); }
    if (q('contact_reason')) { conditions.push('fi.contact_reason = ?'); params.push(q('contact_reason')); }
    if (q('archived') === 'true') conditions.push('fi.archived_at IS NOT NULL');
    else conditions.push('fi.archived_at IS NULL');
    const search = q('search');
    if (search) {
      conditions.push(
        '(fi.location LIKE ? OR fi.narrative LIKE ? OR fi.subject_first_name LIKE ? OR fi.subject_last_name LIKE ?)',
      );
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = Math.max(1, parseInt(q('page') || '1', 10) || 1);
    const perPage = Math.min(100000, Math.max(1, parseInt(q('per_page') || '100', 10) || 100));
    const offset = (pageNum - 1) * perPage;

    const countRow = await queryFirst<{ total: number }>(
      db, `SELECT COUNT(*) as total FROM field_interviews fi ${where}`, ...params,
    );
    const total = countRow?.total ?? 0;

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT fi.*,
              p.first_name as person_first_name, p.last_name as person_last_name,
              u.full_name as officer_name
       FROM field_interviews fi
       LEFT JOIN persons p ON fi.person_id = p.id
       LEFT JOIN users u ON fi.officer_id = u.id
       ${where}
       ORDER BY COALESCE(fi.date, fi.created_at) DESC, fi.created_at DESC
       LIMIT ? OFFSET ?`,
      ...params, perPage, offset,
    );

    return c.json({
      data: rows,
      pagination: {
        page: pageNum,
        per_page: perPage,
        total,
        totalPages: perPage > 0 ? Math.ceil(total / perPage) : 0,
      },
    });
  } catch (err) {
    return c.json({
      error: 'Failed to list field interviews', code: 'LIST_FI_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ── GET /stats — aggregate analytics ────────────────────────
fi.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const totalRow = await queryFirst<{ count: number }>(db, 'SELECT COUNT(*) as count FROM field_interviews');
    // Legacy queried `disposition`; the actual column is action_taken (header note)
    const byDisposition = await query<Record<string, unknown>>(
      db,
      `SELECT action_taken as disposition, COUNT(*) as count
       FROM field_interviews WHERE action_taken IS NOT NULL
       GROUP BY action_taken ORDER BY count DESC`,
    );
    const byOfficer = await query<Record<string, unknown>>(
      db,
      `SELECT fi.officer_id, u.full_name as officer_name, COUNT(*) as count
       FROM field_interviews fi
       LEFT JOIN users u ON fi.officer_id = u.id
       GROUP BY fi.officer_id, u.full_name
       ORDER BY count DESC LIMIT 20`,
    );
    const byReason = await query<Record<string, unknown>>(
      db,
      `SELECT contact_reason as reason, COUNT(*) as count
       FROM field_interviews WHERE contact_reason IS NOT NULL
       GROUP BY contact_reason ORDER BY count DESC`,
    );
    const lastSevenDays = await queryFirst<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM field_interviews
       WHERE COALESCE(date, created_at) >= datetime('now', '-7 days')`,
    );
    const lastThirtyDays = await queryFirst<{ count: number }>(
      db,
      `SELECT COUNT(*) as count FROM field_interviews
       WHERE COALESCE(date, created_at) >= datetime('now', '-30 days')`,
    );

    return c.json({
      total: totalRow?.count ?? 0,
      byDisposition,
      byOfficer,
      byReason,
      lastSevenDays: lastSevenDays?.count ?? 0,
      lastThirtyDays: lastThirtyDays?.count ?? 0,
    });
  } catch (err) {
    return c.json({
      error: 'Failed to get FI stats', code: 'FI_STATS_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ── GET /by-person/:personId — FI history for a person ──────
fi.get('/by-person/:personId', async (c) => {
  try {
    const db = getDb(c.env);
    const personId = parseInt(c.req.param('personId'), 10);
    if (isNaN(personId)) return c.json({ error: 'Invalid person ID', code: 'INVALID_PERSON_ID' }, 400);

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT fi.*, u.full_name as officer_name
       FROM field_interviews fi
       LEFT JOIN users u ON fi.officer_id = u.id
       WHERE fi.person_id = ? AND fi.archived_at IS NULL
       ORDER BY COALESCE(fi.date, fi.created_at) DESC LIMIT 200`,
      personId,
    );
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to get FIs by person', code: 'FI_BY_PERSON_ERROR' }, 500);
  }
});

// ── GET /by-location?lat=&lng=&radius_m= — FIs near a point ──
// Cheap rectangular bounding-box scan. Doesn't need PostGIS — D1
// is fine for the typical "show me FIs in this neighborhood" map
// query at the volumes a single-shift CAD handles. The radius is
// converted to a lat/lng delta using a flat-earth approximation
// that's accurate to ~1% within a 50km radius (good enough for
// patrol-area queries).
fi.get('/by-location', async (c) => {
  try {
    const db = getDb(c.env);
    const lat = parseFloat(c.req.query('lat') || '');
    const lng = parseFloat(c.req.query('lng') || '');
    const radiusM = Math.min(50000, Math.max(50, parseInt(c.req.query('radius_m') || '500', 10)));
    if (!isFinite(lat) || !isFinite(lng)) {
      return c.json({ error: 'lat and lng required', code: 'INVALID_LATLNG' }, 400);
    }

    const latDelta = radiusM / 111000;
    const lngDelta = radiusM / (111000 * Math.cos((lat * Math.PI) / 180));

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT fi.*, u.full_name as officer_name,
              p.first_name as person_first_name, p.last_name as person_last_name
       FROM field_interviews fi
       LEFT JOIN users u ON fi.officer_id = u.id
       LEFT JOIN persons p ON fi.person_id = p.id
       WHERE fi.archived_at IS NULL
         AND fi.latitude IS NOT NULL AND fi.longitude IS NOT NULL
         AND fi.latitude BETWEEN ? AND ?
         AND fi.longitude BETWEEN ? AND ?
       ORDER BY COALESCE(fi.date, fi.created_at) DESC LIMIT 500`,
      lat - latDelta, lat + latDelta,
      lng - lngDelta, lng + lngDelta,
    );
    return c.json({ data: rows });
  } catch (err) {
    return c.json({ error: 'Failed to query FIs by location', code: 'FI_BY_LOCATION_ERROR' }, 500);
  }
});

// ── GET /:id — single record ────────────────────────────────
// Hono matches static segments first, so /stats, /by-person/*, etc
// already won. This catches the parametric path.
fi.get('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid field interview ID', code: 'INVALID_FI_ID' }, 400);

    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT fi.*,
              p.first_name as person_first_name, p.last_name as person_last_name,
              p.dob as person_dob, p.phone as person_phone,
              u.full_name as officer_name, u.badge_number as officer_badge,
              v.plate_number as vehicle_plate_joined, v.make as vehicle_make,
              v.model as vehicle_model, v.color as vehicle_color, v.year as vehicle_year
       FROM field_interviews fi
       LEFT JOIN persons p ON fi.person_id = p.id
       LEFT JOIN users u ON fi.officer_id = u.id
       LEFT JOIN vehicles_records v ON fi.vehicle_id = v.id
       WHERE fi.id = ?`,
      id,
    );
    if (!row) return c.json({ error: 'Field interview not found', code: 'FI_NOT_FOUND' }, 404);
    return c.json({ data: row });
  } catch (err) {
    return c.json({ error: 'Failed to get field interview', code: 'GET_FI_ERROR' }, 500);
  }
});

// ── Body-alias map (legacy contract: accept both old + new names) ──
// disposition/action_taken, reason/contact_reason, location/location_address
// all resolve to the canonical DB column. Same map drives POST and PUT.
const FIELD_MAP: Record<string, string> = {
  date: 'date',
  person_id: 'person_id',
  vehicle_id: 'vehicle_id',
  location: 'location',
  location_address: 'location',
  latitude: 'latitude',
  longitude: 'longitude',
  contact_reason: 'contact_reason',
  reason: 'contact_reason',
  contact_type: 'contact_type',
  action_taken: 'action_taken',
  disposition: 'action_taken',
  narrative: 'narrative',
  subject_first_name: 'subject_first_name',
  subject_last_name: 'subject_last_name',
  subject_dob: 'subject_dob',
  subject_gender: 'subject_gender',
  subject_race: 'subject_race',
  subject_height: 'subject_height',
  subject_weight: 'subject_weight',
  subject_hair: 'subject_hair',
  subject_eye: 'subject_eye',
  subject_clothing: 'subject_clothing',
  subject_description: 'subject_description',
  vehicle_plate: 'vehicle_plate',
  vehicle_description: 'vehicle_description',
  gang_affiliation: 'gang_affiliation',
  associated_call_id: 'associated_call_id',
  associated_incident_id: 'associated_incident_id',
  section_id: 'section_id',
  zone_id: 'zone_id',
  beat_id: 'beat_id',
  zone_beat: 'zone_beat',
};

// ── POST / — create field interview ─────────────────────────
fi.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number;
    const body = await c.req.json<Record<string, unknown>>();

    if (!body.date) return c.json({ error: 'date is required', code: 'MISSING_DATE' }, 400);

    // Validate person_id if provided — defensive against stale picker selections
    if (body.person_id) {
      const personExists = await queryFirst<{ id: number }>(
        db, 'SELECT id FROM persons WHERE id = ?', body.person_id,
      );
      if (!personExists) return c.json({ error: 'Person not found', code: 'PERSON_NOT_FOUND' }, 400);
    }

    const fiNumber = await generateFiNumber(db);

    // Build INSERT from the field map — same shape as PUT, lets the
    // caller mix legacy + canonical field names freely.
    const cols: string[] = ['fi_number', 'officer_id'];
    const vals: unknown[] = [fiNumber, userId];
    const seen = new Set<string>(); // dedupe when both alias + canonical sent
    for (const [bodyKey, dbCol] of Object.entries(FIELD_MAP)) {
      if (body[bodyKey] !== undefined && !seen.has(dbCol)) {
        cols.push(dbCol);
        vals.push(body[bodyKey] ?? null);
        seen.add(dbCol);
      }
    }

    const result = await execute(
      db,
      `INSERT INTO field_interviews (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ...vals,
    );
    const newId = Number(result.meta.last_row_id);

    // Bump person.fi_count + last_fi_date if linked. Wrap in try/catch
    // because those columns may not exist on every D1 deployment
    // (legacy added them via addCol; not in migrations yet).
    if (body.person_id) {
      try {
        await execute(
          db,
          `UPDATE persons SET
             fi_count = COALESCE(fi_count, 0) + 1,
             last_fi_date = datetime('now')
           WHERE id = ?`,
          body.person_id,
        );
      } catch { /* fi_count / last_fi_date columns absent — non-fatal */ }
    }

    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM field_interviews WHERE id = ?', newId,
    );
    return c.json({ data: created }, 201);
  } catch (err) {
    return c.json({
      error: 'Failed to create field interview', code: 'CREATE_FI_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ── PUT /:id — update (partial; only sent fields touched) ───
fi.put('/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid field interview ID', code: 'INVALID_FI_ID' }, 400);

    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM field_interviews WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Field interview not found', code: 'FI_NOT_FOUND' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const setClauses: string[] = [];
    const vals: unknown[] = [];
    const seen = new Set<string>();
    for (const [bodyKey, dbCol] of Object.entries(FIELD_MAP)) {
      if (body[bodyKey] !== undefined && !seen.has(dbCol)) {
        setClauses.push(`${dbCol} = ?`);
        vals.push(body[bodyKey] ?? null);
        seen.add(dbCol);
      }
    }
    if (setClauses.length === 0) return c.json({ error: 'No fields to update', code: 'NO_FIELDS' }, 400);

    setClauses.push(`updated_at = datetime('now')`);
    vals.push(id);

    await execute(
      db,
      `UPDATE field_interviews SET ${setClauses.join(', ')} WHERE id = ?`,
      ...vals,
    );
    const updated = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM field_interviews WHERE id = ?', id,
    );
    return c.json({ data: updated });
  } catch (err) {
    return c.json({ error: 'Failed to update field interview', code: 'UPDATE_FI_ERROR' }, 500);
  }
});

// ── DELETE /:id — admin/manager only ────────────────────────
fi.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return c.json({ error: 'Admin or manager role required', code: 'FORBIDDEN' }, 403);
  }
  try {
    const db = getDb(c.env);
    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) return c.json({ error: 'Invalid field interview ID', code: 'INVALID_FI_ID' }, 400);

    const existing = await queryFirst<{ id: number; fi_number: string; person_id: number | null }>(
      db, 'SELECT id, fi_number, person_id FROM field_interviews WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Field interview not found', code: 'FI_NOT_FOUND' }, 404);

    await execute(db, 'DELETE FROM field_interviews WHERE id = ?', id);

    // Decrement person.fi_count if linked (best-effort, mirror create)
    if (existing.person_id) {
      try {
        await execute(
          db,
          `UPDATE persons SET fi_count = MAX(0, COALESCE(fi_count, 0) - 1) WHERE id = ?`,
          existing.person_id,
        );
      } catch { /* fi_count column absent — non-fatal */ }
    }

    return c.json({ success: true, deleted_fi_number: existing.fi_number });
  } catch (err) {
    return c.json({ error: 'Failed to delete field interview', code: 'DELETE_FI_ERROR' }, 500);
  }
});

// ── GET /export/csv — admin/manager/supervisor only ─────────
fi.get('/export/csv', async (c) => {
  const user = c.get('user');
  if (!user || !['admin', 'manager', 'supervisor'].includes(user.role)) {
    return c.json({ error: 'Admin / manager / supervisor role required', code: 'FORBIDDEN' }, 403);
  }
  try {
    const db = getDb(c.env);
    const dateFrom = c.req.query('date_from');
    const dateTo = c.req.query('date_to');
    const conditions: string[] = ['fi.archived_at IS NULL'];
    const params: unknown[] = [];
    if (dateFrom) { conditions.push('fi.date >= ?'); params.push(dateFrom); }
    if (dateTo) { conditions.push('fi.date <= ?'); params.push(dateTo); }

    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT fi.fi_number, fi.date, u.full_name as officer_name, u.badge_number,
              fi.location, fi.subject_first_name, fi.subject_last_name, fi.subject_dob,
              fi.contact_reason, fi.action_taken as disposition, fi.narrative,
              fi.vehicle_plate, fi.created_at
       FROM field_interviews fi
       LEFT JOIN users u ON fi.officer_id = u.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY COALESCE(fi.date, fi.created_at) DESC LIMIT 10000`,
      ...params,
    );

    const headers = [
      { key: 'fi_number', label: 'FI Number' },
      { key: 'date', label: 'Date' },
      { key: 'officer_name', label: 'Officer' },
      { key: 'badge_number', label: 'Badge' },
      { key: 'location', label: 'Location' },
      { key: 'subject_first_name', label: 'Subject First' },
      { key: 'subject_last_name', label: 'Subject Last' },
      { key: 'subject_dob', label: 'Subject DOB' },
      { key: 'contact_reason', label: 'Reason' },
      { key: 'disposition', label: 'Disposition' },
      { key: 'narrative', label: 'Narrative' },
      { key: 'vehicle_plate', label: 'Vehicle Plate' },
      { key: 'created_at', label: 'Created' },
    ];
    const head = headers.map((h) => csvEscape(h.label)).join(',');
    const body = rows.map((r) => headers.map((h) => csvEscape(r[h.key])).join(',')).join('\n');
    const csv = `${head}\n${body}\n`;

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="field_interviews_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed to export field interviews', code: 'FI_EXPORT_ERROR' }, 500);
  }
});

export default fi;
