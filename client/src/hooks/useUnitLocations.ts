// ============================================================
// RMPG Flex — live unit street-location resolver
// ============================================================
// Dispatch wants every unit's LIVE position spelled out three ways: the street
// address, the nearest cross street, and the raw coordinates. Units report
// lat/lng (browser/device GPS) but no human-readable address, so we resolve it
// on the client:
//   • street address  → server /api/geocode/reverse (KV-cached Nominatim)
//   • cross street     → Mapbox Tilequery via utils/crossStreet
// Results are cached by rounded coordinate (~11 m), so a stationary unit's
// jittering GPS hits cache and a moving unit re-resolves only when it actually
// changes block. Best-effort throughout — a miss leaves the field blank and the
// board falls back to coordinates.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './useApi';
import { fetchNearbyRoads, deriveCrossStreet } from '../utils/crossStreet';

export interface UnitLocation {
  address: string | null;     // "123 S Main St, Salt Lake City"
  onStreet: string | null;    // the road the unit is on
  crossStreet: string | null; // nearest distinct cross street
}

interface UnitLike {
  id: string | number;
  latitude?: number | null;
  longitude?: number | null;
}

const round = (n: number) => n.toFixed(4); // ~11 m grid

/**
 * True only when a unit has a real GPS fix.
 *
 * The previous guard was `Number.isFinite(Number(u.latitude))`, which lets a
 * unit with NO fix through: D1 returns SQL NULL for a missing coordinate, and
 * `Number(null)` is `0` — a perfectly finite number. Every such unit was then
 * reverse-geocoded at 0°N 0°E ("Null Island", in the Atlantic), producing a
 * wasted round-trip and a meaningless address. `Number(undefined)` would have
 * been NaN and caught, which is why this only ever bit rows sourced from the
 * database.
 *
 * Exact 0,0 is also rejected outright — it is never a real patrol position for
 * a Utah agency, and is the classic sentinel for "coordinates not set".
 */
export function hasFix(lat: unknown, lng: unknown): boolean {
  if (lat == null || lng == null || lat === '' || lng === '') return false;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  if (la === 0 && ln === 0) return false;
  // Out-of-range values are corrupt, not merely absent.
  return Math.abs(la) <= 90 && Math.abs(ln) <= 180;
}

export function useUnitLocations(units: UnitLike[]): Record<string, UnitLocation> {
  const [locations, setLocations] = useState<Record<string, UnitLocation>>({});
  const cacheRef = useRef<Map<string, UnitLocation>>(new Map());   // coordKey → resolved
  const inflightRef = useRef<Set<string>>(new Set());              // coordKey in flight
  const unitKeyRef = useRef<Map<string, string>>(new Map());       // unitId → coordKey shown

  useEffect(() => {
    let cancelled = false;

    const resolveOne = async (unitId: string, lat: number, lng: number) => {
      const coordKey = `${round(lat)},${round(lng)}`;
      // Already showing this exact position → nothing to do.
      if (unitKeyRef.current.get(unitId) === coordKey) return;

      const cached = cacheRef.current.get(coordKey);
      if (cached) {
        unitKeyRef.current.set(unitId, coordKey);
        setLocations((prev) => ({ ...prev, [unitId]: cached }));
        return;
      }
      if (inflightRef.current.has(coordKey)) return;
      inflightRef.current.add(coordKey);
      try {
        const [rev, roads] = await Promise.all([
          apiFetch<{ address: string | null }>(`/geocode/reverse?lat=${lat}&lng=${lng}`).catch(() => ({ address: null })),
          fetchNearbyRoads(lng, lat).catch(() => []),
        ]);
        const onStreet = roads[0]?.name || null;
        const crossStreet = onStreet ? (deriveCrossStreet(onStreet, roads) || null) : null;
        const loc: UnitLocation = { address: rev?.address ?? null, onStreet, crossStreet };
        cacheRef.current.set(coordKey, loc);
        if (!cancelled) {
          unitKeyRef.current.set(unitId, coordKey);
          setLocations((prev) => ({ ...prev, [unitId]: loc }));
        }
      } finally {
        inflightRef.current.delete(coordKey);
      }
    };

    for (const u of units) {
      if (!hasFix(u.latitude, u.longitude)) continue;
      resolveOne(String(u.id), Number(u.latitude), Number(u.longitude));
    }
    return () => { cancelled = true; };
  }, [units]);

  return locations;
}
