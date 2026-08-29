// ============================================================
// RMPG Flex — Map Layer Registry
// Single declarative source of truth for every layer toggle in the
// Map tab. Presentation metadata ONLY — label, icon, group, color,
// description. Behavior (active / onToggle / loading / error) stays
// in MapboxMapPage and is joined in by useLayerBindings().
//
// Why this exists: the same {id,label,active,onToggle} literal was
// retyped across ten arrays in MapboxMapPage, so every findability
// feature (search, favorites, active-layer summary, legend) would
// have needed ten bespoke wirings. One array, four renderers.
//
// NEVER put a literal hex in here — layerRegistry.test.ts fails the
// build if you do. Colors are CSS variables so they re-theme.
// ============================================================

import {
  Activity, AlertTriangle, Anchor, Boxes, Brush, Camera, CircleDot, Cloud, Compass,
  CloudLightning, Crosshair, DoorOpen, Footprints, Gauge, Globe, Grid3x3, Hexagon,
  History, Landmark, Layers, LineChart, Locate, MapPin, Mountain, Move3d, Navigation,
  PenTool, PlayCircle, Plug, Radar, Radio, Route, Ruler, ScanLine, Search, Shield, Siren,
  SquareDashed, Star, Sun, Timer, TrafficCone, Volume2, Waypoints, Wrench,
  Zap, type LucideIcon,
} from 'lucide-react';
import { HIERARCHY_CONFIGS } from '../../../hooks/useDistrictHierarchyLayers';
import { GEO_LAYER_CONFIGS } from '../../../hooks/useGeoJsonLayers';
import { OSM_VECTOR_CONFIGS } from '../../../hooks/useVectorTileLayers';

export type MapLayerGroup =
  | 'Live Conditions' | 'Units & Calls' | 'Historical Analysis'
  | 'Administrative Boundaries' | 'Risk & Coverage' | 'Terrain & 3D'
  | 'Dispatch Tools' | 'Measurement & Marking' | 'Drawing & Tracking'
  | 'Diagnostics'
  | 'OSM Surveillance' | 'OSM Traffic' | 'OSM Fire & Safety' | 'OSM Utilities'
  | 'OSM Sites' | 'OSM Access' | 'OSM Drivability' | 'OSM Terrain' | 'OSM Jurisdiction';

export const LEFT_DOCK_GROUPS: MapLayerGroup[] = [
  'Live Conditions', 'Units & Calls', 'Historical Analysis',
  'Administrative Boundaries', 'Risk & Coverage', 'Terrain & 3D',
  'OSM Surveillance', 'OSM Traffic', 'OSM Fire & Safety', 'OSM Utilities',
  'OSM Sites', 'OSM Access', 'OSM Drivability', 'OSM Terrain', 'OSM Jurisdiction',
];

export const RIGHT_DOCK_GROUPS: MapLayerGroup[] = [
  'Dispatch Tools', 'Measurement & Marking', 'Drawing & Tracking', 'Diagnostics',
];

export interface MapLayerDef {
  /** Stable id — must match the binding key used in useLayerBindings. */
  id: string;
  /** Canonical, searchable name. A binding may override the rendered text. */
  label: string;
  icon: LucideIcon;
  group: MapLayerGroup;
  /** Always `var(--x)`. Enforced by test. */
  colorVar: string;
  description: string;
  /** Safety-critical — renders a colored left-border accent. */
  pinned?: boolean;
}

const STATIC_LAYERS: MapLayerDef[] = [
  // ── Live Conditions ──
  { id: 'traffic', label: 'Live Traffic', icon: TrafficCone, group: 'Live Conditions', colorVar: 'var(--sev-ok)', description: 'Real-time congestion' },
  { id: 'weather', label: 'Weather Radar', icon: Cloud, group: 'Live Conditions', colorVar: 'var(--sev-info)', description: 'Precipitation overlay' },
  { id: 'weather-alerts', label: 'Severe Weather', icon: CloudLightning, group: 'Live Conditions', colorVar: 'var(--sev-critical)', description: 'Active NWS warnings & advisories', pinned: true },
  { id: 'p1audio', label: 'P1 Audio Alert', icon: Volume2, group: 'Live Conditions', colorVar: 'var(--sev-critical)', description: 'Chirp on new P1 calls', pinned: true },
  { id: 'autopan', label: 'Auto-Pan P1', icon: Siren, group: 'Live Conditions', colorVar: 'var(--sev-critical)', description: 'Pan to new Priority 1 calls', pinned: true },
  { id: 'geofences', label: 'Geofence Zones', icon: Shield, group: 'Live Conditions', colorVar: 'var(--sev-critical)', description: 'Premise alerts on click', pinned: true },

  // ── Units & Calls ──
  { id: 'breadcrumbs', label: 'Unit Trails', icon: Footprints, group: 'Units & Calls', colorVar: 'var(--sev-info)', description: 'GPS history (B)' },
  { id: 'clustering', label: 'Call Clusters', icon: Boxes, group: 'Units & Calls', colorVar: 'var(--accent-silver-400)', description: 'Group markers (C)' },
  { id: 'incidents', label: 'Incidents', icon: AlertTriangle, group: 'Units & Calls', colorVar: 'var(--sev-critical)', description: 'RMS incident clusters' },
  { id: 'repeat-addresses', label: 'Repeat Addresses', icon: History, group: 'Units & Calls', colorVar: 'var(--sev-ok)', description: 'Locations with 3+ calls' },
  { id: 'selfpos', label: 'My Position', icon: Locate, group: 'Units & Calls', colorVar: 'var(--sev-info)', description: 'Show my own GPS position' },
  { id: 'serve-jobs', label: 'Process Server Jobs', icon: Footprints, group: 'Units & Calls', colorVar: 'var(--sev-warn)', description: 'Active serve queue with a geocoded address' },

  // ── Historical Analysis ──
  { id: 'incident-heatmap', label: 'Incident Heat', icon: Radar, group: 'Historical Analysis', colorVar: 'var(--sev-high)', description: 'Incident density last 24 hours' },
  { id: 'heatmap', label: 'Crime Heatmap', icon: Radar, group: 'Historical Analysis', colorVar: 'var(--sev-critical)', description: 'Incident density (H) — click label to switch Live/Historical' },
  { id: 'call-history', label: 'Call History', icon: History, group: 'Historical Analysis', colorVar: 'var(--sev-ok)', description: 'Past 30 days of calls' },
  { id: 'speed-heatmap', label: 'Speed Heatmap', icon: Gauge, group: 'Historical Analysis', colorVar: 'var(--sev-high)', description: 'GPS speed density' },
  { id: 'speed-violations', label: 'Speed Violations', icon: Zap, group: 'Historical Analysis', colorVar: 'var(--sev-critical)', description: 'Recent high-speed events — click a marker for the speed graph' },
  { id: 'pursuit-segments', label: 'Pursuit Tracks', icon: Route, group: 'Historical Analysis', colorVar: 'var(--sev-critical)', description: 'Recent vehicle/foot pursuit paths' },
  { id: 'response-time', label: 'Response Time by Beat', icon: Timer, group: 'Historical Analysis', colorVar: 'var(--sev-ok)', description: '30-day avg response time (historical)' },

  // ── Risk & Coverage ──
  { id: 'beat-coverage', label: 'Beat Coverage', icon: Shield, group: 'Risk & Coverage', colorVar: 'var(--sev-ok)', description: 'Beat patrol coverage status (green=covered, amber=undermanned, red=uncovered)' },
  { id: 'coverage-gaps', label: 'Coverage Gaps', icon: SquareDashed, group: 'Risk & Coverage', colorVar: 'var(--sev-high)', description: 'Response-time gap grid' },
  { id: 'safety-zones', label: 'Safety Zones', icon: Shield, group: 'Risk & Coverage', colorVar: 'var(--sev-critical)', description: 'Risk-weighted call clusters' },
  { id: 'isochrone', label: 'Response Zones', icon: Hexagon, group: 'Risk & Coverage', colorVar: 'var(--sev-ok)', description: '5/10/15 min driving' },

  // ── Terrain & 3D ──
  { id: 'terrain', label: '3D Terrain', icon: Mountain, group: 'Terrain & 3D', colorVar: 'var(--sev-special)', description: 'Elevation relief' },
  { id: 'buildings', label: '3D Buildings', icon: Boxes, group: 'Terrain & 3D', colorVar: 'var(--text-secondary)', description: 'Extruded building footprints' },
  { id: 'daylight', label: 'Day/Night', icon: Sun, group: 'Terrain & 3D', colorVar: 'var(--sev-warn)', description: 'Solar terminator (D)' },
  { id: 'projection', label: 'Projection', icon: Globe, group: 'Terrain & 3D', colorVar: 'var(--sev-ok)', description: 'Globe / Mercator / Equal Earth' },
  { id: 'atmosphere', label: 'Atmosphere', icon: Cloud, group: 'Terrain & 3D', colorVar: 'var(--sev-special)', description: 'Fog, sky & star effects' },
  { id: 'grid', label: 'Coordinate Grid', icon: Grid3x3, group: 'Terrain & 3D', colorVar: 'var(--accent-silver-400)', description: 'Lat/Lng graticule (G)' },
  { id: 'orbit', label: 'Orbit Animation', icon: Move3d, group: 'Terrain & 3D', colorVar: 'var(--sev-warn)', description: 'Cinematic map rotation' },

  // ── Dispatch Tools ──
  { id: 'directions', label: 'Live Directions', icon: Navigation, group: 'Dispatch Tools', colorVar: 'var(--sev-info)', description: 'Point-to-point routing engine' },
  { id: 'nav-overlay', label: 'Manual Route', icon: Waypoints, group: 'Dispatch Tools', colorVar: 'var(--sev-info)', description: 'Draw a route between two typed coordinates' },
  { id: 'identify', label: 'Identify', icon: Crosshair, group: 'Dispatch Tools', colorVar: 'var(--sev-warn)', description: 'Click the map for place/district info' },
  { id: 'places', label: 'Places Search', icon: Search, group: 'Dispatch Tools', colorVar: 'var(--sev-ok)', description: 'Nearby POI search' },
  { id: 'bookmarks', label: 'Drop Bookmark', icon: Star, group: 'Dispatch Tools', colorVar: 'var(--sev-warn)', description: 'Click the map to save a location' },
  { id: 'gps-hud', label: 'GPS HUD', icon: Gauge, group: 'Dispatch Tools', colorVar: 'var(--sev-ok)', description: 'Heading, speed, route progress' },
  { id: 'optimize', label: 'Route Optimizer', icon: Compass, group: 'Dispatch Tools', colorVar: 'var(--sev-special)', description: 'Queue calls, pick a unit, optimize the visiting order' },
  { id: 'optim-routes', label: 'Optimization Routes', icon: Route, group: 'Dispatch Tools', colorVar: 'var(--sev-info)', description: 'Show most recent completed optimization job routes on the map' },

  // ── Measurement & Marking ──
  { id: 'measure', label: 'Measure', icon: Ruler, group: 'Measurement & Marking', colorVar: 'var(--sev-info)', description: 'Distance / area measurement' },
  { id: 'buffer-ring', label: 'Buffer Ring', icon: CircleDot, group: 'Measurement & Marking', colorVar: 'var(--sev-high)', description: 'Radius rings around a point' },
  { id: 'annotation', label: 'Annotations', icon: MapPin, group: 'Measurement & Marking', colorVar: 'var(--sev-info)', description: 'Pin notes on the map' },
  { id: 'radar-360', label: 'Radar 360°', icon: Radar, group: 'Measurement & Marking', colorVar: 'var(--brand-400)', description: 'Situational awareness scan — nearby calls, persons, vehicles, units within a radius. Right-click map to reposition.' },

  // ── Drawing & Tracking ──
  { id: 'draw', label: 'Quick Draw', icon: PenTool, group: 'Drawing & Tracking', colorVar: 'var(--accent-silver-400)', description: 'Polygon / polyline / circle — session-only, not saved' },
  { id: 'gl-draw', label: 'Draw & Edit', icon: Brush, group: 'Drawing & Tracking', colorVar: 'var(--accent-silver-400)', description: 'Vertex editing — select and reshape existing shapes' },
  { id: 'draw-geofence', label: 'Create Geofence Zone', icon: Hexagon, group: 'Drawing & Tracking', colorVar: 'var(--sev-special)', description: 'Saves a named alert/exclusion zone' },
  { id: 'gps-replay', label: 'GPS Replay', icon: PlayCircle, group: 'Drawing & Tracking', colorVar: 'var(--sev-ok)', description: "Scrub a unit's GPS history on a timeline" },
  { id: 'speed-analytics', label: 'Speed Analytics Panel', icon: LineChart, group: 'Drawing & Tracking', colorVar: 'var(--sev-high)', description: 'Per-beat speed stats + coverage timeline' },

  // ── Diagnostics ──
  { id: 'inspect', label: 'Feature Inspector', icon: Wrench, group: 'Diagnostics', colorVar: 'var(--sev-special)', description: 'Click features for details' },
  { id: 'mapmatch', label: 'Map Match Trace', icon: Anchor, group: 'Diagnostics', colorVar: 'var(--sev-high)', description: 'Snap GPS to roads' },
  { id: 'deck', label: 'GPU Overlay', icon: Layers, group: 'Diagnostics', colorVar: 'var(--sev-special)', description: 'Deck.gl accelerated rendering' },
  { id: 'perf-hud', label: 'Performance HUD', icon: Activity, group: 'Diagnostics', colorVar: 'var(--sev-high)', description: 'FPS, layer count, render timing' },
  { id: 'mapbox-status', label: 'Mapbox API Status', icon: Radio, group: 'Diagnostics', colorVar: 'var(--sev-info)', description: 'Directions/Matrix/Geocoding diagnostics for the queued call' },
];

// Boundary entries are DERIVED from the very config arrays MapboxMapPage
// consumes, so adding a district level or a GeoJSON layer can never leave the
// registry stale. Only icon + color (absent from those configs) live here.
// Static id-to-variable lookup mirroring each GEO_LAYER_CONFIGS entry's real
// stroke color (see client/src/hooks/useGeoJsonLayers.ts). Never derived from
// the config's hex at runtime — that would put literal hex back into registry
// data, which layerRegistry.test.ts forbids. Falls back to silver for any id
// not listed here so a newly added GeoJSON layer still renders.
const GEO_LAYER_COLOR_VARS: Record<string, string> = {
  state_boundary: 'var(--text-primary)',
  county: 'var(--text-secondary)',
  municipality: 'var(--sev-special)',
  beat: 'var(--sev-ok)',
  highway: 'var(--sev-critical)',
  place: 'var(--sev-ok)',
};

const BOUNDARY_LAYERS: MapLayerDef[] = [
  ...HIERARCHY_CONFIGS.map((cfg): MapLayerDef => ({
    id: `district-${cfg.id}`,
    label: cfg.label,
    icon: Hexagon,
    group: 'Administrative Boundaries',
    colorVar: 'var(--accent-silver-400)',
    description: cfg.description,
  })),
  ...GEO_LAYER_CONFIGS.map((cfg): MapLayerDef => ({
    id: `geo-${cfg.id}`,
    label: cfg.label,
    icon: Layers,
    group: 'Administrative Boundaries',
    colorVar: GEO_LAYER_COLOR_VARS[cfg.id] ?? 'var(--accent-silver-400)',
    description: cfg.file.replace('.geojson', ''),
  })),
];

// OSM group name -> {dock group, icon, colorVar}. Never gold, never literal
// hex — layerRegistry.test.ts enforces both. Silver/blue family for neutral
// infrastructure; sev-* hues keep their existing CAD meaning.
const OSM_GROUP_META: Record<string, { group: MapLayerGroup; icon: LucideIcon; colorVar: string }> = {
  surveillance: { group: 'OSM Surveillance', icon: Camera, colorVar: 'var(--accent-silver-400)' },
  traffic: { group: 'OSM Traffic', icon: TrafficCone, colorVar: 'var(--accent-silver-500)' },
  safety: { group: 'OSM Fire & Safety', icon: Siren, colorVar: 'var(--sev-critical)' },
  utility: { group: 'OSM Utilities', icon: Plug, colorVar: 'var(--accent-silver-600)' },
  sites: { group: 'OSM Sites', icon: Landmark, colorVar: 'var(--accent-silver-700)' },
  access: { group: 'OSM Access', icon: DoorOpen, colorVar: 'var(--accent-silver-400)' },
  drivability: { group: 'OSM Drivability', icon: Route, colorVar: 'var(--sev-info)' },
  terrain: { group: 'OSM Terrain', icon: Mountain, colorVar: 'var(--sev-warn)' },
  jurisdiction: { group: 'OSM Jurisdiction', icon: Hexagon, colorVar: 'var(--accent-silver-600)' },
};

// One registry entry per (OSM group, category), derived from OSM_VECTOR_CONFIGS
// (client/src/hooks/useVectorTileLayers.ts) so a new category can never leave
// the registry stale. id matches the config id exactly — that id is also the
// binding key used in MapboxMapPage's layerBindings.
const OSM_CAT_REGISTRY: Record<string, { icon?: LucideIcon; colorVar?: string; pinned?: boolean }> = {
  alpr: { icon: ScanLine, colorVar: 'var(--sev-info)', pinned: true },
  camera: { icon: Camera, colorVar: 'var(--accent-silver-400)' },
  camera_cone: { icon: Crosshair, colorVar: 'var(--sev-info)' },
};

const OSM_LAYERS: MapLayerDef[] = OSM_VECTOR_CONFIGS.map((cfg): MapLayerDef => {
  const groupName = cfg.name.replace(/^osm-/, '');
  const meta = OSM_GROUP_META[groupName] ?? { group: 'OSM Sites', icon: Layers, colorVar: 'var(--accent-silver-400)' };
  const cat = cfg.categoryFilter ?? '';
  const catMeta = OSM_CAT_REGISTRY[cat];
  return {
    id: cfg.id,
    label: cfg.label,
    icon: catMeta?.icon ?? meta.icon,
    group: meta.group,
    colorVar: catMeta?.colorVar ?? meta.colorVar,
    description: cfg.description || cfg.coverage || cfg.label,
    pinned: catMeta?.pinned,
  };
});

export const MAP_LAYER_REGISTRY: MapLayerDef[] = [...STATIC_LAYERS, ...BOUNDARY_LAYERS, ...OSM_LAYERS];

export const LAYER_BY_ID: ReadonlyMap<string, MapLayerDef> = new Map(
  MAP_LAYER_REGISTRY.map((l) => [l.id, l]),
);
