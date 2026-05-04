import { useEffect, useRef, useState, useCallback } from 'react';

// ── Recent searches localStorage key ──
const RECENT_SEARCHES_KEY = 'rmpg_map_recent_searches';
const MAX_RECENT_SEARCHES = 5;

function getRecentSearches(): { description: string; place_id: string }[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function addRecentSearch(description: string, placeId: string) {
  try {
    const recent = getRecentSearches().filter(r => r.place_id !== placeId);
    recent.unshift({ description, place_id: placeId });
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_SEARCHES)));
  } catch { /* ignore */ }
}

interface UseMapAddressSearchParams {
  mapInstanceRef: React.MutableRefObject<google.maps.Map | null>;
  infoWindowRef?: React.MutableRefObject<google.maps.InfoWindow | null>;
  createMarker: (opts: {
    map: google.maps.Map;
    position: google.maps.LatLngLiteral;
    content: HTMLElement;
    zIndex?: number;
    title?: string;
    onClick?: () => void;
  }) => any;
  removeMarker: (m: any) => void;
}

/** Build the address search marker DOM element using safe DOM methods */
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

export function useMapAddressSearch({ mapInstanceRef, infoWindowRef, createMarker, removeMarker }: UseMapAddressSearchParams) {
  const [addressSearch, setAddressSearch] = useState('');
  const [addressResults, setAddressResults] = useState<{ description: string; place_id: string }[]>([]);
  const [showAddressResults, setShowAddressResults] = useState(false);
  const [recentSearches, setRecentSearches] = useState<{ description: string; place_id: string }[]>(getRecentSearches);
  const addressSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressMarkerRef = useRef<any>(null);
  const addressDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  // Clean up timers and address marker on unmount
  useEffect(() => {
    return () => {
      if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);
      if (addressDismissTimer.current) clearTimeout(addressDismissTimer.current);
      if (addressMarkerRef.current) {
        removeMarker(addressMarkerRef.current);
        addressMarkerRef.current = null;
      }
    };
  }, [removeMarker]);

  const handleAddressSearch = useCallback((query: string) => {
    setAddressSearch(query);
    if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);

    if (!query.trim()) {
      setAddressResults([]);
      setShowAddressResults(false);
      return;
    }

    addressSearchTimer.current = setTimeout(() => {
      if (typeof google === 'undefined' || !google.maps?.places) return;
      if (!autocompleteServiceRef.current) {
        autocompleteServiceRef.current = new google.maps.places.AutocompleteService();
      }
      autocompleteServiceRef.current.getPlacePredictions(
        { input: query, types: ['geocode', 'establishment'], componentRestrictions: { country: 'us' } },
        (predictions, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
            setAddressResults(predictions.map(p => ({ description: p.description, place_id: p.place_id })));
            setShowAddressResults(true);
          } else {
            setAddressResults([]);
          }
        }
      );
    }, 300);
  }, []);

  const handleAddressSelect = useCallback((placeId: string, description: string) => {
    const map = mapInstanceRef.current;
    if (!map || typeof google === 'undefined') return;

    // Save to recent searches
    addRecentSearch(description, placeId);
    setRecentSearches(getRecentSearches());

    if (!geocoderRef.current) {
      geocoderRef.current = new google.maps.Geocoder();
    }
    geocoderRef.current.geocode({ placeId }, (results, status) => {
      if (status === 'OK' && results && results[0]) {
        const loc = results[0].geometry.location;
        map.panTo(loc);
        map.setZoom(17);

        if (addressMarkerRef.current) {
          removeMarker(addressMarkerRef.current);
          addressMarkerRef.current = null;
        }

        const el = buildAddressMarkerElement(description.split(',')[0]);

        const pos = { lat: loc.lat(), lng: loc.lng() };
        addressMarkerRef.current = createMarker({
          map,
          position: pos,
          content: el,
          zIndex: 5000,
          title: description,
          onClick: () => {
            // Show address info window on click
            if (infoWindowRef?.current) {
              const container = document.createElement('div');
              container.style.cssText = "font-family:'JetBrains Mono',monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222";
              const heading = document.createElement('div');
              heading.style.cssText = 'font-weight:bold;font-size:12px;margin-bottom:4px;color:#888888';
              heading.textContent = description.split(',')[0];
              container.appendChild(heading);
              const addr = document.createElement('div');
              addr.style.cssText = 'font-size:9px;color:#9ca3af;margin-bottom:4px;';
              addr.textContent = description;
              container.appendChild(addr);
              const coords = document.createElement('div');
              coords.style.cssText = 'font-size:8px;color:#6b7280;';
              coords.textContent = `${loc.lat().toFixed(6)}, ${loc.lng().toFixed(6)}`;
              container.appendChild(coords);
              infoWindowRef.current.setContent(container);
              infoWindowRef.current.setPosition(pos);
              infoWindowRef.current.open(map);
            }
          },
        });

        if (addressDismissTimer.current) clearTimeout(addressDismissTimer.current);
        addressDismissTimer.current = setTimeout(() => {
          if (addressMarkerRef.current) {
            removeMarker(addressMarkerRef.current);
            addressMarkerRef.current = null;
          }
          addressDismissTimer.current = null;
        }, 30000);
      }
    });

    setAddressSearch(description.split(',')[0]);
    setShowAddressResults(false);
  }, [mapInstanceRef, infoWindowRef, createMarker, removeMarker]);

  const clearAddressSearch = useCallback(() => {
    setAddressSearch('');
    setAddressResults([]);
    setShowAddressResults(false);
    if (addressMarkerRef.current) {
      removeMarker(addressMarkerRef.current);
      addressMarkerRef.current = null;
    }
  }, [removeMarker]);

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
