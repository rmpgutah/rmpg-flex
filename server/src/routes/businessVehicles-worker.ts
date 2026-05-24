// ============================================================
// RMPG Flex — business_vehicles routes (Cloudflare Workers / Hono)
// ============================================================
// Ported from server/src/routes/businessVehicles.ts. Manages
// the business_vehicles junction (fleet / owner_employee /
// frequent_visitor / other) between businesses and
// vehicles_records.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { auditLog } from '../worker-middleware/auditLogger';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';

const VALID_REL = ['owner_employee', 'frequent_visitor', 'fleet', 'other'] as const;
type Relationship = typeof VALID_REL[number];

export function mountBusinessVehiclesRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // D1 migrations don't define business_vehicles. Self-heal at first request.
  let schemaReady = false;
  async function ensureSchema(db: D1Db): Promise<void> {
    if (schemaReady) return;
    try {
      await db.prepare(`CREATE TABLE IF NOT EXISTS business_vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id INTEGER NOT NULL,
        vehicle_id INTEGER NOT NULL,
        relationship TEXT NOT NULL,
        notes TEXT,
        added_by INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      )`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_business_vehicles_business ON business_vehicles(business_id)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_business_vehicles_vehicle ON business_vehicles(vehicle_id)`).run();
      await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_business_vehicles_unique ON business_vehicles(business_id, vehicle_id)`).run();
      schemaReady = true;
    } catch { /* non-fatal — every CREATE is IF NOT EXISTS */ }
  }

  // GET /api/business-vehicles/:businessId — list vehicles linked to a business
  // with embedded vehicle detail (joined via vehicles_records).
  api.get('/:businessId',
    requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer', 'client_viewer', 'human_resources', 'contract_manager'),
    async (c) => {
      try {
        const db = new D1Db(c.env.DB);
        await ensureSchema(db);
        const businessId = paramNum(c.req.param('businessId'));
        const rows = await db.prepare(`
          SELECT bv.id AS link_id, bv.business_id, bv.vehicle_id, bv.relationship,
                 bv.notes, bv.added_by, bv.created_at,
                 v.plate_number, v.state, v.make, v.model, v.year, v.color, v.vin, v.flags
          FROM business_vehicles bv
          JOIN vehicles_records v ON v.id = bv.vehicle_id
          WHERE bv.business_id = ?
          ORDER BY bv.created_at DESC
        `).all(businessId);
        return c.json(rows);
      } catch (err: any) {
        return c.json({ error: 'Failed to load business vehicles', code: 'LOAD_BUSINESS_VEHICLES_ERROR', detail: err?.message }, 500);
      }
    },
  );

  // POST /api/business-vehicles — link a vehicle to a business
  api.post('/',
    requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
    async (c) => {
      try {
        const db = new D1Db(c.env.DB);
        await ensureSchema(db);
        const user = c.get('user');
        const body = await c.req.json<any>();
        const { business_id, vehicle_id, relationship, notes } = body || {};

        if (!VALID_REL.includes(relationship as Relationship)) {
          return c.json({ error: 'Invalid relationship', code: 'INVALID_RELATIONSHIP', allowed: [...VALID_REL] }, 400);
        }
        const biz = await db.prepare('SELECT id FROM businesses WHERE id = ?').get(business_id);
        if (!biz) return c.json({ error: 'Business not found', code: 'BUSINESS_NOT_FOUND' }, 404);
        const veh = await db.prepare('SELECT id FROM vehicles_records WHERE id = ?').get(vehicle_id);
        if (!veh) return c.json({ error: 'Vehicle not found', code: 'VEHICLE_NOT_FOUND' }, 404);

        const existing = await db.prepare('SELECT id FROM business_vehicles WHERE business_id = ? AND vehicle_id = ?').get(business_id, vehicle_id);
        if (existing) return c.json({ error: 'Vehicle already linked to this business', code: 'BUSINESS_VEHICLE_ALREADY_LINKED' }, 409);

        const result = await db.prepare(`
          INSERT INTO business_vehicles (business_id, vehicle_id, relationship, notes, added_by)
          VALUES (?, ?, ?, ?, ?)
        `).run(business_id, vehicle_id, relationship, notes || null, user?.userId ?? null);

        const row = await db.prepare('SELECT * FROM business_vehicles WHERE id = ?').get(Number(result.meta.last_row_id));
        await auditLog(db, c, 'CREATE', 'business_vehicle_link', Number(result.meta.last_row_id),
          `Linked vehicle ${vehicle_id} to business ${business_id} as ${relationship}`);

        try {
          const { broadcastDispatchUpdate } = await import('../worker-middleware/websocket');
          broadcastDispatchUpdate({ action: 'business_vehicles_updated', business_id });
        } catch { /* non-fatal */ }

        return c.json(row, 201);
      } catch (err: any) {
        return c.json({ error: 'Failed to create business-vehicle link', code: 'CREATE_BUSINESS_VEHICLE_ERROR', detail: err?.message }, 500);
      }
    },
  );

  // DELETE /api/business-vehicles/:linkId — remove a link (vehicle record stays)
  api.delete('/:linkId',
    requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
    async (c) => {
      try {
        const db = new D1Db(c.env.DB);
        const linkId = paramNum(c.req.param('linkId'));
        const before = await db.prepare('SELECT * FROM business_vehicles WHERE id = ?').get(linkId) as any;
        if (!before) return c.json({ error: 'Link not found', code: 'LINK_NOT_FOUND' }, 404);

        await db.prepare('DELETE FROM business_vehicles WHERE id = ?').run(linkId);
        await auditLog(db, c, 'DELETE', 'business_vehicle_link', linkId,
          `Unlinked vehicle ${before.vehicle_id} from business ${before.business_id}`);

        try {
          const { broadcastDispatchUpdate } = await import('../worker-middleware/websocket');
          broadcastDispatchUpdate({ action: 'business_vehicles_updated', business_id: before.business_id });
        } catch { /* non-fatal */ }

        return c.json({ success: true });
      } catch (err: any) {
        return c.json({ error: 'Failed to delete business-vehicle link', code: 'DELETE_BUSINESS_VEHICLE_ERROR', detail: err?.message }, 500);
      }
    },
  );

  app.route('/api/business-vehicles', api);
}
