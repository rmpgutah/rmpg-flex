import { describe, it, expect } from 'vitest';
import { computePriorityScore, normalizeOffenseLevel } from '../src/routes/warrants';

// Mirrors priorityBucket() in client/src/utils/warrantListHelpers.ts:
//   >=90 critical | >=60 high | >=40 medium | else low
// `high` is 60 so a felony with no modifiers (base 60) reads as high, which is
// this scorer's stated intent. Keep the two in sync — the boundaries are coupled
// to the base values below.
const bucket = (n: number) => n >= 90 ? 'critical' : n >= 60 ? 'high' : n >= 40 ? 'medium' : 'low';

// Measured live 2026-07-31 over 100 unified rows: offense_level NULL on 100/100,
// severity actually in `type` as 'M' x93 / 'F' x7, every score 20 or 30, every
// row bucketed LOW. These tests encode that real data shape.
describe('normalizeOffenseLevel', () => {
  it('reads the single-letter codes live data actually uses', () => {
    expect(normalizeOffenseLevel('F')).toBe('FELONY');
    expect(normalizeOffenseLevel('M')).toBe('MISDEMEANOR');
    expect(normalizeOffenseLevel('I')).toBe('INFRACTION');
    expect(normalizeOffenseLevel('C')).toBe('CIVIL');
  });

  it('still reads spelled-out forms, case- and whitespace-insensitively', () => {
    expect(normalizeOffenseLevel('felony')).toBe('FELONY');
    expect(normalizeOffenseLevel('  Misdemeanor ')).toBe('MISDEMEANOR');
    expect(normalizeOffenseLevel('INFRACTION')).toBe('INFRACTION');
  });

  it('does NOT infer severity from an unrelated token starting with the same letter', () => {
    // A warrant type like 'FTA' (failure to appear) must not read as a felony
    // just because it starts with F — that would silently escalate every FTA.
    expect(normalizeOffenseLevel('FTA')).toBeNull();
    expect(normalizeOffenseLevel('MUNICIPAL')).toBeNull();
    expect(normalizeOffenseLevel('arrest')).toBeNull();
  });

  it('returns null for absent/unknown rather than guessing', () => {
    expect(normalizeOffenseLevel(null)).toBeNull();
    expect(normalizeOffenseLevel(undefined)).toBeNull();
    expect(normalizeOffenseLevel('')).toBeNull();
    expect(normalizeOffenseLevel('   ')).toBeNull();
    expect(normalizeOffenseLevel('X')).toBeNull();
  });
});

describe('computePriorityScore — severity drives the band', () => {
  it('scores a felony from the `type` code when offense_level is NULL (the live shape)', () => {
    // THE regression. Before the fix this returned 20 -> LOW for every felony.
    const score = computePriorityScore({ offense_level: null, type: 'F' });
    expect(score).toBeGreaterThanOrEqual(60);
    expect(bucket(score)).not.toBe('low');
  });

  it('no longer buckets every live row LOW', () => {
    const felony = computePriorityScore({ offense_level: null, type: 'F', bail_amount: 50000 });
    const misd = computePriorityScore({ offense_level: null, type: 'M', bail_amount: 500 });
    expect(bucket(felony)).toBe('high');   // 60 + 10 bail = 70
    expect(bucket(misd)).toBe('low');      // 30 — correctly still low
    expect(felony).toBeGreaterThan(misd);
  });

  it('prefers offense_level over type when both are present', () => {
    const s = computePriorityScore({ offense_level: 'FELONY', type: 'M' });
    expect(s).toBeGreaterThanOrEqual(60);
  });

  it('falls back to a NEUTRAL score when severity is genuinely unknown', () => {
    // Must not outrank a known felony — an unknown charge escalating above a
    // confirmed felony would be actively misleading on a service queue.
    const unknown = computePriorityScore({ offense_level: null, type: 'other' });
    const felony = computePriorityScore({ offense_level: null, type: 'F' });
    expect(unknown).toBeLessThan(felony);
    expect(unknown).toBe(20);
  });
});

describe('computePriorityScore — age now counts', () => {
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

  it('escalates a long-outstanding warrant that previously scored identically', () => {
    // Live warrants span 305 to 10,169 days outstanding; age contributed 0.
    const fresh = computePriorityScore({ type: 'M', issued_date: daysAgo(10) });
    const oneYear = computePriorityScore({ type: 'M', issued_date: daysAgo(400) });
    const decade = computePriorityScore({ type: 'M', issued_date: daysAgo(4000) });
    expect(oneYear).toBeGreaterThan(fresh);
    expect(decade).toBeGreaterThan(oneYear);
  });

  it('age can lift a stale misdemeanor to medium but never past a fresh felony', () => {
    const staleMisd = computePriorityScore({ type: 'M', issued_date: daysAgo(4000) });
    const freshFelony = computePriorityScore({ type: 'F', issued_date: daysAgo(1) });
    expect(bucket(staleMisd)).toBe('medium');      // 30 + 15 = 45
    expect(staleMisd).toBeLessThan(freshFelony);   // severity still dominates
  });

  it('uses issued_date, falling back to created_at — the same source as the AGE column', () => {
    const viaIssued = computePriorityScore({ type: 'M', issued_date: daysAgo(4000) });
    const viaCreated = computePriorityScore({ type: 'M', created_at: daysAgo(4000) });
    expect(viaIssued).toBe(viaCreated);
    // issued_date wins when both exist, so a fresh insert of an old warrant is
    // scored on the warrant's age, not on when we happened to import it.
    const both = computePriorityScore({ type: 'M', issued_date: daysAgo(4000), created_at: daysAgo(1) });
    expect(both).toBe(viaIssued);
  });

  it('contributes nothing when there is no date at all', () => {
    expect(computePriorityScore({ type: 'M' })).toBe(30);
  });

  it('is CONTINUOUS — two old warrants of different ages do not tie', () => {
    // THE regression this replaced. A banded age term (5/10/15 at 6mo/1y/3y) gave
    // every 3y+ warrant the same 15, and measured live that put **64 of 100 rows
    // on the identical score of 45**. No bucket threshold can separate a cluster
    // sitting on one value, so the banding itself destroyed the ordering.
    const fourYears = computePriorityScore({ type: 'M', issued_date: daysAgo(1460) });
    const twentyYears = computePriorityScore({ type: 'M', issued_date: daysAgo(7300) });
    expect(twentyYears).toBeGreaterThan(fourYears);

    // And the ramp is monotonic across the whole range, not just at the ends —
    // this is what gives the service queue a usable sort.
    const ladder = [200, 500, 1000, 2000, 3000, 4000].map(
      (d) => computePriorityScore({ type: 'M', issued_date: daysAgo(d) }),
    );
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]).toBeGreaterThanOrEqual(ladder[i - 1]);
    }
    // Strictly increasing somewhere in the middle, i.e. genuinely not banded.
    expect(new Set(ladder).size).toBeGreaterThan(3);
  });

  it('caps staleness so age can never overtake severity', () => {
    // A maximally stale misdemeanor must still rank below a brand-new felony.
    const ancientMisd = computePriorityScore({ type: 'M', issued_date: daysAgo(50_000) });
    const freshFelony = computePriorityScore({ type: 'F', issued_date: daysAgo(0) });
    expect(ancientMisd).toBe(45); // 30 + the 15 ceiling, not more
    expect(ancientMisd).toBeLessThan(freshFelony);
  });

  it('returns an integer — the score is rendered and compared to integer buckets', () => {
    for (const d of [1, 137, 999, 3651]) {
      const s = computePriorityScore({ type: 'M', issued_date: daysAgo(d) });
      expect(Number.isInteger(s)).toBe(true);
    }
  });
});

describe('computePriorityScore — remaining terms', () => {
  it('escalates on repeated failed service attempts, capped', () => {
    const none = computePriorityScore({ type: 'M', service_attempt_count: 0 });
    const some = computePriorityScore({ type: 'M', service_attempt_count: 2 });
    const many = computePriorityScore({ type: 'M', service_attempt_count: 99 });
    expect(some).toBe(none + 10);
    expect(many).toBe(none + 20); // capped so attempts alone can't dominate
  });

  it('adds urgency only for an expiry inside 7 days, not one already lapsed', () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const far = new Date(Date.now() + 90 * 86_400_000).toISOString();
    expect(computePriorityScore({ type: 'M', expires_at: soon })).toBe(45);
    expect(computePriorityScore({ type: 'M', expires_at: past })).toBe(30);
    expect(computePriorityScore({ type: 'M', expires_at: far })).toBe(30);
  });

  it('keeps high bail as the SMALLEST term — it was accidentally the only live signal', () => {
    const bailBump = computePriorityScore({ type: 'M', bail_amount: 50_000 })
      - computePriorityScore({ type: 'M', bail_amount: 500 });
    expect(bailBump).toBe(10);
    // Bail alone must not outrank severity: bail correlates with means as much
    // as with risk, so a high-bail misdemeanor stays below a plain felony.
    expect(computePriorityScore({ type: 'M', bail_amount: 1_000_000 }))
      .toBeLessThan(computePriorityScore({ type: 'F' }));
  });

  it('is clamped to 100 when every term stacks', () => {
    const maxed = computePriorityScore({
      offense_level: 'FELONY',
      service_attempt_count: 10,
      issued_date: new Date(Date.now() - 5000 * 86_400_000).toISOString(),
      expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      bail_amount: 100_000,
    });
    expect(maxed).toBe(100);
    expect(bucket(maxed)).toBe('critical');
  });

  it('a maxed-out record actually reaches critical (the top bucket is reachable)', () => {
    // Guard against weights that make 'critical' unattainable in practice.
    const s = computePriorityScore({
      type: 'F', service_attempt_count: 4,
      issued_date: new Date(Date.now() - 1200 * 86_400_000).toISOString(),
      bail_amount: 25_000,
    });
    expect(s).toBeGreaterThanOrEqual(90); // 60+20+15+10 = 105 -> clamped 100
  });
});
