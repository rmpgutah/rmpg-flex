import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'rmpg.mapv2.layerPresets';

export interface LayerPreset {
  name: string;
  /** Map of layer key → visible boolean. Includes only layers that are
   *  currently in the panel; missing keys default to whatever the page
   *  initializes them as. */
  visibility: Record<string, boolean>;
  /** Optional sub-settings (heatmap days, breadcrumb hours, etc.) */
  settings?: Record<string, string | number>;
}

type PresetStore = LayerPreset[];

function read(): PresetStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(presets: PresetStore) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch { /* quota / private mode */ }
}

/**
 * localStorage-backed layer-visibility presets for /map-v2.
 *
 * Stores up to 8 named presets (Patrol View, Investigations, Incidents
 * Today, etc). save() captures the current visibility map; apply()
 * updates each toggle in turn via the supplied setters; remove() drops
 * by name.
 *
 * Settings (heatmap days, breadcrumb hours, etc) are an optional second
 * field — callers can include them via the save() options arg.
 */
export function useLayerPresets() {
  const [presets, setPresets] = useState<PresetStore>(() => read());

  useEffect(() => { write(presets); }, [presets]);

  const save = useCallback((name: string, visibility: Record<string, boolean>, settings?: Record<string, string | number>) => {
    if (!name.trim()) return;
    setPresets((prev) => {
      const next = prev.filter((p) => p.name !== name.trim());
      next.push({ name: name.trim(), visibility, settings });
      // Cap to 8 named presets — drop oldest if we'd exceed
      while (next.length > 8) next.shift();
      return next;
    });
  }, []);

  const remove = useCallback((name: string) => {
    setPresets((prev) => prev.filter((p) => p.name !== name));
  }, []);

  return { presets, save, remove };
}
