// Tests the sampled-sound asset layer: lazy load + decode, synth-fallback
// signalling (returns false until decoded / on failure), buffer replay on
// one shared AudioContext. fetch + WebAudio are mocked (jsdom has neither).
import { describe, it, expect, vi, beforeEach } from 'vitest';

function mockAudioContext(decodeOk = true) {
  const sources: any[] = [];
  const ctor = vi.fn().mockImplementation(function (this: unknown) {
    return {
      state: 'running',
      destination: {},
      resume: vi.fn(),
      decodeAudioData: decodeOk
        ? vi.fn().mockResolvedValue({ duration: 0.1 })
        : vi.fn().mockRejectedValue(new Error('bad data')),
      currentTime: 0,
      createBufferSource: vi.fn(() => {
        const src = { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
        sources.push(src);
        return src;
      }),
      createGain: vi.fn(() => ({ gain: { value: 0, setValueAtTime: vi.fn() }, connect: vi.fn() })),
    };
  });
  (window as any).AudioContext = ctor;
  return { ctor, sources };
}

async function loadModule() {
  vi.resetModules();
  return await import('../soundAssets');
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('soundAssets', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false before decode, then plays the buffer once loaded', async () => {
    const { ctor, sources } = mockAudioContext();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }) as any;
    const m = await loadModule();

    expect(m.playSoundAsset('click')).toBe(false); // triggers lazy load
    await flush(); await flush();

    expect(m.playSoundAsset('click')).toBe(true);
    expect(sources.length).toBe(1);
    expect(sources[0].start).toHaveBeenCalled();
    expect(ctor).toHaveBeenCalledTimes(1); // one shared context
  });

  it('falls back permanently when the asset 404s', async () => {
    mockAudioContext();
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
    const m = await loadModule();

    expect(m.playSoundAsset('login')).toBe(false);
    await flush(); await flush();
    expect(m.playSoundAsset('login')).toBe(false);
    expect((global.fetch as any).mock.calls.length).toBe(1); // failure cached, no refetch loop
  });

  it('preloadSoundAssets fetches each asset once', async () => {
    mockAudioContext();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }) as any;
    const m = await loadModule();

    m.preloadSoundAssets();
    m.preloadSoundAssets(); // idempotent
    await flush();
    expect((global.fetch as any).mock.calls.map((c: any[]) => c[0]).sort()).toEqual([
      '/sounds/click.wav', '/sounds/delete.wav', '/sounds/login.wav', '/sounds/submit.wav', '/sounds/update.wav',
    ]);
  });

  it('startSoundAsset returns a working stop handle once decoded', async () => {
    const { sources } = mockAudioContext();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }) as any;
    const m = await loadModule();

    expect(m.startSoundAsset('alarm', 0.32)).toBeNull(); // not decoded yet → synth fallback
    await flush(); await flush();

    const handle = m.startSoundAsset('alarm', 0.32);
    expect(handle).not.toBeNull();
    expect(sources[0].start).toHaveBeenCalled();
    handle!.stop();
    expect(sources[0].stop).toHaveBeenCalled();
  });

  it('never throws when fetch or WebAudio are unavailable', async () => {
    delete (window as any).AudioContext;
    delete (global as any).fetch;
    const m = await loadModule();
    expect(() => m.preloadSoundAssets()).not.toThrow();
    expect(m.playSoundAsset('submit')).toBe(false);
  });
});
