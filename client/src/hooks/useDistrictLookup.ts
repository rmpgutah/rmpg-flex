// ============================================================
// RMPG Flex — District Lookup Hook
// Auto-fills section/zone/beat from GPS coordinates
// via the 3Tier dispatch districts system
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';

export interface DistrictInfo {
  section_id: string;
  zone_id: string;
  beat_id: string;
  dispatch_code?: string;
  section_name?: string;
  zone_name?: string;
  beat_name?: string;
  beat_descriptor?: string;
}

export interface DistrictOption {
  section_id: string;
  zone_id: string;
  beat_id: string;
  dispatch_code: string;
  section_name: string;
  zone_name: string;
  beat_name: string;
  beat_descriptor: string;
}

/**
 * Fetch all 3Tier districts for dropdown population.
 * Returns deduplicated section/zone/beat lists.
 */
export function useDistrictOptions() {
  const [districts, setDistricts] = useState<DistrictOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<DistrictOption[]>('/dispatch/districts')
      .then((data) => {
        if (!cancelled && data) setDistricts(data);
      })
      .catch((err) => { console.warn('[useDistrictOptions] Failed to load districts:', err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Unique sections, zones, beats for dropdown options
  const sections = Array.from(new Set(districts.map(d => d.section_id))).sort();
  const zones = Array.from(new Set(districts.map(d => d.zone_id))).sort();
  const beats = Array.from(new Set(districts.map(d => d.beat_id))).sort();

  // Rich labels: zone_id → zone_name, beat_id → beat_name
  const zoneLabels = new Map<string, string>();
  const beatLabels = new Map<string, string>();
  const sectionLabels = new Map<string, string>();
  for (const d of districts) {
    sectionLabels.set(d.section_id, d.section_name);
    zoneLabels.set(d.zone_id, d.zone_name);
    beatLabels.set(d.beat_id, `${d.beat_name}${d.beat_descriptor ? ' — ' + d.beat_descriptor : ''}`);
  }

  return { districts, sections, zones, beats, sectionLabels, zoneLabels, beatLabels, loading };
}

/**
 * Identify district from GPS coordinates.
 * Calls the server's geofence-based identify endpoint.
 */
export function useDistrictIdentify() {
  const [identifying, setIdentifying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const identify = useCallback(async (lat: number, lng: number): Promise<DistrictInfo | null> => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIdentifying(true);
    try {
      const result = await apiFetch<{ found: boolean } & DistrictInfo>(
        `/dispatch/districts/identify?lat=${lat}&lng=${lng}`,
        { signal: controller.signal }
      );
      if (result && result.found) {
        return {
          section_id: result.section_id,
          zone_id: result.zone_id,
          beat_id: result.beat_id,
          dispatch_code: result.dispatch_code,
          section_name: result.section_name,
          zone_name: result.zone_name,
          beat_name: result.beat_name,
          beat_descriptor: result.beat_descriptor,
        };
      }
      return null;
    } catch {
      return null;
    } finally {
      setIdentifying(false);
    }
  }, []);

  return { identify, identifying };
}
