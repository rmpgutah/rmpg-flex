// ============================================================
// business_vehicles routes (Task 1.13)
// Manages the business_vehicles junction (fleet, owner_employee,
// frequent_visitor, other) between a business and a vehicle in
// vehicles_records.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { paramStr } from '../utils/reqHelpers';
import { auditLog } from '../utils/auditLogger';
import { broadcastDispatchUpdate } from '../utils/websocket';

const router = Router();
router.use(authenticateToken);

const VALID_REL = ['owner_employee', 'frequent_visitor', 'fleet', 'other'] as const;

// GET /api/business-vehicles/:businessId — list vehicles linked to a business
// with embedded vehicle detail (joined via vehicles_records).
router.get('/:businessId',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer', 'client_viewer', 'human_resources', 'contract_manager'),
  (req: Request, res: Response) => {
    try {
      const businessId = parseInt(paramStr(req.params.businessId as string | string[] | undefined), 10);
      const db = getDb();
      const rows = db.prepare(`
        SELECT bv.id AS link_id, bv.business_id, bv.vehicle_id, bv.relationship,
               bv.notes, bv.added_by, bv.created_at,
               v.plate_number, v.state, v.make, v.model, v.year, v.color, v.vin, v.flags
        FROM business_vehicles bv
        JOIN vehicles_records v ON v.id = bv.vehicle_id
        WHERE bv.business_id = ?
        ORDER BY bv.created_at DESC
      `).all(businessId);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to load business vehicles: ' + err.message });
    }
  }
);

// POST /api/business-vehicles — link a vehicle to a business.
router.post('/',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
  (req: Request, res: Response) => {
    try {
      const { business_id, vehicle_id, relationship, notes } = req.body;
      if (!VALID_REL.includes(relationship)) {
        res.status(400).json({ error: 'Invalid relationship', allowed: [...VALID_REL] });
        return;
      }
      const db = getDb();
      const biz = db.prepare('SELECT id FROM businesses WHERE id = ?').get(business_id);
      if (!biz) { res.status(404).json({ error: 'Business not found' }); return; }
      const veh = db.prepare('SELECT id FROM vehicles_records WHERE id = ?').get(vehicle_id);
      if (!veh) { res.status(404).json({ error: 'Vehicle not found' }); return; }

      try {
        const result = db.prepare(`
          INSERT INTO business_vehicles (business_id, vehicle_id, relationship, notes, added_by)
          VALUES (?, ?, ?, ?, ?)
        `).run(business_id, vehicle_id, relationship, notes || null, (req as any).user?.userId ?? null);
        const row = db.prepare('SELECT * FROM business_vehicles WHERE id = ?').get(result.lastInsertRowid);
        auditLog(req, 'CREATE', 'business_vehicle_link', Number(result.lastInsertRowid), null, row);
        broadcastDispatchUpdate({ action: 'business_vehicles_updated', business_id });
        res.status(201).json(row);
      } catch (err: any) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          res.status(409).json({ error: 'Vehicle already linked to this business' });
          return;
        }
        throw err;
      }
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to create business-vehicle link: ' + err.message });
    }
  }
);

// DELETE /api/business-vehicles/:linkId — remove a link (vehicle record stays).
router.delete('/:linkId',
  requireRole('admin', 'manager', 'supervisor', 'dispatcher', 'officer'),
  (req: Request, res: Response) => {
    try {
      const linkId = parseInt(paramStr(req.params.linkId as string | string[] | undefined), 10);
      const db = getDb();
      const before = db.prepare('SELECT * FROM business_vehicles WHERE id = ?').get(linkId) as any;
      if (!before) { res.status(404).json({ error: 'Link not found' }); return; }
      db.prepare('DELETE FROM business_vehicles WHERE id = ?').run(linkId);
      auditLog(req, 'DELETE', 'business_vehicle_link', linkId, before, null);
      broadcastDispatchUpdate({ action: 'business_vehicles_updated', business_id: before.business_id });
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to delete business-vehicle link: ' + err.message });
    }
  }
);

export default router;
