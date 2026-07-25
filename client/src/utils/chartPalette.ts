// client/src/utils/chartPalette.ts
// Single owner of chart color decisions. Recharts takes literal color strings
// (a `var(--x)` reference is not resolved inside SVG paint attributes), so
// colors are read off <html> at call time instead of being hardcoded.
//
// This exists because chart internals were carrying literal #d4a017, which is
// legacy gold: it never re-themed, and it survived the Blue & Silver migration
// as a visible gold leak on every charted route.
//
// Call these at RENDER time, not at module scope — a module-level constant is
// captured before the theme class is stamped and freezes the wrong palette.

const FALLBACKS: Record<string, string> = {
  '--brand-blue': '#5a9ae0',
  '--accent-silver-500': '#c3ccd6',
  '--accent-gold-500': '#b8912f',
  '--sev-ok': '#22c55e',
  '--sev-warn': '#f59e0b',
  '--sev-special': '#c084fc',
  '--text-muted': '#9bb0c7',
  '--border-subtle': '#2a4763',
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
