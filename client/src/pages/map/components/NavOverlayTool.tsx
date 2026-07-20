import { useEffect, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { X } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { getSourceSafe, hasSource, safeRemoveLayer, safeRemoveSource } from '../../../utils/mapboxSafeLayer';
import PanelTitleBar from '../../../components/PanelTitleBar';
import IconButton from '../../../components/IconButton';

interface Step { maneuver: { instruction: string }; distance: number; duration: number; }
interface Route { geometry: { coordinates: [number, number][] }; legs: { steps: Step[] }[]; duration: number; distance: number; }
interface Props { map: mapboxgl.Map; onClose: () => void; }

const SOURCE_ROUTE = 'nav-route';
const LAYER_ROUTE = 'nav-route-layer';

function parseCoord(val: string): [number, number] | null {
  const parts = val.split(',').map(s => Number(s.trim()));
  if (parts.length !== 2 || parts.some(isNaN)) return null;
  return [parts[1], parts[0]]; // [lng, lat]
}

function fmtDist(m: number) {
  return m < 1609 ? `${Math.round(m * 3.28084)} ft` : `${(m * 0.000621371).toFixed(1)} mi`;
}

function fmtTime(sec: number) {
  const min = Math.round(sec / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function NavOverlayTool({ map, onClose }: Props) {
  const [origin, setOrigin] = useState('');
  const [dest, setDest] = useState('');
  const [route, setRoute] = useState<Route | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSource(map, SOURCE_ROUTE)) {
      map.addSource(SOURCE_ROUTE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: LAYER_ROUTE, type: 'line', source: SOURCE_ROUTE,
        paint: { 'line-color': '#1e5a9e', 'line-width': 5, 'line-opacity': 0.9 } });
    }
    return () => {
      safeRemoveLayer(map, LAYER_ROUTE);
      safeRemoveSource(map, SOURCE_ROUTE);
    };
  }, [map]);

  const getRoute = async () => {
    const originCoord = parseCoord(origin);
    const destCoord = parseCoord(dest);
    if (!originCoord) { setError('Invalid origin (use lat,lng)'); return; }
    if (!destCoord) { setError('Invalid destination (use lat,lng)'); return; }
    setLoading(true);
    setError(null);
    // Mapbox directions: coordinates as "lng,lat;lng,lat"
    const coords = `${originCoord[0]},${originCoord[1]};${destCoord[0]},${destCoord[1]}`;
    try {
      const data = await apiFetch<{ routes: Route[] }>(
        `/mapbox/directions?coordinates=${encodeURIComponent(coords)}&profile=driving-traffic&steps=true&geometries=geojson`
      );
      const r = data?.routes?.[0] ?? null;
      setRoute(r);
      if (r) {
        getSourceSafe<any>(map, SOURCE_ROUTE)?.setData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: r.geometry, properties: {} }],
        });
      }
    } catch {
      setError('Failed to get route');
    } finally {
      setLoading(false);
    }
  };

  const steps = route?.legs?.[0]?.steps ?? [];

  return (
    <div className="bg-surface-raised/95 border border-border-default backdrop-blur-sm w-60 text-xs space-y-2 p-2 max-h-[400px] flex flex-col" style={{ borderRadius: 2 }}>
      <PanelTitleBar title="Nav Overlay">
        <IconButton aria-label="Close" onClick={onClose} className="text-rmpg-400 hover:text-rmpg-200 p-0.5">
          <X className="w-3 h-3" />
        </IconButton>
      </PanelTitleBar>
      <input value={origin} onChange={e => setOrigin(e.target.value)}
        placeholder="Origin (lat,lng)…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 px-2 py-1 text-[10px]" style={{ borderRadius: 2 }} />
      <input value={dest} onChange={e => setDest(e.target.value)}
        placeholder="Destination (lat,lng)…"
        className="w-full bg-surface-base border border-surface-raised text-rmpg-200 px-2 py-1 text-[10px]" style={{ borderRadius: 2 }} />
      {error && <div className="text-red-400 text-[10px]">{error}</div>}
      {route && (
        <div className="text-rmpg-200 text-[10px] bg-surface-raised px-2 py-1" style={{ borderRadius: 2 }}>
          ETA: {fmtTime(route.duration)} · {fmtDist(route.distance)}
        </div>
      )}
      <button onClick={getRoute} disabled={loading}
        className="w-full bg-brand-500 text-black font-bold py-1 text-[10px] disabled:opacity-50" style={{ borderRadius: 2 }}>
        {loading ? 'Loading…' : 'Get Route'}
      </button>
      {steps.length > 0 && (
        <div className="overflow-y-auto flex-1 space-y-1 border-t border-surface-raised pt-1">
          {steps.map((s, i) => (
            <div key={i} className="flex justify-between text-rmpg-300 text-[10px]">
              <span className="flex-1 truncate pr-2">{s.maneuver.instruction}</span>
              <span className="shrink-0">{fmtDist(s.distance)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
