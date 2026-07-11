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
import { playSoundAsset, startSoundAsset } from './soundAssets';

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

// ── Close / dismiss tone ────────────────────────────────────
// Spillman console idiom: closing a window/form "de-keys" — the short
// low roger beep (key_out.wav, the same sampled Motorola de-key used by
// the radio). Distinct from the generic key tick so an operator hears
// "something closed" without looking. Same gates + throttle as the tick.
const CLOSE_GAIN = 0.16;

export function playUiClose(): void {
  try {
    if (!clickSoundsEnabled() || getLocalAudioMode() !== 'audible') return;
    const now = Date.now();
    if (now - lastTick < THROTTLE_MS) return;
    lastTick = now;
    // Sample-only, same policy as the tick: silent on a decode miss.
    startSoundAsset('key_out', CLOSE_GAIN);
  } catch {
    // Audio must never interfere with the close itself
  }
}

/** True when the control is a close/dismiss affordance (modal X, Cancel,
 * dismiss chip). IconButton enforces aria-label, so X buttons carry
 * "Close …"/"Dismiss …" labels app-wide. */
function isCloseControl(el: Element): boolean {
  const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`;
  if (/\b(close|dismiss)\b/i.test(label)) return true;
  // Text buttons: exact CANCEL / CLOSE / DISMISS captions only — never
  // substring-match free text ("Close call review" would be fine, but
  // "Disclose" must not beep).
  const text = (el.textContent || '').trim();
  return /^(cancel|close|dismiss|×|✕)$/i.test(text);
}

// ── Dialog / open tone ──────────────────────────────────────
// Played when a dialog/overlay appears (MutationObserver below).
const DIALOG_SELECTOR = '[role="dialog"], [data-modal], .modal-overlay';

export function playUiOpen(): void {
  try {
    if (!clickSoundsEnabled() || getLocalAudioMode() !== 'audible') return;
    const now = Date.now();
    if (now - lastTick < THROTTLE_MS) return;
    lastTick = now;
    playSoundAsset('submit');
  } catch {
    // Audio must never interfere with the open itself
  }
}

// ── Navigation tone ─────────────────────────────────────────
export function playUiNavigate(): void {
  try {
    if (!clickSoundsEnabled() || getLocalAudioMode() !== 'audible') return;
    const now = Date.now();
    if (now - lastTick < THROTTLE_MS) return;
    lastTick = now;
    playSoundAsset('click');
  } catch {
    // Audio must never interfere with navigation
  }
}

/**
 * Install the app-wide listener (idempotent). Capture phase so the
 * tick fires even when a handler stops propagation; pointerdown so
 * feedback is instant, matching hardware-console feel.
 */
export const initUiClickSounds = (): void => {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'pointerdown',
    (e) => {
      // Primary button / touch only — no ticks on right-click menus
      if (e.button !== 0) return;
      if (!(e.target instanceof Element)) return;
      const control = e.target.closest(
        'button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], a, select, summary, input[type="checkbox"], input[type="radio"], input[type="submit"]'
      );
      if (!control) return;
      // Close/dismiss affordances de-key; everything else key-ticks.
      if (isCloseControl(control)) playUiClose();
      else playUiClick();
    },
    { capture: true, passive: true }
  );

  // Escape dismisses modals/overlays app-wide — voice it as a de-key, but
  // only when something dismissable is actually open (a dialog or a
  // full-screen overlay), so bare Escape presses in a grid stay silent.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.repeat) return;
      if (document.querySelector(DIALOG_SELECTOR)) playUiClose();
    },
    { capture: true, passive: true }
  );

  // Key-up on every dialog/overlay mount, app-wide. Observing childList on
  // body is cheap (no attribute/characterData churn) and the matches()
  // check only runs on added element nodes.
  try {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(DIALOG_SELECTOR) || node.querySelector(DIALOG_SELECTOR)) {
            playUiOpen();
            return;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  } catch { /* observer unavailable — opens stay silent */ }
};
