// ============================================================
// RMPG Flex — OSM overlay icon artwork
// ============================================================
// The drawings only. Registration, sprite ids and Mapbox expressions live in
// osmIcons.ts; this module is pure strings so the whole set can be rendered
// and eyeballed in a test or a scratch page without a live map.
//
// Visual language, fixed 2026-08-02:
//
//   * LINE ART. Glyphs are stroked, never filled. Two weights — a 3.1 outer
//     contour and 1.9 interior detail. Uniform-weight line work reads as clip
//     art; varying it by depth is what makes a drawing look drawn.
//   * ONE INK. Every glyph is a single near-white. The plate rim carries the
//     category's group. Colour appears ONLY in SEMANTIC_COLOUR below, where
//     the colour is itself the information a responder reads off the real
//     object — signal lenses, a STOP octagon, an NFPA hydrant bonnet.
//   * SEPARATION HALO. Each stroke is drawn twice: once in the plate's own
//     near-black at a wider weight, then the ink on top. A Mapbox symbol
//     composites straight onto vector tiles with no backdrop and no blend
//     isolation, so contrast against an unknown tile colour has to be baked
//     into the bitmap. There is no CSS shadow available to us here.
//   * 64px DESIGN BOX. Rasterised at 3x. Icons draw as small as ~16px on
//     screen at a category's minzoom, which is why the ink is as heavy as it
//     is — a stroke thinner than one device pixel aliases into dashed grey.
//
// Hex literals are correct and required in this file. These strings are
// rasterised to ImageData for map.addImage; a var() never resolves there and
// the icon decodes to a transparent bitmap — a silently blank symbol layer.
// hexClassifier.ts excludes this module for exactly that reason.
// ============================================================

/** The single ink. Everything is this colour unless it is in SEMANTIC_COLOUR. */
export const INK = '#eef3f9';
/** Backing colour for the separation halo — matches the plate core. */
export const HALO = '#06111d';
/** Out-of-service ink. Desaturated and dimmed, never a different hue. */
export const INK_MUTED = '#6b7886';

/**
 * Group tint, applied to the plate rim and a faint wash behind the glyph.
 * These are the CAD operational hues and keep their existing meanings; the
 * rim is the ONLY place a group colour appears, so the glyph itself stays
 * readable for colour-blind operators.
 */
export const GROUP_TINT: Record<string, string> = {
  safety: '#ef4444',
  surveillance: '#a78bfa',
  traffic: '#f59e0b',
  utility: '#c3ccd6',
  sites: '#d9bd72',
  access: '#f97316',
  drivability: '#22c55e',
  terrain: '#8a97a6',
};

/**
 * One drawing.
 *
 * `main` is the outer contour — the silhouette that identifies the object. It
 * is also the ENTIRE low-zoom variant, which is why it has to stand alone:
 * see renderSimple. `det` is interior detail that only earns its pixels above
 * roughly 24px. `over` is drawn last, unstroked by the shared passes, and is
 * where the semantic-colour allowlist puts its fills.
 */
export interface GlyphArt {
  main: string;
  det?: string;
  over?: string;
  /**
   * Set when `over` carries the identity rather than decorating it — a STOP
   * octagon, a yield triangle, a crossbuck. renderSimple normally drops `over`
   * along with `det`, which for those three would leave nothing but a bare
   * post. With this set it keeps `over`, so the low-zoom sprite is still the
   * object and not a stick.
   */
  overIsIdentity?: boolean;
}

const CAP = 'stroke-linecap="round" stroke-linejoin="round"';

/**
 * Plate: recessed dark badge, group-tinted rim, tinted wash, key-light arc.
 *
 * The wash matters at small sizes. Below ~18px the 1px rim starts dropping
 * out of the raster entirely, and the wash is what keeps the group readable
 * after that happens.
 */
function plate(u: string, tint: string): string {
  return `<defs>`
    + `<radialGradient id="${u}v" cx="0.36" cy="0.28" r="0.9">`
    + `<stop offset="0" stop-color="#1b3350"/><stop offset="0.62" stop-color="#0e1e30"/>`
    + `<stop offset="1" stop-color="#060d17"/></radialGradient>`
    + `<radialGradient id="${u}w" cx="0.5" cy="0.52" r="0.5">`
    + `<stop offset="0" stop-color="${tint}" stop-opacity="0.17"/>`
    + `<stop offset="0.68" stop-color="${tint}" stop-opacity="0.05"/>`
    + `<stop offset="1" stop-color="${tint}" stop-opacity="0"/></radialGradient>`
    + `</defs>`
    + `<circle cx="32" cy="32" r="29" fill="url(#${u}v)"/>`
    + `<circle cx="32" cy="32" r="29" fill="url(#${u}w)"/>`
    + `<circle cx="32" cy="32" r="29" fill="none" stroke="${tint}" stroke-width="2.7"/>`
    + `<circle cx="32" cy="32" r="29" fill="none" stroke="#000000" stroke-width="0.9" stroke-opacity="0.45"/>`
    + `<circle cx="32" cy="32" r="25.9" fill="none" stroke="${tint}" stroke-width="1" stroke-opacity="0.26"/>`
    + `<path d="M13.4 19.6 a29 29 0 0 1 24.4 -13.5" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-opacity="0.22" stroke-linecap="round"/>`;
}

/** Dashed rim, used only by the muted (out-of-service) variants. */
function plateMuted(u: string, tint: string): string {
  return `<defs>`
    + `<radialGradient id="${u}v" cx="0.36" cy="0.28" r="0.9">`
    + `<stop offset="0" stop-color="#152538"/><stop offset="0.62" stop-color="#0b1725"/>`
    + `<stop offset="1" stop-color="#050a12"/></radialGradient></defs>`
    + `<circle cx="32" cy="32" r="29" fill="url(#${u}v)"/>`
    + `<circle cx="32" cy="32" r="29" fill="none" stroke="${tint}" stroke-width="2.4"`
    + ` stroke-opacity="0.5" stroke-dasharray="4.2 3.4" stroke-linecap="round"/>`
    + `<circle cx="32" cy="32" r="29" fill="none" stroke="#000000" stroke-width="0.9" stroke-opacity="0.45"/>`;
}

/**
 * Full-detail icon.
 *
 * Two halo passes rather than one flat outline: the halo must be WIDER than
 * whichever ink stroke sits on top of it, or the thin 1.9 detail lines pick up
 * a visible dark fringe down one side where the 5.5 halo overshoots them.
 */
export function renderIcon(u: string, tint: string, art: GlyphArt, ink: string = INK): string {
  const det = art.det ?? '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`
    + plate(u, tint)
    + `<g fill="none" stroke="${HALO}" stroke-width="5.5" ${CAP} stroke-opacity="0.85">${art.main}</g>`
    + `<g fill="none" stroke="${HALO}" stroke-width="4.3" ${CAP} stroke-opacity="0.85">${det}</g>`
    + `<g fill="none" stroke="${ink}" stroke-width="3.1" ${CAP}>${art.main}</g>`
    + `<g fill="none" stroke="${ink}" stroke-width="1.9" ${CAP}>${det}</g>`
    + (art.over ?? '')
    + `</svg>`;
}

/**
 * Low-zoom variant: the contour alone, at a heavier weight.
 *
 * Deliberately derived rather than hand-drawn. `main` already IS the
 * identifying silhouette, so dropping `det` and thickening is both the
 * cheapest and the most faithful simplification — there is no second drawing
 * to drift out of sync with the first.
 */
export function renderSimple(u: string, tint: string, art: GlyphArt): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`
    + plate(u, tint)
    + `<g fill="none" stroke="${HALO}" stroke-width="6.4" ${CAP} stroke-opacity="0.85">${art.main}</g>`
    + `<g fill="none" stroke="${INK}" stroke-width="3.8" ${CAP}>${art.main}</g>`
    + (art.overIsIdentity ? (art.over ?? '') : '')
    + `</svg>`;
}

/**
 * Out-of-service variant: dimmed ink, dashed rim, no semantic-colour overlay.
 *
 * The overlay is dropped on purpose. A green NFPA bonnet or a lit green signal
 * lens asserts a live operational fact; painting it on a hydrant tagged
 * `disused=yes` would be worse than showing no colour at all.
 */
export function renderMuted(u: string, tint: string, art: GlyphArt): string {
  const det = art.det ?? '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`
    + plateMuted(u, tint)
    + `<g fill="none" stroke="${HALO}" stroke-width="5.0" ${CAP} stroke-opacity="0.7">${art.main}</g>`
    + `<g fill="none" stroke="${INK_MUTED}" stroke-width="2.8" ${CAP} stroke-opacity="0.9">${art.main}</g>`
    + `<g fill="none" stroke="${INK_MUTED}" stroke-width="1.7" ${CAP} stroke-opacity="0.75">${det}</g>`
    + `</svg>`;
}

// ============================================================
// The drawings — 39, one per point-rendered OSM category.
// ============================================================
//
// Silhouettes must differ from one another, not just their colours: with a
// single ink, shape is the ONLY channel left. Two pairs were near-duplicates
// in the previous set and were redrawn as different objects rather than
// recoloured — rail_x (crossbuck + flashers) against mine (A-frame headframe
// with a sheave wheel), and water_works (clarifiers in plan) against
// access_pt (a picnic shelter in elevation). Both were an X and a
// circle-plus-line respectively. A test enforces this.

export const GLYPHS: Record<string, GlyphArt> = {

  // ── Fire & life safety ──────────────────────────────────
  hydrant: {
    main: `<path d="M26.6 22.6 h10.8 v22.2 h-10.8 z"/><path d="M21.8 44.8 h20.4 v6.4 h-20.4 z"/>`,
    det: `<path d="M22.6 27.4 h18.8"/><path d="M26.6 31.6 h-6.6 v6.4 h6.6 M37.4 31.6 h6.6 v6.4 h-6.6"/>`
      + `<circle cx="32" cy="34.8" r="4.2"/>`
      + `<path d="M23.4 22.6 a8.6 7.8 0 0 1 17.2 0 z"/><path d="M22.6 19.6 h18.8"/>`
      + `<path d="M28.8 13.6 h6.4 l2.4 2.8 -2.4 2.8 h-6.4 l-2.4 -2.8 z"/>`,
  },
  water: {
    main: `<path d="M17.6 26.6 h28.8 v20.4 a4 4 0 0 1 -4 4 h-20.8 a4 4 0 0 1 -4 -4 z"/>`
      + `<path d="M15.4 26.6 h33.2"/>`,
    det: `<path d="M22.6 36.6 q4.7 -4 9.4 0 q4.7 4 9.4 0"/>`
      + `<path d="M22.6 43.0 q4.7 -4 9.4 0 q4.7 4 9.4 0"/>`
      + `<path d="M32 26.6 v-6.4"/><path d="M27.4 20.2 h9.2"/>`,
  },
  emerg: {
    main: `<path d="M32 13.4 v37.2"/><path d="M15.9 22.7 L48.1 41.3"/><path d="M48.1 22.7 L15.9 41.3"/>`,
    det: `<circle cx="32" cy="32" r="6.0"/><path d="M32 28.6 v6.8 M28.6 32 h6.8"/>`,
  },
  inlet: {
    main: `<path d="M18.6 24.6 h26.8 v20.8 h-26.8 z"/><path d="M18.6 45.4 v5.6 M45.4 45.4 v5.6"/>`,
    det: `<circle cx="26.4" cy="35.6" r="4.2"/><circle cx="37.6" cy="35.6" r="4.2"/>`
      + `<path d="M22.6 28.8 h18.8"/>`
      + `<path d="M26.4 24.6 v-6.0 M37.6 24.6 v-6.0"/><path d="M22.6 18.6 h18.8"/>`,
  },
  heli: {
    main: `<circle cx="32" cy="32" r="15.4"/>`,
    det: `<path d="M26.4 24.8 v14.4 M37.6 24.8 v14.4 M26.4 32 h11.2"/>`
      + `<circle cx="32" cy="32" r="20.4" stroke-dasharray="3.4 4.2"/>`,
  },
  station: {
    main: `<path d="M14.6 22.8 h34.8 v27.8 h-34.8 z"/>`
      + `<path d="M24.4 50.6 v-13.2 a7.6 7.6 0 0 1 15.2 0 v13.2"/>`,
    det: `<path d="M12.4 22.8 h39.2"/>`
      + `<path d="M18.6 28.6 h5.2 v5.2 h-5.2 z M40.2 28.6 h5.2 v5.2 h-5.2 z"/>`
      + `<path d="M32 22.8 v-8.6"/><path d="M28.4 14.2 h7.2"/>`,
  },

  // ── Surveillance ────────────────────────────────────────
  // Both camera glyphs point UP. icon-rotate treats 0 as north, so artwork
  // that points any other way makes every camera:direction bearing a lie —
  // the previous set pointed east, i.e. every camera was wrong by 90 degrees.
  camera: {
    main: `<path d="M22.6 24.2 a9.4 9.4 0 0 1 18.8 0 v14.4 h-18.8 z"/>`
      + `<path d="M32 38.6 v6.0"/><path d="M24.4 48.6 h15.2"/>`,
    det: `<path d="M20.6 21.4 h22.8"/>`
      + `<ellipse cx="32" cy="22.6" rx="5.4" ry="4.4"/><ellipse cx="32" cy="22.6" rx="2.2" ry="1.8"/>`
      + `<path d="M28.6 44.6 h6.8 v4.0 h-6.8 z"/><path d="M25.2 33.4 h13.6"/>`,
  },
  alpr: {
    main: `<path d="M21.6 20.4 h20.8 a2.4 2.4 0 0 1 2.4 2.4 v9.6 a2.4 2.4 0 0 1 -2.4 2.4 h-20.8`
      + ` a2.4 2.4 0 0 1 -2.4 -2.4 v-9.6 a2.4 2.4 0 0 1 2.4 -2.4 z"/>`
      + `<path d="M22.6 40.6 h18.8 v9.4 h-18.8 z"/>`,
    det: `<circle cx="32" cy="27.6" r="4.0"/><path d="M32 34.8 v5.8"/>`
      + `<path d="M26.4 44.4 h11.2"/><path d="M26.4 47.2 h11.2" stroke-dasharray="2.2 2.0"/>`,
  },

  // ── Traffic ─────────────────────────────────────────────
  // `control` is the signal head. Stop and yield are separate variants,
  // selected off the OSM highway tag — see CONTROL_VARIANTS.
  control: {
    main: `<path d="M22.6 10.8 h18.8 a2.7 2.7 0 0 1 2.7 2.7 v29.2 a2.7 2.7 0 0 1 -2.7 2.7 h-18.8`
      + ` a2.7 2.7 0 0 1 -2.7 -2.7 v-29.2 a2.7 2.7 0 0 1 2.7 -2.7 z"/>`
      + `<path d="M32 45.4 v7.0"/>`,
    det: `<path d="M26.6 52.4 h10.8"/><path d="M24.4 23.6 h15.2 M24.4 32.4 h15.2"/>`,
    over: `<circle cx="32" cy="19.2" r="4.0" fill="#ef4444" opacity="0.4"/>`
      + `<circle cx="32" cy="28.0" r="4.0" fill="#f59e0b" opacity="0.4"/>`
      + `<circle cx="32" cy="36.8" r="8.2" fill="#22c55e" opacity="0.17"/>`
      + `<circle cx="32" cy="36.8" r="4.0" fill="#22c55e"/>`
      + `<circle cx="30.8" cy="35.6" r="1.3" fill="#dcffe8" opacity="0.9"/>`,
  },
  calming: {
    main: `<path d="M11.6 42.6 h9.4 q11 -15.2 22 0 h9.4"/>`,
    det: `<path d="M13.6 49.6 h36.8"/><path d="M26.4 33.4 l5.6 -5.6 5.6 5.6"/><path d="M32 27.8 v-6.2"/>`,
  },
  crossing: {
    main: `<path d="M15.6 50.6 h32.8"/>`
      + `<path d="M19.4 50.6 v-9.4 M26.0 50.6 v-9.4 M32.6 50.6 v-9.4 M39.2 50.6 v-9.4 M45.8 50.6 v-9.4"/>`,
    det: `<circle cx="32" cy="15.4" r="3.4"/>`
      + `<path d="M32 18.8 v8.6"/><path d="M27.0 22.4 h10.0"/>`
      + `<path d="M32 27.4 l-3.6 6.4 M32 27.4 l3.6 6.4"/>`,
  },
  // Interior is left deliberately empty — text-field prints the real exit
  // number over it, which is the entire reason this category exists.
  junction: {
    main: `<path d="M13.6 15.6 h36.8 v18.6 h-36.8 z"/><path d="M32 34.2 v17.2"/>`,
    det: `<path d="M26.4 52.0 h11.2"/><path d="M38.8 20.6 l5.0 4.4 -5.0 4.4"/>`,
  },
  access_pt: {
    main: `<path d="M11.6 26.4 L32 14.6 L52.4 26.4"/><path d="M17.4 26.4 v24.2 M46.6 26.4 v24.2"/>`,
    det: `<path d="M22.6 40.8 h18.8"/><path d="M24.6 34.6 h14.8"/>`
      + `<path d="M25.4 34.6 l-2.8 10.0 M38.6 34.6 l2.8 10.0"/>`,
  },

  // ── Utility ─────────────────────────────────────────────
  pole: {
    main: `<path d="M32 12.6 v38.8"/><path d="M15.6 21.6 h32.8"/>`,
    det: `<path d="M22.6 26.8 h18.8"/>`
      + `<path d="M18.6 18.6 v3.0 M32 18.6 v3.0 M45.4 18.6 v3.0"/>`
      + `<path d="M25.4 23.8 v3.0 M38.6 23.8 v3.0"/><path d="M26.4 51.4 h11.2"/>`,
  },
  gen: {
    main: `<path d="M14.6 34.6 h34.8 v16.0 h-34.8 z"/>`
      + `<path d="M22.6 34.6 v-14.0 h6.4 v14.0"/><path d="M35.0 34.6 v-19.2 h6.4 v19.2"/>`,
    det: `<path d="M22.6 16.8 q3.2 -4.0 6.4 0"/><path d="M35.0 11.6 q3.2 -4.0 6.4 0"/>`
      + `<path d="M19.6 41.8 h24.8"/>`,
  },
  comms: {
    main: `<path d="M26.4 51.4 L32 22.6 L37.6 51.4"/><path d="M22.6 51.4 h18.8"/>`,
    det: `<path d="M28.6 38.6 h6.8 M27.0 45.0 h10.0"/><circle cx="32" cy="19.4" r="2.4"/>`
      + `<path d="M24.6 15.2 a10.4 10.4 0 0 1 14.8 0"/><path d="M19.6 10.4 a17.4 17.4 0 0 1 24.8 0"/>`,
  },
  water_infra: {
    main: `<path d="M18.8 18.8 l3.4 8.0 a11.2 11.2 0 0 0 19.6 0 l3.4 -8.0"/><path d="M15.8 18.8 h32.4"/>`,
    det: `<path d="M23.4 34.8 L20.6 51.2 M40.6 34.8 L43.4 51.2 M32 37.6 v13.6"/>`
      + `<path d="M22.4 42.6 h19.2"/><path d="M25.6 27.4 q6.4 3.4 12.8 0"/><path d="M32 18.8 v-5.4"/>`,
  },
  water_works: {
    main: `<circle cx="23.4" cy="32.6" r="9.6"/><circle cx="43.0" cy="38.8" r="7.0"/>`,
    det: `<circle cx="23.4" cy="32.6" r="4.0"/><path d="M23.4 23.0 v19.2 M13.8 32.6 h19.2"/>`
      + `<path d="M33.0 34.6 h4.6"/><path d="M43.0 31.8 v-14.0 h-16.0"/>`,
  },
  charging: {
    main: `<path d="M21.6 16.6 h16.8 v34.0 h-16.8 z"/><path d="M18.6 51.4 h22.8"/>`,
    det: `<path d="M24.6 22.6 h10.8 v7.2 h-10.8 z"/>`
      + `<path d="M38.4 24.6 h5.4 v14.0 a3.4 3.4 0 0 0 3.4 3.4"/>`,
    over: `<path d="M32.6 33.0 L26.4 43.0 h4.8 l-1.2 6.6 6.4 -10.0 h-4.6 z"`
      + ` fill="#22c55e" stroke="#06111d" stroke-width="2.4" stroke-linejoin="round"/>`
      + `<path d="M32.6 33.0 L26.4 43.0 h4.8 l-1.2 6.6 6.4 -10.0 h-4.6 z" fill="#22c55e"/>`,
  },

  // ── Sites ───────────────────────────────────────────────
  school: {
    main: `<path d="M11.8 26.8 L32 15.6 L52.2 26.8"/><path d="M15.6 28.6 v22.0 h32.8 v-22.0"/>`,
    det: `<path d="M27.6 50.6 v-11.2 h8.8 v11.2"/>`
      + `<path d="M19.8 32.8 h5.4 v5.0 h-5.4 z"/><path d="M38.8 32.8 h5.4 v5.0 h-5.4 z"/>`
      + `<path d="M32 15.6 v-6.4"/><path d="M32 9.4 h7.8 l-2.2 2.5 2.2 2.5 h-7.8"/>`
      + `<path d="M12.6 50.8 h38.8"/>`,
  },
  financial: {
    main: `<path d="M11.6 24.8 L32 14.6 L52.4 24.8"/><path d="M13.6 47.4 h36.8 v4.0 h-36.8 z"/>`,
    det: `<path d="M15.6 26.8 h32.8"/>`
      + `<path d="M20.4 28.8 v18.4 M27.4 28.8 v18.4 M36.6 28.8 v18.4 M43.6 28.8 v18.4"/>`,
  },
  regulated: {
    main: `<path d="M14.6 26.8 h34.8 v23.8 h-34.8 z"/><path d="M12.6 26.8 l4.0 -8.0 h30.8 l4.0 8.0 z"/>`,
    det: `<path d="M20.6 32.8 h10.4 v10.0 h-10.4 z"/><path d="M37.4 32.8 h7.0 v17.8 h-7.0 z"/>`
      + `<path d="M22.6 22.8 h18.8" stroke-dasharray="3.0 3.0"/>`,
  },
  alcohol: {
    main: `<path d="M22.6 22.6 v-6.0 h5.6 v6.0 l2.4 4.4 v24.0 h-10.4 v-24.0 z"/>`
      + `<path d="M36.4 26.8 h11.0 l-1.6 9.2 a3.9 3.9 0 0 1 -7.8 0 z"/>`,
    det: `<path d="M20.2 36.8 h10.4"/><path d="M41.9 39.8 v8.0"/><path d="M38.1 51.4 h7.6"/>`,
  },
  gov: {
    main: `<path d="M13.6 47.4 h36.8 v4.0 h-36.8 z"/><path d="M20.6 30.8 a11.4 11.4 0 0 1 22.8 0"/>`
      + `<path d="M15.6 34.6 h32.8"/>`,
    det: `<path d="M19.6 36.8 v10.6 M26.6 36.8 v10.6 M37.4 36.8 v10.6 M44.4 36.8 v10.6"/>`
      + `<path d="M32 19.4 v-5.6"/><circle cx="32" cy="21.6" r="2.0"/>`,
  },
  lodging: {
    main: `<path d="M13.6 34.6 v16.0"/>`
      + `<path d="M13.6 40.6 h26.4 a10.4 10.4 0 0 1 10.4 10.0"/>`,
    det: `<circle cx="21.4" cy="34.8" r="4.0"/><path d="M11.6 51.4 h40.8"/>`
      + `<path d="M13.6 26.6 L32 16.6 L50.4 26.6"/>`,
  },
  social: {
    main: `<path d="M32 47.4 c-9.6 -6.4 -14.4 -12.0 -14.4 -17.6 a7.6 7.6 0 0 1 14.4 -3.4`
      + ` a7.6 7.6 0 0 1 14.4 3.4 c0 5.6 -4.8 11.2 -14.4 17.6 z"/>`,
    det: `<path d="M14.6 51.0 q17.4 5.6 34.8 0"/>`,
  },
  entrance: {
    main: `<path d="M20.6 14.6 h22.8 v36.8 h-22.8 z"/>`,
    det: `<path d="M25.4 20.6 h13.2 v25.6 h-13.2 z"/><circle cx="35.4" cy="34.6" r="1.6"/>`
      + `<path d="M14.6 51.4 h34.8"/><path d="M25.4 46.2 a13.2 13.2 0 0 0 -10.8 5.2"/>`,
  },

  // ── Access & passage ────────────────────────────────────
  barrier: {
    main: `<path d="M14.6 16.8 v32.0"/><path d="M14.6 21.8 h34.8 v14.4 h-34.8"/>`
      + `<path d="M49.4 40.6 v8.2"/>`,
    det: `<path d="M14.6 21.8 L49.4 36.2 M49.4 21.8 L14.6 36.2"/>`
      + `<path d="M9.8 48.8 h9.6 M45.0 48.8 h9.6"/>`,
  },
  control_pt: {
    main: `<path d="M14.6 24.6 h16.0 v26.0 h-16.0 z"/><path d="M34.6 30.6 h16.8"/>`,
    det: `<path d="M12.6 24.6 h20.0"/><path d="M18.6 29.8 h8.0 v7.0 h-8.0 z"/>`
      + `<path d="M33.0 27.6 v9.6"/><path d="M36.6 30.6 v3.0 M41.4 30.6 v3.0 M46.2 30.6 v3.0"/>`
      + `<path d="M12.6 51.4 h38.8"/>`,
  },
  rail_x: {
    main: `<path d="M32 41.0 v11.6"/>`,
    det: `<path d="M26.4 52.6 h11.2"/><path d="M14.8 38.6 h-3.2 M49.2 38.6 h3.2"/>`,
    over: `<g stroke="#06111d" stroke-width="6.0" stroke-linecap="round" fill="none">`
      + `<path d="M20.6 12.6 L43.4 32.0"/><path d="M43.4 12.6 L20.6 32.0"/></g>`
      + `<g stroke="#f5f7fa" stroke-width="3.4" stroke-linecap="round" fill="none">`
      + `<path d="M20.6 12.6 L43.4 32.0"/><path d="M43.4 12.6 L20.6 32.0"/></g>`
      + `<circle cx="18.4" cy="38.6" r="5.4" fill="#ef4444" opacity="0.2"/>`
      + `<circle cx="18.4" cy="38.6" r="3.5" fill="#ef4444" stroke="#06111d" stroke-width="1.2"/>`
      + `<circle cx="45.6" cy="38.6" r="3.5" fill="#6d1717" stroke="#06111d" stroke-width="1.2"/>`,
    overIsIdentity: true,
  },
  rail_infra: {
    main: `<path d="M18.6 12.6 v38.8 M30.6 12.6 v38.8"/><path d="M42.6 24.6 h8.4 v10.0 h-8.4 z"/>`,
    det: `<path d="M15.6 19.6 h18.0 M15.6 27.6 h18.0 M15.6 35.6 h18.0 M15.6 43.6 h18.0"/>`
      + `<path d="M46.8 34.6 v16.8"/><circle cx="46.8" cy="29.6" r="2.2"/>`
      + `<path d="M42.2 51.4 h9.2"/>`,
  },
  parking: {
    main: `<path d="M17.6 13.8 h28.8 v28.8 h-28.8 z"/><path d="M32 42.6 v9.8"/>`,
    det: `<path d="M26.8 36.2 v-16.0 h7.2 a5.1 5.1 0 0 1 0 10.2 h-7.2"/><path d="M26.4 52.4 h11.2"/>`,
  },
  transit: {
    main: `<path d="M17.6 14.6 h28.8 a3.0 3.0 0 0 1 3.0 3.0 v25.8 a3.0 3.0 0 0 1 -3.0 3.0 h-28.8`
      + ` a3.0 3.0 0 0 1 -3.0 -3.0 v-25.8 a3.0 3.0 0 0 1 3.0 -3.0 z"/>`,
    det: `<path d="M19.8 20.6 h24.4 v11.0 h-24.4 z"/>`
      + `<circle cx="22.6" cy="39.6" r="2.4"/><circle cx="41.4" cy="39.6" r="2.4"/>`
      + `<path d="M20.6 46.4 l-3.0 5.0 M43.4 46.4 l3.0 5.0"/>`,
  },
  lamp: {
    main: `<path d="M38.6 24.8 v27.4"/><path d="M38.6 24.8 q0 -11.4 -11.2 -11.4"/>`,
    det: `<path d="M31.6 52.6 h14.0"/>`
      + `<path d="M18.8 16.6 h16.4 a1.9 1.9 0 0 1 0 -3.8 h-16.4 a1.9 1.9 0 0 0 0 3.8 z"/>`,
    over: `<path d="M18.6 18.6 L10.2 45.0 h33.4 L35.4 18.6 z" fill="#ffd275" opacity="0.16"/>`
      + `<path d="M19.8 17.8 L14.6 34.0" stroke="#ffd275" stroke-width="1.4" stroke-opacity="0.4" stroke-linecap="round"/>`
      + `<path d="M19.6 17.6 h15.2" stroke="#ffd275" stroke-width="3.2" stroke-linecap="round"/>`,
  },

  // ── Drivability ─────────────────────────────────────────
  ford: {
    main: `<path d="M11.6 26.6 h40.8"/><path d="M11.6 46.6 h40.8"/>`,
    det: `<path d="M11.6 36.6 q5.1 -4.4 10.2 0 q5.1 4.4 10.2 0 q5.1 -4.4 10.2 0 q5.1 4.4 10.2 0"/>`
      + `<path d="M43.4 20.6 v22.0"/><path d="M43.4 24.6 h4.6 M43.4 30.6 h4.6 M43.4 36.6 h4.6"/>`,
  },

  // ── Terrain & natural hazards ───────────────────────────
  cave: {
    main: `<path d="M15.8 48.8 q0 -25.0 16.2 -25.0 q16.2 0 16.2 25.0"/><path d="M12.6 48.8 h38.8"/>`,
    det: `<path d="M25.6 48.8 q0 -12.2 6.4 -12.2 q6.4 0 6.4 12.2"/>`
      + `<path d="M22.6 30.6 l3.0 5.2 M41.4 30.6 l-3.0 5.2"/><path d="M32 26.8 l1.8 3.4"/>`,
  },
  mine: {
    main: `<path d="M20.6 51.4 L32 16.6 L43.4 51.4"/><path d="M14.6 51.4 h34.8"/>`,
    det: `<circle cx="32" cy="20.6" r="4.4"/><path d="M24.6 38.6 h14.8 M27.0 30.6 h10.0"/>`
      + `<path d="M32 25.0 v10.0"/>`,
  },
  spring: {
    main: `<path d="M32 30.6 c-4.6 -6.6 -4.6 -11.8 0 -17.4 c4.6 5.6 4.6 10.8 0 17.4 z"/>`,
    det: `<path d="M16.6 40.6 q7.7 -5.0 15.4 0 q7.7 5.0 15.4 0"/>`
      + `<path d="M16.6 47.6 q7.7 -5.0 15.4 0 q7.7 5.0 15.4 0"/>`
      + `<path d="M25.4 34.6 q6.6 4.0 13.2 0"/>`,
  },
  hazard: {
    main: `<path d="M32 13.6 L52.4 48.6 h-40.8 z"/>`,
    det: `<path d="M32 27.0 v11.0"/><path d="M32 43.4 v0.2"/>`,
    over: `<path d="M32 13.6 L52.4 48.6 h-40.8 z" fill="#f59e0b" opacity="0.16"/>`
      + `<path d="M32 27.0 v11.0" stroke="#f59e0b" stroke-width="3.4" stroke-linecap="round"/>`
      + `<circle cx="32" cy="43.6" r="2.0" fill="#f59e0b"/>`,
  },
};

// ============================================================
// Dynamic variants — driven by real OSM tags.
// ============================================================

/**
 * NFPA 291 hydrant flow classes. The bonnet colour is what a fire crew reads
 * off the real hydrant before they read anything else, so it is the one place
 * a hydrant is allowed colour. Sourced from the OSM `colour` tag.
 *
 * red <500 GPM · orange 500-999 · green 1000-1499 · blue 1500+
 */
export const NFPA_BONNET: Record<string, string> = {
  red: '#ef4444',
  orange: '#f97316',
  green: '#22c55e',
  blue: '#3b82f6',
};

/** Hydrant art with the bonnet, cap and flange filled to its NFPA class. */
export function hydrantWithBonnet(colour: string): GlyphArt {
  const base = GLYPHS.hydrant;
  const bonnet = `<path d="M23.4 22.6 a8.6 7.8 0 0 1 17.2 0 z"`
    + ` fill="${colour}" stroke="${HALO}" stroke-width="5.0" stroke-linejoin="round"/>`
    + `<path d="M23.4 22.6 a8.6 7.8 0 0 1 17.2 0 z"`
    + ` fill="${colour}" stroke="${INK}" stroke-width="3.1" stroke-linejoin="round"/>`
    + `<path d="M22.6 19.6 h18.8" fill="none" stroke="${HALO}" stroke-width="5.0" stroke-linecap="round"/>`
    + `<path d="M22.6 19.6 h18.8" fill="none" stroke="${INK}" stroke-width="3.1" stroke-linecap="round"/>`
    + `<path d="M28.8 13.6 h6.4 l2.4 2.8 -2.4 2.8 h-6.4 l-2.4 -2.8 z"`
    + ` fill="${colour}" stroke="${HALO}" stroke-width="4.2" stroke-linejoin="round"/>`
    + `<path d="M28.8 13.6 h6.4 l2.4 2.8 -2.4 2.8 h-6.4 l-2.4 -2.8 z"`
    + ` fill="${colour}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`;
  // The plain bonnet lines are dropped from `det` so the filled shape does not
  // sit under a duplicate outline at a slightly different weight.
  const det = (base.det ?? '')
    .replace(`<path d="M23.4 22.6 a8.6 7.8 0 0 1 17.2 0 z"/><path d="M22.6 19.6 h18.8"/>`, '')
    .replace(`<path d="M28.8 13.6 h6.4 l2.4 2.8 -2.4 2.8 h-6.4 l-2.4 -2.8 z"/>`, '');
  return { main: base.main, det, over: bonnet };
}

/**
 * Traffic-control variants off the OSM `highway` tag. A STOP sign and a signal
 * head are different objects doing different things, and an operator routing a
 * unit needs to tell them apart at a glance — rendering both as one generic
 * "traffic control" pictogram threw that away.
 */
export const CONTROL_VARIANTS: Record<string, GlyphArt> = {
  stop: {
    main: `<path d="M32 41.8 v11.0"/>`,
    det: `<path d="M26.8 52.8 h10.4"/>`,
    over: `<path d="M24.3 11.8 h15.4 L50.6 22.7 v15.4 L39.7 49.0 h-15.4 L13.4 38.1 v-15.4 z"`
      + ` fill="#06111d" opacity="0.85"/>`
      + `<path d="M24.3 11.8 h15.4 L50.6 22.7 v15.4 L39.7 49.0 h-15.4 L13.4 38.1 v-15.4 z"`
      + ` fill="#c1121f" stroke="#f5f7fa" stroke-width="2.7" stroke-linejoin="round"/>`
      + `<text x="32" y="35.4" font-family="Arial, sans-serif" font-weight="700"`
      + ` font-size="13.6" letter-spacing="0.3" text-anchor="middle" fill="#f5f7fa">STOP</text>`,
    overIsIdentity: true,
  },
  yield: {
    main: `<path d="M32 44.6 v8.2"/>`,
    det: `<path d="M26.8 52.8 h10.4"/>`,
    over: `<path d="M12.6 12.6 h38.8 L32 44.0 z" fill="#06111d" opacity="0.85"/>`
      + `<path d="M12.6 12.6 h38.8 L32 44.0 z" fill="#c1121f" stroke="#f5f7fa"`
      + ` stroke-width="2.7" stroke-linejoin="round"/>`
      + `<path d="M20.6 18.2 h22.8 L32 36.6 z" fill="#f5f7fa"/>`,
    overIsIdentity: true,
  },
};

/**
 * Camera housings. `camera:type=dome` is a genuinely different object from a
 * bullet cam, and it also has no meaningful bearing — a dome sees everything,
 * so this variant is the one camera glyph that is NOT rotated by
 * camera:direction.
 */
export const CAMERA_VARIANTS: Record<string, GlyphArt> = {
  dome: {
    main: `<path d="M16.6 34.6 a15.4 15.4 0 0 1 30.8 0 z"/><path d="M14.4 34.6 h35.2"/>`,
    det: `<circle cx="32" cy="27.0" r="6.0"/><circle cx="32" cy="27.0" r="2.4"/>`
      + `<path d="M24.6 38.6 h14.8"/><path d="M32 38.6 v6.0"/><path d="M26.4 48.6 h11.2"/>`,
  },
};

/**
 * Categories that get a muted out-of-service variant. Restricted to features
 * where "you cannot use this" changes what a unit does on arrival — a locked
 * gate, a disused hydrant, a private parking structure. A disused cave
 * entrance is not an operational fact, so terrain is absent by design.
 */
export const MUTABLE_CATS: readonly string[] = [
  'hydrant', 'water', 'inlet', 'emerg', 'heli', 'station',
  'camera', 'alpr',
  'barrier', 'control_pt', 'parking', 'transit', 'entrance', 'charging',
];
