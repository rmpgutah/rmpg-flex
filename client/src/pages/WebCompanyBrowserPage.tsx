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
  // Tracks whether any message (frame/error/session_ended) has ever been
  // received on the current socket — used to tell a normal graceful close
  // (after session_ended) apart from an unexpected early close, so we only
  // surface an error banner for the latter.
  const receivedAnyMessageRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ sessionId: string }>('/web-browser/session', { method: 'POST' }).then((res) => {
      if (cancelled) return;
      const token = localStorage.getItem(TOKEN_STORAGE_KEY) || '';
      const ws = new WebSocket(`${resolveWsBaseUrl()}/api/web-browser-ws?sessionId=${res.sessionId}`);
      socketRef.current = ws;
      receivedAnyMessageRef.current = false;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'authenticate', token }));
      };

      ws.onerror = () => {
        setError('Unable to start browser session, try again.');
      };

      ws.onmessage = (ev) => {
        receivedAnyMessageRef.current = true;
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

      ws.onclose = () => {
        socketRef.current = null;
        if (!cancelled && !receivedAnyMessageRef.current) {
          setError('Unable to start browser session, try again.');
        }
      };
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
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    // The canvas's intrinsic bitmap resolution (canvas.width/height) is set to the
    // remote frame's pixel dimensions, but its on-screen box is CSS-styled to fill
    // the flex container (width/height: 100%) — those two sizes generally differ.
    // Scale the CSS-relative click point up to intrinsic canvas pixels before
    // sending, or every click lands at the wrong spot on the real remote page.
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    send({ type: 'click', x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY });
  }, [send]);

  const handleCanvasKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    let text = '';
    if (e.key.length === 1) {
      text = e.key;
    } else if (e.key === 'Enter') {
      text = '\n';
    } else if (e.key === 'Backspace') {
      text = '\b';
    } else {
      return;
    }
    e.preventDefault();
    send({ type: 'type', text });
  }, [send]);

  const handleCanvasWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    send({ type: 'scroll', dx: e.deltaX, dy: e.deltaY });
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
        <canvas
          ref={canvasRef}
          tabIndex={0}
          onClick={handleCanvasClick}
          onKeyDown={handleCanvasKeyDown}
          onWheel={handleCanvasWheel}
          style={{ width: '100%', height: '100%' }}
        />
        {error && (
          <div role="alert" style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '8px 12px', background: 'var(--sev-critical)', color: 'var(--text-primary)', fontSize: 11 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
