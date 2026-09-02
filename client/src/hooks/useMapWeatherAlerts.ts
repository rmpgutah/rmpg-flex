/**
 * useMapWeatherAlerts — active NWS watches / warnings / advisories as a
 * severity-coloured polygon layer on the Mapbox map.
 *
 * Data comes from our own Worker (`/api/weather/alerts`), not directly from
 * api.weather.gov: NWS requires an identifying User-Agent, alerts reference
 * zone polygons that must be resolved and cached server-side, and the browser
 * would otherwise re-fetch ~36 polygons per poll. See src/routes/weather.ts.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { hasLayer, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { escapeHtml } from '../utils/sanitize';
import { devLog, devWarn } from '../utils/devLog';

// ── Types ─────────────────────────────────────────────────

export type AlertSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

export interface WeatherAlert {
  id: string;
  event: string;
  severity: AlertSeverity;
  urgency: string | null;
  certainty: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  area_desc: string | null;
  sender: string | null;
  effective: string | null;
  onset: string | null;
  expires: string | null;
  ends: string | null;
  zone_ids: string[];
  geometry: GeoJSON.Geometry | null;
}

interface ZoneGeometry {
  key: string;
  id: string;
  name: string | null;
  geometry: GeoJSON.Geometry;
}

interface AlertsApiResponse {
  ok?: boolean;
  code?: string;
  alerts?: WeatherAlert[];
  zones?: Record<string, ZoneGeometry>;
  counts?: { total: number; with_geometry: number };
}

export interface UseMapWeatherAlertsResult {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
  alerts: WeatherAlert[];
  /** Alerts with no polygon — renderable in a list, not on the map. */
  unmappedCount: number;
  loading: boolean;
  error: string | null;
  lastPolledAt: Date | null;
  refresh: () => void;
}

// ── Constants ─────────────────────────────────────────────

const SOURCE = 'rmpg-weather-alerts';
const FILL_LAYER = 'rmpg-weather-alerts-fill';
const LINE_LAYER = 'rmpg-weather-alerts-line';
const POLL_INTERVAL_MS = 2 * 60 * 1000; // matches the Worker's 120 s alert cache

/**
 * Severity → colour.
 *
 * ⚠️ Literal hex is REQUIRED here. Mapbox GL cannot resolve `var(--sev-*)`
 * inside a paint property — it blanks the layer entirely. These values mirror
 * --sev-critical / --sev-high / --sev-warn / --sev-info from
 * client/src/styles/theme-palettes.css; keep them in sync by hand.
 */
export const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  Extreme: '#ef4444',  // --sev-critical
  Severe: '#f97316',   // --sev-high
  Moderate: '#f59e0b', // --sev-warn
  Minor: '#facc15',    // --sev-caution
  Unknown: '#60a5fa',  // --sev-info
};

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0,
};

/**
 * Build one GeoJSON feature per alert, merging its zone polygons.
 *
 * An alert may carry its own inline polygon (storm-based warnings do) OR
 * reference zones (most products). Inline geometry wins — it is the precise
 * warned area, whereas the zone is the whole administrative region.
 *
 * Features are emitted LOWEST severity first so that Mapbox's painter's-order
 * draws Extreme on top; an Extreme warning hidden under a Heat Advisory is
 * exactly the failure that matters here.
 */
export function buildAlertFeatures(
  alerts: WeatherAlert[],
  zones: Record<string, ZoneGeometry>,
): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];

  for (const alert of alerts) {
    let geometry: GeoJSON.Geometry | null = alert.geometry ?? null;

    if (!geometry) {
      const polys: GeoJSON.Position[][][] = [];
      for (const key of alert.zone_ids) {
        const g = zones[key]?.geometry;
        if (!g) continue;
        if (g.type === 'Polygon') polys.push((g as GeoJSON.Polygon).coordinates);
        else if (g.type === 'MultiPolygon') polys.push(...(g as GeoJSON.MultiPolygon).coordinates);
      }
      if (polys.length > 0) geometry = { type: 'MultiPolygon', coordinates: polys };
    }

    if (!geometry) continue; // list-only alert — counted as unmapped

    features.push({
      type: 'Feature',
      id: alert.id,
      geometry,
      properties: {
        alert_id: alert.id,
        event: alert.event,
        severity: alert.severity,
        color: SEVERITY_COLORS[alert.severity] ?? SEVERITY_COLORS.Unknown,
        headline: alert.headline ?? '',
        area_desc: alert.area_desc ?? '',
        expires: alert.expires ?? '',
        sender: alert.sender ?? '',
        instruction: alert.instruction ?? '',
      },
    });
  }

  return features.sort(
    (a, b) =>
      (SEVERITY_RANK[(a.properties?.severity as AlertSeverity) ?? 'Unknown'] ?? 0) -
      (SEVERITY_RANK[(b.properties?.severity as AlertSeverity) ?? 'Unknown'] ?? 0),
  );
}

/** "until 10:00 PM" for the popup, in Mountain Time. */
const EXPIRY_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver',
});

export function formatExpiry(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso); // new-date-ok — NWS emits full ISO-8601 with offset
  return Number.isNaN(d.getTime()) ? null : EXPIRY_FMT.format(d);
}

// ── Hook ──────────────────────────────────────────────────

export function useMapWeatherAlerts(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  area = 'UT',
): UseMapWeatherAlertsResult {
  const [enabled, setEnabled] = useState(false);
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [zones, setZones] = useState<Record<string, ZoneGeometry>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<Date | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const features = useMemo(() => buildAlertFeatures(alerts, zones), [alerts, zones]);
  const unmappedCount = alerts.length - features.length;

  const removeLayers = useCallback(() => {
    if (!map) return;
    safeRemoveLayer(map, LINE_LAYER);
    safeRemoveLayer(map, FILL_LAYER);
    safeRemoveSource(map, SOURCE);
  }, [map]);

  const render = useCallback((fc: GeoJSON.Feature[]) => {
    if (!map) return;
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: fc };
    const existing = map.getSource(SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (existing) { existing.setData(data); return; }

    map.addSource(SOURCE, { type: 'geojson', data });
    map.addLayer({
      id: FILL_LAYER,
      type: 'fill',
      source: SOURCE,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 },
    });
    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: SOURCE,
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.9 },
    });
    devLog('[WeatherAlerts] Rendered', fc.length, 'alert polygons');
  }, [map]);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<AlertsApiResponse>(`/weather/alerts?area=${encodeURIComponent(area)}`);
      if (res?.ok === false) {
        setError(res.code === 'nws_unavailable' ? 'NWS feed unavailable' : 'Alert feed error');
        setAlerts([]);
        setZones({});
        return;
      }
      setAlerts(Array.isArray(res?.alerts) ? res.alerts : []);
      setZones(res?.zones ?? {});
      setError(null);
      setLastPolledAt(new Date()); // new-date-ok — wall-clock stamp, no parsing
    } catch (err) {
      devWarn('[WeatherAlerts] fetch failed', err);
      setError('Alert feed unreachable');
    } finally {
      setLoading(false);
    }
  }, [area]);

  // Poll while enabled; tear the layer down when disabled.
  useEffect(() => {
    if (!map || !mapLoaded || !enabled) {
      removeLayers();
      return;
    }
    fetchAlerts();
    const interval = setInterval(fetchAlerts, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [map, mapLoaded, enabled, fetchAlerts, removeLayers, refreshTick]);

  // Re-render whenever the feature set changes.
  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;
    render(features);
  }, [map, mapLoaded, enabled, features, render]);

  // Click → detail popup.
  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      if (!hasLayer(map, FILL_LAYER)) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: [FILL_LAYER] })[0];
      if (!hit) return;
      const p = (hit.properties ?? {}) as Record<string, string>;
      const expiry = formatExpiry(p.expires);

      popupRef.current?.remove();
      popupRef.current = new mapboxgl.Popup({ closeButton: true, maxWidth: '320px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="background:var(--surface-raised,#15212e);color:var(--text-primary,#e6edf5);padding:8px 12px;border:1px solid ${p.color};border-radius:2px;font-family:Arial,sans-serif;font-size:11px;">
            <div style="font-weight:700;color:${p.color};font-size:12px;">${escapeHtml(p.event ?? '')}</div>
            ${p.severity ? `<div style="color:var(--text-muted,#8fa3b8);font-size:9px;font-weight:700;letter-spacing:0.04em;">${escapeHtml(p.severity.toUpperCase())}</div>` : ''}
            ${p.area_desc ? `<div style="color:var(--text-muted,#8fa3b8);font-size:10px;margin-top:4px;">${escapeHtml(p.area_desc)}</div>` : ''}
            ${expiry ? `<div style="color:var(--text-primary,#e6edf5);font-size:10px;margin-top:4px;">Until ${escapeHtml(expiry)}</div>` : ''}
            ${p.instruction ? `<div style="color:var(--text-muted,#8fa3b8);font-size:10px;margin-top:6px;border-top:1px solid var(--border-subtle,#1e2b3a);padding-top:4px;">${escapeHtml(p.instruction.slice(0, 400))}</div>` : ''}
            ${p.sender ? `<div style="color:var(--text-muted,#8fa3b8);font-size:9px;margin-top:4px;">${escapeHtml(p.sender)}</div>` : ''}
          </div>
        `)
        .addTo(map);
    };

    map.on('click', FILL_LAYER, onClick);
    return () => { map.off('click', FILL_LAYER, onClick); };
  }, [map, mapLoaded, enabled]);

  // Re-add after a basemap style swap, which wipes custom sources/layers
  // without resetting mapLoaded. Same pattern as useMapWeatherRadar.
  useEffect(() => {
    if (!map) return;
    const onStyleLoad = () => { if (enabledRef.current) render(features); };
    map.on('style.load', onStyleLoad);
    return () => { map.off('style.load', onStyleLoad); };
  }, [map, render, features]);

  useEffect(() => () => {
    popupRef.current?.remove();
    removeLayers();
  }, [removeLayers]);

  return {
    enabled,
    toggle: useCallback(() => setEnabled((v) => !v), []),
    setEnabled,
    alerts,
    unmappedCount,
    loading,
    error,
    lastPolledAt,
    refresh: useCallback(() => setRefreshTick((t) => t + 1), []),
  };
}
