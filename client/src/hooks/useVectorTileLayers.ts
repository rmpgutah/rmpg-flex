// ============================================================
// RMPG Flex — Vector Tile (PMTiles) Layer Manager Hook
// ============================================================
// Renders large statewide datasets (Utah address points, road
// centerlines) as Mapbox GL JS *vector* sources backed by PMTiles
// archives served from R2 via /api/tiles/*.
//
// These datasets are ~1–2 GB of raw GeoJSON each — far too large for
// the whole-file `geojson` source pattern in useGeoJsonLayers. PMTiles
// streams only the tiles in the current viewport over HTTP range
// requests (protocol registered in utils/mapboxLoader.ts), so memory
// and transfer stay tiny regardless of statewide extent.
//
// Layers are OFF by default (statewide point clutter is opt-in) and
// zoom-gated so they only draw when zoomed in enough to be useful.
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { mapboxgl } from '../utils/mapboxLoader';
import { whenStyleReady } from '../pages/map/utils/safeAddSource';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import {
  ensureOsmIcons, iconIdForCat, iconImageExpression, symbolSortKeyFor,
} from '../utils/osmIcons';
import { buildOsmPopupHtml } from '../utils/osmPopup';
import { mergeOverride, hiddenFilterClause, type OsmOverride } from './useOsmOverrides';
import {
  roadColorExpression, roadSortKeyExpression, ptTypeColorExpression,
  classifyCartocode, classifyPtType,
} from '../pages/map/utils/landTypes';
import { OSM_GROUPS, OSM_EXTRACT_DATE, type OsmGroup } from '../config/osmLayers.generated';
import {
  osmColorFor, osmLinePaint, osmFillPaint, osmFillOutlinePaint, OSM_CAT_DESCRIPTION,
} from '../utils/osmOverlayStyle';
import {
  isSurveillanceCameraCat, isCameraConeCat,
  cameraSymbolLayout, cameraHaloPaint,
  cameraConeFillPaint, cameraConeOutlinePaint, cameraConeFilter, cameraConeBeforeLayerId,
} from '../utils/osmCamera';

export type VectorLayerKind = 'line' | 'point' | 'icon' | 'fill';

export interface VectorTileLayerConfig {
  id: string;
  label: string;
  description: string;
  /** Archive name under /api/tiles/<name>/{z}/{x}/{y}.mvt (server extracts from PMTiles). */
  name: string;
  /** The vector source-layer name inside the tiles. */
  sourceLayer: string;
  /** Native vector source zoom range (the archive's own min/max). */
  sourceMinzoom: number;
  sourceMaxzoom: number;
  kind: VectorLayerKind;
  /** Don't draw below this zoom (statewide clutter control). */
  minzoom: number;
  /** Legend swatch / primary draw color. */
  color: string;
  /** Property used for the click popup title. */
  labelProp: string;
  /** Extra properties shown in the popup. */
  detailProps: { key: string; label: string }[];
  /** Whether this layer starts enabled. Every layer — UGRC and OSM — defaults false. */
  defaultVisible: boolean;
  /** Data provenance, for attribution/legend grouping. */
  source: 'ugrc' | 'osm';
  /** Attribution string shown when the layer is visible (OSM only, ODbL requirement). */
  attribution: string;
  /** Coverage caveat caption shown in the legend (OSM only). */
  coverage?: string;
  /** The `cat` property value this layer filters to (OSM only — one shared source per archive). */
  categoryFilter?: string;
  /** Shared archive name for OSM configs — one Mapbox vector source per archive, e.g. 'osm-safety'. */
  archive?: string;
  /** Per-category render kind from the generated catalog (OSM only) — authoritative
   * over the group-level `kind` for 'mixed' geometry groups. See buildOsmLayerSpecs. */
  categoryRender?: 'point' | 'line' | 'polygon';
}

/** One Mapbox layer spec, as returned by buildOsmLayerSpecs. Loose/`any`-typed
 * paint/layout so this stays a plain data shape testable without mapbox-gl. */
export interface OsmLayerSpec {
  id: string;
  type: 'fill' | 'line' | 'circle' | 'symbol';
  filter: unknown[];
  'source-layer': string;
  minzoom: number;
  layout: Record<string, unknown>;
  paint: Record<string, unknown>;
}

// Native XYZ tile template. Mapbox GL JS has no addProtocol (that's MapLibre),
// so the Worker extracts individual MVT tiles from the PMTiles archive in R2
// and serves them here; mapbox consumes this as a standard vector source.
// Absolute origin so mapbox's worker-thread tile fetches resolve correctly.
const TILE_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';
function tilesUrl(name: string): string {
  return `${TILE_ORIGIN}/api/tiles/${name}/{z}/{x}/{y}.mvt`;
}

export const VECTOR_TILE_CONFIGS: VectorTileLayerConfig[] = [
  {
    id: 'utah_roads',
    label: 'Utah Roads',
    description: 'Statewide road centerlines (UGRC)',
    name: 'utah-roads',
    sourceLayer: 'roads',
    sourceMinzoom: 6,
    sourceMaxzoom: 14,
    kind: 'line',
    minzoom: 9,
    // Blue & Silver accent-silver-500 (client/src/styles/theme-palettes.css) —
    // replaces the previous banned gold literal. Literal hex is correct here:
    // mapbox-gl cannot resolve var() inside a paint property.
    color: '#c3ccd6',
    labelProp: 'FULLNAME',
    detailProps: [
      { key: 'CARTOCODE', label: 'Class' },
      { key: 'ADDRSYS_L', label: 'Addr System' },
      { key: 'ZIPCODE_L', label: 'ZIP' },
      { key: 'COUNTY_L', label: 'County' },
    ],
    defaultVisible: false,
    source: 'ugrc',
    attribution: 'Utah AGRC (UGRC)',
  },
  {
    id: 'utah_addresses',
    label: 'Utah Address Points',
    description: 'Statewide address points (UGRC)',
    name: 'utah-address-points',
    sourceLayer: 'address_points',
    sourceMinzoom: 10,
    sourceMaxzoom: 15,
    kind: 'point',
    minzoom: 14,
    // Blue & Silver accent-silver-600 — replaces the banned #e8b84b gold.
    color: '#a0adbd',
    labelProp: 'FullAdd',
    detailProps: [
      { key: 'AddSystem', label: 'Addr System' },
      { key: 'City', label: 'City' },
      { key: 'ZipCode', label: 'ZIP' },
      { key: 'PtType', label: 'Type' },
      { key: 'ParcelID', label: 'Parcel' },
    ],
    defaultVisible: false,
    source: 'ugrc',
    attribution: 'Utah AGRC (UGRC)',
  },
];

// ============================================================
// OSM layer configs — derived from the generated catalog (Task 1)
// ============================================================
// One config per (group, category). All share one Mapbox vector source per
// archive (osm-<group>) — never one source per category, or 56 categories
// would open 56 tile streams instead of 9.

const OSM_COVERAGE_CAPTION: Record<OsmGroup['coverage'], string> = {
  sparse: 'Crowd-sourced — only mapped features are shown. Expect unmapped features in the field.',
  incomplete: 'Crowd-sourced — coverage is incomplete. Absence does not indicate none present.',
  attribute: 'Crowd-sourced road attributes. Unstyled roads are untagged, not confirmed paved.',
  boundary: 'Reference boundaries from OpenStreetMap. Not a legal determination of jurisdiction or authority.',
};

const OSM_ATTRIBUTION = `© OpenStreetMap contributors (ODbL) · extract ${OSM_EXTRACT_DATE}`;


// Geometry -> render kind. 'mixed' groups carry both point and line/polygon
// categories; the per-category kind is refined below by inspecting the cat.
function osmKindFor(geometry: OsmGroup['geometry']): VectorLayerKind {
  if (geometry === 'polygon') return 'fill';
  if (geometry === 'line') return 'line';
  return 'icon'; // 'point' and 'mixed' default to icon; buildOsmLayerSpecs
  // further distinguishes fill/line categories within a 'mixed' group by cat.
}

export const OSM_VECTOR_CONFIGS: VectorTileLayerConfig[] = OSM_GROUPS.flatMap((group) =>
  group.categories.map((cat) => ({
    id: `osm_${group.name}_${cat.cat}`,
    label: cat.label,
    description: OSM_CAT_DESCRIPTION[cat.cat] ?? cat.label,
    name: `osm-${group.name}`,
    sourceLayer: group.name,
    sourceMinzoom: Math.min(...group.categories.map((c) => c.minzoom)),
    sourceMaxzoom: 16,
    kind: osmKindFor(group.geometry),
    minzoom: cat.minzoom,
    color: osmColorFor(cat.cat, group.name),
    labelProp: 'name',
    // Intentionally empty for OSM: the OSM popup is built by
    // buildOsmPopupHtml (client/src/utils/osmPopup.ts), which renders EVERY
    // captured tag in US units rather than a per-category field list.
    // detailProps remains in use by the UGRC branch's buildPopupHtml.
    detailProps: [],
    defaultVisible: false,
    source: 'osm' as const,
    attribution: OSM_ATTRIBUTION,
    coverage: OSM_COVERAGE_CAPTION[group.coverage],
    categoryFilter: cat.cat,
    archive: `osm-${group.name}`,
    categoryRender: cat.render,
  })),
);

/**
 * Pure function building the Mapbox layer spec(s) for one OSM category
 * config. Deliberately side-effect-free so paint/filter logic is testable
 * without a live map instance. Never touches the UGRC address-point
 * expressions (houseNumberExpr / ptTypeColorExpression) — those are
 * exclusive to the legacy 'point' branch in addLayer.
 */
// ============================================================
// On-map labels
// ============================================================
// Some values belong on the map rather than behind a click: an officer reading
// a speed limit or a bridge clearance while moving should not have to tap.
//
// Mapbox expressions cannot call our formatters, so unit conversion happens in
// expression form here. Both conversions FAIL CLOSED — an unparseable value
// renders no label at all rather than a wrong number, because a wrong speed
// limit or clearance is worse than none. The popup still carries full detail.

/** OSM maxspeed -> a bare mph number. "45 mph" -> "45"; "80" (km/h) -> "50". */
const MAXSPEED_MPH_EXPR: unknown = [
  'case',
  // Already imperial: take the digits before the space.
  ['>=', ['index-of', 'mph', ['coalesce', ['get', 'maxspeed'], '']], 0],
  ['slice', ['get', 'maxspeed'], 0, ['index-of', ' ', ['get', 'maxspeed']]],
  // A bare number is km/h by OSM convention — convert.
  ['>', ['to-number', ['coalesce', ['get', 'maxspeed'], 'x'], 0], 0],
  ['to-string', ['round', ['*', ['to-number', ['get', 'maxspeed'], 0], 0.621371]]],
  // Anything else ("walk", "RU:urban", "40;60") gets no label.
  '',
];

/** OSM maxheight -> feet, rounded. Bare number = metres; `'` means imperial. */
const CLEARANCE_FT_EXPR: unknown = [
  'case',
  ['>=', ['index-of', "'", ['coalesce', ['get', 'maxheight'], '']], 0],
  ['get', 'maxheight'],
  ['>', ['to-number', ['coalesce', ['get', 'maxheight'], 'x'], 0], 0],
  ['concat', ['to-string', ['round', ['*', ['to-number', ['get', 'maxheight'], 0], 3.28084]]], ' ft'],
  '',
];

/** Which categories get an on-map label, and from what. */
interface LabelRule {
  field: unknown;
  minzoom: number;
  placement: 'line' | 'point';
  size?: number;
}
const OSM_LABEL_RULES: Record<string, LabelRule> = {
  maxspeed: { field: MAXSPEED_MPH_EXPR, minzoom: 14, placement: 'line', size: 11 },
  clearance: { field: CLEARANCE_FT_EXPR, minzoom: 15, placement: 'line', size: 10 },
  junction: { field: ['coalesce', ['get', 'ref'], ''], minzoom: 12, placement: 'point', size: 11 },
  transit: { field: ['coalesce', ['get', 'name'], ''], minzoom: 14, placement: 'point', size: 10 },
  station: { field: ['coalesce', ['get', 'name'], ''], minzoom: 14, placement: 'point', size: 10 },
  school: { field: ['coalesce', ['get', 'name'], ''], minzoom: 15, placement: 'point', size: 10 },
  gov: { field: ['coalesce', ['get', 'name'], ''], minzoom: 15, placement: 'point', size: 10 },
  heli: { field: ['coalesce', ['get', 'name'], ''], minzoom: 13, placement: 'point', size: 10 },
  // Space count and charger count are the one fact an operator wants off a
  // parking structure or a charging site without opening the popup.
  parking: {
    field: ['case', ['has', 'capacity'], ['to-string', ['get', 'capacity']], ''],
    minzoom: 16, placement: 'point', size: 10,
  },
  charging: {
    field: ['case', ['has', 'capacity'], ['to-string', ['get', 'capacity']], ''],
    minzoom: 16, placement: 'point', size: 10,
  },
  // Operator at high zoom only — a name on every CCTV at z15 is clutter.
  alpr: {
    field: ['coalesce', ['get', 'operator'], ['get', 'name'], ''],
    minzoom: 16, placement: 'point', size: 9,
  },
  camera: {
    field: ['coalesce', ['get', 'operator'], ['get', 'name'], ''],
    minzoom: 17, placement: 'point', size: 9,
  },
};

export function buildOsmLabelSpec(
  cfg: VectorTileLayerConfig,
  idBase: string,
  base: { filter: unknown[]; 'source-layer': string; minzoom: number; layout: { visibility: 'none' } },
  renderType: OsmLayerSpec['type'],
): OsmLayerSpec | null {
  const rule = OSM_LABEL_RULES[cfg.categoryFilter ?? ''];
  if (!rule) return null;
  return {
    id: `${idBase}-label`,
    type: 'symbol',
    ...base,
    // Labels are gated LATER than their geometry: a speed value at z13 is
    // unreadable clutter even though the line itself is useful there.
    minzoom: Math.max(base.minzoom, rule.minzoom),
    layout: {
      ...base.layout,
      'text-field': rule.field,
      'text-size': rule.size ?? 10,
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
      'text-allow-overlap': false,
      ...(rule.placement === 'line' && renderType === 'line'
        ? { 'symbol-placement': 'line-center' as const }
        : { 'text-offset': [0, 1.1], 'text-anchor': 'top' as const }),
    },
    paint: {
      'text-color': '#f0f4f9',
      // Halo is what makes a label legible over the dark basemap AND over the
      // overlay geometry beneath it.
      'text-halo-color': '#0a1422',
      'text-halo-width': 1.4,
    },
  };
}

export function buildOsmLayerSpecs(cfg: VectorTileLayerConfig, isLight: boolean): OsmLayerSpec[] {
  const filter = ['==', ['get', 'cat'], cfg.categoryFilter] as unknown[];
  const base = {
    filter,
    'source-layer': cfg.sourceLayer,
    minzoom: cfg.minzoom,
    layout: { visibility: 'none' as const },
  };

  // The per-category `render` value from the generated catalog is authoritative
  // for OSM configs — it already accounts for 'mixed' geometry groups (e.g.
  // traffic/maxspeed and traffic/restriction are way-only and render as lines
  // even though the traffic group as a whole is 'mixed').
  let type: OsmLayerSpec['type'];
  if (cfg.categoryRender === 'polygon') {
    type = 'fill';
  } else if (cfg.categoryRender === 'line') {
    type = 'line';
  } else {
    type = 'circle';
  }

  const specs: OsmLayerSpec[] = [];
  const idBase = `vt-${cfg.id}`;
  const cat = cfg.categoryFilter ?? '';

  if (isCameraConeCat(cat)) {
    // Fill first (under), then identity outlines. ALPR = solid cyan edge;
    // public CCTV = dashed violet. Opacity stays well under 0.35 so streets
    // and names remain readable through the wedge.
    specs.push({
      id: `${idBase}-fill`,
      type: 'fill',
      ...base,
      filter: cameraConeFilter(),
      paint: cameraConeFillPaint(),
    });
    specs.push({
      id: `${idBase}-outline-alpr`,
      type: 'line',
      ...base,
      filter: cameraConeFilter('alpr'),
      paint: cameraConeOutlinePaint('alpr'),
    });
    specs.push({
      id: `${idBase}-outline-camera`,
      type: 'line',
      ...base,
      filter: cameraConeFilter('camera'),
      paint: cameraConeOutlinePaint('camera'),
    });
  } else if (type === 'fill') {
    specs.push({
      id: `${idBase}-fill`,
      type: 'fill',
      ...base,
      paint: osmFillPaint(cat, cfg.color),
    });
    specs.push({
      id: `${idBase}-outline`,
      type: 'line',
      ...base,
      paint: osmFillOutlinePaint(cfg.color),
    });
  } else if (type === 'line') {
    specs.push({
      id: `${idBase}-line`,
      type: 'line',
      ...base,
      layout: { ...base.layout, 'line-join': 'round', 'line-cap': 'round' },
      paint: osmLinePaint(cat, cfg.color, cfg.minzoom),
    });
  } else {
    // Point categories: use our own registered icon so a hydrant, a camera and
    // a power pole are distinguishable. iconIdForCat only returns ids that
    // ensureOsmIcons registers via map.addImage — never a bare basemap sprite
    // name, because a missing sprite name renders NOTHING, silently.
    const iconId = iconIdForCat(cat);
    if (iconId) {
      if (isSurveillanceCameraCat(cat)) {
        // Identity ring under the glyph — colour is the tool (ALPR vs CCTV),
        // silhouette is the object. No bloom, no glow.
        specs.push({
          id: `${idBase}-halo`,
          type: 'circle',
          ...base,
          paint: cameraHaloPaint(cat, cfg.minzoom),
        });
      }
      specs.push({
        id: `${idBase}-symbol`,
        type: 'symbol',
        ...base,
        layout: {
          ...base.layout,
          ...(isSurveillanceCameraCat(cat)
            ? cameraSymbolLayout(cat, cfg.minzoom, iconImageExpression(cat, cfg.minzoom) ?? iconId)
            : {
              'icon-image': iconImageExpression(cat, cfg.minzoom) ?? iconId,
              'icon-size': ['interpolate', ['linear'], ['zoom'], cfg.minzoom, 0.26, 18, 0.5],
              'icon-allow-overlap': false,
              'icon-ignore-placement': false,
            }),
          'symbol-sort-key': symbolSortKeyFor(cat),
        },
        paint: {},
      });
    } else {
      specs.push({
        id: `${idBase}-circle`,
        type: 'circle',
        ...base,
        paint: {
          'circle-color': cfg.color,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], cfg.minzoom, 3, 18, 7],
          'circle-stroke-color': isLight ? '#1a2332' : '#0a0a0a',
          'circle-stroke-width': 1,
        },
      });
    }
  }

  const labelSpec = buildOsmLabelSpec(cfg, idBase, base, type);
  if (labelSpec) specs.push(labelSpec);

  return specs;
}

/**
 * Every layer id that should carry click/hover for one OSM config.
 *
 * Polygon categories emit BOTH a `-fill` and a `-outline` layer. The original
 * implementation bound interaction to `specs[specs.length - 1]`, described in a
 * comment as "the topmost/interactive one" — but for a polygon that is the 1px
 * outline, so clicking anywhere inside the polygon hit nothing. Binding every
 * emitted id is also correct for any future category that emits more layers.
 */
export function osmInteractiveLayerIds(cfg: VectorTileLayerConfig, isLight: boolean): string[] {
  return Array.from(new Set(buildOsmLayerSpecs(cfg, isLight).map((s) => s.id)));
}

export interface VectorLayerState {
  visible: boolean;
  loaded: boolean;
}

interface UseVectorTileLayersOptions {
  map: mapboxgl.Map | null;
  popup: mapboxgl.Popup | null;
  /** True when the active basemap is a light style — flips label colors for legibility. */
  isLight?: boolean;
  /**
   * Fired when a feature is clicked while NOT in a passive state — lets the
   * map page route an address/road into dispatch (e.g. "set call location").
   * When provided, address-point/road popups gain a "Use this location" action.
   */
  onUseLocation?: (info: { lng: number; lat: number; label: string; kind: VectorLayerKind; props: Record<string, any> }) => void;
  /** RMPG's internal overrides, keyed by OSM element id. Merged into the popup
   *  at display time; the tile data itself is immutable. */
  osmOverrides?: Map<string, OsmOverride>;
  /** osm_ids an operator has hidden. Applied as a Mapbox filter. */
  osmHiddenIds?: string[];
  /** Opens the override editor for a feature. When absent, the popup shows no
   *  edit affordance — read-only roles simply never get the callback. */
  onEditOsmFeature?: (info: {
    osmId: string; group: string; cat: string | null;
    categoryLabel: string; featureName: string; osmTags: Record<string, unknown>;
  }) => void;
}

function srcId(id: string) { return `vt-${id}`; }
function lineLayerId(id: string) { return `vt-${id}-line`; }
function circleLayerId(id: string) { return `vt-${id}-circle`; }
function labelLayerId(id: string) { return `vt-${id}-label`; }
/** One shared Mapbox vector source per OSM archive — never per-category. */
function osmSourceId(archive: string) { return `vt-src-${archive}`; }

export const ALL_VECTOR_CONFIGS: VectorTileLayerConfig[] = [...VECTOR_TILE_CONFIGS, ...OSM_VECTOR_CONFIGS];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


export function useVectorTileLayers({
  map, popup, isLight = false, onUseLocation,
  osmOverrides, osmHiddenIds, onEditOsmFeature,
}: UseVectorTileLayersOptions) {
  const [layerStates, setLayerStates] = useState<Record<string, VectorLayerState>>(() => {
    const init: Record<string, VectorLayerState> = {};
    // Visibility is config-driven (cfg.defaultVisible) — every layer, UGRC or
    // OSM, defaults OFF. A cfg with defaultVisible:true would still be brought
    // up automatically on map ready (see the auto-enable effect below) without
    // requiring an operator toggle; today no config sets that flag.
    for (const cfg of ALL_VECTOR_CONFIGS) init[cfg.id] = { visible: cfg.defaultVisible, loaded: false };
    return init;
  });

  const popupRef = useRef(popup);
  useEffect(() => { popupRef.current = popup; }, [popup]);
  const osmOverridesRef = useRef(osmOverrides);
  useEffect(() => { osmOverridesRef.current = osmOverrides; }, [osmOverrides]);
  const onEditOsmFeatureRef = useRef(onEditOsmFeature);
  useEffect(() => { onEditOsmFeatureRef.current = onEditOsmFeature; }, [onEditOsmFeature]);
  const isLightRef = useRef(isLight);
  useEffect(() => { isLightRef.current = isLight; }, [isLight]);
  const onUseLocationRef = useRef(onUseLocation);
  useEffect(() => { onUseLocationRef.current = onUseLocation; }, [onUseLocation]);

  // Guard against double-add when multiple effects race the style-ready gate.
  const addedRef = useRef<Set<string>>(new Set());
  const clickBoundRef = useRef<Set<string>>(new Set());
  // Mirror of layerStates for use inside the persistent style.load handler,
  // which must re-add visible layers after a basemap switch without re-binding.
  const layerStatesRef = useRef(layerStates);
  useEffect(() => { layerStatesRef.current = layerStates; }, [layerStates]);

  // Label paint that stays legible on both dark and light basemaps.
  const labelPaint = (light: boolean) => ({
    text: light ? '#3a2e05' : '#e8d8a8',
    halo: light ? '#ffffff' : '#000000',
  });

  const buildPopupHtml = useCallback((cfg: VectorTileLayerConfig, props: Record<string, any>): string => {
    const titleRaw = props[cfg.labelProp];
    const title = titleRaw != null && String(titleRaw).trim() !== '' ? String(titleRaw) : cfg.label;
    let html = `<div style="font-family:'Courier New',monospace;color:#d4d4d4;font-size:11px;min-width:150px;">`;
    html += `<div style="font-weight:bold;font-size:12px;color:${cfg.color};margin-bottom:3px;border-bottom:1px solid #444;padding-bottom:3px;">${escapeHtml(title)}</div>`;
    // Subtitle: layer label + (for address points) a colored property-type chip.
    let subtitle = `<span style="color:#888;font-size:9px;text-transform:uppercase;">${escapeHtml(cfg.label)}</span>`;
    if (cfg.kind === 'point') {
      const pt = classifyPtType(props.PtType);
      subtitle += ` <span style="display:inline-block;font-size:8px;font-weight:bold;letter-spacing:0.4px;color:#0a0a0a;background:${pt.color};border-radius:2px;padding:0 4px;margin-left:2px;">${pt.code} · ${escapeHtml(pt.label).toUpperCase()}</span>`;
    }
    html += `<div style="margin-bottom:4px;">${subtitle}</div>`;
    for (const d of cfg.detailProps) {
      let v = props[d.key];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      if (d.key === 'CARTOCODE') { const rc = classifyCartocode(v); v = rc.label; }
      if (d.key === 'PtType') continue; // shown as the chip above
      html += `<div style="font-size:10px;color:#999;margin-top:2px;"><span style="color:#bbb;">${escapeHtml(d.label)}:</span> ${escapeHtml(String(v))}</div>`;
    }
    html += `</div>`;
    return html;
  }, []);

  const addLayer = useCallback((cfg: VectorTileLayerConfig) => {
    if (!map) return;
    if (addedRef.current.has(cfg.id)) return;

    whenStyleReady(map, () => {
      if (addedRef.current.has(cfg.id)) return;
      const source = srcId(cfg.id);
      const lp = labelPaint(isLightRef.current);

      try {
        // OSM branch — one shared vector source per archive, one filtered
        // layer per category (buildOsmLayerSpecs). Deliberately separate from
        // the UGRC line/point branches below: those contain address-point
        // logic (houseNumberExpr, ptTypeColorExpression) that is meaningless
        // for OSM features, and OSM configs must never reach it.
        if (cfg.source === 'osm') {
          if (!cfg.archive || !cfg.categoryFilter) {
            throw new Error(`OSM config ${cfg.id} is missing archive/categoryFilter`);
          }
          // Icons MUST be registered before any symbol layer referencing them is
          // added — Mapbox renders nothing, silently, for an unknown icon-image.
          // Fire-and-forget is safe: ensureOsmIcons is idempotent, the `idle`
          // self-heal re-adds any layer that failed, and setStyle() wipes images
          // so this also has to re-run from the style.load handler.
          void ensureOsmIcons(map);
          const osmSource = osmSourceId(cfg.archive);
          if (!hasSource(map, osmSource)) {
            map.addSource(osmSource, {
              type: 'vector',
              tiles: [tilesUrl(cfg.archive)],
              minzoom: cfg.sourceMinzoom,
              maxzoom: cfg.sourceMaxzoom,
            } as any);
          }

          const specs = buildOsmLayerSpecs(cfg, isLightRef.current);
          const beforeId = isCameraConeCat(cfg.categoryFilter ?? '')
            ? cameraConeBeforeLayerId((id) => hasLayer(map, id))
            : undefined;
          for (const spec of specs) {
            if (!hasLayer(map, spec.id)) {
              map.addLayer({
                id: spec.id,
                type: spec.type,
                source: osmSource,
                'source-layer': spec['source-layer'],
                minzoom: spec.minzoom,
                filter: spec.filter as any,
                layout: spec.layout as any,
                paint: spec.paint as any,
              } as any, beforeId && hasLayer(map, beforeId) ? beforeId : undefined);
            }
          }

          // Bind click + hover on EVERY layer this config emits, not just the
          // topmost spec. A polygon category emits [fill, outline], and the
          // previous `specs[specs.length - 1]` put the target on the 1px
          // OUTLINE — so clicking inside the polygon, which is the whole
          // polygon, hit nothing. Binding every emitted id is also correct for
          // any future category that emits more than two layers.
          //
          // The popup body below is the rich OSM popup (every captured tag in
          // US units, RMPG overrides merged over the tile data, EDIT/VERIFY).
          // It is bound here per-layer rather than via a map-level identify
          // handler: two handlers writing the same popup instance on one click
          // renders twice, with the winner decided by registration order.
          for (const layerId of osmInteractiveLayerIds(cfg, isLightRef.current)) {
            if (clickBoundRef.current.has(layerId)) continue;
            clickBoundRef.current.add(layerId);
            map.on('click', layerId, (e) => {
              const pop = popupRef.current;
              if (!pop || !e.features || e.features.length === 0) return;
              const rawProps = e.features[0].properties || {};
              const osmId = String(rawProps.osm_id ?? '').trim();
              // Join RMPG's override over the immutable tile data at display
              // time. Corrections overlay; the OSM tags underneath survive.
              const props = mergeOverride(rawProps, osmOverridesRef.current?.get(osmId));
              // OSM features get the detail popup: every captured tag, in US
              // units, with the coverage caveat and a link to the OSM record.
              let html = buildOsmPopupHtml(props, {
                categoryLabel: cfg.label,
                coverage: cfg.coverage,
              });
              const canEdit = Boolean(onEditOsmFeatureRef.current) && osmId !== '';
              if (canEdit) {
                html += `<button type="button" data-osm-edit="1" style="margin-top:6px;width:100%;`
                  + `padding:4px;font-family:system-ui;font-size:10px;font-weight:600;`
                  + `letter-spacing:0.4px;color:#0a1422;background:#c3ccd6;border:none;`
                  + `border-radius:2px;cursor:pointer;">EDIT / VERIFY</button>`;
              }
              pop.setLngLat(e.lngLat).setHTML(html).addTo(map);
              if (canEdit) {
                // DELEGATE. A setTimeout + getElementById attaches to nothing
                // when it loses the race against Mapbox re-rendering the popup
                // DOM — a documented failure in this codebase. Listening on the
                // popup container and matching on the way up always wins.
                const el = pop.getElement();
                if (el && !el.dataset.osmEditBound) {
                  el.dataset.osmEditBound = '1';
                  el.addEventListener('click', (ev) => {
                    const hit = (ev.target as HTMLElement | null)?.closest('[data-osm-edit]');
                    if (!hit) return;
                    const current = pop.getElement()?.dataset.osmCtx;
                    if (!current) return;
                    try {
                      onEditOsmFeatureRef.current?.(JSON.parse(current));
                    } catch { /* malformed context; ignore rather than throw in a click */ }
                  });
                }
                // Context is re-stamped on EVERY open, so the one delegated
                // listener always acts on the feature currently shown.
                if (el) {
                  el.dataset.osmCtx = JSON.stringify({
                    osmId,
                    group: cfg.archive?.replace(/^osm-/, '') ?? '',
                    cat: cfg.categoryFilter ?? null,
                    categoryLabel: cfg.label,
                    featureName: String(rawProps.name ?? ''),
                    osmTags: rawProps,
                  });
                }
              }
            });
            map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
          }

          if (layerStatesRef.current[cfg.id]?.visible) {
            for (const spec of specs) {
              try { if (hasLayer(map, spec.id)) map.setLayoutProperty(spec.id, 'visibility', 'visible'); } catch { /* noop */ }
            }
          }

          addedRef.current.add(cfg.id);
          setLayerStates((prev) => ({ ...prev, [cfg.id]: { ...prev[cfg.id], loaded: true } }));
          return;
        }

        if (!hasSource(map, source)) {
          map.addSource(source, {
            type: 'vector',
            tiles: [tilesUrl(cfg.name)],
            minzoom: cfg.sourceMinzoom,
            maxzoom: cfg.sourceMaxzoom,
          } as any);
        }

        if (cfg.kind === 'line') {
          if (!hasLayer(map, lineLayerId(cfg.id))) {
            map.addLayer({
              id: lineLayerId(cfg.id),
              type: 'line',
              source,
              'source-layer': cfg.sourceLayer,
              // Always load regardless of zoom — gate only at the archive's own
              // min zoom (z6) so roads appear statewide, not just zoomed in.
              minzoom: cfg.sourceMinzoom,
              layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                // Road-class color codes generated from the shared ROAD_CLASSES
                // taxonomy (landTypes.ts) — Interstate red → driveway dark-gold —
                // so the rendered network matches the legend exactly.
                'line-color': roadColorExpression(cfg.color) as any,
                'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  6, ['match', ['to-string', ['get', 'CARTOCODE']], '1', 1.2, '2', 0.9, '3', 0.6, 0.2],
                  9, ['match', ['to-string', ['get', 'CARTOCODE']], '1', 2, '2', 1.6, '3', 1.2, 0.4],
                  14, ['match', ['to-string', ['get', 'CARTOCODE']], '1', 4, '2', 3, '3', 2.4, 1.2],
                  18, ['match', ['to-string', ['get', 'CARTOCODE']], '1', 7, '2', 6, '3', 5, 3],
                ] as any,
                // Below z9, only major roads carry visible opacity so the
                // statewide view isn't a solid web of local streets.
                'line-opacity': [
                  'interpolate', ['linear'], ['zoom'],
                  6, ['match', ['to-string', ['get', 'CARTOCODE']], '1', 0.7, '2', 0.55, '3', 0.4, 0.12],
                  9, 0.45, 14, 0.85,
                ] as any,
              },
            });
          }
          // Road name labels at high zoom.
          if (!hasLayer(map, labelLayerId(cfg.id))) {
            map.addLayer({
              id: labelLayerId(cfg.id),
              type: 'symbol',
              source,
              'source-layer': cfg.sourceLayer,
              minzoom: 13,
              layout: {
                visibility: 'none',
                'symbol-placement': 'line',
                'text-field': ['coalesce', ['get', 'FULLNAME'], ['get', 'NAME'], ''] as any,
                // Visual-harmony: major roads (lower sort key) win label
                // collisions over local streets, and label slightly larger,
                // so the network reads cleanly instead of as label soup.
                'symbol-sort-key': roadSortKeyExpression() as any,
                'text-size': ['match', ['to-string', ['get', 'CARTOCODE']], '1', 12, '2', 11.5, '3', 11, 10] as any,
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
              },
              paint: {
                'text-color': lp.text,
                'text-halo-color': lp.halo,
                'text-halo-width': 1.4,
              },
            });
          }
        } else {
          // Point layer — address NUMBERS (not dots), colored by property type.
          // Extract the leading house number from FullAdd ("3515 S 5600 W" →
          // "3515") via index-of/slice; fall back to AddNum or the full string.
          const houseNumberExpr = [
            'case',
            ['has', 'AddNum'], ['to-string', ['get', 'AddNum']],
            ['>', ['index-of', ' ', ['coalesce', ['get', 'FullAdd'], '']], 0],
            ['slice', ['coalesce', ['get', 'FullAdd'], ''], 0, ['index-of', ' ', ['coalesce', ['get', 'FullAdd'], '']]],
            ['coalesce', ['get', 'FullAdd'], ''],
          ];
          if (!hasLayer(map, circleLayerId(cfg.id))) {
            map.addLayer({
              id: circleLayerId(cfg.id),
              type: 'symbol',
              source,
              'source-layer': cfg.sourceLayer,
              // Always load regardless of zoom — gate at the archive's own min
              // (z10) so address points appear well before street level.
              minzoom: cfg.sourceMinzoom,
              layout: {
                visibility: 'none',
                'text-field': houseNumberExpr as any,
                'text-size': ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 10, 18, 13] as any,
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
                'text-allow-overlap': false,
                'text-padding': 1,
              },
              paint: {
                // Full building/property-type color-coding generated from the
                // shared PROPERTY_TYPES taxonomy (landTypes.ts): residential,
                // commercial, industrial, agricultural, mixed, government,
                // education, religious, medical, recreation, utility,
                // transportation, vacant + Other. One source drives map+legend.
                'text-color': ptTypeColorExpression(cfg.color) as any,
                'text-halo-color': '#0a0a0a',
                'text-halo-width': 1.2,
              },
            });
          }
          if (!hasLayer(map, labelLayerId(cfg.id))) {
            map.addLayer({
              id: labelLayerId(cfg.id),
              type: 'symbol',
              source,
              'source-layer': cfg.sourceLayer,
              minzoom: 16,
              layout: {
                visibility: 'none',
                // Street part only — the house number is already rendered by
                // the point layer above; avoid printing it twice.
                'text-field': [
                  'case',
                  ['>', ['index-of', ' ', ['coalesce', ['get', 'FullAdd'], '']], 0],
                  ['slice', ['coalesce', ['get', 'FullAdd'], ''], ['+', ['index-of', ' ', ['coalesce', ['get', 'FullAdd'], '']], 1]],
                  '',
                ] as any,
                'text-size': 9,
                'text-offset': [0, 0.9],
                'text-anchor': 'top',
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
                'text-allow-overlap': false,
              },
              paint: {
                'text-color': lp.text,
                'text-halo-color': lp.halo,
                'text-halo-width': 1.2,
              },
            });
          }
        }

        // Click popup — bound once per layer. Read popup from ref so the
        // handler stays current without rebinding.
        const interactiveLayer = cfg.kind === 'line' ? lineLayerId(cfg.id) : circleLayerId(cfg.id);
        if (!clickBoundRef.current.has(cfg.id)) {
          clickBoundRef.current.add(cfg.id);
          map.on('click', interactiveLayer, (e) => {
            const pop = popupRef.current;
            if (!pop || !e.features || e.features.length === 0) return;
            const props = e.features[0].properties || {};
            const titleRaw = props[cfg.labelProp];
            const label = titleRaw != null && String(titleRaw).trim() !== '' ? String(titleRaw) : cfg.label;
            let html = buildPopupHtml(cfg, props);
            const canUse = !!onUseLocationRef.current;
            if (canUse) {
              html += `<button id="vt-use-loc" style="margin-top:6px;width:100%;padding:4px;font-family:'Courier New',monospace;font-size:10px;font-weight:bold;letter-spacing:0.5px;color:#0a0a0a;background:${cfg.color};border:none;border-radius:2px;cursor:pointer;text-transform:uppercase;">Use This Location</button>`;
            }
            pop.setLngLat(e.lngLat).setHTML(html).addTo(map);
            if (canUse) {
              const el = pop.getElement()?.querySelector('#vt-use-loc') as HTMLButtonElement | null;
              if (el) {
                el.addEventListener('click', () => {
                  onUseLocationRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat, label, kind: cfg.kind, props });
                  pop.remove();
                });
              }
            }
          });
          map.on('mouseenter', interactiveLayer, () => { map.getCanvas().style.cursor = 'pointer'; });
          map.on('mouseleave', interactiveLayer, () => { map.getCanvas().style.cursor = ''; });
        }

        // Apply the desired visibility now that the layers actually exist. The
        // layers are created with visibility:'none', so for the always-on
        // default (and basemap-switch restore) we must flip them on HERE —
        // an external setLayoutProperty fired before whenStyleReady resolves
        // would no-op against a not-yet-created layer and leave them stuck off.
        if (layerStatesRef.current[cfg.id]?.visible) {
          const visIds = cfg.kind === 'line'
            ? [lineLayerId(cfg.id), labelLayerId(cfg.id)]
            : [circleLayerId(cfg.id), labelLayerId(cfg.id)];
          for (const id of visIds) {
            try { if (hasLayer(map, id)) map.setLayoutProperty(id, 'visibility', 'visible'); } catch { /* noop */ }
          }
        }

        addedRef.current.add(cfg.id);
        setLayerStates((prev) => ({ ...prev, [cfg.id]: { ...prev[cfg.id], loaded: true } }));
      } catch (err) {
        console.error(`[VectorTiles] Failed to add ${cfg.id}:`, err);
      }
    });
  }, [map, buildPopupHtml]);

  const setLayerVisibility = useCallback((cfg: VectorTileLayerConfig, visible: boolean) => {
    if (!map) return;
    const vis = visible ? 'visible' : 'none';
    if (cfg.source === 'osm') {
      for (const spec of buildOsmLayerSpecs(cfg, isLightRef.current)) {
        try { if (hasLayer(map, spec.id)) map.setLayoutProperty(spec.id, 'visibility', vis); } catch { /* style not ready */ }
      }
      return;
    }
    const ids = cfg.kind === 'line'
      ? [lineLayerId(cfg.id), labelLayerId(cfg.id)]
      : [circleLayerId(cfg.id), labelLayerId(cfg.id)];
    for (const id of ids) {
      try { if (hasLayer(map, id)) map.setLayoutProperty(id, 'visibility', vis); } catch { /* style not ready */ }
    }
  }, [map]);

  const toggleVectorLayer = useCallback((layerId: string) => {
    const cfg = ALL_VECTOR_CONFIGS.find((c) => c.id === layerId);
    if (!cfg) return;
    setLayerStates((prev) => {
      const curr = prev[layerId];
      if (!curr) return prev;
      const nowVisible = !curr.visible;
      if (nowVisible && !curr.loaded) addLayer(cfg);
      // Defer visibility flip a tick so addLayer's style-ready callback can
      // create the layers first on the very first toggle.
      setTimeout(() => setLayerVisibility(cfg, nowVisible), 0);
      return { ...prev, [layerId]: { ...curr, visible: nowVisible } };
    });
  }, [addLayer, setLayerVisibility]);

  // Basemap-switch / print resilience. map.setStyle() (basemap change in
  // MapPage, or the print light-mode swap) WIPES every custom source + layer
  // but keeps the same map instance, firing 'style.load' when the new style is
  // ready. Other overlays survive by keying their effects on mapStyle; we
  // instead listen directly so we also cover print mode. Clear add-tracking
  // and re-create whatever was visible, then restore its visibility.
  useEffect(() => {
    if (!map) return;
    const onStyleLoad = () => {
      // setStyle() also wipes every image registered via map.addImage, so the
      // OSM icons must be re-registered or every symbol layer silently renders
      // nothing after a basemap switch. Idempotent, so this is safe to repeat.
      void ensureOsmIcons(map);
      // setStyle() wipes layers/sources (so addedRef must be cleared to re-add
      // them) but Mapbox RETAINS map-level delegated listeners across a style
      // change. Do NOT clear clickBoundRef here: re-running addLayer would then
      // bind a SECOND click/hover handler on the same layer id while the first
      // is still attached, so each basemap switch added another duplicate
      // (N switches → N stacked popups + N 'Use This Location' dispatch
      // callbacks). Keeping clickBoundRef means the handlers bind exactly once
      // per layer for the life of the map instance.
      addedRef.current.clear();
      for (const cfg of ALL_VECTOR_CONFIGS) {
        if (layerStatesRef.current[cfg.id]?.visible) {
          addLayer(cfg);
          setLayerVisibility(cfg, true);
        }
      }
    };
    map.on('style.load', onStyleLoad);
    return () => { map.off('style.load', onStyleLoad); };
  }, [map, addLayer, setLayerVisibility]);

  // Always-on: auto-add every statewide layer once the map exists. addLayer
  // defers internally until the style is ready and then applies the visible
  // state (see above), so this reliably brings the statewide DB up on first
  // load without the operator having to toggle it. Runs once per map instance.
  const autoEnabledRef = useRef(false);
  useEffect(() => {
    if (!map) { autoEnabledRef.current = false; return; }
    if (autoEnabledRef.current) return;
    autoEnabledRef.current = true;
    for (const cfg of ALL_VECTOR_CONFIGS) {
      if (layerStatesRef.current[cfg.id]?.visible) addLayer(cfg);
    }
  }, [map, addLayer]);

  // ── Self-healing safety net ──────────────────────────────────────────────
  // Every other add path hangs off a SINGLE one-shot signal (whenStyleReady's
  // immediate call or the next 'style.load'). If that signal is missed — the
  // style finished before the listener attached, a setStyle() wipe + re-add
  // raced, the source errored once, or a slow/throttled edge stalled the style
  // so style.load never fired — the layers are never added and nothing retries,
  // so the statewide overlays silently never appear (confirmed live: a fully
  // built basemap with zero vt-* layers/sources). 'idle' fires whenever the map
  // settles after any render/interaction; we use it as an idempotent re-assert:
  // for each layer that SHOULD be visible, if its layer is missing from the
  // style, re-add it. addLayer is guarded by addedRef + getLayer/getSource
  // checks, so this is a no-op once everything is present.
  useEffect(() => {
    if (!map) return;
    const ensure = () => {
      for (const cfg of ALL_VECTOR_CONFIGS) {
        if (!layerStatesRef.current[cfg.id]?.visible) continue;
        const dataLayer = cfg.source === 'osm'
          ? buildOsmLayerSpecs(cfg, isLightRef.current)[0]?.id
          : (cfg.kind === 'line' ? lineLayerId(cfg.id) : circleLayerId(cfg.id));
        if (!dataLayer) continue;
        try {
          if (!hasLayer(map, dataLayer)) {
            // Layer absent (never added, or wiped by a style swap and not
            // re-added) — clear the add-guard and rebuild it.
            addedRef.current.delete(cfg.id);
            addLayer(cfg);
            setLayerVisibility(cfg, true);
          }
        } catch { /* style mid-swap; next idle retries */ }
      }
    };
    map.on('idle', ensure);
    return () => { map.off('idle', ensure); };
  }, [map, addLayer, setLayerVisibility]);

  // Re-color live when the basemap light/dark theme changes, for layers already
  // on the map (newly added ones pick up the current theme in addLayer).
  //
  // This previously looped VECTOR_TILE_CONFIGS only, so OSM circle layers — whose
  // circle-stroke-color is derived from isLight at add time — kept a dark stroke
  // after a switch to a light basemap and lost their outline against it.
  useEffect(() => {
    if (!map) return;
    const lp = labelPaint(isLight);
    for (const cfg of VECTOR_TILE_CONFIGS) {
      const id = labelLayerId(cfg.id);
      try {
        if (hasLayer(map, id)) {
          map.setPaintProperty(id, 'text-color', lp.text);
          map.setPaintProperty(id, 'text-halo-color', lp.halo);
        }
      } catch { /* style not ready */ }
    }
    for (const cfg of OSM_VECTOR_CONFIGS) {
      for (const spec of buildOsmLayerSpecs(cfg, isLight)) {
        if (spec.type !== 'circle') continue;
        try {
          if (hasLayer(map, spec.id)) {
            map.setPaintProperty(
              spec.id, 'circle-stroke-color', spec.paint['circle-stroke-color'] as any,
            );
          }
        } catch { /* style not ready */ }
      }
    }
  }, [map, isLight]);

  // ── Hidden-feature filter ──────────────────────────────────────────────
  // An operator can suppress a feature (bad data, demolished, duplicate). The
  // tiles are immutable, so suppression is a Mapbox filter re-applied whenever
  // the hidden set changes. Re-applied on 'idle' too: a style swap resets every
  // layer's filter back to the spec's base clause.
  const hiddenKey = (osmHiddenIds ?? []).join(',');
  useEffect(() => {
    if (!map) return;
    const apply = () => {
      const extra = hiddenFilterClause(osmHiddenIds ?? []);
      for (const cfg of OSM_VECTOR_CONFIGS) {
        for (const spec of buildOsmLayerSpecs(cfg, isLightRef.current)) {
          try {
            if (!hasLayer(map, spec.id)) continue;
            // Compose against the spec's OWN base filter rather than reading
            // the live one back — reading it back and re-wrapping would nest
            // an extra `all` on every pass until the expression exploded.
            map.setFilter(spec.id, (extra ? ['all', spec.filter, extra] : spec.filter) as never);
          } catch { /* style mid-swap; the idle handler retries */ }
        }
      }
    };
    apply();
    map.on('idle', apply);
    return () => { map.off('idle', apply); };
  }, [map, hiddenKey, osmHiddenIds]);

  // Reset per-map tracking when the map instance changes (handlers/layers
  // live on the map; a new map needs fresh adds).
  useEffect(() => {
    addedRef.current.clear();
    clickBoundRef.current.clear();
    if (map) {
      setLayerStates((prev) => {
        const next = { ...prev };
        for (const cfg of ALL_VECTOR_CONFIGS) next[cfg.id] = { ...next[cfg.id], loaded: false };
        return next;
      });
    }
  }, [map]);

  return {
    vectorLayerStates: layerStates,
    toggleVectorLayer,
    vectorConfigs: ALL_VECTOR_CONFIGS,
  };
}
