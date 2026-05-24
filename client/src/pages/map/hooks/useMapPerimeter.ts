import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

interface QuadrantCoverage {
  quadrant: 'NE' | 'NW' | 'SE' | 'SW';
  has_units: boolean;
  unit_count: number;
}

interface PerimeterData {
  lat: number;
  lng: number;
  quadrants: QuadrantCoverage[];
  total_units: number;
}

interface CoverageGap {
  lat: number;
  lng: number;
  width: number;
  height: number;
}

interface CoverageGapData {
  gaps: CoverageGap[];
  coverage_percent: number;
  suggested_staging: { lat: number; lng: number } | null;
}

interface UseMapPerimeterReturn {
  showPerimeter: (lat: number, lng: number) => Promise<void>;
  clearPerimeter: () => void;
  coverageGaps: CoverageGap[];
  coveragePercent: number;
  startContainment: () => void;
  endContainment: () => void;
  containmentPolygon: [number, number][];
  showPerimeterRings: (lat: number, lng: number, innerM: number, outerM: number) => void;
  clearRings: () => void;
  stagingSuggestion: { lat: number; lng: number } | null;
  loading: boolean;
}

const HIGH_VALUE_TARGETS = [
  { lat: 40.7608, lng: -111.891, name: 'Utah State Capitol' },
  { lat: 40.7718, lng: -111.8882, name: 'LDS Hospital' },
  { lat: 40.7587, lng: -111.8762, name: 'University of Utah Hospital' },
  { lat: 40.7496, lng: -111.8862, name: 'Salt Lake City Public Safety Bldg' },
  { lat: 40.7606, lng: -111.8939, name: 'Capitol Hill Elementary' },
  { lat: 40.7505, lng: -111.8916, name: 'SLC Federal Building' },
  { lat: 40.7686, lng: -111.8453, name: 'East High School' },
  { lat: 40.7341, lng: -111.9022, name: 'West High School' },
  { lat: 40.7621, lng: -111.8987, name: 'City Creek Center' },
  { lat: 40.7708, lng: -111.8920, name: 'Primary Children\'s Hospital' },
];

const COVERED_COLOR = '#22c55e';
const GAP_COLOR = '#ef4444';

export function useMapPerimeter(
  map: mapboxgl.Map | null,
  enabled: boolean,
): UseMapPerimeterReturn {
  const [loading, setLoading] = useState(false);
  const [coverageGaps, setCoverageGaps] = useState<CoverageGap[]>([]);
  const [coveragePercent, setCoveragePercent] = useState(0);
  const [stagingSuggestion, setStagingSuggestion] = useState<{ lat: number; lng: number } | null>(null);
  const [containmentPolygon, setContainmentPolygon] = useState<[number, number][]>([]);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const isDrawingRef = useRef(false);
  const verticesRef = useRef<[number, number][]>([]);

  const quadrantSourceId = 'perimeter-quadrants';
  const gapSourceId = 'perimeter-gaps';
  const ringSourceId = 'perimeter-rings';
  const containmentSourceId = 'perimeter-containment';
  const hvtSourceId = 'perimeter-hvt';

  const clearSource = useCallback((id: string) => {
    if (!map) return;
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }, [map]);

  const clearPerimeter = useCallback(() => {
    [quadrantSourceId, gapSourceId, ringSourceId, containmentSourceId, hvtSourceId].forEach(clearSource);
    setCoverageGaps([]);
    setCoveragePercent(0);
    setStagingSuggestion(null);
    setContainmentPolygon([]);
    isDrawingRef.current = false;
    verticesRef.current = [];
  }, [clearSource]);

  const clearRings = useCallback(() => { clearSource(ringSourceId); }, [clearSource]);

  const renderHvtMarkers = useCallback(() => {
    if (!map) return;
    clearSource(hvtSourceId);

    const features = HIGH_VALUE_TARGETS.map((target) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [target.lng, target.lat] as [number, number] },
      properties: { name: target.name },
    }));

    map.addSource(hvtSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: hvtSourceId,
      type: 'circle',
      source: hvtSourceId,
      paint: {
        'circle-color': '#888888',
        'circle-radius': 6,
        'circle-stroke-color': '#555555',
        'circle-stroke-width': 1,
      },
    });

    if (!popupRef.current) popupRef.current = new mapboxgl.Popup({ maxWidth: '200px', closeButton: true, closeOnClick: false });

    map.on('click', hvtSourceId, (e) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;
      const html = `<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#050505;padding:8px 10px;border-radius:4px;border:1px solid #88888840"><div style="font-weight:bold;color:#888888">${feature.properties.name}</div><div style="font-size:9px;color:#9ca3af;margin-top:2px">High Value Target</div></div>`;
      if (popupRef.current) popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);
    });
  }, [map, clearSource]);

  const showPerimeter = useCallback(async (lat: number, lng: number) => {
    if (!enabled || !map) return;
    setLoading(true);
    try {
      const data = await apiFetch<PerimeterData>(`/map/safety/perimeter-check/${lat}/${lng}`);
      if (!data || !Array.isArray(data.quadrants)) return;

      clearSource(quadrantSourceId);
      clearSource(gapSourceId);

      const SIZE = 0.005;
      const quadrantFeatures: any[] = [];
      data.quadrants.forEach((q) => {
        const offsets: Record<string, { latOff: number; lngOff: number }> = {
          NE: { latOff: SIZE / 2, lngOff: SIZE / 2 },
          NW: { latOff: SIZE / 2, lngOff: -SIZE / 2 },
          SE: { latOff: -SIZE / 2, lngOff: SIZE / 2 },
          SW: { latOff: -SIZE / 2, lngOff: -SIZE / 2 },
        };
        const off = offsets[q.quadrant];
        if (!off) return;
        quadrantFeatures.push({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [lng + off.lngOff, lat + off.latOff] as [number, number] },
          properties: { color: q.has_units ? COVERED_COLOR : GAP_COLOR, quadrant: q.quadrant, unit_count: q.unit_count },
        });
      });

      if (quadrantFeatures.length > 0) {
        map.addSource(quadrantSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: quadrantFeatures } });
        map.addLayer({
          id: quadrantSourceId,
          type: 'circle',
          source: quadrantSourceId,
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': SIZE * 111000 / 2,
            'circle-opacity': 0.12,
            'circle-stroke-color': ['get', 'color'],
            'circle-stroke-width': 1,
            'circle-stroke-opacity': 0.5,
          },
        });
      }

      const gapData = await apiFetch<CoverageGapData>('/map/safety/coverage-gaps');
      if (gapData) {
        setCoverageGaps(gapData.gaps || []);
        setCoveragePercent(gapData.coverage_percent || 0);
        setStagingSuggestion(gapData.suggested_staging || null);

        const gapFeatures = (gapData.gaps || []).map((gap) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [gap.lng, gap.lat] as [number, number] },
          properties: { width: gap.width, height: gap.height },
        }));

        if (gapFeatures.length > 0) {
          map.addSource(gapSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: gapFeatures } });
          map.addLayer({
            id: gapSourceId,
            type: 'circle',
            source: gapSourceId,
            paint: {
              'circle-color': GAP_COLOR,
              'circle-radius': 100,
              'circle-opacity': 0.08,
              'circle-stroke-color': GAP_COLOR,
              'circle-stroke-width': 1,
              'circle-stroke-opacity': 0.3,
            },
          });
        }
      }

      renderHvtMarkers();
    } catch (err) {
      console.warn('[useMapPerimeter] Perimeter analysis fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [enabled, map, clearSource, renderHvtMarkers]);

  const updateContainmentPoly = useCallback(() => {
    if (!map) return;
    clearSource(containmentSourceId);

    if (verticesRef.current.length < 3) return;

    const coords = [...verticesRef.current, verticesRef.current[0]];
    const feature = {
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: [coords] },
      properties: {},
    };

    map.addSource(containmentSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [feature] } });
    map.addLayer({
      id: containmentSourceId,
      type: 'fill',
      source: containmentSourceId,
      paint: {
        'fill-color': '#ef4444',
        'fill-opacity': 0.06,
      },
    });
    map.addLayer({
      id: `${containmentSourceId}-outline`,
      type: 'line',
      source: containmentSourceId,
      paint: {
        'line-color': '#ef4444',
        'line-width': 2,
        'line-opacity': 0.9,
      },
    });
  }, [map, clearSource]);

  const handleClick = useCallback((e: mapboxgl.MapMouseEvent) => {
    if (!isDrawingRef.current || !e.lngLat) return;
    const point: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    verticesRef.current.push(point);
    updateContainmentPoly();
  }, [updateContainmentPoly]);

  const handleDblClick = useCallback((e: mapboxgl.MapMouseEvent) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    isDrawingRef.current = false;
    map?.off('click', handleClick);
    map?.off('dblclick', handleDblClick);
    setContainmentPolygon([...verticesRef.current]);
  }, [map, handleClick]);

  const startContainment = useCallback(() => {
    if (!map || isDrawingRef.current) return;
    clearSource(containmentSourceId);
    isDrawingRef.current = true;
    verticesRef.current = [];

    map.on('click', handleClick);
    map.on('dblclick', handleDblClick);
  }, [map, clearSource, handleClick, handleDblClick]);

  const endContainment = useCallback(() => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      map?.off('click', handleClick);
      map?.off('dblclick', handleDblClick);
      setContainmentPolygon([...verticesRef.current]);
    }
  }, [map, handleClick]);

  const showPerimeterRings = useCallback((lat: number, lng: number, innerM: number, outerM: number) => {
    if (!map) return;
    clearSource(ringSourceId);

    const features = [
      { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] }, properties: { radius: innerM, color: '#ef4444', opacity: 0.08, strokeOpacity: 0.7 } },
      { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] }, properties: { radius: outerM, color: '#f59e0b', opacity: 0.05, strokeOpacity: 0.5 } },
    ];

    map.addSource(ringSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: ringSourceId,
      type: 'circle',
      source: ringSourceId,
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['get', 'radius'],
        'circle-opacity': ['get', 'opacity'],
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 2,
        'circle-stroke-opacity': ['get', 'strokeOpacity'],
      },
    });
  }, [map, clearSource]);

  useEffect(() => {
    if (!enabled) clearPerimeter();
    return () => { clearPerimeter(); };
  }, [enabled, clearPerimeter]);

  useEffect(() => {
    return () => {
      [quadrantSourceId, gapSourceId, ringSourceId, containmentSourceId, hvtSourceId].forEach((id) => {
        if (map?.getLayer(id)) map.removeLayer(id);
        if (map?.getSource(id)) map.removeSource(id);
      });
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    };
  }, [map]);

  return { showPerimeter, clearPerimeter, coverageGaps, coveragePercent, startContainment, endContainment, containmentPolygon, showPerimeterRings, clearRings, stagingSuggestion, loading };
}
