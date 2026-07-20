import { describe, it, expect, beforeEach } from 'vitest';
import { getSavedPosition, saveWindowPosition } from './desktopWindowPositions';

describe('desktopWindowPositions', () => {
  beforeEach(() => sessionStorage.clear());

  it('returns null for a path with no saved position', () => {
    expect(getSavedPosition('/dispatch')).toBeNull();
  });

  it('saveWindowPosition persists and getSavedPosition retrieves it', () => {
    saveWindowPosition('/dispatch', { x: 300, y: 200, width: 900, height: 700 });
    expect(getSavedPosition('/dispatch')).toEqual({ x: 300, y: 200, width: 900, height: 700 });
  });

  it('tracks multiple paths independently', () => {
    saveWindowPosition('/dispatch', { x: 300, y: 200, width: 900, height: 700 });
    saveWindowPosition('/map', { x: 10, y: 10, width: 1200, height: 900 });
    expect(getSavedPosition('/dispatch')).toEqual({ x: 300, y: 200, width: 900, height: 700 });
    expect(getSavedPosition('/map')).toEqual({ x: 10, y: 10, width: 1200, height: 900 });
  });

  it('a later save for the same path overwrites the earlier one', () => {
    saveWindowPosition('/dispatch', { x: 300, y: 200, width: 900, height: 700 });
    saveWindowPosition('/dispatch', { x: 50, y: 50, width: 800, height: 600 });
    expect(getSavedPosition('/dispatch')).toEqual({ x: 50, y: 50, width: 800, height: 600 });
  });
});
