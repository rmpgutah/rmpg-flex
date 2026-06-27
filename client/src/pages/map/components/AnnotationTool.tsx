// client/src/pages/map/components/AnnotationTool.tsx
import { useEffect, useRef, useState, useCallback } from 'react';
import type mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

interface Annotation {
  id: number;
  title: string;
  body: string | null;
  color: string;
  icon: string;
  lat: number;
  lng: number;
  creator_name?: string;
}

interface Props {
  map: mapboxgl.Map;
  onClose: () => void;
}

const SOURCE_ID = 'rmpg-annotations';
const LAYER_ID = 'rmpg-annotations-layer';
const COLORS = ['#d4a017', '#ef4444', '#22c55e', '#3b82f6', '#f97316'];

export default function AnnotationTool({ map, onClose }: Props) {
  const [pendingLng, setPendingLng] = useState<number | null>(null);
  const [pendingLat, setPendingLat] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const load = useCallback(() => {
    const bounds = (map as any).getBounds?.();
    const bboxParam = bounds
      ? `?bbox=${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`
      : '';
    apiFetch<Annotation[]>(`/map/annotations${bboxParam}`)
      .then(setAnnotations)
      .catch(() => {});
  }, [map]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const source = map.getSource(SOURCE_ID) as any;
    if (!source) {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer(LAYER_ID)) {
        map.addLayer({
          id: LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          paint: {
            'circle-radius': 8,
            'circle-color': ['get', 'color'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        });
      }
    } else {
      source.setData?.({
        type: 'FeatureCollection',
        features: annotations.map(a => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
          properties: { id: a.id, title: a.title, color: a.color },
        })),
      });
    }
    return () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map, annotations]);

  useEffect(() => {
    const handleClick = (e: any) => {
      setPendingLng(e.lngLat.lng);
      setPendingLat(e.lngLat.lat);
    };
    if (map.getCanvas) map.getCanvas().style.cursor = 'crosshair';
    map.on('click', handleClick);
    return () => {
      if (map.getCanvas) map.getCanvas().style.cursor = '';
      map.off('click', handleClick);
    };
  }, [map]);

  const handleSave = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    if (pendingLat === null || pendingLng === null) { setError('Click the map to place the pin first'); return; }
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/map/annotations', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), body: body || null, color, lat: pendingLat, lng: pendingLng }),
      });
      load();
      setTitle(''); setBody(''); setPendingLat(null); setPendingLng(null);
    } catch {
      setError('Failed to save annotation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tactical-dark border border-surface-raised rounded p-3 w-52 text-xs space-y-2 shadow-lg">
      <div className="text-brand-400 font-bold uppercase tracking-wider text-[10px]">Map Annotations</div>
      {pendingLat !== null
        ? <div className="text-rmpg-300 text-[10px]">📍 {pendingLat.toFixed(5)}, {pendingLng!.toFixed(5)}</div>
        : <div className="text-rmpg-400 text-[10px]">Click map to place pin</div>}
      <input value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Title…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px]" />
      <textarea value={body} onChange={e => setBody(e.target.value)}
        placeholder="Notes (optional)…" rows={2}
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-1 text-[10px] resize-none" />
      <div className="flex gap-1">
        {COLORS.map(c => (
          <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      {error && <div className="text-red-400 text-[10px]">{error}</div>}
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 bg-brand-500 text-black font-bold py-1 rounded text-[10px] disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onClose}
          className="flex-1 bg-surface-raised text-rmpg-300 py-1 rounded text-[10px]">
          Done
        </button>
      </div>
      {annotations.length > 0 && (
        <div className="border-t border-surface-raised pt-2 space-y-1">
          {annotations.slice(0, 5).map(a => (
            <div key={a.id} className="flex justify-between items-center">
              <span className="text-rmpg-200 truncate max-w-[120px]">{a.title}</span>
              <button onClick={async () => {
                await apiFetch(`/map/annotations/${a.id}`, { method: 'DELETE' });
                load();
              }} className="text-red-400 text-[10px] ml-1 hover:text-red-300">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
