import { useEffect, useRef, useState } from 'react';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import type mapboxgl from 'mapbox-gl';
import { X } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import PanelTitleBar from '../../../components/PanelTitleBar';
import IconButton from '../../../components/IconButton';

interface Props {
  map: mapboxgl.Map;
  onClose: () => void;
}

const ZONE_TYPES = ['alert', 'exclusion', 'inclusion', 'patrol_required'] as const;
type ZoneType = typeof ZONE_TYPES[number];
const COLORS = ['#d4a017', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#f97316'];

export default function DrawGeofenceTool({ map, onClose }: Props) {
  const drawRef = useRef<InstanceType<typeof MapboxDraw> | null>(null);
  const [mode, setMode] = useState<'polygon' | 'circle'>('polygon');
  const [color, setColor] = useState(COLORS[0]);
  const [zoneName, setZoneName] = useState('');
  const [zoneType, setZoneType] = useState<ZoneType>('alert');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      styles: [
        {
          id: 'draw-polygon-fill',
          type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: { 'fill-color': color, 'fill-opacity': 0.2 },
        },
        {
          id: 'draw-polygon-stroke',
          type: 'line',
          filter: ['all', ['==', '$type', 'Polygon']],
          paint: { 'line-color': color, 'line-width': 2 },
        },
        {
          id: 'draw-vertex',
          type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']],
          paint: { 'circle-radius': 5, 'circle-color': color },
        },
      ],
    });
    map.addControl(draw as any);
    drawRef.current = draw;
    draw.changeMode('draw_polygon');
    return () => {
      map.removeControl(draw as any);
      drawRef.current = null;
    };
  }, [map, color]);

  const handleSave = async () => {
    const draw = drawRef.current;
    if (!draw) return;
    const data = draw.getAll();
    if (!data.features.length) { setError('Draw a shape on the map first'); return; }
    if (!zoneName.trim()) { setError('Zone name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/geofences', {
        method: 'POST',
        body: JSON.stringify({
          zone_name: zoneName.trim(),
          zone_type: zoneType,
          geojson_data: JSON.stringify(data),
          color,
        }),
      });
      draw.deleteAll();
      setZoneName('');
      onClose();
    } catch {
      setError('Failed to save zone');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-surface-raised/95 border border-border-default backdrop-blur-sm w-52 text-xs space-y-2 p-2" style={{ borderRadius: 2 }}>
      <PanelTitleBar title="Create Geofence Zone">
        <IconButton
          aria-label="Close"
          onClick={() => { drawRef.current?.deleteAll(); onClose(); }}
          className="text-rmpg-400 hover:text-rmpg-200 p-0.5"
        >
          <X className="w-3 h-3" />
        </IconButton>
      </PanelTitleBar>
      <div className="flex gap-1">
        {(['polygon', 'circle'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 py-1 text-[10px] capitalize ${
              mode === m ? 'bg-brand-500 text-black font-bold' : 'bg-surface-raised text-rmpg-300'
            }`}
            style={{ borderRadius: 2 }}>
            {m}
          </button>
        ))}
      </div>
      <div className="flex gap-1 flex-wrap">
        {COLORS.map(c => (
          <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
            className={`w-5 h-5 border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c, borderRadius: 2 }} />
        ))}
      </div>
      <select value={zoneType} onChange={e => setZoneType(e.target.value as ZoneType)}
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 px-1 py-0.5 text-[10px]" style={{ borderRadius: 2 }}>
        {ZONE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input value={zoneName} onChange={e => setZoneName(e.target.value)}
        placeholder="Zone name…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 px-2 py-1 text-[10px]" style={{ borderRadius: 2 }} />
      {error && <div className="text-red-400 text-[10px]">{error}</div>}
      <div className="text-rmpg-400 text-[10px]">Click map to draw</div>
      <button onClick={handleSave} disabled={saving}
        className="w-full bg-brand-500 text-black font-bold py-1 text-[10px] disabled:opacity-50" style={{ borderRadius: 2 }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
