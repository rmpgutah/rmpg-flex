import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { DIALER_CONNECT_PATH } from '../components/dialerConnect';
import { DIALER_WINDOW_NAME, openDialerWindow, resetDialerWindowForTests } from './dialerWindow';

const nativeUrl = () => `${window.location.origin}${DIALER_CONNECT_PATH}?popout=1`;

beforeEach(() => {
  resetDialerWindowForTests();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('openDialerWindow', () => {
  test('opens the native same-origin pop-out and reuses the named window instead of opening a second one', () => {
    const popup = { closed: false, focus: vi.fn() };
    const open = vi.fn(() => popup);
    vi.stubGlobal('open', open);

    openDialerWindow();
    openDialerWindow();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(nativeUrl(), DIALER_WINDOW_NAME);
    expect(popup.focus).toHaveBeenCalledTimes(1);
  });

  test('opens a fresh pop-out once the previous one was closed', () => {
    const closedPopup = { closed: true, focus: vi.fn() };
    const open = vi.fn(() => closedPopup);
    vi.stubGlobal('open', open);

    openDialerWindow();
    openDialerWindow();

    expect(open).toHaveBeenCalledTimes(2);
    expect(closedPopup.focus).not.toHaveBeenCalled();
  });

  // Regression guard for P6: the legacy iframe kill-switch is gone, so a stale
  // `rmpg_dialer_iframe=1` left in a dispatcher's browser must NOT send them
  // back to the retired Dial Connect app.
  test('always targets the native pop-out, even with the retired iframe flag still set', () => {
    localStorage.setItem('rmpg_dialer_iframe', '1');
    const open = vi.fn(() => ({ closed: false, focus: vi.fn() }));
    vi.stubGlobal('open', open);

    openDialerWindow();

    expect(open).toHaveBeenCalledWith(nativeUrl(), DIALER_WINDOW_NAME);
  });
});
