// ============================================================
// RMPG Flex — Drive-Mode HUD · throttled nav tone
// ============================================================
// Self-contained (drive-lane only) tone helper for HUD alerts (over-limit, etc).
// Synthesizes a short two-pip beep via the Web Audio API so it has NO dependency
// on any other lane's tone module. Gated by an `enabled` flag and throttled by a
// cooldown so it never chatters. Best-effort — silent if Web Audio is blocked.
// ============================================================

let lastToneAt = 0;
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
    return ctx;
  } catch { return null; }
}

/**
 * Play a single throttled alert tone.
 * @param enabled  gate (the HUD's alerts/mute flag) — false = no sound
 * @param cooldownMs minimum gap between tones (proximity-cooldown path)
 * @param freq base frequency in Hz
 */
export function playNavTone(enabled: boolean, cooldownMs = 4000, freq = 880): void {
  if (!enabled) return;
  const now = Date.now();
  if (now - lastToneAt < cooldownMs) return;
  lastToneAt = now;
  const ac = getCtx();
  if (!ac) return;
  try {
    const t0 = ac.currentTime;
    const beep = (start: number, f: number) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'square';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.connect(gain).connect(ac.destination);
      osc.start(start);
      osc.stop(start + 0.16);
    };
    beep(t0, freq);
    beep(t0 + 0.18, freq * 1.33);
  } catch { /* audio blocked — best-effort */ }
}
