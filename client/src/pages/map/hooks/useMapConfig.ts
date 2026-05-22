import { useState, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';

export interface MapSettings {
  default_center_lat: number;
  default_center_lng: number;
  default_zoom: number;
  min_zoom: number;
  max_zoom: number;
  default_style: string;
  enabled_styles: string[];
  show_attribution: boolean;
  rotation_enabled: boolean;
  max_bounds_sw_lat: number | null;
  max_bounds_sw_lng: number | null;
  max_bounds_ne_lat: number | null;
  max_bounds_ne_lng: number | null;
  custom_style_url: string;
  clustering_enabled: boolean;
  cluster_radius: number;
  cluster_max_zoom: number;
}

const DEFAULT_MAP_SETTINGS: MapSettings = {
  default_center_lat: 40.7608,
  default_center_lng: -111.891,
  default_zoom: 12,
  min_zoom: 1,
  max_zoom: 22,
  default_style: 'dark',
  enabled_styles: ['dark', 'night_nav', 'satellite', 'streets', 'terrain', 'light'],
  show_attribution: false,
  rotation_enabled: false,
  max_bounds_sw_lat: null,
  max_bounds_sw_lng: null,
  max_bounds_ne_lat: null,
  max_bounds_ne_lng: null,
  custom_style_url: '',
  clustering_enabled: true,
  cluster_radius: 50,
  cluster_max_zoom: 14,
};

let cachedConfig: MapSettings | null = null;
let fetchPromise: Promise<MapSettings> | null = null;

export async function fetchMapConfig(): Promise<MapSettings> {
  if (cachedConfig) return cachedConfig;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const data = await apiFetch<MapSettings>('/admin/map-config');
      cachedConfig = { ...DEFAULT_MAP_SETTINGS, ...data };
      return cachedConfig;
    } catch {
      cachedConfig = { ...DEFAULT_MAP_SETTINGS };
      return cachedConfig;
    }
  })();

  return fetchPromise;
}

export function useMapConfig(): MapSettings {
  const [config, setConfig] = useState<MapSettings>(DEFAULT_MAP_SETTINGS);

  useEffect(() => {
    fetchMapConfig().then(setConfig);
  }, []);

  return config;
}

export function invalidateMapConfigCache(): void {
  cachedConfig = null;
  fetchPromise = null;
}
