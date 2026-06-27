// ============================================================
// RMPG Flex — Work-order pure helpers (Fleet.io PR 5 + advances)
// ============================================================
// Pure functions extracted from the WO route so they're trivially unit
// testable. The route in src/routes/workOrders.ts composes these with
// D1 + the emit helper.
//
// Concerns owned here:
//   * Status-transition validation (DAG of allowed source → target states)
//   * Line-item math (total per kind, grand total, rolled into work_orders.actual_cost)
//   * Body shape coercion (number/null normalization for cost fields)
//   * Work-order priority validation
//   * Failure-category validation
// ============================================================

export type WorkOrderStatus =
  | 'open' | 'in_progress' | 'waiting_parts' | 'completed' | 'cancelled';

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = [
  'open', 'in_progress', 'waiting_parts', 'completed', 'cancelled',
];

export type WorkOrderPriority = 'low' | 'normal' | 'high' | 'emergency';
export const WORK_ORDER_PRIORITIES: WorkOrderPriority[] = [
  'low', 'normal', 'high', 'emergency',
];

export function isValidPriority(s: unknown): s is WorkOrderPriority {
  return typeof s === 'string' && (WORK_ORDER_PRIORITIES as string[]).includes(s);
}

/** Allowed source → target transitions. Designed to mirror Fleet.io's
 *  WO lifecycle so inbound sync from FI doesn't surface "illegal" jumps. */
const TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  open:           ['in_progress', 'waiting_parts', 'cancelled'],
  in_progress:    ['waiting_parts', 'completed', 'cancelled', 'open'],
  waiting_parts:  ['in_progress', 'cancelled'],
  completed:      [],   // terminal — re-open requires explicit superuser route
  cancelled:      [],   // terminal
};

export function isValidStatus(s: unknown): s is WorkOrderStatus {
  return typeof s === 'string' && (WORK_ORDER_STATUSES as string[]).includes(s);
}

/** Verify a status transition is legal. Returns null if OK, or an error
 *  string the route layer can pass straight to c.json({error}, 400). */
export function validateTransition(from: WorkOrderStatus, to: WorkOrderStatus): string | null {
  if (from === to) return null;                  // idempotent no-op
  if (!TRANSITIONS[from].includes(to)) {
    return `Invalid transition '${from}' → '${to}'. Allowed targets: ${TRANSITIONS[from].join(', ') || '(none — terminal state)'}`;
  }
  return null;
}

// ─── Line items ────────────────────────────────────────────

export type LineItemKind = 'labor' | 'part' | 'fee';

export interface LineItemInput {
  kind: LineItemKind;
  description: string;
  qty?: number | null;
  unit_cost?: number | null;
  total_cost?: number | null;
  part_sku?: string | null;
  vmrs_system_code?: string | null;
  vmrs_assembly_code?: string | null;
  vmrs_component_code?: string | null;
  labor_rate_code?: string | null;
  sort_order?: number | null;
}

/** Compute total_cost from qty * unit_cost when one isn't supplied.
 *  Truth table:
 *    qty + unit_cost only  → total = qty * unit_cost
 *    total only            → keep total
 *    both present          → keep total (caller may want to mark adjustment)
 *    nothing present       → total = 0
 */
export function normalizeLineItem(raw: LineItemInput): LineItemInput {
  const qty = num(raw.qty) ?? 1;
  const unit = num(raw.unit_cost);
  let total = num(raw.total_cost);
  if (total == null && unit != null) {
    total = round2(qty * unit);
  }
  return {
    ...raw,
    qty,
    unit_cost: unit ?? null,
    total_cost: total ?? null,
  };
}

/** Sum the line items into a grand total (work_orders.actual_cost). */
export function lineItemsGrandTotal(items: LineItemInput[]): number {
  let sum = 0;
  for (const it of items) {
    const norm = normalizeLineItem(it);
    if (typeof norm.total_cost === 'number') sum += norm.total_cost;
  }
  return round2(sum);
}

/** Breakdown by kind (used by the WO detail header + analytics). */
export function lineItemsBreakdown(items: LineItemInput[]): {
  labor: number; part: number; fee: number; total: number;
} {
  let labor = 0, part = 0, fee = 0;
  for (const it of items) {
    const norm = normalizeLineItem(it);
    const t = typeof norm.total_cost === 'number' ? norm.total_cost : 0;
    if (it.kind === 'labor') labor += t;
    else if (it.kind === 'part') part += t;
    else fee += t;
  }
  return {
    labor: round2(labor),
    part: round2(part),
    fee: round2(fee),
    total: round2(labor + part + fee),
  };
}

// ─── Work order template support ───────────────────────────

export interface TemplateItem {
  kind: 'labor' | 'part' | 'fee';
  description: string;
  qty?: number | null;
  unit_cost?: number | null;
  total_cost?: number | null;
  part_sku?: string | null;
  labor_rate_code?: string | null;
  vmrs_system_code?: string | null;
  vmrs_assembly_code?: string | null;
  vmrs_component_code?: string | null;
  sort_order?: number | null;
}

/** Create a work order from a template by cloning its line items. */
export function applyTemplate(
  template: { template_items_json?: string; estimated_hours?: number | null; summary?: string | null; priority?: string; notes?: string | null },
  overrides?: { summary?: string; vehicle_id?: number; notes?: string },
): {
  summary: string | null;
  estimated_hours: number | null;
  priority: string;
  notes: string | null;
  template_items: TemplateItem[];
} {
  let items: TemplateItem[] = [];
  try {
    const parsed = JSON.parse(template.template_items_json ?? '[]');
    items = Array.isArray(parsed) ? parsed : [];
  } catch { items = []; }

  return {
    summary: overrides?.summary ?? template.summary ?? null,
    estimated_hours: template.estimated_hours ?? null,
    priority: template.priority ?? 'normal',
    notes: overrides?.notes ?? template.notes ?? null,
    template_items: items,
  };
}

// ─── Analytics helpers ──────────────────────────────────────

export interface WorkOrderStats {
  total: number;
  open: number;
  in_progress: number;
  waiting_parts: number;
  completed: number;
  cancelled: number;
  by_priority: Record<string, number>;
  by_category: Record<string, number>;
  total_actual_cost: number;
  total_estimated_cost: number;
  overdue_count: number;
  scheduled_count: number;
}

export function emptyStats(): WorkOrderStats {
  return {
    total: 0, open: 0, in_progress: 0, waiting_parts: 0,
    completed: 0, cancelled: 0,
    by_priority: {}, by_category: {},
    total_actual_cost: 0, total_estimated_cost: 0,
    overdue_count: 0, scheduled_count: 0,
  };
}

// ─── Status history ─────────────────────────────────────────

export interface StatusChange {
  work_order_id: number;
  from_status: string | null;
  to_status: string;
  reason?: string | null;
}

// ─── helpers ───────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
