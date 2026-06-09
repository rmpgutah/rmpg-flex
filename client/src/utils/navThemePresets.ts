// ============================================================
// RMPG Flex — Day/Night Mapbox Theme Presets
// One source of truth for the NAVIGATE map recolor so the page and
// any future map surface import the same paint ops instead of
// duplicating inline setPaintProperty loops. Pure data + a small
// applier — no React, no DOM.
//
// NIGHT_RECOLOR mirrors the current pure-black tactical base pushed
// onto dark-v11 in NavigationPage (black background/land, near-black
// water). Per the Spillman pure-black design system (ZERO blue), the
// faint-blue legacy water tint (#04070d) is normalized here to the
// neutral near-black #050505 — visually identical at this darkness.
// DAY_PRESET is a light, no-recolor base for daytime driving.
// ============================================================

/** A single recolor op resolved against a style layer at apply time. */
export interface PaintOp {
  /** Layer-type guard ('background' | 'fill' | …). */
  layerType: string;
  /** RegExp source matched (case-insensitive) against the layer id. */
  match?: string;
  /** Paint property to set (e.g. 'background-color', 'fill-color'). */
  property: string;
  /** Color value to apply (pure-black palette, no blue). */
  value: string;
}

export interface NavThemePreset {
  /** Mapbox base style URL to load. */
  styleUrl: string;
  /** Recolor ops applied after the base style loads ([] = none). */
  recolor: PaintOp[];
  /** Marker/heading-dot color for this theme. */
  markerColor: string;
}

/** Night — pure-black tactical base on dark-v11 (matches current NAVIGATE). */
export const NIGHT_RECOLOR: NavThemePreset = {
  styleUrl: 'mapbox://styles/mapbox/dark-v11',
  recolor: [
    { layerType: 'background', property: 'background-color', value: '#000000' },
    { layerType: 'fill', match: 'water', property: 'fill-color', value: '#050505' },
    {
      layerType: 'fill',
      match: '(^|[-_])(land|landcover|landuse)',
      property: 'fill-color',
      value: '#050505',
    },
  ],
  markerColor: '#d4a017',
};

/** Day — lighter base, no recolor (legible in direct sun). */
export const DAY_PRESET: NavThemePreset = {
  styleUrl: 'mapbox://styles/mapbox/navigation-day-v1',
  recolor: [],
  markerColor: '#d4a017',
};

export type NavThemeName = 'night' | 'day';

export const NAV_THEMES: Record<NavThemeName, NavThemePreset> = {
  night: NIGHT_RECOLOR,
  day: DAY_PRESET,
};

/**
 * Minimal structural type for the bit of the Mapbox map we touch —
 * lets map code call applyNavTheme without importing mapbox-gl here.
 */
export interface ThemeableMap {
  getStyle(): { layers?: Array<{ id: string; type: string }> } | undefined;
  setPaintProperty(layerId: string, property: string, value: unknown): void;
}

/**
 * Apply a theme's recolor ops to a loaded Mapbox map. Each op is
 * guarded individually (layer ids vary by style version), so a miss
 * never throws. Returns the preset that was applied (for marker color).
 */
export function applyNavTheme(map: ThemeableMap, theme: NavThemeName): NavThemePreset {
  const preset = NAV_THEMES[theme] ?? NIGHT_RECOLOR;
  try {
    const layers = map.getStyle()?.layers || [];
    for (const ly of layers) {
      for (const op of preset.recolor) {
        if (ly.type !== op.layerType) continue;
        if (op.match && !new RegExp(op.match, 'i').test(ly.id)) continue;
        try {
          map.setPaintProperty(ly.id, op.property, op.value);
        } catch {
          /* cosmetic — never block the map */
        }
      }
    }
  } catch {
    /* style not ready — caller retries on next load */
  }
  return preset;
}
