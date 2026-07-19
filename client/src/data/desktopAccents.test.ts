import { describe, it, expect } from 'vitest';
import { DESKTOP_ACCENTS, DEFAULT_ACCENT_ID, getAccent } from './desktopAccents';

describe('desktopAccents', () => {
  it('includes the default accent id in the preset list', () => {
    expect(DESKTOP_ACCENTS.some(a => a.id === DEFAULT_ACCENT_ID)).toBe(true);
  });

  it('getAccent falls back to the default for an unknown id', () => {
    expect(getAccent('not-a-real-id').id).toBe(DEFAULT_ACCENT_ID);
  });

  it('every preset\'s accent color references an existing CSS variable, never a hardcoded hex', () => {
    for (const a of DESKTOP_ACCENTS) {
      expect(a.accent).toMatch(/var\(--/);
      expect(a.accent).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });
});
