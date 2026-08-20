import { describe, it, expect, vi, beforeEach } from 'vitest';

const playSoundAssetMock = vi.fn();
vi.mock('./soundAssets', () => ({ playSoundAsset: (...args: unknown[]) => playSoundAssetMock(...args) }));

import { setDesktopSoundEnabled } from './desktopSoundPreference';
import { playDesktopSound } from './desktopSounds';

describe('playDesktopSound', () => {
  beforeEach(() => {
    localStorage.clear();
    playSoundAssetMock.mockClear();
  });

  it('calls playSoundAsset("click") when desktop sound is enabled', () => {
    setDesktopSoundEnabled(true);
    playDesktopSound();
    expect(playSoundAssetMock).toHaveBeenCalledWith('click');
  });

  it('does not call playSoundAsset when desktop sound is disabled', () => {
    setDesktopSoundEnabled(false);
    playDesktopSound();
    expect(playSoundAssetMock).not.toHaveBeenCalled();
  });
});
