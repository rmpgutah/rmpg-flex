import { useEffect, useRef, useState, useCallback } from 'react';
import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import { fromLonLat } from 'ol/proj';
import { apiFetch } from '../../../hooks/useApi';
import { devWarn } from '../../../utils/devLog';

export interface AddressResult {
  display_name: string;
  latitude: number;
  longitude: number;
  type?: string;
}

interface SearchResponse {
  results?: AddressResult[];
  error?: string;
}

const PIN_STYLE = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: '#d4a017' }),
    stroke: new Stroke({ color: '#0a0a0a', width: 2 }),
  }),
});

/**
 * Address search backed by /api/geocode/search (Nominatim proxy).
 *
 * - Mounts a dedicated VectorLayer (z=80) for the selected pin.
 * - selectAddress(r) pans+zooms the map to the result and drops the pin.
 * - clearPin() removes the pin without changing the view.
 * - Returns search() — debounced 350ms — and the latest results array.
 *
 * Why a hook instead of a self-contained component: keeping state at the
 * page level lets the search bar UI live in MapPageV2 chrome alongside
 * other panels, with no prop-drilling for the map ref.
 */
export function useOlAddressSearch(map: OlMap | null) {
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const sourceRef = useRef<VectorSource | null>(null);
  const [results, setResults] = useState<AddressResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mount once
  useEffect(() => {
    if (!map || layerRef.current) return;
    const source = new VectorSource();
    sourceRef.current = source;
    const layer = new VectorLayer({
      source,
      style: PIN_STYLE,
      zIndex: 80,
    });
    layerRef.current = layer;
    map.addLayer(layer);
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
      sourceRef.current = null;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [map]);

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q || q.trim().length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      apiFetch<SearchResponse>(`/geocode/search?q=${encodeURIComponent(q.trim())}&limit=5`)
        .then((data) => {
          setResults(Array.isArray(data?.results) ? data.results : []);
        })
        .catch((err) => {
          devWarn('[map-v2] address search failed:', err);
          setResults([]);
        })
        .finally(() => setSearching(false));
    }, 350);
  }, []);

  const selectAddress = useCallback((r: AddressResult) => {
    if (!map || !sourceRef.current) return;
    const coord = fromLonLat([r.longitude, r.latitude]);
    sourceRef.current.clear();
    const f = new Feature({ geometry: new Point(coord) });
    sourceRef.current.addFeature(f);
    map.getView().animate({ center: coord, zoom: 15, duration: 400 });
  }, [map]);

  const clearPin = useCallback(() => {
    sourceRef.current?.clear();
  }, []);

  return { results, searching, search, selectAddress, clearPin };
}
