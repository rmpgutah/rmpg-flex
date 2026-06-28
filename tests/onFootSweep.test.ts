import { describe, it, expect } from 'vitest';
import { findOverdueOnFoot, ON_FOOT_OVERDUE_MS } from '../src/utils/onFootSweep';

// on_foot_since is written by D1 datetime('now') → UTC 'YYYY-MM-DD HH:MM:SS'.
const utc = (msAgo: number) =>
  new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');

const row = (msAgo: number, alerted = 0) => ({
  id: 1, call_sign: 'D19', officer_name: 'Smith',
  on_foot_since: utc(msAgo), on_foot_alerted: alerted,
  latitude: 40.7, longitude: -111.9,
});

describe('findOverdueOnFoot', () => {
  it('flags units on foot past the threshold', () => {
    expect(findOverdueOnFoot([row(6 * 60_000)], Date.now())).toHaveLength(1);
  });
  it('skips units under the threshold', () => {
    expect(findOverdueOnFoot([row(3 * 60_000)], Date.now())).toHaveLength(0);
  });
  it('skips already-alerted units', () => {
    expect(findOverdueOnFoot([row(10 * 60_000, 1)], Date.now())).toHaveLength(0);
  });
  it('skips rows with missing/garbage timestamps', () => {
    expect(findOverdueOnFoot([{ ...row(0), on_foot_since: null } as any], Date.now())).toHaveLength(0);
    expect(findOverdueOnFoot([{ ...row(0), on_foot_since: 'bogus' } as any], Date.now())).toHaveLength(0);
  });
  it('threshold is 5 minutes', () => {
    expect(ON_FOOT_OVERDUE_MS).toBe(5 * 60_000);
  });
});
