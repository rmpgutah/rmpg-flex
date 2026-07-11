// ============================================================
// RMPG Flex — "View on map" link
// ============================================================
// Small, reusable link/button for records/pages whose data is
// location-relevant (an address, a lat/lng) but don't warrant a full
// embedded map widget — deep-links to /map?lat=&lng=&label= (known
// coordinates) or /map?address=&label= (text address only — most
// pages in this audit store an address string with no stored lat/lng
// at all, so MapboxMapPage.tsx forward-geocodes it on arrival).
// Renders nothing (not even a disabled state) when there's no usable
// location data, since a link to nowhere is worse than no link.
// ============================================================

import { MapPin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ViewOnMapLinkProps {
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  label?: string;
  className?: string;
}

export default function ViewOnMapLink({ latitude, longitude, address, label, className }: ViewOnMapLinkProps) {
  const navigate = useNavigate();
  const hasCoords = latitude != null && longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude);
  const hasAddress = !!address && address.trim().length > 0;
  if (!hasCoords && !hasAddress) return null;

  const go = () => {
    const params = new URLSearchParams();
    if (hasCoords) {
      params.set('lat', String(latitude));
      params.set('lng', String(longitude));
    } else if (hasAddress) {
      params.set('address', address!.trim());
    }
    if (label) params.set('label', label);
    navigate(`/map?${params.toString()}`);
  };

  return (
    <button
      type="button"
      onClick={go}
      className={`inline-flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300 underline underline-offset-2 ${className || ''}`}
    >
      <MapPin className="w-3 h-3" aria-hidden="true" />
      View on map
    </button>
  );
}
