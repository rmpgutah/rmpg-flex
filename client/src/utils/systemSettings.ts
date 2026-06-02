// ============================================================
// RMPG Flex — System Settings bridge (Console Settings → the app)
// ============================================================
// Console Settings (Admin → Console Settings) edits the org-wide
// `system_settings` table. Historically NOTHING read those 458 rows,
// so the whole panel was a facade. This module is the consumption
// layer: it pulls the effective map once per session from
// GET /api/settings ({ system }) and exposes it three ways —
//
//   getSystemSetting(key, fallback)     — module-level, for non-React
//   getBoolSetting / getNumSetting      — typed convenience getters
//   useSystemSetting(key, fallback)     — React hook (re-renders on load)
//
// On load it also applies the org-level Display settings to the document
// root (applyDisplaySettings). Branding/localization/report settings are
// consumed at their own call sites (brandConfig, dateUtils, pdfGenerator).
// ============================================================

import { useEffect, useReducer } from 'react';
import { apiFetch } from '../hooks/useApi';

let cache: Record<string, string> = {};
let loaded = false;
const subscribers = new Set<() => void>();

/** Pull the effective system-settings map. Safe to call repeatedly. */
export async function loadSystemSettings(): Promise<Record<string, string>> {
  try {
    const res = await apiFetch<{ system?: Record<string, string> }>('/settings');
    cache = res?.system ?? {};
  } catch {
    // Soft-fail: keep whatever we have; call sites use fallbacks.
  } finally {
    loaded = true;
    applyDisplaySettings();
    subscribers.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  }
  return cache;
}

export function isSystemSettingsLoaded(): boolean { return loaded; }

export function getSystemSetting(key: string, fallback = ''): string {
  const v = cache[key];
  return v == null || v === '' ? fallback : v;
}

export function getBoolSetting(key: string, fallback = false): boolean {
  const v = cache[key];
  if (v == null) return fallback;
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

export function getNumSetting(key: string, fallback: number): number {
  const n = Number(cache[key]);
  return Number.isFinite(n) ? n : fallback;
}

export function subscribeSystemSettings(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** React hook — returns the current value and re-renders when settings load. */
export function useSystemSetting(key: string, fallback = ''): string {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeSystemSettings(force), []);
  return getSystemSetting(key, fallback);
}

// ── Display application ─────────────────────────────────────
// Applies org-level Display & Theme settings that have no competing
// per-user mechanism. Theme + font-scale are intentionally left to the
// existing user-preference system to avoid precedence fights.
export function applyDisplaySettings(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const cls = (name: string, on: boolean) => root.classList.toggle(name, on);

  // Effect toggles (default ON unless explicitly disabled).
  cls('crt-off', !getBoolSetting('enable_crt_effects', true));
  cls('no-animations', !getBoolSetting('enable_animations', true) || getBoolSetting('reduced_motion', false));
  cls('high-contrast', getBoolSetting('high_contrast_mode', false));
  cls('amber-phosphor', getBoolSetting('amber_phosphor_mode', false));
  cls('green-phosphor', getBoolSetting('green_phosphor_mode', false));
  cls('hide-grid-lines', !getBoolSetting('show_grid_lines', true));
  cls('hide-status-bar', !getBoolSetting('status_bar_visible', true));

  // CRT intensities → CSS custom properties consumed by index.css.
  // Values are 0..100 in settings; normalize to the alpha ranges the
  // overlay uses.
  const scan = clamp01(getNumSetting('scanline_intensity', 16) / 100);
  const vig = clamp01(getNumSetting('vignette_intensity', 45) / 100);
  root.style.setProperty('--crt-scanline-alpha', String(scan));
  root.style.setProperty('--crt-vignette-alpha', String(vig));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
