import { describe, it, expect } from 'vitest';
import { applyPricingEdit, chargeTotal, formatUsd, type PricingRow } from '../psBillingHelpers';

const rows: PricingRow[] = [
  { id: 1, code: 'flat_serve', label: 'Standard', unit: 'per_serve', amount: 65, taxable: 1, attempts_included: 0, is_active: 1, sort_order: 10 },
  { id: 2, code: 'rush', label: 'Rush', unit: 'flat', amount: 40, taxable: 1, attempts_included: 0, is_active: 1, sort_order: 20 },
];

describe('applyPricingEdit', () => {
  it('updates only the targeted row field immutably', () => {
    const next = applyPricingEdit(rows, 1, 'amount', 80);
    expect(next[0].amount).toBe(80);
    expect(next[1]).toBe(rows[1]);
    expect(rows[0].amount).toBe(65);
  });
});

describe('chargeTotal', () => {
  it('sums line totals to cents', () => {
    expect(chargeTotal([{ line_total: 65 }, { line_total: 7.005 }])).toBe(72.01);
  });
});

describe('formatUsd', () => {
  it('formats with two decimals and a $ sign', () => {
    expect(formatUsd(65)).toBe('$65.00');
    expect(formatUsd(null)).toBe('$0.00');
  });
});
