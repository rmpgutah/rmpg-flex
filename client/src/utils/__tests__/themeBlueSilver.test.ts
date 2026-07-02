import { describe, it, expect, beforeEach } from 'vitest';
import {
  isBlueSilverForced, BLUE_SILVER_FLAG_KEY, isLegacyBlackForced, LEGACY_FLAG_KEY,
  applyThemePreference, resolveCurrentTheme,
} from '../theme';

describe('Blue & Silver full-override theme', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('is off by default', () => {
    expect(isBlueSilverForced()).toBe(false);
  });

  it('is on when the flag is set to "1"', () => {
    localStorage.setItem(BLUE_SILVER_FLAG_KEY, '1');
    expect(isBlueSilverForced()).toBe(true);
  });

  it('legacy pure-black takes precedence if both flags are somehow set', () => {
    localStorage.setItem(BLUE_SILVER_FLAG_KEY, '1');
    localStorage.setItem(LEGACY_FLAG_KEY, '1');
    expect(isLegacyBlackForced()).toBe(true);
    expect(isBlueSilverForced()).toBe(false);
  });

  it('forces dark color-scheme + theme-blue-silver class even when theme is light', () => {
    localStorage.setItem(BLUE_SILVER_FLAG_KEY, '1');
    applyThemePreference('light', { persist: false, syncNative: false });
    const html = document.documentElement;
    expect(html.classList.contains('theme-blue-silver')).toBe(true);
    expect(html.classList.contains('dark')).toBe(true);
    expect(html.classList.contains('theme-legacy-black')).toBe(false);
    expect(html.style.colorScheme).toBe('dark');
    expect(html.style.backgroundColor.replace(/\s/g, '')).toBe('rgb(12,26,43)');
  });

  it('does not apply when off', () => {
    applyThemePreference('light', { persist: false, syncNative: false });
    const html = document.documentElement;
    expect(html.classList.contains('theme-blue-silver')).toBe(false);
    expect(html.style.colorScheme).toBe('light');
  });

  it('resolveCurrentTheme returns dark while forced, regardless of hour/override', () => {
    localStorage.setItem(BLUE_SILVER_FLAG_KEY, '1');
    localStorage.setItem('rmpg_theme_override', JSON.stringify({ theme: 'light', active: true }));
    expect(resolveCurrentTheme()).toBe('dark');
  });
});
