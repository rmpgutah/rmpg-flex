// ============================================================
// RMPG Flex — Work-order pure helpers (Fleet.io PR 5)
// ============================================================
// Pure functions extracted from the WO route so they're trivially unit
// testable. The route in src/routes/workOrders.ts composes these with
// D1 + the emit helper.
//
// Concerns owned here:
//   * Status-transition validation (DAG of allowed source → target states)
//   * Line-item math (total per kind, grand total, rolled into work_orders.actual_cost)
//   * Body shape coercion (number/null normalization for cost fields)
// ============================================================

export type WorkOrderStatus =
  | 'open' | 'in_progress' | 'waiting_parts' | 'completed' | 'cancelled';

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = [
  'open', 'in_progress', 'waiting_parts', 'completed', 'cancelled',
];

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

// ─── helpers ───────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
