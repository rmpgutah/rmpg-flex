// ============================================================
// RMPG Flex — UI Click Sounds (Spillman Flex console feedback)
// A very short, soft "key tick" on every interactive click —
// the tactile keypad feedback of a Motorola/Spillman dispatch
// console. SAMPLE-ONLY: plays the curated click.wav asset via
// soundAssets.ts; if the asset isn't decoded yet the click is
// simply silent (no oscillator fallback — the synth tick was
// harsher than the tuned sample and is intentionally gone).
//
// Gates:
//  - per-unit silent/vibrate audio mode (audioMode.ts)
//  - user toggle in localStorage (rmpg_ui_click_sounds, default ON)
//  - 35ms throttle so double-fired synthetic events tick once
// ============================================================
import { getLocalAudioMode } from './audioMode';
import { playSoundAsset } from './soundAssets';

const TOGGLE_KEY = 'rmpg_ui_click_sounds';
const THROTTLE_MS = 35;

let lastTick = 0;
let installed = false;

export function clickSoundsEnabled(): boolean {
  try { return localStorage.getItem(TOGGLE_KEY) !== 'off'; } catch { return true; }
}

export function setClickSoundsEnabled(on: boolean): void {
  try { localStorage.setItem(TOGGLE_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}

/** The tick itself — the sampled console click, or silence if not ready. */
export function playUiClick(): void {
  try {
    if (!clickSoundsEnabled() || getLocalAudioMode() !== 'audible') return;
    const now = Date.now();
    if (now - lastTick < THROTTLE_MS) return;
    lastTick = now;

    // Sample-only: a miss (still decoding / fetch failed) stays silent
    // by design — never substitute a synthesized tick.
    playSoundAsset('click');
  } catch {
    // Click audio must never interfere with the click itself
  }
}

/** True when the click landed on something that behaves like a control. */
function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    'button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], a, select, summary, input[type="checkbox"], input[type="radio"], input[type="submit"]'
  );
}

/**
 * Install the app-wide listener (idempotent). Capture phase so the
 * tick fires even when a handler stops propagation; pointerdown so
 * feedback is instant, matching hardware-console feel.
 */
export function initUiClickSounds(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'pointerdown',
    (e) => {
      // Primary button / touch only — no ticks on right-click menus
      if (e.button !== 0) return;
      if (isInteractive(e.target)) playUiClick();
    },
    { capture: true, passive: true }
  );
}
