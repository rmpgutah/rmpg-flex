import { describe, it, expect } from 'vitest';
import { nextPhase, formatMmSs, progressPct, appendSession } from '../focusTimerLogic';

describe('focusTimerLogic', () => {
  it('cycles focus → short break, then long break every 4th focus', () => {
    expect(nextPhase('focus', 0)).toEqual({ phase: 'short-break', cycles: 1 });
    expect(nextPhase('focus', 3)).toEqual({ phase: 'long-break', cycles: 4 });
    expect(nextPhase('short-break', 2)).toEqual({ phase: 'focus', cycles: 2 });
  });

  it('formats remaining time and progress', () => {
    expect(formatMmSs(125)).toBe('02:05');
    expect(progressPct(0, 25)).toBe(1);
    expect(appendSession([], { endedAt: 't', phase: 'focus', minutes: 25 }, 1)).toHaveLength(1);
  });
});
