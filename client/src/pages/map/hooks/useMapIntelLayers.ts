import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';
import { getOverlayMarkerClass } from '../utils/mapMarkerBuilders';
import { whenStyleReady } from '../utils/safeAddSource';

export type IntelLayer = 'warrants' | 'trespass' | 'offenders' | 'bolos';

interface IntelRecord {
  id: number;
  latitude?: number | null;
  longitude?: number | null;
  [key: string]: unknown;
}

interface UseMapIntelLayersReturn {
  counts: Record<IntelLayer, number>;
  loading: Record<IntelLayer, boolean>;
  errors: Record<IntelLayer, number>;
}

const LAYER_CONFIG: Record<IntelLayer, { color: string; label: string }> = {
  warrants:  { color: '#dc2626', label: 'Active Warrant' },
  trespass:  { color: '#f59e0b', label: 'Trespass Order' },
  offenders: { color: '#8b5cf6', label: 'Registered Offender' },
  bolos:     { color: '#dc2626', label: 'Active BOLO' },
};

const LAYER_ENDPOINTS: Record<IntelLayer, string> = {
  warrants: '/warrants?status=active&per_page=200',
  trespass: '/trespass-orders?status=active',
  offenders: '/offender-registry?per_page=200',
  bolos: '/comms/bolos/active',
};

function createMarkerElement(layer: IntelLayer): HTMLDivElement {
  const { color } = LAYER_CONFIG[layer];

  const el = document.createElement('div');
  el.style.cssText = `
    background: ${color};
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid white;
    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
    cursor: pointer;
  `;

  const label = document.createElement('span');
  label.style.cssText = 'color: white; font-size: 12px; font-weight: bold; line-height: 1;';

  const symbols: Record<IntelLayer, string> = {
    warrants: '\u26A0',
    trespass: '\u2298',
    offenders: '\u2691',
    bolos: '!',
  };
  label.textContent = symbols[layer];
  el.appendChild(label);

  return el;
}

function buildInfoContent(layer: IntelLayer, record: IntelRecord): string {
  const { color, label: title } = LAYER_CONFIG[layer];

  const name = record.name || record.subject_name || record.full_name ||
    [record.first_name, record.last_name].filter(Boolean).join(' ');

  let rows = '';
  if (name) rows += `<tr><td style="color:#888888;padding:1px 6px 1px 0">Name</td><td style="color:#e0e0e0">${name}</td></tr>`;

  if (layer === 'warrants') {
    if (record.warrant_number) rows += `<tr><td style="color:#888888;padding:1px 6px 1px 0">Warrant #</td><td style="color:#e0e0e0">${record.warrant_number}</td></tr>`;
    if (record.charge || record.offense) rows += `<tr><td style="color:#888888;padding:1px 6px 1px 0">Charge</td><td style="color:#e0e0e0">${record.charge || record.offense}</td></tr>`;
    if (record.status) rows += `<tr><td style="color:#888888;padding:1px 6px 1px 0">Status</td><td style="color:#e0e0e0">${record.status}</td></tr>`;
  } else if (layer === 'trespass') {
    if (record.location || record.address) rows += `<tr><td style="color:#888888;padding:1px 6px 1px 0">Location</td><td style="color:#e0e0e0">${record.location || record.address}</td></tr>`;
    if (record.expiration_date || record.expires_at) rows += `<tr><td style="color:#888888;padding:1px 6px 1px 0">Expires</td><td style="color:#e0e0e0">${record.expiration_date || record.expires_at}</td></tr>`;
  } else if (layer === 'offenders') {
    if (record.offense_type || record.registration_type) rows += `<tr><td style="color:#888888;padding:1px 6px 1px 0">Type</td><td style="color:#e0e0e0">${record.offense_type || record.registration_type}</td></tr>`;
    if (record.address) rows += `<tr><td style="color:#888888;padding:1px 6px 1px 0">Address</td><td style="color:#e0e0e0">${record.address}</td></tr>`;
    if (record.compliance_status || record.status) rows += `<tr><td style="color:#888888;padding:1px 6px 1px 0">Status</td><td style="color:#e0e0e0">${record.compliance_status || record.status}</td></tr>`;
  } else if (layer === 'bolos') {
    if (record.bolo_type || record.type) rows += `<tr><td style="color:#888888;padding:1px 6px 1px 0">Type</td><td style="color:#e0e0e0">${record.bolo_type || record.type}</td></tr>`;
    if (record.description) rows += `<tr><td style="color:#888888;padding:1px 6px 1px 0">Description</td><td style="color:#e0e0e0">${record.description}</td></tr>`;
    if (record.vehicle_description) rows += `<tr><td style="color:#888888;padding:1px 6px 1px 0">Vehicle</td><td style="color:#e0e0e0">${record.vehicle_description}</td></tr>`;
    if (record.created_at || record.issued_at) rows += `<tr><td style="color:#888888;padding:1px 6px 1px 0">Issued</td><td style="color:#e0e0e0">${record.created_at || record.issued_at}</td></tr>`;
  }

  return `
    <div style="font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222">
      <div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}">${title}</div>
      <table style="width:100%;font-size:11px;border-collapse:collapse">${rows}</table>
    </div>
  `;
}

export function useMapIntelLayers(
  map: mapboxgl.Map | null,
  enabledLayers: Record<IntelLayer, boolean>,
): UseMapIntelLayersReturn {
  const [counts, setCounts] = useState<Record<IntelLayer, number>>({ warrants: 0, trespass: 0, offenders: 0, bolos: 0 });
  const [loading, setLoading] = useState<Record<IntelLayer, boolean>>({ warrants: false, trespass: false, offenders: false, bolos: false });
  const [errors, setErrors] = useState<Record<IntelLayer, number>>({ warrants: 0, trespass: 0, offenders: 0, bolos: 0 });

  const dataCache = useRef<Record<IntelLayer, IntelRecord[]>>({ warrants: [], trespass: [], offenders: [], bolos: [] });
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const clearLayer = useCallback((layer: IntelLayer) => {
    if (!map) return;
    const srcId = `intel-${layer}`;
    if (map.getLayer(srcId)) map.removeLayer(srcId);
    if (map.getSource(srcId)) map.removeSource(srcId);
    if (layer === 'offenders') {
      const circId = `intel-${layer}-circles`;
      if (map.getLayer(circId)) map.removeLayer(circId);
      if (map.getSource(circId)) map.removeSource(circId);
    }
  }, [map]);

  const renderLayer = useCallback((layer: IntelLayer, records: IntelRecord[]) => {
    if (!map) return;

    clearLayer(layer);

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ maxWidth: '320px', closeButton: true, closeOnClick: false });
    }

    const withCoords = records.filter(
      (r) => r.latitude != null && r.longitude != null && !isNaN(Number(r.latitude)) && !isNaN(Number(r.longitude)) && isFinite(Number(r.latitude)) && isFinite(Number(r.longitude)) && r.id != null
    );

    setCounts((prev) => ({ ...prev, [layer]: withCoords.length }));

    if (withCoords.length === 0) return;

    const features = withCoords.map((record) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [Number(record.longitude), Number(record.latitude)] as [number, number] },
      properties: { id: record.id, name: record.name || record.subject_name || record.full_name || `${layer} #${record.id}` },
    }));

    const srcId = `intel-${layer}`;
    whenStyleReady(map, () => {
      map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({
        id: srcId,
        type: 'circle',
        source: srcId,
        paint: {
          'circle-color': LAYER_CONFIG[layer].color,
          'circle-radius': 10,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      });

      map.on('click', srcId, (e) => {
        const feature = e.features?.[0];
        if (!feature || !feature.properties) return;
        const record = withCoords.find(r => r.id === feature.properties?.id);
        if (!record) return;
        if (popupRef.current) {
          popupRef.current.setLngLat(e.lngLat).setHTML(buildInfoContent(layer, record)).addTo(map);
        }
      });

      if (layer === 'offenders') {
        const circId = `intel-${layer}-circles`;
        const circFeatures = withCoords.map((record) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [Number(record.longitude), Number(record.latitude)] as [number, number] },
          properties: {},
        }));
        map.addSource(circId, { type: 'geojson', data: { type: 'FeatureCollection', features: circFeatures } });
        map.addLayer({
          id: circId,
          type: 'circle',
          source: circId,
          paint: {
            'circle-color': '#8b5cf6',
            'circle-radius': 300,
            'circle-opacity': 0.06,
            'circle-stroke-color': '#8b5cf6',
            'circle-stroke-width': 1,
            'circle-stroke-opacity': 0.3,
          },
        });
      }
    });
  }, [map, clearLayer]);

  useEffect(() => {
    if (!map) return;

    let cancelled = false;
    const layers: IntelLayer[] = ['warrants', 'trespass', 'offenders', 'bolos'];

    layers.forEach((layer) => {
      if (!enabledLayers[layer]) {
        clearLayer(layer);
        setCounts((prev) => ({ ...prev, [layer]: 0 }));
        return;
      }

      if (dataCache.current[layer].length > 0) {
        renderLayer(layer, dataCache.current[layer]);
        return;
      }

      setLoading((prev) => ({ ...prev, [layer]: true }));

      apiFetch<IntelRecord[] | { data?: IntelRecord[]; results?: IntelRecord[] }>(LAYER_ENDPOINTS[layer])
        .then((res) => {
          if (cancelled) return;
          let records: IntelRecord[];
          if (Array.isArray(res)) {
            records = res;
          } else if (res && typeof res === 'object') {
            records = (res as any).data || (res as any).results || [];
          } else {
            records = [];
          }

          dataCache.current[layer] = records;
          if (enabledLayers[layer]) {
            renderLayer(layer, records);
          }
          setLoading((prev) => ({ ...prev, [layer]: false }));
        })
        .catch((err) => {
          if (cancelled) return;
          setLoading((prev) => ({ ...prev, [layer]: false }));
          setErrors((prev) => ({ ...prev, [layer]: (prev[layer] || 0) + 1 }));
          console.warn(`[useMapIntelLayers] Failed to fetch ${layer}:`, err);
          if ((errors[layer] || 0) < 2 && enabledLayers[layer]) {
            setTimeout(() => {
              if (!cancelled && enabledLayers[layer]) {
                apiFetch<IntelRecord[] | { data?: IntelRecord[]; results?: IntelRecord[] }>(LAYER_ENDPOINTS[layer])
                  .then((res) => {
                    if (cancelled) return;
                    let records: IntelRecord[];
                    if (Array.isArray(res)) records = res;
                    else if (res && typeof res === 'object') records = (res as any).data || (res as any).results || [];
                    else records = [];
                    dataCache.current[layer] = records;
                    if (enabledLayers[layer]) renderLayer(layer, records);
                  })
                  .catch((retryErr) => { console.warn(`[useMapIntelLayers] Retry for ${layer} also failed:`, retryErr); });
              }
            }, 5000);
          }
        });
    });

    return () => { cancelled = true; };
  }, [map, enabledLayers, clearLayer, renderLayer, errors]);

  useEffect(() => {
    return () => {
      const layers: IntelLayer[] = ['warrants', 'trespass', 'offenders', 'bolos'];
      layers.forEach((layer) => clearLayer(layer));
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, [clearLayer]);

  return { counts, loading, errors };
}
