// client/src/pages/map/components/BufferRingTool.tsx
import { useEffect, useRef, useState } from 'react';
import turfCircle from '@turf/circle';
import type mapboxgl from 'mapbox-gl';

interface Ring { id: string; lat: number; lng: number; radiusM: number; color: string; }
interface Props { map: mapboxgl.Map; onClose: () => void; }

const COLORS = ['#d4a017', '#ef4444', '#22c55e', '#3b82f6'];
const FT_PER_M = 3.28084;
const MI_PER_M = 0.000621371;

export default function BufferRingTool({ map, onClose }: Props) {
  const [rings, setRings] = useState<Ring[]>([]);
  const [radius, setRadius] = useState('500');
  const [unit, setUnit] = useState<'ft' | 'mi'>('ft');
  const [color, setColor] = useState(COLORS[0]);
  const [opacity, setOpacity] = useState(0.3);
  const clickHandlerRef = useRef<((e: any) => void) | null>(null);
  const ringsRef = useRef<Ring[]>([]);

  useEffect(() => { ringsRef.current = rings; }, [rings]);

  useEffect(() => {
    const handler = (e: any) => {
      const r = Number(radius);
      if (!r || r <= 0) return;
      const radiusM = unit === 'ft' ? r / FT_PER_M : r / MI_PER_M;
      const id = `ring-${Date.now()}`;
      const circle = turfCircle([e.lngLat.lng, e.lngLat.lat], radiusM / 1000, { units: 'kilometers' });
      map.addSource(id, { type: 'geojson', data: circle as any });
      map.addLayer({ id: `${id}-fill`, type: 'fill', source: id,
        paint: { 'fill-color': color, 'fill-opacity': opacity } });
      map.addLayer({ id: `${id}-line`, type: 'line', source: id,
        paint: { 'line-color': color, 'line-width': 2 } });
      setRings(prev => [...prev, { id, lat: e.lngLat.lat, lng: e.lngLat.lng, radiusM, color }]);
    };
    clickHandlerRef.current = handler;
    if (map.getCanvas) map.getCanvas().style.cursor = 'crosshair';
    map.on('click', handler);
    return () => {
      if (map.getCanvas) map.getCanvas().style.cursor = '';
      if (clickHandlerRef.current) map.off('click', clickHandlerRef.current);
    };
  }, [map, radius, unit, color, opacity]);

  const removeRing = (r: Ring) => {
    if (map.getLayer(`${r.id}-fill`)) map.removeLayer(`${r.id}-fill`);
    if (map.getLayer(`${r.id}-line`)) map.removeLayer(`${r.id}-line`);
    if (map.getSource(r.id)) map.removeSource(r.id);
    setRings(prev => prev.filter(x => x.id !== r.id));
  };

  const clearAll = () => {
    ringsRef.current.forEach(removeRing);
    setRings([]);
  };

  const displayRadius = (r: Ring) => {
    const ft = r.radiusM * FT_PER_M;
    return ft < 1320 ? `${Math.round(ft)} ft` : `${(ft / 5280).toFixed(2)} mi`;
  };

  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-52 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">Buffer Ring</div>
      <div className="text-rmpg-400 text-[10px]">Click map to place ring</div>
      <div className="flex gap-1 items-center">
        <input value={radius} onChange={e => setRadius(e.target.value)} placeholder="Radius…"
          type="number" min="1"
          className="flex-1 bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px]" />
        {(['ft', 'mi'] as const).map(u => (
          <button key={u} onClick={() => setUnit(u)}
            className={`px-2 py-1 rounded text-[10px] ${unit === u ? 'bg-brand-500 text-black font-bold' : 'bg-surface-raised text-rmpg-300'}`}>
            {u}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        {COLORS.map(c => (
          <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
            className={`w-5 h-5 rounded border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-rmpg-400 text-[10px]">Opacity</span>
        <input type="range" min="0.1" max="0.8" step="0.05" value={opacity}
          onChange={e => setOpacity(Number(e.target.value))} className="flex-1" />
      </div>
      {rings.length > 0 && (
        <div className="space-y-1 border-t border-surface-raised pt-2">
          {rings.map(r => (
            <div key={r.id} className="flex justify-between text-rmpg-300">
              <span>{displayRadius(r)}</span>
              <button onClick={() => removeRing(r)} className="text-red-400 hover:text-red-300 text-[10px]">✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={clearAll}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Clear All
        </button>
        <button onClick={onClose}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Done
        </button>
      </div>
    </div>
  );
}
