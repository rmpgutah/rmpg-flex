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
import { humanLayerLabel, layerGroupLabel, metresToUsDistance } from '../utils/osmLayerLabels';

/**
 * Identify-popup values come from OpenStreetMap and the Tilequery API — both
 * user-generated. Interpolating them raw into innerHTML is an injection seam,
 * and a stray `<` in a business name silently breaks the popup markup.
 */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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
          geometry: f.geometry as { type: string; coordinates: unknown },
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
          const p = f.properties as Record<string, unknown>;
          // Prefer an operator-facing label over the internal Mapbox layer id.
          // Before this, a hydrant click read "vt-osm_safety_emerg-circle".
          const overlayLabel = humanLayerLabel(f.layer);
          const group = layerGroupLabel(f.layer);
          const heading = overlayLabel ?? f.layer;
          const name = (p.name || p.NAME || '') as string;
          const type = (p.type || p.class || '') as string;
          // Tilequery reports metres; org standard is US units.
          const dist = f.distance > 0 ? metresToUsDistance(f.distance) : '';
          return `<div style="font-size:10px;color:#ccc;border-bottom:1px solid #222;padding:3px 0;">
            <span style="color:#c3ccd6;font-weight:600;">${esc(heading)}</span>
            ${name && name !== heading ? ` — <span style="color:#f0f4f9;">${esc(name)}</span>` : ''}
            ${type ? `<span style="color:#8a97a6;"> (${esc(type)})</span>` : ''}
            ${dist ? `<span style="color:#6b7785;font-size:9px;"> ${esc(dist)}</span>` : ''}
            ${group ? `<div style="font-size:8px;color:#6b7785;letter-spacing:0.4px;text-transform:uppercase;">${esc(group)}</div>` : ''}
          </div>`;
        }).join('');

        const html = `
          <div style="background:#141414;color:#e0e0e0;padding:8px 12px;border:1px solid #222;border-radius:2px;font-family:system-ui;min-width:200px;max-width:320px;">
            <div style="font-weight:700;color:#c3ccd6;font-size:11px;margin-bottom:4px;">
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
