import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { ExternalLink, PhoneCall, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { DIAL_RECORDING_READY_EVENT, DIALER_CONNECT_PATH, DIALER_HOST_ID } from './dialerConnect';

export const DIALER_ORIGIN = 'https://dialer.rmpgutah.us';
/** Authenticated Dial Connect. Never `/dialer-embed` — that page is cookieless
 *  and cannot register the dispatcher Twilio Client the IVR actually Dials. */
export const DIALER_APP_URL = `${DIALER_ORIGIN}/dialer`;
export const DIALER_WINDOW_NAME = 'rmpg-dial-connect';
export const DIALER_PLACE_CALL_EVENT = 'rmpg-flex:place-call';
export const DIALER_CHROME_EVENT = 'rmpg-flex:dialer-chrome';
export const DIALER_IFRAME_ALLOW = 'microphone *; autoplay *; clipboard-write';
export const DIALER_PANEL_WIDTH_PX = 900;
export const DIALER_PANEL_HEIGHT_PX = 680;
export const DIALER_PANEL_WIDTH = `${DIALER_PANEL_WIDTH_PX}px`;
export const DIALER_PANEL_HEIGHT = `${DIALER_PANEL_HEIGHT_PX}px`;

const HEARTBEAT_TIMEOUT_MS = 45_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 5_000;
const TOAST_DURATION_MS = 7_000;

type DialConnectMessage =
  | { source: 'dial-connect'; type: 'call_status'; callSid: string; status: string; from?: string; to?: string; durationSeconds?: number; transcript?: string; recordingUrl?: string }
  | { source: 'dial-connect'; type: 'duress_alert'; dispatcherName: string; timestamp: string }
  | { source: 'dial-connect'; type: 'heartbeat' }
  | { source: 'dial-connect'; type: 'voicemail'; callSid?: string; from?: string; to?: string; transcript?: string; recordingUrl?: string; durationSeconds?: number }
  | {
      source: 'dial-connect';
      type: 'recording_ready';
      callSid?: string;
      call_sid?: string;
      recordingUrl?: string;
      recordingSid?: string;
      recording_sid?: string;
      from?: string;
      to?: string;
      direction?: string;
      startedAt?: string;
      endedAt?: string;
      durationSeconds?: number;
      dispatcherName?: string;
      transcript?: string;
      segments?: unknown;
    }
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

/** Full-size off-screen park used when the CAD window is closed with X. */
export function dialerIframeParkStyle(): CSSProperties {
  return {
    position: 'fixed',
    left: -(DIALER_PANEL_WIDTH_PX + 80),
    top: 0,
    width: DIALER_PANEL_WIDTH,
    height: DIALER_PANEL_HEIGHT,
    overflow: 'hidden',
    zIndex: 0,
    pointerEvents: 'none',
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

/** Prefer the CAD iframe (one Twilio Client) and only pop a window if it is gone. */
export function postToDialer(data: Record<string, unknown>): void {
  if (typeof document !== 'undefined') {
    const iframe = document.querySelector('iframe[title="Dial Connect"]') as HTMLIFrameElement | null;
    const frame = iframe?.contentWindow;
    if (frame) {
      frame.postMessage(data, DIALER_ORIGIN);
      return;
    }
  }
  postToDialerWindow(data);
}

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
  const navigate = useNavigate();
  const location = useLocation();
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastSeen, setLastSeen] = useState(0);
  const [poppedOut, setPoppedOut] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [pageDock, setPageDock] = useState<CSSProperties | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeSrcRef = useRef(DIALER_APP_URL);
  const popupRef = useRef<Window | null>(null);

  const onDialerPage = location.pathname === DIALER_CONNECT_PATH;

  const openDialerInApp = useCallback(() => {
    if (location.pathname !== DIALER_CONNECT_PATH) {
      navigate(DIALER_CONNECT_PATH);
    }
  }, [location.pathname, navigate]);

  const revealDialer = useCallback(() => {
    setMinimized(false);
    openDialerInApp();
  }, [openDialerInApp]);

  const dockDialer = useCallback(() => {
    try {
      popupRef.current?.close();
    } catch {
      /* cross-origin close is best-effort */
    }
    popupRef.current = null;
    setPoppedOut(false);
    setMinimized(false);
    openDialerInApp();
  }, [openDialerInApp]);

  const addToast = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++_toastId;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_DURATION_MS);
  }, []);

  const postPlaceCall = useCallback((to: string) => {
    const payload = { source: 'rmpg-flex', type: 'place_call', to };
    const frame = iframeRef.current?.contentWindow;
    if (frame && !poppedOut) {
      frame.postMessage(payload, DIALER_ORIGIN);
      return;
    }
    postToDialerWindow(payload);
  }, [poppedOut]);

  const placeOutboundCall = useCallback((raw: string) => {
    const to = normalizeDialTarget(raw);
    if (!to) return;
    postPlaceCall(to);
    if (!poppedOut) revealDialer();
  }, [postPlaceCall, poppedOut, revealDialer]);

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
        } else if (message.type === 'duress_alert') {
          addToast('duress', `Duress alert: ${message.dispatcherName}`);
        }
      });

      if (message.type === 'call_status' && message.status === 'ringing') {
        if (!poppedOut) revealDialer();
        onRinging?.(`Inbound call from ${message.from ?? 'unknown number'}`);
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
        if (message.type === 'recording_ready') {
          const recordingSid = message.recordingSid || message.recording_sid;
          if (recordingSid) {
            void apiFetch('/dial-connect-recordings', {
              method: 'POST',
              body: JSON.stringify({
                recordingSid,
                callSid: message.callSid || message.call_sid,
                from: message.from,
                to: message.to,
                direction: message.direction,
                startedAt: message.startedAt,
                endedAt: message.endedAt,
                durationSeconds: message.durationSeconds,
                dispatcherName: message.dispatcherName,
                transcript: message.transcript,
                segments: message.segments,
              }),
            }).then(() => {
              window.dispatchEvent(new CustomEvent(DIAL_RECORDING_READY_EVENT));
            }).catch(() => {
              /* ingest is best-effort; Dial Connect API-key POST is the durable path */
            });
          }
        }
      } else if (message.type === 'duress_alert') {
        if (!poppedOut) revealDialer();
        onDuress?.(`Duress alert: ${message.dispatcherName}`);
      }
    },
    [onRinging, onDuress, addToast, revealDialer, poppedOut],
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
    if (!onDialerPage || minimized) {
      setPageDock(null);
      return;
    }
    const sync = () => {
      const host = document.getElementById(DIALER_HOST_ID);
      if (!host) {
        setPageDock(null);
        return;
      }
      const r = host.getBoundingClientRect();
      setPageDock({
        position: 'fixed',
        top: r.top,
        left: r.left,
        width: Math.max(r.width, 320),
        height: Math.max(r.height, 240),
        overflow: 'hidden',
        zIndex: 40,
      });
    };
    sync();
    window.addEventListener('resize', sync);
    const host = document.getElementById(DIALER_HOST_ID);
    const ro = typeof ResizeObserver !== 'undefined' && host ? new ResizeObserver(sync) : null;
    if (host && ro) ro.observe(host);
    return () => {
      window.removeEventListener('resize', sync);
      ro?.disconnect();
    };
  }, [onDialerPage, minimized]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(DIALER_CHROME_EVENT, {
      detail: { minimized, poppedOut },
    }));
  }, [minimized, poppedOut]);

  const hostStyle = minimized ? dialerIframeParkStyle() : (pageDock ?? dialerIframeHostStyle());

  return (
    <div className="fixed bottom-4 left-4 z-[9998] flex flex-col items-start">
      {toasts.length > 0 && (
        <div className="mb-2 flex flex-col gap-1.5 items-start">
          {toasts.map((toast) => {
            const toastClass =
              'flex items-center gap-2 px-3 py-2 border shadow-lg text-[11px] font-semibold uppercase tracking-wide max-w-[320px]';
            const toastStyle = {
              background: toast.kind === 'duress' ? 'var(--sev-critical)' : 'var(--surface-raised)',
              borderColor: toast.kind === 'duress' ? 'var(--sev-critical)' : 'var(--sev-ok)',
              color: toast.kind === 'duress' ? '#fff' : 'var(--text-primary)',
            } as const;
            const body = (
              <>
                <PhoneCall className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">{toast.message}</span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Dismiss notification"
                  onClick={(e) => {
                    e.preventDefault();
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
              </>
            );
            if (poppedOut) {
              return (
                <a
                  key={toast.id}
                  href={DIALER_APP_URL}
                  target={DIALER_WINDOW_NAME}
                  rel="opener"
                  className={toastClass}
                  style={toastStyle}
                >
                  {body}
                </a>
              );
            }
            return (
              <button
                key={toast.id}
                type="button"
                className={`${toastClass} text-left`}
                style={toastStyle}
                onClick={() => revealDialer()}
              >
                {body}
              </button>
            );
          })}
        </div>
      )}

      {!poppedOut && (
        <div
          data-dialer-iframe-host=""
          data-testid="dialer-iframe-host"
          style={hostStyle}
          className={minimized
            ? 'bg-surface-raised'
            : 'bg-surface-raised/95 border border-white/10 shadow-[0_18px_48px_rgba(0,0,0,0.45)] rounded-2xl backdrop-blur-sm overflow-hidden'}
        >
          <div
            className="flex items-center justify-between px-3 py-1.5"
            style={{
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--surface-overlay) 88%, transparent), color-mix(in srgb, var(--surface-raised) 92%, transparent))',
              borderBottom: '1px solid color-mix(in srgb, var(--border-subtle) 70%, transparent)',
            }}
          >
            <span className="text-[11px] font-medium tracking-wide flex items-center gap-2 whitespace-nowrap text-rmpg-100">
              <span
                className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'animate-pulse' : ''}`}
                style={{ background: connected ? 'var(--sev-ok)' : 'var(--text-muted)', boxShadow: connected ? '0 0 8px var(--sev-ok)' : undefined }}
              />
              Dialer {connected ? 'Connected' : 'Sign in to answer'}
            </span>
            <div className="flex items-center gap-0.5">
              <a
                href={DIALER_APP_URL}
                target={DIALER_WINDOW_NAME}
                rel="opener"
                aria-label="Pop out Dial Connect"
                title="Opens Dial Connect in its own window and unloads the CAD iframe so only one Twilio Client is registered"
                className="inline-flex p-1 rounded-md text-rmpg-300 hover:text-white hover:bg-white/10"
                onClick={() => {
                  popupRef.current = window.open('', DIALER_WINDOW_NAME);
                  setPoppedOut(true);
                  setMinimized(false);
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                aria-label="Close Dial Connect"
                title="Hide in CAD — Twilio stays registered"
                className="inline-flex p-1 rounded-md text-rmpg-300 hover:text-white hover:bg-white/10"
                onClick={() => setMinimized(true)}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <iframe
            ref={iframeRef}
            title="Dial Connect"
            src={iframeSrcRef.current}
            className="w-full border-0 bg-transparent"
            style={{ height: 'calc(100% - 36px)' }}
            allow={DIALER_IFRAME_ALLOW}
            loading="eager"
          />
        </div>
      )}

      {minimized && !poppedOut && (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="bg-surface-raised/90 border border-white/10 px-3 py-2 text-[11px] font-medium tracking-wide flex items-center gap-2 rounded-full shadow-lg text-rmpg-100 hover:bg-surface-overlay"
          aria-label="Show Dial Connect"
          title="Show Dial Connect in CAD"
        >
          <PhoneCall className="w-3.5 h-3.5" />
          Dial Connect
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'animate-pulse' : ''}`}
            style={{ background: connected ? 'var(--sev-ok)' : 'var(--text-muted)' }}
          />
        </button>
      )}

      {poppedOut && (
        <div className="flex items-center gap-2">
          <a
            href={DIALER_APP_URL}
            target={DIALER_WINDOW_NAME}
            rel="opener"
            className="bg-surface-raised border border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5"
            aria-label={`Open dialer (${connected ? 'connected' : 'disconnected'})`}
            title="Keep the Dial Connect window open to answer inbound. Click to focus it."
          >
            <PhoneCall className="w-3.5 h-3.5" />
            Dialer
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: connected ? 'var(--sev-ok)' : 'var(--text-muted)' }}
            />
          </a>
          <button
            type="button"
            onClick={dockDialer}
            className="bg-surface-raised border border-border-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-rmpg-300 hover:text-white"
          >
            Back in CAD
          </button>
        </div>
      )}
    </div>
  );
}
