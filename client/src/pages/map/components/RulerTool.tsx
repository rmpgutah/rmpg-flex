// client/src/pages/map/components/RulerTool.tsx
import { useEffect, useRef, useState } from 'react';
import turfLength from '@turf/length';
import type mapboxgl from 'mapbox-gl';

interface Props { map: mapboxgl.Map; onClose: () => void; }

const SOURCE_POINTS = 'ruler-points';
const SOURCE_LINE = 'ruler-line';
const LAYER_POINTS = 'ruler-points-layer';
const LAYER_LINE = 'ruler-line-layer';

function fmtDistance(km: number): string {
  const ft = km * 3280.84;
  return ft < 1320 ? `${Math.round(ft)} ft` : `${(km * 0.621371).toFixed(2)} mi`;
}

export default function RulerTool({ map, onClose }: Props) {
  const [points, setPoints] = useState<[number, number][]>([]);
  const [totalKm, setTotalKm] = useState(0);
  const pointsRef = useRef<[number, number][]>([]);

  const updateSources = (pts: [number, number][]) => {
    const ptSource = map.getSource(SOURCE_POINTS) as any;
    const lineSource = map.getSource(SOURCE_LINE) as any;
    if (ptSource) ptSource.setData?.({
      type: 'FeatureCollection',
      features: pts.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} })),
    });
    if (lineSource && pts.length >= 2) {
      const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} } as any;
      lineSource.setData?.(line);
      setTotalKm(turfLength(line, { units: 'kilometers' }));
    } else {
      setTotalKm(0);
    }
  };

  useEffect(() => {
    if (!map.getSource(SOURCE_POINTS)) {
      map.addSource(SOURCE_POINTS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: LAYER_POINTS, type: 'circle', source: SOURCE_POINTS,
        paint: { 'circle-radius': 5, 'circle-color': '#d4a017', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
    }
    if (!map.getSource(SOURCE_LINE)) {
      map.addSource(SOURCE_LINE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: LAYER_LINE, type: 'line', source: SOURCE_LINE,
        paint: { 'line-color': '#d4a017', 'line-width': 2, 'line-dasharray': [2, 2] } });
    }

    const handleClick = (e: any) => {
      const newPts: [number, number][] = [...pointsRef.current, [e.lngLat.lng, e.lngLat.lat]];
      pointsRef.current = newPts;
      setPoints(newPts);
      updateSources(newPts);
    };
    if (map.getCanvas) map.getCanvas().style.cursor = 'crosshair';
    map.on('click', handleClick);
    return () => {
      if (map.getCanvas) map.getCanvas().style.cursor = '';
      map.off('click', handleClick);
      [LAYER_POINTS, LAYER_LINE].forEach(l => { if (map.getLayer(l)) map.removeLayer(l); });
      [SOURCE_POINTS, SOURCE_LINE].forEach(s => { if (map.getSource(s)) map.removeSource(s); });
    };
  }, [map]);

  const clear = () => {
    pointsRef.current = [];
    setPoints([]);
    setTotalKm(0);
    updateSources([]);
  };

  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-48 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">Distance Ruler</div>
      <div className="text-rmpg-400 text-[10px]">Click map to place waypoints</div>
      <div className="text-center py-1">
        <div className="text-rmpg-200 text-base font-bold">{fmtDistance(totalKm)}</div>
        <div className="text-rmpg-400 text-[10px]">{points.length} point{points.length !== 1 ? 's' : ''}</div>
      </div>
      <div className="flex gap-2">
        <button onClick={clear}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Clear
        </button>
        <button onClick={onClose}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Done
        </button>
      </div>
    </div>
  );
}
