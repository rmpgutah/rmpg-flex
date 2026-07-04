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
// React (utils/mapMarkers.ts, hooks/useMapStreetView.ts) — Tailwind classes
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
export const TACTICAL_TEXT_DIM = '#c3d0de';
