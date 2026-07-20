import { describe, it, expect, vi, afterEach } from 'vitest';
import { Radio, Globe } from 'lucide-react';
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

const COMPANY_BROWSER_FN: NavFunction = {
  path: '/desktop-company-browser',
  label: 'Company Browser',
  icon: Globe,
  description: 'test',
  notWindowable: 'test',
  electronOnly: 'company-browser',
};

describe('activateNavFunction — electronOnly', () => {
  const originalElectron = (window as any).electron;
  afterEach(() => { (window as any).electron = originalElectron; });

  it('calls window.electron.openCompanyBrowser when running in Electron', () => {
    const openCompanyBrowser = vi.fn().mockResolvedValue({ ok: true });
    (window as any).electron = { isElectron: true, openCompanyBrowser };
    const openWindow = vi.fn();
    const navigate = vi.fn();
    const onElectronOnlyUnavailable = vi.fn();

    activateNavFunction(COMPANY_BROWSER_FN, { openWindow, navigate, onElectronOnlyUnavailable });

    expect(openCompanyBrowser).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(onElectronOnlyUnavailable).not.toHaveBeenCalled();
  });

  it('calls onElectronOnlyUnavailable when NOT running in Electron', () => {
    (window as any).electron = undefined;
    const openWindow = vi.fn();
    const navigate = vi.fn();
    const onElectronOnlyUnavailable = vi.fn();

    activateNavFunction(COMPANY_BROWSER_FN, { openWindow, navigate, onElectronOnlyUnavailable });

    expect(onElectronOnlyUnavailable).toHaveBeenCalledWith(COMPANY_BROWSER_FN);
    expect(openWindow).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not throw when onElectronOnlyUnavailable is omitted and Electron is absent', () => {
    (window as any).electron = undefined;
    expect(() => activateNavFunction(COMPANY_BROWSER_FN, { openWindow: vi.fn(), navigate: vi.fn() })).not.toThrow();
  });

  it('passes currentUserRole through to window.electron.openCompanyBrowser', () => {
    const openCompanyBrowser = vi.fn().mockResolvedValue({ ok: true });
    (window as any).electron = { isElectron: true, openCompanyBrowser };
    activateNavFunction(COMPANY_BROWSER_FN, { openWindow: vi.fn(), navigate: vi.fn(), currentUserRole: 'officer' });
    expect(openCompanyBrowser).toHaveBeenCalledWith('officer');
  });

  it('passes undefined currentUserRole through when not provided', () => {
    const openCompanyBrowser = vi.fn().mockResolvedValue({ ok: true });
    (window as any).electron = { isElectron: true, openCompanyBrowser };
    activateNavFunction(COMPANY_BROWSER_FN, { openWindow: vi.fn(), navigate: vi.fn() });
    expect(openCompanyBrowser).toHaveBeenCalledWith(undefined);
  });
});
