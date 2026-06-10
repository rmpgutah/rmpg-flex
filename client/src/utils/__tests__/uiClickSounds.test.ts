// Tests the gates around UI click ticks — toggle, silent mode,
// throttle, interactive-target filtering. WebAudio is mocked (jsdom
// has none) and the module is re-imported per test so its shared
// AudioContext / throttle state can't leak between cases.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the synth fallback path — the sampled-asset layer is tested
// separately (it would otherwise create its own AudioContext and
// fetch WAVs, neither of which exist in jsdom).
vi.mock('../soundAssets', () => ({
  playSoundAsset: vi.fn(() => false),
  preloadSoundAssets: vi.fn(),
}));

function mockAudioContext() {
  const node = () => ({
    connect: vi.fn(),
    gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    Q: { value: 0 },
    type: '',
    start: vi.fn(),
    stop: vi.fn(),
  });
  const instances: any[] = [];
  const ctor = vi.fn().mockImplementation(function (this: unknown) {
    const inst = {
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn(),
      close: vi.fn(),
      createGain: vi.fn(node),
      createBiquadFilter: vi.fn(node),
      createOscillator: vi.fn(node),
    };
    instances.push(inst);
    return inst;
  });
  (window as any).AudioContext = ctor;
  return { ctor, instances };
}

async function loadModule() {
  vi.resetModules();
  return await import('../uiClickSounds');
}

describe('uiClickSounds', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  it('defaults to enabled and persists the toggle', async () => {
    const m = await loadModule();
    expect(m.clickSoundsEnabled()).toBe(true);
    m.setClickSoundsEnabled(false);
    expect(m.clickSoundsEnabled()).toBe(false);
    m.setClickSoundsEnabled(true);
    expect(m.clickSoundsEnabled()).toBe(true);
  });

  it('ticks when enabled and audible', async () => {
    const { ctor } = mockAudioContext();
    const m = await loadModule();
    m.playUiClick();
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  it('reuses one shared AudioContext and throttles rapid ticks', async () => {
    const { ctor, instances } = mockAudioContext();
    const m = await loadModule();

    m.playUiClick();
    expect(ctor).toHaveBeenCalledTimes(1);
    const oscAfterFirst = instances[0].createOscillator.mock.calls.length;

    m.playUiClick(); // within 35ms throttle — no new oscillator
    expect(instances[0].createOscillator.mock.calls.length).toBe(oscAfterFirst);

    vi.setSystemTime(1_000_200); // past throttle
    m.playUiClick();
    expect(ctor).toHaveBeenCalledTimes(1); // context reused, not rebuilt
    expect(instances[0].createOscillator.mock.calls.length).toBeGreaterThan(oscAfterFirst);
  });

  it('is silent when toggled off or in silent audio mode', async () => {
    const { ctor } = mockAudioContext();
    const m = await loadModule();

    m.setClickSoundsEnabled(false);
    m.playUiClick();
    expect(ctor).not.toHaveBeenCalled();

    m.setClickSoundsEnabled(true);
    localStorage.setItem('rmpg_unit_audio_mode', 'silent');
    m.playUiClick();
    expect(ctor).not.toHaveBeenCalled();
  });

  it('document listener ticks for buttons but not plain divs', async () => {
    const { ctor } = mockAudioContext();
    const m = await loadModule();
    m.initUiClickSounds();

    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(ctor).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000_500);
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(ctor).toHaveBeenCalledTimes(1); // unchanged

    btn.remove();
    div.remove();
  });
});
