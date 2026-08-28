import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { PhoneCall, X } from 'lucide-react';
import IconButton from './IconButton';

export const DIALER_ORIGIN = 'https://dialer.rmpgutah.us';
export const DIALER_PLACE_CALL_EVENT = 'rmpg-flex:place-call';
export const DIALER_IFRAME_ALLOW = 'microphone; autoplay; clipboard-write';

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
  const [collapsed, setCollapsed] = useState(true);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastSeenRef = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const addToast = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++_toastId;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_DURATION_MS);
  }, []);

  const placeOutboundCall = useCallback((raw: string) => {
    const to = normalizeDialTarget(raw);
    if (!to) return;
    flushSync(() => setCollapsed(false));
    iframeRef.current?.contentWindow?.postMessage(
      { source: 'rmpg-flex', type: 'place_call', to },
      DIALER_ORIGIN,
    );
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.origin !== DIALER_ORIGIN) return;
      if (!isDialConnectMessage(event.data)) return;

      lastSeenRef.current = Date.now();

      const message = event.data;
      // flushSync: this fires from a native `message` listener, outside React's
      // event system, so React 18+ automatic batching would otherwise defer the
      // DOM update to a later microtask. Callers (and tests) that dispatch a
      // message and immediately assert on the panel's state need it applied
      // synchronously.
      flushSync(() => {
        setConnected(true);
        if (message.type === 'call_status' && message.status === 'ringing') {
          setCollapsed(false);
        } else if (message.type === 'duress_alert') {
          setCollapsed(false);
        }
      });

      if (message.type === 'call_status' && message.status === 'ringing') {
        const msg = `Inbound call from ${message.from ?? 'unknown number'}`;
        addToast('ringing', msg);
        onRinging?.(msg);
      } else if (message.type === 'duress_alert') {
        const msg = `Duress alert: ${message.dispatcherName}`;
        addToast('duress', msg);
        onDuress?.(msg);
      }
    },
    [onRinging, onDuress, addToast],
  );

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (lastSeenRef.current === 0) return;
      if (Date.now() - lastSeenRef.current >= HEARTBEAT_TIMEOUT_MS) {
        flushSync(() => setConnected(false));
      }
    }, HEARTBEAT_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // tel: links in Records / Serve / Skip Tracer should place the call in
  // Dial Connect instead of opening the OS phone handler. Dial Connect
  // listens for {source:'rmpg-flex', type:'place_call', to} on the embed.
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

  return (
    <div className="fixed bottom-4 left-4 z-[9998] flex flex-col items-start">
      {toasts.length > 0 && (
        <div className="mb-2 flex flex-col gap-1.5 items-start">
          {toasts.map((toast) => (
            <div
              key={toast.id}
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

      <div
        style={{
          width: collapsed ? 0 : 'min(900px, calc(100vw - 32px))',
          height: collapsed ? 0 : 'min(680px, calc(100vh - 96px))',
          overflow: 'hidden',
          transition: 'width 0.2s ease, height 0.2s ease',
        }}
        className="bg-surface-raised border border-border-subtle shadow-lg mb-2"
      >
        <div className="flex items-center justify-between px-2 py-1 border-b border-border-subtle">
          <span className="text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5 whitespace-nowrap">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: connected ? 'var(--sev-ok)' : 'var(--text-muted)' }}
            />
            Dialer {connected ? 'Connected' : 'Disconnected'}
          </span>
          <IconButton aria-label="Collapse dialer panel" onClick={() => setCollapsed(true)}>
            <X className="w-3.5 h-3.5" />
          </IconButton>
        </div>
        <iframe
          ref={iframeRef}
          title="Dial Connect"
          src={`${DIALER_ORIGIN}/dialer-embed`}
          className="w-full border-0"
          style={{ height: 'calc(100% - 28px)' }}
          allow={DIALER_IFRAME_ALLOW}
        />
      </div>
      {collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="bg-surface-raised border border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5"
          aria-label={`Open dialer (${connected ? 'connected' : 'disconnected'})`}
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
