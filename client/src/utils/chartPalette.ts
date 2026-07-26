// client/src/utils/chartPalette.ts
// Single owner of chart color decisions. Colors are read off <html> at call
// time rather than hardcoded.
//
// NOTE: `var()` DOES resolve in SVG presentation attributes in current Chrome
// (verified Chrome 148: `fill="var(--x)"` computes correctly). The previous
// claim here that it does not was wrong. Resolving via getComputedStyle is
// still preferred — it keeps one owner for the decision and does not depend on
// that browser behavior.
//
// This exists because chart internals were carrying literal #d4a017, which is
// legacy gold: it never re-themed, and it survived the Blue & Silver migration
// as a visible gold leak on every charted route.
//
// Call these at RENDER time, not at module scope — a module-level constant is
// captured before the theme class is stamped and freezes the wrong palette.

// Exported (named export, same const) because chartTokens.test.ts mirrors the
// --chart-pri-1..4 / --chart-plot-surface entries against the literal values
// declared in theme-palettes.css's html.theme-blue-silver block — nothing else
// binds this fallback copy to the CSS, so editing one silently leaves the
// other stale on the getComputedStyle-failure path.
export const FALLBACKS: Record<string, string> = {
  '--brand-blue': '#5a9ae0',
  '--accent-silver-500': '#c3ccd6',
  '--accent-gold-500': '#b8912f',
  '--sev-ok': '#22c55e',
  '--sev-warn': '#f59e0b',
  '--sev-special': '#c084fc',
  '--text-muted': '#9bb0c7',
  '--border-subtle': '#2a4763',
  '--chart-pri-1': '#ff9483',
  '--chart-pri-2': '#e08355',
  '--chart-pri-3': '#a87e5b',
  '--chart-pri-4': '#7e6f61',
  '--chart-plot-surface': '#142840',
};

export function resolveThemeColor(varName: string, fallback: string): string {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

function themeColor(varName: string): string {
  return resolveThemeColor(varName, FALLBACKS[varName] ?? '#9bb0c7');
}

/** Categorical series palette, ordered for maximum adjacent separation.
 *  Severity hues appear here as CATEGORY colors only; a chart encoding real
 *  severity should map its own values to --sev-* directly rather than relying
 *  on this ordering. */
export function chartSeriesColors(): string[] {
  return [
    themeColor('--brand-blue'),
    themeColor('--accent-silver-500'),
    themeColor('--accent-gold-500'),
    themeColor('--sev-ok'),
    themeColor('--sev-special'),
    themeColor('--sev-warn'),
  ];
}

export function chartAxisColor(): string {
  return themeColor('--text-muted');
}

export function chartGridColor(): string {
  return themeColor('--border-subtle');
}

export function chartLegendColor(): string {
  return themeColor('--text-muted');
}

/** Ordinal priority heat ramp, index 0 = P1 (urgent) … index 3 = P4 (routine).
 *  This is a RAMP, not a categorical set — see theme-palettes.css. */
export function chartPriorityColors(): string[] {
  return [
    themeColor('--chart-pri-1'),
    themeColor('--chart-pri-2'),
    themeColor('--chart-pri-3'),
    themeColor('--chart-pri-4'),
  ];
}

/** Ramp step for one priority. Accepts 'P1' | '1' | 1 — the typed CallPriority
 *  is 'P1' but the map's ActiveCall carries a bare number string, and a lookup
 *  that misses used to fall through to a gray that failed contrast. Unknown
 *  input returns the most recessive step, which still clears 3:1. */
export function chartPriorityColor(priority: string | number | null | undefined): string {
  const ramp = chartPriorityColors();
  const n = Number(String(priority ?? '').trim().replace(/^p/i, ''));
  return Number.isInteger(n) && n >= 1 && n <= 4 ? ramp[n - 1] : ramp[3];
}

/** Recessed plot-area surface. A mid-tone panel background compresses the legal
 *  lightness band below what a 4-step ramp needs; charts draw on this instead. */
export function chartPlotSurface(): string {
  return themeColor('--chart-plot-surface');
}
