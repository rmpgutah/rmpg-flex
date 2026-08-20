import { describe, it, expect, beforeEach } from 'vitest';
import { isDesktopSoundEnabled, setDesktopSoundEnabled } from './desktopSoundPreference';

describe('desktopSoundPreference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to enabled', () => {
    expect(isDesktopSoundEnabled()).toBe(true);
  });

  it('setDesktopSoundEnabled(false) persists and isDesktopSoundEnabled reflects it', () => {
    setDesktopSoundEnabled(false);
    expect(isDesktopSoundEnabled()).toBe(false);
    expect(localStorage.getItem('rmpg_desktop_sound_enabled')).toBe('0');
  });

  it('setDesktopSoundEnabled(true) persists and isDesktopSoundEnabled reflects it', () => {
    setDesktopSoundEnabled(false);
    setDesktopSoundEnabled(true);
    expect(isDesktopSoundEnabled()).toBe(true);
    expect(localStorage.getItem('rmpg_desktop_sound_enabled')).toBe('1');
  });
});
