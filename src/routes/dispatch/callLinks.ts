// Persons / vehicles / property linkage for a dispatch CFS.
//
// DispatchPage already wires the search → attach UI for all three
// (see DispatchPage.tsx around the call-detail panel, lines ~380–500).
// These routes are the missing server side. Search itself lives at
// /api/records/persons/search, /api/records/vehicles/search, and
// /api/records/properties — those endpoints already work.
//
// Broadcasts use main's per-isolate sendToUser + broadcastAll from
// src/routes/ws.ts. broadcastAll fans out to every connected client
// in this isolate so dispatcher screens re-render in real time;
// sendToUser targets the assigned officer's MDT for voice prompts.

import { Hono } from 'hono';
import { requireRole } from '../../middleware/auth';
import type { Env } from '../../types';
import { LIST_VIEW_SELECT } from './calls';
import { getDb, query, queryFirst, execute, queryInChunks } from '../../utils/db';
import { emitAlert } from '../../utils/alertHub';
import { findOrCreateBusiness } from '../../utils/serveIntakeRecords';
import { screenPersonForSor } from '../../utils/screening/nsopwAdapter';
import { log } from '../../utils/logger';
// Live D1 stores literal "None"/"N/A"/"0" in flag columns rather than NULL, so a
// naive truthiness check fires a bogus officer-safety alert on a subject with no
// flags. isFlagSet() (shared) treats those sentinels as absent.
import { isFlagSet } from '../../utils/sentinel';

const links = new Hono<Env>();

const SAFETY_RELEVANT_ROLES = new Set([
  'suspect', 'defendant', 'involved', 'serve_recipient', 'serve_recipient_agent', 'subject',
]);

// ── Shared: officers assigned to the call, for targeted MDT push ──
async function getOfficerUserIdsForCall(
  db: ReturnType<typeof getDb>,
  callId: string | number,
): Promise<number[]> {
  const call = await queryFirst<{ assigned_unit_ids: string }>(
    db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', callId,
  );
  if (!call?.assigned_unit_ids) return [];
  let unitIds: number[] = [];
  try { unitIds = JSON.parse(call.assigned_unit_ids); } catch { return []; }
  if (unitIds.length === 0) return [];
  const rows = await queryInChunks<{ officer_id: number | null }>(
    db,
    unitIds,
    (ph) => `SELECT officer_id FROM units WHERE id IN (${ph}) AND officer_id IS NOT NULL`,
  );
  return rows.map((r) => r.officer_id!).filter((id): id is number => typeof id === 'number');
}

// ═══════════════════════════════════════════════════════════════════
// PERSONS
// ═══════════════════════════════════════════════════════════════════

// GET /dispatch/calls/:id/persons — joined with persons table so the
// client renders name/dob/phone without a second fetch per row.
links.get('/calls/:id/persons', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT cp.id, cp.call_id, cp.person_id, cp.role, cp.notes, cp.added_at,
            p.first_name, p.last_name, p.dob, p.gender, p.race,
            p.phone, p.address, p.caution_flags, p.is_sex_offender,
            p.gang_affiliation, p.probation_parole, p.flags
     FROM call_persons cp
     JOIN persons p ON cp.person_id = p.id
     WHERE cp.call_id = ?
     ORDER BY cp.added_at DESC LIMIT 500`,
    c.req.param('id'),
  );
  return c.json(rows);
});

// POST /dispatch/calls/:id/persons  body { person_id, role, notes? }
links.post('/calls/:id/persons', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const userId = c.get('userId') as number;
  const body = await c.req.json<{ person_id: number; role?: string; notes?: string }>();
  if (!body.person_id) return c.json({ error: 'person_id required' }, 400);

  // Confirm the person exists — defensive guard against stale
  // search-result clicks after a person was deleted.
  const person = await queryFirst<{ id: number; first_name: string; last_name: string }>(
    db, 'SELECT id, first_name, last_name FROM persons WHERE id = ?', body.person_id,
  );
  if (!person) return c.json({ error: 'Person not found' }, 404);

  // INSERT OR IGNORE so the unique(call_id, person_id, role) constraint
  // doesn't surface as a 500; the existing link is returned.
  await execute(
    db,
    // added_at explicit override — schema DEFAULT is UTC on Workers.
    `INSERT OR IGNORE INTO call_persons (call_id, person_id, role, notes, added_by, added_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    callId, body.person_id, body.role || 'subject', body.notes ?? null, userId,
  );
  const created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cp.*, p.first_name, p.last_name, p.dob,
            p.caution_flags, p.is_sex_offender, p.gang_affiliation
     FROM call_persons cp JOIN persons p ON cp.person_id = p.id
     WHERE cp.call_id = ? AND cp.person_id = ? AND cp.role = ?`,
    callId, body.person_id, body.role || 'subject',
  );

  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_person_added',
    call_id: Number(callId),
    link: created,
  });

  const linkedRole = body.role || 'subject';
  const isSafetyRelevant = SAFETY_RELEVANT_ROLES.has(linkedRole);

  // OFFICER SAFETY: if the linked person has active warrants AND their
  // role is safety-relevant (suspect, defendant, subject, etc.), fire the
  // call:warrant_alert. Non-threat roles (process_server, witness, victim,
  // attorney, etc.) are excluded — a process server having a warrant does
  // not constitute an officer safety concern on the call they're serving.
  if (isSafetyRelevant) {
    try {
      const wc = await queryFirst<{ n: number }>(
        db, "SELECT COUNT(*) AS n FROM warrants WHERE subject_person_id = ? AND status = 'active'", body.person_id,
      );
      if ((wc?.n ?? 0) > 0) {
        const subjectName = `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || 'Unknown subject';
        await emitAlert(c.env, 'call:warrant_alert', {
          call_id: Number(callId),
          person_id: body.person_id,
          personName: subjectName,
          subject_name: subjectName,
          warrantCount: wc?.n ?? 0,
        });
      }
    } catch (err) {
      log.warn('warrant-alert check failed (non-fatal)', { err });
    }

    c.executionCtx.waitUntil(
      screenPersonForSor(c.env, body.person_id, { triggeredBy: 'cfs_subject_add' })
        .catch((err) => log.warn('[nsopw] cfs_subject_add screen failed', { err })),
    );
  }

  // Officer MDT voice — "Subject added: <last name>". Person flags
  // (caution / sex_offender / gang) deserve an officer-safety push,
  // not a generic "person added" prompt — but only for safety-relevant roles.
  const officerIds = await getOfficerUserIdsForCall(db, callId);
  if (officerIds.length > 0 && isSafetyRelevant) {
    const flag = created;
    const hasSafety = isFlagSet(flag?.caution_flags) || isFlagSet(flag?.is_sex_offender) || isFlagSet(flag?.gang_affiliation);
    const short = hasSafety
      ? `Subject added with caution flag: ${person.last_name}`
      : `Subject added: ${person.last_name}`;
    for (const uid of officerIds) {
      // Targeted to the assigned officer's MDT via AlertHubDO + target_user_id
      // (the voice hook filters on it). sendToUser was per-isolate-dead, so this
      // caution-flag voice cue reached the officer never.
      await emitAlert(c.env, 'call_status_for_officer', {
        action: 'note_added', call_id: Number(callId), target_user_id: uid, short,
      });
    }
  }
  // Return warrant hits in the response so the client can surface them
  // without a second fetch. We query here (separate from the officer-safety
  // alert path above) so the hits are always returned regardless of role.
  let warrant_hits: Array<{
    warrant_id: number;
    charge: string | null;
    status: string;
    issued_date: string | null;
  }> = [];
  try {
    warrant_hits = await query<{
      warrant_id: number;
      charge: string | null;
      status: string;
      issued_date: string | null;
    }>(
      db,
      `SELECT id AS warrant_id,
              COALESCE(charge_description, offense_description, offense) AS charge,
              status, issued_date
       FROM warrants
       WHERE subject_person_id = ? AND LOWER(COALESCE(status,'')) IN ('active','outstanding')
       ORDER BY issued_date DESC LIMIT 20`,
      body.person_id,
    );
  } catch (err) {
    log.warn('warrant_hits fetch failed (non-fatal)', { err });
  }
  return c.json({ ...created, warrant_hits }, 201);
});

// DELETE /dispatch/calls/:id/persons/:linkId  (linkId = call_persons.id)
links.delete('/calls/:id/persons/:linkId', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const linkId = c.req.param('linkId');
  // Scope by callId so callers can't delete a link from another call
  // by guessing IDs.
  await execute(db, 'DELETE FROM call_persons WHERE id = ? AND call_id = ?', linkId, callId);
  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_person_removed', call_id: Number(callId), link_id: Number(linkId),
  });
  return c.json({ success: true });
});

// PATCH /dispatch/calls/:id/persons/:linkId — change role / notes
links.patch('/calls/:id/persons/:linkId', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const linkId = c.req.param('linkId');
  const body = await c.req.json<{ role?: string; notes?: string }>();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.role !== undefined) { sets.push('role = ?'); params.push(body.role); }
  if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes); }
  if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
  params.push(linkId, callId);
  await execute(
    db,
    `UPDATE call_persons SET ${sets.join(', ')} WHERE id = ? AND call_id = ?`,
    ...params,
  );
  const updated = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cp.*, p.first_name, p.last_name
     FROM call_persons cp JOIN persons p ON cp.person_id = p.id
     WHERE cp.id = ?`,
    linkId,
  );
  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_person_updated', call_id: Number(callId), link: updated,
  });
  return c.json(updated);
});

// POST /dispatch/calls/:id/persons/quick-add
//
// Fused find-or-create-then-link: caller posts person fields + role, server
// runs duplicate detection BEFORE creating a new persons row. Stops MNI
// fragmentation from a dispatcher typing "John Doe DOB:1985" into a new
// person row when a matching one already exists.
//
// Dedup key: LOWER(last_name) + LOWER(first_name), plus dob when supplied.
// Returns 409 with the candidate list. Caller picks via merge_into_id
// (link the existing record) or force_create:true (create new anyway).
//
// Static segment beats :linkId in Hono's router without explicit ordering
// because it's registered first. Keep static routes above parameterized ones.
links.post('/calls/:id/persons/quick-add', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const userId = c.get('userId') as number;
  const body = await c.req.json<{
    first_name?: string; last_name?: string; dob?: string;
    role?: string; notes?: string;
    merge_into_id?: number; force_create?: boolean;
    // Optional extras carried through to the persons row on create:
    gender?: string; race?: string; phone?: string; address?: string;
  }>();

  let personId: number;
  let createdNew = false;

  if (body.merge_into_id) {
    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM persons WHERE id = ?', body.merge_into_id,
    );
    if (!existing) return c.json({ error: 'merge_into_id not found' }, 404);
    personId = existing.id;
  } else {
    if (!body.first_name || !body.last_name) {
      return c.json({ error: 'first_name and last_name required' }, 400);
    }

    // Duplicate scan. Phone gives a strong false-positive signal too but the
    // existing persons schema doesn't enforce normalization, so we stick to
    // (last_name, first_name [, dob]) — same heuristic Spillman uses.
    const dupConditions: string[] = [
      'LOWER(last_name) = LOWER(?)',
      'LOWER(first_name) = LOWER(?)',
    ];
    const dupParams: unknown[] = [body.last_name, body.first_name];
    if (body.dob) { dupConditions.push('dob = ?'); dupParams.push(body.dob); }
    const candidates = await query<Record<string, unknown>>(
      db,
      `SELECT id, first_name, last_name, dob, address, phone,
              caution_flags, is_sex_offender, gang_affiliation, probation_parole
       FROM persons WHERE ${dupConditions.join(' AND ')}
       ORDER BY last_name, first_name LIMIT 10`,
      ...dupParams,
    );

    if (candidates.length > 0 && !body.force_create) {
      return c.json({
        code: 'DUPLICATE_CANDIDATES',
        message: `Found ${candidates.length} possible existing person(s). Resend with merge_into_id to link an existing record, or force_create:true to create a new one.`,
        candidates,
      }, 409);
    }

    const result = await execute(
      db,
      `INSERT INTO persons (first_name, last_name, dob, gender, race, address, phone)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      body.first_name, body.last_name, body.dob ?? null,
      body.gender ?? null, body.race ?? null,
      body.address ?? null, body.phone ?? null,
    );
    personId = Number(result.meta.last_row_id);
    createdNew = true;
  }

  // Reuse main's link insertion pattern (INSERT OR IGNORE). Timestamps are UTC
  // via datetime('now') — the old "-6h MDT" note was stale and wrong.
  const role = body.role || 'subject';
  await execute(
    db,
    `INSERT OR IGNORE INTO call_persons (call_id, person_id, role, notes, added_by, added_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    callId, personId, role, body.notes ?? null, userId,
  );
  const link = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cp.*, p.first_name, p.last_name, p.dob,
            p.caution_flags, p.is_sex_offender, p.gang_affiliation
     FROM call_persons cp JOIN persons p ON cp.person_id = p.id
     WHERE cp.call_id = ? AND cp.person_id = ? AND cp.role = ?`,
    callId, personId, role,
  );

  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_person_added', call_id: Number(callId), link,
  });

  // Same officer-safety push the regular POST does — quick-add path
  // shouldn't bypass the MDT voice warning. Only for safety-relevant roles.
  if (SAFETY_RELEVANT_ROLES.has(role)) {
    const officerIds = await getOfficerUserIdsForCall(db, callId);
    if (officerIds.length > 0 && link) {
      const flag = link;
      const hasSafety = isFlagSet(flag?.caution_flags) || isFlagSet(flag?.is_sex_offender) || isFlagSet(flag?.gang_affiliation);
      const short = hasSafety
        ? `Subject added with caution flag: ${flag?.last_name ?? ''}`
        : `Subject added: ${flag?.last_name ?? ''}`;
      for (const uid of officerIds) {
        await emitAlert(c.env, 'call_status_for_officer', {
          action: 'note_added', call_id: Number(callId), target_user_id: uid, short,
        });
      }
    }
  }

  return c.json({ created: createdNew, person_id: personId, link }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// VEHICLES
// ═══════════════════════════════════════════════════════════════════

links.get('/calls/:id/vehicles', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT cv.id, cv.call_id, cv.vehicle_id, cv.role, cv.notes, cv.added_at,
            v.plate_number, v.state, v.make, v.model, v.year, v.color, v.vin,
            v.owner_person_id, op.first_name as owner_first, op.last_name as owner_last
     FROM call_vehicles cv
     JOIN vehicles_records v ON cv.vehicle_id = v.id
     LEFT JOIN persons op ON v.owner_person_id = op.id
     WHERE cv.call_id = ?
     ORDER BY cv.added_at DESC LIMIT 500`,
    c.req.param('id'),
  );
  return c.json(rows);
});

links.post('/calls/:id/vehicles', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const userId = c.get('userId') as number;
  const body = await c.req.json<{ vehicle_id: number; role?: string; notes?: string }>();
  if (!body.vehicle_id) return c.json({ error: 'vehicle_id required' }, 400);

  const vehicle = await queryFirst<{
    id: number; plate_number: string | null; make: string | null; model: string | null;
  }>(db, 'SELECT id, plate_number, make, model FROM vehicles_records WHERE id = ?', body.vehicle_id);
  if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404);

  await execute(
    db,
    `INSERT OR IGNORE INTO call_vehicles (call_id, vehicle_id, role, notes, added_by, added_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    callId, body.vehicle_id, body.role || 'subject', body.notes ?? null, userId,
  );
  const created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cv.*, v.plate_number, v.state, v.make, v.model, v.year, v.color
     FROM call_vehicles cv JOIN vehicles_records v ON cv.vehicle_id = v.id
     WHERE cv.call_id = ? AND cv.vehicle_id = ? AND cv.role = ?`,
    callId, body.vehicle_id, body.role || 'subject',
  );

  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_vehicle_added', call_id: Number(callId), link: created,
  });

  const officerIds = await getOfficerUserIdsForCall(db, callId);
  if (officerIds.length > 0) {
    const short = vehicle.plate_number
      ? `Vehicle added: plate ${vehicle.plate_number}`
      : (`Vehicle added: ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle added');
    for (const uid of officerIds) {
      // Targeted to the assigned officer's MDT via AlertHubDO + target_user_id
      // (the voice hook filters on it). sendToUser was per-isolate-dead, so this
      // caution-flag voice cue reached the officer never.
      await emitAlert(c.env, 'call_status_for_officer', {
        action: 'note_added', call_id: Number(callId), target_user_id: uid, short,
      });
    }
  }
  return c.json(created, 201);
});

links.delete('/calls/:id/vehicles/:linkId', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const linkId = c.req.param('linkId');
  await execute(db, 'DELETE FROM call_vehicles WHERE id = ? AND call_id = ?', linkId, callId);
  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_vehicle_removed', call_id: Number(callId), link_id: Number(linkId),
  });
  return c.json({ success: true });
});

links.patch('/calls/:id/vehicles/:linkId', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const linkId = c.req.param('linkId');
  const body = await c.req.json<{ role?: string; notes?: string }>();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.role !== undefined) { sets.push('role = ?'); params.push(body.role); }
  if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes); }
  if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
  params.push(linkId, callId);
  await execute(
    db,
    `UPDATE call_vehicles SET ${sets.join(', ')} WHERE id = ? AND call_id = ?`,
    ...params,
  );
  const updated = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cv.*, v.plate_number, v.make, v.model
     FROM call_vehicles cv JOIN vehicles_records v ON cv.vehicle_id = v.id
     WHERE cv.id = ?`,
    linkId,
  );
  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_vehicle_updated', call_id: Number(callId), link: updated,
  });
  return c.json(updated);
});

// POST /dispatch/calls/:id/vehicles/quick-add
//
// Same protocol as persons/quick-add. Dedup priority: VIN (strong, unique
// across the fleet by design) over plate_number+state (weaker — same plate
// can be re-issued across years, but the false-positive cost in active
// dispatch is low vs the fragmentation cost of creating duplicate vehicles
// for the same physical car).
links.post('/calls/:id/vehicles/quick-add', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const userId = c.get('userId') as number;
  const body = await c.req.json<{
    plate_number?: string; state?: string; vin?: string;
    make?: string; model?: string; year?: number | string;
    color?: string; owner_person_id?: number;
    role?: string; notes?: string;
    merge_into_id?: number; force_create?: boolean;
  }>();

  let vehicleId: number;
  let createdNew = false;

  if (body.merge_into_id) {
    const existing = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM vehicles_records WHERE id = ?', body.merge_into_id,
    );
    if (!existing) return c.json({ error: 'merge_into_id not found' }, 404);
    vehicleId = existing.id;
  } else {
    if (!body.plate_number && !body.vin) {
      return c.json({ error: 'plate_number or vin required' }, 400);
    }

    let candidates: Record<string, unknown>[] = [];
    if (body.vin) {
      candidates = await query<Record<string, unknown>>(
        db,
        `SELECT id, make, model, year, color, plate_number, state, vin, owner_person_id
         FROM vehicles_records WHERE UPPER(vin) = UPPER(?) LIMIT 10`,
        body.vin,
      );
    } else if (body.plate_number) {
      const dupConditions: string[] = ['UPPER(plate_number) = UPPER(?)'];
      const dupParams: unknown[] = [body.plate_number];
      if (body.state) { dupConditions.push('UPPER(state) = UPPER(?)'); dupParams.push(body.state); }
      candidates = await query<Record<string, unknown>>(
        db,
        `SELECT id, make, model, year, color, plate_number, state, vin, owner_person_id
         FROM vehicles_records WHERE ${dupConditions.join(' AND ')} LIMIT 10`,
        ...dupParams,
      );
    }

    if (candidates.length > 0 && !body.force_create) {
      return c.json({
        code: 'DUPLICATE_CANDIDATES',
        message: `Found ${candidates.length} possible existing vehicle(s). Resend with merge_into_id to link an existing record, or force_create:true to create a new one.`,
        candidates,
      }, 409);
    }

    const result = await execute(
      db,
      `INSERT INTO vehicles_records (plate_number, state, vin, make, model, year, color, owner_person_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      body.plate_number ?? null, body.state ?? null, body.vin ?? null,
      body.make ?? null, body.model ?? null, body.year ?? null,
      body.color ?? null, body.owner_person_id ?? null,
    );
    vehicleId = Number(result.meta.last_row_id);
    createdNew = true;
  }

  const role = body.role || 'subject';
  await execute(
    db,
    `INSERT OR IGNORE INTO call_vehicles (call_id, vehicle_id, role, notes, added_by, added_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    callId, vehicleId, role, body.notes ?? null, userId,
  );
  const link = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cv.*, v.plate_number, v.state, v.make, v.model, v.year, v.color
     FROM call_vehicles cv JOIN vehicles_records v ON cv.vehicle_id = v.id
     WHERE cv.call_id = ? AND cv.vehicle_id = ? AND cv.role = ?`,
    callId, vehicleId, role,
  );

  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_vehicle_added', call_id: Number(callId), link,
  });

  const officerIds = await getOfficerUserIdsForCall(db, callId);
  if (officerIds.length > 0 && link) {
    const v = link;
    const short = v.plate_number
      ? `Vehicle added: plate ${v.plate_number}`
      : (`Vehicle added: ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle added');
    for (const uid of officerIds) {
      // Targeted to the assigned officer's MDT via AlertHubDO + target_user_id
      // (the voice hook filters on it). sendToUser was per-isolate-dead, so this
      // caution-flag voice cue reached the officer never.
      await emitAlert(c.env, 'call_status_for_officer', {
        action: 'note_added', call_id: Number(callId), target_user_id: uid, short,
      });
    }
  }

  return c.json({ created: createdNew, vehicle_id: vehicleId, link }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// PROPERTY (1:1 via calls_for_service.property_id)
// ═══════════════════════════════════════════════════════════════════
//
// Single-property attachment. PUT sets property_id; DELETE clears it.
// PUT carries an optional `inherit_address=true` flag — when true,
// the property's address overwrites the call's location_address so
// the dispatcher doesn't have to re-type it (Spillman default).

links.put('/calls/:id/property', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const body = await c.req.json<{ property_id: number; inherit_address?: boolean }>();
  if (!body.property_id) return c.json({ error: 'property_id required' }, 400);

  const prop = await queryFirst<{
    id: number; name: string | null; address: string | null;
    client_id: number | null; latitude: number | null; longitude: number | null;
  }>(
    db,
    'SELECT id, name, address, client_id, latitude, longitude FROM properties WHERE id = ?',
    body.property_id,
  );
  if (!prop) return c.json({ error: 'Property not found' }, 404);

  const sets: string[] = ['property_id = ?', "updated_at = datetime('now')"];
  const params: unknown[] = [body.property_id];
  if (body.inherit_address && prop.address) {
    sets.push('location_address = ?');
    params.push(prop.address);
  }
  // If the property has a client and the call doesn't yet, inherit it.
  if (prop.client_id) {
    sets.push('client_id = COALESCE(client_id, ?)');
    params.push(prop.client_id);
  }
  // Inherit coords when present and call has none — keeps the map pin
  // accurate without an extra geocode hop.
  if (prop.latitude != null && prop.longitude != null) {
    sets.push('latitude = COALESCE(latitude, ?)', 'longitude = COALESCE(longitude, ?)');
    params.push(prop.latitude, prop.longitude);
  }
  params.push(callId);

  await execute(db, `UPDATE calls_for_service SET ${sets.join(', ')} WHERE id = ?`, ...params);
  const updated = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT ${LIST_VIEW_SELECT}, p.name as property_name, p.address as property_address,
            p.gate_code, p.alarm_code, p.emergency_contact, p.post_orders, p.hazard_notes
     FROM calls_for_service c
     LEFT JOIN properties p ON c.property_id = p.id
     WHERE c.id = ?`,
    callId,
  );

  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_property_attached',
    call_id: Number(callId),
    property_id: body.property_id,
    call: updated,
  });

  // If the property carries hazard_notes, push them as an officer-safety
  // flag to each assigned officer's MDT — mirrors the legacy warnings path.
  if ((updated as Record<string, unknown>)?.hazard_notes) {
    const officerIds = await getOfficerUserIdsForCall(db, callId);
    for (const uid of officerIds) {
      await emitAlert(c.env, 'dispatch_alert', {
        call_id: Number(callId),
        target_user_id: uid,
        message: `PROPERTY HAZARD ON FILE${prop.name ? ` — ${prop.name}` : ''}`,
        warnings: [{
          type: 'HAZARD',
          label: 'PROPERTY HAZARD ON FILE',
          severity: 'high',
          source: prop.name || 'Property',
        }],
      });
    }
  }
  return c.json(updated);
});

links.delete('/calls/:id/property', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  await execute(
    db,
    `UPDATE calls_for_service SET property_id = NULL, updated_at = datetime('now') WHERE id = ?`,
    callId,
  );
  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_property_detached', call_id: Number(callId),
  });
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
// BUSINESSES  (call_businesses → businesses table; FK-correct, consistent
// with serve-intake. NOT the properties-backed /records/businesses.)
// ═══════════════════════════════════════════════════════════════════

// GET /dispatch/business-search?q= — typeahead against the businesses table.
links.get('/business-search', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const q = (c.req.query('q') || '').trim().toLowerCase();
  if (q.length < 2) return c.json([]);
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT id, name, address, city, state, phone, business_type
       FROM businesses
      WHERE archived_at IS NULL AND LOWER(name) LIKE ?
      ORDER BY name LIMIT 10`,
    `%${q}%`,
  );
  return c.json(rows);
});

// GET /dispatch/calls/:id/businesses — joined with businesses for one-fetch render.
links.get('/calls/:id/businesses', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT cb.id, cb.call_id, cb.business_id, cb.role, cb.notes, cb.created_at,
            b.name, b.address, b.city, b.state, b.phone, b.business_type
       FROM call_businesses cb
       JOIN businesses b ON cb.business_id = b.id
      WHERE cb.call_id = ?
      ORDER BY cb.created_at DESC LIMIT 200`,
    c.req.param('id'),
  );
  return c.json(rows);
});

// POST /dispatch/calls/:id/businesses  body { business_id, role?, notes? }
links.post('/calls/:id/businesses', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const userId = c.get('userId') as number;
  const body = await c.req.json<{ business_id: number; role?: string; notes?: string }>();
  if (!body.business_id) return c.json({ error: 'business_id required' }, 400);
  const biz = await queryFirst<{ id: number }>(db, 'SELECT id FROM businesses WHERE id = ?', body.business_id);
  if (!biz) return c.json({ error: 'Business not found' }, 404);
  await execute(
    db,
    `INSERT OR IGNORE INTO call_businesses (call_id, business_id, role, notes, added_by, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    callId, body.business_id, body.role || 'involved', body.notes ?? null, userId,
  );
  const created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cb.*, b.name, b.address, b.city, b.state, b.phone, b.business_type
       FROM call_businesses cb JOIN businesses b ON cb.business_id = b.id
      WHERE cb.call_id = ? AND cb.business_id = ? AND cb.role = ?`,
    callId, body.business_id, body.role || 'involved',
  );
  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_business_added', call_id: Number(callId), link: created,
  });
  return c.json(created, 201);
});

// POST /dispatch/calls/:id/businesses/quick-add  body { name, address?, city?, state?, zip?, phone?, role? }
links.post('/calls/:id/businesses/quick-add', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const userId = c.get('userId') as number;
  const body = await c.req.json<{ name: string; address?: string; city?: string; state?: string; zip?: string; phone?: string; role?: string }>();
  if (!body.name || !body.name.trim()) return c.json({ error: 'name required' }, 400);
  const ref = await findOrCreateBusiness(db, {
    name: body.name.trim(), address: body.address || null, city: body.city || null,
    state: body.state || null, zip: body.zip || null, phone: body.phone || null,
    business_type: 'other', notes: 'Added via dispatch call linkage',
  });
  await execute(
    db,
    `INSERT OR IGNORE INTO call_businesses (call_id, business_id, role, added_by, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    callId, ref.id, body.role || 'involved', userId,
  );
  const created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cb.*, b.name, b.address, b.city, b.state, b.phone, b.business_type
       FROM call_businesses cb JOIN businesses b ON cb.business_id = b.id
      WHERE cb.call_id = ? AND cb.business_id = ? AND cb.role = ?`,
    callId, ref.id, body.role || 'involved',
  );
  await emitAlert(c.env, 'dispatch_update', { action: 'call_business_added', call_id: Number(callId), link: created });
  return c.json({ created: true, business_id: ref.id, link: created }, 201);
});

// DELETE /dispatch/calls/:id/businesses/:linkId
links.delete('/calls/:id/businesses/:linkId', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const linkId = c.req.param('linkId');
  await execute(db, 'DELETE FROM call_businesses WHERE id = ? AND call_id = ?', linkId, callId);
  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_business_removed', call_id: Number(callId), link_id: Number(linkId),
  });
  return c.json({ success: true });
});

// PATCH /dispatch/calls/:id/businesses/:linkId — change role / notes
links.patch('/calls/:id/businesses/:linkId', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const linkId = c.req.param('linkId');
  const body = await c.req.json<{ role?: string; notes?: string }>();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.role !== undefined) { sets.push('role = ?'); params.push(body.role); }
  if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes); }
  if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
  params.push(linkId, callId);
  await execute(db, `UPDATE call_businesses SET ${sets.join(', ')} WHERE id = ? AND call_id = ?`, ...params);
  const updated = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cb.*, b.name FROM call_businesses cb JOIN businesses b ON cb.business_id = b.id WHERE cb.id = ?`,
    linkId,
  );
  await emitAlert(c.env, 'dispatch_update', { action: 'call_business_updated', call_id: Number(callId), link: updated });
  return c.json(updated);
});

// ── Person Risk Scoring ──────────────────────────────────────
links.get('/persons/:id/risk-score', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  try {
    const db = getDb(c.env);
    const personId = parseInt(c.req.param('id') || '0', 10);
    let score = 0;
    const flags: string[] = [];
    const warrantCount = await queryFirst<{ n: number }>(
      db, "SELECT COUNT(*) AS n FROM warrants WHERE subject_person_id = ? AND status = 'active'", personId,
    );
    if (warrantCount?.n) { score += Math.min(warrantCount.n * 20, 60); flags.push(`${warrantCount.n} active warrant(s)`); }
    const cautionCount = await queryFirst<{ n: number }>(
      // There is no person_flags table — caution flags are a column on the
      // person row, so this is a presence check (0 or 1), not a tally.
      db, "SELECT COUNT(*) AS n FROM persons WHERE id = ? AND COALESCE(caution_flags, '') NOT IN ('', '[]', 'null')", personId,
    );
    if (cautionCount?.n) { score += Math.min(cautionCount.n * 5, 25); flags.push(`${cautionCount.n} caution flag(s)`); }
    const violentCount = await queryFirst<{ n: number }>(
      db, "SELECT COUNT(*) AS n FROM incident_persons ip JOIN incidents i ON ip.incident_id = i.id WHERE ip.person_id = ? AND i.incident_type LIKE '%assault%'", personId,
    ).catch(() => null);
    if (violentCount?.n) { score += Math.min(violentCount.n * 3, 15); flags.push(`${violentCount.n} violent incident(s)`); }
    return c.json({ person_id: personId, risk_score: Math.min(score, 100), risk_level: score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low', flags });
  } catch (err) {
    log.error('[callLinks] person risk score failed', {}, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Risk lookup failed' }, 500);
  }
});

// ── Protection Order Check ───────────────────────────────────
links.get('/persons/:id/protection-orders', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const personId = parseInt(c.req.param('id') || '0', 10);
  try {
    const orders = await query<{ case_number: string; status: string }>(
      db, "SELECT case_number, status FROM protection_orders WHERE respondent_person_id = ? AND status = 'active'", personId,
    );
    return c.json({ person_id: personId, active_orders: orders.length, orders });
  } catch (err) {
    log.error('[callLinks] protection-orders query failed', { personId }, err instanceof Error ? err : new Error(String(err)));
    return c.json({ error: 'Failed to check protection orders' }, 500);
  }
});

// ── INVOLVED PERSONS (inline — no FK to persons table) ─────────────────────
links.get('/calls/:id/involved-persons', requireRole('dispatcher', 'officer', 'supervisor', 'admin', 'manager', 'client_viewer', 'human_resources'), async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  try {
    const rows = await query<Record<string, unknown>>(db,
      'SELECT * FROM call_involved_persons WHERE call_id = ? ORDER BY created_at ASC',
      id,
    );
    return c.json(rows);
  } catch (err) {
    log.error('GET involved-persons failed', { callId: id }, err as Error);
    return c.json([], 200);
  }
});

links.post('/calls/:id/involved-persons', requireRole('dispatcher', 'officer', 'supervisor', 'admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const { name, dob, id_number, role } = body as { name: string; dob?: string; id_number?: string; role?: string };
  if (!name?.trim()) return c.json({ error: 'name is required' }, 400);
  try {
    const result = await execute(db,
      'INSERT INTO call_involved_persons (call_id, name, dob, id_number, role) VALUES (?, ?, ?, ?, ?)',
      id, name.trim(), dob || null, id_number || null, role || 'witness',
    );
    const created = await queryFirst<Record<string, unknown>>(db,
      'SELECT * FROM call_involved_persons WHERE id = ?',
      result.meta.last_row_id,
    );
    return c.json(created, 201);
  } catch (err) {
    log.error('POST involved-person failed', { callId: id }, err as Error);
    return c.json({ error: 'Failed to add person' }, 500);
  }
});

links.delete('/calls/:id/involved-persons/:entryId', requireRole('dispatcher', 'officer', 'supervisor', 'admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const entryId = Number(c.req.param('entryId'));
  await execute(db, 'DELETE FROM call_involved_persons WHERE id = ? AND call_id = ?', entryId, id);
  return c.json({ success: true });
});

// ── INVOLVED VEHICLES (inline — no FK to vehicles_records table) ────────────
links.get('/calls/:id/involved-vehicles', requireRole('dispatcher', 'officer', 'supervisor', 'admin', 'manager', 'client_viewer', 'human_resources'), async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  try {
    const rows = await query<Record<string, unknown>>(db,
      'SELECT * FROM call_involved_vehicles WHERE call_id = ? ORDER BY created_at ASC',
      id,
    );
    return c.json(rows);
  } catch (err) {
    log.error('GET involved-vehicles failed', { callId: id }, err as Error);
    return c.json([], 200);
  }
});

links.post('/calls/:id/involved-vehicles', requireRole('dispatcher', 'officer', 'supervisor', 'admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const { plate, make, model, color, role } = body as { plate?: string; make?: string; model?: string; color?: string; role?: string };
  try {
    const result = await execute(db,
      'INSERT INTO call_involved_vehicles (call_id, plate, make, model, color, role) VALUES (?, ?, ?, ?, ?, ?)',
      id, plate || null, make || null, model || null, color || null, role || 'involved',
    );
    const created = await queryFirst<Record<string, unknown>>(db,
      'SELECT * FROM call_involved_vehicles WHERE id = ?',
      result.meta.last_row_id,
    );
    return c.json(created, 201);
  } catch (err) {
    log.error('POST involved-vehicle failed', { callId: id }, err as Error);
    return c.json({ error: 'Failed to add vehicle' }, 500);
  }
});

links.delete('/calls/:id/involved-vehicles/:entryId', requireRole('dispatcher', 'officer', 'supervisor', 'admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const entryId = Number(c.req.param('entryId'));
  await execute(db, 'DELETE FROM call_involved_vehicles WHERE id = ? AND call_id = ?', entryId, id);
  return c.json({ success: true });
});

// ── NARRATIVE (reads/writes calls_for_service_ext.narrative) ────────────────
links.get('/calls/:id/narrative', requireRole('dispatcher', 'officer', 'supervisor', 'admin', 'manager', 'client_viewer', 'human_resources'), async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  try {
    const row = await queryFirst<{ narrative: string | null }>(db,
      'SELECT narrative FROM calls_for_service_ext WHERE id = ?',
      id,
    );
    return c.json({ narrative: row?.narrative ?? null });
  } catch {
    return c.json({ narrative: null });
  }
});

links.patch('/calls/:id/narrative', requireRole('dispatcher', 'officer', 'supervisor', 'admin', 'manager'), async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param('id'));
  const { narrative } = await c.req.json() as { narrative?: string };
  try {
    await execute(db,
      `INSERT INTO calls_for_service_ext (id, narrative) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET narrative = excluded.narrative`,
      id, narrative ?? null,
    );
    // Keep calls_for_service.action_taken synchronized with the narrative
    await execute(db,
      `UPDATE calls_for_service SET action_taken = ?, updated_at = datetime('now') WHERE id = ?`,
      narrative ?? null, id,
    );
    return c.json({ success: true, narrative: narrative ?? null });
  } catch (err) {
    log.error('PATCH narrative failed', { callId: id }, err as Error);
    return c.json({ error: 'Failed to save narrative' }, 500);
  }
});

// ── BOLO ↔ Call links ──────────────────────────────────────────
// Stores in call_bolos (call_id, bolo_id, linked_at, linked_by).
// Boot reconciler creates the table if it doesn't exist (matches
// the pattern used by alpr.ts, callLinks.ts column reconciler, etc.).
async function ensureCallBolosTable(db: ReturnType<typeof getDb>): Promise<void> {
  await execute(
    db,
    `CREATE TABLE IF NOT EXISTS call_bolos (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       call_id     INTEGER NOT NULL,
       bolo_id     INTEGER NOT NULL,
       linked_at   TEXT NOT NULL DEFAULT (datetime('now')),
       linked_by   INTEGER,
       UNIQUE(call_id, bolo_id)
     )`,
  );
}

// POST /dispatch/calls/:id/bolos  body { bolo_id }
links.post('/calls/:id/bolos', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const userId = c.get('userId') as number;
  const body = await c.req.json<{ bolo_id: number }>();
  if (!body.bolo_id) return c.json({ error: 'bolo_id required' }, 400);

  await ensureCallBolosTable(db);

  // Confirm the BOLO exists
  const bolo = await queryFirst<{ id: number }>(
    db, 'SELECT id FROM bolos WHERE id = ? LIMIT 1', body.bolo_id,
  );
  if (!bolo) return c.json({ error: 'BOLO not found' }, 404);

  await execute(
    db,
    `INSERT OR IGNORE INTO call_bolos (call_id, bolo_id, linked_at, linked_by)
     VALUES (?, ?, datetime('now'), ?)`,
    callId, body.bolo_id, userId,
  );

  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_bolo_linked',
    call_id: Number(callId),
    bolo_id: body.bolo_id,
  });

  return c.json({ success: true, call_id: Number(callId), bolo_id: body.bolo_id }, 201);
});

// GET /dispatch/calls/:id/bolos — linked BOLOs with full bolo details
links.get('/calls/:id/bolos', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';

  await ensureCallBolosTable(db);

  try {
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT cb.id AS link_id, cb.linked_at, cb.linked_by,
              b.id, b.id AS bolo_id, b.bolo_number, b.type, b.title,
              b.description, b.subject_description, b.vehicle_description,
              b.status, b.priority, b.expires_at
       FROM call_bolos cb
       JOIN bolos b ON b.id = cb.bolo_id
       WHERE cb.call_id = ?
       ORDER BY cb.linked_at DESC`,
      callId,
    );
    return c.json(rows);
  } catch (err) {
    log.error('[callLinks] GET /calls/:id/bolos failed', { callId }, err);
    return c.json({ error: 'Failed to fetch linked BOLOs' }, 500);
  }
});

// DELETE /dispatch/calls/:id/bolos/:boloId
links.delete('/calls/:id/bolos/:boloId', requireRole('dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id') || '';
  const boloId = c.req.param('boloId');

  await ensureCallBolosTable(db);
  await execute(db, 'DELETE FROM call_bolos WHERE call_id = ? AND bolo_id = ?', callId, boloId);
  await emitAlert(c.env, 'dispatch_update', {
    action: 'call_bolo_unlinked',
    call_id: Number(callId),
    bolo_id: Number(boloId),
  });
  return c.json({ success: true });
});

export default links;
