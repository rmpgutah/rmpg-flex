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
import type { Env } from '../../types';
import { LIST_VIEW_SELECT_C } from './calls';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { sendToUser, broadcastAll } from '../ws';

const links = new Hono<Env>();

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
  const placeholders = unitIds.map(() => '?').join(',');
  const rows = await query<{ officer_id: number | null }>(
    db,
    `SELECT officer_id FROM units WHERE id IN (${placeholders}) AND officer_id IS NOT NULL`,
    ...unitIds,
  );
  return rows.map((r) => r.officer_id!).filter((id): id is number => typeof id === 'number');
}

// ═══════════════════════════════════════════════════════════════════
// PERSONS
// ═══════════════════════════════════════════════════════════════════

// GET /dispatch/calls/:id/persons — joined with persons table so the
// client renders name/dob/phone without a second fetch per row.
links.get('/calls/:id/persons', async (c) => {
  const db = getDb(c.env);
  const rows = await query<Record<string, unknown>>(
    db,
    `SELECT cp.id, cp.call_id, cp.person_id, cp.role, cp.notes, cp.added_at,
            p.first_name, p.last_name, p.dob, p.gender, p.race,
            p.phone, p.address, p.caution_flags, p.is_sex_offender,
            p.gang_affiliation, p.probation_parole
     FROM call_persons cp
     JOIN persons p ON cp.person_id = p.id
     WHERE cp.call_id = ?
     ORDER BY cp.added_at DESC LIMIT 500`,
    c.req.param('id'),
  );
  return c.json(rows);
});

// POST /dispatch/calls/:id/persons  body { person_id, role, notes? }
links.post('/calls/:id/persons', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
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
     VALUES (?, ?, ?, ?, ?, datetime('now', '-7 hours'))`,
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

  broadcastAll('dispatch_update', {
    action: 'call_person_added',
    call_id: Number(callId),
    link: created,
  });

  // Officer MDT voice — "Subject added: <last name>". Person flags
  // (caution / sex_offender / gang) deserve an officer-safety push,
  // not a generic "person added" prompt.
  const officerIds = await getOfficerUserIdsForCall(db, callId);
  if (officerIds.length > 0) {
    const flag = created as any;
    const hasSafety = flag?.caution_flags || flag?.is_sex_offender || flag?.gang_affiliation;
    const short = hasSafety
      ? `Subject added with caution flag: ${person.last_name}`
      : `Subject added: ${person.last_name}`;
    for (const uid of officerIds) {
      sendToUser(uid, 'call_status_for_officer', {
        action: 'note_added', call_id: Number(callId), short,
      });
    }
  }
  return c.json(created, 201);
});

// DELETE /dispatch/calls/:id/persons/:linkId  (linkId = call_persons.id)
links.delete('/calls/:id/persons/:linkId', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
  const linkId = c.req.param('linkId');
  // Scope by callId so callers can't delete a link from another call
  // by guessing IDs.
  await execute(db, 'DELETE FROM call_persons WHERE id = ? AND call_id = ?', linkId, callId);
  broadcastAll('dispatch_update', {
    action: 'call_person_removed', call_id: Number(callId), link_id: Number(linkId),
  });
  return c.json({ success: true });
});

// PATCH /dispatch/calls/:id/persons/:linkId — change role / notes
links.patch('/calls/:id/persons/:linkId', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
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
  broadcastAll('dispatch_update', {
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
// Static segment beats :linkId in Hono's router, so this path takes
// precedence over PATCH /calls/:id/persons/:linkId without explicit order.
links.post('/calls/:id/persons/quick-add', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
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

  // Reuse main's link insertion pattern (INSERT OR IGNORE + -6h MDT timestamp).
  const role = body.role || 'subject';
  await execute(
    db,
    `INSERT OR IGNORE INTO call_persons (call_id, person_id, role, notes, added_by, added_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '-7 hours'))`,
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

  broadcastAll('dispatch_update', {
    action: 'call_person_added', call_id: Number(callId), link,
  });

  // Same officer-safety push the regular POST does — quick-add path
  // shouldn't bypass the MDT voice warning.
  const officerIds = await getOfficerUserIdsForCall(db, callId);
  if (officerIds.length > 0 && link) {
    const flag = link as any;
    const hasSafety = flag?.caution_flags || flag?.is_sex_offender || flag?.gang_affiliation;
    const short = hasSafety
      ? `Subject added with caution flag: ${flag?.last_name ?? ''}`
      : `Subject added: ${flag?.last_name ?? ''}`;
    for (const uid of officerIds) {
      sendToUser(uid, 'call_status_for_officer', {
        action: 'note_added', call_id: Number(callId), short,
      });
    }
  }

  return c.json({ created: createdNew, person_id: personId, link }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// VEHICLES
// ═══════════════════════════════════════════════════════════════════

links.get('/calls/:id/vehicles', async (c) => {
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

links.post('/calls/:id/vehicles', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
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
     VALUES (?, ?, ?, ?, ?, datetime('now', '-7 hours'))`,
    callId, body.vehicle_id, body.role || 'subject', body.notes ?? null, userId,
  );
  const created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cv.*, v.plate_number, v.state, v.make, v.model, v.year, v.color
     FROM call_vehicles cv JOIN vehicles_records v ON cv.vehicle_id = v.id
     WHERE cv.call_id = ? AND cv.vehicle_id = ? AND cv.role = ?`,
    callId, body.vehicle_id, body.role || 'subject',
  );

  broadcastAll('dispatch_update', {
    action: 'call_vehicle_added', call_id: Number(callId), link: created,
  });

  const officerIds = await getOfficerUserIdsForCall(db, callId);
  if (officerIds.length > 0) {
    const short = vehicle.plate_number
      ? `Vehicle added: plate ${vehicle.plate_number}`
      : (`Vehicle added: ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle added');
    for (const uid of officerIds) {
      sendToUser(uid, 'call_status_for_officer', {
        action: 'note_added', call_id: Number(callId), short,
      });
    }
  }
  return c.json(created, 201);
});

links.delete('/calls/:id/vehicles/:linkId', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
  const linkId = c.req.param('linkId');
  await execute(db, 'DELETE FROM call_vehicles WHERE id = ? AND call_id = ?', linkId, callId);
  broadcastAll('dispatch_update', {
    action: 'call_vehicle_removed', call_id: Number(callId), link_id: Number(linkId),
  });
  return c.json({ success: true });
});

links.patch('/calls/:id/vehicles/:linkId', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
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
  broadcastAll('dispatch_update', {
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
links.post('/calls/:id/vehicles/quick-add', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
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
     VALUES (?, ?, ?, ?, ?, datetime('now', '-7 hours'))`,
    callId, vehicleId, role, body.notes ?? null, userId,
  );
  const link = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cv.*, v.plate_number, v.state, v.make, v.model, v.year, v.color
     FROM call_vehicles cv JOIN vehicles_records v ON cv.vehicle_id = v.id
     WHERE cv.call_id = ? AND cv.vehicle_id = ? AND cv.role = ?`,
    callId, vehicleId, role,
  );

  broadcastAll('dispatch_update', {
    action: 'call_vehicle_added', call_id: Number(callId), link,
  });

  const officerIds = await getOfficerUserIdsForCall(db, callId);
  if (officerIds.length > 0 && link) {
    const v = link as any;
    const short = v.plate_number
      ? `Vehicle added: plate ${v.plate_number}`
      : (`Vehicle added: ${v.make || ''} ${v.model || ''}`.trim() || 'Vehicle added');
    for (const uid of officerIds) {
      sendToUser(uid, 'call_status_for_officer', {
        action: 'note_added', call_id: Number(callId), short,
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

links.put('/calls/:id/property', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
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

  const sets: string[] = ['property_id = ?', "updated_at = datetime('now', '-7 hours')"];
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
    `SELECT ${LIST_VIEW_SELECT_C}, p.name as property_name, p.address as property_address,
            p.gate_code, p.alarm_code, p.emergency_contact, p.post_orders, p.hazard_notes
     FROM calls_for_service c
     LEFT JOIN properties p ON c.property_id = p.id
     WHERE c.id = ?`,
    callId,
  );

  broadcastAll('dispatch_update', {
    action: 'call_property_attached',
    call_id: Number(callId),
    property_id: body.property_id,
    call: updated,
  });

  // If the property carries hazard_notes, push them as an officer-safety
  // flag to each assigned officer's MDT — mirrors the legacy warnings path.
  if ((updated as any)?.hazard_notes) {
    const officerIds = await getOfficerUserIdsForCall(db, callId);
    for (const uid of officerIds) {
      sendToUser(uid, 'dispatch_alert', {
        call_id: Number(callId),
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

links.delete('/calls/:id/property', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
  await execute(
    db,
    `UPDATE calls_for_service SET property_id = NULL, updated_at = datetime('now', '-7 hours') WHERE id = ?`,
    callId,
  );
  broadcastAll('dispatch_update', {
    action: 'call_property_detached', call_id: Number(callId),
  });
  return c.json({ success: true });
});

export default links;
