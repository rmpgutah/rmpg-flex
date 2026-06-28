// Tests the gates around UI click ticks — toggle, silent mode, throttle,
// interactive-target filtering. Clicks are SAMPLE-ONLY: the module plays
// the click.wav asset via soundAssets and must build no oscillator
// fallback (an asset miss is intentional silence). The asset layer is
// mocked; the module is re-imported per test so throttle state can't leak.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const playSoundAsset = vi.fn();
vi.mock('../soundAssets', () => ({
  playSoundAsset: (...args: unknown[]) => playSoundAsset(...args),
}));

async function loadModule() {
  vi.resetModules();
  return await import('../uiClickSounds');
}

describe('uiClickSounds', () => {
  beforeEach(() => {
    localStorage.clear();
    playSoundAsset.mockReset();
    playSoundAsset.mockReturnValue(true);
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    delete (window as any).AudioContext;
  });

  it('defaults to enabled and persists the toggle', async () => {
    const m = await loadModule();
    expect(m.clickSoundsEnabled()).toBe(true);
    m.setClickSoundsEnabled(false);
    expect(m.clickSoundsEnabled()).toBe(false);
    m.setClickSoundsEnabled(true);
    expect(m.clickSoundsEnabled()).toBe(true);
  });

  it('plays the sampled click when enabled and audible', async () => {
    const m = await loadModule();
    m.playUiClick();
    expect(playSoundAsset).toHaveBeenCalledTimes(1);
    expect(playSoundAsset).toHaveBeenCalledWith('click');
  });

  it('stays silent (no synth fallback) when the asset is not ready', async () => {
    const ctor = vi.fn();
    (window as any).AudioContext = ctor;
    playSoundAsset.mockReturnValue(false); // asset miss
    const m = await loadModule();
    m.playUiClick();
    expect(playSoundAsset).toHaveBeenCalledTimes(1);
    expect(ctor).not.toHaveBeenCalled(); // no oscillator graph, ever
  });

  it('throttles rapid ticks', async () => {
    const m = await loadModule();
    m.playUiClick();
    m.playUiClick(); // within 35ms throttle
    expect(playSoundAsset).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000_200); // past throttle
    m.playUiClick();
    expect(playSoundAsset).toHaveBeenCalledTimes(2);
  });

  it('is silent when toggled off or in silent audio mode', async () => {
    const m = await loadModule();

    m.setClickSoundsEnabled(false);
    m.playUiClick();
    expect(playSoundAsset).not.toHaveBeenCalled();

    m.setClickSoundsEnabled(true);
    localStorage.setItem('rmpg_unit_audio_mode', 'silent');
    m.playUiClick();
    expect(playSoundAsset).not.toHaveBeenCalled();
  });

  it('document listener ticks for buttons but not plain divs', async () => {
    const m = await loadModule();
    m.initUiClickSounds();

    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(playSoundAsset).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_000_500);
    const div = document.createElement('div');
    document.body.appendChild(div);
    div.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(playSoundAsset).toHaveBeenCalledTimes(1); // unchanged

    btn.remove();
    div.remove();
  });
});
