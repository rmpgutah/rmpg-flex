import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { ExternalLink, PhoneCall, X } from 'lucide-react';
import {
  DIALER_APP_URL,
  DIALER_CONNECT_PATH,
  DIALER_HOST_ID,
  DIALER_ORIGIN,
  DIALER_PLACE_CALL_EVENT,
} from './dialerConnect';

export {
  DIALER_APP_URL,
  DIALER_CONNECT_PATH,
  DIALER_HOST_ID,
  DIALER_ORIGIN,
  DIALER_PLACE_CALL_EVENT,
} from './dialerConnect';

export const DIALER_WINDOW_NAME = 'rmpg-dial-connect';
export const DIALER_IFRAME_ALLOW = 'microphone *; autoplay *; clipboard-write';
export const DIALER_PANEL_WIDTH_PX = 900;
export const DIALER_PANEL_HEIGHT_PX = 680;
export const DIALER_PANEL_WIDTH = `${DIALER_PANEL_WIDTH_PX}px`;
export const DIALER_PANEL_HEIGHT = `${DIALER_PANEL_HEIGHT_PX}px`;

const HEARTBEAT_TIMEOUT_MS = 45_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 5_000;
const TOAST_DURATION_MS = 7_000;

type DialConnectMessage =
  | { source: 'dial-connect'; type: 'call_status'; callSid: string; status: string; from?: string }
  | { source: 'dial-connect'; type: 'duress_alert'; dispatcherName: string; timestamp: string }
  | { source: 'dial-connect'; type: 'heartbeat' };

function isDialConnectMessage(data: unknown): data is DialConnectMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === 'dial-connect' &&
    typeof (data as { type?: unknown }).type === 'string'
  );
}

/** Always-on viewport box. Never 0×0 / opacity 0 — that freezes Twilio Voice. */
export function dialerIframeHostStyle(): CSSProperties {
  return {
    position: 'fixed',
    left: 16,
    bottom: 16,
    width: DIALER_PANEL_WIDTH,
    height: DIALER_PANEL_HEIGHT,
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 96px)',
    overflow: 'hidden',
    zIndex: 9998,
  };
}

export function normalizeDialTarget(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed.replace(/[^\d+]/g, '');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return digits ? `+${digits}` : '';
}

let dialerWindow: Window | null = null;

/** Named top-level `/dialer` (no feature-string popup chrome — less likely to be blocked). */
export function openDialerWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  if (dialerWindow && !dialerWindow.closed) {
    dialerWindow.focus();
    return dialerWindow;
  }
  dialerWindow = window.open(DIALER_APP_URL, DIALER_WINDOW_NAME);
  return dialerWindow;
}

export function postToDialerWindow(data: Record<string, unknown>): void {
  const target = openDialerWindow();
  target?.postMessage(data, DIALER_ORIGIN);
}

export function resetDialerWindowForTests(): void {
  dialerWindow = null;
}

function parkIframe(iframe: HTMLIFrameElement): void {
  Object.assign(iframe.style, {
    position: 'fixed',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
    bottom: '0px',
    left: '0px',
    top: 'auto',
    zIndex: '0',
  });
}

function dockIframe(iframe: HTMLIFrameElement, host: HTMLElement): void {
  const r = host.getBoundingClientRect();
  Object.assign(iframe.style, {
    position: 'fixed',
    top: `${r.top}px`,
    left: `${r.left}px`,
    width: `${Math.max(r.width, 1)}px`,
    height: `${Math.max(r.height, 1)}px`,
    opacity: '1',
    pointerEvents: 'auto',
    bottom: 'auto',
    zIndex: '40',
  });
}

interface Toast {
  id: number;
  kind: 'ringing' | 'duress';
  message: string;
}

interface DialerPanelProps {
  onRinging?: (message: string) => void;
  onDuress?: (message: string) => void;
}

let _toastId = 0;

/**
 * Owns the single Dial Connect iframe for the CAD shell.
 * - On `/dialer-connect`: docks into `#dialer-connect-host`
 * - Elsewhere: keeps a parked (1×1) iframe so Twilio Voice stays registered,
 *   plus a floating status chip that navigates to the Dialer Connect page
 */
export default function DialerPanel({ onRinging, onDuress }: DialerPanelProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastSeen, setLastSeen] = useState(0);

  const onDialerPage = location.pathname === DIALER_CONNECT_PATH;

  const openDialerInApp = useCallback(() => {
    if (location.pathname !== DIALER_CONNECT_PATH) {
      navigate(DIALER_CONNECT_PATH);
    }
  }, [location.pathname, navigate]);

  const addToast = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++_toastId;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_DURATION_MS);
  }, []);

  const postPlaceCall = useCallback((to: string) => {
    const payload = { source: 'rmpg-flex', type: 'place_call', to };
    const frame = iframeRef.current?.contentWindow;
    if (frame) {
      frame.postMessage(payload, DIALER_ORIGIN);
      return;
    }
    postToDialerWindow(payload);
  }, []);

  const placeOutboundCall = useCallback((raw: string) => {
    const to = normalizeDialTarget(raw);
    if (!to) return;
    postPlaceCall(to);
  }, [postPlaceCall]);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.origin !== DIALER_ORIGIN) return;
      if (!isDialConnectMessage(event.data)) return;

      const message = event.data;
      flushSync(() => {
        setLastSeen(Date.now());
        setConnected(true);
        if (message.type === 'call_status' && message.status === 'ringing') {
          addToast('ringing', `Inbound call from ${message.from ?? 'unknown number'}`);
          openDialerInApp();
        } else if (message.type === 'duress_alert') {
          addToast('duress', `Duress alert: ${message.dispatcherName}`);
        }
      });

      if (message.type === 'call_status' && message.status === 'ringing') {
        onRinging?.(`Inbound call from ${message.from ?? 'unknown number'}`);
      } else if (message.type === 'duress_alert') {
        onDuress?.(`Duress alert: ${message.dispatcherName}`);
      }
    },
    [onRinging, onDuress, addToast, openDialerInApp],
  );

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (lastSeen === 0) return;
      if (Date.now() - lastSeen >= HEARTBEAT_TIMEOUT_MS) {
        flushSync(() => setConnected(false));
      }
    }, HEARTBEAT_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [lastSeen]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const el = event.target;
      if (!(el instanceof Element)) return;
      const anchor = el.closest('a[href^="tel:"]');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      placeOutboundCall(href.slice('tel:'.length));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [placeOutboundCall]);

  useEffect(() => {
    const onPlace = (event: Event) => {
      const to = (event as CustomEvent<{ to?: string }>).detail?.to;
      if (typeof to === 'string') placeOutboundCall(to);
    };
    window.addEventListener(DIALER_PLACE_CALL_EVENT, onPlace);
    return () => window.removeEventListener(DIALER_PLACE_CALL_EVENT, onPlace);
  }, [placeOutboundCall]);

  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const sync = () => {
      const host = onDialerPage ? document.getElementById(DIALER_HOST_ID) : null;
      if (host) dockIframe(iframe, host);
      else parkIframe(iframe);
    };

    sync();
    window.addEventListener('resize', sync);
    const host = onDialerPage ? document.getElementById(DIALER_HOST_ID) : null;
    const ro = typeof ResizeObserver !== 'undefined' && host ? new ResizeObserver(sync) : null;
    if (host && ro) ro.observe(host);
    return () => {
      window.removeEventListener('resize', sync);
      ro?.disconnect();
    };
  }, [onDialerPage]);

  return (
    <div className="fixed bottom-4 left-4 z-[9998] flex flex-col items-start pointer-events-none">
      <iframe
        ref={iframeRef}
        src={DIALER_APP_URL}
        title="Dial Connect"
        allow={DIALER_IFRAME_ALLOW}
        loading="eager"
        className="border-0 bg-surface-base pointer-events-auto"
        style={{ position: 'fixed', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' }}
      />

      {toasts.length > 0 && (
        <div className="mb-2 flex flex-col gap-1.5 items-start pointer-events-auto">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="status"
              className="flex items-center gap-2 px-3 py-2 border shadow-lg text-[11px] font-semibold uppercase tracking-wide max-w-[320px]"
              style={{
                background: toast.kind === 'duress' ? 'var(--sev-critical)' : 'var(--surface-raised)',
                borderColor: toast.kind === 'duress' ? 'var(--sev-critical)' : 'var(--sev-ok)',
                color: toast.kind === 'duress' ? '#fff' : 'var(--text-primary)',
              }}
            >
              <PhoneCall className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{toast.message}</span>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className="ml-auto flex-shrink-0 opacity-70 hover:opacity-100"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!onDialerPage && (
        <button
          type="button"
          onClick={openDialerInApp}
          className="pointer-events-auto bg-surface-raised border border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5 shadow-lg"
          aria-label={`Open dialer (${connected ? 'connected' : 'disconnected'})`}
          title="Open Dialer Connect in Dispatch"
        >
          <PhoneCall className="w-3.5 h-3.5" />
          Dialer {connected ? 'Connected' : 'Sign in to answer'}
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: connected ? 'var(--sev-ok)' : 'var(--text-muted)' }}
          />
          <ExternalLink className="w-3 h-3 opacity-70" />
        </button>
      )}
    </div>
  );
}
