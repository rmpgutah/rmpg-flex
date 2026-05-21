// Dispatch Address Lookup — Mapbox Geocoding for address→coordinates
// Enhanced with suggestions, place details, and map pin placement.
import { useRef, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { forwardGeocode, reverseGeocode } from '../utils/mapboxServices';

export interface GeocodeSuggestion {
  id: string;
  place_name: string;
  center: [number, number];
  place_type: string[];
  text: string;
}

export function useMapboxGeocode(map: mapboxgl.Map | null) {
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinRef = useRef<mapboxgl.Marker | null>(null);

  const search = useCallback(async (query: string, limit = 5) => {
    if (!query || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const features = await forwardGeocode(query, limit, 'address,place,locality,neighborhood,poi');
      setSuggestions(features.map((f) => ({
        id: f.id,
        place_name: f.place_name,
        center: f.center,
        place_type: f.place_type,
        text: f.text,
      })));
    } catch (err: any) {
      setError(err.message || 'Geocoding failed');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const reverseLookup = useCallback(async (lng: number, lat: number) => {
    setLoading(true);
    try {
      const data = await reverseGeocode(lng, lat);
      const features = data.features || [];
      if (features.length > 0) {
        setSuggestions(features.map((f) => ({
          id: f.id,
          place_name: f.place_name,
          center: f.center,
          place_type: f.place_type,
          text: f.text,
        })));
        return features[0].place_name;
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
    return null;
  }, []);

  const placePin = useCallback((lng: number, lat: number, label?: string) => {
    if (!map) return;
    if (pinRef.current) {
      pinRef.current.remove();
    }
    const el = document.createElement('div');
    el.innerHTML = `<div style="
      width:24px;height:24px;background:#d4a017;border:2px solid #0a0a0a;
      border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 0 6px rgba(212,160,23,0.5);
    "></div>`;
    const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map);
    if (label) {
      marker.setPopup(new mapboxgl.Popup({ offset: 20, closeButton: false })
        .setText(label));
      marker.togglePopup();
    }
    pinRef.current = marker;
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15), duration: 800 });
  }, [map]);

  const clearPin = useCallback(() => {
    if (pinRef.current) {
      pinRef.current.remove();
      pinRef.current = null;
    }
  }, []);

  const selectSuggestion = useCallback((suggestion: GeocodeSuggestion) => {
    placePin(suggestion.center[0], suggestion.center[1], suggestion.text);
  }, [placePin]);

  return { suggestions, loading, error, search, reverseLookup, placePin, clearPin, selectSuggestion };
}
