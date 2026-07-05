import { describe, it, expect, beforeEach } from 'vitest';
import { readThemeOverride, writeThemeOverride, resolveCurrentTheme, THEME_OVERRIDE_KEY, LEGACY_FLAG_KEY, BLUE_SILVER_FLAG_KEY } from '../theme';

describe('theme override storage', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('returns null when absent', () => {
    expect(readThemeOverride()).toBeNull();
  });
  it('round-trips a valid override', () => {
    writeThemeOverride({ theme: 'light', active: true });
    expect(readThemeOverride()).toEqual({ theme: 'light', active: true });
  });
  it('rejects garbage JSON / invalid theme', () => {
    localStorage.setItem(THEME_OVERRIDE_KEY, 'not json');
    expect(readThemeOverride()).toBeNull();
    localStorage.setItem(THEME_OVERRIDE_KEY, JSON.stringify({ theme: 'purple', active: true }));
    expect(readThemeOverride()).toBeNull();
  });
  it('removes the key when writing null', () => {
    writeThemeOverride({ theme: 'dark', active: true });
    writeThemeOverride(null);
    expect(readThemeOverride()).toBeNull();
  });
  it('round-trips an inactive override', () => {
    writeThemeOverride({ theme: 'dark', active: false });
    expect(readThemeOverride()).toEqual({ theme: 'dark', active: false });
  });
});

describe('resolveCurrentTheme', () => {
  // Blue & Silver defaults ON as of the 2026-07-04 re-theme and would
  // otherwise force 'dark' regardless of the override/schedule under test
  // here — opt out so these tests exercise that logic in isolation.
  beforeEach(() => {
    try { localStorage.clear(); localStorage.setItem(BLUE_SILVER_FLAG_KEY, '0'); } catch { /* ignore */ }
  });

  it('returns dark when legacy flag is set (ignores everything else)', () => {
    localStorage.setItem(LEGACY_FLAG_KEY, '1');
    writeThemeOverride({ theme: 'light', active: true });
    expect(resolveCurrentTheme()).toBe('dark');
  });
  it('honors an active override over the schedule', () => {
    writeThemeOverride({ theme: 'light', active: true });
    expect(resolveCurrentTheme()).toBe('light');
    writeThemeOverride({ theme: 'dark', active: true });
    expect(resolveCurrentTheme()).toBe('dark');
  });
});
