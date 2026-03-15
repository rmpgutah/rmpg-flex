import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { WSMessage, WSMessageType } from '../types';
import { useAuth } from './AuthContext';
import { devLog, devWarn } from '../utils/devLog';

type MessageHandler = (message: WSMessage) => void;

interface WebSocketContextType {
  isConnected: boolean;
  subscribe: (type: WSMessageType, handler: MessageHandler) => () => void;
  send: (message: WSMessage) => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

const WS_RECONNECT_DELAY = 3000;
const WS_MAX_RECONNECT_DELAY = 30000;

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { token, isAuthenticated } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Map<WSMessageType, Set<MessageHandler>>>(new Map());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(WS_RECONNECT_DELAY);
  const [isConnected, setIsConnected] = useState(false);

  // Ref mirror so onclose always reads the current auth state
  const isAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => { isAuthenticatedRef.current = isAuthenticated; }, [isAuthenticated]);

  const connect = useCallback(() => {
    if (!isAuthenticated || !token) return;

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const ws = new WebSocket(`${protocol}//${host}/ws?token=${token}`);

      ws.onopen = () => {
        setIsConnected(true);
        reconnectDelayRef.current = WS_RECONNECT_DELAY;
      };

      ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);

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
        setIsConnected(false);
        wsRef.current = null;

        // Auto-reconnect with backoff — use ref to avoid stale closure
        if (isAuthenticatedRef.current) {
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
    } catch {
      // WebSocket creation failed (e.g., invalid URL)
      setIsConnected(false);
    }
  }, [isAuthenticated, token]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      reconnectDelayRef.current = WS_RECONNECT_DELAY;
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

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
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Memoize the context value to prevent unnecessary re-renders
  // Only re-creates when isConnected changes (connect/disconnect events)
  const contextValue = useMemo(() => ({
    isConnected,
    subscribe,
    send,
  }), [isConnected, subscribe, send]);

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
