// ============================================================
// RMPG Flex — Work-orders routes (Fleet.io PR 5 + advances)
// ============================================================
// Mounted at /api/work-orders (auth: 'required'). Full CRUD over the
// work_orders table + children (line_items, attachments, comments,
// parts_usage, status_history). Includes scheduling, templates, batch
// ops, analytics, and R2 attachment uploads.
//
// Routes:
//   GET    /                       — list (filters: vehicle_id, status, priority, open_only, scheduled)
//   GET    /stats                  — dashboard analytics (counts by status, priority, category, overdue)
//   GET    /templates              — list work order templates
//   POST   /templates              — create a work order template
//   DELETE /templates/:id          — delete a template
//   GET    /status-history         — list status changes across all WOs
//   POST   /                       — create header (supports scheduling fields)
//   POST   /batch/status           — batch status update
//   GET    /:id                    — full WO with line items + attachments + comments + parts + status history
//   PUT    /:id                    — update header (scheduling + repair fields, status transition guard)
//   POST   /:id/close              — transition to 'completed' + roll up actual_cost
//   POST   /:id/reopen             — re-open a completed/cancelled WO (admin/manager)
//   POST   /:id/approve            — approve work order (est_cost → authorized)
//   POST   /:id/attachments        — upload a file (multipart, stores in R2 UPLOADS bucket)
//   POST   /:id/line-items         — append a line item
//   PUT    /line-items/:itemId     — edit a line item
//   DELETE /line-items/:itemId     — remove a line item
//   POST   /:id/comments           — add a comment
//   GET    /:id/comments           — list comments
//   POST   /:id/parts              — record parts usage
//   GET    /:id/parts              — list parts used
//   GET    /:id/status-history     — status changes for a single WO
//
// All mutating handlers emit a Fleet.io outbound event.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import type { Context } from 'hono';
import type { R2Bucket, D1Database } from '@cloudflare/workers-types';
import { getDb, query, queryFirst, execute, columnExists } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { emitFleetioEvent } from '../utils/fleetio/events';
import { log } from '../utils/logger';
import { dbErrorResponse } from '../utils/dbErrors';
import { putEncrypted } from '../utils/encryptedR2';
import { containsAnyClause } from '../utils/searchText';
import {
  isValidStatus,
  validateTransition,
  normalizeLineItem,
  lineItemsBreakdown,
  isValidPriority,
  type WorkOrderStatus,
  type WorkOrderStats,
  type LineItemInput,
  type TemplateItem,
} from '../utils/workOrders';

const wo = new Hono<Env>();

const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'officer'] as const;
const ADMIN_ROLES = ['admin', 'manager', 'supervisor'] as const;

// Schema reconciler — migration 0158 columns guarded at runtime
let schemaReconciled = false;
async function reconcileSchema(db: D1Database): Promise<void> {
  if (schemaReconciled) return;
  schemaReconciled = true;
  for (const [name, type] of [
    ['scheduled_date', 'TEXT'],
    ['estimated_hours', 'REAL'],
    ['labor_hours', 'REAL'],
    ['priority', "TEXT NOT NULL DEFAULT 'normal'"],
    ['failure_category', 'TEXT'],
    ['cause_code', 'TEXT'],
    ['failure_tier', 'TEXT'],
    ['call_id', 'INTEGER'],
    ['unit_id', 'INTEGER'],
    ['reported_by_user_id', 'INTEGER'],
    ['wait_started_at', 'TEXT'],
    ['vendor_eta', 'TEXT'],
    ['vendor_quote', 'REAL'],
    ['approved_at', 'TEXT'],
    ['approved_by_user_id', 'INTEGER'],
    ['inspection_id', 'INTEGER'],
  ] as const) {
    try {
      if (!(await columnExists(db, 'work_orders', name))) {
        await execute(db, `ALTER TABLE work_orders ADD COLUMN ${name} ${type}`);
      }
    } catch (err) { log.warn('[workOrders] reconcile column', { column: name, error: (err as Error)?.message }); }
  }
}

// ─── Static paths before /:id ──────────────────────────────────

// GET /stats — dashboard analytics
wo.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);
    const total = await queryFirst<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM work_orders') ?? { n: 0 };
    const byStatus = await query<{ status: string; n: number }>(
      db, 'SELECT status, COUNT(*) AS n FROM work_orders GROUP BY status',
    );
    const byPriority = await query<{ priority: string; n: number }>(
      db, "SELECT COALESCE(priority, 'normal') AS priority, COUNT(*) AS n FROM work_orders GROUP BY priority",
    );
    const byCategory = await query<{ category_code: string | null; n: number }>(
      db, "SELECT COALESCE(category_code, 'uncategorized') AS category_code, COUNT(*) AS n FROM work_orders GROUP BY category_code ORDER BY n DESC",
    );
    const costRow = await queryFirst<{ actual: number; estimated: number }>(
      db, "SELECT COALESCE(SUM(actual_cost), 0) AS actual, COALESCE(SUM(est_cost), 0) AS estimated FROM work_orders WHERE status NOT IN ('cancelled')",
    ) ?? { actual: 0, estimated: 0 };
    const overdue = await queryFirst<{ n: number }>(
      db, "SELECT COUNT(*) AS n FROM work_orders WHERE scheduled_date IS NOT NULL AND scheduled_date < date('now') AND status NOT IN ('completed','cancelled')",
    ) ?? { n: 0 };
    const scheduled = await queryFirst<{ n: number }>(
      db, "SELECT COUNT(*) AS n FROM work_orders WHERE scheduled_date IS NOT NULL AND status NOT IN ('completed','cancelled')",
    ) ?? { n: 0 };
    const monthly = await query<{ month: string; n: number }>(
      db, "SELECT strftime('%Y-%m', opened_at) AS month, COUNT(*) AS n FROM work_orders GROUP BY month ORDER BY month DESC LIMIT 12",
    );

    const statusMap: Record<string, number> = {};
    for (const r of byStatus) statusMap[r.status] = r.n;
    const priorityMap: Record<string, number> = {};
    for (const r of byPriority) priorityMap[r.priority] = r.n;
    const categoryMap: Record<string, number> = {};
    for (const r of byCategory) categoryMap[String(r.category_code)] = r.n;

    const stats: WorkOrderStats = {
      total: total.n ?? 0,
      open: statusMap['open'] ?? 0,
      in_progress: statusMap['in_progress'] ?? 0,
      waiting_parts: statusMap['waiting_parts'] ?? 0,
      completed: statusMap['completed'] ?? 0,
      cancelled: statusMap['cancelled'] ?? 0,
      by_priority: priorityMap,
      by_category: categoryMap,
      total_actual_cost: costRow.actual,
      total_estimated_cost: costRow.estimated,
      overdue_count: overdue.n ?? 0,
      scheduled_count: scheduled.n ?? 0,
    };
    return c.json({ stats, monthly });
  } catch (err) {
    log.error('[workOrders] GET /stats failed', {}, err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

// ─── GET / — list ──────────────────────────────────────────

wo.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const vehicleIdRaw = c.req.query('vehicle_id');
    const statusFilter = c.req.query('status');
    const priorityFilter = c.req.query('priority');
    const openOnly = c.req.query('open_only') === '1';
    const scheduledOnly = c.req.query('scheduled_only') === '1';
    const search = c.req.query('q');
    const limit = clampLimit(c.req.query('limit'));

    const conds: string[] = [];
    const bindings: unknown[] = [];
    if (vehicleIdRaw) {
      const vid = parseInt(vehicleIdRaw, 10);
      if (Number.isInteger(vid) && vid > 0) {
        conds.push('vehicle_id = ?');
        bindings.push(vid);
      }
    }
    if (statusFilter && isValidStatus(statusFilter)) {
      conds.push('status = ?');
      bindings.push(statusFilter);
    }
    if (priorityFilter && isValidPriority(priorityFilter)) {
      conds.push('priority = ?');
      bindings.push(priorityFilter);
    }
    if (openOnly) {
      conds.push("status NOT IN ('completed','cancelled')");
    }
    if (scheduledOnly) {
      conds.push('scheduled_date IS NOT NULL');
    }
    if (search) {
      const m = containsAnyClause(['summary', 'number', 'notes']);
      conds.push(m.sql); bindings.push(...m.binds(search));
    }
    const where = conds.length > 0 ? 'WHERE ' + conds.join(' AND ') : '';
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM work_orders ${where} ORDER BY
        CASE priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        opened_at DESC LIMIT ?`,
      ...bindings, limit,
    );
    return c.json({ count: rows.length, data: rows });
  } catch (err) {
    log.error('[workOrders] GET / failed', {}, err);
    return dbErrorResponse(c, err, 'Failed', 'DB_ERROR');
  }
});

// ─── Templates CRUD ───────────────────────────────────────

wo.get('/templates', async (c) => {
  try {
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db, 'SELECT * FROM work_order_templates ORDER BY name ASC',
    );
    for (const r of rows) {
      try { (r as any).template_items = JSON.parse((r as any).template_items_json ?? '[]'); }
      catch { (r as any).template_items = []; }
    }
    return c.json({ count: rows.length, data: rows });
  } catch (err) {
    log.error('[workOrders] GET /templates failed', {}, err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

wo.post('/templates', requireRole(...ADMIN_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
    const body = await c.req.json<{
      name?: string; category_code?: string; summary?: string;
      estimated_hours?: number; priority?: string; notes?: string;
      template_items?: TemplateItem[];
    }>();
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    const result = await execute(db,
      `INSERT INTO work_order_templates
         (name, category_code, summary, estimated_hours, priority,
          template_items_json, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      body.name, body.category_code ?? null, body.summary ?? null,
      numericOrNull(body.estimated_hours),
      isValidPriority(body.priority) ? body.priority : 'normal',
      JSON.stringify(body.template_items ?? []),
      body.notes ?? null, userId,
    );
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_order_templates WHERE id = ?', result.meta.last_row_id,
    );
    if (created) {
      try { (created as any).template_items = JSON.parse((created as any).template_items_json ?? '[]'); }
      catch { (created as any).template_items = []; }
    }
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('[workOrders] POST /templates failed', {}, err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

wo.delete('/templates/:id{[0-9]+}', requireRole(...ADMIN_ROLES), async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ id: number }>(db, 'SELECT id FROM work_order_templates WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Template not found' }, 404);
    await execute(db, 'DELETE FROM work_order_templates WHERE id = ?', id);
    return c.json({ success: true });
  } catch (err) {
    log.error('[workOrders] DELETE /templates/:id failed', {}, err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

// ─── Batch operations ─────────────────────────────────────

wo.post('/batch/status', requireRole(...ADMIN_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
    const body = await c.req.json<{ ids?: number[]; status?: string; reason?: string }>();
    const { ids, status, reason } = body;
    if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: 'ids array required' }, 400);
    if (!status || !isValidStatus(status)) {
      return c.json({ error: `Invalid status '${status}'` }, 400);
    }

    let updated = 0;
    const errors: { id: number; error: string }[] = [];
    for (const id of ids) {
      const existing = await queryFirst<{ status: string }>(db, 'SELECT status FROM work_orders WHERE id = ?', id);
      if (!existing) { errors.push({ id, error: 'Not found' }); continue; }
      if (existing.status === status) { updated++; continue; }
      const transitionErr = validateTransition(existing.status as WorkOrderStatus, status as WorkOrderStatus);
      if (transitionErr) { errors.push({ id, error: transitionErr }); continue; }

      const closedClause = status === 'completed' ? ", closed_at = datetime('now')" : '';
      const reopenClause = status === 'open' ? ", closed_at = NULL" : "";
      await execute(db,
        `UPDATE work_orders SET status = ?, updated_at = datetime('now')${closedClause}${reopenClause} WHERE id = ?`,
        status, id,
      );
      await recordStatusChange(db, id, existing.status, status, userId, reason ?? null);
      updated++;
    }
    return c.json({ success: true, updated, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    log.error('[workOrders] POST /batch/status failed', {}, err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

// ─── Status history ───────────────────────────────────────

wo.get('/status-history', async (c) => {
  try {
    const db = getDb(c.env);
    const limit = clampLimit(c.req.query('limit'));
    const rows = await query<Record<string, unknown>>(
      db, `SELECT h.*, u.full_name AS changed_by_name
           FROM work_order_status_history h
           LEFT JOIN users u ON u.id = h.changed_by_user_id
           ORDER BY h.id DESC LIMIT ?`,
      limit,
    );
    return c.json({ count: rows.length, data: rows });
  } catch (err) {
    log.error('GET /status-history failed', { src: 'src/routes/workOrders.ts' }, err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

// ─── POST / — create header (with scheduling fields) ─────

wo.post('/', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    await reconcileSchema(db);

    const userId = (c.get('userId') as number | undefined) ?? null;
    const body = await c.req.json<Record<string, unknown>>();
    const vehicleId = numericId(body.vehicle_id);
    if (vehicleId == null) {
      return c.json({ error: 'vehicle_id is required and must be a positive integer', code: 'INVALID_VEHICLE' }, 400);
    }
    const status = (body.status as string | undefined) ?? 'open';
    if (!isValidStatus(status)) {
      return c.json({ error: `Invalid status '${status}'`, code: 'INVALID_STATUS' }, 400);
    }

    const result = await execute(db,
      `INSERT INTO work_orders
         (vehicle_id, status, number, summary, vendor_id, category_code,
          assigned_to_user_id, est_cost, odometer_at_open,
          vmrs_system_code, vmrs_assembly_code, vmrs_component_code,
          notes, custom_fields_json, created_by,
          scheduled_date, estimated_hours, priority, failure_category,
          cause_code, call_id, unit_id, reported_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      vehicleId, status,
      body.number ?? null, body.summary ?? null,
      numericOrNull(body.vendor_id), body.category_code ?? null,
      numericOrNull(body.assigned_to_user_id), numericOrNull(body.est_cost),
      numericOrNull(body.odometer_at_open),
      body.vmrs_system_code ?? null, body.vmrs_assembly_code ?? null,
      body.vmrs_component_code ?? null, body.notes ?? null,
      body.custom_fields_json ? String(body.custom_fields_json) : null, userId,
      body.scheduled_date ?? null, numericOrNull(body.estimated_hours),
      isValidPriority(body.priority) ? body.priority : 'normal',
      body.failure_category ?? null, body.cause_code ?? null,
      numericOrNull(body.call_id), numericOrNull(body.unit_id),
      numericOrNull(body.reported_by_user_id),
    );
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_orders WHERE id = ?', result.meta.last_row_id,
    );
    emitWorkOrderEvent(c, 'work_order.create', created, Number(result.meta.last_row_id));
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('[workOrders] POST / failed', {}, err);
    return dbErrorResponse(c, err, 'Failed to create work order', 'DB_ERROR');
  }
});

// ─── GET /:id — single WO with all children ───────────────

wo.get('/:id{[0-9]+}', async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const header = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_orders WHERE id = ?', id,
    );
    if (!header) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    const line_items = await query<Record<string, unknown>>(
      db, 'SELECT * FROM work_order_line_items WHERE work_order_id = ? ORDER BY sort_order, id', id,
    );
    const attachments = await query<Record<string, unknown>>(
      db, 'SELECT id, filename, mime, size_bytes, uploaded_by, uploaded_at FROM work_order_attachments WHERE work_order_id = ? ORDER BY uploaded_at', id,
    );
    const comments = await query<Record<string, unknown>>(
      db, 'SELECT * FROM work_order_comments WHERE work_order_id = ? ORDER BY created_at', id,
    );
    const parts = await query<Record<string, unknown>>(
      db, 'SELECT * FROM work_order_parts_usage WHERE work_order_id = ? ORDER BY created_at', id,
    );
    const statusHistory = await query<Record<string, unknown>>(
      db, `SELECT h.*, u.full_name AS changed_by_name
           FROM work_order_status_history h
           LEFT JOIN users u ON u.id = h.changed_by_user_id
           WHERE h.work_order_id = ? ORDER BY h.created_at`, id,
    );
    const breakdown = lineItemsBreakdown(line_items.map(toLineItemInput));
    return c.json({ data: { header, line_items, attachments, comments, parts, status_history: statusHistory, totals: breakdown } });
  } catch (err) {
    log.error('[workOrders] GET /:id failed', {}, err);
    return dbErrorResponse(c, err, 'Failed', 'DB_ERROR');
  }
});

// ─── PUT /:id — update header (scheduling + repair fields) ──

wo.put('/:id{[0-9]+}', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    await reconcileSchema(db);
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const existing = await queryFirst<{ status: string }>(
      db, 'SELECT status FROM work_orders WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    const body = await c.req.json<Record<string, unknown>>();

    const oldStatus = existing.status;
    if (body.status != null) {
      if (!isValidStatus(body.status)) {
        return c.json({ error: `Invalid status '${body.status}'`, code: 'INVALID_STATUS' }, 400);
      }
      const transitionErr = validateTransition(oldStatus as WorkOrderStatus, body.status as WorkOrderStatus);
      if (transitionErr) return c.json({ error: transitionErr, code: 'INVALID_TRANSITION' }, 400);
    }

    const UPDATABLE: Record<string, true> = {
      status: true, number: true, summary: true, vendor_id: true, category_code: true,
      assigned_to_user_id: true, est_cost: true, actual_cost: true,
      odometer_at_open: true, odometer_at_close: true,
      vmrs_system_code: true, vmrs_assembly_code: true, vmrs_component_code: true,
      notes: true, custom_fields_json: true,
      scheduled_date: true, estimated_hours: true, labor_hours: true,
      priority: true, failure_category: true, cause_code: true, failure_tier: true,
      call_id: true, unit_id: true, reported_by_user_id: true,
      wait_started_at: true, vendor_eta: true, vendor_quote: true,
      inspection_id: true,
    };
    const setCols: string[] = [];
    const bindings: unknown[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (UPDATABLE[k]) {
        setCols.push(`${k} = ?`);
        bindings.push(coerceField(k, v));
      }
    }
    if (setCols.length === 0) return c.json({ error: 'No editable fields provided' }, 400);

    const closedClause = body.status === 'completed' ? ", closed_at = COALESCE(closed_at, datetime('now'))" : '';
    setCols.push("updated_at = datetime('now')");
    bindings.push(id);
    await execute(db, `UPDATE work_orders SET ${setCols.join(', ')} ${closedClause ? ', ' + closedClause.replace(', ', '') : ''} WHERE id = ?`, ...bindings);

    // Record status transition
    const newStatus = body.status as string | undefined;
    if (newStatus && newStatus !== oldStatus) {
      const userId = (c.get('userId') as number | undefined) ?? null;
      await recordStatusChange(db, id, oldStatus, newStatus, userId, null);
    }

    const updated = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_orders WHERE id = ?', id,
    );
    emitWorkOrderEvent(c, 'work_order.update', updated, id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('[workOrders] PUT /:id failed', {}, err);
    return dbErrorResponse(c, err, 'Failed', 'DB_ERROR');
  }
});

// ─── POST /:id/reopen — re-open completed/cancelled WO ─────

wo.post('/:id{[0-9]+}/reopen', requireRole(...ADMIN_ROLES), async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ status: string }>(db, 'SELECT status FROM work_orders WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Not found' }, 404);
    if (existing.status !== 'completed' && existing.status !== 'cancelled') {
      return c.json({ error: `Cannot re-open a ${existing.status} work order` }, 400);
    }
    const userId = (c.get('userId') as number | undefined) ?? null;
    await execute(db,
      `UPDATE work_orders SET status = 'open', closed_at = NULL, updated_at = datetime('now') WHERE id = ?`,
      id,
    );
    await recordStatusChange(db, id, existing.status, 'open', userId, 'Re-opened by admin');
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM work_orders WHERE id = ?', id);
    emitWorkOrderEvent(c, 'work_order.update', updated, id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('[workOrders] POST /:id/reopen failed', {}, err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

// ─── POST /:id/approve — approve work order ────────────────

wo.post('/:id{[0-9]+}/approve', requireRole(...ADMIN_ROLES), async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM work_orders WHERE id = ?', id);
    if (!existing) return c.json({ error: 'Not found' }, 404);
    const userId = (c.get('userId') as number | undefined) ?? null;
    await execute(db,
      `UPDATE work_orders SET approved_at = datetime('now'), approved_by_user_id = ?, updated_at = datetime('now') WHERE id = ?`,
      userId, id,
    );
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const approveStatus = body.status as string | undefined;
    if (approveStatus && isValidStatus(approveStatus) && approveStatus !== existing.status) {
      const transitionErr = validateTransition(existing.status as WorkOrderStatus, approveStatus as WorkOrderStatus);
      if (!transitionErr) {
        await execute(db, "UPDATE work_orders SET status = ?, updated_at = datetime('now') WHERE id = ?", approveStatus, id);
        await recordStatusChange(db, id, existing.status as string, approveStatus, userId, 'Approved');
      }
    }
    const updated = await queryFirst<Record<string, unknown>>(db, 'SELECT * FROM work_orders WHERE id = ?', id);
    emitWorkOrderEvent(c, 'work_order.update', updated, id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('[workOrders] POST /:id/approve failed', {}, err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

// ─── POST /:id/close — transition to completed + roll up actual_cost ──

wo.post('/:id{[0-9]+}/close', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ status: string }>(
      db, 'SELECT status FROM work_orders WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    const transitionErr = validateTransition(existing.status as WorkOrderStatus, 'completed');
    if (transitionErr) return c.json({ error: transitionErr, code: 'INVALID_TRANSITION' }, 400);

    const items = await query<Record<string, unknown>>(
      db, 'SELECT kind, qty, unit_cost, total_cost FROM work_order_line_items WHERE work_order_id = ?', id,
    );
    const totals = lineItemsBreakdown(items.map(toLineItemInput));

    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const closingOdometer = numericOrNull(body.odometer_at_close);
    const laborHours = numericOrNull(body.labor_hours);

    await execute(db,
      `UPDATE work_orders
       SET status = 'completed', closed_at = datetime('now'),
           actual_cost = ?,
           odometer_at_close = COALESCE(?, odometer_at_close),
           labor_hours = COALESCE(?, labor_hours),
           updated_at = datetime('now')
       WHERE id = ?`,
      totals.total, closingOdometer, laborHours, id,
    );
    const userId = (c.get('userId') as number | undefined) ?? null;
    await recordStatusChange(db, id, existing.status, 'completed', userId, null);

    const closed = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_orders WHERE id = ?', id,
    );
    emitWorkOrderEvent(c, 'work_order.close', closed, id);
    return c.json({ data: closed, totals });
  } catch (err) {
    log.error('[workOrders] POST /:id/close failed', {}, err);
    return dbErrorResponse(c, err, 'Failed to close work order', 'DB_ERROR');
  }
});

// ─── POST /:id/attachments — upload file to R2 ────────────

wo.post('/:id{[0-9]+}/attachments', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const exists = await queryFirst<{ id: number }>(db, 'SELECT id FROM work_orders WHERE id = ?', id);
    if (!exists) return c.json({ error: 'Work order not found' }, 404);

    const userId = (c.get('userId') as number | undefined) ?? null;
    const uploads = c.env.UPLOADS as (import('@cloudflare/workers-types').R2Bucket | undefined);
    if (!uploads) return c.json({ error: 'Upload storage not configured', code: 'STORAGE_UNCONFIGURED' }, 503);

    const fd = await c.req.formData().catch(() => null);
    if (!fd) return c.json({ error: 'Expected multipart/form-data' }, 400);

    const file = fd.get('file') as File | null;
    if (!file) return c.json({ error: 'file field is required' }, 400);

    const filename = file.name || 'unnamed';
    const mime = file.type || 'application/octet-stream';
    const maxBytes = 50 * 1024 * 1024;
    if (file.size > maxBytes) return c.json({ error: `File too large (max ${maxBytes / 1024 / 1024} MB)` }, 400);

    const buf = await file.arrayBuffer();
    const r2Key = `work-order-attachments/${id}/${Date.now()}_${filename}`;
    await putEncrypted(uploads, db, c.env, r2Key, buf, {
      httpMetadata: { contentType: mime },
    });

    const result = await execute(db,
      `INSERT INTO work_order_attachments
         (work_order_id, r2_key, filename, mime, size_bytes, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, r2Key, filename, mime, buf.byteLength, userId,
    );
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT id, filename, mime, size_bytes, uploaded_by, uploaded_at FROM work_order_attachments WHERE id = ?',
      result.meta.last_row_id,
    );
    emitWorkOrderEvent(c, 'work_order.update', { attachment: created }, id);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('[workOrders] POST /:id/attachments failed', {}, err);
    return dbErrorResponse(c, err, 'Failed', 'DB_ERROR');
  }
});

// ─── Parts usage ──────────────────────────────────────────

wo.get('/:id{[0-9]+}/parts', async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const rows = await query<Record<string, unknown>>(
      getDb(c.env), 'SELECT * FROM work_order_parts_usage WHERE work_order_id = ? ORDER BY created_at', id,
    );
    return c.json({ count: rows.length, data: rows });
  } catch (err) {
    log.error('GET /:id{[0-9]+}/parts failed', { src: 'src/routes/workOrders.ts' }, err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

wo.post('/:id{[0-9]+}/parts', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const exists = await queryFirst<{ id: number }>(db, 'SELECT id FROM work_orders WHERE id = ?', id);
    if (!exists) return c.json({ error: 'Work order not found' }, 404);

    const body = await c.req.json<{
      line_item_id?: number; part_sku?: string; part_name?: string;
      qty?: number; unit_cost?: number; total_cost?: number; vendor_name?: string;
    }>();
    if (!body.part_sku && !body.part_name) {
      return c.json({ error: 'part_sku or part_name required' }, 400);
    }

    const result = await execute(db,
      `INSERT INTO work_order_parts_usage
         (work_order_id, line_item_id, part_sku, part_name, qty, unit_cost, total_cost, vendor_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, numericOrNull(body.line_item_id), body.part_sku ?? null, body.part_name ?? null,
      body.qty ?? 1, numericOrNull(body.unit_cost),
      numericOrNull(body.total_cost), body.vendor_name ?? null,
    );
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_order_parts_usage WHERE id = ?', result.meta.last_row_id,
    );
    emitWorkOrderEvent(c, 'work_order.update', { part: created }, id);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('[workOrders] POST /:id/parts failed', {}, err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

// ─── Status history for a single WO ───────────────────────

wo.get('/:id{[0-9]+}/status-history', async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const rows = await query<Record<string, unknown>>(
      getDb(c.env),
      `SELECT h.*, u.full_name AS changed_by_name
       FROM work_order_status_history h
       LEFT JOIN users u ON u.id = h.changed_by_user_id
       WHERE h.work_order_id = ? ORDER BY h.created_at`, id,
    );
    return c.json({ count: rows.length, data: rows });
  } catch (err) {
    log.error('GET /:id{[0-9]+}/status-history failed', { src: 'src/routes/workOrders.ts' }, err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

// ─── POST /:id/line-items — append ────────────────────────

wo.post('/:id{[0-9]+}/line-items', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const exists = await queryFirst<{ id: number }>(
      db, 'SELECT id FROM work_orders WHERE id = ?', id,
    );
    if (!exists) return c.json({ error: 'Work order not found' }, 404);
    const body = await c.req.json<LineItemInput>();
    if (!body.description || (body.kind !== 'labor' && body.kind !== 'part' && body.kind !== 'fee')) {
      return c.json({ error: "Required fields: kind ('labor'|'part'|'fee'), description" }, 400);
    }
    const norm = normalizeLineItem(body);
    const result = await execute(db,
      `INSERT INTO work_order_line_items
         (work_order_id, kind, description, qty, unit_cost, total_cost,
          part_sku, vmrs_system_code, vmrs_assembly_code, vmrs_component_code,
          labor_rate_code, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, norm.kind, norm.description, norm.qty ?? 1,
      norm.unit_cost, norm.total_cost,
      norm.part_sku ?? null, norm.vmrs_system_code ?? null,
      norm.vmrs_assembly_code ?? null, norm.vmrs_component_code ?? null,
      norm.labor_rate_code ?? null, norm.sort_order ?? 0,
    );
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_order_line_items WHERE id = ?', result.meta.last_row_id,
    );
    emitWorkOrderEvent(c, 'work_order.update', { line_item: created }, id);
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('[workOrders] POST /:id/line-items failed', {}, err);
    return dbErrorResponse(c, err, 'Failed', 'DB_ERROR');
  }
});

// ─── PUT /line-items/:itemId / DELETE /line-items/:itemId ──

wo.put('/line-items/:itemId{[0-9]+}', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const itemId = numericId(c.req.param('itemId'));
    if (itemId == null) return c.json({ error: 'Invalid item id' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ work_order_id: number }>(
      db, 'SELECT work_order_id FROM work_order_line_items WHERE id = ?', itemId,
    );
    if (!existing) return c.json({ error: 'Line item not found' }, 404);
    const body = await c.req.json<LineItemInput>();
    const norm = normalizeLineItem({ ...body, kind: body.kind ?? 'fee', description: body.description ?? '' });
    const FIELD_TO_COL: Record<string, string> = {
      kind: 'kind', description: 'description', qty: 'qty',
      unit_cost: 'unit_cost', total_cost: 'total_cost',
      part_sku: 'part_sku', vmrs_system_code: 'vmrs_system_code',
      vmrs_assembly_code: 'vmrs_assembly_code', vmrs_component_code: 'vmrs_component_code',
      labor_rate_code: 'labor_rate_code', sort_order: 'sort_order',
    };
    const setCols: string[] = [];
    const bindings: unknown[] = [];
    const normIdx = norm as unknown as Record<string, unknown>;
    for (const [k, col] of Object.entries(FIELD_TO_COL)) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        setCols.push(`${col} = ?`);
        bindings.push(normIdx[k] ?? null);
      }
    }
    if (setCols.length === 0) return c.json({ error: 'No editable fields' }, 400);
    bindings.push(itemId);
    await execute(db, `UPDATE work_order_line_items SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    const updated = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_order_line_items WHERE id = ?', itemId,
    );
    emitWorkOrderEvent(c, 'work_order.update', { line_item: updated }, existing.work_order_id);
    return c.json({ data: updated });
  } catch (err) {
    log.error('[workOrders] PUT /line-items/:itemId failed', {}, err);
    return dbErrorResponse(c, err, 'Failed', 'DB_ERROR');
  }
});

wo.delete('/line-items/:itemId{[0-9]+}', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const itemId = numericId(c.req.param('itemId'));
    if (itemId == null) return c.json({ error: 'Invalid item id' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ work_order_id: number }>(
      db, 'SELECT work_order_id FROM work_order_line_items WHERE id = ?', itemId,
    );
    if (!existing) return c.json({ error: 'Line item not found' }, 404);
    await execute(db, 'DELETE FROM work_order_line_items WHERE id = ?', itemId);
    emitWorkOrderEvent(c, 'work_order.update', { deleted_line_item_id: itemId }, existing.work_order_id);
    return c.json({ success: true });
  } catch (err) {
    log.error('[workOrders] DELETE /line-items/:itemId failed', {}, err);
    return dbErrorResponse(c, err, 'Failed', 'DB_ERROR');
  }
});

// ─── Comments ────────────────────────────────────────────

wo.get('/:id{[0-9]+}/comments', async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const rows = await query<Record<string, unknown>>(
      db, 'SELECT * FROM work_order_comments WHERE work_order_id = ? ORDER BY created_at', id,
    );
    return c.json({ count: rows.length, data: rows });
  } catch (err) {
    log.error('[workOrders] GET /:id/comments failed', {}, err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

wo.post('/:id{[0-9]+}/comments', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const userId = c.get('userId') as number | undefined;
    if (userId == null) return c.json({ error: 'Authentication required' }, 401);
    const body = await c.req.json<{ body?: string }>();
    if (!body.body || !body.body.trim()) return c.json({ error: 'body is required' }, 400);
    const db = getDb(c.env);
    const exists = await queryFirst<{ id: number }>(db, 'SELECT id FROM work_orders WHERE id = ?', id);
    if (!exists) return c.json({ error: 'Work order not found' }, 404);
    const result = await execute(db,
      `INSERT INTO work_order_comments (work_order_id, user_id, body) VALUES (?, ?, ?)`,
      id, userId, body.body.trim(),
    );
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_order_comments WHERE id = ?', result.meta.last_row_id,
    );
    return c.json({ data: created }, 201);
  } catch (err) {
    log.error('[workOrders] POST /:id/comments failed', {}, err);
    return c.json({ error: 'Failed', code: 'DB_ERROR' }, 500);
  }
});

// ─── Helpers ─────────────────────────────────────────────

function emitWorkOrderEvent(
  c: Parameters<typeof emitFleetioEvent>[0],
  kind: 'work_order.create' | 'work_order.update' | 'work_order.close',
  payload: unknown,
  workOrderId: number,
): void {
  try {
    c.executionCtx.waitUntil(
      emitFleetioEvent(c, kind, payload, {
        rmpgTable: 'work_orders',
        rmpgId: workOrderId,
        versionToken: `${kind}:${workOrderId}:${Date.now()}`,
      }),
    );
  } catch { /* executionCtx unavailable in tests */ }
}

async function recordStatusChange(
  db: ReturnType<typeof getDb>,
  workOrderId: number,
  fromStatus: string,
  toStatus: string,
  changedByUserId: number | null,
  reason: string | null,
): Promise<void> {
  try {
    await execute(db,
      `INSERT INTO work_order_status_history
         (work_order_id, from_status, to_status, changed_by_user_id, reason)
       VALUES (?, ?, ?, ?, ?)`,
      workOrderId, fromStatus, toStatus, changedByUserId, reason,
    );
  } catch { /* best-effort */ }
}

function numericId(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw === 'string') {
    const n = parseInt(raw, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

function numericOrNull(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function clampLimit(raw: string | undefined): number {
  const DEFAULT = 100, MAX = 1000;
  if (!raw) return DEFAULT;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT;
  return Math.min(n, MAX);
}

function coerceField(key: string, v: unknown): unknown {
  if (v === '' || v === undefined) return null;
  if (['vendor_id', 'assigned_to_user_id', 'odometer_at_open', 'odometer_at_close',
       'call_id', 'unit_id', 'reported_by_user_id', 'approved_by_user_id',
       'inspection_id'].includes(key)) {
    return numericOrNull(v);
  }
  if (['est_cost', 'actual_cost', 'estimated_hours', 'labor_hours', 'vendor_quote'].includes(key)) {
    return numericOrNull(v);
  }
  return v;
}

function toLineItemInput(row: Record<string, unknown>): LineItemInput {
  return {
    kind: row.kind as 'labor' | 'part' | 'fee',
    description: typeof row.description === 'string' ? row.description : '',
    qty: typeof row.qty === 'number' ? row.qty : null,
    unit_cost: typeof row.unit_cost === 'number' ? row.unit_cost : null,
    total_cost: typeof row.total_cost === 'number' ? row.total_cost : null,
  };
}

export default wo;