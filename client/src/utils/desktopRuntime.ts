export type DesktopRuntimeState = 'native' | 'bridge-unavailable' | 'browser';

/**
 * Detect the FlexOS desktop shell independently from its preload bridge.
 *
 * A failed Electron preload removes `window.electron`, but it does not remove
 * Electron's UA token (or the product token stamped by packaged FlexOS).  UI
 * that only checks the bridge therefore reports "not running in FlexOS" at
 * exactly the moment an operator most needs an accurate diagnostic.
 */
export function getDesktopRuntimeState(
  electron: unknown = typeof window === 'undefined' ? undefined : (window as unknown as { electron?: unknown }).electron,
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): DesktopRuntimeState {
  if (electron && typeof electron === 'object') return 'native';

  const shellUa = /(?:\bElectron\/|\brmpg-flex-desktop\/|\bRMPGFlex\/)/i.test(userAgent);
  return shellUa ? 'bridge-unavailable' : 'browser';
}

export function isFlexOSDesktopRuntime(): boolean {
  return getDesktopRuntimeState() !== 'browser';
}
