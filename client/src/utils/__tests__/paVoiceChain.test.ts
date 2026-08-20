// The alert voice is harmonia through a "station PA" chain instead of the
// P25 radio haze. Asserts the filter topology, because the whole point of
// the separation is that it does NOT sound like radio traffic.
import { describe, it, expect, vi } from 'vitest';
import { buildPaVoiceChain } from '../radioProcessor';

function mockCtx() {
  const filters: any[] = [];
  const shapers: any[] = [];
  const gains: any[] = [];
  const ctx: any = {
    sampleRate: 48000,
    createBiquadFilter: vi.fn(() => {
      const f = { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, connect: vi.fn() };
      filters.push(f);
      return f;
    }),
    createWaveShaper: vi.fn(() => {
      const s = { curve: null as Float32Array | null, oversample: '', connect: vi.fn() };
      shapers.push(s);
      return s;
    }),
    createGain: vi.fn(() => {
      const g = { gain: { value: 1 }, connect: vi.fn() };
      gains.push(g);
      return g;
    }),
  };
  return { ctx, filters, shapers, gains };
}

describe('buildPaVoiceChain', () => {
  it('returns an input and output node', () => {
    const { ctx } = mockCtx();
    const chain = buildPaVoiceChain(ctx);
    expect(chain.input).toBeTruthy();
    expect(chain.output).toBeTruthy();
  });

  it('bandlimits to a horn speaker: 420 Hz highpass, 3100 Hz lowpass', () => {
    const { ctx, filters } = mockCtx();
    buildPaVoiceChain(ctx);
    const hp = filters.find((f) => f.type === 'highpass');
    const lp = filters.find((f) => f.type === 'lowpass');
    expect(hp?.frequency.value).toBe(420);
    expect(lp?.frequency.value).toBe(3100);
  });

  it('boosts 1.6 kHz presence and notches the 900 Hz horn honk', () => {
    const { ctx, filters } = mockCtx();
    buildPaVoiceChain(ctx);
    const peaks = filters.filter((f) => f.type === 'peaking');
    const presence = peaks.find((f) => f.frequency.value === 1600);
    const notch = peaks.find((f) => f.frequency.value === 900);
    expect(presence?.gain.value).toBeCloseTo(6.5, 1);
    expect(notch?.gain.value).toBeCloseTo(-4, 1);
  });

  it('applies a soft-clip drive curve', () => {
    const { ctx, shapers } = mockCtx();
    buildPaVoiceChain(ctx);
    expect(shapers.length).toBe(1);
    const curve = shapers[0].curve!;
    expect(curve.length).toBeGreaterThan(64);
    // tanh-shaped: bounded, compressive at the extremes, symmetric-ish
    expect(curve[0]).toBeLessThan(0);
    expect(curve[curve.length - 1]).toBeGreaterThan(0);
    expect(curve[curve.length - 1]).toBeLessThan(1);
  });

  it('trims level, because soft clipping raises perceived loudness', () => {
    const { ctx, gains } = mockCtx();
    buildPaVoiceChain(ctx);
    expect(gains.length).toBe(1);
    expect(gains[0].gain.value).toBeLessThan(1);
  });

  it('does NOT bandlimit to the P25 300-3400 band — that is the radio chain', () => {
    const { ctx, filters } = mockCtx();
    buildPaVoiceChain(ctx);
    expect(filters.some((f) => f.type === 'highpass' && f.frequency.value === 300)).toBe(false);
    expect(filters.some((f) => f.type === 'lowpass' && f.frequency.value === 3400)).toBe(false);
  });
});

describe('VoiceMode', () => {
  it('includes alert_pa', async () => {
    const mod = await import('../edgeTTS');
    const mode: import('../edgeTTS').VoiceMode = 'alert_pa';
    expect(mode).toBe('alert_pa');
    expect(typeof mod.speak).toBe('function');
  });
});
