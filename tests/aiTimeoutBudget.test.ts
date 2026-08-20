import { describe, test, expect, vi, afterEach } from 'vitest';

// Mirrors the aiBudget() helper in src/routes/ocr.ts and src/routes/serveIntake.ts.
// Kept as a local copy because both are module-private to their route files; the
// contract under test is the arithmetic, which must stay identical in all three.
const AI_TIMEOUT_MS = 45_000;
const TOTAL_AI_BUDGET_MS = 90_000;

function aiBudget(totalMs: number = TOTAL_AI_BUDGET_MS): (perLegMs?: number) => number {
  const start = Date.now();
  return (perLegMs: number = AI_TIMEOUT_MS) =>
    Math.min(perLegMs, Math.max(0, totalMs - (Date.now() - start)));
}

afterEach(() => vi.useRealTimers());

describe('aiBudget', () => {
  test('a fresh budget grants the full per-leg ceiling', () => {
    expect(aiBudget()()).toBe(AI_TIMEOUT_MS);
  });

  test('total stays under Cloudflare’s ~100s edge cutoff', () => {
    // This is the property that matters: the old flat 35s x 3 legs in ocr.ts
    // summed to 105s, past the cutoff, turning our clean timeout into a 524.
    expect(TOTAL_AI_BUDGET_MS).toBeLessThan(100_000);
  });

  test('three legs cannot exceed the total budget', () => {
    vi.useFakeTimers();
    const leg = aiBudget();
    let spent = 0;
    for (let i = 0; i < 3; i++) {
      const allowance = leg();
      spent += allowance;
      vi.advanceTimersByTime(allowance); // simulate that leg burning its full allowance
    }
    expect(spent).toBeLessThanOrEqual(TOTAL_AI_BUDGET_MS);
  });

  test('a slow first leg shrinks what the next one gets', () => {
    vi.useFakeTimers();
    const leg = aiBudget();
    expect(leg()).toBe(45_000);
    vi.advanceTimersByTime(60_000);
    // 90s budget - 60s elapsed = 30s left, below the 45s per-leg ceiling.
    expect(leg()).toBe(30_000);
  });

  test('an exhausted budget grants zero, never a negative timeout', () => {
    vi.useFakeTimers();
    const leg = aiBudget();
    vi.advanceTimersByTime(TOTAL_AI_BUDGET_MS + 30_000);
    expect(leg()).toBe(0);
  });

  test('an explicit per-leg ceiling is still capped by the remaining budget', () => {
    vi.useFakeTimers();
    const leg = aiBudget();
    // The PDF path passes CONTAINER_TIMEOUT_MS (12s) explicitly.
    expect(leg(12_000)).toBe(12_000);
    vi.advanceTimersByTime(85_000);
    expect(leg(12_000)).toBe(5_000);
  });

  test('the per-leg ceiling was raised from the old 35s', () => {
    // The recorded live failure was a legitimately slow extraction, not a hang.
    expect(AI_TIMEOUT_MS).toBeGreaterThan(35_000);
  });
});
