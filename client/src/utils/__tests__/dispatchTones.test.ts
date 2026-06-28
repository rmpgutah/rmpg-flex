// Tests the sampled-asset integration in the dispatch tone library:
// playSound is asset-first (returns the sample's stop handle, builds no
// oscillator graph) and falls back to the synth when no asset is ready.
// Also covers the slot map resolution and the master sound toggle.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const startSoundAsset = vi.fn();
vi.mock('../soundAssets', () => ({
  startSoundAsset: (...args: unknown[]) => startSoundAsset(...args),
}));

function mockAudioContext() {
  const node = () => ({
    connect: vi.fn(),
    gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    Q: { value: 0 }, type: '', buffer: null,
    start: vi.fn(), stop: vi.fn(),
    getChannelData: vi.fn(() => new Float32Array(8)),
  });
  const ctor = vi.fn().mockImplementation(function (this: unknown) {
    return {
      state: 'running', currentTime: 0, destination: {}, sampleRate: 44100,
      resume: vi.fn().mockResolvedValue(undefined),
      createGain: vi.fn(node), createOscillator: vi.fn(node),
      createBiquadFilter: vi.fn(node), createBufferSource: vi.fn(node),
      createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(8) })),
    };
  });
  (window as any).AudioContext = ctor;
  return ctor;
}

async function loadModule() {
  vi.resetModules();
  return await import('../dispatchTones');
}

describe('dispatchTones (sampled assets)', () => {
  beforeEach(() => {
    localStorage.clear();
    startSoundAsset.mockReset();
  });

  it('plays the sampled asset first and returns its stop handle', async () => {
    const ctor = mockAudioContext();
    const handle = { stop: vi.fn() };
    startSoundAsset.mockReturnValue(handle);
    const m = await loadModule();

    const result = m.playSound('alarm');
    expect(startSoundAsset).toHaveBeenCalledWith('alarm', expect.any(Number));
    expect(result).toBe(handle);
    expect(ctor).not.toHaveBeenCalled(); // no oscillator graph built
  });

  it('falls back to the oscillator synth when no asset is ready', async () => {
    const ctor = mockAudioContext();
    startSoundAsset.mockReturnValue(null);
    const m = await loadModule();

    const result = m.playSound('caution');
    expect(result).not.toBeNull();
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it('playTone resolves the user slot map before choosing the asset', async () => {
    mockAudioContext();
    startSoundAsset.mockReturnValue({ stop: vi.fn() });
    const m = await loadModule();

    m.setSlotSound('caution', 'dispatch_bell');
    m.playTone('caution');
    expect(startSoundAsset).toHaveBeenCalledWith('dispatch_bell', expect.any(Number));
  });

  it('is fully silent when the master sound toggle is off', async () => {
    mockAudioContext();
    const m = await loadModule();

    localStorage.setItem('rmpg-sound', 'false');
    expect(m.playSound('alert')).toBeNull();
    expect(startSoundAsset).not.toHaveBeenCalled();
  });
});

describe('notificationTones (Spillman library routing)', () => {
  beforeEach(() => {
    localStorage.clear();
    startSoundAsset.mockReset();
    startSoundAsset.mockReturnValue({ stop: vi.fn() });
  });

  it.each([
    ['critical', 'emergency_three'],
    ['high', 'alert'],
    [undefined, 'info'],
  ])('priority %s plays the %s console sound', async (priority, sound) => {
    mockAudioContext();
    vi.resetModules();
    const n = await import('../notificationTones');
    n.playNotificationTone(priority as string | undefined);
    expect(startSoundAsset).toHaveBeenCalledWith(sound, expect.any(Number));
  });

  it('respects its own enable toggle', async () => {
    mockAudioContext();
    vi.resetModules();
    const n = await import('../notificationTones');
    localStorage.setItem('rmpg_notification_sounds', 'false');
    n.playNotificationTone('critical');
    expect(startSoundAsset).not.toHaveBeenCalled();
  });
});
