import { useEffect, useRef } from 'react';

export type DialerStreamEvent =
  | { type: 'call_status'; callSid: string; status: string }
  | { type: 'duress_alert'; dispatcherName: string; timestamp?: string }
  | { type: string; [k: string]: unknown };

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const STREAM_PATH = '/api/dialer/stream';

function readToken(): string | null {
  try { return localStorage.getItem('rmpg_token'); } catch { return null; }
}

// EventSource cannot carry the Authorization: Bearer header the API requires,
// so this consumes the SSE body via fetch + a streaming reader instead.
export async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) onData(data);
    }
  }
}

/** One SSE connection to /api/dialer/stream with reconnect backoff. */
export function useDialerStream(onEvent: (e: DialerStreamEvent) => void, enabled = true) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let closed = false;

    const schedule = () => {
      if (closed) return;
      timer = setTimeout(open, BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]);
    };

    const open = async () => {
      controller = new AbortController();
      const token = readToken();
      try {
        const res = await fetch(STREAM_PATH, {
          headers: { accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) { schedule(); return; }
        attempt = 0;
        await consumeSse(res.body, (data) => {
          try { handler.current(JSON.parse(data) as DialerStreamEvent); } catch { /* keepalive / non-JSON */ }
        }, controller.signal);
      } catch {
        /* aborted or network error — fall through to reconnect */
      }
      schedule();
    };

    void open();
    return () => { closed = true; controller?.abort(); if (timer) clearTimeout(timer); };
  }, [enabled]);
}
