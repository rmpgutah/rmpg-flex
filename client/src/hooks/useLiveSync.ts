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

import { useEffect, useRef, useCallback } from 'react';
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

  const moduleList = Array.isArray(modules) ? modules : [modules];

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleList.join(',')]);

  useEffect(() => {
    // Subscribe to the 'data_changed' message type that the liveBroadcast middleware sends
    const unsubscribe = subscribe('data_changed', handleDataChanged);

    return () => {
      unsubscribe();
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [subscribe, handleDataChanged]);
}

export default useLiveSync;
