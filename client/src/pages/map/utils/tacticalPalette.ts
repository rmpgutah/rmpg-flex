// ============================================================
// RMPG Flex — Tactical palette constants
// ============================================================
// The Map page is a "tactical surface" (like Nav/MDT/HUD) — it stays on the
// NIGHT palette always, regardless of the app-wide day/night schedule
// (a bright map at night blinds a driver). React-rendered chrome expresses
// this via the `.tactical-dark` class + rmpg-*/brand-*/surface-* Tailwind
// tokens (see MapboxMapPage.tsx's root container).
//
// Mapbox markers/popups are built as raw HTML strings injected outside
// React (utils/mapMarkers.ts) — Tailwind classes
// don't apply there. Since tactical-dark never switches, these constants are
// just the resolved night-palette hex values, kept in sync manually with
// the `:root, html.theme-dark, .tactical-dark` block in
// client/src/styles/theme-palettes.css. Update both places together if the
// night palette ever changes.
// ============================================================

export const TACTICAL_SURFACE_BASE = '#0d1722';
export const TACTICAL_SURFACE_RAISED = '#15212e';
export const TACTICAL_BORDER = '#2a3a4d';
export const TACTICAL_TEXT_MUTED = '#8fa3b8';
export const TACTICAL_BRAND_GOLD = '#d4a017';
export const TACTICAL_TEXT_PRIMARY = '#e6edf5';
// NOTE: despite the name, this is NOT darker/dimmer than TACTICAL_TEXT_MUTED —
// it mirrors CSS `--text-secondary`, which is actually the BRIGHTER of the two
// text tokens (TACTICAL_TEXT_MUTED mirrors `--text-muted`, the darker one).
// Pick based on the actual hex/CSS source values below, not the constant's
// name, when you need the more de-emphasized (dimmer) of the two options —
// that's TACTICAL_TEXT_MUTED, not this one.
export const TACTICAL_TEXT_DIM = '#c3d0de';
// Original self-position marker blue; approximates --brand-500 (#3b82f6).
export const TACTICAL_INFO = '#3b82f6';
// Tactical near-white — resolves --text-primary for Mapbox paint (line/circle
// strokes on the GPS trail layer) where CSS variables are unsupported.
export const TACTICAL_TEXT_NEAR_WHITE = '#f0f4f9';
// Tactical silver — resolves --accent-silver-500 for Mapbox marker chrome.
export const TACTICAL_SILVER = '#c3ccd6';
// Resolves red-400 (#f87171) for error popup text; lighter than --sev-critical (#ef4444) to maintain contrast on dark surfaces.
export const TACTICAL_ERROR = '#f87171';
// Isochrone ring colors for Mapbox fill/line paint (5 min = green, 10 = amber, 15 = red).
export const ISOCHRONE_COLORS = ['#22c55e', '#f59e0b', '#ef4444'] as const;
