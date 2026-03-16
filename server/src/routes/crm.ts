// ============================================================
// CRM API Routes
// ============================================================
// Dashboard stats, tasks, activity logging, contacts directory,
// and contract expiration alerts for the CRM module.
// Client/Property/Invoice CRUD reuses existing admin routes.

import { Router, Request, Response } from 'express';
import { authenticateToken as authenticate, requireRole } from '../middleware/auth';
import { getDb } from '../models/database';
import { auditLog } from '../utils/auditLogger';
import { localNow } from '../utils/timeUtils';
import { escapeLike, validateParamId } from '../middleware/sanitize';

const router = Router();
router.use(authenticate);

// ── Dashboard Stats ─────────────────────────────────────
router.get('/dashboard', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const now = localNow();
    const monthStart = now.slice(0, 7) + '-01';

    const activeClients = (db.prepare("SELECT COUNT(*) as c FROM clients WHERE status = 'active'").get() as any)?.c || 0;
    const totalClients = (db.prepare('SELECT COUNT(*) as c FROM clients').get() as any)?.c || 0;

    const outstanding = (db.prepare(
      "SELECT COALESCE(SUM(balance_due), 0) as total FROM invoices WHERE status IN ('sent', 'partial', 'overdue')"
    ).get() as any)?.total || 0;

    const overdueInvoices = (db.prepare(
      "SELECT COUNT(*) as c FROM invoices WHERE status = 'overdue'"
    ).get() as any)?.c || 0;

    const pendingTasks = (db.prepare(
      "SELECT COUNT(*) as c FROM crm_tasks WHERE status IN ('pending', 'in_progress')"
    ).get() as any)?.c || 0;

    // Contracts expiring in next 90 days
    const today = localNow().slice(0, 10);
    const futureDate = new Date(today + 'T12:00:00');
    futureDate.setDate(futureDate.getDate() + 90);
    const future90 = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
    const expiringContracts = (db.prepare(
      "SELECT COUNT(*) as c FROM clients WHERE status = 'active' AND contract_end IS NOT NULL AND contract_end <= ? AND contract_end >= date('now')"
    ).get(future90) as any)?.c || 0;

    const invoicedMtd = (db.prepare(
      'SELECT COALESCE(SUM(total), 0) as t FROM invoices WHERE issue_date >= ?'
    ).get(monthStart) as any)?.t || 0;

    const paidMtd = (db.prepare(
      'SELECT COALESCE(SUM(amount_paid), 0) as t FROM invoices WHERE paid_date >= ?'
    ).get(monthStart) as any)?.t || 0;

    res.json({
      active_clients: activeClients,
      total_clients: totalClients,
      outstanding_revenue: outstanding,
      overdue_invoices: overdueInvoices,
      pending_tasks: pendingTasks,
      expiring_contracts: expiringContracts,
      total_invoiced_mtd: invoicedMtd,
      total_paid_mtd: paidMtd,
    });
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Recent Activity Feed ─────────────────────────────────
router.get('/recent-activity', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);

    const rows = db.prepare(`
      SELECT a.*, u.full_name as created_by_name, c.name as client_name
      FROM crm_activity a
      LEFT JOIN users u ON u.id = a.created_by
      LEFT JOIN clients c ON c.id = a.client_id
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all(limit);

    res.json(rows);
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Tasks CRUD ───────────────────────────────────────────
router.get('/tasks', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, client_id, assigned_to, due_before } = req.query;

    let sql = `
      SELECT t.*, c.name as client_name, p.name as property_name,
             u1.full_name as assigned_to_name, u2.full_name as created_by_name
      FROM crm_tasks t
      LEFT JOIN clients c ON c.id = t.client_id
      LEFT JOIN properties p ON p.id = t.property_id
      LEFT JOIN users u1 ON u1.id = t.assigned_to
      LEFT JOIN users u2 ON u2.id = t.created_by
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      const statuses = (status as string).split(',');
      sql += ` AND t.status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }
    if (client_id) { sql += ' AND t.client_id = ?'; params.push(client_id); }
    if (assigned_to) { sql += ' AND t.assigned_to = ?'; params.push(assigned_to); }
    if (due_before) { sql += ' AND t.due_date <= ?'; params.push(due_before); }

    sql += ' ORDER BY CASE t.priority WHEN \'urgent\' THEN 0 WHEN \'high\' THEN 1 WHEN \'normal\' THEN 2 ELSE 3 END, t.due_date ASC NULLS LAST, t.created_at DESC';

    res.json(db.prepare(sql).all(...params));
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/tasks', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { client_id, property_id, title, description, task_type, priority, due_date, assigned_to, notes } = req.body;
    if (!title?.trim()) { res.status(400).json({ error: 'Title is required' }); return; }

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO crm_tasks (client_id, property_id, title, description, task_type, priority, status, due_date, assigned_to, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
    `).run(
      client_id || null, property_id || null, title.trim(), description || null,
      task_type || 'follow_up', priority || 'normal', due_date || null,
      assigned_to || null, notes || null, req.user?.userId || null, now, now,
    );

    const taskId = Number(result.lastInsertRowid);
    auditLog(req, 'crm_task_created', 'crm_task', taskId, `Created task: ${title.trim()}`);

    const task = db.prepare('SELECT * FROM crm_tasks WHERE id = ?').get(taskId);
    res.json(task);
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/tasks/:id', validateParamId, requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM crm_tasks WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'Task not found' }); return; }

    const { title, description, task_type, priority, status, due_date, assigned_to, notes } = req.body;
    const now = localNow();

    const updates: string[] = [];
    const params: any[] = [];

    if (title !== undefined) { updates.push('title = ?'); params.push(title.trim()); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (task_type !== undefined) { updates.push('task_type = ?'); params.push(task_type); }
    if (priority !== undefined) { updates.push('priority = ?'); params.push(priority); }
    if (status !== undefined) {
      updates.push('status = ?'); params.push(status);
      if (status === 'completed') {
        updates.push('completed_at = ?', 'completed_by = ?');
        params.push(now, req.user?.userId || null);
      }
    }
    if (due_date !== undefined) { updates.push('due_date = ?'); params.push(due_date || null); }
    if (assigned_to !== undefined) { updates.push('assigned_to = ?'); params.push(assigned_to || null); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

    updates.push('updated_at = ?'); params.push(now);
    params.push(id);

    db.prepare(`UPDATE crm_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    auditLog(req, 'crm_task_updated', 'crm_task', String(id), `Updated task: ${title || existing.title}`);

    const task = db.prepare('SELECT * FROM crm_tasks WHERE id = ?').get(id);
    res.json(task);
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/tasks/:id', validateParamId, requireRole('admin', 'manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM crm_tasks WHERE id = ?').get(id) as any;
    if (!existing) { res.status(404).json({ error: 'Task not found' }); return; }

    db.prepare('DELETE FROM crm_tasks WHERE id = ?').run(id);
    auditLog(req, 'crm_task_deleted', 'crm_task', String(id), `Deleted task: ${existing.title}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Client Activity Log ──────────────────────────────────
router.get('/activity/:clientId', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { clientId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);

    const rows = db.prepare(`
      SELECT a.*, u.full_name as created_by_name
      FROM crm_activity a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.client_id = ?
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all(clientId, limit);

    res.json(rows);
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/activity', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { client_id, activity_type, subject, details } = req.body;
    if (!client_id || !activity_type) { res.status(400).json({ error: 'client_id and activity_type required' }); return; }

    const now = localNow();
    const result = db.prepare(`
      INSERT INTO crm_activity (client_id, activity_type, subject, details, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(client_id, activity_type, subject || null, details || null, req.user?.userId || null, now);

    const activityId = Number(result.lastInsertRowid);
    auditLog(req, 'crm_activity_logged', 'crm_activity', activityId, `Logged ${activity_type} for client #${client_id}`);

    const activity = db.prepare(`
      SELECT a.*, u.full_name as created_by_name
      FROM crm_activity a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.id = ?
    `).get(activityId);
    res.json(activity);
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Contacts Directory ───────────────────────────────────
router.get('/contacts', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { search, relationship, client_id } = req.query;

    let sql = `
      SELECT cp.*, p.first_name, p.last_name, p.dob, p.phone, p.email as person_email,
             p.race, p.gender, c.name as client_name
      FROM client_persons cp
      JOIN persons p ON p.id = cp.person_id
      JOIN clients c ON c.id = cp.client_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (search) {
      sql += " AND (p.first_name || ' ' || p.last_name LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\' OR p.email LIKE ? ESCAPE '\\')";
      const q = `%${escapeLike(String(search))}%`;
      params.push(q, q, q);
    }
    if (relationship) { sql += ' AND cp.relationship = ?'; params.push(relationship); }
    if (client_id) { sql += ' AND cp.client_id = ?'; params.push(client_id); }

    sql += ' ORDER BY c.name, p.last_name, p.first_name';
    res.json(db.prepare(sql).all(...params));
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Expiring Contracts ───────────────────────────────────
router.get('/expiring-contracts', requireRole('admin', 'manager', 'contract_manager'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 90));
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);
    const future = futureDate.toISOString().slice(0, 10);

    const rows = db.prepare(`
      SELECT id, name, contact_name, contact_email, contact_phone,
             contract_start, contract_end, contract_type, contract_value, auto_renew,
             account_manager
      FROM clients
      WHERE status = 'active'
        AND contract_end IS NOT NULL
        AND contract_end <= ?
        AND contract_end >= date('now')
      ORDER BY contract_end ASC
    `).all(future);

    res.json(rows);
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Reports ──────────────────────────────────────────

// Monthly revenue: invoiced vs paid for last 12 months
router.get('/reports/revenue', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      WITH months AS (
        SELECT strftime('%Y-%m', date('now', '-' || n || ' months')) as month
        FROM (SELECT 0 as n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5
              UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11)
      )
      SELECT m.month,
        COALESCE((SELECT SUM(total) FROM invoices WHERE strftime('%Y-%m', issue_date) = m.month), 0) as invoiced,
        COALESCE((SELECT SUM(amount_paid) FROM invoices WHERE strftime('%Y-%m', paid_date) = m.month), 0) as paid
      FROM months m
      ORDER BY m.month ASC
    `).all();
    res.json(rows);
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Pipeline summary: leads by stage with conversion metrics
router.get('/reports/pipeline', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const stages = db.prepare(`
      SELECT pipeline_stage as stage, COUNT(*) as count, COALESCE(SUM(estimated_value), 0) as total_value
      FROM crm_leads
      GROUP BY pipeline_stage
      ORDER BY CASE pipeline_stage
        WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 WHEN 'qualified' THEN 2
        WHEN 'proposal' THEN 3 WHEN 'negotiation' THEN 4 WHEN 'won' THEN 5
        WHEN 'lost' THEN 6 WHEN 'dismissed' THEN 7 END
    `).all();

    const total = (db.prepare('SELECT COUNT(*) as c FROM crm_leads').get() as any)?.c || 0;
    const won = (db.prepare("SELECT COUNT(*) as c FROM crm_leads WHERE pipeline_stage = 'won'").get() as any)?.c || 0;
    const lost = (db.prepare("SELECT COUNT(*) as c FROM crm_leads WHERE pipeline_stage = 'lost'").get() as any)?.c || 0;
    const decided = won + lost;

    res.json({
      stages,
      total_leads: total,
      conversion_rate: decided > 0 ? Math.round((won / decided) * 100) : 0,
    });
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Client retention: active vs inactive by month
router.get('/reports/retention', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      WITH months AS (
        SELECT strftime('%Y-%m', date('now', '-' || n || ' months')) as month
        FROM (SELECT 0 as n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5
              UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11)
      )
      SELECT m.month,
        (SELECT COUNT(*) FROM clients WHERE status = 'active' AND client_since <= m.month || '-31') as active,
        (SELECT COUNT(*) FROM clients WHERE status = 'inactive' AND client_since <= m.month || '-31') as inactive
      FROM months m
      ORDER BY m.month ASC
    `).all();
    res.json(rows);
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Lead source ROI: won deals per scrape source
router.get('/reports/lead-source-roi', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT source,
        COUNT(*) as total,
        SUM(CASE WHEN pipeline_stage = 'won' THEN 1 ELSE 0 END) as won,
        SUM(CASE WHEN pipeline_stage = 'lost' THEN 1 ELSE 0 END) as lost,
        COALESCE(SUM(CASE WHEN pipeline_stage = 'won' THEN estimated_value ELSE 0 END), 0) as total_won_value
      FROM crm_leads
      GROUP BY source
      ORDER BY won DESC, total DESC
    `).all() as any[];

    const result = rows.map(r => ({
      ...r,
      conversion_rate: (r.won + r.lost) > 0 ? Math.round((r.won / (r.won + r.lost)) * 100) : 0,
    }));

    res.json(result);
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Key metrics summary
router.get('/reports/metrics', requireRole('admin', 'manager', 'contract_manager'), (_req: Request, res: Response) => {
  try {
    const db = getDb();

    const pipelineValue = (db.prepare(
      "SELECT COALESCE(SUM(estimated_value), 0) as v FROM crm_leads WHERE pipeline_stage NOT IN ('won', 'lost', 'dismissed')"
    ).get() as any)?.v || 0;

    const won = (db.prepare("SELECT COUNT(*) as c FROM crm_leads WHERE pipeline_stage = 'won'").get() as any)?.c || 0;
    const lost = (db.prepare("SELECT COUNT(*) as c FROM crm_leads WHERE pipeline_stage = 'lost'").get() as any)?.c || 0;
    const decided = won + lost;
    const winRate = decided > 0 ? Math.round((won / decided) * 100) : 0;

    // Average sales cycle (days from created_at to updated_at for won leads)
    const avgCycle = (db.prepare(
      "SELECT AVG(julianday(updated_at) - julianday(created_at)) as d FROM crm_leads WHERE pipeline_stage = 'won'"
    ).get() as any)?.d || 0;

    const monthStart = localNow().slice(0, 7) + '-01';
    const leadsThisMonth = (db.prepare(
      'SELECT COUNT(*) as c FROM crm_leads WHERE created_at >= ?'
    ).get(monthStart) as any)?.c || 0;

    const proposalsSent = (db.prepare(
      "SELECT COUNT(*) as c FROM crm_proposals WHERE stage IN ('sent', 'viewed', 'accepted', 'rejected')"
    ).get() as any)?.c || 0;

    const proposalsAccepted = (db.prepare(
      "SELECT COUNT(*) as c FROM crm_proposals WHERE stage = 'accepted'"
    ).get() as any)?.c || 0;

    res.json({
      total_pipeline_value: pipelineValue,
      win_rate: winRate,
      avg_cycle_days: Math.round(avgCycle),
      leads_this_month: leadsThisMonth,
      proposals_sent: proposalsSent,
      proposals_accepted: proposalsAccepted,
    });
  } catch (err: any) {
    console.error('CRM error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
