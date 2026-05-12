// ============================================================
// RMPG Flex — Deck.gl Google Maps Overlay
// ============================================================
// GPU-accelerated visualization layers for the Google Maps surface.
// Uses @deck.gl/core + @deck.gl/layers with a manual canvas overlay
// approach since @deck.gl/google-maps is not installed.
// Provides type definitions shared with deckMapboxLayers.ts.
// ============================================================

import { Deck } from '@deck.gl/core';
import { ScatterplotLayer, ArcLayer, IconLayer } from '@deck.gl/layers';

// ── Shared type definitions ──

export interface IncidentPoint {
  id: string | number;
  position: [number, number]; // [lng, lat]
  priority?: string;
  type?: string;
  status?: string;
  weight?: number;
}

export interface UnitPosition {
  id: string | number;
  position: [number, number]; // [lng, lat]
  callsign?: string;
  status?: string;
  unit_type?: string;
}

export interface ArcConnection {
  id: string | number;
  source: [number, number]; // [lng, lat]
  target: [number, number]; // [lng, lat]
  priority?: string;
  sourceColor?: [number, number, number, number];
  targetColor?: [number, number, number, number];
}

// ── Priority & Status colors ──

const PRIORITY_COLORS: Record<string, [number, number, number, number]> = {
  '1': [255, 0, 0, 200],      // Red — emergency
  '2': [255, 140, 0, 200],    // Orange — urgent
  '3': [212, 160, 23, 200],   // Gold — routine
  '4': [100, 100, 100, 200],  // Gray — low
};

const STATUS_COLORS: Record<string, [number, number, number, number]> = {
  DISPATCHED: [255, 200, 0, 200],
  ENROUTE: [0, 150, 255, 200],
  ON_SCENE: [0, 200, 80, 200],
  AVAILABLE: [80, 200, 80, 200],
  OUT_OF_SERVICE: [120, 120, 120, 200],
};

function getPriorityColor(priority?: string): [number, number, number, number] {
  return PRIORITY_COLORS[priority || '3'] || PRIORITY_COLORS['3'];
}

function getStatusColor(status?: string): [number, number, number, number] {
  return STATUS_COLORS[status || 'AVAILABLE'] || STATUS_COLORS['AVAILABLE'];
}

// ── Layer factories ──

let deckInstance: Deck | null = null;

export function createHeatmapLayer(incidents: IncidentPoint[]): ScatterplotLayer {
  return new ScatterplotLayer({
    id: 'incident-heatmap',
    data: incidents,
    getPosition: (d: IncidentPoint) => d.position,
    getRadius: 80,
    getFillColor: (d: IncidentPoint) => getPriorityColor(d.priority),
    radiusMinPixels: 4,
    radiusMaxPixels: 20,
    opacity: 0.6,
  });
}

export function createIncidentLayer(incidents: IncidentPoint[]): ScatterplotLayer {
  return new ScatterplotLayer({
    id: 'incident-points',
    data: incidents,
    getPosition: (d: IncidentPoint) => d.position,
    getRadius: 50,
    getFillColor: (d: IncidentPoint) => getPriorityColor(d.priority),
    radiusMinPixels: 6,
    radiusMaxPixels: 14,
    opacity: 0.9,
  });
}

export function createUnitLayer(units: UnitPosition[]): ScatterplotLayer {
  return new ScatterplotLayer({
    id: 'unit-positions',
    data: units,
    getPosition: (d: UnitPosition) => d.position,
    getRadius: 40,
    getFillColor: (d: UnitPosition) => getStatusColor(d.status),
    radiusMinPixels: 6,
    radiusMaxPixels: 12,
    opacity: 0.95,
  });
}

export function createDispatchArcLayer(arcs: ArcConnection[]): ArcLayer {
  return new ArcLayer({
    id: 'dispatch-arcs',
    data: arcs,
    getSourcePosition: (d: ArcConnection) => d.source,
    getTargetPosition: (d: ArcConnection) => d.target,
    getSourceColor: [212, 160, 23, 180],
    getTargetColor: (d: ArcConnection) => getPriorityColor(d.priority),
    getWidth: 2,
  });
}

// ── Overlay lifecycle ──

export function initDeckOverlay(container: HTMLDivElement): Deck {
  if (deckInstance) {
    deckInstance.finalize();
  }
  deckInstance = new Deck({
    parent: container,
    style: { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' },
    controller: false,
    layers: [],
  });
  return deckInstance;
}

export function updateDeckLayers(layers: (ScatterplotLayer | ArcLayer | IconLayer)[]): void {
  if (deckInstance) {
    deckInstance.setProps({ layers });
  }
}

export function destroyDeckOverlay(): void {
  if (deckInstance) {
    deckInstance.finalize();
    deckInstance = null;
  }
}
