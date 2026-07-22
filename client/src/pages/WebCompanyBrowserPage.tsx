// ============================================================
// RMPG Flex — Web Company Browser (Phase 1)
// Non-Electron path for Company Browser: streams a real headless
// Chrome session (server-side, via WebBrowserSessionDO) onto a
// <canvas>, forwarding pointer/keyboard input back over the same
// WebSocket. See docs/superpowers/specs/2026-07-22-web-company-browser-phase1-design.md.
// No tabs/bookmarks/history in this phase — single session only.
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';

// Same localStorage key every other client (useApi.ts, WebSocketContext.tsx)
// reads the JWT from.
const TOKEN_STORAGE_KEY = 'rmpg_token';

// Same dev/prod WS host-branching this codebase already uses for its other
// direct-to-rewrite-worker sockets (see client/src/utils/voiceWs.ts and the
// alerts socket in client/src/context/WebSocketContext.tsx) — mirrored here
// rather than reusing voiceWsUrl(), which is voice-room-specific (`?room=`).
function resolveWsBaseUrl(): string {
  const host = window.location.hostname;
  return (host === 'localhost' || host === '127.0.0.1')
    ? `ws://${host}:8787`
    : 'wss://api.rmpgutah.us';
}

export default function WebCompanyBrowserPage() {
  const [addressInput, setAddressInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ sessionId: string }>('/web-browser/session', { method: 'POST' }).then((res) => {
      if (cancelled) return;
      const token = localStorage.getItem(TOKEN_STORAGE_KEY) || '';
      const ws = new WebSocket(`${resolveWsBaseUrl()}/api/web-browser-ws?sessionId=${res.sessionId}`);
      socketRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'authenticate', token }));
      };

      ws.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'frame') {
          const img = new Image();
          img.onload = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            canvas.width = img.width;
            canvas.height = img.height;
            canvas.getContext('2d')?.drawImage(img, 0, 0);
          };
          img.src = `data:image/jpeg;base64,${msg.data}`;
        } else if (msg.type === 'error') {
          setError(msg.message);
        } else if (msg.type === 'session_ended') {
          setSessionEnded(msg.reason);
        }
      };

      ws.onclose = () => { socketRef.current = null; };
    }).catch(() => setError('Unable to start browser session, try again.'));

    return () => { cancelled = true; socketRef.current?.close(); };
  }, []);

  const send = useCallback((obj: unknown) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(obj));
  }, []);

  const handleAddressSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    send({ type: 'navigate', url: addressInput });
  }, [addressInput, send]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    send({ type: 'click', x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, [send]);

  if (sessionEnded) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: 'var(--surface-base)', color: 'var(--text-primary)' }}>
        Session ended due to inactivity. Reload to start a new one.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--surface-base)' }}>
      <form onSubmit={handleAddressSubmit} className="flex items-center gap-1 px-2 py-1" style={{ background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-subtle)' }}>
        <input
          type="text"
          role="textbox"
          aria-label="Address"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          placeholder="Enter a URL"
          className="flex-1 px-2 py-1 text-[11px]"
          style={{ background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
        />
      </form>
      <div className="flex-1 relative">
        <canvas ref={canvasRef} onClick={handleCanvasClick} style={{ width: '100%', height: '100%' }} />
        {error && (
          <div role="alert" style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '8px 12px', background: 'var(--sev-critical)', color: 'var(--text-primary)', fontSize: 11 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
