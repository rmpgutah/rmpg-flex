// Historical CFS Response Address Pins — shows past dispatch call locations
// as map pin markers with address labels. Complements the existing call-history
// heatmap by providing distinct, labeled address markers for quick identification.
import { useCallback, useState, useRef, useEffect } from 'react';
import { parseTimestamp, formatDateTime } from '../utils/dateUtils';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import { safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { buildDetailPopupHtml } from '../pages/map/utils/mapMarkers';
import { formatIncidentType } from '../utils/caseNumbers';
import { formatEnumValue } from '../utils/formatters';
import { withAlpha } from '../utils/withAlpha';

interface HistoricalCfsPin {
  id: number;
  call_number: string;
  incident_type: string;
  priority: string;
  status: string;
  disposition: string | null;
  location_address: string;
  latitude: number;
  longitude: number;
  created_at: string;
  response_time_min: number | null;
}

const PIN_SOURCE_ID = 'rmpg-historical-cfs-pins-source';
const PIN_LAYER_ID = 'rmpg-historical-cfs-pins-layer';
const PIN_LABEL_LAYER_ID = 'rmpg-historical-cfs-pins-label';

export interface CfsPinsOptions {
  days?: number;
  status?: string[];
  types?: string[];
  priority?: string[];
  limit?: number;
  minZoomLabels?: number;
}

const DEFAULT_MIN_ZOOM_LABELS = 13;

// Priority color mapping for pin markers
const PRIORITY_COLORS: Record<string, string> = {
  P1: '#ef4444', '1': '#ef4444',
  P2: '#f97316', '2': '#f97316',
  P3: '#eab308', '3': '#eab308',
  P4: '#22c55e', '4': '#22c55e',
};

function getPriorityColor(priority: string): string {
  return PRIORITY_COLORS[priority] || '#6b7280';
}

// Build a Mapbox pin marker HTML element
function buildAddressPinHtml(priority: string, callNumber: string): HTMLDivElement {
  const color = getPriorityColor(priority);
  const el = document.createElement('div');
  el.className = 'rmpg-historical-cfs-pin';
  el.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
  `;

  // Pin body (teardrop shape)
  const pin = document.createElement('div');
  pin.style.cssText = `
    width: 24px;
    height: 24px;
    background: ${color};
    border: 2px solid #0a0a0a;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 8px ${withAlpha(color, '66')};
  `;

  // Inner dot
  const dot = document.createElement('div');
  dot.style.cssText = `
    width: 8px;
    height: 8px;
    background: #0a0a0a;
    border-radius: 50%;
    transform: rotate(45deg);
  `;
  pin.appendChild(dot);
  el.appendChild(pin);

  // Call number label below pin
  if (callNumber) {
    const label = document.createElement('div');
    label.style.cssText = `
      background: #0a0a0a;
      color: ${color};
      font: 700 8px 'Arial, sans-serif';
      padding: 1px 4px;
      border-radius: 2px;
      margin-top: 2px;
      white-space: nowrap;
      border: 1px solid ${withAlpha(color, '44')};
    `;
    label.textContent = callNumber;
    el.appendChild(label);
  }

  return el;
}

export function useHistoricalCfsPins(map: mapboxgl.Map | null) {
  const [pins, setPins] = useState<HistoricalCfsPin[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const visibleRef = useRef(false);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const lastPinsRef = useRef<HistoricalCfsPin[]>([]);
  const lastMinZoomLabelsRef = useRef(DEFAULT_MIN_ZOOM_LABELS);
  const handlersBoundRef = useRef(false);

  const clearFromMap = useCallback(() => {
    if (!map) return;
    visibleRef.current = false;
    popupRef.current?.remove();
    popupRef.current = null;

    // Remove all markers
    for (const marker of markersRef.current) {
      marker.remove();
    }
    markersRef.current = [];

    // Clean up source/layers if they exist
    try {
      [PIN_LAYER_ID, PIN_LABEL_LAYER_ID].forEach((id) => {
        safeRemoveLayer(map, id);
      });
      safeRemoveSource(map, PIN_SOURCE_ID);
    } catch { /* ignore */ }
  }, [map]);

  const renderOnMap = useCallback((cfsPins: HistoricalCfsPin[], m: mapboxgl.Map, minZoomLabels: number) => {
    popupRef.current?.remove();
    popupRef.current = null;

    // Remove existing markers
    for (const marker of markersRef.current) {
      marker.remove();
    }
    markersRef.current = [];

    visibleRef.current = true;
    lastPinsRef.current = cfsPins;
    lastMinZoomLabelsRef.current = minZoomLabels;

    // Create markers for each pin
    for (const pin of cfsPins) {
      const el = buildAddressPinHtml(pin.priority, pin.call_number);

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([pin.longitude, pin.latitude])
        .addTo(m);

      // Add click handler
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        popupRef.current?.remove();

        popupRef.current = new mapboxgl.Popup({ offset: 12, closeButton: true, className: 'mapbox-popup-dark' })
          .setLngLat([pin.longitude, pin.latitude])
          .setHTML(buildDetailPopupHtml(`${pin.call_number} — Historical Response`, [
            ['Type', pin.incident_type ? formatIncidentType(pin.incident_type) : null],
            ['Priority', pin.priority],
            ['Status', pin.status ? formatEnumValue(pin.status) : null],
            ['Disposition', pin.disposition],
            ['Address', pin.location_address],
            ['Response Time', pin.response_time_min != null ? `${pin.response_time_min} min` : null],
            ['Occurred', pin.created_at ? formatDateTime(pin.created_at) : null],
          ]))
          .addTo(m);
      });

      markersRef.current.push(marker);
    }
  }, []);

  const fetchPins = useCallback(async (options: CfsPinsOptions = {}) => {
    if (!map) return;
    const { days = 30, status, types, priority, limit = 2000, minZoomLabels = DEFAULT_MIN_ZOOM_LABELS } = options;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days), limit: String(limit) });
      if (status?.length) params.set('status', status.join(','));
      if (types?.length) params.set('types', types.join(','));
      if (priority?.length) params.set('priority', priority.join(','));

      const data = await apiFetch<HistoricalCfsPin[]>(`/dispatch/history-map?${params}`);
      const pinData = Array.isArray(data) ? data : [];
      setPins(pinData);
      setTotal(pinData.length);

      whenStyleReady(map, () => {
        renderOnMap(pinData, map, minZoomLabels);
      });
    } catch (err) {
      console.warn('[useHistoricalCfsPins] fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load historical CFS pins');
    } finally {
      setLoading(false);
    }
  }, [map, renderOnMap]);

  const clear = useCallback(() => {
    clearFromMap();
    setPins([]);
    setTotal(0);
    setError(null);
  }, [clearFromMap]);

  // Basemap-switch resilience
  useEffect(() => {
    if (!map) return;
    const onStyleLoad = () => {
      if (!visibleRef.current) return;
      renderOnMap(lastPinsRef.current, map, lastMinZoomLabelsRef.current);
    };
    map.on('style.load', onStyleLoad);
    return () => { map.off('style.load', onStyleLoad); };
  }, [map, renderOnMap]);

  // Reset per-map handler tracking
  useEffect(() => {
    handlersBoundRef.current = false;
  }, [map]);

  return { pins, total, loading, error, fetchPins, clear };
}
