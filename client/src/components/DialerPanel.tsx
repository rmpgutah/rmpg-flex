import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { PhoneCall, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

export const DIALER_ORIGIN = 'https://dialer.rmpgutah.us';
/** Authenticated Dial Connect app. `/dialer-embed` is cookieless and cannot
 *  register the dispatcher's Twilio Voice Client — inbound then fails over
 *  to voicemail with nothing to Answer. */
export const DIALER_APP_URL = `${DIALER_ORIGIN}/dialer`;
export const DIALER_WINDOW_NAME = 'rmpg-dial-connect';
export const DIALER_WINDOW_FEATURES = 'width=960,height=720,scrollbars=yes';
export const DIALER_PLACE_CALL_EVENT = 'rmpg-flex:place-call';

const HEARTBEAT_TIMEOUT_MS = 45_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 5_000;
const TOAST_DURATION_MS = 7_000;

type DialConnectMessage =
  | { source: 'dial-connect'; type: 'call_status'; callSid: string; status: string; from?: string; to?: string; durationSeconds?: number; transcript?: string; recordingUrl?: string }
  | { source: 'dial-connect'; type: 'duress_alert'; dispatcherName: string; timestamp: string }
  | { source: 'dial-connect'; type: 'heartbeat' }
  | { source: 'dial-connect'; type: 'voicemail'; callSid?: string; from?: string; to?: string; transcript?: string; recordingUrl?: string; durationSeconds?: number }
  | { source: 'dial-connect'; type: 'recording_ready'; callSid: string; recordingUrl?: string }
  | { source: 'dial-connect'; type: 'transcript_ready'; callSid: string; transcript: string };

const INGEST_STATUSES = new Set(['completed', 'missed', 'failed', 'voicemail', 'busy']);

function ingestDialConnect(payload: Record<string, unknown>): void {
  void apiFetch('/dialer-connect/events', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).catch(() => { /* never block the live-call UI on archive writes */ });
}

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

let dialerWindow: Window | null = null;

/** Top-level `/dialer` so NextAuth cookies attach and Twilio Device.register
 *  uses the dispatcher identity the IVR `<Dial><Client>` actually rings. */
export function openDialerWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  if (dialerWindow && !dialerWindow.closed) {
    dialerWindow.focus();
    return dialerWindow;
  }
  dialerWindow = window.open(DIALER_APP_URL, DIALER_WINDOW_NAME, DIALER_WINDOW_FEATURES);
  return dialerWindow;
}

export function postToDialer(data: Record<string, unknown>): void {
  const target = openDialerWindow();
  target?.postMessage(data, DIALER_ORIGIN);
}

/** Test hook — do not use from app code. */
export function resetDialerWindowForTests(): void {
  dialerWindow = null;
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
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastSeen, setLastSeen] = useState(0);

  const addToast = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++_toastId;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_DURATION_MS);
  }, []);

  const placeOutboundCall = useCallback((raw: string) => {
    const to = normalizeDialTarget(raw);
    if (!to) return;
    postToDialer({ source: 'rmpg-flex', type: 'place_call', to });
  }, []);

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
        openDialerWindow();
        const msg = `Inbound call from ${message.from ?? 'unknown number'}`;
        addToast('ringing', msg);
        onRinging?.(msg);
      } else if (message.type === 'call_status' && INGEST_STATUSES.has(message.status)) {
        ingestDialConnect({
          type: 'call_status',
          callSid: message.callSid,
          status: message.status,
          from: message.from,
          to: message.to,
          durationSeconds: message.durationSeconds,
          transcript: message.transcript,
          recordingUrl: message.recordingUrl,
        });
      } else if (message.type === 'voicemail') {
        ingestDialConnect({
          type: 'voicemail',
          callSid: message.callSid,
          from: message.from,
          to: message.to,
          transcript: message.transcript,
          recordingUrl: message.recordingUrl,
          durationSeconds: message.durationSeconds,
        });
      } else if (message.type === 'recording_ready' || message.type === 'transcript_ready') {
        ingestDialConnect({
          type: 'call_status',
          callSid: message.callSid,
          recordingUrl: 'recordingUrl' in message ? message.recordingUrl : undefined,
          transcript: 'transcript' in message ? message.transcript : undefined,
        });
      } else if (message.type === 'duress_alert') {
        openDialerWindow();
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

  return (
    <div className="fixed bottom-4 left-4 z-[9998] flex flex-col items-start">
      {toasts.length > 0 && (
        <div className="mb-2 flex flex-col gap-1.5 items-start">
          {toasts.map((toast) => (
            <button
              key={toast.id}
              type="button"
              onClick={() => openDialerWindow()}
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

      <button
        type="button"
        onClick={() => openDialerWindow()}
        className="bg-surface-raised border border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5"
        aria-label={`Open dialer (${connected ? 'connected' : 'disconnected'})`}
        title="Opens Dial Connect in its own window. Keep that window open — inbound calls cannot be answered from the CAD iframe."
      >
        <PhoneCall className="w-3.5 h-3.5" />
        Dialer
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: connected ? 'var(--sev-ok)' : 'var(--text-muted)' }}
        />
      </button>
    </div>
  );
}
