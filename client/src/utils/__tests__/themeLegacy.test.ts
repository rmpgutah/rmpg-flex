import { describe, it, expect, beforeEach } from 'vitest';
import { isLegacyBlackForced, LEGACY_FLAG_KEY, getThemeChromeColor, normalizeThemePreference } from '../theme';

describe('legacy escape hatch', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('is off by default', () => {
    expect(isLegacyBlackForced()).toBe(false);
  });
  it('is on when the flag is set to "1"', () => {
    localStorage.setItem(LEGACY_FLAG_KEY, '1');
    expect(isLegacyBlackForced()).toBe(true);
  });
});

describe('chrome colors per theme', () => {
  it('night (dark) chrome is the steel-blue-charcoal base, day is the light chrome', () => {
    expect(getThemeChromeColor('dark')).toBe('#0d1722');
    expect(getThemeChromeColor('light')).toBe('#d6d3c8');
  });
});

describe('normalizeThemePreference', () => {
  it('maps unknown/legacy values to dark (night default)', () => {
    expect(normalizeThemePreference(undefined)).toBe('dark');
    expect(normalizeThemePreference('night')).toBe('dark'); // alias
    expect(normalizeThemePreference('day')).toBe('light');  // alias
    expect(normalizeThemePreference('light')).toBe('light');
  });
});
