// ============================================================
// RMPG Flex — District Lookup Hook
// Auto-fills section/zone/beat from GPS coordinates
// via the 3Tier dispatch districts system
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  const [error, setError] = useState<string | null>(null);

  const loadDistricts = useCallback(() => {
    setLoading(true);
    setError(null);
    let cancelled = false;
    apiFetch<DistrictOption[]>('/dispatch/districts')
      .then((data) => { if (!cancelled && data) setDistricts(data); })
      .catch((err) => { console.warn('[useDistrictOptions] Failed to load districts:', err); if (!cancelled) setError('Failed to load districts'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { return loadDistricts(); }, [loadDistricts]);

  // Unique sections for top-level dropdown
  const sections = useMemo(() => Array.from(new Set(districts.map(d => d.section_id))).sort(), [districts]);

  // Global fallbacks (all zones, all beats) — used when no parent is selected
  const zones = useMemo(() => Array.from(new Set(districts.map(d => d.zone_id))).sort(), [districts]);
  const beats = useMemo(() => Array.from(new Set(districts.map(d => d.beat_id))).sort(), [districts]);

  // Cascading helpers: zones scoped to section, beats scoped to zone
  const zonesForSection = useCallback((sectionId: string) => {
    if (!sectionId) return zones;
    return Array.from(new Set(districts.filter(d => d.section_id === sectionId).map(d => d.zone_id))).sort();
  }, [districts, zones]);

  const beatsForZone = useCallback((zoneId: string) => {
    if (!zoneId) return beats;
    return Array.from(new Set(districts.filter(d => d.zone_id === zoneId).map(d => d.beat_id))).sort();
  }, [districts, beats]);

  // Labels: section/zone are globally unique, but beat labels must be scoped by zone
  const sectionLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of districts) m.set(d.section_id, d.section_name);
    return m;
  }, [districts]);

  const zoneLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of districts) m.set(d.zone_id, d.zone_name);
    return m;
  }, [districts]);

  // Beat labels keyed as "zoneId:beatId" to avoid collisions across zones
  const beatLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of districts) {
      m.set(`${d.zone_id}:${d.beat_id}`, `${d.beat_name}${d.beat_descriptor ? ' — ' + d.beat_descriptor : ''}`);
    }
    return m;
  }, [districts]);

  // Helper to get a beat label with proper zone scoping
  const getBeatLabel = useCallback((zoneId: string, beatId: string) => {
    return beatLabels.get(`${zoneId}:${beatId}`) || beatId;
  }, [beatLabels]);

  return { districts, sections, zones, beats, sectionLabels, zoneLabels, beatLabels, zonesForSection, beatsForZone, getBeatLabel, loading, error, retry: loadDistricts };
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
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.warn('[useDistrictIdentify] District identify failed:', err);
      }
      return null;
    } finally {
      setIdentifying(false);
    }
  }, []);

  // Cleanup: abort any in-flight request on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  return { identify, identifying };
}
