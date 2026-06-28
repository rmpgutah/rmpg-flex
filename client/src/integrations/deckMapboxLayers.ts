// ============================================================
// RMPG Flex — Deck.gl Mapbox Overlay
// ============================================================
// GPU-accelerated visualization layers for the Mapbox GL map.
// Uses @deck.gl/mapbox for native integration instead of
// @deck.gl/google-maps. Provides the same layer types as the
// Google Maps overlay (heatmap, arcs, scatterplot, icons).
// ============================================================

import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer, ArcLayer, IconLayer } from '@deck.gl/layers';
import type mapboxgl from 'mapbox-gl';
import type { IncidentPoint, UnitPosition, ArcConnection } from './deckLayers';

// Re-export types for convenience
export type { IncidentPoint, UnitPosition, ArcConnection };

// ── Priority & Status colors (same as Google Maps overlay) ──

const PRIORITY_COLORS: Record<string, [number, number, number, number]> = {
  '1': [255, 0, 0, 200],
  '2': [255, 140, 0, 200],
  '3': [212, 160, 23, 180],
  '4': [100, 100, 100, 160],
  '5': [60, 60, 60, 140],
};

const STATUS_COLORS: Record<string, [number, number, number]> = {
  AVAILABLE: [0, 180, 0],
  DISPATCHED: [212, 160, 23],
  ENROUTE: [0, 120, 255],
  ON_SCENE: [255, 0, 0],
  BUSY: [255, 140, 0],
  OUT_OF_SERVICE: [80, 80, 80],
};

// ── Layer factories ───────────────────────────────────────

export function createMapboxHeatmapLayer(incidents: IncidentPoint[]): ScatterplotLayer {
  return new ScatterplotLayer({
    id: 'mapbox-crime-heatmap',
    data: incidents,
    getPosition: (d: IncidentPoint) => d.position,
    getFillColor: [255, 140, 0, 100],
    getRadius: (d: IncidentPoint) => (d.weight || (6 - parseInt(d.priority || '3'))) * 50,
    radiusMinPixels: 20,
    radiusMaxPixels: 80,
    opacity: 0.3,
    pickable: false,
  });
}

export function createMapboxIncidentLayer(incidents: IncidentPoint[]): ScatterplotLayer {
  return new ScatterplotLayer({
    id: 'mapbox-incidents',
    data: incidents,
    getPosition: (d: IncidentPoint) => d.position,
    getFillColor: (d: IncidentPoint) => PRIORITY_COLORS[d.priority || '3'] || PRIORITY_COLORS['3'],
    getRadius: (d: IncidentPoint) => Math.max(8, (6 - parseInt(d.priority || '3')) * 6),
    radiusMinPixels: 4,
    radiusMaxPixels: 20,
    pickable: true,
    opacity: 0.8,
  });
}

export function createMapboxUnitLayer(units: UnitPosition[]): ScatterplotLayer {
  return new ScatterplotLayer({
    id: 'mapbox-units',
    data: units,
    getPosition: (d: UnitPosition) => d.position,
    getFillColor: (d: UnitPosition) => [...(STATUS_COLORS[d.status || 'AVAILABLE'] || [100, 100, 100]), 220] as [number, number, number, number],
    getLineColor: [212, 160, 23, 255],
    lineWidthMinPixels: 2,
    stroked: true,
    getRadius: 10,
    radiusMinPixels: 6,
    radiusMaxPixels: 16,
    pickable: true,
    opacity: 0.9,
  });
}

export function createMapboxArcLayer(arcs: ArcConnection[]): ArcLayer {
  return new ArcLayer({
    id: 'mapbox-dispatch-arcs',
    data: arcs,
    getSourcePosition: (d: ArcConnection) => d.source,
    getTargetPosition: (d: ArcConnection) => d.target,
    getSourceColor: (d: ArcConnection) => d.sourceColor || [212, 160, 23, 200],
    getTargetColor: (d: ArcConnection) => d.targetColor || [255, 0, 0, 200],
    getWidth: 2,
    opacity: 0.6,
  });
}

// ── Overlay manager ───────────────────────────────────────

let overlay: MapboxOverlay | null = null;

/**
 * Initialize the Deck.gl overlay on a Mapbox GL map.
 */
export function initMapboxDeckOverlay(map: mapboxgl.Map): MapboxOverlay {
  if (overlay) {
    overlay.finalize();
  }

  overlay = new MapboxOverlay({
    interleaved: true,
    layers: [],
  });

  map.addControl(overlay as unknown as mapboxgl.IControl);
  return overlay;
}

/**
 * Update the Deck.gl overlay layers.
 */
export function updateMapboxDeckLayers(
  layers: Array<ScatterplotLayer | ArcLayer | IconLayer>
): void {
  if (!overlay) return;
  overlay.setProps({ layers });
}

/**
 * Clean up the Deck.gl overlay.
 */
export function destroyMapboxDeckOverlay(): void {
  if (overlay) {
    overlay.finalize();
    overlay = null;
  }
}
