// ============================================================
// RMPG Flex — business_vehicles (Cloudflare Worker)
// ============================================================
// M:N junction between businesses and vehicles_records with a
// relationship classifier: fleet | owner_employee | frequent_visitor
// | other. Spillman parity — patrol uses this to look up "who's
// likely driving when a vehicle is reported at a business".
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query, queryFirst, execute } from '../../utils/db';
import { broadcastAll } from '../ws';

const businessVehicles = new Hono<Env>();

const VALID_REL = ['owner_employee', 'frequent_visitor', 'fleet', 'other'] as const;

// GET /api/business-vehicles/:businessId — list vehicles linked
// to a business, joined with vehicles_records so the client gets
// plate/make/model/etc without a second fetch per row.
businessVehicles.get('/:businessId', async (c) => {
  try {
    const db = getDb(c.env);
    const businessId = parseInt(c.req.param('businessId'), 10);
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT bv.id AS link_id, bv.business_id, bv.vehicle_id, bv.relationship,
              bv.notes, bv.added_by, bv.created_at,
              v.plate_number, v.state, v.make, v.model, v.year, v.color, v.vin
       FROM business_vehicles bv
       JOIN vehicles_records v ON v.id = bv.vehicle_id
       WHERE bv.business_id = ?
       ORDER BY bv.created_at DESC`,
      businessId,
    );
    return c.json(rows);
  } catch (err) {
    return c.json({
      error: 'Failed to load business vehicles',
      code: 'LOAD_BUSINESS_VEHICLES_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// POST /api/business-vehicles — link a vehicle to a business.
businessVehicles.post('/', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.get('userId') as number | undefined;
    const body = await c.req.json<{
      business_id: number; vehicle_id: number;
      relationship: typeof VALID_REL[number]; notes?: string;
    }>();
    const { business_id, vehicle_id, relationship, notes } = body || ({} as never);

    if (!VALID_REL.includes(relationship)) {
      return c.json({
        error: 'Invalid relationship',
        code: 'INVALID_RELATIONSHIP',
        allowed: [...VALID_REL],
      }, 400);
    }
    const biz = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM businesses WHERE id = ?', business_id,
    );
    if (!biz) return c.json({ error: 'Business not found' }, 404);
    const veh = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM vehicles_records WHERE id = ?', vehicle_id,
    );
    if (!veh) return c.json({ error: 'Vehicle not found' }, 404);

    // INSERT OR IGNORE matches the call_persons pattern from
    // 0022_call_links.sql — UNIQUE(business_id, vehicle_id) shouldn't
    // surface as a 500 if the dispatcher double-clicks Save.
    await execute(
      db,
      `INSERT OR IGNORE INTO business_vehicles
         (business_id, vehicle_id, relationship, notes, added_by)
       VALUES (?, ?, ?, ?, ?)`,
      business_id, vehicle_id, relationship, notes ?? null, userId ?? null,
    );
    const row = await queryFirst<Record<string, unknown>>(
      db,
      `SELECT * FROM business_vehicles
       WHERE business_id = ? AND vehicle_id = ?`,
      business_id, vehicle_id,
    );

    broadcastAll('business_update', {
      action: 'business_vehicles_updated', business_id,
    });

    return c.json(row, 201);
  } catch (err) {
    return c.json({
      error: 'Failed to create business-vehicle link',
      code: 'CREATE_BUSINESS_VEHICLE_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// DELETE /api/business-vehicles/:linkId — remove a link
// (vehicle record itself stays in vehicles_records).
businessVehicles.delete('/:linkId', async (c) => {
  try {
    const db = getDb(c.env);
    const linkId = parseInt(c.req.param('linkId'), 10);
    const before = await queryFirst<{ business_id: number }>(
      db, 'SELECT business_id FROM business_vehicles WHERE id = ?', linkId,
    );
    if (!before) return c.json({ error: 'Link not found' }, 404);

    await execute(db, 'DELETE FROM business_vehicles WHERE id = ?', linkId);
    broadcastAll('business_update', {
      action: 'business_vehicles_updated', business_id: before.business_id,
    });
    return c.json({ success: true });
  } catch (err) {
    return c.json({
      error: 'Failed to delete business-vehicle link',
      code: 'DELETE_BUSINESS_VEHICLE_ERROR',
      detail: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

export default businessVehicles;
