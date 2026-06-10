/**
 * Notification sound alerts — voiced from the Spillman Flex / Motorola
 * console library in dispatchTones.ts (sampled WAV assets with synth
 * fallback) so notifications speak the same CAD vocabulary as dispatch:
 *   critical → three-cycle emergency warble
 *   high     → P25 three-pip attention getter
 *   normal   → MDT acknowledge pip
 * Keeps its own enable toggle (rmpg_notification_sounds), independent
 * of the dispatch master toggle the library checks internally.
 */
import { playSound } from './dispatchTones';

export function isNotificationSoundEnabled(): boolean {
  return localStorage.getItem('rmpg_notification_sounds') !== 'false';
}

export function playNotificationTone(priority?: string): void {
  if (!isNotificationSoundEnabled()) return;
  try {
    if (priority === 'critical') playSound('emergency_three');
    else if (priority === 'high') playSound('alert');
    else playSound('info');
  } catch { /* audio is a nicety */ }
}
