// client/src/utils/liveAudit.ts
// Computed-style audit used to verify the Blue/Silver/Gold theme on real pages.
// Extracted from an ad-hoc browser-console script so it is testable and reusable.
//
// "Black overlay" = a large painted background darker than the navy ramp floor
// (--surface-overlay #142840, luminance ~37) that is NOT blue-dominant. Blue
// dominance is the discriminator: a dark navy surface is correct, a dark neutral
// or warm surface is a theme escape.

export type OverlayFinding = {
  selector: string;
  backgroundColor: string;
  luminance: number;
  area: number;
};

export type GoldFinding = { selector: string; property: string; value: string };

/** Legacy brand-gold ramp values. These must never render post-migration —
 *  brand gold is now #b8912f (184 145 47). Warning amber is deliberately absent
 *  from this set: it is a legitimate severity hue, not a leak. */
const LEGACY_GOLD = new Set([
  '212,160,23', '232,184,32', '245,208,96', '184,136,15',
  '147,108,10', '160,116,18', '176,130,30', '100,73,7', '120,88,8',
]);

const MIN_AREA = 1200;
const LUMINANCE_FLOOR = 26;
const AUDITED_PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor'] as const;

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(value: string | null | undefined): Rgba | null {
  const match = /rgba?\(([^)]+)\)/.exec(value ?? '');
  if (!match) return null;
  const parts = match[1].split(',').map((n) => parseFloat(n));
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function describe(el: Element): string {
  const cls = (el.className || '').toString().trim().split(/\s+/).slice(0, 3).join('.');
  return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
}

function area(el: Element): number {
  const rect = el.getBoundingClientRect();
  // jsdom reports 0x0; fall back to inline width/height so tests are meaningful.
  if (rect.width && rect.height) return rect.width * rect.height;
  const style = (el as HTMLElement).style;
  return (parseFloat(style?.width || '0') || 0) * (parseFloat(style?.height || '0') || 0);
}

export function findBlackOverlays(root: HTMLElement, opts?: { minArea?: number }): OverlayFinding[] {
  const minArea = opts?.minArea ?? MIN_AREA;
  const findings: OverlayFinding[] = [];
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const bg = parseColor(getComputedStyle(el).backgroundColor);
    if (!bg || bg.a < 0.3) continue;
    const size = area(el);
    if (size < minArea) continue;
    const blueDominant = bg.b > bg.r + 8;
    const L = luminance(bg);
    if (L >= LUMINANCE_FLOOR || blueDominant) continue;
    findings.push({
      selector: describe(el),
      backgroundColor: getComputedStyle(el).backgroundColor,
      luminance: Math.round(L),
      area: Math.round(size),
    });
  }
  return findings;
}

export function findGoldLeaks(root: HTMLElement): GoldFinding[] {
  const findings: GoldFinding[] = [];
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const style = getComputedStyle(el);
    for (const prop of AUDITED_PROPS) {
      const color = parseColor(style[prop]);
      if (!color || color.a < 0.3) continue;
      if (!LEGACY_GOLD.has(`${color.r},${color.g},${color.b}`)) continue;
      findings.push({ selector: describe(el), property: prop, value: style[prop] });
      break;
    }
  }
  return findings;
}
