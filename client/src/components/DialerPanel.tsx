import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { PhoneCall, X } from 'lucide-react';
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

/** Best-effort E.164 for US/NANP numbers Flex stores in person/job records. */
export function normalizeDialTarget(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed.replace(/[^\d+]/g, '');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return digits ? `+${digits}` : '';
}

export function postToDialer(data: Record<string, unknown>): void {
  if (typeof document === 'undefined') return;
  const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Dial Connect"]');
  iframe?.contentWindow?.postMessage(data, DIALER_ORIGIN);
}

/** Test hook — do not use from app code. Kept so older tests can reset module state. */
export function resetDialerWindowForTests(): void {
  /* iframe is queried from the document; nothing to reset */
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

  const placeOutboundCall = useCallback((raw: string) => {
    const to = normalizeDialTarget(raw);
    if (!to) return;
    postToDialer({ source: 'rmpg-flex', type: 'place_call', to });
    openDialerInApp();
  }, [openDialerInApp]);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.origin !== DIALER_ORIGIN) return;
      if (!isDialConnectMessage(event.data)) return;

      const message = event.data;
      flushSync(() => {
        setLastSeen(Date.now());
        setConnected(true);
      });

      if (message.type === 'call_status' && message.status === 'ringing') {
        openDialerInApp();
        const msg = `Inbound call from ${message.from ?? 'unknown number'}`;
        addToast('ringing', msg);
        onRinging?.(msg);
      } else if (message.type === 'duress_alert') {
        openDialerInApp();
        const msg = `Duress alert: ${message.dispatcherName}`;
        addToast('duress', msg);
        onDuress?.(msg);
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
    <div className="fixed bottom-4 left-4 z-[9998] flex flex-col items-start">
      <iframe
        ref={iframeRef}
        src={DIALER_APP_URL}
        title="Dial Connect"
        allow="microphone; camera; autoplay; clipboard-write"
        className="border-0 bg-surface-base"
        style={{ position: 'fixed', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' }}
      />

      {toasts.length > 0 && (
        <div className="mb-2 flex flex-col gap-1.5 items-start">
          {toasts.map((toast) => (
            <button
              key={toast.id}
              type="button"
              onClick={() => openDialerInApp()}
              className="flex items-center gap-2 px-3 py-2 border shadow-lg text-[11px] font-semibold uppercase tracking-wide max-w-[320px] text-left"
              style={{
                background: toast.kind === 'duress' ? 'var(--sev-critical)' : 'var(--surface-raised)',
                borderColor: toast.kind === 'duress' ? 'var(--sev-critical)' : 'var(--sev-ok)',
                color: toast.kind === 'duress' ? '#fff' : 'var(--text-primary)',
              }}
            >
              <PhoneCall className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{toast.message}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label="Dismiss notification"
                onClick={(e) => {
                  e.stopPropagation();
                  setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  e.stopPropagation();
                  setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                }}
                className="ml-auto flex-shrink-0 opacity-70 hover:opacity-100"
              >
                <X className="w-3 h-3" />
              </span>
            </button>
          ))}
        </div>
      )}

      {!onDialerPage && (
        <button
          type="button"
          onClick={() => openDialerInApp()}
          className="bg-surface-raised border border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5"
          aria-label={`Open dialer (${connected ? 'connected' : 'disconnected'})`}
          title="Open Dialer Connect inside Dispatch"
        >
          <PhoneCall className="w-3.5 h-3.5" />
          Dialer
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: connected ? 'var(--sev-ok)' : 'var(--text-muted)' }}
          />
        </button>
      )}
    </div>
  );
}
