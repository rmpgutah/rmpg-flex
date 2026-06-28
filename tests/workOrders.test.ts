import { describe, it, expect } from 'vitest';
import {
  WORK_ORDER_STATUSES,
  isValidStatus,
  validateTransition,
  normalizeLineItem,
  lineItemsGrandTotal,
  lineItemsBreakdown,
  type WorkOrderStatus,
} from '../src/utils/workOrders';
import { WORK_ORDER_OWNERSHIP, getOwnership } from '../src/utils/fleetio/ownership';

describe('WORK_ORDER_STATUSES', () => {
  it('exports the canonical 5-state set', () => {
    expect(WORK_ORDER_STATUSES.sort()).toEqual(
      ['cancelled', 'completed', 'in_progress', 'open', 'waiting_parts'],
    );
  });
});

describe('isValidStatus', () => {
  it('accepts the canonical values', () => {
    for (const s of WORK_ORDER_STATUSES) expect(isValidStatus(s)).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isValidStatus('done')).toBe(false);
    expect(isValidStatus('OPEN')).toBe(false);
    expect(isValidStatus(null)).toBe(false);
    expect(isValidStatus(42)).toBe(false);
    expect(isValidStatus(undefined)).toBe(false);
  });
});

describe('validateTransition', () => {
  it('allows the documented forward path', () => {
    expect(validateTransition('open', 'in_progress')).toBeNull();
    expect(validateTransition('in_progress', 'completed')).toBeNull();
    expect(validateTransition('in_progress', 'waiting_parts')).toBeNull();
    expect(validateTransition('waiting_parts', 'in_progress')).toBeNull();
    expect(validateTransition('open', 'cancelled')).toBeNull();
    expect(validateTransition('in_progress', 'open')).toBeNull();   // rollback
  });

  it('blocks transitions out of terminal states', () => {
    expect(validateTransition('completed', 'open')).toMatch(/Invalid transition/);
    expect(validateTransition('cancelled', 'open')).toMatch(/Invalid transition/);
    expect(validateTransition('completed', 'in_progress')).toMatch(/Invalid transition/);
  });

  it('blocks illegal jumps', () => {
    expect(validateTransition('open', 'completed')).toMatch(/Invalid transition/);
    expect(validateTransition('waiting_parts', 'completed')).toMatch(/Invalid transition/);
    expect(validateTransition('waiting_parts', 'open')).toMatch(/Invalid transition/);
  });

  it('treats same-state as a no-op (idempotent)', () => {
    for (const s of WORK_ORDER_STATUSES) {
      expect(validateTransition(s as WorkOrderStatus, s as WorkOrderStatus)).toBeNull();
    }
  });
});

describe('normalizeLineItem', () => {
  it('computes total from qty * unit_cost when total is absent', () => {
    expect(normalizeLineItem({ kind: 'part', description: 'oil', qty: 2, unit_cost: 12.5 }).total_cost).toBe(25);
  });

  it('preserves total when both qty/unit_cost and total are given', () => {
    expect(normalizeLineItem({ kind: 'part', description: 'oil', qty: 2, unit_cost: 12.5, total_cost: 30 }).total_cost).toBe(30);
  });

  it('defaults qty to 1 when not given', () => {
    expect(normalizeLineItem({ kind: 'fee', description: 'shop charge', unit_cost: 9.99 }).total_cost).toBe(9.99);
  });

  it('rounds to 2 decimal places', () => {
    expect(normalizeLineItem({ kind: 'labor', description: 'tax', qty: 3, unit_cost: 1.337 }).total_cost).toBe(4.01);
  });

  it('keeps total_cost null when both qty/unit_cost and total are absent', () => {
    expect(normalizeLineItem({ kind: 'fee', description: 'misc' }).total_cost).toBeNull();
  });

  it('coerces string numerics ("5" → 5)', () => {
    expect(normalizeLineItem({ kind: 'part', description: 'filter', qty: '5' as unknown as number, unit_cost: '3.50' as unknown as number }).total_cost).toBe(17.5);
  });

  it('treats empty string + non-numeric as null', () => {
    const out = normalizeLineItem({ kind: 'fee', description: 'misc', unit_cost: '' as unknown as number, total_cost: 'nope' as unknown as number });
    expect(out.unit_cost).toBeNull();
    expect(out.total_cost).toBeNull();
  });
});

describe('lineItemsGrandTotal / lineItemsBreakdown', () => {
  const items = [
    { kind: 'labor' as const, description: '1.5h shop', qty: 1.5, unit_cost: 85 },
    { kind: 'part'  as const, description: 'oil',       qty: 5,   unit_cost: 4.99 },
    { kind: 'part'  as const, description: 'filter',    qty: 1,   unit_cost: 12.99 },
    { kind: 'fee'   as const, description: 'shop fee',  total_cost: 9.5 },
  ];

  it('sums totals across all kinds', () => {
    // 127.5 + 24.95 + 12.99 + 9.5 = 174.94
    expect(lineItemsGrandTotal(items)).toBe(174.94);
  });

  it('breakdown returns per-kind subtotals + total', () => {
    const br = lineItemsBreakdown(items);
    expect(br.labor).toBe(127.5);
    expect(br.part).toBe(37.94);
    expect(br.fee).toBe(9.5);
    expect(br.total).toBe(174.94);
  });

  it('empty list returns 0 across the board', () => {
    expect(lineItemsGrandTotal([])).toBe(0);
    expect(lineItemsBreakdown([])).toEqual({ labor: 0, part: 0, fee: 0, total: 0 });
  });

  it('items without computable totals contribute 0', () => {
    expect(lineItemsGrandTotal([
      { kind: 'fee', description: 'TBD' },
      { kind: 'part', description: 'unknown', qty: 1 },
    ])).toBe(0);
  });
});

describe('WORK_ORDER_OWNERSHIP integration', () => {
  it('routes through getOwnership for the work_order resource', () => {
    expect(getOwnership('work_order', 'vehicle_id')).toBe('rmpg');
    expect(getOwnership('work_order', 'status')).toBe('shared');
    expect(getOwnership('work_order', 'actual_cost')).toBe('shared');
  });

  it('returns null for an unknown work_order field', () => {
    expect(getOwnership('work_order', 'mystery_col')).toBeNull();
  });

  it('every value in WORK_ORDER_OWNERSHIP is a valid class', () => {
    for (const v of Object.values(WORK_ORDER_OWNERSHIP)) {
      expect(['rmpg', 'fleetio', 'shared']).toContain(v);
    }
  });
});
