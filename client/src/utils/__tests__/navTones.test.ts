import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the shared tone engine — we assert wrapper behavior, not audio output.
// vi.mock is hoisted; use vi.hoisted so the mock fn exists before the factory runs.
const { playToneMock } = vi.hoisted(() => ({ playToneMock: vi.fn((_slot?: unknown) => ({ stop: vi.fn() })) }));
vi.mock('../dispatchTones', () => ({
  playTone: (slot: unknown) => playToneMock(slot),
}));

// Fake Web Audio so getGainContext() can build a GainNode we can inspect.
const createdGains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
// Array.prototype.at isn't in this project's TS lib target — use an index helper.
const lastGain = () => createdGains[createdGains.length - 1];
class FakeAudioContext {
  state = 'running';
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  createGain() {
    const node = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    createdGains.push(node);
    return node;
  }
}

beforeEach(() => {
  playToneMock.mockClear();
  createdGains.length = 0;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext =
    FakeAudioContext as unknown as typeof AudioContext;
});

describe('navTones — playNavTone', () => {
  it('default volume 1.0 plays at full loudness (gain 1.0)', async () => {
    const { playNavTone } = await import('../navTones');
    const handle = playNavTone('chirp');
    expect(handle).not.toBeNull();
    expect(playToneMock).toHaveBeenCalledWith('chirp');
    expect(lastGain()?.gain.value).toBe(1);
  });

  it('applies a fractional volume scalar to the GainNode', async () => {
    const { playNavTone } = await import('../navTones');
    playNavTone('alert', 0.4);
    expect(lastGain()?.gain.value).toBeCloseTo(0.4, 5);
    expect(lastGain()?.connect).toHaveBeenCalled();
  });

  it('volume 0 is true mute — engine never invoked, returns null', async () => {
    const { playNavTone } = await import('../navTones');
    const handle = playNavTone('alarm', 0);
    expect(handle).toBeNull();
    expect(playToneMock).not.toHaveBeenCalled();
  });

  it('clamps out-of-range volume to <=1', async () => {
    const { playNavTone } = await import('../navTones');
    playNavTone('warning', 5);
    expect(lastGain()?.gain.value).toBe(1);
  });

  it('stop() tears down both engine handle and gain node', async () => {
    const { playNavTone } = await import('../navTones');
    const handle = playNavTone('chirp', 0.5);
    handle?.stop();
    expect(lastGain()?.disconnect).toHaveBeenCalled();
  });
});
