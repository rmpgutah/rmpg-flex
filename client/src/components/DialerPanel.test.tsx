import type { ReactElement } from 'react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import DialerPanel, {
  DIALER_ORIGIN,
  DIALER_APP_URL,
  DIALER_CONNECT_PATH,
  DIALER_HOST_ID,
  DIALER_PLACE_CALL_EVENT,
  resetDialerWindowForTests,
  normalizeDialTarget,
} from './DialerPanel';

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

function stubIframePostMessage() {
  const postMessage = vi.fn();
  const iframe = document.querySelector('iframe[title="Dial Connect"]');
  expect(iframe).toBeTruthy();
  Object.defineProperty(iframe, 'contentWindow', {
    value: { postMessage },
    configurable: true,
  });
  return postMessage;
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

describe('DialerPanel', () => {
  test('keeps a persistent authenticated /dialer iframe (not cookieless /dialer-embed)', () => {
    renderPanel();
    const iframe = document.querySelector('iframe[title="Dial Connect"]') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.src).toBe(DIALER_APP_URL);
    expect(DIALER_APP_URL.includes('dialer-embed')).toBe(false);
  });

  test('Open dialer navigates to the in-app Dialer Connect page', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    renderPanel();
    fireEvent.click(screen.getByLabelText('Open dialer (disconnected)'));
    expect(screen.getByTestId('loc')).toHaveTextContent(DIALER_CONNECT_PATH);
    expect(open).not.toHaveBeenCalled();
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

  test('a ringing call_status opens Dialer Connect in-app and fires onRinging', () => {
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
    expect(screen.getByTestId('loc')).toHaveTextContent(DIALER_CONNECT_PATH);
    expect(open).not.toHaveBeenCalled();
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

  test('duress_alert opens Dialer Connect in-app and fires onDuress', () => {
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

  test('any dial-connect message marks the chip connected, and it reverts after the heartbeat timeout', () => {
    vi.useFakeTimers();
    renderPanel();
    postDialConnectMessage({ source: 'dial-connect', type: 'heartbeat' });
    expect(screen.getByLabelText('Open dialer (connected)')).toBeInTheDocument();

    vi.advanceTimersByTime(46_000);
    expect(screen.getByLabelText('Open dialer (disconnected)')).toBeInTheDocument();
  });

  test('tel: clicks post place_call to the iframe and open the in-app page', () => {
    renderPanel();
    const postMessage = stubIframePostMessage();
    const link = document.createElement('a');
    link.href = 'tel:8015550100';
    document.body.appendChild(link);
    fireEvent.click(link);
    expect(postMessage).toHaveBeenCalledWith(
      { source: 'rmpg-flex', type: 'place_call', to: '+18015550100' },
      DIALER_ORIGIN,
    );
    expect(screen.getByTestId('loc')).toHaveTextContent(DIALER_CONNECT_PATH);
    link.remove();
  });

  test('rmpg-flex:place-call window event posts to the Dialer iframe', () => {
    renderPanel();
    const postMessage = stubIframePostMessage();
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
    expect(screen.queryByLabelText(/Open dialer/)).not.toBeInTheDocument();
    const iframe = document.querySelector('iframe[title="Dial Connect"]') as HTMLIFrameElement;
    expect(iframe.style.opacity).toBe('1');
    expect(iframe.style.pointerEvents).toBe('auto');
  });
});
