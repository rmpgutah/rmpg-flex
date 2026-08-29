// ============================================================
// RMPG Flex — useMapInfoPanel Hook
// ============================================================
// Advanced info panel system for the Mapbox map. Replaces the
// Google Maps advanced InfoWindow with a richer, persistent
// panel that shows detailed information about clicked features
// including unit details, call details, property info, weather,
// and nearby points of interest.
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { escapeHtml } from '../utils/sanitize';
import { devLog } from '../utils/devLog';

// ── Types ─────────────────────────────────────────────────

export type InfoPanelType = 'unit' | 'call' | 'property' | 'location' | 'geofence';

export interface InfoPanelData {
  type: InfoPanelType;
  id: string;
  title: string;
  subtitle?: string;
  lngLat: [number, number];
  details: Record<string, string | number | boolean | null>;
  /** Nearby items within radius */
  nearby?: NearbyItem[];
  /** Weather conditions at the location */
  weather?: WeatherInfo | null;
  /** Reverse geocoded address */
  address?: string;
  color?: string;
}

export interface NearbyItem {
  type: 'unit' | 'call' | 'property';
  id: string;
  label: string;
  distance: string;
  color?: string;
}

export interface WeatherInfo {
  /** Pre-formatted display strings. Every field is optional — a missing
   *  upstream value must render as *nothing*, never as "NaN" / "undefined". */
  temp?: string;
  condition?: string;
  wind?: string;
  humidity?: string;
  /** "68°F (feels 71°F)" style detail line pieces. */
  feelsLike?: string;
  visibility?: string;
  pressure?: string;
  dewPoint?: string;
  observedAt?: string;
  hazardLevel?: 'none' | 'advisory' | 'warning';
  hazardReasons?: string[];
  icon?: string;
}

/** Wire shape of GET /api/weather (normalized block added 2026-08-02). */
interface WeatherApiResponse {
  temp_f?: number | null;
  feels_like_f?: number | null;
  condition?: string | null;
  humidity?: number | null;
  dew_point_f?: number | null;
  wind_mph?: number | null;
  wind_gust_mph?: number | null;
  wind_dir?: string | null;
  pressure_in?: number | null;
  visibility_mi?: number | null;
  observed_at?: string | null;
  hazard?: { level: 'none' | 'advisory' | 'warning'; reasons: string[] } | null;
  /** Raw Open-Meteo block, still emitted for older callers. */
  current?: { temperature_2m?: number; weather_code?: number } | null;
}

const WEATHER_ICONS: Record<string, string> = {
  Clear: '☀️', 'Mostly Clear': '🌤', 'Partly Cloudy': '⛅', Overcast: '☁️',
  Fog: '🌫', 'Freezing Fog': '🌫',
};

function weatherIcon(condition: string | null | undefined): string {
  if (!condition) return '🌡';
  if (WEATHER_ICONS[condition]) return WEATHER_ICONS[condition];
  if (/thunder/i.test(condition)) return '⛈';
  if (/snow/i.test(condition)) return '🌨';
  if (/rain|drizzle|shower/i.test(condition)) return '🌧';
  return '🌡';
}

/**
 * Map the API payload to display strings, dropping anything the upstream
 * provider didn't return. Returns null when there is nothing worth showing —
 * the caller then omits the weather row entirely rather than rendering an
 * empty separator run ("🌡 · · Wind"), which is what the raw-shape mismatch
 * produced before this normalizer existed.
 */
export function toWeatherInfo(res: WeatherApiResponse | null | undefined): WeatherInfo | null {
  if (!res) return null;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  const tempF = num(res.temp_f) ?? num(res.current?.temperature_2m);
  const feels = num(res.feels_like_f);
  const windMph = num(res.wind_mph);
  const gust = num(res.wind_gust_mph);
  const humidity = num(res.humidity);
  const vis = num(res.visibility_mi);
  const pressure = num(res.pressure_in);
  const dew = num(res.dew_point_f);
  const condition = res.condition && res.condition !== 'Unknown' ? res.condition : undefined;

  // Wind reads "8 mph NW" / "8 mph" / "8 mph NW G22" — the direction and gust
  // tokens are appended only when present.
  let wind: string | undefined;
  if (windMph != null) {
    wind = `${Math.round(windMph)} mph`;
    if (res.wind_dir) wind += ` ${res.wind_dir}`;
    if (gust != null && windMph != null && gust >= windMph + 5) wind += ` G${Math.round(gust)}`;
  }

  const info: WeatherInfo = {
    temp: tempF != null ? `${Math.round(tempF)}°F` : undefined,
    condition,
    wind,
    humidity: humidity != null ? `${Math.round(humidity)}%` : undefined,
    feelsLike: feels != null && tempF != null && Math.round(feels) !== Math.round(tempF)
      ? `feels ${Math.round(feels)}°F`
      : undefined,
    visibility: vis != null ? `${vis} mi vis` : undefined,
    pressure: pressure != null ? `${pressure.toFixed(2)} inHg` : undefined,
    dewPoint: dew != null ? `dew ${Math.round(dew)}°F` : undefined,
    observedAt: res.observed_at ?? undefined,
    hazardLevel: res.hazard?.level,
    hazardReasons: res.hazard?.reasons?.length ? res.hazard.reasons : undefined,
    icon: weatherIcon(condition),
  };

  const hasAnything = Boolean(
    info.temp || info.condition || info.wind || info.humidity || info.hazardReasons,
  );
  return hasAnything ? info : null;
}

export interface UseMapInfoPanelResult {
  /** Currently shown panel data */
  panel: InfoPanelData | null;
  /** Show info panel for a specific entity */
  showPanel: (data: InfoPanelData) => void;
  /** Close the info panel */
  closePanel: () => void;
  /** Generate a panel from a map click location */
  showLocationInfo: (lng: number, lat: number) => void;
  /** Whether panel is loading data */
  loading: boolean;
}

// ── Helpers ───────────────────────────────────────────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistanceMi(meters: number): string {
  const mi = meters / 1609.344;
  return mi >= 0.1 ? `${mi.toFixed(1)} mi` : `${Math.round(meters * 3.28084)} ft`;
}

/**
 * Weather rows for the map popup.
 *
 * Mapbox popups are ordinary DOM inside the document, so CSS custom properties
 * DO resolve here — unlike Mapbox *paint* properties, where `var()` blanks the
 * layer and literal hex is mandatory. Hex fallbacks are supplied so the popup
 * still reads correctly if a palette block ever omits a variable.
 */
function renderWeatherBlock(w: WeatherInfo): string {
  const primary = [w.temp, w.feelsLike, w.condition].filter(Boolean) as string[];
  const secondary = [
    w.wind ? `Wind ${w.wind}` : null,
    w.humidity ? `RH ${w.humidity}` : null,
    w.dewPoint,
    w.visibility,
    w.pressure,
  ].filter(Boolean) as string[];

  const hazardColor = w.hazardLevel === 'warning'
    ? 'var(--sev-critical, #ef4444)'
    : 'var(--sev-warn, #f59e0b)';

  const rows: string[] = [];
  if (primary.length) {
    rows.push(
      `<div style="color:var(--text-primary,#e6edf5);font-size:11px;margin-top:4px;">` +
      `${w.icon ?? '🌡'} ${primary.map(escapeHtml).join(' · ')}</div>`,
    );
  }
  if (secondary.length) {
    rows.push(
      `<div style="color:var(--text-muted,#8fa3b8);font-size:10px;margin-top:1px;">` +
      `${secondary.map(escapeHtml).join(' · ')}</div>`,
    );
  }
  if (w.hazardReasons?.length) {
    rows.push(
      `<div style="color:${hazardColor};font-size:10px;font-weight:700;margin-top:3px;">` +
      `⚠ ${w.hazardReasons.map(escapeHtml).join(' · ')}</div>`,
    );
  }
  return rows.join('');
}

// ── Hook ──────────────────────────────────────────────────

export function useMapInfoPanel(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
  units: Array<{ id: string; call_sign: string; latitude: number | null; longitude: number | null; status: string }>,
  calls: Array<{ id: string; call_number: string; latitude: number | null; longitude: number | null; priority: string; incident_type: string }>,
): UseMapInfoPanelResult {
  const [panel, setPanel] = useState<InfoPanelData | null>(null);
  const [loading, setLoading] = useState(false);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const showPanel = useCallback((data: InfoPanelData) => {
    setPanel(data);

    if (!map) return;
    popupRef.current?.remove();

    // Show a compact popup on the map at the location
    const popup = new mapboxgl.Popup({
      closeButton: true,
      closeOnClick: false,
      className: 'mapbox-popup-dark',
      maxWidth: '280px',
    })
      .setLngLat(data.lngLat)
      .setHTML(`
        <div style="background:var(--surface-raised,#15212e);color:var(--text-primary,#e6edf5);padding:8px 12px;border:1px solid var(--border-default,#2a3a4d);border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;">
          <div style="font-weight:700;color:${data.color || 'var(--panel-header-color,#c3ccd6)'};font-size:12px;margin-bottom:2px;">${escapeHtml(data.title)}</div>
          ${data.subtitle && data.subtitle !== data.address ? `<div style="color:var(--text-muted,#8fa3b8);font-size:10px;">${escapeHtml(data.subtitle)}</div>` : ''}
          ${data.address ? `<div style="color:var(--text-muted,#8fa3b8);font-size:10px;margin-top:4px;">📍 ${escapeHtml(data.address)}</div>` : ''}
          ${data.weather ? renderWeatherBlock(data.weather) : ''}
          ${data.nearby && data.nearby.length > 0 ? `
            <div style="border-top:1px solid #222;margin-top:4px;padding-top:4px;">
              <div style="color:var(--panel-header-color,#c3ccd6);font-size:9px;font-weight:700;">NEARBY</div>
              ${data.nearby.slice(0, 5).map(n =>
                `<div style="font-size:10px;color:#aaa;margin-top:1px;">
                  <span style="color:${n.color || '#888'};">●</span> ${escapeHtml(n.label)} — ${escapeHtml(n.distance)}
                </div>`
              ).join('')}
            </div>
          ` : ''}
        </div>
      `)
      .addTo(map);

    popup.on('close', () => setPanel(null));
    popupRef.current = popup;
  }, [map]);

  const closePanel = useCallback(() => {
    setPanel(null);
    popupRef.current?.remove();
    popupRef.current = null;
  }, []);

  const showLocationInfo = useCallback(async (lng: number, lat: number) => {
    setLoading(true);

    // Find nearby units and calls
    const nearbyItems: NearbyItem[] = [];

    for (const u of units) {
      if (u.latitude == null || u.longitude == null) continue;
      const dist = haversineMeters(lat, lng, u.latitude, u.longitude);
      if (dist < 8046) { // within 5 miles
        nearbyItems.push({
          type: 'unit',
          id: u.id,
          label: u.call_sign,
          distance: formatDistanceMi(dist),
          color: 'var(--sev-ok)',
        });
      }
    }

    for (const c of calls) {
      if (c.latitude == null || c.longitude == null) continue;
      const dist = haversineMeters(lat, lng, c.latitude, c.longitude);
      if (dist < 8046) {
        nearbyItems.push({
          type: 'call',
          id: c.id,
          label: `${c.call_number} (P${c.priority})`,
          distance: formatDistanceMi(dist),
          color: 'var(--sev-critical)',
        });
      }
    }

    // Sort by distance
    nearbyItems.sort((a, b) => {
      const distA = parseFloat(a.distance);
      const distB = parseFloat(b.distance);
      return distA - distB;
    });

    // Try reverse geocode for address
    let address = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    try {
      const geocodeResult = await apiFetch<{ results: Array<{ full_address: string }> }>(
        `/mapbox/geocode/reverse?lng=${lng}&lat=${lat}&limit=1`
      );
      if (geocodeResult?.results?.[0]?.full_address) {
        address = geocodeResult.results[0].full_address;
      }
    } catch { /* use coords as fallback */ }

    // Try weather. `apiFetch<T>` is a cast, not a validator — every field is
    // re-checked inside toWeatherInfo(), which is why a shape drift now yields
    // a missing row instead of a rendered "NaN°F ... Wind NaN mph undefined".
    let weather: WeatherInfo | null = null;
    try {
      const weatherData = await apiFetch<WeatherApiResponse>(
        `/weather?lat=${lat}&lng=${lng}`,
      );
      weather = toWeatherInfo(weatherData);
    } catch { /* weather is optional */ }

    const data: InfoPanelData = {
      type: 'location',
      id: `loc-${lng}-${lat}`,
      title: 'Location Info',
      subtitle: address,
      lngLat: [lng, lat],
      details: { latitude: lat, longitude: lng },
      nearby: nearbyItems,
      weather,
      address,
      color: '#3b82f6',
    };

    showPanel(data);
    setLoading(false);
    devLog('[InfoPanel] Location info opened at', lng, lat);
  }, [units, calls, showPanel]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      popupRef.current?.remove();
    };
  }, []);

  return { panel, showPanel, closePanel, showLocationInfo, loading };
}
