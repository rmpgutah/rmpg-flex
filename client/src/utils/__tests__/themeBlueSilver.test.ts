import { describe, it, expect, beforeEach } from 'vitest';
import {
  isBlueSilverForced, BLUE_SILVER_FLAG_KEY, isLegacyBlackForced, LEGACY_FLAG_KEY,
  applyThemePreference, resolveCurrentTheme,
} from '../theme';

describe('Blue & Silver full-override theme', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

  it('is ON by default (app-wide default theme as of the 2026-07-04 re-theme)', () => {
    expect(isBlueSilverForced()).toBe(true);
  });

  it('stays on when the flag is explicitly set to "1"', () => {
    localStorage.setItem(BLUE_SILVER_FLAG_KEY, '1');
    expect(isBlueSilverForced()).toBe(true);
  });

  it('is off only when explicitly opted out via "0"', () => {
    localStorage.setItem(BLUE_SILVER_FLAG_KEY, '0');
    expect(isBlueSilverForced()).toBe(false);
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
    // #22405f — must track --surface-base in the html.theme-blue-silver block of
    // theme-palettes.css. This previously asserted rgb(12,26,43) (#0c1a2b), a value
    // orphaned when the 2026-07-07 navy repair moved --surface-base to #22405f; the
    // page root then painted darker than the surfaces above it. Fixed in 242fea1289.
    expect(html.style.backgroundColor.replace(/\s/g, '')).toBe('rgb(34,64,95)');
  });

  it('does not apply when explicitly opted out via "0"', () => {
    localStorage.setItem(BLUE_SILVER_FLAG_KEY, '0');
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
