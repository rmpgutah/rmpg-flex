// Jurisdiction lookup — resolves county/municipality for an address via
// Mapbox Geocoding + Boundaries. Used on Warrants/Properties detail panels
// for cross-jurisdiction handoffs. Not related to beat/zone/sector.
import { useState, useCallback } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { forwardGeocode } from '../utils/mapboxServices';
import { useMapboxBoundaries } from '../hooks/useMapboxBoundaries';

export default function JurisdictionLookup({ address }: { address: string }) {
  const [error, setError] = useState<string | null>(null);
  const { result, loading, available, lookup } = useMapboxBoundaries();

  const run = useCallback(async () => {
    setError(null);
    try {
      const features = await forwardGeocode(address, 1);
      const first = features[0];
      if (!first) {
        setError('Could not geocode this address');
        return;
      }
      const [lng, lat] = first.center;
      await lookup(lng, lat);
    } catch {
      setError('Lookup failed');
    }
  }, [address, lookup]);

  if (!address?.trim()) return null;

  return (
    <div className="flex items-center gap-2 text-[10px]">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="toolbar-btn text-[9px]"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
        Jurisdiction
      </button>
      {!available && <span className="text-rmpg-500">unavailable</span>}
      {error && <span className="text-red-400">{error}</span>}
      {result && (
        <span className="text-rmpg-300">
          {[result.county, result.municipality].filter(Boolean).join(', ') || 'No jurisdiction found'}
        </span>
      )}
    </div>
  );
}
