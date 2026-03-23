// ============================================================
// RMPG Flex — useMapIntelLayers Hook
// Intelligence data layers: warrants, trespass orders,
// registered offenders, and active BOLOs.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { getOverlayMarkerClass } from '../utils/mapMarkerBuilders';

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
  errors: Record<IntelLayer, number>; // Fix 46: error count tracking
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

  // Use a simple text symbol instead of SVG innerHTML
  const label = document.createElement('span');
  label.style.cssText = 'color: white; font-size: 12px; font-weight: bold; line-height: 1;';

  const symbols: Record<IntelLayer, string> = {
    warrants: '\u26A0',   // warning sign
    trespass: '\u2298',   // circle slash
    offenders: '\u2691',  // flag
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
  container.style.cssText = 'font-family:monospace;font-size:11px;color:#e0e0e0;min-width:200px;line-height:1.6;background:#0a0e14;padding:10px 12px;border-radius:4px;border:1px solid #1e2a3a';

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
    tdLabel.style.cssText = 'color:#6b7b8d;padding:1px 6px 1px 0';
    tdLabel.textContent = lbl;
    const tdValue = document.createElement('td');
    tdValue.style.cssText = 'color:#e0e0e0';
    tdValue.textContent = String(value);
    tr.appendChild(tdLabel);
    tr.appendChild(tdValue);
    table.appendChild(tr);
  };

  // Common name field
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

// ─── Hook ───────────────────────────────────────────────────

export function useMapIntelLayers(
  map: google.maps.Map | null,
  enabledLayers: Record<IntelLayer, boolean>,
): UseMapIntelLayersReturn {
  const [counts, setCounts] = useState<Record<IntelLayer, number>>({
    warrants: 0, trespass: 0, offenders: 0, bolos: 0,
  });
  const [loading, setLoading] = useState<Record<IntelLayer, boolean>>({
    warrants: false, trespass: false, offenders: false, bolos: false,
  });
  // Fix 46: error count tracking
  const [errors, setErrors] = useState<Record<IntelLayer, number>>({
    warrants: 0, trespass: 0, offenders: 0, bolos: 0,
  });

  // Cache fetched data so we don't refetch when toggling off/on
  const dataCache = useRef<Record<IntelLayer, IntelRecord[]>>({
    warrants: [], trespass: [], offenders: [], bolos: [],
  });

  // Map objects per layer (OverlayView-based markers)
  const markersRef = useRef<Record<IntelLayer, google.maps.OverlayView[]>>({
    warrants: [], trespass: [], offenders: [], bolos: [],
  });
  const circlesRef = useRef<google.maps.Circle[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  // ── Clear markers for a specific layer ──────────────────

  const clearLayer = useCallback((layer: IntelLayer) => {
    markersRef.current[layer].forEach((m) => { m.setMap(null); });
    markersRef.current[layer] = [];

    if (layer === 'offenders') {
      circlesRef.current.forEach((c) => c.setMap(null));
      circlesRef.current = [];
    }
  }, []);

  // ── Render markers for a layer ──────────────────────────

  const renderLayer = useCallback((layer: IntelLayer, records: IntelRecord[]) => {
    const OverlayMarkerClass = getOverlayMarkerClass();
    if (!map || !OverlayMarkerClass) return;

    clearLayer(layer);

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    // Fix 49: validate that records have required fields before rendering
    const withCoords = records.filter(
      (r) => r.latitude != null && r.longitude != null && !isNaN(Number(r.latitude)) && !isNaN(Number(r.longitude)) && isFinite(Number(r.latitude)) && isFinite(Number(r.longitude)) && r.id != null
    );

    setCounts((prev) => ({ ...prev, [layer]: withCoords.length }));

    withCoords.forEach((record) => {
      const lat = Number(record.latitude);
      const lng = Number(record.longitude);

      const content = createMarkerElement(layer);

      const marker = new OverlayMarkerClass({
        map,
        position: { lat, lng },
        content,
        title: String(record.name || record.subject_name || record.full_name || `${layer} #${record.id}`),
        zIndex: 20,
        onClick: () => {
          const infoContent = buildInfoContent(layer, record);
          infoWindowRef.current?.setContent(infoContent);
          infoWindowRef.current?.setPosition({ lat, lng });
          infoWindowRef.current?.open(map);
        },
      });

      markersRef.current[layer].push(marker as unknown as google.maps.OverlayView);

      // Add proximity circle for offenders
      if (layer === 'offenders') {
        const circle = new google.maps.Circle({
          center: { lat, lng },
          radius: 300,
          fillColor: '#8b5cf6',
          fillOpacity: 0.06,
          strokeColor: '#8b5cf6',
          strokeWeight: 1,
          strokeOpacity: 0.3,
          map,
          clickable: false,
          zIndex: 5,
        });
        circlesRef.current.push(circle);
      }
    });
  }, [map, clearLayer]);

  // ── Fetch and render for each layer ─────────────────────

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    let cancelled = false;
    const layers: IntelLayer[] = ['warrants', 'trespass', 'offenders', 'bolos'];

    layers.forEach((layer) => {
      if (!enabledLayers[layer]) {
        clearLayer(layer);
        setCounts((prev) => ({ ...prev, [layer]: 0 }));
        return;
      }

      // If we have cached data, render from cache
      if (dataCache.current[layer].length > 0) {
        renderLayer(layer, dataCache.current[layer]);
        return;
      }

      // Fetch fresh data
      setLoading((prev) => ({ ...prev, [layer]: true }));

      apiFetch<IntelRecord[] | { data?: IntelRecord[]; results?: IntelRecord[] }>(LAYER_ENDPOINTS[layer])
        .then((res) => {
          if (cancelled) return;
          // Handle both array and paginated responses
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
          // Fix 46: track error count per layer
          setErrors((prev) => ({ ...prev, [layer]: (prev[layer] || 0) + 1 }));
          console.warn(`[useMapIntelLayers] Failed to fetch ${layer}:`, err);
          // Fix 47: retry logic on individual layer fetch failure (max 2 retries)
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
                  .catch(() => { /* retry exhausted */ });
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
        markersRef.current[layer].forEach((m) => { m.setMap(null); });
        markersRef.current[layer] = [];
      });
      circlesRef.current.forEach((c) => c.setMap(null));
      circlesRef.current = [];
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
        infoWindowRef.current = null;
      }
    };
  }, []);

  return { counts, loading, errors }; // Fix 46: expose error counts
}
