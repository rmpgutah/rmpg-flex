import { useEffect, useRef, useState, useCallback, type MutableRefObject } from 'react';
import mapboxgl from 'mapbox-gl';
import { escapeHtml } from '../../../utils/sanitize';
import { apiFetch } from '../../../hooks/useApi';

const RECENT_SEARCHES_KEY = 'rmpg_map_recent_searches';
const MAX_RECENT_SEARCHES = 5;

function getRecentSearches(): { description: string; place_id: string }[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('[useMapAddressSearch] Failed to parse recent searches:', e);
    return [];
  }
}

function addRecentSearch(description: string, placeId: string) {
  try {
    const recent = getRecentSearches().filter(r => r.place_id !== placeId);
    recent.unshift({ description, place_id: placeId });
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_SEARCHES)));
  } catch (e) {
    console.warn('[useMapAddressSearch] Failed to save recent search:', e);
  }
}

interface UseMapAddressSearchParams {
  mapInstanceRef: React.MutableRefObject<mapboxgl.Map | null>;
  infoWindowRef?: React.MutableRefObject<mapboxgl.Popup | null>;
}

function buildAddressMarkerElement(label: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;';

  const badge = document.createElement('div');
  badge.style.cssText = "background:#888888;color:#fff;font-size:9px;font-weight:900;padding:3px 8px;border:2px solid #fff;white-space:nowrap;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;max-width:200px;overflow:hidden;text-overflow:ellipsis;border-radius:2px;";
  badge.textContent = label;
  wrapper.appendChild(badge);

  const arrow = document.createElement('div');
  arrow.style.cssText = 'width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid #888888;';
  wrapper.appendChild(arrow);

  return wrapper;
}

export function useMapAddressSearch({ mapInstanceRef, infoWindowRef }: UseMapAddressSearchParams) {
  const [addressSearch, setAddressSearch] = useState('');
  const [addressResults, setAddressResults] = useState<{ description: string; place_id: string }[]>([]);
  const [showAddressResults, setShowAddressResults] = useState(false);
  const [recentSearches, setRecentSearches] = useState<{ description: string; place_id: string }[]>(getRecentSearches);
  const addressSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const addressDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);
      if (addressDismissTimer.current) clearTimeout(addressDismissTimer.current);
      if (addressMarkerRef.current) {
        addressMarkerRef.current.remove();
        addressMarkerRef.current = null;
      }
    };
  }, []);

  const handleAddressSearch = useCallback((query: string) => {
    setAddressSearch(query);
    if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);

    if (!query.trim()) {
      setAddressResults([]);
      setShowAddressResults(false);
      return;
    }

    addressSearchTimer.current = setTimeout(async () => {
      try {
        const results = await apiFetch<{ description: string; place_id: string }[]>(`/geocode/search?q=${encodeURIComponent(query)}`);
        if (results && Array.isArray(results)) {
          setAddressResults(results);
          setShowAddressResults(true);
        } else {
          setAddressResults([]);
        }
      } catch (e) {
        console.warn('[useMapAddressSearch] Address search failed:', e);
        setAddressResults([]);
      }
    }, 300);
  }, []);

  const handleAddressSelect = useCallback(async (placeId: string, description: string) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    addRecentSearch(description, placeId);
    setRecentSearches(getRecentSearches());

    try {
      const results = await apiFetch<{ lat: number; lng: number }[]>(`/geocode/reverse?place_id=${encodeURIComponent(placeId)}`);
      if (!results || results.length === 0) return;
      const loc = results[0];

      map.flyTo({ center: [loc.lng, loc.lat], zoom: 17 });

      if (addressMarkerRef.current) {
        addressMarkerRef.current.remove();
        addressMarkerRef.current = null;
      }

      const el = buildAddressMarkerElement(description.split(',')[0]);

      addressMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([loc.lng, loc.lat])
        .addTo(map);

      if (addressDismissTimer.current) clearTimeout(addressDismissTimer.current);
      addressDismissTimer.current = setTimeout(() => {
        if (addressMarkerRef.current) {
          addressMarkerRef.current.remove();
          addressMarkerRef.current = null;
        }
        addressDismissTimer.current = null;
      }, 30000);
    } catch (e) {
      console.warn('[useMapAddressSearch] Geocode select failed:', e);
    }

    setAddressSearch(description.split(',')[0]);
    setShowAddressResults(false);
  }, [mapInstanceRef, infoWindowRef]);

  const clearAddressSearch = useCallback(() => {
    setAddressSearch('');
    setAddressResults([]);
    setShowAddressResults(false);
    if (addressMarkerRef.current) {
      addressMarkerRef.current.remove();
      addressMarkerRef.current = null;
    }
  }, []);

  return {
    addressSearch,
    setAddressSearch,
    addressResults,
    showAddressResults,
    setShowAddressResults,
    handleAddressSearch,
    handleAddressSelect,
    clearAddressSearch,
    recentSearches,
  };
}
