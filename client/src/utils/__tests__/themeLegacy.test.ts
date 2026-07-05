import { describe, it, expect, beforeEach } from 'vitest';
import { isLegacyBlackForced, LEGACY_FLAG_KEY, getThemeChromeColor, normalizeThemePreference, applyThemePreference, BLUE_SILVER_FLAG_KEY } from '../theme';

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
    expect(getThemeChromeColor('dark')).toBe('var(--surface-base)');
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

describe('legacy kill-switch overrides day theme', () => {
  // Blue & Silver defaults ON as of the 2026-07-04 re-theme and would
  // otherwise force 'dark' regardless of legacy/light state — opt out so
  // these tests exercise the legacy kill-switch in isolation.
  beforeEach(() => {
    try { localStorage.clear(); localStorage.setItem(BLUE_SILVER_FLAG_KEY, '0'); } catch { /* ignore */ }
  });

  it('forces dark color-scheme + black chrome even when theme is light', () => {
    localStorage.setItem(LEGACY_FLAG_KEY, '1');
    applyThemePreference('light', { persist: false, syncNative: false });
    const html = document.documentElement;
    expect(html.classList.contains('theme-legacy-black')).toBe(true);
    expect(html.style.colorScheme).toBe('dark');
    expect(html.style.backgroundColor.replace(/\s/g, '')).toBe('rgb(0,0,0)');
  });

  it('applies the light color-scheme for day when legacy is off', () => {
    applyThemePreference('light', { persist: false, syncNative: false });
    const html = document.documentElement;
    expect(html.classList.contains('theme-legacy-black')).toBe(false);
    expect(html.style.colorScheme).toBe('light');
  });
});
