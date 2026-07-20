import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPinnedApps, pinApp, unpinApp, isAppPinned,
  getTaskbarPosition, setTaskbarPosition,
  getTaskbarSize, setTaskbarSize,
  isTaskbarAutoHideEnabled, setTaskbarAutoHide,
} from './taskbarPreferences';

describe('taskbarPreferences — pinned apps', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to an empty pinned list', () => {
    expect(getPinnedApps()).toEqual([]);
    expect(isAppPinned('/dispatch')).toBe(false);
  });

  it('pinApp appends the path and isAppPinned reflects it', () => {
    pinApp('/dispatch');
    expect(getPinnedApps()).toEqual(['/dispatch']);
    expect(isAppPinned('/dispatch')).toBe(true);
  });

  it('pinApp is idempotent — pinning an already-pinned path does not duplicate it', () => {
    pinApp('/dispatch');
    pinApp('/dispatch');
    expect(getPinnedApps()).toEqual(['/dispatch']);
  });

  it('pinning multiple apps preserves pin order', () => {
    pinApp('/dispatch');
    pinApp('/warrants');
    pinApp('/records');
    expect(getPinnedApps()).toEqual(['/dispatch', '/warrants', '/records']);
  });

  it('unpinApp removes the path and isAppPinned reflects it', () => {
    pinApp('/dispatch');
    pinApp('/warrants');
    unpinApp('/dispatch');
    expect(getPinnedApps()).toEqual(['/warrants']);
    expect(isAppPinned('/dispatch')).toBe(false);
  });

  it('unpinning a path that was never pinned is a silent no-op', () => {
    pinApp('/dispatch');
    unpinApp('/never-pinned');
    expect(getPinnedApps()).toEqual(['/dispatch']);
  });
});

describe('taskbarPreferences — position', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to bottom', () => {
    expect(getTaskbarPosition()).toBe('bottom');
  });

  it('setTaskbarPosition persists and getTaskbarPosition reflects it', () => {
    setTaskbarPosition('top');
    expect(getTaskbarPosition()).toBe('top');
    expect(localStorage.getItem('rmpg_desktop_taskbar_position')).toBe('top');
  });
});

describe('taskbarPreferences — size', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to small', () => {
    expect(getTaskbarSize()).toBe('small');
  });

  it('setTaskbarSize persists and getTaskbarSize reflects it', () => {
    setTaskbarSize('large');
    expect(getTaskbarSize()).toBe('large');
    expect(localStorage.getItem('rmpg_desktop_taskbar_size')).toBe('large');
  });
});

describe('taskbarPreferences — auto-hide', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to disabled', () => {
    expect(isTaskbarAutoHideEnabled()).toBe(false);
  });

  it('setTaskbarAutoHide(true) persists and isTaskbarAutoHideEnabled reflects it', () => {
    setTaskbarAutoHide(true);
    expect(isTaskbarAutoHideEnabled()).toBe(true);
    expect(localStorage.getItem('rmpg_desktop_taskbar_autohide')).toBe('1');
  });

  it('setTaskbarAutoHide(false) persists and isTaskbarAutoHideEnabled reflects it', () => {
    setTaskbarAutoHide(true);
    setTaskbarAutoHide(false);
    expect(isTaskbarAutoHideEnabled()).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_taskbar_autohide')).toBe('0');
  });
});
