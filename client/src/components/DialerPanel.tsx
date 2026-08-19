import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { PhoneCall, RefreshCw, X } from 'lucide-react';
import IconButton from './IconButton';

export const DIALER_ORIGIN = 'https://dialer.rmpgutah.us';

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

interface Toast {
  id: number;
  kind: 'ringing' | 'duress';
  message: string;
}

interface DialerPanelProps {
  onRinging?: (message: string) => void;
  onDuress?: (message: string) => void;
}

// How long after the iframe first loads to wait for an initial heartbeat before
// declaring the dialer service unavailable. Must be longer than a round-trip
// page load but short enough to feel responsive.
const UNAVAILABLE_GRACE_MS = 12_000;

let _toastId = 0;

export default function DialerPanel({ onRinging, onDuress }: DialerPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [connected, setConnected] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastSeenRef = useRef(0);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addToast = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++_toastId;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_DURATION_MS);
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
        // Same flushSync rationale as handleMessage above — this runs on a
        // plain setInterval tick, outside React's batching, and tests advance
        // fake timers then assert immediately.
        flushSync(() => setConnected(false));
      }
    }, HEARTBEAT_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Start the grace timer when the panel first opens (iframe loads for the
  // first time). If no heartbeat arrives within UNAVAILABLE_GRACE_MS the
  // dialer service is unreachable — show an error overlay instead of a blank
  // iframe. Clear the timer whenever any heartbeat arrives.
  const handleIframeLoad = useCallback(() => {
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    graceTimerRef.current = setTimeout(() => {
      if (lastSeenRef.current === 0) setUnavailable(true);
    }, UNAVAILABLE_GRACE_MS);
  }, []);

  // Any real message clears the unavailable state.
  useEffect(() => {
    if (connected) {
      setUnavailable(false);
      if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
    }
  }, [connected]);

  useEffect(() => () => { if (graceTimerRef.current) clearTimeout(graceTimerRef.current); }, []);

  const retry = useCallback(() => {
    setUnavailable(false);
    lastSeenRef.current = 0;
    setIframeKey((k) => k + 1);
  }, []);

  return (
    <div className="fixed bottom-4 left-4 z-[9998] flex flex-col items-start">
      {/* Toast notification stack — appears above the chip, visible on any page */}
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
          // Dial Connect is a full desktop app (its own nav, wide tables,
          // multi-column call/keypad layout) -- a small box left its content
          // cramped and forced horizontal scrolling. Sized close to its
          // actual desktop layout instead, clamped so it never overflows a
          // smaller viewport.
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
        {unavailable ? (
          <div className="flex flex-col items-center justify-center h-[calc(100%-28px)] gap-3 p-6 text-center">
            <PhoneCall className="w-8 h-8 text-fg-muted" />
            <p className="text-[11px] font-semibold text-rmpg-100 uppercase tracking-wide">Dialer unavailable</p>
            <p className="text-[11px] text-fg-secondary leading-relaxed max-w-[280px]">
              Could not connect to dialer.rmpgutah.us. Check that the Dial Connect app is deployed and running.
            </p>
            <button
              type="button"
              onClick={retry}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide border border-border-subtle bg-surface-sunken hover:bg-surface-raised"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
          </div>
        ) : (
          <iframe
            key={iframeKey}
            title="Dial Connect"
            src={`${DIALER_ORIGIN}/dialer-embed`}
            className="w-full border-0"
            style={{ height: 'calc(100% - 28px)' }}
            onLoad={handleIframeLoad}
          />
        )}
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
