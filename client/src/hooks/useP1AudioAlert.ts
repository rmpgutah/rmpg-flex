// ============================================================
// RMPG Flex — useP1AudioAlert
// Plays a short two-tone chirp when a new P1 (priority 1) call
// arrives. Paired with useAutoPanToP1 so dispatchers who aren't
// looking at the map still get cued by sound.
//
// Uses the Web Audio API to synthesize the tone — no asset file,
// no CSP headroom needed, instant playback. Browsers require a
// user gesture before AudioContext can emit sound, so the first
// alert after a fresh page load may be silent; after the first
// user interaction (any click), subsequent alerts play fine.
// This is a browser-level restriction we can't work around.
// ============================================================

import { useEffect, useRef } from 'react';

interface CallLike {
  id: string | number;
  priority?: string | null;
  status?: string | null;
}

interface Options {
  enabled?: boolean;
  priorities?: string[];
  ignoreStatuses?: string[];
}

const DEFAULT_PRIORITIES = ['P1', '1'];
const DEFAULT_IGNORE_STATUSES = ['CLEARED', 'CLOSED', 'CANCELED', 'CANCELLED'];

/**
 * Synthesize a two-tone alert chirp on the given AudioContext.
 * Mimics a radio attention tone — first tone slightly higher, second
 * lower, ~180ms total. Avoids the full-on siren sound officers will
 * confuse with an actual emergency vehicle.
 */
function playChirp(ctx: AudioContext) {
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.28; // Keep below startling levels
  master.connect(ctx.destination);

  function tone(freq: number, startOffset: number, duration: number) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    // Short attack + tail so it doesn't click on start/stop
    g.gain.setValueAtTime(0, now + startOffset);
    g.gain.linearRampToValueAtTime(1, now + startOffset + 0.012);
    g.gain.setValueAtTime(1, now + startOffset + duration - 0.025);
    g.gain.linearRampToValueAtTime(0, now + startOffset + duration);
    osc.connect(g);
    g.connect(master);
    osc.start(now + startOffset);
    osc.stop(now + startOffset + duration + 0.02);
  }

  tone(1040, 0.0, 0.08);
  tone(780, 0.11, 0.09);
}

export function useP1AudioAlert(calls: CallLike[], options: Options = {}) {
  const enabled = options.enabled ?? true;
  const priorities = options.priorities ?? DEFAULT_PRIORITIES;
  const ignoreStatuses = options.ignoreStatuses ?? DEFAULT_IGNORE_STATUSES;

  // Track IDs we've already alerted for; seeded on first render with the
  // current call set so existing P1s at page load don't chirp — only new
  // arrivals do.
  const seenIdsRef = useRef<Set<string> | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!enabled) return;

    if (seenIdsRef.current == null) {
      seenIdsRef.current = new Set(calls.map((c) => String(c.id)));
      return;
    }

    const seen = seenIdsRef.current;
    let anyNewP1 = false;
    for (const call of calls) {
      const id = String(call.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const pri = (call.priority || '').toUpperCase();
      if (!priorities.some((p) => p.toUpperCase() === pri)) continue;
      const status = (call.status || '').toUpperCase();
      if (ignoreStatuses.some((s) => s.toUpperCase() === status)) continue;
      anyNewP1 = true;
    }

    if (!anyNewP1) return;

    try {
      // Lazily create the AudioContext on first need — constructing it
      // up front would waste a resource for dispatchers who never see a
      // new P1 this session.
      if (!ctxRef.current) {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        ctxRef.current = new Ctx();
      }
      const ctx = ctxRef.current;
      // If the context is suspended (pre-user-gesture), a resume() call
      // does nothing but doesn't throw. On the second-and-later alerts
      // after any click, the context is running and the chirp plays.
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => { /* ignore */ });
      }
      playChirp(ctx);
    } catch {
      // Web Audio unavailable / denied — silent fallback is fine.
    }
  }, [calls, enabled, priorities, ignoreStatuses]);

  // Close the context on unmount to release audio hardware. Browsers
  // tolerate repeated create-close cycles but eventually throttle; this
  // prevents accumulating suspended contexts across hot-reload cycles.
  useEffect(() => {
    return () => {
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => { /* ignore */ });
        ctxRef.current = null;
      }
    };
  }, []);
}
