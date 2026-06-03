// ============================================================
// RMPG Flex — Per-User Map Preferences
//
// Local (per-browser) map preferences that override the server-side
// admin defaults from useMapConfig. These are "default" preferences:
// they take effect the next time the map mounts, which matches their
// semantics (a user's preferred startup state).
//
// Storage layout — we deliberately REUSE the keys MapPage already
// reads so the two systems never disagree:
//   rmpg_map_style   -> default style (string)        [shared w/ MapPage]
//   rmpg_map_layers  -> base layer visibility (object) [shared w/ MapPage]
// Everything else lives under a single consolidated key:
//   rmpg_map_prefs   -> { overlays, gps, markers }
//
// Marker + GPS prefs are consumed in useMapConfig.ts (applyLocalMapOverrides),
// so they reach the deep MapPage internals without editing them directly.
// ============================================================

import type { MapStyleId } from '../pages/map/utils/mapConstants';
import { emitSettingsChange } from './settingsBus';

// ─── Types ──────────────────────────────────────────────────

export interface BaseLayerPrefs {
  units: boolean;
  incidents: boolean;
  properties: boolean;
}

export interface OverlayPrefs {
  /** Show the incident heatmap by default. */
  heatmap: boolean;
  /** Show unit breadcrumb trails by default. */
  breadcrumbs: boolean;
}

export interface GpsPrefs {
  /** Request high-accuracy positioning (more battery, tighter fix). */
  highAccuracy: boolean;
  /** GPS upload batch interval in milliseconds. */
  batchIntervalMs: number;
  /** Auto-recenter the map on my own unit when a fix arrives. */
  autoCenterOnUnit: boolean;
}

export interface MarkerPrefs {
  /** Animated pulse halo on unit markers. */
  unitPulse: boolean;
  /** Animated pulse halo on call markers. */
  callPulse: boolean;
  /** Marker label font size in px. */
  fontSize: number;
  /** Cluster nearby markers at low zoom. */
  clusteringEnabled: boolean;
  /** Cluster grouping radius in px. */
  clusterRadius: number;
}

export interface MapPreferences {
  defaultStyle: MapStyleId;
  layers: BaseLayerPrefs;
  overlays: OverlayPrefs;
  gps: GpsPrefs;
  markers: MarkerPrefs;
}

// ─── Defaults (mirror the server/admin defaults in useMapConfig) ──

export const DEFAULT_MAP_PREFERENCES: MapPreferences = {
  defaultStyle: 'dark',
  layers: { units: true, incidents: true, properties: true },
  overlays: { heatmap: false, breadcrumbs: true },
  gps: { highAccuracy: true, batchIntervalMs: 5000, autoCenterOnUnit: false },
  markers: { unitPulse: true, callPulse: true, fontSize: 9, clusteringEnabled: true, clusterRadius: 50 },
};

// ─── Storage keys ───────────────────────────────────────────

const STYLE_KEY = 'rmpg_map_style';   // shared with MapPage
const LAYERS_KEY = 'rmpg_map_layers'; // shared with MapPage
const PREFS_KEY = 'rmpg_map_prefs';   // overlays + gps + markers

const VALID_STYLES = new Set<MapStyleId>([
  'dark', 'satellite', 'hybrid', 'streets', 'terrain', 'night_nav',
]);

// ─── Safe readers ───────────────────────────────────────────

function readStyle(): MapStyleId {
  try {
    const raw = localStorage.getItem(STYLE_KEY);
    if (raw && VALID_STYLES.has(raw as MapStyleId)) return raw as MapStyleId;
  } catch { /* localStorage unavailable */ }
  return DEFAULT_MAP_PREFERENCES.defaultStyle;
}

function readLayers(): BaseLayerPrefs {
  try {
    const raw = localStorage.getItem(LAYERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BaseLayerPrefs>;
      return { ...DEFAULT_MAP_PREFERENCES.layers, ...parsed };
    }
  } catch { /* malformed or unavailable */ }
  return { ...DEFAULT_MAP_PREFERENCES.layers };
}

function readPrefsBlob(): Pick<MapPreferences, 'overlays' | 'gps' | 'markers'> {
  const base = {
    overlays: { ...DEFAULT_MAP_PREFERENCES.overlays },
    gps: { ...DEFAULT_MAP_PREFERENCES.gps },
    markers: { ...DEFAULT_MAP_PREFERENCES.markers },
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<MapPreferences>;
    return {
      overlays: { ...base.overlays, ...parsed.overlays },
      gps: { ...base.gps, ...parsed.gps },
      markers: { ...base.markers, ...parsed.markers },
    };
  } catch {
    return base;
  }
}

/** Read the full, validated preference set. */
export function getMapPreferences(): MapPreferences {
  const blob = readPrefsBlob();
  return {
    defaultStyle: readStyle(),
    layers: readLayers(),
    overlays: blob.overlays,
    gps: blob.gps,
    markers: blob.markers,
  };
}

// ─── Writers ────────────────────────────────────────────────

/**
 * Persist a partial update. defaultStyle/layers are written to the
 * keys MapPage already reads; overlays/gps/markers go to the blob.
 */
export function setMapPreferences(patch: Partial<MapPreferences>): void {
  try {
    if (patch.defaultStyle && VALID_STYLES.has(patch.defaultStyle)) {
      localStorage.setItem(STYLE_KEY, patch.defaultStyle);
    }
    if (patch.layers) {
      const next = { ...readLayers(), ...patch.layers };
      localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
    }
    if (patch.overlays || patch.gps || patch.markers) {
      const current = readPrefsBlob();
      const next = {
        overlays: { ...current.overlays, ...patch.overlays },
        gps: { ...current.gps, ...patch.gps },
        markers: { ...current.markers, ...patch.markers },
      };
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    }
  } catch { /* quota / unavailable — best effort */ }
  emitSettingsChange('map');
}

/** Reset everything to the shipped defaults. */
export function resetMapPreferences(): void {
  try {
    localStorage.removeItem(STYLE_KEY);
    localStorage.removeItem(LAYERS_KEY);
    localStorage.removeItem(PREFS_KEY);
  } catch { /* noop */ }
  emitSettingsChange('map');
}
