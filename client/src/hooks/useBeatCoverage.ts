// ============================================================
// RMPG Flex — useBeatCoverage Hook
// ============================================================
// Draws colored beat polygons from /api/dispatch/geography/beat-coverage.
// Green = covered, Amber = undermanned, Red = uncovered, opacity 0.3.
// Beat boundaries come from the existing beat.geojson in client/public/.
// ============================================================

import { useEffect, useCallback, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { apiFetch } from './useApi';
import { hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';

const BC_SOURCE = 'rmpg-beat-coverage';
const BC_FILL_LAYER = 'beat-coverage-fill';
const BC_LINE_LAYER = 'beat-coverage-line';

export interface BeatCoverageRow {
  beat_id: string;
  beat?: string;
  status: 'covered' | 'undermanned' | 'uncovered';
  unit_count?: number;
}

export interface UseBeatCoverageResult {
  enabled: boolean;
  loading: boolean;
  error: string | null;
  toggle: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  covered: '#22c55e',
  undermanned: '#f59e0b',
  uncovered: '#ef4444',
};

async function loadBeatGeoJSON(): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const res = await fetch('/beat.geojson');
    if (!res.ok) return null;
    return (await res.json()) as GeoJSON.FeatureCollection;
  } catch {
    return null;
  }
}

function buildCoverageExpression(coverage: BeatCoverageRow[]): mapboxgl.Expression {
  // Build a flat alternating [beatId, color, beatId, color, ..., default] array.
  // mapboxgl.ExpressionSpecification[] can't be typed narrowly here, so we use
  // a plain string[] and cast at the return site.
  const pairs: string[] = [];
  for (const row of coverage) {
    const beatId = row.beat_id ?? row.beat;
    const color = STATUS_COLORS[row.status] ?? STATUS_COLORS.uncovered;
    if (beatId) {
      pairs.push(beatId, color);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ['match', ['coalesce', ['get', 'beat'], ['get', 'BEAT'], ['get', 'beat_id'], ''], ...pairs, STATUS_COLORS.uncovered] as any as mapboxgl.Expression;
}

export function useBeatCoverage(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
): UseBeatCoverageResult {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<BeatCoverageRow[]>([]);
  const [beatGeoJSON, setBeatGeoJSON] = useState<GeoJSON.FeatureCollection | null>(null);

  // Fetch coverage data + beat geojson when enabled
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      apiFetch<BeatCoverageRow[]>('/dispatch/geography/beat-coverage').catch(() => [] as BeatCoverageRow[]),
      loadBeatGeoJSON(),
    ]).then(([cov, geo]) => {
      if (cancelled) return;
      setCoverage(Array.isArray(cov) ? cov : []);
      setBeatGeoJSON(geo);
    }).catch((e: any) => {
      if (!cancelled) setError(e?.message ?? 'Failed to load beat coverage');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [enabled]);

  // Add/remove map layers
  useEffect(() => {
    if (!map || !mapLoaded) return;
    if (!enabled || !beatGeoJSON) {
      safeRemoveLayer(map, BC_LINE_LAYER);
      safeRemoveLayer(map, BC_FILL_LAYER);
      safeRemoveSource(map, BC_SOURCE);
      return;
    }

    whenStyleReady(map, () => {
      if (!hasSource(map, BC_SOURCE)) {
        map.addSource(BC_SOURCE, { type: 'geojson', data: beatGeoJSON });
        const colorExpr = buildCoverageExpression(coverage);
        map.addLayer({
          id: BC_FILL_LAYER,
          type: 'fill',
          source: BC_SOURCE,
          paint: {
            'fill-color': colorExpr,
            'fill-opacity': 0.3,
          },
        });
        map.addLayer({
          id: BC_LINE_LAYER,
          type: 'line',
          source: BC_SOURCE,
          paint: {
            'line-color': colorExpr,
            'line-width': 1.5,
            'line-opacity': 0.6,
          },
        });
      }
    });

    return () => {
      safeRemoveLayer(map, BC_LINE_LAYER);
      safeRemoveLayer(map, BC_FILL_LAYER);
      safeRemoveSource(map, BC_SOURCE);
    };
  }, [map, mapLoaded, enabled, beatGeoJSON, coverage]);

  const toggle = useCallback(() => setEnabled((v) => !v), []);
  return { enabled, loading, error, toggle };
}
