export interface PricingRow {
  id: number;
  code: string;
  label: string;
  unit: string;
  amount: number;
  taxable: number;
  attempts_included: number;
  is_active: number;
  sort_order: number;
}

export function applyPricingEdit<K extends keyof PricingRow>(
  rows: PricingRow[], id: number, field: K, value: PricingRow[K],
): PricingRow[] {
  return rows.map((r) => (r.id === id ? { ...r, [field]: value } : r));
}

export function chargeTotal(lines: Array<{ line_total: number }>): number {
  return Math.round(lines.reduce((s, l) => s + (l.line_total || 0), 0) * 100) / 100;
}

export function formatUsd(n: number | null | undefined): string {
  const v = typeof n === 'number' && isFinite(n) ? n : 0;
  return `$${v.toFixed(2)}`;
}
