// ============================================================
// useSpeedLimit — posted-speed-limit lookup for the active road
// ============================================================
// Given a live {lat,lng}, throttles lookups so a query fires at most once per
// ~80 m of travel, hits GET /dispatch/geography/road-speed (which reads RMPG's
// own osm-traffic PMTiles archive from R2), and exposes the posted limit in mph.
//
// HISTORY: this replaces TWO hooks. A duplicate at
// client/src/pages/navigation/hud/useSpeedLimit.ts queried overpass-api.de
// directly from the browser on every 120 m of travel — a volunteer-run public
// service whose fair-use policy excludes production traffic, reached over an
// uncached cross-origin request from a moving vehicle. It is deleted; this hook
// keeps its positional signature and its `buffer` so NavigationPage's call site
// is unchanged apart from the import path.
//
// DEGRADES CLEANLY: never throws, never blocks the drive lane.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './useApi';
import { parseMaxspeedMph } from '../utils/speedLimit';

const MOVE_THRESHOLD_M = 80;
/** Don't re-query faster than this even after 80 m (tunnels, GPS jitter). */
const MIN_QUERY_INTERVAL_MS = 4_000;
/** Safe-ceiling buffer (mph) added on top of the posted limit for the redline. */
const REDLINE_BUFFER_MPH = 7;

export interface UseSpeedLimitOptions {
  /** Master enable (e.g. Drive Mode active). Default true. */
  enabled?: boolean;
}

export interface UseSpeedLimitResult {
  /** Posted limit in mph, or null when unknown / none posted. */
  limitMph: number | null;
  /** Buffer added on top of the posted limit before the HUD redlines. */
  buffer: number;
}

interface RoadSpeedResponse {
  limitMph?: number | null;
  roadName?: string | null;
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function useSpeedLimit(
  lat: number | null,
  lng: number | null,
  opts: UseSpeedLimitOptions = {},
): UseSpeedLimitResult {
  const { enabled = true } = opts;
  const [limitMph, setLimitMph] = useState<number | null>(null);

  const lastQueryPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastQueryTsRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const now = Date.now();
    const prev = lastQueryPosRef.current;
    const distanceM = prev ? haversineMeters(prev.lat, prev.lng, lat, lng) : Infinity;
    const movedEnough = distanceM >= MOVE_THRESHOLD_M;
    const cooledDown = now - lastQueryTsRef.current >= MIN_QUERY_INTERVAL_MS;

    if (!movedEnough || !cooledDown || inFlightRef.current) return;

    lastQueryPosRef.current = { lat, lng };
    lastQueryTsRef.current = now;
    inFlightRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const data = await apiFetch<RoadSpeedResponse>(
          `/dispatch/geography/road-speed?lat=${lat}&lng=${lng}`,
          { timeoutMs: 6000 } as any,
        );
        if (cancelled) return;
        // Set unconditionally on a SUCCESSFUL query, including null: driving
        // from a posted road onto an unposted one must clear the badge, or the
        // HUD redlines against a limit that no longer applies.
        setLimitMph(parseMaxspeedMph(data?.limitMph));
      } catch {
        // Network error / offline / abort — keep the last known value.
      } finally {
        if (!cancelled) inFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      inFlightRef.current = false;
    };
  }, [lat, lng, enabled]);

  return { limitMph, buffer: REDLINE_BUFFER_MPH };
}

export const OVER_SPEED_COOLDOWN_MS = 60000;

/** Whether an over-speed alert should fire now, given the last time one fired.
 *  Pure so it's cheaply testable without mocking timers/hooks. */
export function shouldFireOverSpeedAlert(
  speedMph: number,
  limitMph: number | null,
  thresholdMph: number,
  lastFiredAt: number | null,
  nowMs: number,
): boolean {
  if (limitMph == null) return false;
  if (speedMph < limitMph + thresholdMph) return false;
  if (lastFiredAt != null && nowMs - lastFiredAt < OVER_SPEED_COOLDOWN_MS) return false;
  return true;
}

export default useSpeedLimit;
