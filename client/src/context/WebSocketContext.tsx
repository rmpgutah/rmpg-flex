import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { WSMessage, WSMessageType } from '../types';
import { useAuth } from './AuthContext';
import { devLog, devWarn } from '../utils/devLog';
import { handleDispatchEvent, startBrainTimer } from '../utils/dispatcherBrain';
import { apiWsBase } from '../utils/apiOrigin';
import {
  announceGpsGap,
  announceGpsRecovered,
  announcePursuitSpeed,
  announceBeatBreach,
} from '../utils/voiceAlerts';
import { flashAlert, flashSeverityFor } from '../utils/alertFlash';
import { isAlertSoundEnabled } from '../utils/alertSoundPrefs';
import { trackCriticalAlert, alertKey } from '../utils/alertEscalation';
import { registerRules } from '../utils/dispatcherRules/registry';
import { EVENT_RULES } from '../utils/dispatcherRules/events';
import { COACHING_RULES } from '../utils/dispatcherRules/coaching';

// Register the Dispatcher Brain rule catalog once at module load.
// - EVENT_RULES: Phase 2 event fan-in (citations, incidents, warrants,
//   evidence, arrests, HR).
// - COACHING_RULES: Phase 3 proactive guidance (DV approach, felony
//   backup, MH protocol, geofence breach, overdue-status timer).
// Registry is a module-level array that only grows at boot; duplicates
// from hot-reload are harmless because ruleId+entityKey cooldown in
// speakQueue dedupes them.
registerRules(EVENT_RULES);
registerRules(COACHING_RULES);

// Start the Dispatcher Brain 30s tick so timer-triggered rules
// (e.g. overdue-status-check) have a pulse. tickTimers() is itself
// flag-gated so this is a no-op for users who haven't opted in.
startBrainTimer();

type MessageHandler = (message: WSMessage) => void;

interface WebSocketContextType {
  isConnected: boolean;
  connectionLost: boolean;
  subscribe: (type: WSMessageType, handler: MessageHandler) => () => void;
  send: (message: WSMessage) => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

const WS_RECONNECT_DELAY = 2000;
const WS_MAX_RECONNECT_DELAY = 10000;
const WS_CONNECT_TIMEOUT = 15000; // 15s — cellular can be slow
const WS_MAX_RETRIES = 100;       // keep trying for the full shift
const WS_HEARTBEAT_INTERVAL = 30000; // 30s ping interval
const WS_PONG_TIMEOUT = 20000;       // 20s — generous for cellular hand-offs
const WS_OFFLINE_GRACE_MS = 5000; // delay before showing OFFLINE in status bar

// dispatch_update action discriminators that carry a unit (not a call). These
// get re-fanned to the legacy 'unit_update' channel (see onmessage) so the map,
// MDT, mobile unit card, and recommended-units panel — which subscribe to
// 'unit_update' — receive live unit changes. The Worker only ever emits
// 'dispatch_update'; without this bridge those four surfaces were dead.
const UNIT_ACTIONS = new Set<string>([
  'unit_status_changed', 'unit_position_update', 'unit_created', 'unit_updated',
  'unit_deleted', 'unit_assigned', 'unit_unassigned', 'units_dispatched',
]);

// Audible chime for an incoming high-priority (P1/P2) call. Extracted from the
// inline onmessage handler so it can fire from the dispatch_update branch: the
// live Worker delivers new calls as dispatch_update/call_created — it never
// emits a 'calls:created' message type (see broadcastAll in src/routes/ws.ts),
// so the previous type-keyed alert never played.
// One reused AudioContext for the chime. Creating a fresh AudioContext per call
// (the old behavior) leaked one each time — Chrome caps hardware contexts (~6)
// and then throws, silently killing the chime partway through a busy shift.
let chimeCtx: AudioContext | null = null;
function getChimeCtx(): AudioContext | null {
  try {
    if (!chimeCtx) chimeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (chimeCtx.state === 'suspended') void chimeCtx.resume().catch(() => {});
    return chimeCtx;
  } catch { return null; }
}

function playPriorityChime(priority: string | undefined): void {
  if (priority !== 'P1' && priority !== 'P2') return;
  // Respect the global sound mute (the same 'rmpg-sound' key the voice-alert
  // layer + edgeTTS honor) — the chime used to fire even when alerts were muted.
  try { if (localStorage.getItem('rmpg-sound') === 'false') return; } catch { /* no storage */ }
  const ctx = getChimeCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = priority === 'P1' ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(priority === 'P1' ? 880 : 660, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
    if (priority === 'P1') {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = 'square';
      osc2.frequency.setValueAtTime(1100, ctx.currentTime + 0.15);
      gain2.gain.setValueAtTime(0.15, ctx.currentTime + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc2.start(ctx.currentTime + 0.15);
      osc2.stop(ctx.currentTime + 0.6);
    }
  } catch { /* Audio not available */ }
}

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Map<WSMessageType, Set<MessageHandler>>>(new Map());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timestamp of the most recent `new WebSocket(...)`, used to tell a socket
  // that is legitimately still handshaking from one that has stalled.
  const connectStartedAtRef = useRef(0);
  const reconnectDelayRef = useRef(WS_RECONNECT_DELAY);
  const retryCountRef = useRef(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);

  // Stable refs so connect/connectAlerts don't recreate on token changes
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const authRef = useRef(isAuthenticated);
  authRef.current = isAuthenticated;

  const markConnected = useCallback(() => {
    if (offlineGraceRef.current) { clearTimeout(offlineGraceRef.current); offlineGraceRef.current = null; }
    setIsConnected(true);
    setConnectionLost(false);
  }, []);

  const markDisconnected = useCallback(() => {
    if (offlineGraceRef.current) return;
    offlineGraceRef.current = setTimeout(() => {
      offlineGraceRef.current = null;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setIsConnected(false);
      }
    }, WS_OFFLINE_GRACE_MS);
  }, []);

  // ── Second socket: the agency-wide Alert Hub ──────────────────────────
  const alertsRef = useRef<WebSocket | null>(null);
  const alertsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alertsDelayRef = useRef(WS_RECONNECT_DELAY);
  const alertsHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alertsRetryCountRef = useRef(0);

  // Shared fan-in: dispatch a parsed WS frame to the brain, the priority
  // chime, the legacy unit_update bridge, and the type-keyed subscribers.
  // Called by BOTH sockets so an event delivered over either path behaves
  // identically. Stable (reads refs/module-level helpers only).
  const fanInMessage = useCallback((message: WSMessage) => {
    if ((message.type as string) === 'dispatch_update') {
      const data = (message as any).data || (message as any);
      if (data && typeof data.action === 'string') {
        if (data.action === 'call_created') playPriorityChime(data.call?.priority);
        try { handleDispatchEvent(data.action, data); }
        catch (err) { console.error('[Brain] handleDispatchEvent error:', err); }
        if (UNIT_ACTIONS.has(data.action)) {
          const unitHandlers = subscribersRef.current.get('unit_update' as WSMessageType);
          if (unitHandlers) {
            unitHandlers.forEach((handler) => {
              try { handler(message); } catch (err) { console.error('WS unit_update fan-out error:', err); }
            });
          }
        }
      }
    }
    const handlers = subscribersRef.current.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try { handler(message); } catch (err) { console.error('WebSocket handler error:', err); }
      });
    }
  }, []);

  const connect = useCallback(() => {
    if (!authRef.current || !tokenRef.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      markDisconnected();
      return;
    }

    // Idempotence guard. Four independent triggers call connect() — mount,
    // window 'focus', 'online', and visibilitychange — and on a laptop waking
    // from sleep they can all fire inside the same second. Without this, each
    // call tore down the previous socket via the close-old-socket block below;
    // closing one still in CONNECTING is exactly what produces Chrome's
    // "WebSocket is closed before the connection is established" warning.
    const existing = wsRef.current;
    if (existing) {
      // An OPEN socket is never replaced here. Liveness is deliberately NOT
      // re-checked: readyState still reads OPEN on a half-open socket after a
      // cellular hand-off, and the heartbeat's pong timeout already owns that
      // case — it closes the socket, and onclose routes back into reconnect.
      if (existing.readyState === WebSocket.OPEN) return;
      // A CONNECTING socket is left to finish its handshake, but only until it
      // goes stale — otherwise a genuinely wedged connect would block every
      // reconnect trigger until WS_CONNECT_TIMEOUT fired on its own.
      if (
        existing.readyState === WebSocket.CONNECTING &&
        Date.now() - connectStartedAtRef.current < WS_CONNECT_TIMEOUT
      ) {
        return;
      }
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      const old = wsRef.current;
      old.onclose = null;
      old.onmessage = null;
      old.onerror = null;
      old.onopen = null;
      old.close();
      wsRef.current = null;
    }

    if (retryCountRef.current >= WS_MAX_RETRIES) {
      devWarn(`[WS] Max retries (${WS_MAX_RETRIES}) reached — waiting for tab focus to retry`);
      setConnectionLost(true);
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const ws = new WebSocket(`${protocol}//${host}/api/ws`);
      connectStartedAtRef.current = Date.now();

      connectTimeoutRef.current = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          devWarn('[WS] Connection timeout — closing stalled socket');
          ws.onclose = null;
          ws.close();
          wsRef.current = null;
          markDisconnected();
          retryCountRef.current++;
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectDelayRef.current = Math.min(reconnectDelayRef.current + 2000, WS_MAX_RECONNECT_DELAY);
            connect();
          }, reconnectDelayRef.current);
        }
      }, WS_CONNECT_TIMEOUT);

      ws.onopen = () => {
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        const wasDisconnected = connectionLost;
        markConnected();
        reconnectDelayRef.current = WS_RECONNECT_DELAY;
        retryCountRef.current = 0;

        if (wasDisconnected && typeof window !== 'undefined') {
          try { window.dispatchEvent(new CustomEvent('rmpg:ws-reconnected')); } catch { /* silent */ }
        }

        try {
          ws.send(JSON.stringify({ type: 'authenticate', token: tokenRef.current }));
        } catch (err) {
          devWarn('[WS] Failed to send auth frame:', err);
        }

        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
            if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
            pongTimeoutRef.current = setTimeout(() => {
              if (wsRef.current === ws) {
                devWarn('[WS] Pong timeout — closing dead connection');
                ws.close();
              }
            }, WS_PONG_TIMEOUT);
          }
        }, WS_HEARTBEAT_INTERVAL);
      };

      ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);

          if (message.type === 'pong') {
            if (pongTimeoutRef.current) {
              clearTimeout(pongTimeoutRef.current);
              pongTimeoutRef.current = null;
            }
            return;
          }

          if (message.type === 'authenticated') {
            devLog('[WS] Authenticated successfully');
            return;
          }
          if (message.type === 'auth_error') {
            devWarn('[WS] Authentication failed:', (message as any).message);
            ws.close();
            return;
          }

          fanInMessage(message);
        } catch (err) {
          console.error('WebSocket message parse error:', err);
        }
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return;

        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
        if (pongTimeoutRef.current) { clearTimeout(pongTimeoutRef.current); pongTimeoutRef.current = null; }

        wsRef.current = null;
        retryCountRef.current++;
        markDisconnected();

        if (retryCountRef.current >= WS_MAX_RETRIES) {
          setConnectionLost(true);
        }

        if (authRef.current && (typeof navigator === 'undefined' || navigator.onLine)) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current + 2000,
              WS_MAX_RECONNECT_DELAY
            );
            connect();
          }, reconnectDelayRef.current);
        }
      };

      ws.onerror = () => {
        // Chrome already logs "WebSocket connection to 'wss://…' failed".
        // Don't duplicate it — especially while offline.
      };

      wsRef.current = ws;
    } catch (err) {
      console.warn('[WebSocket] Connection creation failed:', err);
      markDisconnected();
    }
  }, [fanInMessage, markConnected, markDisconnected]);

  // Connect the agency-wide Alert Hub socket (rewrite worker, direct). Kept
  // deliberately lean vs. the main socket: no UI connection state, light
  // reconnect, a 30s keepalive ping so Cloudflare doesn't idle-close it. All
  // inbound frames flow through the shared fanInMessage bus.
  const connectAlerts = useCallback(() => {
    if (!authRef.current || !tokenRef.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const existing = alertsRef.current;
    if (existing) {
      if (existing.readyState === WebSocket.OPEN) return;
      if (existing.readyState === WebSocket.CONNECTING) return;
    }
    if (alertsReconnectRef.current) { clearTimeout(alertsReconnectRef.current); alertsReconnectRef.current = null; }
    if (alertsRef.current) {
      const old = alertsRef.current;
      old.onclose = null; old.onmessage = null; old.onerror = null; old.onopen = null;
      old.close();
      alertsRef.current = null;
    }
    try {
      const ws = new WebSocket(`${apiWsBase()}/api/alerts-ws`);

      ws.onopen = () => {
        alertsDelayRef.current = WS_RECONNECT_DELAY;
        alertsRetryCountRef.current = 0;
        try { ws.send(JSON.stringify({ type: 'authenticate', token: tokenRef.current })); } catch { /* retried on reconnect */ }
        if (alertsHeartbeatRef.current) clearInterval(alertsHeartbeatRef.current);
        alertsHeartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }
          }
        }, WS_HEARTBEAT_INTERVAL);
      };

      ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          const t = message.type as string;
          if (t === 'pong' || t === 'alerts_ready') return;
          if (t === 'alerts_auth_error') { ws.close(); return; }
          fanInMessage(message);
        } catch (err) {
          console.error('[AlertWS] message parse error:', err);
        }
      };

      ws.onclose = () => {
        if (alertsRef.current !== ws) return;
        if (alertsHeartbeatRef.current) { clearInterval(alertsHeartbeatRef.current); alertsHeartbeatRef.current = null; }
        alertsRef.current = null;
        alertsRetryCountRef.current++;
        if (alertsRetryCountRef.current >= WS_MAX_RETRIES) {
          devWarn(`[AlertWS] Max retries (${WS_MAX_RETRIES}) reached`);
          return;
        }
        if (authRef.current && (typeof navigator === 'undefined' || navigator.onLine)) {
          alertsReconnectRef.current = setTimeout(() => {
            alertsDelayRef.current = Math.min(alertsDelayRef.current + 2000, WS_MAX_RECONNECT_DELAY);
            connectAlerts();
          }, alertsDelayRef.current);
        }
      };

      ws.onerror = () => { /* Chrome already logs the failed wss:// handshake */ };
      alertsRef.current = ws;
    } catch (err) {
      console.warn('[AlertWS] Connection creation failed:', err);
    }
  }, [fanInMessage]);

  // Shared by the connect effect below (window 'focus') and the recovery effect
  // further down ('visibilitychange'). Declared BEFORE the first effect that
  // uses it: a useEffect deps array is evaluated during render, so naming it in
  // the deps of an earlier effect would hit the temporal dead zone.
  const handleVisibility = useCallback(() => {
    if (document.visibilityState === 'visible' && authRef.current) {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        retryCountRef.current = 0;
        reconnectDelayRef.current = WS_RECONNECT_DELAY;
        connect();
      }
      if (!alertsRef.current || alertsRef.current.readyState !== WebSocket.OPEN) {
        alertsRetryCountRef.current = 0;
        alertsDelayRef.current = WS_RECONNECT_DELAY;
        connectAlerts();
      }
    }
  }, [connect, connectAlerts]);

  // Connect on login, tear down on logout. Token is read from ref so refreshes
  // don't cause a full reconnect cycle (which was a guaranteed OFFLINE flash).
  useEffect(() => {
    if (!isAuthenticated) return;
    connect();
    connectAlerts();

    // Also probe on window focus — covers the case of multi-monitor
    // setups where the tab was technically visible but the dispatcher
    // had focus on another window for hours. Cheap and idempotent.
    window.addEventListener('focus', handleVisibility);

    return () => {
      // Must mirror the addEventListener above. Omitting this leaked one focus
      // listener per effect re-run (the deps include two useCallback
      // identities), and every leaked listener independently called connect().
      window.removeEventListener('focus', handleVisibility);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
      if (offlineGraceRef.current) clearTimeout(offlineGraceRef.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
      if (alertsReconnectRef.current) clearTimeout(alertsReconnectRef.current);
      if (alertsHeartbeatRef.current) clearInterval(alertsHeartbeatRef.current);
      if (alertsRef.current) { alertsRef.current.onclose = null; alertsRef.current.close(); alertsRef.current = null; }
      setIsConnected(false);
    };
    // token intentionally omitted — read via tokenRef so refreshes don't
    // tear down + reconnect (which causes an OFFLINE flash every ~15min)
  }, [isAuthenticated, connect, connectAlerts, handleVisibility]);

  // Visibility + online recovery — separate effect so it doesn't tear down sockets
  useEffect(() => {
    const handleOnline = () => {
      if (!authRef.current) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        retryCountRef.current = 0;
        reconnectDelayRef.current = WS_RECONNECT_DELAY;
        connect();
      }
      if (!alertsRef.current || alertsRef.current.readyState !== WebSocket.OPEN) {
        alertsRetryCountRef.current = 0;
        alertsDelayRef.current = WS_RECONNECT_DELAY;
        connectAlerts();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);

    // Electron connectivity monitor — when the desktop shell detects the
    // health endpoint is reachable again after a confirmed outage, trigger
    // an immediate WebSocket reconnect instead of waiting for the next
    // backoff cycle. Critical for MDT in vehicles with flaky cellular.
    const electron = (window as any).electron;
    let unsubElectron: (() => void) | null = null;
    if (electron?.onConnectivityChange) {
      unsubElectron = electron.onConnectivityChange((data: { isOnline: boolean }) => {
        if (data.isOnline) handleOnline();
      });
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      if (unsubElectron) unsubElectron();
    };
  }, [connect, connectAlerts, handleVisibility]);

  const subscribe = useCallback((type: WSMessageType, handler: MessageHandler) => {
    if (!subscribersRef.current.has(type)) {
      subscribersRef.current.set(type, new Set());
    }
    subscribersRef.current.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = subscribersRef.current.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          subscribersRef.current.delete(type);
        }
      }
    };
  }, []);

  const send = useCallback((message: WSMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  // Memoize the context value to prevent unnecessary re-renders
  // Only re-creates when isConnected or connectionLost changes
  const contextValue = useMemo(() => ({
    isConnected,
    connectionLost,
    subscribe,
    send,
  }), [isConnected, connectionLost, subscribe, send]);

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket(): WebSocketContextType {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}

export default WebSocketContext;
