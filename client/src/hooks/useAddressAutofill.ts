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

  return { resolve };
}
