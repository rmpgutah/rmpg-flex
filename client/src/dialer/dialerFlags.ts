export const IFRAME_DIALER_FLAG_KEY = 'rmpg_dialer_iframe';

/** Kill-switch: '1' restores the legacy Dial Connect iframe (no deploy needed). */
export function isIframeDialerForced(): boolean {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(IFRAME_DIALER_FLAG_KEY) === '1'; } catch { return false; }
}
