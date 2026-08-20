import { describe, it, expect, beforeEach } from 'vitest';
import { isSnapEnabled, setSnapEnabled } from './snapPreference';

describe('snapPreference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to enabled when nothing has been saved yet', () => {
    expect(isSnapEnabled()).toBe(true);
  });

  it('setSnapEnabled(false) persists and isSnapEnabled reflects it', () => {
    setSnapEnabled(false);
    expect(isSnapEnabled()).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_snap_enabled')).toBe('0');
  });

  it('setSnapEnabled(true) persists and isSnapEnabled reflects it', () => {
    setSnapEnabled(false);
    setSnapEnabled(true);
    expect(isSnapEnabled()).toBe(true);
    expect(localStorage.getItem('rmpg_desktop_snap_enabled')).toBe('1');
  });
});
