// Ring / ringback cadence gates and lifecycle. jsdom has no Web Audio, so a
// recording mock stands in for AudioContext — the assertions are about WHEN
// bursts are scheduled and that every burst is torn down, not about sound.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface FakeOsc {
  type: string;
  frequency: { value: number };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const oscillators: FakeOsc[] = [];

function installAudioContext() {
  oscillators.length = 0;
  class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    resume = vi.fn();
    close = vi.fn();
    createOscillator(): FakeOsc {
      const osc: FakeOsc = {
        type: 'sine',
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    }
    createGain() {
      return {
        gain: {
          value: 0,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          cancelScheduledValues: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
}

async function loadModule() {
  vi.resetModules();
  return await import('./callTones');
}

describe('callTones', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    installAudioContext();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  });

  it('defaults to enabled and persists the toggle', async () => {
    const m = await loadModule();
    expect(m.isCallToneEnabled()).toBe(true);
    m.setCallToneEnabled(false);
    expect(m.isCallToneEnabled()).toBe(false);
    m.setCallToneEnabled(true);
    expect(m.isCallToneEnabled()).toBe(true);
  });

  it('rings immediately and repeats on the ring cadence', async () => {
    const m = await loadModule();
    m.setCallTone('ring');
    // Two oscillators per burst (the 440/480 Hz pair).
    expect(oscillators).toHaveLength(2);
    vi.advanceTimersByTime(m.RING_PERIOD_MS);
    expect(oscillators).toHaveLength(4);
    vi.advanceTimersByTime(m.RING_PERIOD_MS);
    expect(oscillators).toHaveLength(6);
    m.stopCallTones();
  });

  it('uses the slower ringback cadence for an outbound call', async () => {
    const m = await loadModule();
    expect(m.RINGBACK_PERIOD_MS).toBeGreaterThan(m.RING_PERIOD_MS);
    m.setCallTone('ringback');
    expect(oscillators).toHaveLength(2);
    vi.advanceTimersByTime(m.RING_PERIOD_MS);
    expect(oscillators).toHaveLength(2); // not yet — ringback is slower
    vi.advanceTimersByTime(m.RINGBACK_PERIOD_MS - m.RING_PERIOD_MS);
    expect(oscillators).toHaveLength(4);
    m.stopCallTones();
  });

  it('is idempotent — re-asserting the same mode does not stack cadences', async () => {
    const m = await loadModule();
    m.setCallTone('ring');
    m.setCallTone('ring');
    m.setCallTone('ring');
    expect(oscillators).toHaveLength(2);
    vi.advanceTimersByTime(m.RING_PERIOD_MS);
    expect(oscillators).toHaveLength(4); // one cadence, not three
    m.stopCallTones();
  });

  it('switches cleanly from ringback to ring', async () => {
    const m = await loadModule();
    m.setCallTone('ringback');
    const ringback = [...oscillators];
    m.setCallTone('ring');
    // The in-flight ringback burst is torn down, and the new cadence is the
    // ring one — not both running at once.
    expect(ringback.every((o) => o.disconnect.mock.calls.length > 0)).toBe(true);
    expect(oscillators).toHaveLength(4);
    vi.advanceTimersByTime(m.RING_PERIOD_MS);
    expect(oscillators).toHaveLength(6);
    m.stopCallTones();
  });

  it('tears down every oscillator and clears the cadence on stop', async () => {
    const m = await loadModule();
    m.setCallTone('ring');
    m.setCallTone(null);
    expect(oscillators.every((o) => o.disconnect.mock.calls.length > 0)).toBe(true);
    const count = oscillators.length;
    vi.advanceTimersByTime(m.RING_PERIOD_MS * 3);
    expect(oscillators).toHaveLength(count); // cadence really cleared
  });

  it('stays silent under the global mute', async () => {
    localStorage.setItem('rmpg-sound', 'false');
    const m = await loadModule();
    m.setCallTone('ring');
    expect(oscillators).toHaveLength(0);
  });

  it('stays silent when call tones are switched off', async () => {
    const m = await loadModule();
    m.setCallToneEnabled(false);
    m.setCallTone('ring');
    expect(oscillators).toHaveLength(0);
  });

  it('does not throw when Web Audio is unavailable', async () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    const m = await loadModule();
    expect(() => m.setCallTone('ring')).not.toThrow();
    expect(() => m.stopCallTones()).not.toThrow();
  });
});
