import type { ReactElement } from 'react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import DialerPanel, {
  DIALER_ORIGIN,
  DIALER_APP_URL,
  DIALER_WINDOW_NAME,
  DIALER_PLACE_CALL_EVENT,
  DIALER_IFRAME_ALLOW,
  DIALER_PANEL_WIDTH,
  DIALER_PANEL_HEIGHT,
  dialerIframeHostStyle,
  openDialerWindow,
  resetDialerWindowForTests,
  normalizeDialTarget,
} from './DialerPanel';
import { DIALER_CONNECT_PATH, DIALER_HOST_ID } from './dialerConnect';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}</div>;
}

function renderPanel(ui: ReactElement = <DialerPanel />, initialPath = '/dispatch') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      {ui}
      <LocationProbe />
    </MemoryRouter>,
  );
}

function postDialConnectMessage(data: unknown, origin: string = DIALER_ORIGIN) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
  });
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

describe('dialerIframeHostStyle', () => {
  test('keeps a full viewport box (never 0×0 / hidden)', () => {
    const style = dialerIframeHostStyle();
    expect(style.width).toBe(DIALER_PANEL_WIDTH);
    expect(style.height).toBe(DIALER_PANEL_HEIGHT);
    expect(style.position).toBe('fixed');
    expect(style.opacity).toBeUndefined();
  });
});

describe('DialerPanel', () => {
  test('mounts the authenticated /dialer iframe, not cookieless /dialer-embed', () => {
    renderPanel();
    const iframe = screen.getByTitle('Dial Connect') as HTMLIFrameElement;
    expect(iframe.getAttribute('src')).toBe(DIALER_APP_URL);
    expect(iframe.getAttribute('src')).not.toContain('dialer-embed');
    expect(iframe).toHaveAttribute('allow', DIALER_IFRAME_ALLOW);
    expect(iframe).toHaveAttribute('loading', 'eager');
  });

  test('Pop out unloads the iframe and exposes a named-window link', () => {
    vi.stubGlobal('open', vi.fn(() => ({ closed: false, close: vi.fn(), focus: vi.fn() })));
    renderPanel();
    fireEvent.click(screen.getByLabelText('Pop out Dial Connect'));
    expect(screen.queryByTitle('Dial Connect')).not.toBeInTheDocument();
    const chip = screen.getByLabelText('Open dialer (disconnected)');
    expect(chip.tagName).toBe('A');
    expect(chip).toHaveAttribute('href', DIALER_APP_URL);
    expect(chip).toHaveAttribute('target', DIALER_WINDOW_NAME);
    expect(chip).toHaveAttribute('rel', 'opener');
    fireEvent.click(screen.getByRole('button', { name: /back in cad/i }));
    expect(screen.getByTitle('Dial Connect')).toBeInTheDocument();
    expect(screen.getByTestId('loc')).toHaveTextContent(DIALER_CONNECT_PATH);
  });

  test('openDialerWindow reuses the named window instead of opening a second one', () => {
    const popup = { closed: false, focus: vi.fn(), postMessage: vi.fn() };
    const open = vi.fn(() => popup);
    vi.stubGlobal('open', open);

    openDialerWindow();
    openDialerWindow();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(DIALER_APP_URL, DIALER_WINDOW_NAME);
    expect(popup.focus).toHaveBeenCalledTimes(1);
  });

  test('ignores messages from a non-Dial-Connect origin', () => {
    const onRinging = vi.fn();
    renderPanel(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage(
      { source: 'dial-connect', type: 'call_status', status: 'ringing', callSid: 'CA1', from: '+18015551234' },
      'https://evil.example.com',
    );
    expect(onRinging).not.toHaveBeenCalled();
  });

  test('ignores same-origin-shaped messages missing the dial-connect source discriminant', () => {
    const onRinging = vi.fn();
    renderPanel(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({ type: 'call_status', status: 'ringing', callSid: 'CA1' });
    expect(onRinging).not.toHaveBeenCalled();
  });

  test('a ringing call_status fires onRinging, stays in CAD, and opens the Dispatch page', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const onRinging = vi.fn();
    renderPanel(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({
      source: 'dial-connect',
      type: 'call_status',
      status: 'ringing',
      callSid: 'CA123',
      from: '+18015551234',
    });
    expect(onRinging).toHaveBeenCalledWith('Inbound call from +18015551234');
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByTitle('Dial Connect')).toBeInTheDocument();
    expect(screen.getByText(/Inbound call from \+18015551234/i).closest('a')).toBeNull();
    expect(screen.getByTestId('loc')).toHaveTextContent(DIALER_CONNECT_PATH);
  });

  test('a ringing call_status with no From falls back to "unknown number"', () => {
    const onRinging = vi.fn();
    renderPanel(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({ source: 'dial-connect', type: 'call_status', status: 'ringing', callSid: 'CA123' });
    expect(onRinging).toHaveBeenCalledWith('Inbound call from unknown number');
  });

  test('a non-ringing call_status does not fire onRinging', () => {
    const onRinging = vi.fn();
    renderPanel(<DialerPanel onRinging={onRinging} />);
    postDialConnectMessage({ source: 'dial-connect', type: 'call_status', status: 'completed', callSid: 'CA123' });
    expect(onRinging).not.toHaveBeenCalled();
  });

  test('duress_alert fires onDuress and opens the Dispatch page', () => {
    const onDuress = vi.fn();
    renderPanel(<DialerPanel onDuress={onDuress} />);
    postDialConnectMessage({
      source: 'dial-connect',
      type: 'duress_alert',
      dispatcherName: 'J. Rivera',
      timestamp: '2026-07-21T00:00:00Z',
    });
    expect(onDuress).toHaveBeenCalledWith('Duress alert: J. Rivera');
    expect(screen.getByTestId('loc')).toHaveTextContent(DIALER_CONNECT_PATH);
  });

  test('any dial-connect message marks connected, and it reverts after the heartbeat timeout', () => {
    vi.useFakeTimers();
    renderPanel();
    postDialConnectMessage({ source: 'dial-connect', type: 'heartbeat' });
    expect(screen.getByText(/Dialer Connected/i)).toBeInTheDocument();

    vi.advanceTimersByTime(46_000);
    expect(screen.getByText(/Dialer Sign in to answer/i)).toBeInTheDocument();
  });

  test('tel: clicks post place_call to the iframe, not a new window', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    renderPanel();
    const iframe = screen.getByTitle('Dial Connect') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage }, configurable: true });

    const link = document.createElement('a');
    link.href = 'tel:8015550100';
    document.body.appendChild(link);
    fireEvent.click(link);
    expect(postMessage).toHaveBeenCalledWith(
      { source: 'rmpg-flex', type: 'place_call', to: '+18015550100' },
      DIALER_ORIGIN,
    );
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByTestId('loc')).toHaveTextContent(DIALER_CONNECT_PATH);
    link.remove();
  });

  test('rmpg-flex:place-call posts to the iframe while embedded', () => {
    renderPanel();
    const iframe = screen.getByTitle('Dial Connect') as HTMLIFrameElement;
    const postMessage = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', { value: { postMessage }, configurable: true });
    window.dispatchEvent(new CustomEvent(DIALER_PLACE_CALL_EVENT, { detail: { to: '+18015559999' } }));
    expect(postMessage).toHaveBeenCalledWith(
      { source: 'rmpg-flex', type: 'place_call', to: '+18015559999' },
      DIALER_ORIGIN,
    );
  });

  test('docks the iframe over the Dialer Connect host while on that page', () => {
    render(
      <MemoryRouter initialEntries={[DIALER_CONNECT_PATH]}>
        <div id={DIALER_HOST_ID} data-testid="dialer-connect-host" />
        <DialerPanel />
      </MemoryRouter>,
    );
    const host = screen.getByTestId('dialer-iframe-host');
    expect(host.style.position).toBe('fixed');
    expect(host.style.width).not.toBe('1px');
    expect(host.style.opacity).toBe('');
    expect(screen.getByTitle('Dial Connect')).toBeInTheDocument();
  });
});
