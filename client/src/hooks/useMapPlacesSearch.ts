/**
 * useMapPlacesSearch — Google Places Autocomplete equivalent for Mapbox GL.
 *
 * Provides category-filtered POI search (hospitals, gas stations, schools, etc.)
 * using the Mapbox Tilequery API + geocoding. Renders results as markers on map
 * with popups showing name, address, distance. Replaces Google Places Library.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { mapboxForwardGeocode, mapboxTilequery, type MapboxGeocodingResult } from '../services/mapboxApiService';
import { withAlpha } from '../utils/withAlpha';
import { escapeHtml } from '../utils/sanitize';
import { MAP_CAD_CRITICAL, MAP_CAD_INK, MAP_CAD_OK, MAP_CAD_WARN } from '../pages/map/utils/mapCadInk';

// ── Types ─────────────────────────────────────────────────

export interface PlaceCategory {
  id: string;
  label: string;
  icon: string;
  keywords: string[];
  color: string;
}

export interface PlaceResult {
  id: string;
  name: string;
  address: string;
  category: string;
  latitude: number;
  longitude: number;
  distance?: number;
}

export const PLACE_CATEGORIES: PlaceCategory[] = [
  { id: 'hospital', label: 'Hospitals', icon: '🏥', keywords: ['hospital', 'emergency room', 'medical center'], color: MAP_CAD_CRITICAL },
  { id: 'fire_station', label: 'Fire Stations', icon: '🚒', keywords: ['fire station', 'fire department'], color: MAP_CAD_WARN },
  { id: 'police', label: 'Police Stations', icon: '🚔', keywords: ['police station', 'sheriff', 'law enforcement'], color: '#3b82f6' },
  { id: 'school', label: 'Schools', icon: '🏫', keywords: ['school', 'elementary', 'high school', 'university'], color: '#a855f7' },
  { id: 'gas_station', label: 'Gas Stations', icon: '⛽', keywords: ['gas station', 'fuel', 'petrol'], color: MAP_CAD_OK },
  { id: 'pharmacy', label: 'Pharmacies', icon: '💊', keywords: ['pharmacy', 'drugstore', 'CVS', 'Walgreens'], color: '#ec4899' },
  { id: 'shelter', label: 'Shelters', icon: '🏠', keywords: ['shelter', 'homeless shelter', 'refuge'], color: '#14b8a6' },
  { id: 'church', label: 'Places of Worship', icon: '⛪', keywords: ['church', 'mosque', 'temple', 'synagogue'], color: MAP_CAD_WARN },
];

// ── Hook ──────────────────────────────────────────────────

export function useMapPlacesSearch(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
) {
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  const clearResults = useCallback(() => {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    setResults([]);
    setActiveCategory(null);
  }, []);

  const searchCategory = useCallback(async (categoryId: string) => {
    if (!map || !mapLoaded) return;

    const category = PLACE_CATEGORIES.find(c => c.id === categoryId);
    if (!category) return;

    setSearching(true);
    setActiveCategory(categoryId);

    // Clear previous markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    try {
      const center = map.getCenter();
      const allResults: PlaceResult[] = [];

      // Search each keyword for the category
      for (const keyword of category.keywords.slice(0, 2)) {
        const geocodeResults = await mapboxForwardGeocode(keyword, {
          limit: 5,
          proximity: [center.lng, center.lat],
          country: 'US',
        });

        for (const r of geocodeResults) {
          if (!allResults.some(existing => existing.name === r.name)) {
            allResults.push({
              id: `${categoryId}-${allResults.length}`,
              name: r.name,
              address: r.full_address,
              category: categoryId,
              latitude: r.latitude,
              longitude: r.longitude,
            });
          }
        }
      }

      setResults(allResults);

      // Add markers
      for (const place of allResults) {
        const el = document.createElement('div');
        el.style.cssText = `
          width:28px;height:28px;border-radius:50%;
          background:${category.color};border:2px solid #fff;
          display:flex;align-items:center;justify-content:center;
          font-size:14px;cursor:pointer;
          box-shadow:0 0 8px ${withAlpha(category.color, '80')};
        `;
        el.textContent = category.icon;
        el.title = place.name;

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([place.longitude, place.latitude])
          .setPopup(
            new mapboxgl.Popup({ offset: 16, closeButton: false, className: 'mapbox-popup-dark' })
              .setHTML(`
                <div style="background:#141414;color:#e0e0e0;padding:8px 12px;border:1px solid #222;border-radius:2px;font-size:11px;min-width:160px;">
                  <div style="font-weight:700;color:${category.color};margin-bottom:2px;">${category.icon} ${escapeHtml(place.name)}</div>
                  <div style="color:#888;font-size:10px;">${escapeHtml(place.address)}</div>
                  <div style="margin-top:4px;font-size:9px;color:#555;">${escapeHtml(category.label)}</div>
                </div>
              `)
          )
          .addTo(map);

        markersRef.current.push(marker);
      }

      // Fit bounds to results
      if (allResults.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        allResults.forEach(p => bounds.extend([p.longitude, p.latitude]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 14 });
      }
    } catch (err) {
      console.warn('[PlacesSearch] search failed:', err);
    } finally {
      setSearching(false);
    }
  }, [map, mapLoaded]);

  const searchCustom = useCallback(async (query: string) => {
    if (!map || !mapLoaded || !query.trim()) return;

    setSearching(true);
    setActiveCategory('custom');

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    try {
      const center = map.getCenter();
      const geocodeResults = await mapboxForwardGeocode(query, {
        limit: 10,
        proximity: [center.lng, center.lat],
        country: 'US',
      });

      const placeResults: PlaceResult[] = geocodeResults.map((r, i) => ({
        id: `custom-${i}`,
        name: r.name,
        address: r.full_address,
        category: 'custom',
        latitude: r.latitude,
        longitude: r.longitude,
      }));

      setResults(placeResults);

      for (const place of placeResults) {
        const el = document.createElement('div');
        el.style.cssText = `
          width:24px;height:24px;border-radius:50%;
          background:${MAP_CAD_INK};border:2px solid #fff;
          display:flex;align-items:center;justify-content:center;
          font-size:10px;cursor:pointer;color:#0a1422;font-weight:700;
          box-shadow:0 0 8px ${withAlpha(MAP_CAD_INK, '80')};
        `;
        el.textContent = '📍';
        el.title = place.name;

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([place.longitude, place.latitude])
          .setPopup(
            new mapboxgl.Popup({ offset: 14, closeButton: false, className: 'mapbox-popup-dark' })
              .setHTML(`
                <div style="background:#141414;color:#e0e0e0;padding:8px 12px;border:1px solid #222;border-radius:2px;font-size:11px;min-width:160px;">
                  <div style="font-weight:700;color:${MAP_CAD_INK};margin-bottom:2px;">${escapeHtml(place.name)}</div>
                  <div style="color:#888;font-size:10px;">${escapeHtml(place.address)}</div>
                </div>
              `)
          )
          .addTo(map);

        markersRef.current.push(marker);
      }

      if (placeResults.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        placeResults.forEach(p => bounds.extend([p.longitude, p.latitude]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 14 });
      }
    } catch (err) {
      console.warn('[PlacesSearch] custom search failed:', err);
    } finally {
      setSearching(false);
    }
  }, [map, mapLoaded]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
    };
  }, []);

  return {
    results,
    activeCategory,
    searching,
    searchCategory,
    searchCustom,
    clearResults,
    categories: PLACE_CATEGORIES,
  };
}
