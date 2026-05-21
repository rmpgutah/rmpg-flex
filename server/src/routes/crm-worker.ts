import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum, localNow, localToday } from '../worker-middleware/d1Helpers';

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function mountCrmRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // ── Dashboard Stats ─────────────────────────────────────
  api.get('/dashboard', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const now = localNow();
      const monthStart = now.slice(0, 7) + '-01';

      const activeClients = ((await db.prepare("SELECT COUNT(*) as c FROM clients WHERE status = 'active'").get()) as any)?.c || 0;
      const totalClients = ((await db.prepare('SELECT COUNT(*) as c FROM clients').get()) as any)?.c || 0;

      const outstanding = ((await db.prepare(
        "SELECT COALESCE(SUM(balance_due), 0) as total FROM invoices WHERE status IN ('sent', 'partial', 'overdue')"
      ).get()) as any)?.total || 0;

      const overdueInvoices = ((await db.prepare(
        "SELECT COUNT(*) as c FROM invoices WHERE status = 'overdue'"
      ).get()) as any)?.c || 0;

      const pendingTasks = ((await db.prepare(
        "SELECT COUNT(*) as c FROM crm_tasks WHERE status IN ('pending', 'in_progress')"
      ).get()) as any)?.c || 0;

      const today = localNow().slice(0, 10);
      const futureDate = new Date(today + 'T12:00:00');
      futureDate.setDate(futureDate.getDate() + 90);
      const future90 = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, '0')}-${String(futureDate.getDate()).padStart(2, '0')}`;
      const expiringContracts = ((await db.prepare(
        "SELECT COUNT(*) as c FROM clients WHERE status = 'active' AND contract_end IS NOT NULL AND contract_end <= ? AND contract_end >= date('now')"
      ).get(future90)) as any)?.c || 0;

      const invoicedMtd = ((await db.prepare(
        'SELECT COALESCE(SUM(total), 0) as t FROM invoices WHERE issue_date >= ?'
      ).get(monthStart)) as any)?.t || 0;

      const paidMtd = ((await db.prepare(
        'SELECT COALESCE(SUM(amount_paid), 0) as t FROM invoices WHERE paid_date >= ?'
      ).get(monthStart)) as any)?.t || 0;

      return c.json({
        active_clients: activeClients,
        total_clients: totalClients,
        outstanding_revenue: outstanding,
        overdue_invoices: overdueInvoices,
        pending_tasks: pendingTasks,
        expiring_contracts: expiringContracts,
        total_invoiced_mtd: invoicedMtd,
        total_paid_mtd: paidMtd,
      });
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  // ── Recent Activity Feed ─────────────────────────────────
  api.get('/recent-activity', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const limit = Math.min(100000, Math.max(1, (parseInt(q.limit || '', 10)) || 100000));

      const rows = await db.prepare(`
        SELECT a.*, u.full_name as created_by_name, c.name as client_name
        FROM crm_activity a
        LEFT JOIN users u ON u.id = a.created_by
        LEFT JOIN clients c ON c.id = a.client_id
        ORDER BY a.created_at DESC
        LIMIT ?
      `).all(limit);

      return c.json(rows);
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  // ── Tasks CRUD ───────────────────────────────────────────
  api.get('/tasks', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { status, client_id, assigned_to, due_before } = q;

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
        const statuses = status.split(',').filter(Boolean);
        if (statuses.length > 0) {
          sql += ` AND t.status IN (${statuses.map(() => '?').join(',')})`;
          params.push(...statuses);
        }
      }
      if (client_id) { sql += ' AND t.client_id = ?'; params.push(client_id); }
      if (assigned_to) { sql += ' AND t.assigned_to = ?'; params.push(assigned_to); }
      if (due_before) { sql += ' AND t.due_date <= ?'; params.push(due_before); }

      sql += ' ORDER BY CASE t.priority WHEN \'urgent\' THEN 0 WHEN \'high\' THEN 1 WHEN \'normal\' THEN 2 ELSE 3 END, t.due_date ASC, t.created_at DESC';

      const rows = await db.prepare(sql).all(...params);
      return c.json(rows);
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  api.post('/tasks', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { client_id, property_id, title, description, task_type, priority, due_date, assigned_to, notes } = body;

      const TASK_TYPES = ['follow_up', 'call', 'meeting', 'proposal', 'contract_review', 'billing', 'inspection', 'other'] as const;
      const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

      const validTitle = title && typeof title === 'string' && title.trim().length > 0 && title.length <= 200 ? title.trim() : null;
      if (!validTitle) { return c.json({ error: 'Title is required', code: 'TITLE_IS_REQUIRED' }, 400); }
      const validTaskType = TASK_TYPES.includes(task_type as any) ? task_type : 'follow_up';
      const validPriority = PRIORITIES.includes(priority as any) ? priority : 'normal';

      const now = localNow();
      const user = c.get('user');
      const result = await db.prepare(`
        INSERT INTO crm_tasks (client_id, property_id, title, description, task_type, priority, status, due_date, assigned_to, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
      `).run(
        client_id || null, property_id || null, validTitle, description || null,
        validTaskType, validPriority, due_date || null,
        assigned_to || null, notes || null, user?.userId || null, now, now,
      );

      const taskId = Number(result.meta.last_row_id);
      const task = await db.prepare('SELECT * FROM crm_tasks WHERE id = ?').get(taskId);
      return c.json(task);
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  api.put('/tasks/:id', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT * FROM crm_tasks WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Task not found', code: 'TASK_NOT_FOUND' }, 404); }

      const body = await c.req.json();
      const { title, description, task_type, priority, status, due_date, assigned_to, notes } = body;

      const TASK_UPDATE_TYPES = ['follow_up', 'call', 'meeting', 'proposal', 'contract_review', 'billing', 'inspection', 'other'] as const;
      const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
      const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

      const now = localNow();
      const user = c.get('user');

      const updates: string[] = [];
      const params: any[] = [];

      if (title !== undefined) { updates.push('title = ?'); params.push(String(title).trim()); }
      if (description !== undefined) { updates.push('description = ?'); params.push(description); }
      if (task_type !== undefined) { updates.push('task_type = ?'); params.push(task_type); }
      if (priority !== undefined) { updates.push('priority = ?'); params.push(priority); }
      if (status !== undefined) {
        updates.push('status = ?'); params.push(status);
        if (status === 'completed') {
          updates.push('completed_at = ?', 'completed_by = ?');
          params.push(now, user?.userId || null);
        }
      }
      if (due_date !== undefined) { updates.push('due_date = ?'); params.push(due_date || null); }
      if (assigned_to !== undefined) { updates.push('assigned_to = ?'); params.push(assigned_to || null); }
      if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

      updates.push('updated_at = ?'); params.push(now);
      params.push(id);

      await db.prepare(`UPDATE crm_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      const task = await db.prepare('SELECT * FROM crm_tasks WHERE id = ?').get(id);
      return c.json(task);
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  api.delete('/tasks/:id', requireRole('admin', 'manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const id = paramNum(c.req.param('id'));
      const existing = await db.prepare('SELECT * FROM crm_tasks WHERE id = ?').get(id) as any;
      if (!existing) { return c.json({ error: 'Task not found', code: 'TASK_NOT_FOUND' }, 404); }

      await db.prepare('DELETE FROM crm_tasks WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  // ── Client Activity Log ──────────────────────────────────
  api.get('/activity/:clientId', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const clientId = paramNum(c.req.param('clientId'));
      const q = c.req.query();
      const limit = Math.min(100000, Math.max(1, (parseInt(q.limit || '', 10)) || 100000));

      const rows = await db.prepare(`
        SELECT a.*, u.full_name as created_by_name
        FROM crm_activity a
        LEFT JOIN users u ON u.id = a.created_by
        WHERE a.client_id = ?
        ORDER BY a.created_at DESC
        LIMIT ?
      `).all(clientId, limit);

      return c.json(rows);
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  api.post('/activity', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const body = await c.req.json();
      const { client_id, activity_type, subject, details } = body;

      const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'follow_up', 'task', 'proposal', 'contract', 'billing', 'other'] as const;

      if (!client_id || isNaN(parseInt(String(client_id), 10))) { return c.json({ error: 'client_id is required', code: 'CLIENTID_IS_REQUIRED' }, 400); }
      const validActType = ACTIVITY_TYPES.includes(activity_type as any) ? activity_type : null;
      if (!validActType) { return c.json({ error: 'activity_type is required', code: 'ACTIVITYTYPE_IS_REQUIRED' }, 400); }

      const now = localNow();
      const user = c.get('user');
      const result = await db.prepare(`
        INSERT INTO crm_activity (client_id, activity_type, subject, details, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(client_id, activity_type, subject || null, details || null, user?.userId || null, now);

      const activityId = Number(result.meta.last_row_id);
      const activity = await db.prepare(`
        SELECT a.*, u.full_name as created_by_name
        FROM crm_activity a
        LEFT JOIN users u ON u.id = a.created_by
        WHERE a.id = ?
      `).get(activityId);
      return c.json(activity);
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  // ── Contacts Directory ───────────────────────────────────
  api.get('/contacts', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { search, relationship, client_id } = q;

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
        sql += " AND (p.first_name || ' ' || p.last_name LIKE ? OR p.phone LIKE ? OR p.email LIKE ?)";
        const esc = escapeLike(String(search));
        const q2 = `%${esc}%`;
        params.push(q2, q2, q2);
      }
      if (relationship) { sql += ' AND cp.relationship = ?'; params.push(relationship); }
      if (client_id) { sql += ' AND cp.client_id = ?'; params.push(client_id); }

      sql += ' ORDER BY c.name, p.last_name, p.first_name';
      const rows = await db.prepare(sql).all(...params);
      return c.json(rows);
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  // ── Expiring Contracts ───────────────────────────────────
  api.get('/expiring-contracts', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const days = Math.max(1, Math.min(365, parseInt(q.days || '', 10) || 90));
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + days);
      const future = futureDate.toISOString().slice(0, 10);

      const rows = await db.prepare(`
        SELECT id, name, contact_name, contact_email, contact_phone,
               contract_start, contract_end, contract_type, contract_value, auto_renew,
               account_manager
        FROM clients
        WHERE status = 'active'
          AND contract_end IS NOT NULL
          AND contract_end <= ?
          AND contract_end >= date('now')
        ORDER BY contract_end ASC
        LIMIT 1000
      `).all(future);

      return c.json(rows);
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  // ── Reports ──────────────────────────────────────────
  api.get('/reports/revenue', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
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
      return c.json(rows);
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  api.get('/reports/pipeline', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const stages = await db.prepare(`
        SELECT pipeline_stage as stage, COUNT(*) as count, COALESCE(SUM(estimated_value), 0) as total_value
        FROM crm_leads
        GROUP BY pipeline_stage
        ORDER BY CASE pipeline_stage
          WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 WHEN 'qualified' THEN 2
          WHEN 'proposal' THEN 3 WHEN 'negotiation' THEN 4 WHEN 'won' THEN 5
          WHEN 'lost' THEN 6 WHEN 'dismissed' THEN 7 END
      `).all();

      const total = ((await db.prepare('SELECT COUNT(*) as c FROM crm_leads').get()) as any)?.c || 0;
      const won = ((await db.prepare("SELECT COUNT(*) as c FROM crm_leads WHERE pipeline_stage = 'won'").get()) as any)?.c || 0;
      const lost = ((await db.prepare("SELECT COUNT(*) as c FROM crm_leads WHERE pipeline_stage = 'lost'").get()) as any)?.c || 0;
      const decided = won + lost;

      return c.json({
        stages,
        total_leads: total,
        conversion_rate: decided > 0 ? Math.round((won / decided) * 100) : 0,
      });
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  api.get('/reports/retention', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
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
      return c.json(rows);
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  api.get('/reports/lead-source-roi', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const rows = await db.prepare(`
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

      return c.json(result);
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  api.get('/reports/metrics', requireRole('admin', 'manager', 'contract_manager'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);

      const pipelineValue = ((await db.prepare(
        "SELECT COALESCE(SUM(estimated_value), 0) as v FROM crm_leads WHERE pipeline_stage NOT IN ('won', 'lost', 'dismissed')"
      ).get()) as any)?.v || 0;

      const won = ((await db.prepare("SELECT COUNT(*) as c FROM crm_leads WHERE pipeline_stage = 'won'").get()) as any)?.c || 0;
      const lost = ((await db.prepare("SELECT COUNT(*) as c FROM crm_leads WHERE pipeline_stage = 'lost'").get()) as any)?.c || 0;
      const decided = won + lost;
      const winRate = decided > 0 ? Math.round((won / decided) * 100) : 0;

      const avgCycle = ((await db.prepare(
        "SELECT AVG(julianday(updated_at) - julianday(created_at)) as d FROM crm_leads WHERE pipeline_stage = 'won'"
      ).get()) as any)?.d || 0;

      const monthStart = localNow().slice(0, 7) + '-01';
      const leadsThisMonth = ((await db.prepare(
        'SELECT COUNT(*) as c FROM crm_leads WHERE created_at >= ?'
      ).get(monthStart)) as any)?.c || 0;

      const proposalsSent = ((await db.prepare(
        "SELECT COUNT(*) as c FROM crm_proposals WHERE stage IN ('sent', 'viewed', 'accepted', 'rejected')"
      ).get()) as any)?.c || 0;

      const proposalsAccepted = ((await db.prepare(
        "SELECT COUNT(*) as c FROM crm_proposals WHERE stage = 'accepted'"
      ).get()) as any)?.c || 0;

      return c.json({
        total_pipeline_value: pipelineValue,
        win_rate: winRate,
        avg_cycle_days: Math.round(avgCycle),
        leads_this_month: leadsThisMonth,
        proposals_sent: proposalsSent,
        proposals_accepted: proposalsAccepted,
      });
    } catch {
      return c.json({ error: 'CRM operation failed', code: 'CRM_ERROR' }, 500);
    }
  });

  app.route('/api/crm', api);
}
