// ============================================================
// RMPG Flex — Drive-Mode HUD · posted speed-limit hook
// ============================================================
// Self-contained (drive-lane only) speed-limit lookup. Best-effort: queries
// OpenStreetMap's Overpass API for the nearest way carrying a `maxspeed` tag
// near the live position, throttled by movement so it never floods the network.
// Degrades silently — when no limit is known, `limitMph` is null and the HUD
// simply hides the limit badge. NEVER blocks the drive view.
// ============================================================

import { useEffect, useRef, useState } from 'react';

interface SpeedLimitState {
  /** Posted limit in mph, or null when unknown. */
  limitMph: number | null;
  /** Safe-ceiling buffer (mph) added on top of the posted limit for the redline. */
  buffer: number;
}

// Throttle: only re-query after this much movement or this much time.
const MOVE_M = 120;
const MIN_MS = 25000;

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Parse an OSM `maxspeed` value ("35 mph", "50", "80 km/h") into mph. */
function parseMaxspeed(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (s.includes('km')) return Math.round(n * 0.621371);
  return Math.round(n);
}

export function useSpeedLimit(lat: number | null, lng: number | null): SpeedLimitState {
  const [limitMph, setLimitMph] = useState<number | null>(null);
  const lastRef = useRef<{ lat: number; lng: number; t: number } | null>(null);

  useEffect(() => {
    if (lat == null || lng == null) return;
    const prev = lastRef.current;
    const now = Date.now();
    const moved = prev ? haversineMeters(prev.lat, prev.lng, lat, lng) : Infinity;
    if (prev && moved < MOVE_M && now - prev.t < MIN_MS) return;
    lastRef.current = { lat, lng, t: now };

    let cancelled = false;
    const ctrl = new AbortController();
    const to = window.setTimeout(() => ctrl.abort(), 8000);
    (async () => {
      try {
        // Tight bbox (~70 m) around the fix; ask only for ways tagged maxspeed.
        const d = 0.0007;
        const q = `[out:json][timeout:7];way["maxspeed"](${lat - d},${lng - d},${lat + d},${lng + d});out tags 1;`;
        const res = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: q,
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const json: any = await res.json();
        if (cancelled) return;
        const el = Array.isArray(json?.elements) ? json.elements.find((e: any) => e?.tags?.maxspeed != null) : null;
        const mph = el ? parseMaxspeed(el.tags.maxspeed) : null;
        // Set unconditionally on a SUCCESSFUL query — including null. Driving
        // from a road with a posted limit onto one without must clear the badge;
        // the old `if (mph != null)` left the previous road's limit showing (and
        // red-lining) indefinitely. The catch below still preserves the last
        // known value on a network error/abort.
        setLimitMph(mph);
      } catch { /* offline / blocked / aborted — keep last known */ }
      finally { window.clearTimeout(to); }
    })();
    return () => { cancelled = true; window.clearTimeout(to); ctrl.abort(); };
  }, [lat, lng]);

  return { limitMph, buffer: 7 };
}

export const OVER_SPEED_COOLDOWN_MS = 60000;

/** Whether an over-speed alert should fire now, given the last time one fired.
 *  Pure function so it's cheaply testable without mocking timers/hooks. */
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
