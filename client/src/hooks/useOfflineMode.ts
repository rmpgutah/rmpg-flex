import { useState, useEffect, useCallback, useRef } from 'react';

// Access window.electron safely (only present in Electron desktop app)
const electron = typeof window !== 'undefined' ? (window as any).electron : null;

export interface OfflineState {
  isOffline: boolean;
  isLocalAuthorized: boolean;
  pinExpiresAt: string | null;
  syncQueueDepth: number;
  userRole: string | null;
}

export interface SyncStatus {
  phase: 'idle' | 'pull' | 'push';
  table: string;
  current: number;
  total: number;
}

/**
 * React hook exposing the Electron offline mode state.
 *
 * Subscribes to IPC events from the main process for:
 * - connectivity changes  (online ↔ offline)
 * - sync progress         (pull/push table progress)
 * - PIN session expiry    (24h window closed)
 * - authorization changes (PIN entered / expired)
 *
 * All no-ops when running in the browser (non-Electron).
 */
export function useOfflineMode() {
  const [state, setState] = useState<OfflineState>({
    isOffline: false,
    isLocalAuthorized: false,
    pinExpiresAt: null,
    syncQueueDepth: 0,
    userRole: null,
  });

  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    phase: 'idle',
    table: '',
    current: 0,
    total: 0,
  });

  const [syncComplete, setSyncComplete] = useState<{ pulled: number; pushed: number; errors: number } | null>(null);

  // Dismiss timer for sync-complete notification
  const syncCompleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch initial state ──────────────────────────────────────
  const refreshState = useCallback(async () => {
    if (!electron?.getOfflineState) return;
    try {
      const s = await electron.getOfflineState();
      setState({
        isOffline: !s.isOnline,
        isLocalAuthorized: !!s.isLocalAuthorized,
        pinExpiresAt: s.expiresAt || null,
        syncQueueDepth: s.syncQueueDepth || 0,
        userRole: s.role || null,
      });
    } catch { /* ignore — not in Electron */ }
  }, []);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  // ── Subscribe to IPC events ──────────────────────────────────
  useEffect(() => {
    if (!electron) return;
    const unsubs: (() => void)[] = [];

    if (electron.onConnectivityChange) {
      unsubs.push(
        electron.onConnectivityChange((online: boolean) => {
          setState(prev => ({ ...prev, isOffline: !online }));
          // Refresh full state when connectivity changes
          refreshState();
        })
      );
    }

    if (electron.onSyncProgress) {
      unsubs.push(
        electron.onSyncProgress((data: any) => {
          setSyncStatus({
            phase: data.phase || 'pull',
            table: data.table || '',
            current: data.current || 0,
            total: data.total || 0,
          });
        })
      );
    }

    if (electron.onSyncComplete) {
      unsubs.push(
        electron.onSyncComplete((data: any) => {
          setSyncStatus({ phase: 'idle', table: '', current: 0, total: 0 });
          setSyncComplete({
            pulled: data.pulled || 0,
            pushed: data.pushed || 0,
            errors: data.errors || 0,
          });
          // Auto-dismiss after 5 seconds
          if (syncCompleteTimer.current) clearTimeout(syncCompleteTimer.current);
          syncCompleteTimer.current = setTimeout(() => setSyncComplete(null), 5000);
          // Refresh state (queue depth may have changed)
          refreshState();
        })
      );
    }

    if (electron.onPinExpired) {
      unsubs.push(
        electron.onPinExpired(() => {
          setState(prev => ({ ...prev, isLocalAuthorized: false, pinExpiresAt: null }));
        })
      );
    }

    if (electron.onAuthorizationChanged) {
      unsubs.push(
        electron.onAuthorizationChanged((data: any) => {
          setState(prev => ({
            ...prev,
            isLocalAuthorized: !!data.isLocalAuthorized,
            pinExpiresAt: data.expiresAt || null,
          }));
        })
      );
    }

    return () => {
      unsubs.forEach(fn => fn());
      if (syncCompleteTimer.current) clearTimeout(syncCompleteTimer.current);
    };
  }, [refreshState]);

  // ── Actions ──────────────────────────────────────────────────

  const enterPin = useCallback(async (pin: string) => {
    if (!electron?.enterPin) throw new Error('Not in Electron');
    const result = await electron.enterPin(pin);
    if (result.success) {
      setState(prev => ({
        ...prev,
        isLocalAuthorized: true,
        pinExpiresAt: result.expiresAt || null,
      }));
    }
    return result;
  }, []);

  const generatePin = useCallback(async (userId: number | string) => {
    if (!electron?.generatePin) throw new Error('Not in Electron');
    return electron.generatePin(userId);
  }, []);

  const triggerSync = useCallback(async () => {
    if (!electron?.triggerSync) return;
    await electron.triggerSync();
  }, []);

  const dismissSyncComplete = useCallback(() => {
    setSyncComplete(null);
    if (syncCompleteTimer.current) {
      clearTimeout(syncCompleteTimer.current);
      syncCompleteTimer.current = null;
    }
  }, []);

  // ── Derived state ────────────────────────────────────────────

  const isElectron = !!electron;
  const isSyncing = syncStatus.phase !== 'idle';

  // Calculate countdown string for PIN expiry
  let pinCountdown = '';
  if (state.pinExpiresAt) {
    const remaining = new Date(state.pinExpiresAt).getTime() - Date.now();
    if (remaining > 0) {
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);
      pinCountdown = `${hours}h ${minutes}m`;
    }
  }

  return {
    // State
    ...state,
    isElectron,
    isSyncing,
    syncStatus,
    syncComplete,
    pinCountdown,

    // Actions
    enterPin,
    generatePin,
    triggerSync,
    refreshState,
    dismissSyncComplete,
  };
}
