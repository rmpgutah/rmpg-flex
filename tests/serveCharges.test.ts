// tests/serveCharges.test.ts
import { describe, it, expect } from 'vitest';
import { computeServeCharges, type PricingItem, type ContractTerms, type ServeJobFacts } from '../src/utils/serveCharges';

const PRICING: PricingItem[] = [
  { code: 'flat_serve',    label: 'Standard Service',   unit: 'per_serve',   amount: 65, taxable: true,  attempts_included: 0 },
  { code: 'rush',          label: 'Rush / Same-Day',    unit: 'flat',        amount: 40, taxable: true,  attempts_included: 0 },
  { code: 'extra_attempt', label: 'Additional Attempt', unit: 'per_attempt', amount: 15, taxable: true,  attempts_included: 3 },
  { code: 'skip_trace',    label: 'Skip Trace',         unit: 'flat',        amount: 25, taxable: true,  attempts_included: 0 },
  { code: 'mileage',       label: 'Mileage',            unit: 'per_mile',    amount: 0.7, taxable: false, attempts_included: 0 },
  { code: 'wait',          label: 'Wait Time',          unit: 'per_hour',    amount: 30, taxable: true,  attempts_included: 0 },
];

const TERMS = (overrides: Record<string, number> = {}): ContractTerms => ({
  contract_id: 1, billing_trigger: 'on_completion', rate_overrides: overrides,
});

const JOB = (p: Partial<ServeJobFacts> = {}): ServeJobFacts => ({
  serve_queue_id: 100, priority: 'normal', attempt_count: 1,
  has_skip_trace: false, mileage: null, wait_hours: null, ...p,
});

describe('computeServeCharges', () => {
  it('bills the flat base on a single normal attempt (served)', () => {
    const r = computeServeCharges(JOB(), TERMS(), PRICING);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ pricing_code: 'flat_serve', quantity: 1, unit_price: 65, line_total: 65 });
    expect(r.subtotal).toBe(65);
  });

  it('still bills the base on non-est (failed) jobs', () => {
    const r = computeServeCharges(JOB({ attempt_count: 3 }), TERMS(), PRICING);
    expect(r.subtotal).toBe(65);
  });

  it('adds rush surcharge when priority is rush or urgent', () => {
    expect(computeServeCharges(JOB({ priority: 'rush' }), TERMS(), PRICING).subtotal).toBe(105);
    expect(computeServeCharges(JOB({ priority: 'urgent' }), TERMS(), PRICING).subtotal).toBe(105);
  });

  it('charges extra attempts beyond attempts_included', () => {
    const r = computeServeCharges(JOB({ attempt_count: 5 }), TERMS(), PRICING);
    const extra = r.lines.find(l => l.pricing_code === 'extra_attempt');
    expect(extra).toMatchObject({ quantity: 2, unit_price: 15, line_total: 30 });
    expect(r.subtotal).toBe(95);
  });

  it('honors a contract-specific extra_attempt_included override instead of the global pricing default', () => {
    // Global default (PRICING) includes 3 free attempts; this contract
    // negotiated 1 free attempt, so attempt 5 should bill 4 extra, not 2.
    const r = computeServeCharges(
      JOB({ attempt_count: 5 }),
      TERMS({ extra_attempt_included: 1 }),
      PRICING,
    );
    const extra = r.lines.find(l => l.pricing_code === 'extra_attempt');
    expect(extra).toMatchObject({ quantity: 4, unit_price: 15, line_total: 60 });
  });

  it('adds skip trace, mileage, and wait when present', () => {
    const r = computeServeCharges(JOB({ has_skip_trace: true, mileage: 10, wait_hours: 2 }), TERMS(), PRICING);
    expect(r.lines.find(l => l.pricing_code === 'skip_trace')?.line_total).toBe(25);
    expect(r.lines.find(l => l.pricing_code === 'mileage')).toMatchObject({ quantity: 10, line_total: 7 });
    expect(r.lines.find(l => l.pricing_code === 'wait')).toMatchObject({ quantity: 2, line_total: 60 });
    expect(r.subtotal).toBe(65 + 25 + 7 + 60);
  });

  it('honors per-contract rate overrides over the rate card', () => {
    const r = computeServeCharges(JOB(), TERMS({ flat_serve: 80 }), PRICING);
    expect(r.lines[0].line_total).toBe(80);
    expect(r.subtotal).toBe(80);
  });

  it('always emits the base line even when unpriced (amount 0)', () => {
    const zero = PRICING.map(p => p.code === 'flat_serve' ? { ...p, amount: 0 } : p);
    const r = computeServeCharges(JOB(), TERMS(), zero);
    expect(r.lines[0]).toMatchObject({ pricing_code: 'flat_serve', unit_price: 0, line_total: 0 });
    expect(r.subtotal).toBe(0);
  });

  it('omits optional add-ons when their rate is 0', () => {
    const zeroRush = PRICING.map(p => p.code === 'rush' ? { ...p, amount: 0 } : p);
    const r = computeServeCharges(JOB({ priority: 'rush' }), TERMS(), zeroRush);
    expect(r.lines.find(l => l.pricing_code === 'rush')).toBeUndefined();
  });
});
