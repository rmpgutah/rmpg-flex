import { useEffect, useRef } from 'react';
import { useWebSocket } from '../../../context/WebSocketContext';
import { devWarn } from '../../../utils/devLog';

/**
 * Audio alert on new P1 call broadcasts.
 *
 * Synthesizes a short two-tone urgency beep via the Web Audio API on
 * `dispatch_update` events with action='call_created' AND priority='P1'.
 * No external sound files needed — the audio context generates the
 * waveform on the fly.
 *
 * Defaults off; enabled via opts.enabled. Browsers gate audio behind a
 * user-gesture, so the first beep only plays after the dispatcher has
 * interacted with the page (clicked anywhere). Subsequent beeps work
 * normally.
 */
export function useP1AudioAlert(opts: { enabled: boolean }): void {
  const ctxRef = useRef<AudioContext | null>(null);
  const recentRef = useRef<Set<string>>(new Set());
  const recentOrderRef = useRef<string[]>([]);
  const { subscribe } = useWebSocket();

  function getCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (ctxRef.current) return ctxRef.current;
    try {
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      ctxRef.current = new Ctor();
      return ctxRef.current;
    } catch {
      return null;
    }
  }

  function beep(freq: number, durationMs: number, startOffsetMs: number) {
    const ctx = getCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + startOffsetMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    // Quick attack/release to avoid pop
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.18, t0 + 0.01);
    gain.gain.linearRampToValueAtTime(0.18, t0 + (durationMs - 30) / 1000);
    gain.gain.linearRampToValueAtTime(0, t0 + durationMs / 1000);
    osc.start(t0);
    osc.stop(t0 + durationMs / 1000);
  }

  useEffect(() => {
    if (!opts.enabled) return;

    const handler = (msg: any) => {
      const data = msg.data || msg;
      if (data?.action !== 'call_created') return;
      const call = data.call;
      if (!call || call.priority !== 'P1') return;
      const id = String(call.id);
      if (recentRef.current.has(id)) return;
      recentRef.current.add(id);
      recentOrderRef.current.push(id);
      if (recentOrderRef.current.length > 50) {
        const old = recentOrderRef.current.shift();
        if (old) recentRef.current.delete(old);
      }
      try {
        // Two-tone urgency beep: 880Hz then 660Hz
        beep(880, 180, 0);
        beep(660, 180, 220);
      } catch (err) {
        devWarn('[map-v2] P1 audio alert failed:', err);
      }
    };

    const unsub = subscribe('dispatch_update', handler);
    return () => {
      unsub();
    };
  }, [opts.enabled, subscribe]);
}
