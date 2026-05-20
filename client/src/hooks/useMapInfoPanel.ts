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
  temp: string;
  condition: string;
  wind: string;
  humidity: string;
  icon?: string;
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
        <div style="background:#141414;color:#e0e0e0;padding:8px 12px;border:1px solid #222;border-radius:2px;font-family:system-ui,sans-serif;font-size:11px;">
          <div style="font-weight:700;color:${data.color || '#d4a017'};font-size:12px;margin-bottom:2px;">${escapeHtml(data.title)}</div>
          ${data.subtitle ? `<div style="color:#888;font-size:10px;">${escapeHtml(data.subtitle)}</div>` : ''}
          ${data.address ? `<div style="color:#666;font-size:10px;margin-top:4px;">📍 ${escapeHtml(data.address)}</div>` : ''}
          ${data.weather ? `<div style="color:#666;font-size:10px;margin-top:2px;">🌡 ${escapeHtml(data.weather.temp)} · ${escapeHtml(data.weather.condition)} · Wind ${escapeHtml(data.weather.wind)}</div>` : ''}
          ${data.nearby && data.nearby.length > 0 ? `
            <div style="border-top:1px solid #222;margin-top:4px;padding-top:4px;">
              <div style="color:#d4a017;font-size:9px;font-weight:700;">NEARBY</div>
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
          color: '#22c55e',
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
          color: '#ef4444',
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

    // Try weather
    let weather: WeatherInfo | null = null;
    try {
      const weatherData = await apiFetch<{
        temp_f: number;
        condition: string;
        wind_mph: number;
        wind_dir: string;
        humidity: number;
      }>(`/weather?lat=${lat}&lng=${lng}`);
      if (weatherData) {
        weather = {
          temp: `${Math.round(weatherData.temp_f)}°F`,
          condition: weatherData.condition,
          wind: `${Math.round(weatherData.wind_mph)} mph ${weatherData.wind_dir}`,
          humidity: `${weatherData.humidity}%`,
        };
      }
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
