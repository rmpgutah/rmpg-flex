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
  default_pitch: number;
  default_bearing: number;
  min_pitch: number;
  max_pitch: number;
  scroll_zoom: boolean;
  box_zoom: boolean;
  drag_rotate: boolean;
  drag_pan: boolean;
  double_click_zoom: boolean;
  touch_zoom_rotate: boolean;
  cooperative_gestures: boolean;
  show_compass: boolean;
  show_zoom_controls: boolean;
  keyboard_enabled: boolean;
  language: string;
  render_world_copies: boolean;
  fade_duration: number;
  click_tolerance: number;
  local_ideograph_font_family: string;
  cross_source_collisions: boolean;
  default_visible_layers: string[];
  layer_beat_fill: string;
  layer_beat_fill_opacity: number;
  layer_beat_stroke: string;
  layer_beat_stroke_opacity: number;
  layer_beat_stroke_weight: number;
  layer_beat_min_zoom: number;
  layer_county_fill: string;
  layer_county_fill_opacity: number;
  layer_county_stroke: string;
  layer_county_stroke_opacity: number;
  layer_county_stroke_weight: number;
  layer_county_min_zoom: number;
  layer_municipality_fill: string;
  layer_municipality_fill_opacity: number;
  layer_municipality_stroke: string;
  layer_municipality_stroke_opacity: number;
  layer_municipality_stroke_weight: number;
  layer_municipality_min_zoom: number;
  layer_highway_stroke: string;
  layer_highway_stroke_opacity: number;
  layer_highway_stroke_weight: number;
  layer_state_boundary_stroke: string;
  layer_state_boundary_stroke_opacity: number;
  layer_state_boundary_stroke_weight: number;
  gps_batch_interval_ms: number;
  gps_max_accuracy_meters: number;
  gps_max_speed_ms: number;
  gps_high_accuracy: boolean;
  screenshot_width: number;
  screenshot_height: number;
  screenshot_style: string;
  unit_marker_pulse: boolean;
  call_marker_pulse: boolean;
  marker_font_size: number;
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
  default_pitch: 0,
  default_bearing: 0,
  min_pitch: 0,
  max_pitch: 85,
  scroll_zoom: true,
  box_zoom: true,
  drag_rotate: true,
  drag_pan: true,
  double_click_zoom: true,
  touch_zoom_rotate: true,
  cooperative_gestures: false,
  show_compass: true,
  show_zoom_controls: true,
  keyboard_enabled: true,
  language: '',
  render_world_copies: true,
  fade_duration: 300,
  click_tolerance: 3,
  local_ideograph_font_family: '',
  cross_source_collisions: true,
  default_visible_layers: ['county', 'beat'],
  layer_beat_fill: '#22c55e',
  layer_beat_fill_opacity: 0.2,
  layer_beat_stroke: '#22c55e',
  layer_beat_stroke_opacity: 0.6,
  layer_beat_stroke_weight: 1.2,
  layer_beat_min_zoom: 10,
  layer_county_fill: '#141414',
  layer_county_fill_opacity: 0.15,
  layer_county_stroke: '#444444',
  layer_county_stroke_opacity: 0.5,
  layer_county_stroke_weight: 1.5,
  layer_county_min_zoom: 8,
  layer_municipality_fill: '#a855f7',
  layer_municipality_fill_opacity: 0.06,
  layer_municipality_stroke: '#a855f7',
  layer_municipality_stroke_opacity: 0.35,
  layer_municipality_stroke_weight: 1,
  layer_municipality_min_zoom: 9,
  layer_highway_stroke: '#ef4444',
  layer_highway_stroke_opacity: 0.6,
  layer_highway_stroke_weight: 3,
  layer_state_boundary_stroke: '#ffffff',
  layer_state_boundary_stroke_opacity: 0.3,
  layer_state_boundary_stroke_weight: 2,
  gps_batch_interval_ms: 5000,
  gps_max_accuracy_meters: 100,
  gps_max_speed_ms: 80,
  gps_high_accuracy: true,
  screenshot_width: 1280,
  screenshot_height: 720,
  screenshot_style: 'dark',
  unit_marker_pulse: true,
  call_marker_pulse: true,
  marker_font_size: 9,
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
