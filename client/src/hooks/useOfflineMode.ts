import { useState, useEffect, useCallback, useRef } from 'react';

// ─── Browser offline services (lazy-loaded, tree-shaken if unused) ───
import {
  initOfflineDb,
  isOfflineDbReady,
  getConfig,
  setConfig,
  getQueueDepth,
} from '../services/offlineDb';
import {
  createConnectivityMonitor,
  getConnectivityMonitor,
  isLikelyOnline,
} from '../services/connectivityMonitor';
import {
  startSyncSchedule,
  stopSyncSchedule,
  updateAuthToken,
  pullAll,
  pushAll,
  onSyncEvent,
  getSyncState,
} from '../services/offlineSync';
import {
  validatePin as browserValidatePin,
  generatePinForUser as browserGeneratePin,
  hasActiveSession,
  startExpiryTimer,
  stopExpiryTimer,
  onPinEvent,
} from '../services/offlinePin';

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
 * React hook exposing offline mode state.
 *
 * Works in BOTH Electron (IPC → SQLite) and browser (IndexedDB + fetch).
 * Subscribes to events for:
 * - connectivity changes  (online <-> offline)
 * - sync progress         (pull/push table progress)
 * - PIN session expiry    (24h window closed)
 * - authorization changes (PIN entered / expired)
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
  const [browserInitialized, setBrowserInitialized] = useState(false);

  // Dismiss timer for sync-complete notification
  const syncCompleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isElectron = !!electron;
  const isOfflineCapable = isElectron || browserInitialized;

  // ── Initialize browser offline mode ────────────────────────

  useEffect(() => {
    if (isElectron) return; // Electron uses its own IPC system

    let cancelled = false;

    async function initBrowserOffline() {
      try {
        // Only initialize if user is logged in
        const token = localStorage.getItem('rmpg_token');
        if (!token) return;

        // Initialize IndexedDB
        await initOfflineDb();

        // Store user info in local_config for offline use
        try {
          const response = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (response.ok) {
            const userData = await response.json();
            await setConfig('current_user_id', String(userData.id));
            await setConfig('current_user_role', userData.role);
            await setConfig('auth_token', token);

            const refreshToken = localStorage.getItem('rmpg_refresh_token');
            if (refreshToken) {
              await setConfig('refresh_token', refreshToken);
            }
          }
        } catch (err) {
          console.warn('[useOfflineMode] Auth/me fetch failed, using cached values:', err);
        }

        if (cancelled) return;

        // Determine server URL (same origin for browser)
        const serverUrl = window.location.origin;

        // Start connectivity monitoring — NO callback here.
        // Connectivity events are handled by the subscription effect (below)
        // to avoid duplicate state updates.
        const monitor = createConnectivityMonitor(serverUrl);
        monitor.start();

        if (cancelled) { monitor.stop(); return; }

        // Start sync schedule
        startSyncSchedule(serverUrl, token);

        if (cancelled) { stopSyncSchedule(); monitor.stop(); return; }

        // Start PIN expiry timer
        startExpiryTimer();

        if (cancelled) { stopExpiryTimer(); stopSyncSchedule(); monitor.stop(); return; }

        // Listen for Background Sync messages from Service Worker
        if (cancelled) { stopExpiryTimer(); stopSyncSchedule(); monitor.stop(); return; }
        const handleSwMessage = (event: MessageEvent) => {
          if (event.data?.type === 'SYNC_PUSH_REQUESTED') {
            pushAll().catch(err => console.warn('[OFFLINE] SW sync push failed:', err.message));
          }
        };
        navigator.serviceWorker?.addEventListener('message', handleSwMessage);
        // Store reference for cleanup — if already cancelled, remove immediately
        swHandlerRef = handleSwMessage;
        if (cancelled) {
          navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
          swHandlerRef = null;
          return;
        }

        // Check for existing PIN session
        const session = await hasActiveSession();
        const role = await getConfig('current_user_role');
        const queueDepth = await getQueueDepth();

        if (!cancelled) {
          setState(prev => ({
            ...prev,
            // Prefer the monitor's first-check state if available. Between
            // monitor.start() and this setState, the async init chain
            // (auth/me fetch, hasActiveSession, getQueueDepth) gives the
            // first health check time to complete — so by now isLikelyOnline()
            // is usually authoritative, not just a navigator.onLine echo.
            isOffline: !isLikelyOnline(),
            isLocalAuthorized: session.active,
            pinExpiresAt: session.expiresAt,
            syncQueueDepth: queueDepth,
            userRole: role,
          }));
          setBrowserInitialized(true);
        }
      } catch (err) {
        console.warn('[OFFLINE] Browser offline init failed:', err);
      }
    }

    // Declare BEFORE calling async init so the closure captures the variable correctly
    let swHandlerRef: ((event: MessageEvent) => void) | null = null;
    initBrowserOffline().then(() => {
      // swHandlerRef is now set inside initBrowserOffline
    }).catch(() => { /* handled inside */ });

    return () => {
      cancelled = true;
      // Remove SW message listener to prevent leaks
      if (swHandlerRef) {
        navigator.serviceWorker?.removeEventListener('message', swHandlerRef);
      }
      stopSyncSchedule();
      stopExpiryTimer();
      const monitor = getConnectivityMonitor();
      if (monitor) monitor.stop();
    };
  }, [isElectron]);

  // ── Subscribe to browser offline events ────────────────────

  useEffect(() => {
    if (isElectron || !browserInitialized) return;

    const unsubs: (() => void)[] = [];

    // Sync progress
    unsubs.push(onSyncEvent('sync-progress', (data: any) => {
      setSyncStatus({
        phase: data.phase || 'pull',
        table: data.table || '',
        current: data.current || 0,
        total: data.total || 0,
      });
    }));

    // Sync complete
    unsubs.push(onSyncEvent('sync-complete', (data: any) => {
      setSyncStatus({ phase: 'idle', table: '', current: 0, total: 0 });
      setSyncComplete({
        pulled: data.pulled || 0,
        pushed: data.pushed || 0,
        errors: data.errors || 0,
      });
      if (syncCompleteTimer.current) clearTimeout(syncCompleteTimer.current);
      syncCompleteTimer.current = setTimeout(() => setSyncComplete(null), 5000);

      // Refresh queue depth
      getQueueDepth().then(depth => {
        setState(prev => ({ ...prev, syncQueueDepth: depth }));
      });
    }));

    // PIN authorization changes
    unsubs.push(onPinEvent('authorization-changed', (data: any) => {
      setState(prev => ({
        ...prev,
        isLocalAuthorized: !!data.isLocalAuthorized,
        pinExpiresAt: data.expiresAt || null,
      }));
    }));

    // PIN expired
    unsubs.push(onPinEvent('pin-expired', () => {
      setState(prev => ({ ...prev, isLocalAuthorized: false, pinExpiresAt: null }));
    }));

    // Connectivity monitor — single source of truth for offline state.
    // No callback in monitor.start() — all state updates go through here.
    const monitor = getConnectivityMonitor();
    if (monitor) {
      unsubs.push(monitor.onChange((isOnline) => {
        setState(prev => ({ ...prev, isOffline: !isOnline }));
        if (isOnline) {
          // Came back online — push queued items
          pushAll().catch(err => console.warn('[OFFLINE] Push failed:', err.message));
        }
      }));
    }

    return () => {
      unsubs.forEach(fn => fn());
      if (syncCompleteTimer.current) clearTimeout(syncCompleteTimer.current);
    };
  }, [isElectron, browserInitialized]);

  // ── Electron: fetch initial state ──────────────────────────

  const refreshState = useCallback(async () => {
    if (isElectron && electron?.getOfflineState) {
      try {
        const s = await electron.getOfflineState();
        setState({
          isOffline: !s.isOnline,
          isLocalAuthorized: !!s.isLocalAuthorized,
          pinExpiresAt: s.expiresAt || null,
          syncQueueDepth: s.syncQueueDepth || 0,
          userRole: s.role || null,
        });
      } catch { /* ignore */ }
    } else if (browserInitialized) {
      try {
        const session = await hasActiveSession();
        const queueDepth = await getQueueDepth();
        const role = await getConfig('current_user_role');

        setState(prev => ({
          ...prev,
          isOffline: !isLikelyOnline(),
          isLocalAuthorized: session.active,
          pinExpiresAt: session.expiresAt,
          syncQueueDepth: queueDepth,
          userRole: role,
        }));
      } catch { /* ignore */ }
    }
  }, [isElectron, browserInitialized]);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  // ── Electron: subscribe to IPC events ──────────────────────

  useEffect(() => {
    if (!isElectron) return;
    const unsubs: (() => void)[] = [];

    if (electron.onConnectivityChange) {
      unsubs.push(
        electron.onConnectivityChange((online: boolean) => {
          setState(prev => ({ ...prev, isOffline: !online }));
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
          if (syncCompleteTimer.current) clearTimeout(syncCompleteTimer.current);
          syncCompleteTimer.current = setTimeout(() => setSyncComplete(null), 5000);
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
  }, [isElectron, refreshState]);

  // ── Actions ────────────────────────────────────────────────

  const enterPin = useCallback(async (pin: string) => {
    if (isElectron && electron?.enterPin) {
      const result = await electron.enterPin(pin);
      if (result.success) {
        setState(prev => ({
          ...prev,
          isLocalAuthorized: true,
          pinExpiresAt: result.expiresAt || null,
        }));
      }
      return result;
    }

    // Browser path
    if (browserInitialized) {
      const result = await browserValidatePin(pin);
      if (result.success) {
        setState(prev => ({
          ...prev,
          isLocalAuthorized: true,
          pinExpiresAt: result.expiresAt || null,
        }));
      }
      return result;
    }

    throw new Error('Offline mode not available');
  }, [isElectron, browserInitialized]);

  const generatePin = useCallback(async (userId: number | string) => {
    if (isElectron && electron?.generatePin) {
      return electron.generatePin(userId);
    }

    // Browser path
    if (browserInitialized) {
      return browserGeneratePin(typeof userId === 'string' ? parseInt(userId, 10) : userId);
    }

    throw new Error('Offline mode not available');
  }, [isElectron, browserInitialized]);

  const triggerSync = useCallback(async () => {
    if (isElectron && electron?.triggerSync) {
      await electron.triggerSync();
      return;
    }

    // Browser path
    if (browserInitialized) {
      await pushAll();
      await pullAll();
      return;
    }
  }, [isElectron, browserInitialized]);

  const dismissSyncComplete = useCallback(() => {
    setSyncComplete(null);
    if (syncCompleteTimer.current) {
      clearTimeout(syncCompleteTimer.current);
      syncCompleteTimer.current = null;
    }
  }, []);

  // ── Derived state ──────────────────────────────────────────

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
    isOfflineCapable,
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
