// ============================================================
// RMPG Flex — useLiveSync Hook
// Universal hook for real-time data synchronization across devices.
// When ANY user on ANY device modifies data, this hook triggers
// an auto-refresh on all other connected clients.
//
// Usage:
//   useLiveSync('records', loadData);        // Refresh on any records change
//   useLiveSync('personnel', fetchOfficers); // Refresh on personnel changes
//   useLiveSync(['records', 'incidents'], loadAll); // Multiple modules
// ============================================================

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import type { WSMessage } from '../types';

// Debounce interval — prevents rapid-fire refreshes when multiple
// mutations happen in quick succession (e.g., bulk operations)
const DEBOUNCE_MS = 500;

/**
 * Subscribe to real-time data changes for one or more modules.
 * Automatically calls the refresh function when data changes are
 * broadcast from any connected device.
 *
 * @param modules - Module name(s) to listen for: 'records', 'personnel', 'fleet',
 *                  'incidents', 'citations', 'patrol', 'admin', 'dispatch'
 * @param onRefresh - Function to call when data changes (e.g., reload data from API)
 * @param options - Optional configuration
 */
export function useLiveSync(
  modules: string | string[],
  onRefresh: () => void,
  options?: {
    /** Only trigger for specific entity types (e.g., 'persons', 'vehicles') */
    entities?: string[];
    /** Custom debounce interval in ms (default: 500) */
    debounceMs?: number;
    /** Disable the hook (e.g., when a modal is open) */
    disabled?: boolean;
  }
): void {
  const { subscribe } = useWebSocket();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRefreshRef = useRef(onRefresh);
  const optionsRef = useRef(options);

  // Keep refs fresh to avoid stale closures
  onRefreshRef.current = onRefresh;
  optionsRef.current = options;

  // Stabilize moduleList — only recompute when the actual module names change,
  // not when a new array reference is passed on every render
  const moduleKey = Array.isArray(modules) ? modules.join(',') : modules;
  const moduleList = useMemo(
    () => (Array.isArray(modules) ? modules : [modules]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moduleKey]
  );

  const handleDataChanged = useCallback((message: WSMessage) => {
    if (optionsRef.current?.disabled) return;

    const data = (message as any).data;
    if (!data) return;

    // Check if this change is for one of our watched modules
    if (!moduleList.includes(data.module)) return;

    // If entity filter is set, only trigger for matching entities
    if (optionsRef.current?.entities?.length) {
      if (!optionsRef.current.entities.includes(data.entity)) return;
    }

    // Debounce to prevent rapid-fire refreshes
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    const delay = optionsRef.current?.debounceMs ?? DEBOUNCE_MS;
    debounceTimer.current = setTimeout(() => {
      onRefreshRef.current();
    }, delay);
  }, [moduleList]);

  // The live Worker broadcasts dispatch-family mutations under the
  // 'dispatch_update' message type (with an `action` discriminator), NOT the
  // 'data_changed' shape this hook was written for. 'data_changed' is never
  // emitted by the deployed worker, so a consumer like DispatchPage
  // (useLiveSync('dispatch', …)) got no reconciliation refresh at all. Bridge
  // the real channel: any 'dispatch_update' counts as a change for the
  // dispatch-family modules below, so those consumers get their debounced
  // silent-refresh safety net back. (records/personnel/fleet still need
  // server-side broadcasts on their own mutations — tracked separately.)
  const DISPATCH_FAMILY = useMemo(() => ['dispatch', 'incidents', 'patrol'], []);

  const handleDispatchUpdate = useCallback((message: WSMessage) => {
    if (optionsRef.current?.disabled) return;
    // Only refresh if this consumer actually watches a dispatch-family module.
    if (!moduleList.some((m) => DISPATCH_FAMILY.includes(m))) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const delay = optionsRef.current?.debounceMs ?? DEBOUNCE_MS;
    debounceTimer.current = setTimeout(() => {
      onRefreshRef.current();
    }, delay);
  }, [moduleList, DISPATCH_FAMILY]);

  useEffect(() => {
    // Keep 'data_changed' for forward-compat if the worker ever emits it, and
    // add the channel the worker actually broadcasts on today.
    const unsubLegacy = subscribe('data_changed', handleDataChanged);
    const unsubDispatch = subscribe('dispatch_update', handleDispatchUpdate);

    return () => {
      unsubLegacy();
      unsubDispatch();
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [subscribe, handleDataChanged, handleDispatchUpdate]);
}

export default useLiveSync;
