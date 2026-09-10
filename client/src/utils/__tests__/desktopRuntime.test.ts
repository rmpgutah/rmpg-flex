import { describe, expect, it } from 'vitest';
import { getDesktopRuntimeState } from '../desktopRuntime';

describe('getDesktopRuntimeState', () => {
  it('uses the native bridge when preload succeeded', () => {
    expect(getDesktopRuntimeState({ isElectron: true }, 'Mozilla/5.0')).toBe('native');
  });

  it('still recognizes packaged FlexOS when preload failed', () => {
    expect(getDesktopRuntimeState(undefined, 'Mozilla/5.0 rmpg-flex-desktop/5.8.7 Chrome/146 Electron/41.10.4'))
      .toBe('bridge-unavailable');
  });

  it('does not classify an ordinary browser as FlexOS', () => {
    expect(getDesktopRuntimeState(undefined, 'Mozilla/5.0 Chrome/146.0.0.0 Safari/537.36')).toBe('browser');
  });
});
