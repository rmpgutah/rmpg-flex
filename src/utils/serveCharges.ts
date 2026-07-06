// src/utils/serveCharges.ts
// Pure process-service charge engine. No DB access — fully unit-testable.

export interface PricingItem {
  code: string;
  label: string;
  unit: 'per_serve' | 'per_attempt' | 'per_mile' | 'per_hour' | 'flat';
  amount: number;
  taxable: boolean;
  attempts_included: number;
}

export interface ContractTerms {
  contract_id: number | null;
  billing_trigger: string;
  rate_overrides: Record<string, number>;
}

export interface ServeJobFacts {
  serve_queue_id: number;
  priority: string | null;
  attempt_count: number;
  has_skip_trace: boolean;
  mileage: number | null;
  wait_hours: number | null;
}

export interface ChargeLine {
  pricing_code: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  taxable: boolean;
}

export interface ComputedCharges {
  lines: ChargeLine[];
  subtotal: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function computeServeCharges(
  job: ServeJobFacts,
  terms: ContractTerms,
  pricing: PricingItem[],
): ComputedCharges {
  const byCode = new Map(pricing.map((p) => [p.code, p]));
  const priceOf = (code: string): number =>
    terms.rate_overrides?.[code] ?? byCode.get(code)?.amount ?? 0;
  const taxableOf = (code: string): boolean => byCode.get(code)?.taxable ?? true;
  const labelOf = (code: string): string => byCode.get(code)?.label ?? code;

  const lines: ChargeLine[] = [];
  const push = (code: string, quantity: number, unitPrice: number) => {
    lines.push({
      pricing_code: code,
      description: labelOf(code),
      quantity,
      unit_price: cents(unitPrice),
      line_total: cents(quantity * unitPrice),
      taxable: taxableOf(code),
    });
  };

  // Base — always present (even at $0) so the reviewer sees the job.
  push('flat_serve', 1, priceOf('flat_serve'));

  // Rush surcharge.
  if ((job.priority === 'rush' || job.priority === 'urgent') && priceOf('rush') > 0) {
    push('rush', 1, priceOf('rush'));
  }

  // Extra attempts beyond the included count. `attempts_included` on the
  // pricing item is a GLOBAL default (same for every contract); a contract
  // that negotiated a different free-attempt count had no way to express
  // that, so every client was billed against the same threshold regardless
  // of their contract terms. `rate_overrides.extra_attempt_included` lets a
  // specific contract override it via the same JSON blob already used for
  // per-contract rate overrides (ps_contract_terms.rate_overrides_json).
  const included = terms.rate_overrides?.extra_attempt_included
    ?? byCode.get('extra_attempt')?.attempts_included
    ?? 0;
  const extra = Math.max(0, (job.attempt_count ?? 0) - included);
  if (extra > 0 && priceOf('extra_attempt') > 0) {
    push('extra_attempt', extra, priceOf('extra_attempt'));
  }

  // Add-ons.
  if (job.has_skip_trace && priceOf('skip_trace') > 0) push('skip_trace', 1, priceOf('skip_trace'));
  if (job.mileage && job.mileage > 0 && priceOf('mileage') > 0) push('mileage', cents(job.mileage), priceOf('mileage'));
  if (job.wait_hours && job.wait_hours > 0 && priceOf('wait') > 0) push('wait', cents(job.wait_hours), priceOf('wait'));

  const subtotal = cents(lines.reduce((s, l) => s + l.line_total, 0));
  return { lines, subtotal };
}
