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
import {
  parseTemplateSchema,
  validateAnswers,
  getEscalations,
  InvalidTemplateError,
  type InspectionAnswers,
} from '../utils/inspectionTemplates';
import { emitFleetioEvent } from '../utils/fleetio/events';
import { putEncrypted, getDecrypted } from '../utils/encryptedR2';

import { dbErrorResponse } from '../utils/dbErrors';
import { log } from '../utils/logger';
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
    return dbErrorResponse(c, err, 'Failed to load inspection');
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

    // PR 6 — template + per-item answers. Optional; if absent, the legacy
    // walkthrough fields still drive the row. Validation happens against the
    // template's parsed schema; on a validation problem we surface 400 and
    // DON'T touch D1.
    const templateIdRaw = body.template_id;
    const templateId = typeof templateIdRaw === 'number' && Number.isInteger(templateIdRaw) && templateIdRaw > 0
      ? templateIdRaw
      : (typeof templateIdRaw === 'string' && /^\d+$/.test(templateIdRaw) ? parseInt(templateIdRaw, 10) : null);
    const rawItems = body.items;
    const hasTemplateAnswers = templateId != null && rawItems && typeof rawItems === 'object';
    let itemsJson: string | null = null;
    let escalations: ReturnType<typeof getEscalations> = [];
    let templateSchema: ReturnType<typeof parseTemplateSchema> | null = null;
    if (hasTemplateAnswers) {
      const tmplRow = await queryFirst<{ id: number; schema_json: string; active: number }>(
        db, 'SELECT id, schema_json, active FROM inspection_templates WHERE id = ?', templateId,
      );
      if (!tmplRow) {
        return c.json({ error: 'Template not found', code: 'TEMPLATE_NOT_FOUND' }, 404);
      }
      try {
        templateSchema = parseTemplateSchema(tmplRow.schema_json);
      } catch (err) {
        log.error('POST /by-token/:token failed', { src: 'src/routes/inspections.ts' }, err);
        if (err instanceof InvalidTemplateError) {
          return c.json({ error: `Template ${templateId} has invalid schema`, code: 'TEMPLATE_INVALID_SCHEMA', detail: err.message }, 500);
        }
        throw err;
      }
      const result = validateAnswers(templateSchema, rawItems as InspectionAnswers);
      if (!result.ok) {
        return c.json({ error: 'Invalid item answers', code: 'INVALID_ANSWERS', problems: result.problems }, 400);
      }
      itemsJson = JSON.stringify(rawItems);
      escalations = getEscalations(templateSchema, rawItems as InspectionAnswers, result.failed);
    }

    const existing = await queryFirst<{ id: number }>(db,
      `SELECT id FROM vehicle_inspections WHERE time_entry_id = ? AND phase = ?`, entry.id, phase);

    let inspectionId: number;
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
                completed_at = COALESCE(?, completed_at),
                template_id = COALESCE(?, template_id),
                items_json = COALESCE(?, items_json)
          WHERE id = ?`,
        fuel, odo, equipment, damage, photos, exterior, notes, completed,
        templateId, itemsJson, existing.id);
      inspectionId = existing.id;
    } else {
      const ins = await execute(db,
        `INSERT INTO vehicle_inspections
            (time_entry_id, officer_id, vehicle_id, phase, fuel_level, odometer,
             equipment_json, damage_notes, photo_keys_json, exterior_ok, notes, completed_at,
             template_id, items_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        entry.id, entry.officer_id, entry.vehicle_id, phase, fuel, odo,
        equipment, damage, photos, exterior, notes, completed,
        templateId, itemsJson);
      inspectionId = Number(ins.meta.last_row_id);
    }

    // Auto-escalation: for every failed item with fail_creates_issue=true,
    // create a fleet_maintenance row (a "found-during-inspection" service
    // request) and stash the FIRST one's id on the inspection so the dossier
    // surfaces the link. Multiple failures roll into one rolled-up maintenance
    // row — splitting per-item is a Phase 2 cleanup.
    if (escalations.length > 0 && entry.vehicle_id != null) {
      try {
        const summary = `Auto-escalated from pre-trip inspection — ${escalations.length} failed item${escalations.length === 1 ? '' : 's'}: ${escalations.map(e => e.label).join(', ')}`;
        const detail = JSON.stringify({ failed_items: escalations, inspection_id: inspectionId, phase });
        const res = await execute(db,
          // Write BOTH date columns. fleet_maintenance carries the service date
          // in performed_at (what 28 reader sites use, and the only one
          // populated on live) and service_date (what FleetViz used to read).
          // Writing only one made an escalated repair invisible to every
          // reader on the other column.
          `INSERT INTO fleet_maintenance
              (vehicle_id, performed_at, service_date, performed_by, description, notes,
               status, service_type, attachments_json)
           VALUES (?, date('now'), date('now'), ?, ?, ?, 'requested', 'inspection_failure', ?)`,
          entry.vehicle_id, entry.officer_id, summary, detail,
          // attachments_json: thumbnail list — pull any per-item photo keys.
          JSON.stringify(escalations.map(e => e.photo_key).filter(Boolean)),
        );
        const escalatedId = Number(res.meta.last_row_id);
        await execute(db,
          `UPDATE vehicle_inspections SET escalated_issue_id = ? WHERE id = ?`,
          escalatedId, inspectionId,
        );
        // Outbound emit so the failure shows up in Fleet.io's service-request
        // queue on the next */30 cron (PR 4 sync engine).
        try {
          c.executionCtx.waitUntil(
            emitFleetioEvent(c, 'inspection.submit', {
              inspection_id: inspectionId, phase, vehicle_id: entry.vehicle_id,
              escalated_fleet_maintenance_id: escalatedId,
              failed_items: escalations,
            }, {
              rmpgTable: 'vehicle_inspections',
              rmpgId: inspectionId,
              versionToken: `inspection.submit:${inspectionId}:${escalatedId}`,
            }),
          );
        } catch { /* executionCtx unavailable in tests */ }
      } catch (err) {
        // Don't fail the whole save on the cascade — the inspection record
        // is the authoritative one; surfacing the failure to the client only
        // confuses the operator who already finished the walkthrough.
        console.error('[inspections] auto-escalate failed:', err);
      }
    }

    return c.json(await shiftContext(db, entry));
  } catch (err) {
    console.error('POST /inspections/by-token failed:', err);
    return dbErrorResponse(c, err, 'Failed to save inspection');
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
    await putEncrypted(c.env.UPLOADS, db, c.env, key, body, { httpMetadata: { contentType } });

    return c.json({ key, slot, phase, size: body.byteLength });
  } catch (err) {
    console.error('POST /inspections/by-token/photos failed:', err);
    return dbErrorResponse(c, err, 'Photo upload failed');
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
    const decrypted = await getDecrypted(c.env.UPLOADS, db, c.env, key);
    if (decrypted) {
      return new Response(decrypted.bytes, {
        headers: {
          'Content-Type': decrypted.httpMetadata?.contentType || 'image/jpeg',
          'Cache-Control': 'private, max-age=300',
        },
      });
    }
    // getDecrypted() cleanly returns null when there's no file_encryption_keys
    // row for this key — the expected shape for every inspection photo
    // uploaded before this task shipped (this feature has been live). Fall
    // back to a raw R2 read so those photos stay reachable; only 404 if
    // NEITHER path finds bytes. A genuine decrypt failure (bad KEK, tampered
    // ciphertext) THROWS instead of returning null, so it propagates to the
    // outer catch below rather than silently masquerading as "legacy."
    const legacy = await c.env.UPLOADS.get(key);
    if (!legacy) return c.json({ error: 'Photo not found' }, 404);
    return new Response(legacy.body, {
      headers: {
        'Content-Type': legacy.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    console.error('GET /inspections/by-token/photo failed:', err);
    return dbErrorResponse(c, err, 'Photo fetch failed');
  }
});

export default inspections;
