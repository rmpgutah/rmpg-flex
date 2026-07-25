import { describe, it, expect, beforeEach } from 'vitest';
import { applyThemePreference, BLUE_SILVER_FLAG_KEY, LEGACY_FLAG_KEY } from '../theme';

// NOTE: the exported function is applyThemePreference(value, options?), NOT
// applyTheme. Pass { persist: false, syncNative: false } so the test does not
// write localStorage back or reach for the Capacitor status-bar module.
const apply = () => applyThemePreference('dark', { persist: false, syncNative: false });

describe('theme class stamping', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.style.cssText = '';
  });

  it('does not stamp theme-dark alongside theme-blue-silver', () => {
    // Blue & Silver is default-ON when the flag is absent.
    apply();
    const cls = document.documentElement.className;
    expect(cls).toContain('theme-blue-silver');
    expect(cls).toContain('dark');
    expect(cls.split(/\s+/)).not.toContain('theme-dark');
  });

  it('stamps theme-dark when Blue & Silver is opted out', () => {
    localStorage.setItem(BLUE_SILVER_FLAG_KEY, '0');
    apply();
    const cls = document.documentElement.className;
    expect(cls.split(/\s+/)).toContain('theme-dark');
    expect(cls).not.toContain('theme-blue-silver');
  });

  it('legacy black wins and stamps neither theme-dark nor theme-blue-silver', () => {
    localStorage.setItem(LEGACY_FLAG_KEY, '1');
    apply();
    const cls = document.documentElement.className;
    expect(cls).toContain('theme-legacy-black');
    expect(cls).not.toContain('theme-blue-silver');
    expect(cls.split(/\s+/)).not.toContain('theme-dark');
  });

  it('uses the current navy surface-base as the chrome color, not the stale #0c1a2b', () => {
    apply();
    expect(document.documentElement.style.backgroundColor).toBe('rgb(34, 64, 95)');
  });
});
