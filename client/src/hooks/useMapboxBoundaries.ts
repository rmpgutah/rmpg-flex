// Jurisdiction Lookup — Mapbox Boundaries API for county/municipality
// resolution. Used on Cases/Warrants/Properties for cross-jurisdiction
// handoffs. Distinct from the beat/zone/sector dispatch system, which is
// resolved entirely by RMPG's own geofence polygons (see
// src/utils/districtResolver.ts) — this hook never touches that data.
import { useCallback, useState } from 'react';
import { lookupJurisdiction, type BoundariesResult } from '../utils/mapboxServices';

export interface JurisdictionInfo {
  county: string | null;
  municipality: string | null;
  place: string | null;
}

export function useMapboxBoundaries() {
  const [result, setResult] = useState<JurisdictionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(true);

  const lookup = useCallback(async (lng: number, lat: number) => {
    setLoading(true);
    try {
      const data: BoundariesResult = await lookupJurisdiction(lng, lat);
      if (data.skipped) {
        setAvailable(false);
        setResult(null);
        return null;
      }
      const info: JurisdictionInfo = {
        county: data.county,
        municipality: data.municipality,
        place: data.place,
      };
      setAvailable(true);
      setResult(info);
      return info;
    } catch (err) {
      console.warn('[useMapboxBoundaries] lookup failed:', err);
      setResult(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, available, lookup };
}
