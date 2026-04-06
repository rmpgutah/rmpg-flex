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
<<<<<<< HEAD
    let cancelled = false;
=======
    const controller = new AbortController();
>>>>>>> origin/main

    apiFetch<{ users: PresenceUser[]; count?: number }>('/presence', { signal: controller.signal })
      .then(data => {
<<<<<<< HEAD
        if (!cancelled && data?.users) {
=======
        if (!controller.signal.aborted && data?.users) {
>>>>>>> origin/main
          setUsers(data.users);
          setCount(data.count || data.users.length);
        }
      })
      .catch((err) => {
<<<<<<< HEAD
        if (!cancelled) console.warn('[usePresence] fetch presence failed:', err);
      });

    return () => { cancelled = true; };
=======
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!controller.signal.aborted) console.warn('[usePresence] fetch presence failed:', err);
      });

    return () => { controller.abort(); };
>>>>>>> origin/main
  }, [isConnected]);

  return { users, count, isConnected };
}

export default usePresence;
