// ============================================================
// RMPG Flex — Reactive Settings Bus
//
// A tiny pub/sub layer that makes user preferences apply DYNAMICALLY
// across the whole app — no page reload — and propagate to other open
// browser tabs.
//
// Settings live in localStorage (read at point-of-use by voice/tones,
// or into React state by the map). A plain localStorage write is
// invisible to React, so every preference setter calls
// emitSettingsChange(domain); consumers subscribe (or use
// useSettingsRevision) to re-read and re-render. The browser's native
// cross-tab `storage` event is folded in here too, so changes made in
// one tab reach every other tab automatically.
// ============================================================

import { useEffect, useState } from 'react';

export type SettingsDomain = 'map' | 'voice' | 'tones' | 'ptt' | 'all';

const EVENT = 'rmpg-settings-changed';

/** Map a localStorage key (from a cross-tab `storage` event) to a domain. */
function domainForKey(key: string | null): SettingsDomain | null {
  if (!key) return null;
  if (key.startsWith('rmpg_map') || key === 'rmpg_map_prefs') return 'map';
  if (key === 'rmpg-tone-map') return 'tones';
  if (key.startsWith('rmpg-ptt')) return 'ptt';
  if (key.startsWith('rmpg-voice') || key === 'rmpg-alert-min-tier') return 'voice';
  return null;
}

/** Announce that a settings domain changed (call from every pref setter). */
export function emitSettingsChange(domain: SettingsDomain = 'all'): void {
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { domain } }));
  } catch { /* SSR / no window */ }
}

/**
 * Subscribe to settings changes (same-tab custom event + cross-tab storage
 * event). Returns an unsubscribe function. The callback receives the changed
 * domain ('all' when unknown).
 */
export function subscribeSettings(cb: (domain: SettingsDomain) => void): () => void {
  const onCustom = (e: Event) => {
    const d = (e as CustomEvent).detail?.domain as SettingsDomain | undefined;
    cb(d ?? 'all');
  };
  const onStorage = (e: StorageEvent) => {
    const d = domainForKey(e.key);
    if (d) cb(d);
  };
  window.addEventListener(EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Re-render hook: returns a revision counter that increments whenever a
 * relevant settings domain changes. Pass the domains a component cares about
 * (omit for all). Read your preference values fresh on each render.
 *
 *   const rev = useSettingsRevision(['map']);
 *   const prefs = useMemo(() => getMapPreferences(), [rev]);
 */
export function useSettingsRevision(domains?: SettingsDomain[]): number {
  const [rev, setRev] = useState(0);
  const key = domains ? domains.join(',') : '*';
  useEffect(() => {
    return subscribeSettings((d) => {
      if (!domains || d === 'all' || domains.includes(d)) {
        setRev((r) => r + 1);
      }
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return rev;
}
