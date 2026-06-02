// ============================================================
// RMPG Flex — Address Autofill
// ============================================================
// One place to resolve ALL geolocation detail from a picked address:
//   coordinates → section/zone/beat (3Tier district) + nearest cross street.
// Used by BOTH the New Call form and the call-edit panel so the two never
// drift in what they auto-populate. Callers decide the merge policy
// (preserve-vs-overwrite); this hook only resolves the values.

import { useCallback } from 'react';
import type { ParsedAddress } from '../components/AddressAutocomplete';
import { useDistrictIdentify } from './useDistrictLookup';
import { fetchNearbyRoads, deriveCrossStreet } from '../utils/crossStreet';

export interface ResolvedAddressDetails {
  latitude: number | null;
  longitude: number | null;
  sector_id: string;
  zone_id: string;
  beat_id: string;
  dispatch_code: string;
  cross_street: string;
}

export function useAddressAutofill() {
  const { identify } = useDistrictIdentify();

  /**
   * Resolve every geo detail we can derive from a geocoded address. District
   * lookup and cross-street derivation run in parallel; both are best-effort,
   * so a failure of either leaves that field empty rather than throwing.
   */
  const resolve = useCallback(async (addr: ParsedAddress): Promise<ResolvedAddressDetails> => {
    const base: ResolvedAddressDetails = {
      latitude: addr.latitude ?? null,
      longitude: addr.longitude ?? null,
      sector_id: '', zone_id: '', beat_id: '', dispatch_code: '', cross_street: '',
    };
    if (addr.latitude == null || addr.longitude == null) return base;

    const [district, roads] = await Promise.all([
      identify(addr.latitude, addr.longitude),
      fetchNearbyRoads(addr.longitude, addr.latitude),
    ]);

    return {
      latitude: addr.latitude,
      longitude: addr.longitude,
      sector_id: district?.sector_id || '',
      zone_id: district?.zone_id || '',
      beat_id: district?.beat_id || '',
      dispatch_code: district?.dispatch_code || '',
      cross_street: deriveCrossStreet(addr.street || addr.formatted, roads),
    };
  }, [identify]);

  /**
   * Resolve geo detail from a TYPED address string (no autocomplete pick). The
   * dispatch call form lets operators type an address freehand; this forward-
   * geocodes that text (same server Nominatim source + Utah bias the
   * autocomplete uses) to get coordinates, then resolves district + cross
   * street. Returns null on a geocode miss so the caller leaves fields alone.
   */
  const resolveFromText = useCallback(async (text: string): Promise<ResolvedAddressDetails | null> => {
    const raw = (text || '').trim();
    if (raw.length < 5) return null;
    // The server geocode (Nominatim) is format-sensitive — "4974 S Redwood Rd"
    // misses while "4974 South Redwood Road" hits. Expand directionals + street
    // types and drop a trailing ZIP so the freehand fallback resolves.
    const q = raw
      .replace(/\./g, ' ')
      .replace(/\b([NSEW])\b/gi, (_, d) => ({ N: 'North', S: 'South', E: 'East', W: 'West' } as any)[d.toUpperCase()])
      .replace(/\bNE\b/gi, 'Northeast').replace(/\bNW\b/gi, 'Northwest')
      .replace(/\bSE\b/gi, 'Southeast').replace(/\bSW\b/gi, 'Southwest')
      .replace(/\bRd\b/gi, 'Road').replace(/\bSt\b/gi, 'Street').replace(/\bAve\b/gi, 'Avenue')
      .replace(/\bDr\b/gi, 'Drive').replace(/\bLn\b/gi, 'Lane').replace(/\bBlvd\b/gi, 'Boulevard')
      .replace(/\bCt\b/gi, 'Court').replace(/\bCir\b/gi, 'Circle').replace(/\bPkwy\b/gi, 'Parkway')
      .replace(/\bHwy\b/gi, 'Highway').replace(/\bPl\b/gi, 'Place').replace(/\bTer\b/gi, 'Terrace')
      .replace(/\s{2,}/g, ' ').trim();
    try {
      // /api/geocode is auth-gated — send the bearer token (the autocomplete
      // normally uses Mapbox-direct so it never hit this fallback unauthed).
      const token = localStorage.getItem('rmpg_token');
      const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(q)}&limit=1`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      const data = await res.json();
      const r = (data?.results || [])[0];
      const lat = r?.lat != null ? Number(r.lat) : null;
      const lng = r?.lon != null ? Number(r.lon) : null;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const a = r.address || {};
      const street = [a.house_number, a.road || a.pedestrian || a.cycleway]
        .filter(Boolean).join(' ') || String(r.display_name || q).split(',')[0]?.trim() || '';
      return resolve({
        formatted: r.display_name || q,
        street,
        city: a.city || a.town || a.village || a.hamlet || a.suburb || '',
        state: a.state || '',
        zip: a.postcode || '',
        country: a.country || 'United States',
        latitude: lat,
        longitude: lng,
      });
    } catch {
      return null;
    }
  }, [resolve]);

  return { resolve, resolveFromText };
}
