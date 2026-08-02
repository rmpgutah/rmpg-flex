// ============================================================
// RMPG Flex — Icons for OSM overlay categories
// ============================================================
// Every OSM point category rendered as an identical coloured circle, so a fire
// hydrant, a surveillance camera and a power pole were indistinguishable on
// scene. This module gives each category its own silhouette.
//
// Two hard rules, both learned the hard way:
//
// 1. NEVER reference a bare `icon-image` name from the basemap sprite. If the
//    sprite lacks that name Mapbox renders NOTHING — no error, no warning, no
//    console line. Every icon here is registered by us via map.addImage first.
// 2. Categories must differ by SHAPE, not colour alone. Colour-only coding
//    fails colour-blind operators and washes out on a dark basemap at night.
//    A test enforces this by stripping colour attributes and requiring the
//    remaining geometry to still be unique.
//
// map.setStyle() (basemap switch) wipes registered images, so ensureOsmIcons
// is idempotent and is re-run on every style.load.
// ============================================================

import type mapboxgl from 'mapbox-gl';

/** Palette derived from theme-palettes.css. Literal hex is required here —
 *  Mapbox cannot resolve var(), and the `rgb(r g b)` form blanks the map.
 *  Severity hues keep their CAD meaning: red = hazard, amber = caution. */
const C = {
  critical: '#ef4444',
  warn: '#f59e0b',
  ok: '#22c55e',
  info: '#60a5fa',
  special: '#a78bfa',
  orange: '#f97316',
  silver: '#c3ccd6',
  gold: '#d9bd72',
  slate: '#8a97a6',
} as const;

export interface OsmIconSpec {
  id: string;
  svg: string;
  size: number;
}

const VB = 'viewBox="0 0 24 24"';
/** Every icon shares a dark disc so it reads against both land and water. */
const disc = (c: string) => `<circle cx="12" cy="12" r="11" fill="#0a1422" stroke="${c}" stroke-width="1.5"/>`;
const wrap = (c: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${VB} width="24" height="24">${disc(c)}${body}</svg>`;

/** cat -> icon. Shapes are deliberately dissimilar, not colour variants. */
export const OSM_ICON_BY_CAT: Record<string, OsmIconSpec> = {
  // ── Fire & life safety ──
  hydrant: { id: 'osm-hydrant', size: 24, svg: wrap(C.critical,
    `<rect x="10.5" y="8" width="3" height="9" fill="${C.critical}"/><rect x="7" y="10" width="10" height="3" rx="1" fill="${C.critical}"/><rect x="9" y="6" width="6" height="2.5" rx="1.2" fill="${C.critical}"/>`) },
  inlet: { id: 'osm-inlet', size: 24, svg: wrap(C.critical,
    `<circle cx="9.5" cy="12" r="2.6" fill="none" stroke="${C.critical}" stroke-width="1.6"/><circle cx="15" cy="12" r="2.6" fill="none" stroke="${C.critical}" stroke-width="1.6"/><rect x="8" y="16.5" width="8.5" height="1.8" fill="${C.critical}"/>`) },
  water: { id: 'osm-water', size: 24, svg: wrap(C.info,
    `<path d="M12 5 L16.5 12.5 A5 5 0 1 1 7.5 12.5 Z" fill="${C.info}"/>`) },
  emerg: { id: 'osm-emerg', size: 24, svg: wrap(C.ok,
    `<path d="M12 6 L13.6 11 L18.5 11 L14.6 14 L16 19 L12 16 L8 19 L9.4 14 L5.5 11 L10.4 11 Z" fill="${C.ok}"/>`) },
  heli: { id: 'osm-heli', size: 24, svg: wrap(C.info,
    `<circle cx="12" cy="12" r="6.5" fill="none" stroke="${C.info}" stroke-width="1.5"/><path d="M9.5 8.5 v7 M14.5 8.5 v7 M9.5 12 h5" stroke="${C.info}" stroke-width="1.8" fill="none"/>`) },
  station: { id: 'osm-station', size: 24, svg: wrap(C.ok,
    `<path d="M6 17 v-6 l6-4 6 4 v6 z" fill="none" stroke="${C.ok}" stroke-width="1.6"/><path d="M12 10.5 v4 M10 12.5 h4" stroke="${C.ok}" stroke-width="1.6"/>`) },

  // ── Surveillance ──
  camera: { id: 'osm-camera', size: 24, svg: wrap(C.special,
    `<rect x="5.5" y="9.5" width="9" height="5.5" rx="1" fill="${C.special}"/><path d="M14.5 11 L19 9 v6.5 l-4.5 -2 z" fill="${C.special}"/>`) },
  alpr: { id: 'osm-alpr', size: 24, svg: wrap(C.ok,
    `<rect x="4.5" y="9" width="10" height="6.5" rx="1" fill="none" stroke="${C.ok}" stroke-width="1.6"/><path d="M6.5 12.2 h6" stroke="${C.ok}" stroke-width="1.5"/><path d="M14.5 10.5 L19 8.5 v7 l-4.5 -2 z" fill="${C.ok}"/>`) },

  // ── Traffic ──
  control: { id: 'osm-control', size: 24, svg: wrap(C.warn,
    `<path d="M9.4 6.5 h5.2 L18 9.9 v5.2 L14.6 18.5 H9.4 L6 15.1 V9.9 Z" fill="${C.warn}"/>`) },
  calming: { id: 'osm-calming', size: 24, svg: wrap(C.warn,
    `<path d="M5.5 15 q3.2 -5 6.5 0 q3.2 -5 6.5 0" fill="none" stroke="${C.warn}" stroke-width="2"/>`) },
  crossing: { id: 'osm-crossing', size: 24, svg: wrap(C.info,
    `<rect x="6.5" y="7.5" width="2.2" height="9" fill="${C.info}"/><rect x="10.9" y="7.5" width="2.2" height="9" fill="${C.info}"/><rect x="15.3" y="7.5" width="2.2" height="9" fill="${C.info}"/>`) },
  junction: { id: 'osm-junction', size: 24, svg: wrap(C.gold,
    `<path d="M12 5.5 L18 8 v5 q0 4 -6 5.5 Q6 17 6 13 V8 Z" fill="none" stroke="${C.gold}" stroke-width="1.8"/>`) },
  access_pt: { id: 'osm-access-pt', size: 24, svg: wrap(C.slate,
    `<circle cx="12" cy="12" r="5.5" fill="none" stroke="${C.slate}" stroke-width="1.6"/><path d="M12 8.5 v7" stroke="${C.slate}" stroke-width="1.8"/>`) },

  // ── Access & passage ──
  barrier: { id: 'osm-barrier', size: 24, svg: wrap(C.orange,
    `<rect x="5" y="9" width="14" height="2.2" fill="${C.orange}"/><rect x="5" y="13" width="14" height="2.2" fill="${C.orange}"/><rect x="5.5" y="6.5" width="2" height="11" fill="${C.orange}"/>`) },
  control_pt: { id: 'osm-control-pt', size: 24, svg: wrap(C.orange,
    `<rect x="7" y="8" width="10" height="8" fill="none" stroke="${C.orange}" stroke-width="1.6"/><path d="M12 8 v8" stroke="${C.orange}" stroke-width="1.6"/>`) },
  rail_x: { id: 'osm-rail-x', size: 24, svg: wrap(C.warn,
    `<path d="M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5" stroke="${C.warn}" stroke-width="2.2"/>`) },
  rail_infra: { id: 'osm-rail-infra', size: 24, svg: wrap(C.slate,
    `<path d="M8.5 6 v12 M15.5 6 v12" stroke="${C.slate}" stroke-width="1.6"/><path d="M6.5 9 h11 M6.5 12.5 h11 M6.5 16 h11" stroke="${C.slate}" stroke-width="1.3"/>`) },
  parking: { id: 'osm-parking', size: 24, svg: wrap(C.info,
    `<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="none" stroke="${C.info}" stroke-width="1.6"/><path d="M10 15.5 V8.5 h2.8 a2.3 2.3 0 0 1 0 4.6 H10" fill="none" stroke="${C.info}" stroke-width="1.7"/>`) },
  transit: { id: 'osm-transit', size: 24, svg: wrap(C.info,
    `<rect x="7.5" y="6.5" width="9" height="9" rx="1.6" fill="none" stroke="${C.info}" stroke-width="1.6"/><path d="M9.5 17.5 l1.5 -2 M14.5 17.5 l-1.5 -2" stroke="${C.info}" stroke-width="1.5"/>`) },
  lamp: { id: 'osm-lamp', size: 24, svg: wrap(C.silver,
    `<rect x="11.2" y="11" width="1.6" height="7" fill="${C.silver}"/><path d="M8 10.5 q4 -5 8 0 z" fill="${C.silver}"/>`) },
  entrance: { id: 'osm-entrance', size: 24, svg: wrap(C.slate,
    `<rect x="8" y="6.5" width="8" height="11" fill="none" stroke="${C.slate}" stroke-width="1.6"/><circle cx="14" cy="12" r="1" fill="${C.slate}"/>`) },

  // ── Utility ──
  pole: { id: 'osm-pole', size: 24, svg: wrap(C.silver,
    `<rect x="11.3" y="6" width="1.5" height="12" fill="${C.silver}"/><path d="M7.5 8.5 h9" stroke="${C.silver}" stroke-width="1.5"/>`) },
  power: { id: 'osm-power', size: 24, svg: wrap(C.silver,
    `<path d="M8 18 L12 6 L16 18" fill="none" stroke="${C.silver}" stroke-width="1.6"/><path d="M9.3 13.5 h5.4 M8.6 16 h6.8" stroke="${C.silver}" stroke-width="1.3"/>`) },
  comms: { id: 'osm-comms', size: 24, svg: wrap(C.silver,
    `<path d="M12 9 v9" stroke="${C.silver}" stroke-width="1.6"/><path d="M8.5 8 a5 5 0 0 1 7 0" fill="none" stroke="${C.silver}" stroke-width="1.4"/><path d="M6.5 6 a8 8 0 0 1 11 0" fill="none" stroke="${C.silver}" stroke-width="1.2"/>`) },
  gen: { id: 'osm-gen', size: 24, svg: wrap(C.ok,
    `<circle cx="12" cy="12" r="2" fill="${C.ok}"/><path d="M12 10 V5.5 M13.7 13 L17.6 15.3 M10.3 13 L6.4 15.3" stroke="${C.ok}" stroke-width="1.6"/>`) },
  water_infra: { id: 'osm-water-infra', size: 24, svg: wrap(C.info,
    `<rect x="7.5" y="6.5" width="9" height="6" rx="1" fill="none" stroke="${C.info}" stroke-width="1.6"/><path d="M10 12.5 v5 M14 12.5 v5" stroke="${C.info}" stroke-width="1.5"/>`) },
  water_works: { id: 'osm-water-works', size: 24, svg: wrap(C.info,
    `<circle cx="12" cy="12" r="4.5" fill="none" stroke="${C.info}" stroke-width="1.6"/><path d="M12 7.5 v9 M7.5 12 h9" stroke="${C.info}" stroke-width="1.4"/>`) },
  charging: { id: 'osm-charging', size: 24, svg: wrap(C.ok,
    `<path d="M12.8 5.5 L8.5 13 h3 l-0.8 5.5 L16 11 h-3.2 z" fill="${C.ok}"/>`) },

  // ── Sites ──
  school: { id: 'osm-school', size: 24, svg: wrap(C.special,
    `<path d="M5.5 11 L12 7.5 L18.5 11 L12 14.5 Z" fill="${C.special}"/><path d="M16.5 12.2 v4" stroke="${C.special}" stroke-width="1.4"/>`) },
  financial: { id: 'osm-financial', size: 24, svg: wrap(C.gold,
    `<path d="M6 10.5 L12 6.5 L18 10.5 Z" fill="none" stroke="${C.gold}" stroke-width="1.5"/><path d="M8 11.5 v5 M12 11.5 v5 M16 11.5 v5 M6.5 17.5 h11" stroke="${C.gold}" stroke-width="1.4"/>`) },
  regulated: { id: 'osm-regulated', size: 24, svg: wrap(C.orange,
    `<circle cx="12" cy="12" r="5.5" fill="none" stroke="${C.orange}" stroke-width="1.8"/><path d="M8.5 15.5 L15.5 8.5" stroke="${C.orange}" stroke-width="1.8"/>`) },
  alcohol: { id: 'osm-alcohol', size: 24, svg: wrap(C.special,
    `<path d="M9 6.5 h6 l-2.2 5.5 v4 h1.7 v1.5 h-4.9 v-1.5 h1.7 v-4 z" fill="${C.special}"/>`) },
  gov: { id: 'osm-gov', size: 24, svg: wrap(C.silver,
    `<rect x="7" y="10" width="10" height="7" fill="none" stroke="${C.silver}" stroke-width="1.5"/><path d="M12 6 l5 4 h-10 z" fill="${C.silver}"/>`) },
  lodging: { id: 'osm-lodging', size: 24, svg: wrap(C.slate,
    `<path d="M6 16.5 v-6 M6 13 h8 a3 3 0 0 1 3 3 v0.5 M18 16.5 v-1.5" fill="none" stroke="${C.slate}" stroke-width="1.7"/><circle cx="9.5" cy="10.5" r="1.6" fill="${C.slate}"/>`) },
  social: { id: 'osm-social', size: 24, svg: wrap(C.info,
    `<circle cx="9.5" cy="10" r="2" fill="${C.info}"/><circle cx="14.5" cy="10" r="2" fill="${C.info}"/><path d="M6 17 q3 -3.5 6 0 q3 -3.5 6 0" fill="none" stroke="${C.info}" stroke-width="1.5"/>`) },

  // ── Terrain ──
  hazard: { id: 'osm-hazard', size: 24, svg: wrap(C.critical,
    `<path d="M12 6 L18.5 17.5 H5.5 Z" fill="none" stroke="${C.critical}" stroke-width="1.8"/><path d="M12 10 v3.5" stroke="${C.critical}" stroke-width="1.8"/><circle cx="12" cy="15.5" r="0.9" fill="${C.critical}"/>`) },
  cave: { id: 'osm-cave', size: 24, svg: wrap(C.slate,
    `<path d="M6 17.5 q0 -8 6 -8 q6 0 6 8 z" fill="none" stroke="${C.slate}" stroke-width="1.6"/><path d="M10 17.5 q0 -3.5 2 -3.5 q2 0 2 3.5" fill="${C.slate}"/>`) },
  mine: { id: 'osm-mine', size: 24, svg: wrap(C.orange,
    `<path d="M6.5 8.5 L17.5 15.5 M17.5 8.5 L6.5 15.5" stroke="${C.orange}" stroke-width="1.6"/><rect x="9.5" y="16" width="5" height="2" fill="${C.orange}"/>`) },
  spring: { id: 'osm-spring', size: 24, svg: wrap(C.info,
    `<circle cx="12" cy="15" r="2.2" fill="${C.info}"/><path d="M12 12.5 V6.5 M9.5 9 q2.5 -2 5 0" fill="none" stroke="${C.info}" stroke-width="1.5"/>`) },
  ford: { id: 'osm-ford', size: 24, svg: wrap(C.warn,
    `<path d="M5 9.5 h14" stroke="${C.warn}" stroke-width="1.8"/><path d="M5 13 q2.3 -2 4.6 0 q2.3 2 4.6 0 q2.3 -2 4.6 0" fill="none" stroke="${C.info}" stroke-width="1.6"/><path d="M5 16.5 h14" stroke="${C.warn}" stroke-width="1.8"/>`) },
};

/** Registered icon id for a category, or null when we have no icon for it. */
export function iconIdForCat(cat: string): string | null {
  return OSM_ICON_BY_CAT[cat]?.id ?? null;
}

/**
 * Register every icon with the map. Idempotent — safe to call on each
 * style.load, which is required because setStyle() wipes registered images.
 * Resolves once all images are present; a symbol layer added before its image
 * exists renders nothing.
 */
export async function ensureOsmIcons(map: mapboxgl.Map): Promise<string[]> {
  const registered: string[] = [];
  await Promise.all(Object.values(OSM_ICON_BY_CAT).map(async (spec) => {
    try {
      if (map.hasImage(spec.id)) { registered.push(spec.id); return; }
      const img = await rasterise(spec.svg, spec.size);
      if (map.hasImage(spec.id)) { registered.push(spec.id); return; }
      map.addImage(spec.id, img, { pixelRatio: 2 });
      registered.push(spec.id);
    } catch {
      // A single icon failing must not block the rest; the layer falls back to
      // a circle rather than rendering nothing.
    }
  }));
  return registered;
}

/** SVG string -> ImageData at 2x, for map.addImage. */
async function rasterise(svg: string, size: number): Promise<ImageData> {
  const scale = 2;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const bitmap = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('svg decode failed'));
    im.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = size * scale;
  canvas.height = size * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0, size * scale, size * scale);
  return ctx.getImageData(0, 0, size * scale, size * scale);
}
