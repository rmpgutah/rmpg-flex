// Tests the gates around the login chime — silent mode and debounce.
// WebAudio itself can't run in jsdom, so AudioContext is mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { playStartupSound } from '../startupSound';

function mockAudioContext() {
  const node = { connect: vi.fn(), gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, frequency: { value: 0 }, type: '', start: vi.fn(), stop: vi.fn() };
  const ctor = vi.fn().mockImplementation(() => ({
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    createGain: vi.fn(() => ({ ...node })),
    createBiquadFilter: vi.fn(() => ({ ...node, type: 'lowpass', frequency: { value: 0 } })),
    createOscillator: vi.fn(() => ({ ...node })),
  }));
  (window as any).AudioContext = ctor;
  return ctor;
}

describe('playStartupSound', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('plays in audible mode', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000); // past any debounce from other tests
    const ctor = mockAudioContext();
    playStartupSound();
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it('debounces a second call within 3s', () => {
    const ctor = mockAudioContext();
    playStartupSound(); // may or may not fire depending on prior test clock — capture count
    const after = ctor.mock.calls.length;
    playStartupSound();
    expect(ctor.mock.calls.length).toBe(after); // no additional construction
  });

  it('is silent in silent audio mode', () => {
    vi.useFakeTimers();
    vi.setSystemTime(9_000_000);
    localStorage.setItem('rmpg_unit_audio_mode', 'silent');
    const ctor = mockAudioContext();
    playStartupSound();
    expect(ctor).not.toHaveBeenCalled();
  });

  it('never throws when AudioContext is missing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000_000);
    delete (window as any).AudioContext;
    expect(() => playStartupSound()).not.toThrow();
  });
});
