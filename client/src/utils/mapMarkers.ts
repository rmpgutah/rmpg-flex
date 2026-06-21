// client/src/utils/mapMarkers.ts
// Shared, themed Mapbox marker builders. Pure DOM — no Mapbox coupling;
// callers wrap the returned element in `new mapboxgl.Marker({ element })`.
// Theme tokens mirror client/src/index.css :root (pure-black / gold Spillman).

/**
 * Reject coordinates that Mapbox would happily plot but a human reading the
 * map would treat as a bug: NaN / Infinity, the exact (0, 0) no-fix signature
 * ClearPath GPS emits before its first GPS lock, and out-of-globe values.
 *
 * Real Utah positions have ≥4 significant digits (lat ≈ 40.x, lng ≈ -111.x),
 * so the exact (0, 0) rejection is safe — no legitimate fleet vehicle rounds
 * to that coordinate. Existing breadcrumb code in MapPage.tsx already uses
 * `Number.isFinite`; this brings unit / call / dot markers into line via one
 * shared predicate every map surface can import.
 */
export function isValidLngLat(lng: unknown, lat: unknown): boolean {
  // Plain boolean (not a type predicate) — predicates can only narrow ONE
  // identifier in TypeScript, which would leave callers with `lng: number`
  // but `lat: number | null` and force confusing per-arg asserts. Callers
  // pair this guard with a `!` non-null assertion on each array slot.
  return (
    typeof lng === 'number' && typeof lat === 'number' &&
    Number.isFinite(lng) && Number.isFinite(lat) &&
    !(lng === 0 && lat === 0) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

export type UnitStatus =
  | 'in_service' | 'available' | 'enroute' | 'onscene' | 'busy'
  | 'out_of_service' | string;

const GOLD = '#d4a017';
const GREEN = '#22c55e';
const RED = '#dc2626';
const NEUTRAL = '#888888';

/**
 * Apply a map of CSS declarations one property at a time.
 * Using per-property assignment (instead of one `cssText` blob) keeps a single
 * malformed declaration from dropping the whole style attribute — a known jsdom
 * `cssText` parser quirk — and lets the DOM normalize each value independently.
 */
function applyStyles(el: HTMLElement, styles: Record<string, string>): void {
  for (const [prop, value] of Object.entries(styles)) {
    el.style.setProperty(prop, value);
  }
}

export function unitStatusColor(status: UnitStatus | undefined): string {
  switch (status) {
    case 'in_service':
    case 'available':
      return GREEN;
    case 'enroute':
    case 'onscene':
    case 'busy':
      return GOLD;
    case 'out_of_service':
      return NEUTRAL;
    default:
      return NEUTRAL;
  }
}

export function callPriorityColor(priority: number | string | undefined): string {
  if (priority === undefined || priority === null) return GOLD;
  const p = typeof priority === 'string' ? parseInt(priority, 10) : priority;
  if (Number.isNaN(p)) return GOLD;
  if (p <= 2) return RED;
  if (p <= 4) return GOLD;
  return NEUTRAL;
}

export interface UnitMarkerOpts {
  label?: string;
  status?: UnitStatus;
  heading?: number;
}

/** Clean circular unit marker with status-colored ring + centered label. */
export function buildUnitMarker(opts: UnitMarkerOpts): HTMLElement {
  const color = unitStatusColor(opts.status);
  const el = document.createElement('div');
  // Record the resolved status color verbatim (the DOM normalizes hex in
  // `style` to rgb(), so callers/tests can read the canonical hex from here).
  el.dataset.statusColor = color;
  applyStyles(el, {
    width: '22px',
    height: '22px',
    'border-radius': '50%',
    background: '#000000',
    border: `2px solid ${color}`,
    'box-shadow': `0 0 6px ${color}, 0 1px 3px rgba(0,0,0,0.6)`,
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'font-family': '"JetBrains Mono",monospace',
    'font-size': '10px',
    'font-weight': '700',
    color: '#fff',
    cursor: 'pointer',
  });
  if (opts.label) {
    const span = document.createElement('span');
    span.textContent = opts.label;       // text node — no HTML injection
    el.appendChild(span);
  }
  if (typeof opts.heading === 'number') {
    const arrow = document.createElement('div');
    applyStyles(arrow, {
      position: 'absolute',
      top: '-6px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '0',
      height: '0',
      'border-left': '4px solid transparent',
      'border-right': '4px solid transparent',
      'border-bottom': `6px solid ${color}`,
    });
    el.style.position = 'relative';
    el.appendChild(arrow);
    el.style.transform = `rotate(${opts.heading}deg)`;
  }
  return el;
}

export interface CallMarkerOpts {
  priority?: number | string;
  label?: string;
}

/** Priority-colored teardrop call marker. */
export function buildCallMarker(opts: CallMarkerOpts): HTMLElement {
  const color = callPriorityColor(opts.priority);
  const el = document.createElement('div');
  // Record the resolved priority color verbatim (the DOM normalizes hex in
  // `style` to rgb(), so callers/tests can read the canonical hex from here).
  el.dataset.priorityColor = color;
  applyStyles(el, {
    width: '20px',
    height: '20px',
    background: color,
    border: '1.5px solid #000000',
    'border-radius': '50% 50% 50% 0',
    transform: 'rotate(-45deg)',
    'box-shadow': '0 2px 4px rgba(0,0,0,0.6)',
    cursor: 'pointer',
  });
  if (opts.label) {
    const span = document.createElement('span');
    span.textContent = opts.label;
    applyStyles(span, {
      display: 'block',
      transform: 'rotate(45deg)',
      'text-align': 'center',
      'font-size': '9px',
      'font-weight': '700',
      color: '#000',
      'line-height': '20px',
    });
    el.appendChild(span);
  }
  return el;
}

export interface DotHalo {
  /** Halo ring color (e.g. red for an ALPR plate hit, gold for a watchlist hit). */
  color: string;
  /** Border width in px. Default 2. */
  width?: number;
  /** Drop-shadow spread in px. Default 8. */
  shadowSpread?: number;
}

export interface DotMarkerOpts {
  color?: string;
  size?: number;
  pulse?: boolean;
  /**
   * Optional outer halo — replaces the default 1px black border + 4px glow
   * with a colored ring + larger spread, e.g. for ALPR plate hits or
   * watchlist matches. Additive: callers that don't pass `halo` get the
   * existing styling, so this is signature-safe for every prior consumer.
   */
  halo?: DotHalo;
}

/** Simple colored dot for sightings / track points. */
export function buildDotMarker(opts: DotMarkerOpts): HTMLElement {
  const color = opts.color || GOLD;
  const size = opts.size ?? 10;
  const el = document.createElement('div');
  const halo = opts.halo;
  applyStyles(el, {
    width: `${size}px`,
    height: `${size}px`,
    'border-radius': '50%',
    background: color,
    border: halo ? `${halo.width ?? 2}px solid ${halo.color}` : '1px solid #000000',
    'box-shadow': halo
      ? `0 0 ${halo.shadowSpread ?? 8}px 2px ${halo.color}`
      : `0 0 4px ${color}`,
  });
  if (opts.pulse) el.style.animation = 'rmpg-recovery-pulse 1.4s ease-in-out infinite';
  return el;
}

/**
 * Canonical status colors for dispatch UI status pills + map markers. Mapbox
 * layer paint properties don't accept CSS variables, so the named source
 * lives here in JS — one place to change every status hue.
 */
export const STATUS_COLORS = {
  online: GREEN,      // #22c55e
  warning: GOLD,      // #d4a017 (brand)
  caution: '#f59e0b', // amber-500
  offline: NEUTRAL,   // #888888
} as const;
