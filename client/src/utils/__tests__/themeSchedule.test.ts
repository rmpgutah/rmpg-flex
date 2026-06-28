import { describe, it, expect } from 'vitest';
import { resolveScheduledTheme, resolveEffectiveTheme, DEFAULT_SCHEDULE } from '../themeSchedule';

describe('resolveScheduledTheme', () => {
  it('is night at/after nightStart (18:00) and before midnight', () => {
    expect(resolveScheduledTheme(18, DEFAULT_SCHEDULE)).toBe('dark');
    expect(resolveScheduledTheme(23, DEFAULT_SCHEDULE)).toBe('dark');
  });
  it('is night after midnight and before dayStart (06:00)', () => {
    expect(resolveScheduledTheme(0, DEFAULT_SCHEDULE)).toBe('dark');
    expect(resolveScheduledTheme(5, DEFAULT_SCHEDULE)).toBe('dark');
  });
  it('is day from dayStart (06:00) until nightStart (18:00)', () => {
    expect(resolveScheduledTheme(6, DEFAULT_SCHEDULE)).toBe('light');
    expect(resolveScheduledTheme(12, DEFAULT_SCHEDULE)).toBe('light');
    expect(resolveScheduledTheme(17, DEFAULT_SCHEDULE)).toBe('light');
  });
  it('treats the boundary hours inclusively for night start, exclusively for day', () => {
    expect(resolveScheduledTheme(18, DEFAULT_SCHEDULE)).toBe('dark');
    expect(resolveScheduledTheme(6, DEFAULT_SCHEDULE)).toBe('light');
  });
});

describe('resolveEffectiveTheme', () => {
  const schedule = DEFAULT_SCHEDULE;
  it('uses the schedule when there is no override', () => {
    expect(resolveEffectiveTheme(12, schedule, null)).toBe('light');
    expect(resolveEffectiveTheme(22, schedule, null)).toBe('dark');
  });
  it('honors a manual override that has not yet hit its boundary', () => {
    expect(resolveEffectiveTheme(12, schedule, { theme: 'dark', active: true })).toBe('dark');
    expect(resolveEffectiveTheme(22, schedule, { theme: 'light', active: true })).toBe('light');
  });
  it('ignores an expired/inactive override and falls back to schedule', () => {
    expect(resolveEffectiveTheme(12, schedule, { theme: 'dark', active: false })).toBe('light');
  });
});
