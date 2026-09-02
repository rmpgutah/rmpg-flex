// ============================================================
// RMPG Flex — OSM overlay icon registration and map expressions
// ============================================================
// The artwork lives in osmIconArt.ts. This module owns sprite ids, rasterising
// them into the map, and the Mapbox expressions that pick which sprite a given
// feature gets.
//
// Three hard rules, all learned the hard way:
//
// 1. NEVER reference a bare `icon-image` name from the basemap sprite. If the
//    sprite lacks that name Mapbox renders NOTHING — no error, no warning, no
//    console line. Every id here is registered by us via map.addImage first,
//    and every branch of every expression below resolves to one of them.
// 2. Categories must differ by SHAPE, not colour. The set is single-ink line
//    art precisely so this holds; a test strips colour attributes and requires
//    the remaining geometry to still be unique.
// 3. map.setStyle() (basemap switch, print mode) wipes registered images, so
//    ensureOsmIcons is idempotent and is re-run on every style.load.
// ============================================================

import type mapboxgl from 'mapbox-gl';
import { OSM_GROUPS } from '../config/osmLayers.generated';
import {
  GLYPHS, GROUP_TINT, NFPA_BONNET, CONTROL_VARIANTS, CAMERA_VARIANTS, MUTABLE_CATS,
  hydrantWithBonnet, renderIcon, renderSimple, renderMuted,
  type GlyphArt,
} from './osmIconArt';

export interface OsmIconSpec {
  id: string;
  svg: string;
  /** Design-box edge in CSS px. Rasterised at RASTER_SCALE. */
  size: number;
}

/** Design box. Large enough that 3x supersampling still resolves 1.9px strokes. */
const BOX = 64;
/**
 * Raster multiplier. Paired with `pixelRatio: RASTER_SCALE` on addImage so the
 * bitmap is supersampled rather than upscaled — line art shows undersampling
 * far more brutally than filled shapes do.
 */
const RASTER_SCALE = 3;

/** cat -> owning OSM group, derived from the generated catalog. */
const GROUP_BY_CAT: Record<string, string> = {};
for (const group of OSM_GROUPS) {
  for (const cat of group.categories) GROUP_BY_CAT[cat.cat] = group.name;
}

function tintFor(cat: string): string {
  if (cat === 'alpr') return '#38bdf8';
  if (cat === 'camera') return '#a78bfa';
  return GROUP_TINT[GROUP_BY_CAT[cat] ?? ''] ?? '#c3ccd6';
}

// ── Sprite id scheme ─────────────────────────────────────────
// Every id below is registered. Nothing constructs an id at call time.
export const baseId = (cat: string) => `osm-${cat}`;
export const lowZoomId = (cat: string) => `osm-${cat}-lo`;
export const mutedId = (cat: string) => `osm-${cat}-muted`;
const variantId = (cat: string, variant: string) => `osm-${cat}-${variant}`;

/**
 * Every sprite, keyed by id. Built once at module load: the SVG strings are
 * pure and deterministic, so there is no reason to rebuild them per map.
 */
export const OSM_ICON_SPECS: Record<string, OsmIconSpec> = {};

function register(id: string, svg: string): void {
  OSM_ICON_SPECS[id] = { id, svg, size: BOX };
}

for (const [cat, art] of Object.entries(GLYPHS)) {
  const tint = tintFor(cat);
  register(baseId(cat), renderIcon(cat, tint, art));
  register(lowZoomId(cat), renderSimple(`${cat}L`, tint, art));
}
for (const cat of MUTABLE_CATS) {
  const art = GLYPHS[cat];
  if (art) register(mutedId(cat), renderMuted(`${cat}M`, tintFor(cat), art));
}
for (const [name, colour] of Object.entries(NFPA_BONNET)) {
  register(variantId('hydrant', name), renderIcon(`hyd${name}`, tintFor('hydrant'), hydrantWithBonnet(colour)));
}
for (const [name, art] of Object.entries(CONTROL_VARIANTS)) {
  register(variantId('control', name), renderIcon(`ctl${name}`, tintFor('control'), art));
  register(`${variantId('control', name)}-lo`, renderSimple(`ctl${name}L`, tintFor('control'), art));
}
for (const [name, art] of Object.entries(CAMERA_VARIANTS)) {
  register(variantId('camera', name), renderIcon(`cam${name}`, tintFor('camera'), art));
}

/**
 * Legacy shape, kept because callers and tests index it by category. Only the
 * base sprite per category — use OSM_ICON_SPECS for the full set.
 */
export const OSM_ICON_BY_CAT: Record<string, OsmIconSpec> = Object.fromEntries(
  Object.keys(GLYPHS).map((cat) => [cat, OSM_ICON_SPECS[baseId(cat)]]),
);

/** Registered base icon id for a category, or null when we have no icon. */
export function iconIdForCat(cat: string): string | null {
  return GLYPHS[cat] ? baseId(cat) : null;
}

/** Full-detail SVG string for a category — used by the map legend's icon key. */
export function iconSvgForCat(cat: string): string | null {
  return OSM_ICON_SPECS[baseId(cat)]?.svg ?? null;
}

/** The art for a category, exposed so the legend can label variants. */
export function glyphArtForCat(cat: string): GlyphArt | null {
  return GLYPHS[cat] ?? null;
}

// ============================================================
// Dynamic icon selection
// ============================================================

/**
 * Out-of-service test. Any of these tags means a unit arriving on scene cannot
 * use the feature, which is exactly the thing worth showing before dispatch
 * rather than after arrival.
 *
 * `access=private` is deliberately included alongside the hard-closed values:
 * for a gate or a parking structure, private access is an operational
 * obstacle, not a footnote.
 */
const MUTED_TEST: unknown[] = [
  'any',
  ['==', ['get', 'disused'], 'yes'],
  ['==', ['get', 'abandoned'], 'yes'],
  ['==', ['get', 'access'], 'private'],
  ['==', ['get', 'access'], 'no'],
  ['==', ['get', 'locked'], 'yes'],
  ['==', ['get', 'operational_status'], 'closed'],
];

/**
 * Hydrant NFPA 291 flow class from the OSM `colour` tag. Falls through to the
 * uncoloured hydrant when the tag is absent or unrecognised — a missing flow
 * class must read as "unknown", never as a fabricated one.
 */
function hydrantVariantExpr(): unknown[] {
  return [
    'match',
    ['downcase', ['to-string', ['coalesce', ['get', 'colour'], ['get', 'color'], '']]],
    'red', variantId('hydrant', 'red'),
    'orange', variantId('hydrant', 'orange'),
    'green', variantId('hydrant', 'green'),
    'blue', variantId('hydrant', 'blue'),
    baseId('hydrant'),
  ];
}

/** Signal head / STOP / yield, from the OSM `highway` tag. */
function controlVariantExpr(suffix = ''): unknown[] {
  return [
    'match',
    ['to-string', ['coalesce', ['get', 'highway'], '']],
    'stop', `${variantId('control', 'stop')}${suffix}`,
    'give_way', `${variantId('control', 'yield')}${suffix}`,
    `${baseId('control')}${suffix}`,
  ];
}

/** Dome housings are a different object and carry no meaningful bearing. */
function cameraVariantExpr(): unknown[] {
  return [
    'match',
    ['downcase', ['to-string', ['coalesce', ['get', 'camera:type'], '']]],
    'dome', variantId('camera', 'dome'),
    baseId('camera'),
  ];
}

/** The full-detail sprite selection for a category, before zoom tiering. */
function detailedExpr(cat: string): unknown {
  if (cat === 'hydrant') return hydrantVariantExpr();
  if (cat === 'control') return controlVariantExpr();
  if (cat === 'camera') return cameraVariantExpr();
  return baseId(cat);
}

/** The low-zoom sprite selection. Only `control` varies below the tier line. */
function simpleExpr(cat: string): unknown {
  if (cat === 'control') return controlVariantExpr('-lo');
  return lowZoomId(cat);
}

/**
 * `icon-image` for a category: zoom-tiered, then dynamic within the high tier.
 *
 * Zoom tiering only applies to the plain sprites. Below the tier line an icon
 * draws at roughly 16px, where an NFPA bonnet colour or a camera housing type
 * is not resolvable anyway — spending sprite registrations on variants nobody
 * can see would just slow every style.load down.
 */
export function iconImageExpression(cat: string, minzoom: number): unknown {
  if (!GLYPHS[cat]) return null;
  const detailed = MUTABLE_CATS.includes(cat)
    ? ['case', MUTED_TEST, mutedId(cat), detailedExpr(cat)]
    : detailedExpr(cat);
  return ['step', ['zoom'], simpleExpr(cat), minzoom + 2.5, detailed];
}

// ============================================================
// Placement priority
// ============================================================

/**
 * `symbol-sort-key`. LOWER places FIRST, and with icon-allow-overlap off, the
 * first symbol placed is the one that survives a collision.
 *
 * Ordered by what a responder needs when two features fight for the same
 * pixels. Previously every category shared the default, so at z15 a street
 * lamp could and did win placement over a fire hydrant.
 */
const SORT_KEY: Record<string, number> = {
  // Life safety — always wins.
  hydrant: 1, inlet: 2, emerg: 3, station: 4, water: 5, heli: 6,
  // Immediate hazards rank with life safety, not with their own group.
  hazard: 7, rail_x: 8,
  // Surveillance — ALPR before generic CCTV: plate readers are the canvass
  // object an officer is looking for on a vehicle stop.
  alpr: 9, camera: 10,
  // Traffic control affects the approach.
  control: 20, crossing: 21, calming: 22, ford: 23, junction: 24, access_pt: 25,
  // Access and passage.
  barrier: 30, control_pt: 31, rail_infra: 32, parking: 33, transit: 34, entrance: 35,
  // Sites.
  school: 40, gov: 41, financial: 42, regulated: 43, alcohol: 44, lodging: 45, social: 46,
  // Utility and terrain — context, yields to everything above.
  charging: 50, water_infra: 51, water_works: 52, comms: 53, gen: 54,
  cave: 60, mine: 61, spring: 62, lamp: 65, pole: 66,
};

/** Placement priority for a category. Unknown categories sort last. */
export function symbolSortKeyFor(cat: string): number {
  return SORT_KEY[cat] ?? 99;
}

// NOTE: on-map label text (posted speed, bridge clearance, exit number,
// parking/charging capacity, facility names) is NOT owned by this module. It
// lives in OSM_LABEL_RULES / buildOsmLabelSpec in useVectorTileLayers.ts,
// which handles km/h -> mph conversion and fails closed on unparseable values
// like "walk" or "40;60". Adding a second text layer here would double-draw
// every label.

// ============================================================
// Registration
// ============================================================

/**
 * Rasterised bitmaps, cached across maps and across style reloads.
 *
 * This cache is what makes the sprite count affordable. setStyle() wipes
 * registered images but not this module, so a basemap switch re-adds ~100
 * already-decoded bitmaps instead of re-running ~100 SVG decodes through
 * canvas. Without it, every basemap switch stalled on image decoding.
 */
const rasterCache = new Map<string, ImageData>();

/**
 * Register every icon with the map. Idempotent — safe to call on each
 * style.load, which is required because setStyle() wipes registered images.
 * Resolves once all images are present; a symbol layer added before its image
 * exists renders nothing.
 */
export async function ensureOsmIcons(map: mapboxgl.Map): Promise<string[]> {
  const registered: string[] = [];
  await Promise.all(Object.values(OSM_ICON_SPECS).map(async (spec) => {
    try {
      if (map.hasImage(spec.id)) { registered.push(spec.id); return; }
      let img = rasterCache.get(spec.id);
      if (!img) {
        img = await rasterise(spec.svg, spec.size);
        rasterCache.set(spec.id, img);
      }
      // Re-check after the await: a concurrent call may have won the race, and
      // addImage throws on a duplicate id rather than replacing it.
      if (map.hasImage(spec.id)) { registered.push(spec.id); return; }
      map.addImage(spec.id, img, { pixelRatio: RASTER_SCALE });
      registered.push(spec.id);
    } catch {
      // A single icon failing must not block the rest; that category falls
      // back to a circle rather than the whole set rendering nothing.
    }
  }));
  return registered;
}

/** SVG string -> ImageData at RASTER_SCALE, for map.addImage. */
async function rasterise(svg: string, size: number): Promise<ImageData> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const bitmap = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('svg decode failed'));
    im.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = size * RASTER_SCALE;
  canvas.height = size * RASTER_SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0, size * RASTER_SCALE, size * RASTER_SCALE);
  return ctx.getImageData(0, 0, size * RASTER_SCALE, size * RASTER_SCALE);
}
