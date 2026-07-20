import { describe, it, expect, vi } from 'vitest';
import { Radio } from 'lucide-react';
import { getWindowConfig, getWindowConfigByPath, isWindowablePath, activateNavFunction } from './windowManager';
import type { NavFunction } from '../data/navCatalog';

const WINDOWABLE_DEFAULT: NavFunction = { path: '/foo', label: 'Foo', icon: Radio, description: 'd' };
const WINDOWABLE_SIZED: NavFunction = { path: '/bar', label: 'Bar', icon: Radio, description: 'd', windowSize: { width: 1200, height: 900 } };
const EXCLUDED: NavFunction = { path: '/baz', label: 'Baz', icon: Radio, description: 'd', notWindowable: 'kiosk HUD' };

describe('getWindowConfig', () => {
  it('defaults to 1050x800 when no windowSize is set', () => {
    expect(getWindowConfig(WINDOWABLE_DEFAULT)).toEqual({ title: 'Foo', width: 1050, height: 800 });
  });

  it('uses the curated windowSize when present', () => {
    expect(getWindowConfig(WINDOWABLE_SIZED)).toEqual({ title: 'Bar', width: 1200, height: 900 });
  });

  it('returns null when notWindowable is set', () => {
    expect(getWindowConfig(EXCLUDED)).toBeNull();
  });
});

describe('getWindowConfigByPath / isWindowablePath', () => {
  it('resolves real catalog paths, e.g. /dispatch', () => {
    expect(getWindowConfigByPath('/dispatch')).toEqual({ title: 'Dispatch Console', width: 1200, height: 900 });
    expect(isWindowablePath('/dispatch')).toBe(true);
  });

  it('excludes /navigation', () => {
    expect(isWindowablePath('/navigation')).toBe(false);
  });

  it('returns null/false for a path with no catalog entry', () => {
    expect(getWindowConfigByPath('/not-a-real-route')).toBeNull();
    expect(isWindowablePath('/not-a-real-route')).toBe(false);
  });
});

describe('activateNavFunction', () => {
  it('opens a window with the resolved size for a windowable function', () => {
    const openWindow = vi.fn();
    const navigate = vi.fn();
    activateNavFunction(WINDOWABLE_SIZED, { openWindow, navigate });
    expect(openWindow).toHaveBeenCalledWith('/bar', 'Bar', { width: 1200, height: 900 });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates for a non-windowable function', () => {
    const openWindow = vi.fn();
    const navigate = vi.fn();
    activateNavFunction(EXCLUDED, { openWindow, navigate });
    expect(navigate).toHaveBeenCalledWith('/baz');
    expect(openWindow).not.toHaveBeenCalled();
  });
});
