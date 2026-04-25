// ============================================================
// RMPG Flex — Visual Alert Flash
// ============================================================
// Brief full-screen color flash that pairs with critical audio
// alerts. Two purposes:
//
//   1. Accessibility — dispatchers with hearing impairments or
//      working in noisy rooms get a synchronized visual cue.
//   2. Attention — the flash pulls a peripheral-vision grab even
//      if the dispatcher isn't looking at the dispatch surface.
//
// Implemented as a single fixed-position overlay div managed by
// this module. Multiple overlapping calls coalesce — the flash
// re-extends rather than stacking.
//
// Color mapping:
//   info     → no flash (audio only)
//   warning  → soft amber pulse,  300ms
//   critical → red pulse,         500ms, 2 cycles
//   pursuit  → purple-magenta,    400ms, 3 cycles
//
// Respects prefers-reduced-motion: in that mode the overlay
// fades in then out once at low alpha rather than pulsing.
// Also respects the dispatch sound toggle — if the user has
// muted alerts entirely, visual flash is suppressed too. (The
// dispatcher chose silence; we don't second-guess them with a
// strobe.)
// ============================================================

type FlashSeverity = 'warning' | 'critical' | 'pursuit' | 'info';

interface FlashSpec {
  color: string;       // CSS rgba — final color at peak
  durationMs: number;  // single pulse duration
  cycles: number;      // number of pulses (1 = single fade)
  peakAlpha: number;   // 0..1
}

const SPECS: Record<FlashSeverity, FlashSpec | null> = {
  info: null,                                             // no flash
  warning:  { color: '#d4a017', durationMs: 300, cycles: 1, peakAlpha: 0.18 },  // brand gold
  critical: { color: '#dc2626', durationMs: 500, cycles: 2, peakAlpha: 0.30 },  // red
  pursuit:  { color: '#a21caf', durationMs: 400, cycles: 3, peakAlpha: 0.32 },  // magenta
};

let overlayEl: HTMLDivElement | null = null;
let activeAnimation: Animation | null = null;

function ensureOverlay(): HTMLDivElement {
  if (overlayEl && document.body.contains(overlayEl)) return overlayEl;
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true'); // decorative; screen-readers ignore
  // Pointer-events:none so the flash never blocks clicks. Fixed
  // position covers viewport. Initial opacity 0 so it's invisible
  // until an animation runs.
  Object.assign(el.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '99999',
    opacity: '0',
    backgroundColor: 'transparent',
    transition: 'none',
    mixBlendMode: 'screen', // brighter on dark UI without obscuring content
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  overlayEl = el;
  return el;
}

function isSoundEnabled(): boolean {
  // Mirrors dispatchTones.isSoundEnabled — if alerts are muted,
  // visual flash is suppressed too. Dispatchers who explicitly
  // silenced the console don't want a strobe replacement.
  return localStorage.getItem('rmpg-sound') !== 'false';
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Trigger a visual flash matching an alert severity.
 * Idempotent — overlapping calls cancel any in-flight animation
 * and start the new one. Returns immediately; animation runs async.
 */
export function flashAlert(severity: FlashSeverity): void {
  if (!isSoundEnabled()) return;
  const spec = SPECS[severity];
  if (!spec) return;

  const el = ensureOverlay();
  el.style.backgroundColor = spec.color;

  // Cancel any in-flight pulse.
  if (activeAnimation) {
    try { activeAnimation.cancel(); } catch { /* ignore */ }
    activeAnimation = null;
  }

  // Build keyframes. Reduced-motion users get a single soft fade,
  // others get the full pulse cycle count.
  const reduced = prefersReducedMotion();
  const cycles = reduced ? 1 : spec.cycles;
  const totalMs = spec.durationMs * cycles;
  const peak = reduced ? spec.peakAlpha * 0.5 : spec.peakAlpha;

  const keyframes: Keyframe[] = [];
  for (let i = 0; i < cycles; i++) {
    const cycleStart = i / cycles;
    const cyclePeak = (i + 0.4) / cycles; // peak slightly before midpoint
    const cycleEnd = (i + 1) / cycles;
    keyframes.push({ offset: cycleStart, opacity: 0 });
    keyframes.push({ offset: cyclePeak, opacity: peak });
    keyframes.push({ offset: cycleEnd, opacity: 0 });
  }

  try {
    activeAnimation = el.animate(keyframes, {
      duration: totalMs,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
    activeAnimation.onfinish = () => {
      el.style.opacity = '0';
      activeAnimation = null;
    };
  } catch {
    // If WAAPI isn't available for some reason, fall back to a one-shot
    // CSS transition. Less polished but still functional.
    el.style.transition = `opacity ${spec.durationMs}ms ease-in-out`;
    el.style.opacity = String(peak);
    setTimeout(() => { el.style.opacity = '0'; }, spec.durationMs);
  }
}

/** Map an alert event's severity field to a flash severity. */
export function flashSeverityFor(eventType: string, severity?: string, mph?: number): FlashSeverity {
  if (eventType === 'speed:alert' && typeof mph === 'number' && mph >= 100) return 'pursuit';
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'warning';
  return 'info';
}
