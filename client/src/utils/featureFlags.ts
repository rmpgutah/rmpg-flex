// ============================================================
// RMPG Flex — Feature-flag bridge (Admin System Config → nav)
// ============================================================
// The 4 Feature Toggles (Warrants/Fleet/Evidence/Patrol QR) are saved via
// PUT /admin/system-settings into system_config, but that read-back endpoint
// is deliberately admin/manager-only (it shares a table with plaintext
// third-party secrets). This module instead pulls from the narrow
// GET /api/feature-flags endpoint, open to every authenticated role, and
// mirrors systemSettings.ts's cache/hook pattern so nav components can read
// synchronously and re-render once the load completes.
// ============================================================

import { useEffect, useReducer } from 'react';
import { apiFetch } from '../hooks/useApi';

// path → system_config key. BOLOs is intentionally absent — it has no single
// nav entry and is out of scope for this module (see the Phase 2 plan).
const PATH_TO_FLAG_KEY: Record<string, string> = {
  '/warrants': 'feature_warrants',
  '/fleet': 'feature_fleet',
  '/evidence': 'feature_evidence',
  '/patrol': 'feature_patrol_checkpoints',
};

let cache: Record<string, boolean> = {};
let loaded = false;
const subscribers = new Set<() => void>();

export async function loadFeatureFlags(): Promise<Record<string, boolean>> {
  try {
    const res = await apiFetch<Record<string, boolean>>('/feature-flags');
    cache = res ?? {};
  } catch {
    // Soft-fail: keep whatever we have (or the fail-open default) — a
    // network hiccup must never hide a nav item a user is entitled to see.
  } finally {
    loaded = true;
    subscribers.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  }
  return cache;
}

export function isFeatureEnabled(path: string): boolean {
  const key = PATH_TO_FLAG_KEY[path];
  if (!key) return true; // unmapped path — not one of the 4 toggled features
  const v = cache[key];
  return v == null ? true : v; // fail-open until loaded, or if the key is absent
}

export function isFeatureFlagsLoaded(): boolean { return loaded; }

// React hook — returns an incrementing tick so components reading flags
// inside a useMemo/useCallback dependency array see a value that actually
// CHANGES on reload (a plain re-render-only signal isn't enough to force
// recomputation there).
export function useFeatureFlags(): number {
  const [tick, forceRender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const fn = () => forceRender();
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);
  return tick;
}
