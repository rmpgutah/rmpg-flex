/**
 * useMapAtmosphere — Mapbox GL JS fog, sky, and atmosphere controls.
 *
 * Adds atmospheric fog, sky gradient, and star effects for immersive
 * 3D map views. Uses Mapbox GL v3 setFog and sky layer features.
 */

import { useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';

export type AtmospherePreset = 'none' | 'dark' | 'dawn' | 'dusk' | 'haze' | 'night';

interface FogConfig {
  color: string;
  highColor: string;
  horizonBlend: number;
  spaceColor: string;
  starIntensity: number;
}

const PRESETS: Record<AtmospherePreset, FogConfig | null> = {
  none: null,
  dark: {
    color: '#0a0a0a',
    highColor: '#111133',
    horizonBlend: 0.06,
    spaceColor: '#000000',
    starIntensity: 0.3,
  },
  dawn: {
    color: '#2a1a0a',
    highColor: '#f97316',
    horizonBlend: 0.12,
    spaceColor: '#0a0a2a',
    starIntensity: 0.15,
  },
  dusk: {
    color: '#1a0a1a',
    highColor: '#a855f7',
    horizonBlend: 0.10,
    spaceColor: '#0a0a1a',
    starIntensity: 0.5,
  },
  haze: {
    color: '#1a1a1a',
    highColor: '#444444',
    horizonBlend: 0.15,
    spaceColor: '#0a0a0a',
    starIntensity: 0.0,
  },
  night: {
    color: '#000005',
    highColor: '#000020',
    horizonBlend: 0.04,
    spaceColor: '#000000',
    starIntensity: 0.8,
  },
};

const PRESET_LABELS: Record<AtmospherePreset, string> = {
  none: 'Off',
  dark: 'Dark',
  dawn: 'Dawn',
  dusk: 'Dusk',
  haze: 'Haze',
  night: 'Night Sky',
};

export function useMapAtmosphere(
  map: mapboxgl.Map | null,
  mapLoaded: boolean,
) {
  const [preset, setPresetState] = useState<AtmospherePreset>('none');

  const setPreset = useCallback((p: AtmospherePreset) => {
    if (!map || !mapLoaded) return;

    const config = PRESETS[p];
    try {
      if (!config) {
        map.setFog(null as any);
      } else {
        map.setFog({
          color: config.color,
          'high-color': config.highColor,
          'horizon-blend': config.horizonBlend,
          'space-color': config.spaceColor,
          'star-intensity': config.starIntensity,
        });
      }
      setPresetState(p);
    } catch (err) {
      console.warn('[Atmosphere] failed:', err);
    }
  }, [map, mapLoaded]);

  const cycle = useCallback(() => {
    const keys = Object.keys(PRESETS) as AtmospherePreset[];
    const idx = keys.indexOf(preset);
    setPreset(keys[(idx + 1) % keys.length]);
  }, [preset, setPreset]);

  return {
    preset,
    enabled: preset !== 'none',
    setPreset,
    cycle,
    presets: Object.keys(PRESETS) as AtmospherePreset[],
    labels: PRESET_LABELS,
  };
}
