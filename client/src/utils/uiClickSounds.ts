// ============================================================
// RMPG Flex — UI Click Sounds (Spillman Flex console feedback)
// A very short, dry "key tick" on every interactive click —
// the tactile keypad feedback of a Motorola/Spillman dispatch
// console. One shared lazy AudioContext (clicks are frequent;
// creating a context per click would exhaust the browser pool).
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

let ctx: AudioContext | null = null;
let lastTick = 0;
let installed = false;

export function clickSoundsEnabled(): boolean {
  try { return localStorage.getItem(TOGGLE_KEY) !== 'off'; } catch { return true; }
}

export function setClickSoundsEnabled(on: boolean): void {
  try { localStorage.setItem(TOGGLE_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}

function getCtx(): AudioContext | null {
  if (ctx && ctx.state !== 'closed') return ctx;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  return ctx;
}

/** The tick itself: a 30ms filtered square blip — dry keypad click. */
export function playUiClick(): void {
  try {
    if (!clickSoundsEnabled() || getLocalAudioMode() !== 'audible') return;
    const now = Date.now();
    if (now - lastTick < THROTTLE_MS) return;
    lastTick = now;

    // Sampled console click (actual audio asset); synth below is the fallback
    if (playSoundAsset('click')) return;

    const ac = getCtx();
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();

    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(2100, t0);
    // Tiny downward pitch flick reads as a mechanical key, not a beep
    osc.frequency.exponentialRampToValueAtTime(1400, t0 + 0.025);

    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.07, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);

    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 1.2;

    osc.connect(env);
    env.connect(filter);
    filter.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.05);
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
