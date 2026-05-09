// ============================================================
// RMPG Flex — Deck.gl Map Layers
// ============================================================
// GPU-accelerated visualization layers for the dispatch map.
// Integrates with existing Google Maps via @deck.gl/google-maps.
// Provides:
// - Crime density heatmap
// - Unit-to-incident arc connections
// - Animated patrol route trips
// - Incident icon clustering
// ============================================================

import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { IconLayer, ArcLayer, ScatterplotLayer } from '@deck.gl/layers';

// ── Types ─────────────────────────────────────────────────

export interface IncidentPoint {
  id: number;
  position: [number, number]; // [lng, lat]
  type: string;
  priority: string;
  timestamp: number;
  weight?: number;
}

export interface UnitPosition {
  id: number;
  callsign: string;
  position: [number, number]; // [lng, lat]
  status: string;
  color?: [number, number, number];
}

export interface ArcConnection {
  source: [number, number];
  target: [number, number];
  sourceColor: [number, number, number];
  targetColor: [number, number, number];
}

// ── Priority colors ───────────────────────────────────────

const PRIORITY_COLORS: Record<string, [number, number, number, number]> = {
  '1': [255, 0, 0, 200],      // Red — Emergency
  '2': [255, 140, 0, 200],    // Orange — Urgent
  '3': [212, 160, 23, 180],   // Gold — Routine
  '4': [100, 100, 100, 160],  // Gray — Low
  '5': [60, 60, 60, 140],     // Dark gray — Info
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

/**
 * Create a crime density heatmap layer from incident points.
 * Uses ScatterplotLayer with opacity for heat-like effect since
 * HeatmapLayer is in @deck.gl/aggregation-layers.
 */
export function createHeatmapLayer(incidents: IncidentPoint[]): ScatterplotLayer {
  return new ScatterplotLayer({
    id: 'crime-heatmap',
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

/**
 * Create a scatterplot layer for incident points with priority-based coloring.
 */
export function createIncidentLayer(incidents: IncidentPoint[]): ScatterplotLayer {
  return new ScatterplotLayer({
    id: 'incidents',
    data: incidents,
    getPosition: (d: IncidentPoint) => d.position,
    getFillColor: (d: IncidentPoint) => PRIORITY_COLORS[d.priority] || PRIORITY_COLORS['3'],
    getRadius: (d: IncidentPoint) => {
      const p = parseInt(d.priority || '3');
      return Math.max(8, (6 - p) * 6);
    },
    radiusMinPixels: 4,
    radiusMaxPixels: 20,
    pickable: true,
    opacity: 0.8,
  });
}

/**
 * Create unit position icons with status-based coloring.
 */
export function createUnitLayer(units: UnitPosition[]): ScatterplotLayer {
  return new ScatterplotLayer({
    id: 'units',
    data: units,
    getPosition: (d: UnitPosition) => d.position,
    getFillColor: (d: UnitPosition) => [...(STATUS_COLORS[d.status] || [100, 100, 100]), 220] as [number, number, number, number],
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

/**
 * Create arc connections between units and their assigned calls.
 */
export function createDispatchArcLayer(arcs: ArcConnection[]): ArcLayer {
  return new ArcLayer({
    id: 'dispatch-arcs',
    data: arcs,
    getSourcePosition: (d: ArcConnection) => d.source,
    getTargetPosition: (d: ArcConnection) => d.target,
    getSourceColor: (d: ArcConnection) => d.sourceColor,
    getTargetColor: (d: ArcConnection) => d.targetColor,
    getWidth: 2,
    opacity: 0.6,
  });
}

// ── Overlay manager ───────────────────────────────────────

let overlay: GoogleMapsOverlay | null = null;

/**
 * Initialize deck.gl overlay on a Google Maps instance.
 */
export function initDeckOverlay(map: google.maps.Map): GoogleMapsOverlay {
  if (overlay) {
    overlay.finalize();
  }
  overlay = new GoogleMapsOverlay({ layers: [] });
  overlay.setMap(map);
  return overlay;
}

/**
 * Update the deck.gl overlay with new layers.
 */
export function updateDeckLayers(
  layers: Array<ScatterplotLayer | ArcLayer | IconLayer>
): void {
  if (!overlay) return;
  overlay.setProps({ layers });
}

/**
 * Clean up the deck.gl overlay.
 */
export function destroyDeckOverlay(): void {
  if (overlay) {
    overlay.finalize();
    overlay = null;
  }
}
