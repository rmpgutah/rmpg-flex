// ============================================================
// RMPG Flex — useMapGeofenceAlerts Hook
// ============================================================
// Premise alerts and geofence notifications on the Mapbox map.
// Replaces Google Maps InfoWindow-based premise alerting.
// When enabled, clicking a location on the map queries for
// premise alerts and displays a styled popup with hazard info.
// Also renders active geofence zones on the map.
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { escapeHtml } from '../utils/sanitize';
import { devLog, devWarn } from '../utils/devLog';
import { asArray } from '../utils/asArray';
import { safeRemoveLayer, safeRemoveSource, getSourceSafe } from '../utils/mapboxSafeLayer';
import { withAlpha } from '../utils/withAlpha';

// ── Types ─────────────────────────────────────────────────

export interface PremiseAlertInfo {
  id: number;
  address: string;
  alert_type: string;
  alert_level: string;
  title: string;
  description?: string;
  flags: string;
}

export interface GeofenceZone {
  id: string;
  name: string;
  type: 'exclusion' | 'inclusion' | 'alert' | 'patrol_required';
  coordinates: [number, number][];
  color: string;
  active: boolean;
}

export interface UseMapGeofenceAlertsResult {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
  activeAlerts: PremiseAlertInfo[];
  geofences: GeofenceZone[];
  refreshGeofences: () => void;
}

// ── Constants ─────────────────────────────────────────────

const GEOFENCE_SOURCE = 'rmpg-geofences';
const GEOFENCE_FILL = 'rmpg-geofence-fill';
const GEOFENCE_LINE = 'rmpg-geofence-line';
const GEOFENCE_LABEL = 'rmpg-geofence-label';

const ALERT_LEVEL_COLORS: Record<string, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
};

const ZONE_TYPE_COLORS: Record<string, string> = {
  exclusion: '#ef4444',
  alert: '#f59e0b',
  inclusion: '#22c55e',
  patrol_required: '#3b82f6',
};

function buildAlertPopupHtml(alerts: PremiseAlertInfo[], address: string): string {
  if (alerts.length === 0) {
    return `
      <div style="background:#141414;color:#22c55e;padding:8px 12px;border:1px solid #222;border-radius:2px;font-family:'Arial, sans-serif';font-size:11px;">
        ✓ No premise alerts at this location
      </div>`;
  }

  const alertsHtml = alerts.map(a => {
    const color = ALERT_LEVEL_COLORS[a.alert_level] || '#888';
    return `
      <div style="margin-bottom:6px;padding:6px;background:${withAlpha(color, '11')};border-left:3px solid ${color};border-radius:2px;">
        <div style="font-weight:700;color:${color};font-size:10px;text-transform:uppercase;">${escapeHtml(a.alert_level)} — ${escapeHtml(a.alert_type)}</div>
        <div style="font-weight:600;color:#e0e0e0;margin-top:2px;">${escapeHtml(a.title)}</div>
        ${a.description ? `<div style="color:#888;font-size:10px;margin-top:2px;">${escapeHtml(a.description)}</div>` : ''}
        ${a.flags ? `<div style="margin-top:3px;">${a.flags.split(',').map(f =>
          `<span style="background:${withAlpha(color, '22')};color:${color};padding:1px 4px;border-radius:2px;font-size:8px;font-weight:700;margin-right:3px;">${escapeHtml(f.trim())}</span>`
        ).join('')}</div>` : ''}
      </div>`;
  }).join('');

  return `
    <div style="background:#141414;color:#e0e0e0;padding:8px 12px;border:1px solid #222;border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;min-width:220px;max-width:320px;">
      <div style="font-weight:700;color:#d4a017;margin-bottom:4px;font-size:10px;text-transform:uppercase;">⚠ PREMISE ALERTS (${alerts.length})</div>
      <div style="color:#888;font-size:10px;margin-bottom:6px;">${escapeHtml(address)}</div>
      ${alertsHtml}
    </div>`;
}

// ── Hook ──────────────────────────────────────────────────

export function useMapGeofenceAlerts(map: mapboxgl.Map | null, mapLoaded: boolean): UseMapGeofenceAlertsResult {
  const [enabled, setEnabled] = useState(false);
  const [activeAlerts, setActiveAlerts] = useState<PremiseAlertInfo[]>([]);
  const [geofences, setGeofences] = useState<GeofenceZone[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  // Fetch geofence zones
  const refreshGeofences = useCallback(async () => {
    try {
      // geofence_zones is the table DrawGeofenceTool.tsx actually writes to
      // (POST /geofences). This hook previously read '/dispatch/calls/geofences'
      // — a DIFFERENT table nothing else populates — so a zone drawn on the
      // map never showed up here; it looked like drawing silently failed.
      type GeofenceRow = {
        id: number; zone_name: string; zone_type: string;
        geojson_data: string; color: string; is_active: number;
      };
      const rows = await apiFetch<GeofenceRow[]>('/geofences');
      const parsed: GeofenceZone[] = asArray<GeofenceRow>(rows).flatMap((row) => {
        let fc: any;
        try { fc = JSON.parse(row.geojson_data); } catch { return []; }
        const features = Array.isArray(fc?.features) ? fc.features : [];
        return features
          .filter((f: any) => f?.geometry?.type === 'Polygon' && Array.isArray(f.geometry.coordinates?.[0]))
          .map((f: any) => ({
            id: String(row.id),
            name: row.zone_name,
            type: (row.zone_type as GeofenceZone['type']) || 'alert',
            coordinates: f.geometry.coordinates[0].slice(0, -1) as [number, number][], // drop closing point (GeoJSON ring repeats it; the renderer re-closes it itself)
            color: row.color,
            active: row.is_active === 1,
          }));
      });
      setGeofences(parsed);
    } catch (err) {
      devWarn('[GeofenceAlerts] Failed to fetch geofences', err);
    }
  }, []);

  // Load geofences on enable
  useEffect(() => {
    if (enabled) refreshGeofences();
  }, [enabled, refreshGeofences]);

  // Render geofence zones on map
  useEffect(() => {
    if (!map || !mapLoaded) return;

    if (!enabled || geofences.length === 0) {
      [GEOFENCE_LABEL, GEOFENCE_LINE, GEOFENCE_FILL].forEach(id => {
        safeRemoveLayer(map, id);
      });
      safeRemoveSource(map, GEOFENCE_SOURCE);
      return;
    }

    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: geofences
        .filter(g => g.active && g.coordinates.length >= 3)
        .map(g => ({
          type: 'Feature' as const,
          properties: {
            id: g.id,
            name: g.name,
            zoneType: g.type,
            color: ZONE_TYPE_COLORS[g.type] || g.color || '#888',
          },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[...g.coordinates, g.coordinates[0]]],
          },
        })),
    };

    const existingSource = getSourceSafe<mapboxgl.GeoJSONSource>(map, GEOFENCE_SOURCE);
    if (existingSource) {
      existingSource.setData(fc);
    } else {
      map.addSource(GEOFENCE_SOURCE, { type: 'geojson', data: fc });

      map.addLayer({
        id: GEOFENCE_FILL,
        type: 'fill',
        source: GEOFENCE_SOURCE,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.1,
        },
      });

      map.addLayer({
        id: GEOFENCE_LINE,
        type: 'line',
        source: GEOFENCE_SOURCE,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-dasharray': [3, 2],
          'line-opacity': 0.7,
        },
      });

      map.addLayer({
        id: GEOFENCE_LABEL,
        type: 'symbol',
        source: GEOFENCE_SOURCE,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': '#000',
          'text-halo-width': 1,
          'text-opacity': 0.8,
        },
      });

      devLog('[GeofenceAlerts] Geofence zones rendered:', geofences.length);
    }

    return () => {
      [GEOFENCE_LABEL, GEOFENCE_LINE, GEOFENCE_FILL].forEach(id => {
        safeRemoveLayer(map, id);
      });
      safeRemoveSource(map, GEOFENCE_SOURCE);
    };
  }, [map, mapLoaded, enabled, geofences]);

  // Click handler — query premise alerts via reverse geocode
  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;

    const onClick = async (e: mapboxgl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      popupRef.current?.remove();

      // Show loading popup
      const loadingPopup = new mapboxgl.Popup({
        closeButton: true, closeOnClick: false, className: 'mapbox-popup-dark', maxWidth: '340px',
      })
        .setLngLat([lng, lat])
        .setHTML(`<div style="background:#141414;color:#d4a017;padding:8px;font-size:10px;font-family:'Arial, sans-serif';">Checking premise alerts…</div>`)
        .addTo(map);
      popupRef.current = loadingPopup;

      try {
        const alerts = await apiFetch<PremiseAlertInfo[]>(
          `/dispatch/geography/premise-alerts?lat=${lat}&lng=${lng}&radius=100`
        );
        const found = alerts || [];
        setActiveAlerts(found);

        const address = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        if (popupRef.current === loadingPopup) {
          loadingPopup.setHTML(buildAlertPopupHtml(found, address));
        }
      } catch (err) {
        if (popupRef.current === loadingPopup) {
          loadingPopup.setHTML(`<div style="background:#141414;color:#ef4444;padding:8px;font-size:10px;font-family:'Arial, sans-serif';">Failed to check premise alerts</div>`);
        }
      }
    };

    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [map, mapLoaded, enabled]);

  const toggle = useCallback(() => setEnabled(v => !v), []);

  return { enabled, toggle, setEnabled, activeAlerts, geofences, refreshGeofences };
}
