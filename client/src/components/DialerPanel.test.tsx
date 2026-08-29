import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import DialerPanel, {
  DIALER_ORIGIN,
  DIALER_PLACE_CALL_EVENT,
  DIALER_IFRAME_ALLOW,
  DIALER_PANEL_WIDTH,
  DIALER_PANEL_HEIGHT,
  dialerIframeHostStyle,
  normalizeDialTarget,
} from './DialerPanel';

function postDialConnectMessage(data: unknown, origin: string = DIALER_ORIGIN) {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
  test('renders collapsed by default, disconnected', () => {
    render(<DialerPanel />);
    expect(screen.getByLabelText('Open dialer (disconnected)')).toBeInTheDocument();
  });

  test('parks the iframe at a viewport-sized box while collapsed (never 0×0)', () => {
    const parked = dialerIframeHostStyle(true);
    const open = dialerIframeHostStyle(false);
    expect(parked).toEqual({
      position: 'fixed',
      left: 16,
      bottom: 16,
      width: DIALER_PANEL_WIDTH,
      height: DIALER_PANEL_HEIGHT,
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 96px)',
      overflow: 'hidden',
      opacity: 0.01,
      pointerEvents: 'none',
      zIndex: 9998,
    });
    expect(open.position).toBe(parked.position);
    expect(open.width).toBe(parked.width);
    expect(open.height).toBe(parked.height);
    expect(open.left).toBe(parked.left);
    expect(open.bottom).toBe(parked.bottom);
    expect(open.zIndex).toBe(parked.zIndex);
    expect(open.opacity).toBe(1);
    expect(open.pointerEvents).toBe('auto');

    render(<DialerPanel />);
    const host = document.querySelector('[data-dialer-iframe-host]') as HTMLElement;
    expect(host).toHaveAttribute('data-collapsed', 'true');
    expect(host.style.width).toBe(DIALER_PANEL_WIDTH);
    expect(host.style.height).toBe(DIALER_PANEL_HEIGHT);
    expect(host.style.position).toBe('fixed');
    expect(host.style.opacity).toBe('0.01');
    expect(screen.getByTitle('Dial Connect')).toHaveAttribute('loading', 'eager');
  });

  test('expanding only raises opacity — same iframe node and same host geometry', () => {
    render(<DialerPanel />);
    const iframe = screen.getByTitle('Dial Connect');
    const host = document.querySelector('[data-dialer-iframe-host]') as HTMLElement;
    const before = {
      width: host.style.width,
      height: host.style.height,
      position: host.style.position,
      left: host.style.left,
      bottom: host.style.bottom,
    };
    fireEvent.click(screen.getByLabelText('Open dialer (disconnected)'));
    expect(host).toHaveAttribute('data-collapsed', 'false');
    expect(host.style.opacity).toBe('1');
    expect(host.style.pointerEvents).toBe('auto');
    expect(host.style.width).toBe(before.width);
    expect(host.style.height).toBe(before.height);
    expect(host.style.position).toBe(before.position);
    expect(host.style.left).toBe(before.left);
    expect(host.style.bottom).toBe(before.bottom);
    expect(screen.getByTitle('Dial Connect')).toBe(iframe);
  });

  test('keeps the Dial Connect iframe mounted even without a heartbeat', () => {
    vi.useFakeTimers();
    render(<DialerPanel />);
    expect(screen.getByTitle('Dial Connect')).toBeInTheDocument();
    expect(screen.getByTitle('Dial Connect')).toHaveAttribute('allow', DIALER_IFRAME_ALLOW);
    vi.advanceTimersByTime(20_000);
    expect(screen.getByTitle('Dial Connect')).toBeInTheDocument();
    expect(screen.queryByText(/Dialer unavailable/i)).not.toBeInTheDocument();
  });

  test('ignores messages from a non-Dial-Connect origin', () => {
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage(
      { source: 'dial-connect', type: 'call_status', status: 'ringing', callSid: 'CA1', from: '+18015551234' },
      'https://evil.example.com',
    );
    expect(onRinging).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Open dialer (disconnected)')).toBeInTheDocument();
  });

  test('ignores same-origin-shaped messages missing the dial-connect source discriminant', () => {
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({ type: 'call_status', status: 'ringing', callSid: 'CA1' });
    expect(onRinging).not.toHaveBeenCalled();
  });

  test('a ringing call_status expands the panel and fires onRinging with the caller number', () => {
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
    expect(screen.getByLabelText('Collapse dialer panel')).toBeInTheDocument();
  });

  test('a ringing call_status with no From falls back to "unknown number"', () => {
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({ source: 'dial-connect', type: 'call_status', status: 'ringing', callSid: 'CA123' });
    expect(onRinging).toHaveBeenCalledWith('Inbound call from unknown number');
  });

  test('a non-ringing call_status does not expand the panel or fire onRinging', () => {
    const onRinging = vi.fn();
    render(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({ source: 'dial-connect', type: 'call_status', status: 'completed', callSid: 'CA123' });
    expect(onRinging).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Open dialer/)).toBeInTheDocument();
  });

  test('duress_alert expands the panel and fires onDuress', () => {
    const onDuress = vi.fn();
    render(<DialerPanel onDuress={onDuress} />);
    postDialConnectMessage({
      source: 'dial-connect',
      type: 'duress_alert',
      dispatcherName: 'J. Rivera',
      timestamp: '2026-07-21T00:00:00Z',
    });
    expect(onDuress).toHaveBeenCalledWith('Duress alert: J. Rivera');
    expect(screen.getByLabelText('Collapse dialer panel')).toBeInTheDocument();
  });

  test('any dial-connect message marks the panel connected, and it reverts to disconnected after the heartbeat timeout', () => {
    vi.useFakeTimers();
    render(<DialerPanel />);
    postDialConnectMessage({ source: 'dial-connect', type: 'heartbeat' });
    expect(screen.getByLabelText('Open dialer (connected)')).toBeInTheDocument();

    vi.advanceTimersByTime(46_000);
    expect(screen.getByLabelText('Open dialer (disconnected)')).toBeInTheDocument();
  });

  test('tel: clicks expand the panel and post place_call to Dial Connect', () => {
    render(<DialerPanel />);
    const iframe = screen.getByTitle('Dial Connect') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage }, configurable: true });

    const link = document.createElement('a');
    link.href = 'tel:8015550100';
    document.body.appendChild(link);
    fireEvent.click(link);
    expect(screen.getByLabelText('Collapse dialer panel')).toBeInTheDocument();
    expect(postMessage).toHaveBeenCalledWith(
      { source: 'rmpg-flex', type: 'place_call', to: '+18015550100' },
      DIALER_ORIGIN,
    );
    link.remove();
  });

  test('rmpg-flex:place-call window event posts to the iframe', () => {
    render(<DialerPanel />);
    const iframe = screen.getByTitle('Dial Connect') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage }, configurable: true });
    window.dispatchEvent(new CustomEvent(DIALER_PLACE_CALL_EVENT, { detail: { to: '+18015559999' } }));
    expect(postMessage).toHaveBeenCalledWith(
      { source: 'rmpg-flex', type: 'place_call', to: '+18015559999' },
      DIALER_ORIGIN,
    );
  });
});
