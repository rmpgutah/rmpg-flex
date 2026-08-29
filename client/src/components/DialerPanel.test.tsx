import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import DialerPanel, {
  DIALER_ORIGIN,
  DIALER_APP_URL,
  DIALER_WINDOW_NAME,
  DIALER_WINDOW_FEATURES,
  DIALER_PLACE_CALL_EVENT,
  openDialerWindow,
  resetDialerWindowForTests,
  normalizeDialTarget,
} from './DialerPanel';

function postDialConnectMessage(data: unknown, origin: string = DIALER_ORIGIN) {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetDialerWindowForTests();
});

describe('normalizeDialTarget', () => {
  test('prefixes 10-digit US numbers', () => {
    expect(normalizeDialTarget('(801) 555-1234')).toBe('+18015551234');
  });
  test('keeps explicit plus', () => {
    expect(normalizeDialTarget('+18015551234')).toBe('+18015551234');
  });
});

describe('DialerPanel', () => {
  test('renders a chip and does not mount the cookieless dialer-embed iframe', () => {
    render(<DialerPanel />);
    expect(screen.getByLabelText('Open dialer (disconnected)')).toBeInTheDocument();
    expect(screen.queryByTitle('Dial Connect')).not.toBeInTheDocument();
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });

  test('Open dialer opens the authenticated /dialer window, not /dialer-embed', () => {
    const popup = { closed: false, focus: vi.fn(), postMessage: vi.fn() };
    const open = vi.fn(() => popup);
    vi.stubGlobal('open', open);

    render(<DialerPanel />);
    fireEvent.click(screen.getByLabelText('Open dialer (disconnected)'));
    expect(open).toHaveBeenCalledWith(DIALER_APP_URL, DIALER_WINDOW_NAME, DIALER_WINDOW_FEATURES);
    expect(open.mock.calls[0][0]).not.toContain('dialer-embed');
  });

  test('openDialerWindow reuses the named window instead of opening a second one', () => {
    const popup = { closed: false, focus: vi.fn(), postMessage: vi.fn() };
    const open = vi.fn(() => popup);
    vi.stubGlobal('open', open);

    openDialerWindow();
    openDialerWindow();
    expect(open).toHaveBeenCalledTimes(1);
    expect(popup.focus).toHaveBeenCalledTimes(1);
  });

  test('ignores messages from a non-Dial-Connect origin', () => {
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage(
      { source: 'dial-connect', type: 'call_status', status: 'ringing', callSid: 'CA1', from: '+18015551234' },
      'https://evil.example.com',
    );
    expect(onRinging).not.toHaveBeenCalled();
  });

  test('ignores same-origin-shaped messages missing the dial-connect source discriminant', () => {
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({ type: 'call_status', status: 'ringing', callSid: 'CA1' });
    expect(onRinging).not.toHaveBeenCalled();
  });

  test('a ringing call_status focuses the Dialer window and fires onRinging', () => {
    const popup = { closed: false, focus: vi.fn(), postMessage: vi.fn() };
    const open = vi.fn(() => popup);
    vi.stubGlobal('open', open);
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({
      source: 'dial-connect',
      type: 'call_status',
      status: 'ringing',
      callSid: 'CA123',
      from: '+18015551234',
    });
    expect(onRinging).toHaveBeenCalledWith('Inbound call from +18015551234');
    expect(open).toHaveBeenCalledWith(DIALER_APP_URL, DIALER_WINDOW_NAME, DIALER_WINDOW_FEATURES);
  });

  test('a ringing call_status with no From falls back to "unknown number"', () => {
    vi.stubGlobal('open', vi.fn(() => ({ closed: false, focus: vi.fn(), postMessage: vi.fn() })));
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({ source: 'dial-connect', type: 'call_status', status: 'ringing', callSid: 'CA123' });
    expect(onRinging).toHaveBeenCalledWith('Inbound call from unknown number');
  });

  test('a non-ringing call_status does not fire onRinging', () => {
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({ source: 'dial-connect', type: 'call_status', status: 'completed', callSid: 'CA123' });
    expect(onRinging).not.toHaveBeenCalled();
  });

  test('duress_alert focuses the Dialer window and fires onDuress', () => {
    vi.stubGlobal('open', vi.fn(() => ({ closed: false, focus: vi.fn(), postMessage: vi.fn() })));
    const onDuress = vi.fn();
    render(<DialerPanel onDuress={onDuress} />);
    postDialConnectMessage({
      source: 'dial-connect',
      type: 'duress_alert',
      dispatcherName: 'J. Rivera',
      timestamp: '2026-07-21T00:00:00Z',
    });
    expect(onDuress).toHaveBeenCalledWith('Duress alert: J. Rivera');
  });

  test('any dial-connect message marks the chip connected, and it reverts after the heartbeat timeout', () => {
    vi.useFakeTimers();
    render(<DialerPanel />);
    postDialConnectMessage({ source: 'dial-connect', type: 'heartbeat' });
    expect(screen.getByLabelText('Open dialer (connected)')).toBeInTheDocument();

    vi.advanceTimersByTime(46_000);
    expect(screen.getByLabelText('Open dialer (disconnected)')).toBeInTheDocument();
  });

  test('tel: clicks open /dialer and post place_call', () => {
    const popup = { closed: false, focus: vi.fn(), postMessage: vi.fn() };
    vi.stubGlobal('open', vi.fn(() => popup));

    render(<DialerPanel />);
    const link = document.createElement('a');
    link.href = 'tel:8015550100';
    document.body.appendChild(link);
    fireEvent.click(link);
    expect(popup.postMessage).toHaveBeenCalledWith(
      { source: 'rmpg-flex', type: 'place_call', to: '+18015550100' },
      DIALER_ORIGIN,
    );
    link.remove();
  });

  test('rmpg-flex:place-call window event posts to the Dialer window', () => {
    const popup = { closed: false, focus: vi.fn(), postMessage: vi.fn() };
    vi.stubGlobal('open', vi.fn(() => popup));
    render(<DialerPanel />);
    window.dispatchEvent(new CustomEvent(DIALER_PLACE_CALL_EVENT, { detail: { to: '+18015559999' } }));
    expect(popup.postMessage).toHaveBeenCalledWith(
      { source: 'rmpg-flex', type: 'place_call', to: '+18015559999' },
      DIALER_ORIGIN,
    );
  });
});
