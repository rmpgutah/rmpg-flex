// ============================================================
// RMPG Flex — Premise Alert Hook
// Checks an address or coordinates for premise-level warnings
// (weapons, violent history, hazmat, animals, etc.)
// Used by dispatch to auto-flag dangerous locations.
// ============================================================

import { useState, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';

export interface PremiseAlert {
  id: number;
  address: string;
  latitude?: number;
  longitude?: number;
  alert_type: string;
  alert_level: string; // 'info' | 'warning' | 'critical'
  title: string;
  description?: string;
  flags: string;
  expires_at?: string;
  active: number;
}

interface UsePremiseAlertsReturn {
  alerts: PremiseAlert[];
  loading: boolean;
  checkAddress: (address: string) => Promise<PremiseAlert[]>;
  checkCoords: (lat: number, lng: number) => Promise<PremiseAlert[]>;
  clear: () => void;
}

export function usePremiseAlerts(): UsePremiseAlertsReturn {
  const [alerts, setAlerts] = useState<PremiseAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const checkAddress = useCallback(async (address: string): Promise<PremiseAlert[]> => {
    if (!address || address.length < 3) { setAlerts([]); return []; }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const result = await apiFetch<PremiseAlert[]>(
        `/dispatch/geography/premise-alerts?address=${encodeURIComponent(address)}`,
        { signal: controller.signal }
      );
      const found = result || [];
      setAlerts(found);
      return found;
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.warn('[usePremiseAlerts] Check failed:', err);
      }
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const checkCoords = useCallback(async (lat: number, lng: number): Promise<PremiseAlert[]> => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { setAlerts([]); return []; }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const result = await apiFetch<PremiseAlert[]>(
        `/dispatch/geography/premise-alerts?lat=${lat}&lng=${lng}`,
        { signal: controller.signal }
      );
      const found = result || [];
      setAlerts(found);
      return found;
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.warn('[usePremiseAlerts] Coord check failed:', err);
      }
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setAlerts([]);
    if (abortRef.current) abortRef.current.abort();
  }, []);

  return { alerts, loading, checkAddress, checkCoords, clear };
}
