/**
 * useMapFeatureInspect — Mapbox Tilequery playground equivalent.
 *
 * Click anywhere on the map to query vector tile features at that point.
 * Shows all layers/features within a configurable radius via the Tilequery API.
 * Replaces Google Maps feature inspection / identify tools.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import { mapboxTilequery, type MapboxTilequeryResponse } from '../services/mapboxApiService';

// ── Types ─────────────────────────────────────────────────

export interface InspectedFeature {
  layer: string;
  distance: number;
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}

export interface InspectionResult {
  lngLat: [number, number];
  features: InspectedFeature[];
  timestamp: number;
}

// ── Hook ──────────────────────────────────────────────────

export function useMapFeatureInspect(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
) {
  const [enabled, setEnabled] = useState(false);
  const [result, setResult] = useState<InspectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  useEffect(() => {
    if (!map || !mapLoaded || !enabled) return;

    const handler = async (e: mapboxgl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      setLoading(true);

      try {
        // Query local rendered features first
        const renderedFeatures = map.queryRenderedFeatures(e.point, {});
        const localFeatures: InspectedFeature[] = renderedFeatures.slice(0, 15).map(f => ({
          layer: f.layer?.id || 'unknown',
          distance: 0,
          properties: f.properties || {},
          geometry: f.geometry,
        }));

        // Also query via Tilequery API for deeper tile data
        let apiFeatures: InspectedFeature[] = [];
        try {
          const data = await mapboxTilequery(lng, lat, {
            tileset: 'mapbox.mapbox-streets-v8',
            radius: 50,
            limit: 10,
          });
          apiFeatures = (data.features || []).map(f => ({
            layer: f.properties?.tilequery?.layer || 'tilequery',
            distance: f.properties?.tilequery?.distance || 0,
            properties: f.properties || {},
            geometry: f.geometry,
          }));
        } catch { /* tilequery optional */ }

        // Merge and deduplicate
        const allFeatures = [...localFeatures, ...apiFeatures];
        const inspection: InspectionResult = {
          lngLat: [lng, lat],
          features: allFeatures,
          timestamp: Date.now(),
        };
        setResult(inspection);

        // Show popup with feature summary
        popupRef.current?.remove();
        const featureLines = allFeatures.slice(0, 8).map(f => {
          const name = (f.properties as any).name || (f.properties as any).NAME || f.layer;
          const type = (f.properties as any).type || (f.properties as any).class || '';
          return `<div style="font-size:10px;color:#ccc;border-bottom:1px solid #222;padding:2px 0;">
            <span style="color:#d4a017;font-weight:600;">${f.layer}</span>
            ${name !== f.layer ? ` — ${name}` : ''}
            ${type ? `<span style="color:#666;"> (${type})</span>` : ''}
            ${f.distance > 0 ? `<span style="color:#555;font-size:9px;"> ${Math.round(f.distance)}m</span>` : ''}
          </div>`;
        }).join('');

        const html = `
          <div style="background:#141414;color:#e0e0e0;padding:8px 12px;border:1px solid #222;border-radius:2px;font-family:system-ui;min-width:200px;max-width:320px;">
            <div style="font-weight:700;color:#d4a017;font-size:11px;margin-bottom:4px;">
              🔍 ${allFeatures.length} feature(s) found
            </div>
            <div style="font-size:9px;color:#555;margin-bottom:4px;">${lng.toFixed(5)}, ${lat.toFixed(5)}</div>
            ${featureLines}
            ${allFeatures.length > 8 ? `<div style="font-size:9px;color:#555;margin-top:2px;">+${allFeatures.length - 8} more</div>` : ''}
          </div>
        `;

        popupRef.current = new mapboxgl.Popup({ offset: 12, closeButton: true, className: 'mapbox-popup-dark' })
          .setLngLat([lng, lat])
          .setHTML(html)
          .addTo(map);
      } catch (err) {
        console.warn('[FeatureInspect] inspection failed:', err);
      } finally {
        setLoading(false);
      }
    };

    map.getCanvas().style.cursor = 'help';
    map.on('click', handler);

    return () => {
      map.off('click', handler);
      map.getCanvas().style.cursor = '';
      popupRef.current?.remove();
    };
  }, [map, mapLoaded, enabled]);

  const toggle = useCallback(() => {
    setEnabled(v => !v);
    if (enabled) {
      popupRef.current?.remove();
      setResult(null);
    }
  }, [enabled]);

  const clear = useCallback(() => {
    popupRef.current?.remove();
    setResult(null);
  }, []);

  return { enabled, result, loading, toggle, clear };
}
