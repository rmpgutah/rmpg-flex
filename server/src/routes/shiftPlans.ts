import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { localNow } from '../utils/timeUtils';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// ============================================================
// Initialize tables for this module
// ============================================================
function initTables(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS shift_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      shift_type TEXT NOT NULL DEFAULT 'day',
      assignments TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

// Run table init on import (may fail if DB not yet initialized)
let tablesInitialized = false;
try {
  initTables();
  tablesInitialized = true;
} catch {
  // DB may not be initialized yet at import time; will retry on first request
}

// Lazy init middleware — ensures tables exist before any route handler runs
router.use((_req, _res, next) => {
  if (!tablesInitialized) {
    try {
      initTables();
      tablesInitialized = true;
    } catch (err) {
      console.error('shiftPlans initTables retry failed:', err);
      _res.status(503).json({ error: 'Database tables not ready' });
      return;
    }
  }
  next();
});

// Helper: parse assignments JSON on a row
function parseAssignments(row: any): any {
  if (!row) return row;
  try {
    row.assignments = typeof row.assignments === 'string' ? JSON.parse(row.assignments) : row.assignments;
  } catch {
    row.assignments = [];
  }
  return row;
}

// ============================================================
// GET /shift-plans — List all shift plans
// ============================================================
router.get('/shift-plans', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date, status } = req.query;

    let sql = `
      SELECT sp.*, u.full_name as created_by_name
      FROM shift_plans sp
      LEFT JOIN users u ON sp.created_by = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (date) {
      sql += ' AND sp.date = ?';
      params.push(date);
    }

    if (status) {
      sql += ' AND sp.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY sp.date DESC, sp.created_at DESC';

    const rows = db.prepare(sql).all(...params) as any[];
    const plans = rows.map(parseAssignments);

    res.json(plans);
  } catch (error: any) {
    console.error('Get shift plans error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /shift-plans/coverage/:date — Active plan assignments for a date
// ============================================================
router.get('/shift-plans/coverage/:date', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { date } = req.params;

    const rows = db.prepare(`
      SELECT sp.id as plan_id, sp.name as plan_name, sp.shift_type, sp.assignments
      FROM shift_plans sp
      WHERE sp.date = ? AND sp.status = 'active'
      ORDER BY sp.shift_type
    `).all(date) as any[];

    const allAssignments: any[] = [];
    for (const row of rows) {
      let assignments: any[] = [];
      try {
        assignments = typeof row.assignments === 'string' ? JSON.parse(row.assignments) : row.assignments;
      } catch {
        assignments = [];
      }
      for (const assignment of assignments) {
        allAssignments.push({
          ...assignment,
          plan_id: row.plan_id,
          plan_name: row.plan_name,
          shift_type: row.shift_type,
        });
      }
    }

    res.json(allAssignments);
  } catch (error: any) {
    console.error('Get shift coverage error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GET /shift-plans/:id — Get single plan by id
// ============================================================
router.get('/shift-plans/:id', requireRole('admin', 'manager', 'supervisor', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();

    const row = db.prepare(`
      SELECT sp.*, u.full_name as created_by_name
      FROM shift_plans sp
      LEFT JOIN users u ON sp.created_by = u.id
      WHERE sp.id = ?
    `).get(req.params.id) as any;

    if (!row) {
      res.status(404).json({ error: 'Shift plan not found' });
      return;
    }

    res.json(parseAssignments(row));
  } catch (error: any) {
    console.error('Get shift plan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /shift-plans — Create or upsert a shift plan
// ============================================================
router.post('/shift-plans', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id, name, date, shiftType, assignments, status, createdAt, updatedAt } = req.body;

    if (!id || !name || !date) {
      res.status(400).json({ error: 'id, name, and date are required' });
      return;
    }

    const now = localNow();
    const assignmentsJson = assignments ? JSON.stringify(assignments) : '[]';

    // Check if plan with this id already exists (upsert)
    const existing = db.prepare('SELECT id FROM shift_plans WHERE id = ?').get(id) as any;

    if (existing) {
      // Update existing plan
      db.prepare(`
        UPDATE shift_plans
        SET name = ?, date = ?, shift_type = ?, assignments = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(
        name,
        date,
        shiftType || 'day',
        assignmentsJson,
        status || 'draft',
        updatedAt || now,
        id,
      );

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'shift_plan_updated', 'shift_plan', ?, ?, ?)
      `).run(req.user!.userId, id, `Updated shift plan: ${name}`, req.ip || 'unknown');
    } else {
      // Insert new plan
      db.prepare(`
        INSERT INTO shift_plans (id, name, date, shift_type, assignments, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        name,
        date,
        shiftType || 'day',
        assignmentsJson,
        status || 'draft',
        req.user!.userId,
        createdAt || now,
        updatedAt || now,
      );

      db.prepare(`
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
        VALUES (?, 'shift_plan_created', 'shift_plan', ?, ?, ?)
      `).run(req.user!.userId, id, `Created shift plan: ${name}`, req.ip || 'unknown');
    }

    const plan = db.prepare(`
      SELECT sp.*, u.full_name as created_by_name
      FROM shift_plans sp
      LEFT JOIN users u ON sp.created_by = u.id
      WHERE sp.id = ?
    `).get(id) as any;

    res.status(existing ? 200 : 201).json(parseAssignments(plan));
  } catch (error: any) {
    console.error('Create/upsert shift plan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// PUT /shift-plans/:id — Update a shift plan
// ============================================================
router.put('/shift-plans/:id', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM shift_plans WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Shift plan not found' });
      return;
    }

    const fields = ['name', 'date', 'shift_type', 'assignments', 'status'];
    const bodyKeys = Object.keys(req.body);
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const f of fields) {
      if (bodyKeys.includes(f)) {
        setClauses.push(`${f} = ?`);
        let val = req.body[f];
        if (f === 'assignments' && typeof val !== 'string') {
          val = JSON.stringify(val);
        }
        values.push(val === '' ? null : val ?? null);
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    setClauses.push('updated_at = ?');
    values.push(localNow());
    values.push(req.params.id);

    db.prepare(`UPDATE shift_plans SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'shift_plan_updated', 'shift_plan', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Updated shift plan: ${existing.name}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT sp.*, u.full_name as created_by_name
      FROM shift_plans sp
      LEFT JOIN users u ON sp.created_by = u.id
      WHERE sp.id = ?
    `).get(req.params.id) as any;

    if (!updated) return res.status(404).json({ error: 'Shift plan not found after update' });
    res.json(parseAssignments(updated));
  } catch (error: any) {
    console.error('Update shift plan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// DELETE /shift-plans/:id — Admin/manager only: delete a shift plan
// ============================================================
router.delete('/shift-plans/:id', requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM shift_plans WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Shift plan not found' });
      return;
    }

    db.prepare('DELETE FROM shift_plans WHERE id = ?').run(req.params.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'shift_plan_deleted', 'shift_plan', ?, ?, ?)
    `).run(req.user!.userId, existing.id, `Deleted shift plan: ${existing.name}`, req.ip || 'unknown');

    res.json({ message: 'Shift plan deleted' });
  } catch (error: any) {
    console.error('Delete shift plan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// POST /shift-plans/:id/activate — Activate a plan, deactivate others for same date
// ============================================================
router.post('/shift-plans/:id/activate', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM shift_plans WHERE id = ?').get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: 'Shift plan not found' });
      return;
    }

    const now = localNow();

    // Set all other plans for the same date back to 'draft'
    db.prepare(`
      UPDATE shift_plans SET status = 'draft', updated_at = ?
      WHERE date = ? AND id != ? AND status = 'active'
    `).run(now, existing.date, req.params.id);

    // Activate the target plan
    db.prepare(`
      UPDATE shift_plans SET status = 'active', updated_at = ?
      WHERE id = ?
    `).run(now, req.params.id);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
      VALUES (?, 'shift_plan_activated', 'shift_plan', ?, ?, ?)
    `).run(req.user!.userId, req.params.id, `Activated shift plan: ${existing.name} for ${existing.date}`, req.ip || 'unknown');

    const updated = db.prepare(`
      SELECT sp.*, u.full_name as created_by_name
      FROM shift_plans sp
      LEFT JOIN users u ON sp.created_by = u.id
      WHERE sp.id = ?
    `).get(req.params.id) as any;

    res.json(parseAssignments(updated));
  } catch (error: any) {
    console.error('Activate shift plan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
