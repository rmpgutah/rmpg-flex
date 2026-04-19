import type OlMap from 'ol/Map';
import { useOlPointLayer } from './useOlPointLayer';

interface IncidentReport {
  id: number;
  incident_number: string;
  latitude: number;
  longitude: number;
}

interface PatrolCheckpoint {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

interface FleetVehicle {
  id: number;
  vehicle_number: string;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Three operational point-marker overlays for /map-v2 — incident reports
 * (red, 30d), patrol checkpoints (green, all), fleet vehicles (amber,
 * those with GPS). Each is a thin wrapper over useOlPointLayer with the
 * appropriate URL + color + extractor.
 */

export function useOlIncidentReports(map: OlMap | null, opts: { visible: boolean; days?: number }): void {
  const days = opts.days ?? 30;
  useOlPointLayer<IncidentReport>(map, {
    visible: opts.visible,
    url: `/incidents/map?days=${days}`,
    color: '#ef4444cc',
    radius: 4,
    kind: 'incident',
    extractCoords: (r) =>
      r.latitude != null && r.longitude != null ? { lat: r.latitude, lng: r.longitude } : null,
    debugTag: 'incident reports',
  });
}

export function useOlPatrolCheckpoints(map: OlMap | null, opts: { visible: boolean }): void {
  useOlPointLayer<PatrolCheckpoint>(map, {
    visible: opts.visible,
    url: '/patrol/checkpoints/map',
    color: '#22c55ecc',
    radius: 5,
    kind: 'checkpoint',
    extractCoords: (r) =>
      r.latitude != null && r.longitude != null ? { lat: r.latitude, lng: r.longitude } : null,
    debugTag: 'patrol checkpoints',
  });
}

export function useOlFleetVehicles(map: OlMap | null, opts: { visible: boolean }): void {
  useOlPointLayer<FleetVehicle>(map, {
    visible: opts.visible,
    url: '/fleet/map',
    color: '#fbbf24cc',
    radius: 5,
    kind: 'fleet',
    extractCoords: (r) =>
      r.latitude != null && r.longitude != null ? { lat: r.latitude, lng: r.longitude } : null,
    debugTag: 'fleet vehicles',
  });
}
