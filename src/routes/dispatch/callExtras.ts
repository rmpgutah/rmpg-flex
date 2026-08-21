// ============================================================
// Dispatch — Call Extras
//
// POST /api/dispatch/calls/:id/suggest-unit
//   Finds N nearest available units weighted by workload.
//   Returns suggestions only — dispatcher makes the final call.
//
// GET  /api/dispatch/calls/:id/notes/export
//   Returns all notes for a call as a plain-text block.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst } from '../../utils/db';

const callExtras = new Hono<Env>();

// ---- Haversine distance in miles ----
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// POST /api/dispatch/calls/:id/suggest-unit
// Body (optional): { n: number }  — number of suggestions (default 5)
callExtras.post('/:id/suggest-unit', async (c) => {
  const db = getDb(c.env);
  const callId = Number(c.req.param('id'));
  if (!callId) return c.json({ ok: false, error: 'invalid call id' }, 400);

  let n = 5;
  try {
    const body = await c.req.json();
    if (body?.n) n = Math.min(Math.max(Number(body.n), 1), 20);
  } catch {
    // body is optional
  }

  // Get the call's lat/lng
  const call = await queryFirst<{ latitude: number | null; longitude: number | null; id: number }>(
    db,
    'SELECT id, latitude, longitude FROM calls_for_service WHERE id = ?',
    callId,
  );
  if (!call) return c.json({ ok: false, error: 'call not found' }, 404);
  if (!call.latitude || !call.longitude) {
    return c.json({ ok: false, error: 'call has no GPS coordinates' }, 422);
  }

  // Get all available units with GPS position
  const availableUnits = await query<{
    id: number;
    call_sign: string | null;
    status: string | null;
    latitude: number | null;
    longitude: number | null;
    officer_name: string | null;
  }>(db, `
    SELECT u.id, u.call_sign, u.status, u.latitude, u.longitude,
           usr.full_name AS officer_name
      FROM units u
      LEFT JOIN users usr ON usr.id = u.officer_id
     WHERE u.status IN ('available', 'on_duty', 'patrol')
       AND u.latitude IS NOT NULL
       AND u.longitude IS NOT NULL
  `);

  if (availableUnits.length === 0) {
    return c.json({ ok: true, suggestions: [] });
  }

  // Get active call counts per unit
  const unitIds = availableUnits.map((u) => u.id);
  // Chunk-safe: if > 100 units, chunking needed. Typically small.
  const activeCounts: Record<number, number> = {};
  if (unitIds.length > 0) {
    // Use chunked approach for safety
    const chunkSize = 90;
    for (let i = 0; i < unitIds.length; i += chunkSize) {
      const chunk = unitIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      const rows = await query<{ unit_id: number; active_calls: number }>(db,
        `SELECT da.unit_id, COUNT(DISTINCT da.call_id) AS active_calls
           FROM dispatch_assignments da
           JOIN calls_for_service c ON c.id = da.call_id
          WHERE da.unit_id IN (${placeholders})
            AND COALESCE(c.status,'') NOT IN ('closed','cleared','cancelled','canceled','archived','merged')
          GROUP BY da.unit_id`,
        ...chunk);
      for (const r of rows) activeCounts[r.unit_id] = r.active_calls;
    }
  }

  // Score each unit: lower is better
  // score = distance_miles + (active_calls * 2)  — workload penalty of 2 mi per active call
  const WORKLOAD_PENALTY_MILES = 2;
  const scored = availableUnits.map((u) => {
    const dist = haversineMiles(call.latitude!, call.longitude!, u.latitude!, u.longitude!);
    const activeCalls = activeCounts[u.id] ?? 0;
    const score = dist + activeCalls * WORKLOAD_PENALTY_MILES;
    return { unit_id: u.id, call_sign: u.call_sign, officer_name: u.officer_name,
             distance_miles: Math.round(dist * 100) / 100, active_calls: activeCalls,
             score: Math.round(score * 100) / 100 };
  });

  scored.sort((a, b) => a.score - b.score);
  return c.json({ ok: true, suggestions: scored.slice(0, n) });
});

// GET /api/dispatch/calls/:id/notes/export
callExtras.get('/:id/notes/export', async (c) => {
  const db = getDb(c.env);
  const callId = Number(c.req.param('id'));
  if (!callId) return c.json({ ok: false, error: 'invalid call id' }, 400);

  const call = await queryFirst<{ call_number: string | null; incident_type: string | null; location_address: string | null; created_at: string | null }>(
    db,
    'SELECT call_number, incident_type, location_address, created_at FROM calls_for_service WHERE id = ?',
    callId,
  );
  if (!call) return c.json({ ok: false, error: 'call not found' }, 404);

  const notes = await query<{ note: string; created_at: string; full_name: string | null; call_sign: string | null }>(
    db,
    `SELECT cn.note, cn.created_at,
            u.full_name, u.call_sign
       FROM call_notes cn
       LEFT JOIN users u ON u.id = cn.user_id
      WHERE cn.call_id = ?
      ORDER BY cn.created_at ASC`,
    callId,
  );

  // Format as plain text
  const header = [
    `CALL NOTES EXPORT`,
    `Call #: ${call.call_number ?? callId}`,
    `Type:   ${call.incident_type ?? 'N/A'}`,
    `Addr:   ${call.location_address ?? 'N/A'}`,
    `Date:   ${call.created_at ?? 'N/A'}`,
    `${'─'.repeat(60)}`,
    '',
  ].join('\n');

  const body = notes.map((n) => {
    const d = new Date(n.created_at);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const author = n.call_sign ?? n.full_name ?? 'Unknown';
    return `[${hh}:${mm}] ${author}: ${n.note}`;
  }).join('\n');

  const text = header + (body || '(no notes)');

  c.header('Content-Type', 'text/plain; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="call-${callId}-notes.txt"`);
  return c.text(text);
});

export default callExtras;
