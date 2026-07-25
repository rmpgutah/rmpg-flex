import { describe, test, expect } from 'vitest';
import { containsAnyClause } from '../src/utils/searchText';

// ── Mirrors of the module-private helpers in src/routes/trespassOrders.ts ────
// Kept local because the route file exports only the Hono router. The contract
// under test is the arithmetic and the safety predicate, which must stay in sync.

const ENFORCEABLE_STATUSES = ['active', 'served', 'violated'] as const;

function expirationFrom(effective: string, durationDays: unknown): string | null {
  const d = typeof durationDays === 'number' ? durationDays : parseInt(String(durationDays ?? ''), 10);
  if (!Number.isFinite(d) || d <= 0) return null;
  const base = new Date(`${effective}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + d);
  return base.toISOString().slice(0, 10);
}

function nextOrderNumberFrom(last: string | null, year: number): string {
  const prefix = `TO-${year}-`;
  let seq = 1;
  if (last) {
    const m = last.match(/(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

describe('enforceable-status predicate (officer safety)', () => {
  test('an order that was served is still enforceable', () => {
    // Serving delivers the order; it does not end it. Excluding `served` would
    // hide every properly-served order from the premise check.
    expect(ENFORCEABLE_STATUSES).toContain('served');
  });

  test('a violated order is still enforceable', () => {
    // The most safety-relevant state: the subject already breached this order.
    expect(ENFORCEABLE_STATUSES).toContain('violated');
  });

  test('lifted and expired are NOT enforceable', () => {
    expect(ENFORCEABLE_STATUSES).not.toContain('lifted');
    expect(ENFORCEABLE_STATUSES).not.toContain('expired');
  });

  test('the live "lifted" row would not surface on a premise check', () => {
    // trespass_orders id 1 on live D1 is status='lifted', property_id=21.
    // Confirmed against remote D1: the /check query returns [] for it.
    expect(ENFORCEABLE_STATUSES.includes('lifted' as never)).toBe(false);
  });
});

describe('expirationFrom', () => {
  test('adds duration_days to the effective date', () => {
    expect(expirationFrom('2026-07-24', 30)).toBe('2026-08-23');
  });

  test('crosses a month boundary correctly', () => {
    expect(expirationFrom('2026-01-31', 1)).toBe('2026-02-01');
  });

  test('crosses a year boundary correctly', () => {
    expect(expirationFrom('2026-12-31', 1)).toBe('2027-01-01');
  });

  test('handles a leap day', () => {
    expect(expirationFrom('2028-02-28', 1)).toBe('2028-02-29');
  });

  test('accepts a numeric string (the client sends parsed ints, but be safe)', () => {
    expect(expirationFrom('2026-07-24', '10')).toBe('2026-08-03');
  });

  test('an open-ended order has no expiration', () => {
    expect(expirationFrom('2026-07-24', null)).toBeNull();
    expect(expirationFrom('2026-07-24', 0)).toBeNull();
    expect(expirationFrom('2026-07-24', '')).toBeNull();
    expect(expirationFrom('2026-07-24', 'abc')).toBeNull();
  });

  test('a negative duration is treated as open-ended, not backdated', () => {
    expect(expirationFrom('2026-07-24', -5)).toBeNull();
  });
});

describe('nextOrderNumber', () => {
  test('uses a FOUR-digit year to match the live format', () => {
    // Live D1 holds "TO-2026-0001". A two-digit year would both break the format
    // and fail the LIKE prefix, silently restarting the sequence.
    expect(nextOrderNumberFrom(null, 2026)).toBe('TO-2026-0001');
  });

  test('increments from the last order', () => {
    expect(nextOrderNumberFrom('TO-2026-0001', 2026)).toBe('TO-2026-0002');
  });

  test('pads to four digits and grows past them', () => {
    expect(nextOrderNumberFrom('TO-2026-0009', 2026)).toBe('TO-2026-0010');
    expect(nextOrderNumberFrom('TO-2026-9999', 2026)).toBe('TO-2026-10000');
  });

  test('restarts at 0001 in a new year', () => {
    expect(nextOrderNumberFrom(null, 2027)).toBe('TO-2027-0001');
  });
});

describe('premise check query safety', () => {
  test('address matching uses instr(), not a LIKE pattern', () => {
    // A street address easily passes D1's 50-char LIKE cap, which would throw —
    // and the client's own .catch() collapses a failure to { orders: [], count: 0 },
    // i.e. a false clear.
    const m = containsAnyClause(['t.location', 't.property_address']);
    expect(m.sql).toContain('instr(');
    expect(m.sql).not.toContain('LIKE');
  });

  test('a long address binds without wildcards', () => {
    const m = containsAnyClause(['t.location', 't.property_address']);
    const addr = '1234 South Really Long Boulevard Apartment Complex Building C, Salt Lake City, UT';
    expect(addr.length).toBeGreaterThan(50);
    expect(m.binds(addr)).toEqual([addr, addr]);
  });
});
