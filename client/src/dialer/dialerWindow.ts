import { DIALER_CONNECT_PATH } from '../components/dialerConnect';

/** Name of the reusable pop-out window hosting the native softphone. */
export const DIALER_WINDOW_NAME = 'rmpg-dial-connect';

let dialerWindow: Window | null = null;

/**
 * Named pop-out window for the native softphone (no feature string, so it
 * opens as a tab-like window that popup blockers are less likely to eat).
 *
 * Always same-origin `/dialer-connect?popout=1`. The legacy Dial Connect
 * iframe app and its `rmpg_dialer_iframe` kill-switch were removed in P6,
 * so there is no longer an alternate target.
 */
export function openDialerWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  if (dialerWindow && !dialerWindow.closed) {
    dialerWindow.focus();
    return dialerWindow;
  }
  dialerWindow = window.open(`${window.location.origin}${DIALER_CONNECT_PATH}?popout=1`, DIALER_WINDOW_NAME);
  return dialerWindow;
}

export function resetDialerWindowForTests(): void {
  dialerWindow = null;
}
