// Geospatial intelligence map inside the Intel Portal. Coordinate-bearing +
// geocoded intel as toggleable circle layers; clicking a point selects the
// entity into the shared context (right dossier panel) or navigates.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import mapboxgl from 'mapbox-gl';
import { getMapboxAccessToken, getMapboxTokenErrorMessage } from '../../utils/mapboxApiKey';
import { MAPBOX_STYLE_DARK, registerMapInstance, unregisterMapInstance } from '../../utils/mapboxLoader';
import { applyRmpgBasemap } from '../../utils/mapboxBasemap';
import { safeRemoveLayer, safeRemoveSource } from '../../utils/mapboxSafeLayer';
import { useIntelContext } from './IntelContext';
import { useIntelGeo } from './useIntelGeo';
import { LAYER_DEFS, toGeoJSON } from './map/geoLayers';
import { escapeHtml } from '../../utils/sanitize';
import { useWebglMapRecovery } from '../../hooks/useWebglMapRecovery';

const DAYS_OPTS = [1, 7, 30];

export default function IntelMapPage() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const webglRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const { rebuildNonce, attach, onMapLoaded } = useWebglMapRecovery();
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [active, setActive] = useState<Record<string, boolean>>(() => Object.fromEntries(LAYER_DEFS.map((l) => [l.key, true])));
  const { data, loading, days, setDays } = useIntelGeo(30);
  const { selectEntity } = useIntelContext();
  const navigate = useNavigate();

  // Create the map once (and again after a WebGL context-loss rebuild).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getMapboxAccessToken().catch(() => '');
      if (cancelled) return;
      if (!token) { setErr(getMapboxTokenErrorMessage()); return; }
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: ref.current!, style: MAPBOX_STYLE_DARK,
        center: [-111.891, 40.7608], zoom: 11,
        projection: 'mercator',
      });
      mapRef.current = map;
      registerMapInstance(map);
      webglRecoveryCleanupRef.current = attach(map, 'IntelMapPage');
      map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
      popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '260px' });
      map.on('load', () => { if (!cancelled) { onMapLoaded(map); setReady(true); } });
    })();
    return () => {
      cancelled = true;
      webglRecoveryCleanupRef.current?.();
      webglRecoveryCleanupRef.current = null;
      if (mapRef.current) { unregisterMapInstance(mapRef.current); mapRef.current.remove(); mapRef.current = null; }
      setReady(false);
    };
  }, [rebuildNonce]);

  // Sync layers whenever data / toggles change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const allFeatures: Array<[number, number]> = [];
    for (const def of LAYER_DEFS) {
      const srcId = `intel-${def.key}`;
      safeRemoveLayer(map, srcId);
      safeRemoveSource(map, srcId);
      if (!active[def.key]) continue;
      const feats = data.layers[def.key] || [];
      feats.forEach((f) => allFeatures.push([f.lng, f.lat]));
      map.addSource(srcId, { type: 'geojson', data: toGeoJSON(feats) as never });
      map.addLayer({
        id: srcId, type: 'circle', source: srcId,
        paint: { 'circle-color': def.color, 'circle-radius': 6, 'circle-stroke-color': '#000', 'circle-stroke-width': 1, 'circle-opacity': 0.85 },
      });
      map.on('click', srcId, (e) => {
        const p = e.features?.[0]?.properties as { entity_type?: string; entity_id?: number; label?: string } | undefined;
        if (!p?.entity_type) return;
        const type = p.entity_type, id = Number(p.entity_id);
        if (type === 'vehicle' || type === 'person') { selectEntity(type, id, p.label || `#${id}`); return; }
        if (type === 'warrant') { navigate(`/warrants?id=${id}`); return; }
        popupRef.current?.setLngLat(e.lngLat).setHTML(`<div style="font:11px monospace;color:#111">${escapeHtml(p.label || type)}</div>`).addTo(map);
      });
      map.on('mouseenter', srcId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', srcId, () => { map.getCanvas().style.cursor = ''; });
    }
    if (allFeatures.length) {
      const b = new mapboxgl.LngLatBounds();
      allFeatures.forEach((coord) => b.extend(coord));
      try { map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 400 }); } catch { /* single point */ }
    }
  }, [data, active, ready, selectEntity, navigate]);

  const toggle = (k: string) => setActive((a) => ({ ...a, [k]: !a[k] }));

  if (err) return <div className="p-4 text-[11px] text-red-400">{err}</div>;

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="absolute inset-0" />
      <div className="absolute top-2 left-2 z-10 bg-black/80 border border-border-default rounded-[2px] p-2 space-y-2">
        <div className="flex gap-1 items-center">
          {DAYS_OPTS.map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`font-mono text-[9px] px-2 py-[2px] rounded-[2px] border ${days === d ? 'border-brand-400 text-brand-300' : 'border-border-default text-fg-muted'}`}>
              {d === 1 ? '24h' : `${d}d`}
            </button>
          ))}
          {loading && <span className="font-mono text-[9px] text-rmpg-500">…</span>}
        </div>
        <div className="space-y-[2px]">
          {LAYER_DEFS.map((l) => {
            const n = (data.layers[l.key] || []).length;
            return (
              <button key={l.key} onClick={() => toggle(l.key)}
                className={`w-full flex items-center gap-2 px-1 py-[2px] rounded-[2px] ${active[l.key] ? '' : 'opacity-40'}`}>
                <span className="w-[8px] h-[8px] rounded-full shrink-0" style={{ background: l.color }} />
                <span className="text-[10px] text-rmpg-200 flex-1 text-left">{l.label}</span>
                <span className="font-mono text-[9px] text-rmpg-500">{n}</span>
              </button>
            );
          })}
        </div>
        {data.geocoding.pending > 0 && (
          <div className="text-[8px] text-rmpg-400 font-mono pt-1 border-t border-border-default">{data.geocoding.pending} locating… revisit to resolve</div>
        )}
      </div>
    </div>
  );
}
