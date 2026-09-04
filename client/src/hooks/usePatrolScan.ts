// ============================================================
// usePatrolScan — continuous "while driving" ALPR loop.
//
// Drives Patrol Scan: every PATROL_INTERVAL_MS it asks the page
// for a stamped+downscaled frame (getFrame) and posts it to
// /api/alpr/capture with capture_reason='patrol_alpr' (no call
// linkage — sightings only). The server screens every plate and
// writes vehicle_sightings; this hook owns the on-screen log
// (deduped per plate), the critical-hit alert (voice + tone +
// vibrate), and a Screen Wake Lock so the phone stays awake while
// mounted.
//
// The timer is a recursive setTimeout, NOT setInterval: the next
// tick is scheduled only after the current capture settles, so a
// slow upload on weak cell signal can never stack overlapping
// requests. The loop self-paces to max(interval, round-trip).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiPostForm } from './useApi';
import { announcePlateHit } from '../utils/voiceAlerts';
import {
  shouldLogPlate,
  patrolAlertText,
  normalizePlate,
  PATROL_INTERVAL_MS,
  PATROL_DEDUP_MS,
  type PatrolHitLike,
} from '../utils/patrolScan';

interface ScanVehicle {
  plate: string | null; make: string | null; model: string | null; color: string | null;
  year: number | null; vehicle_type: string | null; confidence: number | null;
  hits?: PatrolHitLike[];
}
interface AlprScanResult {
  success: boolean; id: number; vehicle_count: number;
  vehicles: ScanVehicle[]; hits: PatrolHitLike[];
}

export interface PatrolLogEntry {
  key: string;          // dedup key (normalized plate) + first-seen ts, unique per render
  plate: string;
  vehicle: string;      // "color year make model" or vehicle type
  confidence: number | null;
  critical: boolean;
  at: number;
}

export interface PatrolHit {
  plate: string;
  text: string;
  at: number;
}

interface UsePatrolScanOpts {
  /** Grab a stamped, downscaled JPEG of the current frame, or null if not ready. */
  getFrame: () => Promise<Blob | null>;
  /** Current GPS fix for the sighting, or null. */
  getGps: () => { lat: number; lng: number } | null;
  /** Surfaced to the page for a non-blocking notice. */
  onError?: (message: string) => void;
}

function describeVehicle(v: ScanVehicle): string {
  const parts = [v.color, v.year, v.make, v.model].filter(Boolean).join(' ');
  return parts || v.vehicle_type || '—';
}

export function usePatrolScan({ getFrame, getGps, onError }: UsePatrolScanOpts) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<PatrolLogEntry[]>([]);
  const [lastHit, setLastHit] = useState<PatrolHit | null>(null);
  const [scanCount, setScanCount] = useState(0);

  const runningRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenRef = useRef<Map<string, number>>(new Map());
  const wakeLockRef = useRef<any>(null); // WakeLockSentinel — not in all TS lib targets

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const acquireWakeLock = useCallback(async () => {
    try {
      // navigator.wakeLock is unavailable on older WebViews; loop still runs.
      const wl = (navigator as any).wakeLock;
      if (wl?.request) wakeLockRef.current = await wl.request('screen');
    } catch { /* sleep prevention unavailable — non-fatal */ }
  }, []);

  // One capture cycle: grab frame → post → fold results into log + alerts.
  const tick = useCallback(async () => {
    if (!runningRef.current) return;
    try {
      const blob = await getFrame();
      if (blob) {
        const form = new FormData();
        form.append('photo', blob, 'patrol.jpg');
        const gps = getGps();
        if (gps) { form.append('lat', String(gps.lat)); form.append('lng', String(gps.lng)); }
        form.append('capture_reason', 'patrol_alpr');
        const r = await apiPostForm<AlprScanResult>('/alpr/capture', form);
        setScanCount((n) => n + 1);

        const now = Date.now();
        const newEntries: PatrolLogEntry[] = [];
        for (const v of r.vehicles || []) {
          if (!shouldLogPlate(v.plate, now, seenRef.current)) continue;
          const critical = (v.hits || []).some((h) => h.severity === 'critical');
          newEntries.push({
            key: `${normalizePlate(v.plate)}:${now}`,
            plate: v.plate || '—',
            vehicle: describeVehicle(v),
            confidence: v.confidence,
            critical,
            at: now,
          });
        }
        if (newEntries.length) {
          // Newest first; cap the log so a long shift doesn't grow unbounded.
          setLog((prev) => [...newEntries.reverse(), ...prev].slice(0, 100));
        }

        // Critical hit → alert. Prefer per-vehicle hits, fall back to capture-level.
        for (const v of r.vehicles || []) {
          const text = patrolAlertText(v.plate, v.hits);
          if (text) {
            const plateKey = normalizePlate(v.plate);
            void announcePlateHit(plateKey, text);
            try { navigator.vibrate?.([400, 120, 400]); } catch { /* unsupported */ }
            setLastHit({ plate: v.plate || '—', text, at: now });
          }
        }
      }
    } catch (err) {
      // One bad frame must not kill patrol — log and keep going.
      onError?.(err instanceof Error ? err.message : 'Patrol scan tick failed');
    } finally {
      if (runningRef.current) {
        timerRef.current = setTimeout(tick, PATROL_INTERVAL_MS);
      }
    }
  }, [getFrame, getGps, onError]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    seenRef.current.clear();
    setLog([]);
    setLastHit(null);
    setScanCount(0);
    setRunning(true);
    void acquireWakeLock();
    // First frame after a short beat so the camera is settled.
    timerRef.current = setTimeout(tick, 800);
  }, [acquireWakeLock, tick]);

  const stop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    releaseWakeLock();
  }, [releaseWakeLock]);

  const clearHit = useCallback(() => setLastHit(null), []);

  // Re-acquire the wake lock when returning to the tab (WakeLock is dropped
  // by the platform on visibility loss — spec'd behavior).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && runningRef.current && !wakeLockRef.current) {
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [acquireWakeLock]);

  // Tear down on unmount.
  useEffect(() => () => {
    runningRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    wakeLockRef.current?.release().catch(() => {});
  }, []);

  return { running, start, stop, log, lastHit, clearHit, scanCount, dedupMs: PATROL_DEDUP_MS };
}
