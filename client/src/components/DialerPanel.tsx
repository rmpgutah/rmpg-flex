import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { PhoneCall, X } from 'lucide-react';
import IconButton from './IconButton';

export const DIALER_ORIGIN = 'https://dialer.rmpgutah.us';

const HEARTBEAT_TIMEOUT_MS = 45_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 5_000;

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

interface DialerPanelProps {
  onRinging?: (message: string) => void;
  onDuress?: (message: string) => void;
}

export default function DialerPanel({ onRinging, onDuress }: DialerPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [connected, setConnected] = useState(false);
  const lastSeenRef = useRef(0);

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
        onRinging?.(`Inbound call from ${message.from ?? 'unknown number'}`);
      } else if (message.type === 'duress_alert') {
        onDuress?.(`Duress alert: ${message.dispatcherName}`);
      }
    },
    [onRinging, onDuress],
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

  return (
    <div className="fixed bottom-4 right-4 z-[9998] flex flex-col items-end">
      <div
        style={{
          width: collapsed ? 0 : 360,
          height: collapsed ? 0 : 520,
          overflow: 'hidden',
          transition: 'width 0.2s ease, height 0.2s ease',
        }}
        className="bg-surface-raised border border-border-subtle shadow-lg mb-2"
      >
        <div className="flex items-center justify-between px-2 py-1 border-b border-border-subtle">
          <span className="text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5 whitespace-nowrap">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: connected ? '#4ade80' : '#6b7280' }}
            />
            Dialer {connected ? 'Connected' : 'Disconnected'}
          </span>
          <IconButton aria-label="Collapse dialer panel" onClick={() => setCollapsed(true)}>
            <X className="w-3.5 h-3.5" />
          </IconButton>
        </div>
        <iframe
          title="Dial Connect"
          src={`${DIALER_ORIGIN}/dialer`}
          className="w-full border-0"
          style={{ height: 'calc(100% - 28px)' }}
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
            style={{ background: connected ? '#4ade80' : '#6b7280' }}
          />
        </button>
      )}
    </div>
  );
}
