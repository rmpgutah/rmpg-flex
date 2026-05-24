// Persons / vehicles / property linkage for a dispatch CFS.
//
// DispatchPage already wires the search → attach UI for all three
// (see DispatchPage.tsx around the call-detail panel). These routes
// are the missing server side. Search itself lives at
// /api/records/persons/search, /api/records/vehicles/search, and
// /api/records/properties — those endpoints already work.
//
// Every mutation broadcasts dispatch_update with an action
// discriminator so other dispatchers + the assigned officers' MDTs
// re-render the call's linked entities in real time. Targeted
// `call_status_for_officer` push fires too so the officer's voice
// queue speaks "Subject added" / "Vehicle added".

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import {
  broadcastDispatchUpdate,
  sendToUsers,
} from '../../lib/broadcast';

const links = new Hono<Env>();

// ── Shared helper: officers assigned to the call, for targeted push ──
async function getOfficerUserIdsForCall(db: ReturnType<typeof getDb>, callId: string | number): Promise<number[]> {
  const call = await queryFirst<{ assigned_unit_ids: string }>(
    db, 'SELECT assigned_unit_ids FROM calls_for_service WHERE id = ?', callId,
  );
  if (!call?.assigned_unit_ids) return [];
  let unitIds: number[] = [];
  try { unitIds = JSON.parse(call.assigned_unit_ids); } catch { return []; }
  if (unitIds.length === 0) return [];
  const placeholders = unitIds.map(() => '?').join(',');
  const rows = await query<{ officer_id: number | null }>(
    db, `SELECT officer_id FROM units WHERE id IN (${placeholders}) AND officer_id IS NOT NULL`, ...unitIds,
  );
  return rows.map(r => r.officer_id!).filter((id): id is number => typeof id === 'number');
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
  // doesn't surface as a 500; just return the existing link.
  await execute(
    db,
    `INSERT OR IGNORE INTO call_persons (call_id, person_id, role, notes, added_by)
     VALUES (?, ?, ?, ?, ?)`,
    callId, body.person_id, body.role || 'subject', body.notes ?? null, userId,
  );
  const created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cp.*, p.first_name, p.last_name, p.dob
     FROM call_persons cp JOIN persons p ON cp.person_id = p.id
     WHERE cp.call_id = ? AND cp.person_id = ? AND cp.role = ?`,
    callId, body.person_id, body.role || 'subject',
  );

  c.executionCtx.waitUntil(broadcastDispatchUpdate(c.env, {
    action: 'call_person_added', call_id: Number(callId), link: created,
  }).then(() => {}));

  // Officer MDT voice — "Subject added: <last name>". Person flags
  // (caution, sex_offender, gang) deserve an officer-safety push,
  // not a generic "person added" prompt.
  const officerIds = await getOfficerUserIdsForCall(db, callId);
  if (officerIds.length > 0) {
    const flag = (created as any);
    const hasSafety = flag?.caution_flags || flag?.is_sex_offender || flag?.gang_affiliation;
    c.executionCtx.waitUntil(sendToUsers(c.env, officerIds, 'call_status_for_officer', {
      action: 'note_added',
      call_id: Number(callId),
      short: hasSafety
        ? `Subject added with caution flag: ${person.last_name}`
        : `Subject added: ${person.last_name}`,
    }).then(() => {}));
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
  c.executionCtx.waitUntil(broadcastDispatchUpdate(c.env, {
    action: 'call_person_removed', call_id: Number(callId), link_id: Number(linkId),
  }).then(() => {}));
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
  if (body.role !== undefined)  { sets.push('role = ?');  params.push(body.role); }
  if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes); }
  if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
  params.push(linkId, callId);
  await execute(db, `UPDATE call_persons SET ${sets.join(', ')} WHERE id = ? AND call_id = ?`, ...params);
  const updated = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cp.*, p.first_name, p.last_name
     FROM call_persons cp JOIN persons p ON cp.person_id = p.id
     WHERE cp.id = ?`,
    linkId,
  );
  c.executionCtx.waitUntil(broadcastDispatchUpdate(c.env, {
    action: 'call_person_updated', call_id: Number(callId), link: updated,
  }).then(() => {}));
  return c.json(updated);
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

  const vehicle = await queryFirst<{ id: number; plate_number: string | null; make: string | null; model: string | null }>(
    db, 'SELECT id, plate_number, make, model FROM vehicles_records WHERE id = ?', body.vehicle_id,
  );
  if (!vehicle) return c.json({ error: 'Vehicle not found' }, 404);

  await execute(
    db,
    `INSERT OR IGNORE INTO call_vehicles (call_id, vehicle_id, role, notes, added_by)
     VALUES (?, ?, ?, ?, ?)`,
    callId, body.vehicle_id, body.role || 'subject', body.notes ?? null, userId,
  );
  const created = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cv.*, v.plate_number, v.state, v.make, v.model, v.year, v.color
     FROM call_vehicles cv JOIN vehicles_records v ON cv.vehicle_id = v.id
     WHERE cv.call_id = ? AND cv.vehicle_id = ? AND cv.role = ?`,
    callId, body.vehicle_id, body.role || 'subject',
  );

  c.executionCtx.waitUntil(broadcastDispatchUpdate(c.env, {
    action: 'call_vehicle_added', call_id: Number(callId), link: created,
  }).then(() => {}));

  const officerIds = await getOfficerUserIdsForCall(db, callId);
  if (officerIds.length > 0) {
    const short = vehicle.plate_number
      ? `Vehicle added: plate ${vehicle.plate_number}`
      : `Vehicle added: ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle added';
    c.executionCtx.waitUntil(sendToUsers(c.env, officerIds, 'call_status_for_officer', {
      action: 'note_added', call_id: Number(callId), short,
    }).then(() => {}));
  }
  return c.json(created, 201);
});

links.delete('/calls/:id/vehicles/:linkId', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
  const linkId = c.req.param('linkId');
  await execute(db, 'DELETE FROM call_vehicles WHERE id = ? AND call_id = ?', linkId, callId);
  c.executionCtx.waitUntil(broadcastDispatchUpdate(c.env, {
    action: 'call_vehicle_removed', call_id: Number(callId), link_id: Number(linkId),
  }).then(() => {}));
  return c.json({ success: true });
});

links.patch('/calls/:id/vehicles/:linkId', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
  const linkId = c.req.param('linkId');
  const body = await c.req.json<{ role?: string; notes?: string }>();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.role !== undefined)  { sets.push('role = ?');  params.push(body.role); }
  if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes); }
  if (sets.length === 0) return c.json({ error: 'No fields' }, 400);
  params.push(linkId, callId);
  await execute(db, `UPDATE call_vehicles SET ${sets.join(', ')} WHERE id = ? AND call_id = ?`, ...params);
  const updated = await queryFirst<Record<string, unknown>>(
    db,
    `SELECT cv.*, v.plate_number, v.make, v.model
     FROM call_vehicles cv JOIN vehicles_records v ON cv.vehicle_id = v.id
     WHERE cv.id = ?`,
    linkId,
  );
  c.executionCtx.waitUntil(broadcastDispatchUpdate(c.env, {
    action: 'call_vehicle_updated', call_id: Number(callId), link: updated,
  }).then(() => {}));
  return c.json(updated);
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

  const prop = await queryFirst<{ id: number; name: string | null; address: string | null; client_id: number | null; latitude: number | null; longitude: number | null }>(
    db, 'SELECT id, name, address, client_id, latitude, longitude FROM properties WHERE id = ?', body.property_id,
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
    `SELECT c.*, p.name as property_name, p.address as property_address,
            p.gate_code, p.alarm_code, p.emergency_contact, p.post_orders, p.hazard_notes
     FROM calls_for_service c
     LEFT JOIN properties p ON c.property_id = p.id
     WHERE c.id = ?`,
    callId,
  );

  c.executionCtx.waitUntil(broadcastDispatchUpdate(c.env, {
    action: 'call_property_attached', call_id: Number(callId), property_id: body.property_id, call: updated,
  }).then(() => {}));

  // If the property carries hazard_notes, push them as an officer-safety
  // flag — same path used by GET /:id/warnings.
  if ((updated as any)?.hazard_notes) {
    const officerIds = await getOfficerUserIdsForCall(db, callId);
    if (officerIds.length > 0) {
      c.executionCtx.waitUntil(sendToUsers(c.env, officerIds, 'dispatch_alert', {
        call_id: Number(callId),
        warnings: [{ type: 'HAZARD', label: 'PROPERTY HAZARD ON FILE', severity: 'high', source: prop.name || 'Property' }],
      }).then(() => {}));
    }
  }
  return c.json(updated);
});

links.delete('/calls/:id/property', async (c) => {
  const db = getDb(c.env);
  const callId = c.req.param('id');
  await execute(db, `UPDATE calls_for_service SET property_id = NULL, updated_at = datetime('now') WHERE id = ?`, callId);
  c.executionCtx.waitUntil(broadcastDispatchUpdate(c.env, {
    action: 'call_property_detached', call_id: Number(callId),
  }).then(() => {}));
  return c.json({ success: true });
});

export default links;
