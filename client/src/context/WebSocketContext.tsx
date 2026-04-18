import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { WSMessage, WSMessageType } from '../types';
import { useAuth } from './AuthContext';
import { devLog, devWarn } from '../utils/devLog';
import { handleDispatchEvent, startBrainTimer } from '../utils/dispatcherBrain';
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

const WS_RECONNECT_DELAY = 3000;
const WS_MAX_RECONNECT_DELAY = 30000;
const WS_CONNECT_TIMEOUT = 10000; // 10s — if WS hasn't opened by then, close and retry
const WS_MAX_RETRIES = 50;        // stop retrying after 50 consecutive failures (~25min at max backoff)
const WS_HEARTBEAT_INTERVAL = 30000; // 30s ping interval
const WS_PONG_TIMEOUT = 10000;       // 10s to receive pong before considering connection dead

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Map<WSMessageType, Set<MessageHandler>>>(new Map());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(WS_RECONNECT_DELAY);
  const retryCountRef = useRef(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);

  const connect = useCallback(() => {
    if (!isAuthenticated || !token) return;

    // Clear any pending reconnect to prevent dual connections
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Clean up existing connection — null out handlers BEFORE closing
    // to prevent the old onclose from clobbering wsRef or scheduling stale reconnects
    if (wsRef.current) {
      const old = wsRef.current;
      old.onclose = null;
      old.onmessage = null;
      old.onerror = null;
      old.onopen = null;
      old.close();
      wsRef.current = null;
    }

    // Don't retry if we've exceeded max retries — wait for visibility change to reset
    if (retryCountRef.current >= WS_MAX_RETRIES) {
      devWarn(`[WS] Max retries (${WS_MAX_RETRIES}) reached — waiting for tab focus to retry`);
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      // Message-based auth: connect without URL token, then send authenticate
      // frame on open. URL-token auth was deprecated 2026-04-15 to prevent JWT
      // leakage via server logs, browser history, and referrer headers.
      const ws = new WebSocket(`${protocol}//${host}/ws`);

      // Connection timeout — if the socket hasn't opened in 10s, kill it and retry.
      // Without this, a stalled TCP handshake can hang the socket indefinitely.
      connectTimeoutRef.current = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          devWarn('[WS] Connection timeout — closing stalled socket');
          ws.onclose = null; // prevent the regular onclose from also scheduling a reconnect
          ws.close();
          wsRef.current = null;
          setIsConnected(false);
          retryCountRef.current++;
          // Schedule reconnect with backoff
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 1.5, WS_MAX_RECONNECT_DELAY);
            connect();
          }, reconnectDelayRef.current);
        }
      }, WS_CONNECT_TIMEOUT);

      ws.onopen = () => {
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        setIsConnected(true);
        setConnectionLost(false);
        reconnectDelayRef.current = WS_RECONNECT_DELAY;
        retryCountRef.current = 0; // reset on successful connection

        // Message-based authentication: send the JWT as the first frame.
        // Server expects { type: 'authenticate', token } and will close the
        // socket after a short timeout if this doesn't arrive.
        try {
          ws.send(JSON.stringify({ type: 'authenticate', token }));
        } catch (err) {
          devWarn('[WS] Failed to send auth frame:', err);
        }

        // Start heartbeat ping/pong
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
            // Clear any previous pong timeout before setting a new one
            if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
            // If no pong within 10s, connection is dead — close and reconnect
            pongTimeoutRef.current = setTimeout(() => {
              devWarn('[WS] Pong timeout — closing dead connection');
              ws.close();
            }, WS_PONG_TIMEOUT);
          }
        }, WS_HEARTBEAT_INTERVAL);
      };

      ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);

          // Handle pong — clear the dead-connection timeout
          if (message.type === 'pong') {
            if (pongTimeoutRef.current) {
              clearTimeout(pongTimeoutRef.current);
              pongTimeoutRef.current = null;
            }
            return;
          }

          // Handle authentication responses internally
          if (message.type === 'authenticated') {
            devLog('[WS] Authenticated successfully');
            return;
          }
          if (message.type === 'auth_error') {
            devWarn('[WS] Authentication failed:', (message as any).message);
            // Reconnect will use fresh token
            ws.close();
            return;
          }

          // Play alert tone for high-priority calls (P1/P2)
          if ((message.type as string) === 'calls:created' || (message.type as string) === 'calls:updated') {
            const payload = (message as any).data || (message as any).call || message;
            const priority = payload?.priority;
            if (priority === 'P1' || priority === 'P2') {
              try {
                const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
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
          }

          // Dispatcher Brain fan-in: any dispatch_update carries an
          // action discriminator the brain uses to match rules. No-op
          // when the per-user brain flag is off, so this is safe to
          // wire unconditionally.
          if ((message.type as string) === 'dispatch_update') {
            const data = (message as any).data;
            if (data && typeof data.action === 'string') {
              try {
                handleDispatchEvent(data.action, data);
              } catch (err) {
                console.error('[Brain] handleDispatchEvent error:', err);
              }
            }
          }

          // Broadcast to type-specific subscribers only — no global state update
          // This avoids re-rendering every component on every WS message
          const handlers = subscribersRef.current.get(message.type);
          if (handlers) {
            handlers.forEach((handler) => {
              try {
                handler(message);
              } catch (err) {
                console.error('WebSocket handler error:', err);
              }
            });
          }
        } catch (err) {
          console.error('WebSocket message parse error:', err);
        }
      };

      ws.onclose = () => {
        // Only handle if this is still the active WebSocket
        if (wsRef.current !== ws) return;

        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        // Clean up heartbeat
        if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
        if (pongTimeoutRef.current) { clearTimeout(pongTimeoutRef.current); pongTimeoutRef.current = null; }

        setIsConnected(false);
        wsRef.current = null;
        retryCountRef.current++;

        // Signal permanent connection loss after max retries
        if (retryCountRef.current >= WS_MAX_RETRIES) {
          setConnectionLost(true);
        }

        // Auto-reconnect with backoff
        if (isAuthenticated) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current * 1.5,
              WS_MAX_RECONNECT_DELAY
            );
            connect();
          }, reconnectDelayRef.current);
        }
      };

      ws.onerror = () => {
        // Error will trigger onclose which handles reconnection
      };

      wsRef.current = ws;
    } catch (err) {
      console.warn('[WebSocket] Connection creation failed:', err);
      setIsConnected(false);
    }
  }, [isAuthenticated, token]);

  useEffect(() => {
    connect();

    // When tab becomes visible again, reset retry count and reconnect immediately
    // Patrol officers often switch between apps — instant reconnect on return is critical
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isAuthenticated && !wsRef.current) {
        retryCountRef.current = 0;
        reconnectDelayRef.current = WS_RECONNECT_DELAY;
        connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (pongTimeoutRef.current) clearTimeout(pongTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect, isAuthenticated]);

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
