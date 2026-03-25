// ============================================================
// RMPG Flex — usePresence Hook
// Tracks which users are currently online and connected.
// Receives real-time updates via WebSocket when users connect/disconnect.
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { apiFetch } from './useApi';
import type { WSMessage, PresenceUser } from '../types';

export function usePresence() {
  const { subscribe, isConnected } = useWebSocket();
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [count, setCount] = useState(0);

  const handlePresenceUpdate = useCallback((message: WSMessage) => {
    const data = (message as any).data;
    if (data?.users) {
      setUsers(data.users);
      setCount(data.count || data.users.length);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribe('presence_update', handlePresenceUpdate);
    return unsubscribe;
  }, [subscribe, handlePresenceUpdate]);

  // Fetch initial presence on mount
  useEffect(() => {
    if (!isConnected) return;
    const controller = new AbortController();

    apiFetch<{ users: PresenceUser[]; count?: number }>('/presence', { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted && data?.users) {
          setUsers(data.users);
          setCount(data.count || data.users.length);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!controller.signal.aborted) console.warn('[usePresence] fetch presence failed:', err);
      });

    return () => { controller.abort(); };
  }, [isConnected]);

  return { users, count, isConnected };
}

export default usePresence;
