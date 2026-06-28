// ============================================================
// useSpeedLimit — posted-speed-limit lookup for the active road
//
// Given a live {lat,lng}, throttles lookups so a query fires at most once
// per ~80m of travel (internal ref + haversine distance check), hits an
// existing server tilequery/road endpoint, parses an OSM-style `maxspeed`
// field, and caches the last good value.
//
// DEGRADES CLEANLY: if no maxspeed field is present (or the request fails),
// it returns the last known value or null — it NEVER throws, blocks, or
// resets a good reading on a single miss.
//
// Self-contained: the fetch + parse + throttle all live here. It uses the
// shared apiFetch only to inherit auth + base-URL handling; if that import
// or the endpoint is unavailable at runtime the catch path yields null.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './useApi';

const MOVE_THRESHOLD_M = 80;
/** Don't re-query faster than this even if we've moved 80m (tunnels, GPS jitter). */
const MIN_QUERY_INTERVAL_MS = 4_000;

export interface UseSpeedLimitArgs {
  lat: number | null | undefined;
  lng: number | null | undefined;
  /** Master enable (e.g. Drive Mode active). Default true. */
  enabled?: boolean;
}

export interface UseSpeedLimitResult {
  /** Posted limit in mph, or null when unknown / no data field exists. */
  limitMph: number | null;
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

/**
 * Parse an OSM-style maxspeed value into mph.
 * Accepts: 35 | "35" | "35 mph" | "50 km/h" | "50 kmh". Returns null otherwise.
 */
export function parseMaxspeedMph(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val)) return null;
  if (s.includes('km') || s.includes('kph')) return Math.round(val * 0.621371);
  return Math.round(val);
}

/** Dig a maxspeed-ish value out of an unknown response shape. */
function extractMaxspeed(data: unknown): number | null {
  if (data == null || typeof data !== 'object') return null;
  const obj = data as Record<string, any>;
  // Common shapes: { maxspeed }, { limitMph }, { features:[{properties:{maxspeed}}] }
  const direct =
    obj.maxspeed ?? obj.max_speed ?? obj.speed_limit ?? obj.limitMph ?? obj.posted;
  const fromDirect = parseMaxspeedMph(direct);
  if (fromDirect != null) return fromDirect;
  const feats = Array.isArray(obj.features) ? obj.features : null;
  if (feats) {
    for (const f of feats) {
      const props = f?.properties ?? f;
      const v = parseMaxspeedMph(props?.maxspeed ?? props?.max_speed ?? props?.speed_limit);
      if (v != null) return v;
    }
  }
  return null;
}

export function useSpeedLimit(args: UseSpeedLimitArgs): UseSpeedLimitResult {
  const { lat, lng, enabled = true } = args;
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
    const movedEnough =
      !prev || haversineMeters(prev.lat, prev.lng, lat, lng) >= MOVE_THRESHOLD_M;
    const cooledDown = now - lastQueryTsRef.current >= MIN_QUERY_INTERVAL_MS;

    if (!movedEnough || !cooledDown || inFlightRef.current) return;

    lastQueryPosRef.current = { lat, lng };
    lastQueryTsRef.current = now;
    inFlightRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const data = await apiFetch<unknown>(
          `/dispatch/geography/road-speed?lat=${lat}&lng=${lng}`,
          { timeoutMs: 6000 } as any,
        );
        if (cancelled) return;
        const parsed = extractMaxspeed(data);
        // Only overwrite when we actually got a value; a null miss keeps the
        // last known limit so the readout doesn't flicker between roads.
        if (parsed != null) setLimitMph(parsed);
      } catch {
        // Endpoint missing / offline / 4xx → degrade silently to last value.
      } finally {
        if (!cancelled) inFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      inFlightRef.current = false;
    };
  }, [lat, lng, enabled]);

  return { limitMph };
}

export default useSpeedLimit;
