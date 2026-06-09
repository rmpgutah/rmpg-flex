// ============================================================
// useFixFreshness — staleness/offline classifier for the GPS fix
//
// Drive Mode needs to know when the blue dot is lying. This hook tracks the
// timestamp of the last ACCEPTED fix (driven by a passed-in lat/lng/time
// tick) and reports an age + a coarse state:
//
//   fresh   — age <= 10s and online
//   stale   — 10s < age <= 60s and online
//   offline — navigator.onLine === false  OR  age > 60s
//
// A 1s internal ticker keeps `ageMs` advancing even when no new fix arrives,
// so a frozen GPS visibly degrades to stale → offline on screen.
// ============================================================

import { useEffect, useRef, useState } from 'react';

export type FixState = 'fresh' | 'stale' | 'offline';

export interface UseFixFreshnessArgs {
  lat: number | null | undefined;
  lng: number | null | undefined;
  /** Optional explicit fix timestamp (epoch ms). Defaults to Date.now() on change. */
  time?: number | null;
  staleMs?: number;
  offlineMs?: number;
}

export interface UseFixFreshnessResult {
  /** ms since the last accepted fix (null until a first fix arrives). */
  ageMs: number | null;
  state: FixState;
}

const DEFAULT_STALE_MS = 10_000;
const DEFAULT_OFFLINE_MS = 60_000;

export function useFixFreshness(args: UseFixFreshnessArgs): UseFixFreshnessResult {
  const {
    lat,
    lng,
    time,
    staleMs = DEFAULT_STALE_MS,
    offlineMs = DEFAULT_OFFLINE_MS,
  } = args;

  const lastFixRef = useRef<number | null>(null);
  const [, force] = useState(0);

  // Accept a new fix whenever a finite lat/lng tick arrives.
  useEffect(() => {
    if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
      lastFixRef.current = typeof time === 'number' && Number.isFinite(time) ? time : Date.now();
      force((n) => n + 1);
    }
  }, [lat, lng, time]);

  // Keep age advancing without new fixes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    const onNet = () => force((n) => n + 1);
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
    };
  }, []);

  const last = lastFixRef.current;
  const ageMs = last == null ? null : Math.max(0, Date.now() - last);

  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;

  let state: FixState;
  if (!online) {
    state = 'offline';
  } else if (ageMs == null) {
    // No fix yet — treat as offline (we have nothing trustworthy to show).
    state = 'offline';
  } else if (ageMs > offlineMs) {
    state = 'offline';
  } else if (ageMs > staleMs) {
    state = 'stale';
  } else {
    state = 'fresh';
  }

  return { ageMs, state };
}

export default useFixFreshness;
