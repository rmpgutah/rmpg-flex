// ============================================================
// RMPG Flex — OSM feature overrides (client side)
// ============================================================
// RMPG's internal corrections to the OSM overlays live in D1, keyed by the
// OpenStreetMap element id. The tiles themselves are immutable, so the join
// happens here at render time:
//
//   * `hidden`  -> the feature is filtered out of its Mapbox layer
//   * `fields`  -> merged OVER the OSM tags when a popup is built
//   * `verified`-> badged, so ground-truthed data is distinguishable from
//                  crowd-sourced data at a glance
//
// Fetching is scoped to the groups the operator has switched on. There is no
// point pulling overrides for layers that are not drawn, and the group list is
// what the API chunks on.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';

export interface OsmOverride {
  osm_id: string;
  group: string;
  cat: string | null;
  note: string | null;
  fields: Record<string, unknown>;
  hidden: boolean;
  verified: boolean;
  verified_at: string | null;
  updated_at: string;
}

interface OverridesResponse { overrides: OsmOverride[] }

export interface UseOsmOverridesResult {
  /** osm_id -> override. Empty until the first fetch resolves. */
  byOsmId: Map<string, OsmOverride>;
  /** osm_ids to suppress from rendering, as a plain array for a Mapbox filter. */
  hiddenIds: string[];
  loading: boolean;
  error: string | null;
  /** Re-fetch after an edit. */
  refresh: () => void;
  /** Upsert one override and refresh. Resolves to the saved row. */
  saveOverride: (osmId: string, patch: SaveOverridePatch) => Promise<OsmOverride | null>;
  /** Remove RMPG's override, restoring plain OSM data. */
  clearOverride: (osmId: string) => Promise<void>;
}

export interface SaveOverridePatch {
  group: string;
  cat?: string | null;
  note?: string | null;
  fields?: Record<string, string | number | boolean | null>;
  hidden?: boolean;
  verified?: boolean;
}

const EMPTY: string[] = [];

export function useOsmOverrides(visibleGroups: string[]): UseOsmOverridesResult {
  const [byOsmId, setByOsmId] = useState<Map<string, OsmOverride>>(() => new Map());
  const [hiddenIds, setHiddenIds] = useState<string[]>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sorted + joined so a re-render with the same groups in a different order
  // does not re-fetch. visibleGroups is rebuilt on every toggle.
  const key = [...visibleGroups].sort().join(',');
  const keyRef = useRef(key);
  keyRef.current = key;

  const load = useCallback(async (groups: string) => {
    if (!groups) {
      setByOsmId(new Map());
      setHiddenIds(EMPTY);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<OverridesResponse>(
        `/osm-overrides?groups=${encodeURIComponent(groups)}`,
      );
      // A slower earlier request must not clobber a newer result.
      if (keyRef.current !== groups) return;
      const list = res?.overrides ?? [];
      setByOsmId(new Map(list.map((o) => [o.osm_id, o])));
      setHiddenIds(list.filter((o) => o.hidden).map((o) => o.osm_id));
      setError(null);
    } catch (e) {
      if (keyRef.current !== groups) return;
      // An override fetch failure must NOT blank the map — the OSM data is
      // still valid without RMPG's corrections. Surface it, keep rendering.
      setError(e instanceof Error ? e.message : 'Failed to load map overrides');
    } finally {
      if (keyRef.current === groups) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(key); }, [key, load]);

  const refresh = useCallback(() => { void load(keyRef.current); }, [load]);

  const saveOverride = useCallback(async (osmId: string, patch: SaveOverridePatch) => {
    const saved = await apiFetch<{ override: OsmOverride | null }>(
      `/osm-overrides/${encodeURIComponent(osmId)}`,
      { method: 'PUT', body: JSON.stringify(patch) },
    );
    const row = saved?.override ?? null;
    if (row) {
      setByOsmId((prev) => new Map(prev).set(row.osm_id, row));
      setHiddenIds((prev) => {
        const without = prev.filter((id) => id !== row.osm_id);
        return row.hidden ? [...without, row.osm_id] : without;
      });
    }
    return row;
  }, []);

  const clearOverride = useCallback(async (osmId: string) => {
    await apiFetch(`/osm-overrides/${encodeURIComponent(osmId)}`, { method: 'DELETE' });
    setByOsmId((prev) => { const next = new Map(prev); next.delete(osmId); return next; });
    setHiddenIds((prev) => prev.filter((id) => id !== osmId));
  }, []);

  return { byOsmId, hiddenIds, loading, error, refresh, saveOverride, clearOverride };
}

/**
 * Merge an override over a feature's OSM tags for display.
 *
 * Corrections overlay, they do not replace: the returned object still carries
 * every original OSM tag, with only the overridden keys changed. The original
 * values remain in the tiles regardless — this is a display-time join, not a
 * mutation.
 */
export function mergeOverride(
  props: Record<string, unknown>,
  override: OsmOverride | undefined,
): Record<string, unknown> {
  if (!override) return props;
  const merged: Record<string, unknown> = { ...props, ...override.fields };
  if (override.note) merged.__rmpg_note = override.note;
  if (override.verified) {
    merged.__rmpg_verified = true;
    if (override.verified_at) merged.__rmpg_verified_at = override.verified_at;
  }
  // Which keys RMPG changed, so the popup can mark them rather than passing
  // a correction off as OpenStreetMap's own data.
  const changed = Object.keys(override.fields ?? {});
  if (changed.length) merged.__rmpg_overridden = changed.join(',');
  return merged;
}

/**
 * Mapbox filter clause excluding hidden features.
 *
 * Returns null when nothing is hidden — callers must then leave the layer's
 * base filter alone rather than wrapping it in a no-op `all`, which would
 * churn the style on every render.
 */
export function hiddenFilterClause(hiddenIds: string[]): unknown[] | null {
  if (hiddenIds.length === 0) return null;
  return ['!', ['in', ['get', 'osm_id'], ['literal', hiddenIds]]];
}
