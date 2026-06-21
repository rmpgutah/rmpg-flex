// ============================================================
// RMPG Flex — Work-orders routes (Fleet.io PR 5)
// ============================================================
// Mounted at /api/work-orders (auth: 'required'). CRUD over the
// work_orders table + its three children (line_items, attachments,
// comments). Wires the Fleet.io outbound queue on create/update/close
// per the PR 4 emit kinds.
//
// Routes:
//   GET    /                       — list (filters: vehicle_id, status, open_only)
//   GET    /:id                    — full WO with line items + attachments + comments
//   POST   /                       — create header
//   PUT    /:id                    — update header (validates status transition)
//   POST   /:id/close              — transition to 'completed' + roll up actual_cost
//   POST   /:id/line-items         — append a line item
//   PUT    /line-items/:itemId     — edit a line item
//   DELETE /line-items/:itemId     — remove a line item
//   POST   /:id/comments           — add a comment
//   GET    /:id/comments           — list comments
//
// All mutating handlers emit a Fleet.io outbound event via the PR 3
// helper. Per the PR 4 sync engine, those events drain to Fleet.io on
// the 30-min reconciliation cron once secrets are provisioned.
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { emitFleetioEvent } from '../utils/fleetio/events';
import {
  isValidStatus,
  validateTransition,
  normalizeLineItem,
  lineItemsBreakdown,
  type WorkOrderStatus,
  type LineItemInput,
} from '../utils/workOrders';

const wo = new Hono<Env>();

const WRITE_ROLES = ['admin', 'manager', 'supervisor', 'officer'] as const;

// ─── GET / — list ──────────────────────────────────────────

wo.get('/', async (c) => {
  try {
    const db = getDb(c.env);
    const vehicleIdRaw = c.req.query('vehicle_id');
    const statusFilter = c.req.query('status');
    const openOnly = c.req.query('open_only') === '1';
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
    if (openOnly) {
      conds.push("status NOT IN ('completed','cancelled')");
    }
    const where = conds.length > 0 ? 'WHERE ' + conds.join(' AND ') : '';
    const rows = await query<Record<string, unknown>>(
      db,
      `SELECT * FROM work_orders ${where} ORDER BY opened_at DESC LIMIT ?`,
      ...bindings, limit,
    );
    return c.json({ count: rows.length, data: rows });
  } catch (err) {
    console.error('[workOrders] GET / failed', err);
    return c.json({ error: 'Failed', code: 'DB_ERROR', detail: (err as Error)?.message }, 500);
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
    const breakdown = lineItemsBreakdown(line_items.map(toLineItemInput));
    return c.json({ data: { header, line_items, attachments, comments, totals: breakdown } });
  } catch (err) {
    console.error('[workOrders] GET /:id failed', err);
    return c.json({ error: 'Failed', code: 'DB_ERROR', detail: (err as Error)?.message }, 500);
  }
});

// ─── POST / — create header ───────────────────────────────

wo.post('/', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const db = getDb(c.env);
    const userId = (c.get('userId') as number | undefined) ?? null;
    const body = await c.req.json<Record<string, unknown>>();
    const vehicleId = numericId(body.vehicle_id);
    if (vehicleId == null) {
      return c.json({ error: 'vehicle_id is required and must be a positive integer', code: 'INVALID_VEHICLE' }, 400);
    }
    const status = (body.status as string | undefined) ?? 'open';
    if (!isValidStatus(status)) {
      return c.json({
        error: `Invalid status '${status}'`, code: 'INVALID_STATUS',
        allowed: ['open', 'in_progress', 'waiting_parts', 'completed', 'cancelled'],
      }, 400);
    }
    const result = await execute(db,
      `INSERT INTO work_orders
         (vehicle_id, status, number, summary, vendor_id, category_code,
          assigned_to_user_id, est_cost, odometer_at_open,
          vmrs_system_code, vmrs_assembly_code, vmrs_component_code,
          notes, custom_fields_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      vehicleId, status,
      body.number ?? null,
      body.summary ?? null,
      numericOrNull(body.vendor_id),
      body.category_code ?? null,
      numericOrNull(body.assigned_to_user_id),
      numericOrNull(body.est_cost),
      numericOrNull(body.odometer_at_open),
      body.vmrs_system_code ?? null,
      body.vmrs_assembly_code ?? null,
      body.vmrs_component_code ?? null,
      body.notes ?? null,
      body.custom_fields_json ? String(body.custom_fields_json) : null,
      userId,
    );
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_orders WHERE id = ?', result.meta.last_row_id,
    );
    emitWorkOrderEvent(c, 'work_order.create', created, Number(result.meta.last_row_id));
    return c.json({ data: created }, 201);
  } catch (err) {
    console.error('[workOrders] POST / failed', err);
    return c.json({ error: 'Failed to create work order', code: 'DB_ERROR', detail: (err as Error)?.message }, 500);
  }
});

// ─── PUT /:id — update header (with status-transition guard) ──

wo.put('/:id{[0-9]+}', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ status: WorkOrderStatus }>(
      db, 'SELECT status FROM work_orders WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    const body = await c.req.json<Record<string, unknown>>();

    if (body.status != null) {
      if (!isValidStatus(body.status)) {
        return c.json({ error: `Invalid status '${body.status}'`, code: 'INVALID_STATUS' }, 400);
      }
      const transitionErr = validateTransition(existing.status, body.status);
      if (transitionErr) {
        return c.json({ error: transitionErr, code: 'INVALID_TRANSITION' }, 400);
      }
    }

    const UPDATABLE: Record<string, true> = {
      status: true, number: true, summary: true, vendor_id: true, category_code: true,
      assigned_to_user_id: true, est_cost: true, actual_cost: true,
      odometer_at_open: true, odometer_at_close: true,
      vmrs_system_code: true, vmrs_assembly_code: true, vmrs_component_code: true,
      notes: true, custom_fields_json: true,
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
    setCols.push("updated_at = datetime('now')");
    bindings.push(id);
    await execute(db, `UPDATE work_orders SET ${setCols.join(', ')} WHERE id = ?`, ...bindings);
    const updated = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_orders WHERE id = ?', id,
    );
    emitWorkOrderEvent(c, 'work_order.update', updated, id);
    return c.json({ data: updated });
  } catch (err) {
    console.error('[workOrders] PUT /:id failed', err);
    return c.json({ error: 'Failed', code: 'DB_ERROR', detail: (err as Error)?.message }, 500);
  }
});

// ─── POST /:id/close — transition to completed + roll up actual_cost ──

wo.post('/:id{[0-9]+}/close', requireRole(...WRITE_ROLES), async (c) => {
  try {
    const id = numericId(c.req.param('id'));
    if (id == null) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    const existing = await queryFirst<{ status: WorkOrderStatus }>(
      db, 'SELECT status FROM work_orders WHERE id = ?', id,
    );
    if (!existing) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    const transitionErr = validateTransition(existing.status, 'completed');
    if (transitionErr) {
      return c.json({ error: transitionErr, code: 'INVALID_TRANSITION' }, 400);
    }
    const items = await query<Record<string, unknown>>(
      db, 'SELECT kind, qty, unit_cost, total_cost FROM work_order_line_items WHERE work_order_id = ?', id,
    );
    const totals = lineItemsBreakdown(items.map(toLineItemInput));

    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const closingOdometer = numericOrNull(body.odometer_at_close);

    await execute(db,
      `UPDATE work_orders
       SET status = 'completed', closed_at = datetime('now'),
           actual_cost = ?,
           odometer_at_close = COALESCE(?, odometer_at_close),
           updated_at = datetime('now')
       WHERE id = ?`,
      totals.total, closingOdometer, id,
    );
    const closed = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_orders WHERE id = ?', id,
    );
    emitWorkOrderEvent(c, 'work_order.close', closed, id);
    return c.json({ data: closed, totals });
  } catch (err) {
    console.error('[workOrders] POST /:id/close failed', err);
    return c.json({ error: 'Failed to close work order', code: 'DB_ERROR', detail: (err as Error)?.message }, 500);
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
      norm.part_sku ?? null,
      norm.vmrs_system_code ?? null,
      norm.vmrs_assembly_code ?? null,
      norm.vmrs_component_code ?? null,
      norm.labor_rate_code ?? null,
      norm.sort_order ?? 0,
    );
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_order_line_items WHERE id = ?', result.meta.last_row_id,
    );
    emitWorkOrderEvent(c, 'work_order.update', { line_item: created }, id);
    return c.json({ data: created }, 201);
  } catch (err) {
    console.error('[workOrders] POST /:id/line-items failed', err);
    return c.json({ error: 'Failed', code: 'DB_ERROR', detail: (err as Error)?.message }, 500);
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
    // Build SET clause only over keys actually present in the body.
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
    console.error('[workOrders] PUT /line-items/:itemId failed', err);
    return c.json({ error: 'Failed', code: 'DB_ERROR', detail: (err as Error)?.message }, 500);
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
    console.error('[workOrders] DELETE /line-items/:itemId failed', err);
    return c.json({ error: 'Failed', code: 'DB_ERROR', detail: (err as Error)?.message }, 500);
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
    console.error('[workOrders] GET /:id/comments failed', err);
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
    if (!body.body || !body.body.trim()) {
      return c.json({ error: 'body is required' }, 400);
    }
    const db = getDb(c.env);
    const exists = await queryFirst<{ id: number }>(db, 'SELECT id FROM work_orders WHERE id = ?', id);
    if (!exists) return c.json({ error: 'Work order not found' }, 404);
    const result = await execute(db,
      `INSERT INTO work_order_comments (work_order_id, user_id, body)
       VALUES (?, ?, ?)`,
      id, userId, body.body.trim(),
    );
    const created = await queryFirst<Record<string, unknown>>(
      db, 'SELECT * FROM work_order_comments WHERE id = ?', result.meta.last_row_id,
    );
    return c.json({ data: created }, 201);
  } catch (err) {
    console.error('[workOrders] POST /:id/comments failed', err);
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
  if (['vendor_id', 'assigned_to_user_id', 'odometer_at_open', 'odometer_at_close'].includes(key)) {
    return numericOrNull(v);
  }
  if (['est_cost', 'actual_cost'].includes(key)) {
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
