import { playSoundAsset } from './soundAssets';
import { isDesktopSoundEnabled } from './desktopSoundPreference';

export function playDesktopSound(): void {
  if (!isDesktopSoundEnabled()) return;
  playSoundAsset('click');
}
