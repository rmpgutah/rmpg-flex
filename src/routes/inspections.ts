// ============================================================
// RMPG Flex — Vehicle inspection (QR-token-authed)
// ------------------------------------------------------------
// The mobile inspection page at /m/shift/:token (no JWT) hits these routes.
// The qr_token on the matching OPEN time_entry (clock_out IS NULL) is both
// the identity and the credential for this shift's writes. The instant the
// officer clocks out, the token stops resolving — no per-token revocation
// table needed.
//
// Phases:
//   'pre'  — pre-shift walkthrough. Officer fills this right after Start Shift.
//   'post' — post-shift review. Officer fills this right before End Shift.
//
// Photos: streamed straight to R2 (UPLOADS bucket) under a stable key prefix
// so they're audit-recoverable per shift. We never accept arbitrary keys from
// the client — the server mints them.
// ============================================================
import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';

const inspections = new Hono<Env>();

interface TimeEntryRow {
  id: number; officer_id: number | null; vehicle_id: number | null; unit_id: number | null;
  clock_in: string | null; clock_out: string | null; qr_token: string | null;
  starting_mileage: number | null; ending_mileage: number | null;
}

// Resolve a token to its OPEN time_entry. Any miss / closed shift → null so
// callers can return 404 / 410 without leaking which case it was.
async function resolveToken(db: any, token: string): Promise<TimeEntryRow | null> {
  if (!token || typeof token !== 'string' || token.length < 8) return null;
  return (await queryFirst<TimeEntryRow>(db,
    `SELECT id, officer_id, vehicle_id, unit_id, clock_in, clock_out, qr_token, starting_mileage, ending_mileage
       FROM time_entries WHERE qr_token = ? AND clock_out IS NULL LIMIT 1`, token)) || null;
}

async function shiftContext(db: any, entry: TimeEntryRow) {
  const [officer, unit, vehicle, pre, post] = await Promise.all([
    entry.officer_id ? queryFirst<{ id: number; full_name: string; badge_number: string | null }>(db,
      `SELECT id, full_name, badge_number FROM users WHERE id = ?`, entry.officer_id) : Promise.resolve(null),
    entry.unit_id ? queryFirst<{ id: number; call_sign: string }>(db,
      `SELECT id, call_sign FROM units WHERE id = ?`, entry.unit_id) : Promise.resolve(null),
    entry.vehicle_id ? queryFirst<{ id: number; vehicle_number: string | null; vehicle_name: string | null; make: string | null; model: string | null }>(db,
      `SELECT id, vehicle_number, vehicle_name, make, model FROM fleet_vehicles WHERE id = ?`, entry.vehicle_id) : Promise.resolve(null),
    queryFirst<Record<string, any>>(db, `SELECT * FROM vehicle_inspections WHERE time_entry_id = ? AND phase = 'pre'`, entry.id),
    queryFirst<Record<string, any>>(db, `SELECT * FROM vehicle_inspections WHERE time_entry_id = ? AND phase = 'post'`, entry.id),
  ]);
  // Active phase: pre until submitted, then post is open until clock-out.
  const active_phase = !pre?.completed_at ? 'pre' : (!post?.completed_at ? 'post' : 'done');
  return {
    time_entry_id: entry.id,
    clock_in: entry.clock_in,
    starting_mileage: entry.starting_mileage,
    officer, unit, vehicle,
    pre_inspection: pre || null,
    post_inspection: post || null,
    active_phase,
  };
}

// GET /by-token/:token — load shift context + any existing inspection rows.
inspections.get('/by-token/:token', async (c) => {
  try {
    const db = getDb(c.env);
    const entry = await resolveToken(db, c.req.param('token'));
    if (!entry) return c.json({ error: 'Invalid or expired shift token', code: 'TOKEN_INVALID' }, 404);
    return c.json(await shiftContext(db, entry));
  } catch (err) {
    console.error('GET /inspections/by-token failed:', err);
    return c.json({ error: 'Failed to load inspection', detail: (err as Error)?.message }, 500);
  }
});

// POST /by-token/:token — upsert the inspection row for the requested phase.
inspections.post('/by-token/:token', async (c) => {
  try {
    const db = getDb(c.env);
    const entry = await resolveToken(db, c.req.param('token'));
    if (!entry) return c.json({ error: 'Invalid or expired shift token', code: 'TOKEN_INVALID' }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));

    const phase = body.phase === 'post' ? 'post' : 'pre';
    const fuel = typeof body.fuel_level === 'string' ? body.fuel_level : null;
    const odo = body.odometer != null && Number.isFinite(Number(body.odometer)) ? Number(body.odometer) : null;
    const equipment = body.equipment && typeof body.equipment === 'object' ? JSON.stringify(body.equipment) : null;
    const damage = typeof body.damage_notes === 'string' ? body.damage_notes : null;
    const photos = Array.isArray(body.photo_keys) ? JSON.stringify(body.photo_keys) : null;
    const exterior = body.exterior_ok === false ? 0 : 1;
    const notes = typeof body.notes === 'string' ? body.notes : null;
    const completed = body.completed === true ? new Date().toISOString() : null;

    const existing = await queryFirst<{ id: number }>(db,
      `SELECT id FROM vehicle_inspections WHERE time_entry_id = ? AND phase = ?`, entry.id, phase);

    if (existing) {
      await execute(db,
        `UPDATE vehicle_inspections
            SET fuel_level = COALESCE(?, fuel_level),
                odometer = COALESCE(?, odometer),
                equipment_json = COALESCE(?, equipment_json),
                damage_notes = COALESCE(?, damage_notes),
                photo_keys_json = COALESCE(?, photo_keys_json),
                exterior_ok = ?,
                notes = COALESCE(?, notes),
                completed_at = COALESCE(?, completed_at)
          WHERE id = ?`,
        fuel, odo, equipment, damage, photos, exterior, notes, completed, existing.id);
    } else {
      await execute(db,
        `INSERT INTO vehicle_inspections
            (time_entry_id, officer_id, vehicle_id, phase, fuel_level, odometer,
             equipment_json, damage_notes, photo_keys_json, exterior_ok, notes, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        entry.id, entry.officer_id, entry.vehicle_id, phase, fuel, odo,
        equipment, damage, photos, exterior, notes, completed);
    }

    return c.json(await shiftContext(db, entry));
  } catch (err) {
    console.error('POST /inspections/by-token failed:', err);
    return c.json({ error: 'Failed to save inspection', detail: (err as Error)?.message }, 500);
  }
});

// POST /by-token/:token/photos — upload one photo to R2 and return the key.
// Body is a raw image blob (image/jpeg). Caller passes ?phase=pre|post&slot=front
// so the key encodes which side / phase the photo is. The mobile page resizes
// client-side before upload (no need to do it server-side on Workers).
inspections.post('/by-token/:token/photos', async (c) => {
  try {
    const db = getDb(c.env);
    const entry = await resolveToken(db, c.req.param('token'));
    if (!entry) return c.json({ error: 'Invalid or expired shift token', code: 'TOKEN_INVALID' }, 404);

    const phase = c.req.query('phase') === 'post' ? 'post' : 'pre';
    const slot = (c.req.query('slot') || 'misc').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'misc';
    const contentType = c.req.header('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return c.json({ error: 'Only image/* uploads accepted', code: 'BAD_CONTENT_TYPE' }, 415);
    }
    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0) return c.json({ error: 'Empty upload', code: 'EMPTY' }, 400);
    if (body.byteLength > 6_000_000) return c.json({ error: 'Photo too large (>6MB after resize?)', code: 'TOO_LARGE' }, 413);

    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const key = `vehicle-inspections/${entry.id}/${phase}/${slot}-${crypto.randomUUID()}.${ext}`;
    await c.env.UPLOADS.put(key, body, { httpMetadata: { contentType } });

    return c.json({ key, slot, phase, size: body.byteLength });
  } catch (err) {
    console.error('POST /inspections/by-token/photos failed:', err);
    return c.json({ error: 'Photo upload failed', detail: (err as Error)?.message }, 500);
  }
});

// GET /by-token/:token/photo?key=... — stream a photo back (for review on the
// same mobile page). Restricted to keys under this shift's prefix.
inspections.get('/by-token/:token/photo', async (c) => {
  try {
    const db = getDb(c.env);
    const entry = await resolveToken(db, c.req.param('token'));
    if (!entry) return c.json({ error: 'Invalid or expired shift token', code: 'TOKEN_INVALID' }, 404);
    const key = c.req.query('key') || '';
    const expected = `vehicle-inspections/${entry.id}/`;
    if (!key.startsWith(expected)) return c.json({ error: 'Key not in this shift', code: 'KEY_FOREIGN' }, 403);
    const obj = await c.env.UPLOADS.get(key);
    if (!obj) return c.json({ error: 'Photo not found' }, 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    console.error('GET /inspections/by-token/photo failed:', err);
    return c.json({ error: 'Photo fetch failed', detail: (err as Error)?.message }, 500);
  }
});

export default inspections;
