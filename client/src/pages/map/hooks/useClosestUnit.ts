// ============================================================
// RMPG Flex — useClosestUnit Hook
// Finds the N closest available units to a dispatch call
// location using haversine distance. Returns sorted results
// with distance in miles and rough ETA at 30 mph.
// ============================================================

import { useState, useCallback } from 'react';
import type { MapUnit } from '../utils/mapConstants';
import type { ActiveCall } from '../utils/mapConstants';
import { fetchMapboxMatrix, hasMapboxDirections } from '../../../utils/mapboxRouting';

// ─── Types ──────────────────────────────────────────────────

export interface ClosestUnitResult {
  unit: MapUnit;
  distanceMiles: number;
  estimatedMinutes: number;
  routeDistanceText?: string;
  routeEtaText?: string;
}

// ─── Haversine (miles) ──────────────────────────────────────

const EARTH_RADIUS_MILES = 3959;

function haversineMiles(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return Infinity;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Average response speed for rough ETA (mph)
const AVG_RESPONSE_SPEED_MPH = 30;

// ─── Hook ───────────────────────────────────────────────────

export function useClosestUnit() {
  const [showClosestPanel, setShowClosestPanel] = useState(false);
  const [selectedCall, setSelectedCall] = useState<ActiveCall | null>(null);
  const [closestResults, setClosestResults] = useState<ClosestUnitResult[]>([]);

  /**
   * Find the N closest units to a call location.
   * Only considers units with GPS coordinates and status 'available'.
   * Optionally includes 'busy' units if includeBusy is true.
   */
  const findClosestUnits = useCallback(async (
    callLat: number,
    callLng: number,
    units: MapUnit[],
    topN = 5,
    includeBusy = false,
  ): Promise<ClosestUnitResult[]> => {
    const eligibleStatuses = new Set(['available']);
    if (includeBusy) eligibleStatuses.add('busy');

    const results: ClosestUnitResult[] = [];

    if (!Number.isFinite(callLat) || !Number.isFinite(callLng)) return [];

    for (const unit of units) {
      if (unit.latitude == null || unit.longitude == null) continue;
      if (!Number.isFinite(unit.latitude) || !Number.isFinite(unit.longitude)) continue;
      if (!eligibleStatuses.has(unit.status)) continue;

      const distanceMiles = haversineMiles(callLat, callLng, unit.latitude, unit.longitude);
      const estimatedMinutes = (distanceMiles / AVG_RESPONSE_SPEED_MPH) * 60;

      results.push({ unit, distanceMiles, estimatedMinutes });
    }

    // Sort by distance ascending
    results.sort((a, b) => a.distanceMiles - b.distanceMiles);

    const nearest = results.slice(0, topN);

    if (!hasMapboxDirections() || nearest.length === 0) return nearest;

    try {
      const matrix = await fetchMapboxMatrix(
        nearest.map(result => ({ lat: result.unit.latitude!, lng: result.unit.longitude! })),
        { lat: callLat, lng: callLng },
      );

      const enriched = nearest.map((result, idx) => {
        const route = matrix[idx];
        if (route?.durationSec == null || route.distanceMeters == null) return result;
        return {
          ...result,
          estimatedMinutes: route.durationSec / 60,
          distanceMiles: route.distanceMeters / 1609.344,
          routeDistanceText: route.distance,
          routeEtaText: route.eta,
        };
      });

      enriched.sort((a, b) => a.estimatedMinutes - b.estimatedMinutes);
      return enriched;
    } catch (error) {
      console.warn('[useClosestUnit] Mapbox matrix lookup failed, falling back to haversine ranking:', error);
      return nearest;
    }
  }, []);

  /**
   * Open the closest-unit panel for a given call.
   */
  const openClosestPanel = useCallback(async (call: ActiveCall, units: MapUnit[]) => {
    if (call.latitude == null || call.longitude == null) return;
    const results = await findClosestUnits(call.latitude, call.longitude, units);
    setClosestResults(results);
    setSelectedCall(call);
    setShowClosestPanel(true);
  }, [findClosestUnits]);

  /**
   * Close the panel.
   */
  const closeClosestPanel = useCallback(() => {
    setShowClosestPanel(false);
    setSelectedCall(null);
    setClosestResults([]);
  }, []);

  return {
    showClosestPanel,
    setShowClosestPanel,
    selectedCall,
    setSelectedCall,
    closestResults,
    findClosestUnits,
    openClosestPanel,
    closeClosestPanel,
  };
}
