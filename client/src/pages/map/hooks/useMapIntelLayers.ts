// ============================================================
// RMPG Flex — useMapIntelLayers Hook
// Intelligence data layers: warrants, trespass orders,
// registered offenders, and active BOLOs.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from '../../../hooks/useApi';

// ─── Types ──────────────────────────────────────────────────

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

// ─── Layer config ───────────────────────────────────────────

const LAYER_CONFIG: Record<IntelLayer, { color: string; label: string }> = {
  warrants:  { color: '#dc2626', label: 'Active Warrant' },
  trespass:  { color: '#f59e0b', label: 'Trespass Order' },
  offenders: { color: '#8b5cf6', label: 'Registered Offender' },
  bolos:     { color: '#dc2626', label: 'Active BOLO' },
};

// ─── API endpoints per layer ────────────────────────────────

const LAYER_ENDPOINTS: Record<IntelLayer, string> = {
  warrants: '/warrants?status=active&per_page=200',
  trespass: '/trespass-orders?status=active',
  offenders: '/offender-registry?per_page=200',
  bolos: '/comms/bolos/active',
};

// ─── Create marker HTML element using DOM API ───────────────

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

// ─── Build info window content using DOM API ────────────────

function buildInfoContent(layer: IntelLayer, record: IntelRecord): HTMLDivElement {
  const { color, label: title } = LAYER_CONFIG[layer];

  const container = document.createElement('div');
  container.style.cssText = 'font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#050505;padding:10px 12px;border-radius:4px;border:1px solid #222222';

  const heading = document.createElement('div');
  heading.style.cssText = `font-weight:bold;font-size:13px;margin-bottom:6px;color:${color}`;
  heading.textContent = title;
  container.appendChild(heading);

  const table = document.createElement('table');
  table.style.cssText = 'width:100%;font-size:11px;border-collapse:collapse';

  const addRow = (lbl: string, value: unknown) => {
    if (value == null || value === '') return;
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.style.cssText = 'color:#888888;padding:1px 6px 1px 0';
    tdLabel.textContent = lbl;
    const tdValue = document.createElement('td');
    tdValue.style.cssText = 'color:#e0e0e0';
    tdValue.textContent = String(value);
    tr.appendChild(tdLabel);
    tr.appendChild(tdValue);
    table.appendChild(tr);
  };

  const name = record.name || record.subject_name || record.full_name ||
    [record.first_name, record.last_name].filter(Boolean).join(' ');
  addRow('Name', name || undefined);

  if (layer === 'warrants') {
    addRow('Warrant #', record.warrant_number);
    addRow('Charge', record.charge || record.offense);
    addRow('Status', record.status);
  } else if (layer === 'trespass') {
    addRow('Location', record.location || record.address);
    addRow('Expires', record.expiration_date || record.expires_at);
  } else if (layer === 'offenders') {
    addRow('Type', record.offense_type || record.registration_type);
    addRow('Address', record.address);
    addRow('Status', record.compliance_status || record.status);
  } else if (layer === 'bolos') {
    addRow('Type', record.bolo_type || record.type);
    addRow('Description', record.description);
    addRow('Vehicle', record.vehicle_description);
    addRow('Issued', record.created_at || record.issued_at);
  }

  container.appendChild(table);
  return container;
}

// ─── Circle polygon approximation ───────────────────────────

function circleCoords(center: [number, number], radiusM: number, segments = 64): [number, number][] {
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(center[1] * Math.PI / 180);
  const dLat = radiusM / metersPerDegLat;
  const dLng = radiusM / metersPerDegLng;
  const coords: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    coords.push([center[0] + dLng * Math.cos(angle), center[1] + dLat * Math.sin(angle)]);
  }
  return coords;
}

// ─── Source/layer helpers ───────────────────────────────────

function removeSourceAndLayer(map: mapboxgl.Map, layerId: string, sourceId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch { /* ignore */ }
}

// ─── Hook ───────────────────────────────────────────────────

export function useMapIntelLayers(
  map: mapboxgl.Map | null,
  enabledLayers: Record<IntelLayer, boolean>,
): UseMapIntelLayersReturn {
  const [counts, setCounts] = useState<Record<IntelLayer, number>>({
    warrants: 0, trespass: 0, offenders: 0, bolos: 0,
  });
  const [loading, setLoading] = useState<Record<IntelLayer, boolean>>({
    warrants: false, trespass: false, offenders: false, bolos: false,
  });
  const [errors, setErrors] = useState<Record<IntelLayer, number>>({
    warrants: 0, trespass: 0, offenders: 0, bolos: 0,
  });

  const dataCache = useRef<Record<IntelLayer, IntelRecord[]>>({
    warrants: [], trespass: [], offenders: [], bolos: [],
  });

  const markersRef = useRef<Record<IntelLayer, mapboxgl.Marker[]>>({
    warrants: [], trespass: [], offenders: [], bolos: [],
  });
  const offenderCircleRef = useRef<{ layerId: string; sourceId: string }[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  // ── Clear markers for a specific layer ──────────────────

  const clearLayer = useCallback((layer: IntelLayer) => {
    markersRef.current[layer].forEach((m) => { m.remove(); });
    markersRef.current[layer] = [];

    if (layer === 'offenders') {
      if (map) {
        offenderCircleRef.current.forEach(({ layerId, sourceId }) => {
          removeSourceAndLayer(map, layerId, sourceId);
        });
      }
      offenderCircleRef.current = [];
    }
  }, [map]);

  // ── Render markers for a layer ──────────────────────────

  const renderLayer = useCallback((layer: IntelLayer, records: IntelRecord[]) => {
    if (!map) return;

    clearLayer(layer);

    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px', offset: 15 });
    }

    const withCoords = records.filter(
      (r) => r.latitude != null && r.longitude != null && !isNaN(Number(r.latitude)) && !isNaN(Number(r.longitude)) && isFinite(Number(r.latitude)) && isFinite(Number(r.longitude)) && r.id != null
    );

    setCounts((prev) => ({ ...prev, [layer]: withCoords.length }));

    withCoords.forEach((record) => {
      const lat = Number(record.latitude);
      const lng = Number(record.longitude);

      const content = createMarkerElement(layer);
      content.title = String(record.name || record.subject_name || record.full_name || `${layer} #${record.id}`);
      content.style.zIndex = '20';

      content.addEventListener('click', () => {
        const infoContent = buildInfoContent(layer, record);
        popupRef.current?.setLngLat([lng, lat]).setDOMContent(infoContent).addTo(map);
      });

      const marker = new mapboxgl.Marker({ element: content })
        .setLngLat([lng, lat])
        .addTo(map);

      markersRef.current[layer].push(marker);

      // Add proximity circle for offenders
      if (layer === 'offenders') {
        const circlePoly = circleCoords([lng, lat], 300);
        const circleSourceId = `offender-circle-${record.id}-source`;
        const circleLayerId = `offender-circle-${record.id}-layer`;
        map.addSource(circleSourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [circlePoly] },
          },
        });
        map.addLayer({
          id: circleLayerId,
          type: 'fill',
          source: circleSourceId,
          paint: {
            'fill-color': '#8b5cf6',
            'fill-opacity': 0.06,
            'fill-outline-color': '#8b5cf6',
          },
        });
        offenderCircleRef.current.push({ layerId: circleLayerId, sourceId: circleSourceId });
      }
    });
  }, [map, clearLayer]);

  // ── Fetch and render for each layer ─────────────────────

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
  }, [map, enabledLayers, clearLayer, renderLayer]);

  // ── Cleanup on unmount ──────────────────────────────────

  useEffect(() => {
    return () => {
      const layers: IntelLayer[] = ['warrants', 'trespass', 'offenders', 'bolos'];
      layers.forEach((layer) => {
        markersRef.current[layer].forEach((m) => { m.remove(); });
        markersRef.current[layer] = [];
      });
      if (map) {
        offenderCircleRef.current.forEach(({ layerId, sourceId }) => {
          removeSourceAndLayer(map, layerId, sourceId);
        });
      }
      offenderCircleRef.current = [];
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, [map]);

  return { counts, loading, errors };
}
