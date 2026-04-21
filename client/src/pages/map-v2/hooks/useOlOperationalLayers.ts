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
    cluster: true,
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

// ─── Historical / predictive markers (same useOlPointLayer pattern) ──

interface RepeatAddress { lat: number; lng: number; call_count: number; }
interface DwellTimeRecord { latitude: number; longitude: number; dwell_minutes: number; }
interface HistoricalCall { id: number; latitude: number; longitude: number; }
interface PredictedHotspot { latitude: number; longitude: number; score: number; }

export function useOlRepeatAddresses(
  map: OlMap | null,
  opts: { visible: boolean; days?: number; minCount?: number },
): void {
  const days = opts.days ?? 30;
  const minCount = opts.minCount ?? 3;
  useOlPointLayer<RepeatAddress>(map, {
    visible: opts.visible,
    url: `/dispatch/repeat-addresses?days=${days}&min_count=${minCount}`,
    color: '#f97316cc',
    radius: 5,
    kind: 'repeat_address',
    cluster: true,
    extractCoords: (r) =>
      Number.isFinite(r.lat) && Number.isFinite(r.lng) ? { lat: r.lat, lng: r.lng } : null,
    debugTag: 'repeat addresses',
  });
}

export function useOlDwellTime(map: OlMap | null, opts: { visible: boolean }): void {
  useOlPointLayer<DwellTimeRecord>(map, {
    visible: opts.visible,
    url: '/dispatch/gps/dwell-times',
    color: '#fbbf24cc',
    radius: 4,
    kind: 'dwell',
    extractCoords: (r) =>
      Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
        ? { lat: r.latitude, lng: r.longitude }
        : null,
    debugTag: 'dwell time',
  });
}

export function useOlCallHistory(
  map: OlMap | null,
  opts: { visible: boolean; days?: number },
): void {
  const days = opts.days ?? 7;
  useOlPointLayer<HistoricalCall>(map, {
    visible: opts.visible,
    url: `/dispatch/history-map?days=${days}`,
    color: '#9ca3afaa',
    radius: 3,
    kind: 'call_history',
    cluster: true,
    extractCoords: (r) =>
      Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
        ? { lat: r.latitude, lng: r.longitude }
        : null,
    debugTag: 'call history',
  });
}

export function useOlPredictions(
  map: OlMap | null,
  opts: { visible: boolean; shift?: string },
): void {
  const qs = opts.shift ? `?shift=${encodeURIComponent(opts.shift)}` : '';
  useOlPointLayer<PredictedHotspot>(map, {
    visible: opts.visible,
    url: `/dispatch/heatmap/predictions${qs}`,
    color: '#ec4899cc',
    radius: 6,
    kind: 'prediction',
    extractCoords: (r) =>
      Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
        ? { lat: r.latitude, lng: r.longitude }
        : null,
    extractRows: (raw) => Array.isArray(raw) ? raw : (raw?.hotspots || []),
    debugTag: 'predictions',
  });
}
