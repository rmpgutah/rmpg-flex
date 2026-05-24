import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { getMapboxToken } from '../../../utils/mapboxClient';

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

interface MapboxFeature {
  id: string;
  place_name: string;
  center: [number, number];
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

export function useMapAddressSearch(map: mapboxgl.Map | null) {
  const [addressSearch, setAddressSearch] = useState('');
  const [addressResults, setAddressResults] = useState<MapboxFeature[]>([]);
  const [showAddressResults, setShowAddressResults] = useState(false);
  const [recentSearches, setRecentSearches] = useState<{ description: string; place_id: string }[]>(getRecentSearches);
  const addressSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const addressPopupRef = useRef<mapboxgl.Popup | null>(null);
  const addressDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    getMapboxToken().then(t => { tokenRef.current = t; }).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (addressSearchTimer.current) clearTimeout(addressSearchTimer.current);
      if (addressDismissTimer.current) clearTimeout(addressDismissTimer.current);
      if (addressMarkerRef.current) { addressMarkerRef.current.remove(); addressMarkerRef.current = null; }
      if (addressPopupRef.current) { addressPopupRef.current.remove(); addressPopupRef.current = null; }
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
      const token = tokenRef.current;
      if (!token) return;
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&country=us&types=address,place,poi&limit=5`;
        const res = await fetch(url);
        if (!res.ok) return;
        const json = await res.json();
        if (json.features) {
          setAddressResults(json.features.map((f: any) => ({ id: f.id, place_name: f.place_name, center: f.center })));
          setShowAddressResults(true);
        }
      } catch { setAddressResults([]); }
    }, 300);
  }, []);

  const handleAddressSelect = useCallback((feature: MapboxFeature) => {
    if (!map) return;
    const { id, place_name, center } = feature;
    const [lng, lat] = center;

    addRecentSearch(place_name, id);
    setRecentSearches(getRecentSearches());

    map.panTo([lng, lat]);
    map.setZoom(17);

    if (addressMarkerRef.current) { addressMarkerRef.current.remove(); addressMarkerRef.current = null; }

    const el = buildAddressMarkerElement(place_name.split(',')[0]);
    addressMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map);

    if (addressDismissTimer.current) clearTimeout(addressDismissTimer.current);
    addressDismissTimer.current = setTimeout(() => {
      if (addressMarkerRef.current) { addressMarkerRef.current.remove(); addressMarkerRef.current = null; }
      addressDismissTimer.current = null;
    }, 30000);

    addressMarkerRef.current.getElement().addEventListener('click', () => {
      const html = `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222">
        <div style="font-weight:bold;font-size:12px;margin-bottom:4px;color:#888888">${place_name.split(',')[0]}</div>
        <div style="font-size:9px;color:#9ca3af;margin-bottom:4px;">${place_name}</div>
        <div style="font-size:8px;color:#6b7280;">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
      </div>`;
      if (!addressPopupRef.current) addressPopupRef.current = new mapboxgl.Popup({ offset: 25, maxWidth: '300px' });
      addressPopupRef.current.setLngLat([lng, lat]).setHTML(html).addTo(map);
    });

    setAddressSearch(place_name.split(',')[0]);
    setShowAddressResults(false);
  }, [map]);

  const clearAddressSearch = useCallback(() => {
    setAddressSearch('');
    setAddressResults([]);
    setShowAddressResults(false);
    if (addressMarkerRef.current) { addressMarkerRef.current.remove(); addressMarkerRef.current = null; }
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