// ============================================================
// RMPG Flex — Button Health Audit
// ------------------------------------------------------------
// Read-only diagnostic that detects buttons whose *clickable*
// hit area does not match their *visual* area — the root cause
// of the "the button is there but only a sliver is clickable"
// and "buttons die" reports.
//
// Mechanism: for every interactive control we sample five points
// across its box and ask the browser, via document.elementFromPoint
// (the exact hit-test the browser uses to dispatch a real click),
// what element actually sits on top at each point. If that element
// is not the control itself (nor a descendant — descendants bubble
// the click harmlessly), the control is being shadowed by an
// overlay, a sibling label, a map canvas, etc.
//
//   - blocked : 0 of 5 sample points reach the control (fully dead)
//   - sliver  : 1–4 of 5 reach it (only part is clickable)
//
// Nothing here mutates the DOM. It is safe to run on any page.
// ============================================================

export interface ButtonHealthEntry {
  /** aria-label or trimmed text, for identification */
  label: string;
  /** how many of the 5 sample points actually hit the control (0–5) */
  reachablePoints: number;
  /** 'blocked' = 0/5 reachable, 'sliver' = 1–4/5 reachable */
  severity: 'blocked' | 'sliver';
  /** tag + first classes of the element stealing the click */
  interceptor: string;
  /** computed position/z-index/pointer-events of the interceptor */
  interceptorStyle: string;
  /** the control's bounding rect [x, y, w, h] (rounded) */
  rect: [number, number, number, number];
  /** the control's own tag + first classes */
  control: string;
}

export interface ButtonHealthReport {
  url: string;
  viewport: [number, number];
  totalVisible: number;
  blocked: number;
  sliver: number;
  /** offender counts keyed by interceptor signature, most common first */
  interceptorTally: Array<[string, number]>;
  entries: ButtonHealthEntry[];
}

const INTERACTIVE_SELECTOR =
  'button, [role="button"], a[href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

const SAMPLE_POINTS: Array<[number, number]> = [
  [0.5, 0.5], // center
  [0.12, 0.5], // left-inner
  [0.88, 0.5], // right-inner
  [0.5, 0.15], // top-inner
  [0.5, 0.85], // bottom-inner
];

/**
 * Is this control *meant* to be interactive right now? We must NOT flag
 * controls that are intentionally hidden — e.g. a closed dropdown still
 * mounted for its open/close transition (opacity:0 / pointer-events:none),
 * an off-screen tab panel, or an aria-hidden subtree. Those legitimately
 * fail the hit test and would be false positives.
 */
function isGenuinelyInteractive(el: Element): boolean {
  // Element.checkVisibility (modern browsers) covers display:none,
  // visibility:hidden, opacity:0, and content-visibility in one shot.
  const anyEl = el as Element & {
    checkVisibility?: (opts?: {
      opacityProperty?: boolean;
      visibilityProperty?: boolean;
      contentVisibilityAuto?: boolean;
    }) => boolean;
  };
  if (typeof anyEl.checkVisibility === 'function') {
    if (
      !anyEl.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      })
    ) {
      return false;
    }
  }
  // Explicitly disabled controls are meant to be inert — not a bug.
  if (
    (el as HTMLButtonElement).disabled ||
    el.getAttribute('aria-disabled') === 'true'
  ) {
    return false;
  }
  // An aria-hidden / inert subtree is intentionally removed from interaction.
  // NOTE: we deliberately do NOT skip on pointer-events:none — a control that
  // is visible but has pointer-events:none is itself a "dead button" bug we
  // want to surface (it shows up as blocked, since clicks fall through it).
  for (let p: Element | null = el; p; p = p.parentElement) {
    if (p.getAttribute('aria-hidden') === 'true') return false;
    if ((p as HTMLElement).inert) return false;
  }
  return true;
}

function describe(el: Element | null): string {
  if (!el) return '(none)';
  const cls =
    typeof el.className === 'string'
      ? el.className.trim().split(/\s+/).slice(0, 4).join('.')
      : '';
  return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
}

function styleSig(el: Element | null): string {
  if (!el) return '';
  const cs = getComputedStyle(el);
  return `pos:${cs.position} z:${cs.zIndex} pe:${cs.pointerEvents}`;
}

/**
 * Scan the live DOM and return every interactive control whose hit area
 * is shadowed by another element. Pure read — no mutation.
 */
export function auditButtonHealth(): ButtonHealthReport {
  const controls = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
  const entries: ButtonHealthEntry[] = [];
  const tally: Record<string, number> = {};
  let totalVisible = 0;
  let blocked = 0;
  let sliver = 0;

  for (const control of controls) {
    const r = control.getBoundingClientRect();
    // Skip controls that are not currently on-screen / not laid out.
    if (r.width < 6 || r.height < 6) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    // Skip controls that are intentionally hidden/disabled (closed menus,
    // off-screen panels, aria-hidden) — those are not layering bugs.
    if (!isGenuinelyInteractive(control)) continue;
    totalVisible++;

    let reachable = 0;
    let firstInterceptor: Element | null = null;
    for (const [fx, fy] of SAMPLE_POINTS) {
      const x = r.left + r.width * fx;
      const y = r.top + r.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === control || control.contains(hit))) {
        reachable++;
      } else if (!firstInterceptor && hit && hit !== control) {
        firstInterceptor = hit;
      }
    }

    if (reachable === 5) continue; // fully clickable — healthy

    const severity: 'blocked' | 'sliver' = reachable === 0 ? 'blocked' : 'sliver';
    if (severity === 'blocked') blocked++;
    else sliver++;

    const interceptor = describe(firstInterceptor);
    tally[interceptor] = (tally[interceptor] || 0) + 1;

    entries.push({
      label: (
        control.getAttribute('aria-label') ||
        (control.textContent || '').trim() ||
        control.getAttribute('title') ||
        '(no label)'
      ).slice(0, 40),
      reachablePoints: reachable,
      severity,
      interceptor,
      interceptorStyle: styleSig(firstInterceptor),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      control: describe(control),
    });
  }

  // Worst first: fully blocked before slivers, then by how little is reachable.
  entries.sort((a, b) => a.reachablePoints - b.reachablePoints);

  return {
    url: location.pathname + location.search,
    viewport: [innerWidth, innerHeight],
    totalVisible,
    blocked,
    sliver,
    interceptorTally: Object.entries(tally).sort((a, b) => b[1] - a[1]),
    entries,
  };
}
