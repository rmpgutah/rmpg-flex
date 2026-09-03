/**
 * useRadar360 — drives a Radar 360º situational-awareness scan.
 *
 * The hook posts to /api/radar360/scan and manages loading, error,
 * auto-refresh, and a filter set (kind + flag). The caller provides the
 * center coordinate; the hook owns everything else.
 *
 * Auto-refresh fires every REFRESH_MS while enabled. Refresh is paused
 * while the browser tab is hidden (visibilitychange) to avoid waking up
 * the Worker on a background tab.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { apiFetch } from './useApi';

// ── Types (mirrors src/routes/radar360.ts) ────────────────

export type ContactKind = 'call' | 'person' | 'vehicle' | 'unit' | 'incident';

export interface RadarContact {
  kind: ContactKind;
  id: number;
  label: string;
  sublabel?: string;
  flags: string[];
  bearing: number;
  distanceMi: number;
  lat: number;
  lng: number;
  priority?: string;
  status?: string;
}

export interface RadarScanResult {
  contacts: RadarContact[];
  radiusMi: number;
  centerLat: number;
  centerLng: number;
  scannedAt: string;
}

export interface UseRadar360Options {
  lat: number | null;
  lng: number | null;
  radiusMi?: number;
  /** Optional call ID to associate with signal scans. */
  callId?: number | null;
  /** Auto-refresh interval in ms. Default 30 s. Pass 0 to disable. */
  refreshMs?: number;
}

export interface UseRadar360Result {
  contacts: RadarContact[];
  loading: boolean;
  error: boolean;
  /** Wall-clock of the last successful scan. */
  scannedAt: Date | null;
  /** Manually trigger a fresh scan. */
  refresh: () => void;
  /** Filter by contact kind (empty = all). */
  visibleKinds: Set<ContactKind>;
  toggleKind: (kind: ContactKind) => void;
  /** Filter to only contacts carrying at least one flag. */
  flaggedOnly: boolean;
  setFlaggedOnly: (v: boolean) => void;
  /** Derived: contacts after filters applied. */
  filtered: RadarContact[];
  radiusMi: number;
  setRadiusMi: (v: number) => void;
  /** Pass-through for signals panel (center coordinate + call context). */
  lat: number | null;
  lng: number | null;
  callId?: number | null;
}

const ALL_KINDS: ContactKind[] = ['call', 'person', 'vehicle', 'unit', 'incident'];
const REFRESH_MS_DEFAULT = 30_000;

export function useRadar360({
  lat,
  lng,
  radiusMi: radiusProp = 1,
  callId = null,
  refreshMs = REFRESH_MS_DEFAULT,
}: UseRadar360Options): UseRadar360Result {
  const [contacts, setContacts] = useState<RadarContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [scannedAt, setScannedAt] = useState<Date | null>(null);
  const [visibleKinds, setVisibleKinds] = useState<Set<ContactKind>>(new Set(ALL_KINDS));
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [radiusMi, setRadiusMi] = useState(radiusProp);

  const abortRef = useRef<AbortController | null>(null);

  const scan = useCallback(async () => {
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (document.hidden) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const result = await apiFetch<RadarScanResult>('/radar360/scan', {
        method: 'POST',
        body: JSON.stringify({ lat, lng, radius_mi: radiusMi }),
      });
      if (controller.signal.aborted) return;
      setContacts(result.contacts);
      setScannedAt(new Date(result.scannedAt)); // new-date-ok: Worker emits ISO-8601 with Z suffix (not a naive D1 string)
      setError(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [lat, lng, radiusMi]);

  // Initial scan + auto-refresh
  useEffect(() => {
    scan();
    if (!refreshMs) return;
    const interval = setInterval(() => { if (!document.hidden) scan(); }, refreshMs);
    const onVisible = () => { if (!document.hidden) scan(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      abortRef.current?.abort();
    };
  }, [scan, refreshMs]);

  const refresh = useCallback(() => scan(), [scan]);

  const toggleKind = useCallback((kind: ContactKind) => {
    setVisibleKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      return next;
    });
  }, []);

  const filtered = contacts.filter((c) => {
    if (!visibleKinds.has(c.kind)) return false;
    if (flaggedOnly && c.flags.length === 0) return false;
    return true;
  });

  return {
    contacts,
    loading,
    error,
    scannedAt,
    refresh,
    visibleKinds,
    toggleKind,
    flaggedOnly,
    setFlaggedOnly,
    filtered,
    radiusMi,
    setRadiusMi,
    lat,
    lng,
    callId,
  };
}
