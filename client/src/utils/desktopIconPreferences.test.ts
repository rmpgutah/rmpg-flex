import { describe, it, expect, beforeEach } from 'vitest';
import {
  getIconLabelOverride, setIconLabelOverride, clearIconLabelOverride,
  isAutoArrangeEnabled, setAutoArrangeEnabled,
  areIconsHidden, setIconsHidden,
} from './desktopIconPreferences';

describe('desktopIconPreferences — label overrides', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to no override for any path', () => {
    expect(getIconLabelOverride('/dispatch')).toBeNull();
  });

  it('setIconLabelOverride persists and getIconLabelOverride reflects it', () => {
    setIconLabelOverride('/dispatch', 'Radio Ops');
    expect(getIconLabelOverride('/dispatch')).toBe('Radio Ops');
  });

  it('overrides for different paths do not collide', () => {
    setIconLabelOverride('/dispatch', 'Radio Ops');
    setIconLabelOverride('/map', 'Live Tracker');
    expect(getIconLabelOverride('/dispatch')).toBe('Radio Ops');
    expect(getIconLabelOverride('/map')).toBe('Live Tracker');
  });

  it('clearIconLabelOverride reverts a path to no override', () => {
    setIconLabelOverride('/dispatch', 'Radio Ops');
    clearIconLabelOverride('/dispatch');
    expect(getIconLabelOverride('/dispatch')).toBeNull();
  });

  it('clearing a path that was never overridden is a silent no-op', () => {
    clearIconLabelOverride('/never-set');
    expect(getIconLabelOverride('/never-set')).toBeNull();
  });
});

describe('desktopIconPreferences — auto-arrange', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to disabled', () => {
    expect(isAutoArrangeEnabled()).toBe(false);
  });

  it('setAutoArrangeEnabled(true) persists and isAutoArrangeEnabled reflects it', () => {
    setAutoArrangeEnabled(true);
    expect(isAutoArrangeEnabled()).toBe(true);
    expect(localStorage.getItem('rmpg_desktop_auto_arrange')).toBe('1');
  });

  it('setAutoArrangeEnabled(false) persists and isAutoArrangeEnabled reflects it', () => {
    setAutoArrangeEnabled(true);
    setAutoArrangeEnabled(false);
    expect(isAutoArrangeEnabled()).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_auto_arrange')).toBe('0');
  });
});

describe('desktopIconPreferences — icons hidden', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to shown (not hidden)', () => {
    expect(areIconsHidden()).toBe(false);
  });

  it('setIconsHidden(true) persists and areIconsHidden reflects it', () => {
    setIconsHidden(true);
    expect(areIconsHidden()).toBe(true);
    expect(localStorage.getItem('rmpg_desktop_icons_hidden')).toBe('1');
  });

  it('setIconsHidden(false) persists and areIconsHidden reflects it', () => {
    setIconsHidden(true);
    setIconsHidden(false);
    expect(areIconsHidden()).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_icons_hidden')).toBe('0');
  });
});
