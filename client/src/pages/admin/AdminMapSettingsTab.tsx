import React, { useState, useEffect, useCallback } from 'react';
import {
  Map, Save, Loader2, RefreshCw, Globe2,
  Palette, ToggleLeft, ToggleRight,
  Layers, Crosshair, Navigation2,
  Hand, Monitor, Settings2, Type, Cpu,
  Hexagon, Crosshair as CrosshairIcon,
  Satellite,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { invalidateMapConfigCache, type MapSettings } from '../../pages/map/hooks/useMapConfig';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

const STYLE_OPTIONS: { id: string; label: string; desc: string }[] = [
  { id: 'dark', label: 'Dark', desc: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'night_nav', label: 'Night Navigation', desc: 'mapbox://styles/mapbox/navigation-night-v1' },
  { id: 'satellite', label: 'Satellite', desc: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'streets', label: 'Streets', desc: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'terrain', label: 'Terrain', desc: 'mapbox://styles/mapbox/outdoors-v12' },
  { id: 'light', label: 'Light', desc: 'mapbox://styles/mapbox/light-v11' },
];

const LAYER_IDS = ['beat', 'county', 'municipality', 'highway', 'state_boundary', 'place'] as const;

const DEFAULT_VALUES: MapSettings = {
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
  layer_place_fill: '#22c55e',
  layer_place_fill_opacity: 0.7,
  layer_place_stroke: '#22c55e',
  layer_place_stroke_opacity: 0.9,
  layer_place_stroke_weight: 1,
  layer_place_min_zoom: 10,
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

export default function AdminMapSettingsTab({ LoadingSpinner, error, setError }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<MapSettings>(DEFAULT_VALUES);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    document.title = 'Admin - Map Settings \u2014 RMPG Flex';
  }, []);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<MapSettings>('/admin/map-config');
      setSettings(prev => ({ ...DEFAULT_VALUES, ...prev, ...data }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load map settings');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateField = <K extends keyof MapSettings>(key: K, value: MapSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const toggleStyle = (styleId: string) => {
    setSettings(prev => {
      const enabled = prev.enabled_styles.includes(styleId)
        ? prev.enabled_styles.filter(s => s !== styleId)
        : [...prev.enabled_styles, styleId];
      return { ...prev, enabled_styles: enabled };
    });
    setSaved(false);
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await apiFetch('/admin/map-config', {
        method: 'PUT',
        body: JSON.stringify(settings),
      });
      invalidateMapConfigCache();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save map settings');
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    setSettings({ ...DEFAULT_VALUES });
    setSaved(false);
  };

  if (loading) return <LoadingSpinner />;

  const SectionLabel = ({ icon, label }: { icon: React.ElementType; label: string }) => {
    const Icon = icon;
    return (
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 flex items-center justify-center bg-brand-900/30 border border-brand-700/40 shrink-0" aria-hidden="true">
          <Icon className="w-3.5 h-3.5 text-brand-400" />
        </div>
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-rmpg-200">{label}</h3>
      </div>
    );
  };

  const InlineInput = ({ label, value, onChange, type = 'number', step, min, max, suffix }: {
    label: string; value: number | string; onChange: (v: any) => void;
    type?: string; step?: string; min?: string; max?: string; suffix?: string;
  }) => (
    <label className="flex items-center gap-2 text-[10px] text-rmpg-400">
      <span className="w-28 shrink-0">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type={type}
          value={value}
          onChange={e => onChange(type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
          step={step}
          min={min}
          max={max}
          className="input-dark text-[10px] w-24 text-center font-mono min-h-[28px]"
        />
        {suffix && <span className="text-rmpg-500">{suffix}</span>}
      </div>
    </label>
  );

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 flex items-center justify-center bg-brand-900/30 border border-brand-700/40 shrink-0" aria-hidden="true">
            <Map className="w-3.5 h-3.5 text-brand-400" />
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">Map Settings</h2>
            <span className="text-[9px] text-rmpg-500">Administer map appearance and behavior</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={resetToDefaults} className="toolbar-btn text-[10px] flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />
            Reset Defaults
          </button>
          <button type="button" onClick={saveSettings} disabled={saving} className="toolbar-btn-primary text-[10px] flex items-center gap-1">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Saving" /> : <Save className="w-3 h-3" />}
            Save Settings
          </button>
        </div>
      </div>

      {saved && (
        <div className="bg-green-950/30 border border-green-800/40 px-3 py-2 text-[10px] text-green-400 flex items-center gap-2">
          <CheckMini className="w-3.5 h-3.5 text-green-400" />
          Map settings saved successfully
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Default View & Camera */}
        <div className="panel-beveled bg-surface-base p-4 space-y-3">
          <SectionLabel icon={Globe2} label="Default Map View & Camera" />
          <div className="space-y-2">
            <InlineInput label="Center Latitude" value={settings.default_center_lat} onChange={v => updateField('default_center_lat', v)} step="0.0001" min="-90" max="90" />
            <InlineInput label="Center Longitude" value={settings.default_center_lng} onChange={v => updateField('default_center_lng', v)} step="0.0001" min="-180" max="180" />
            <InlineInput label="Default Zoom" value={settings.default_zoom} onChange={v => updateField('default_zoom', v)} min="1" max="22" />
            <InlineInput label="Default Pitch (tilt °)" value={settings.default_pitch} onChange={v => updateField('default_pitch', v)} min="0" max="85" suffix="°" />
            <InlineInput label="Default Bearing (rotation °)" value={settings.default_bearing} onChange={v => updateField('default_bearing', v)} min="0" max="360" suffix="°" />
            <InlineInput label="Min Zoom" value={settings.min_zoom} onChange={v => updateField('min_zoom', v)} min="0" max="22" />
            <InlineInput label="Max Zoom" value={settings.max_zoom} onChange={v => updateField('max_zoom', v)} min="1" max="22" />
            <InlineInput label="Min Pitch (tilt °)" value={settings.min_pitch} onChange={v => updateField('min_pitch', v)} min="0" max="85" suffix="°" />
            <InlineInput label="Max Pitch (tilt °)" value={settings.max_pitch} onChange={v => updateField('max_pitch', v)} min="0" max="85" suffix="°" />
          </div>
        </div>

        {/* Map Styles */}
        <div className="panel-beveled bg-surface-base p-4 space-y-3">
          <SectionLabel icon={Palette} label="Map Styles" />
          <div className="space-y-2">
            <label className="text-[10px] text-rmpg-400 block mb-1">Default Style</label>
            <select
              value={settings.default_style}
              onChange={e => updateField('default_style', e.target.value)}
              className="input-dark text-[10px] w-full min-h-[32px]"
            >
              {STYLE_OPTIONS.map(s => (
                <option key={s.id} value={s.id}>{s.label} — {s.desc}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 block mb-2">Enabled Styles (shown in style picker)</label>
            <div className="grid grid-cols-2 gap-1.5">
              {STYLE_OPTIONS.map(s => {
                const enabled = settings.enabled_styles.includes(s.id);
                return (
                  <button type="button" key={s.id} onClick={() => toggleStyle(s.id)}
                    className={`text-[10px] px-2.5 py-1.5 text-left flex items-center gap-2 transition-colors ${
                      enabled
                        ? 'bg-brand-900/20 border border-brand-700/40 text-brand-300'
                        : 'bg-surface-sunken border border-[#222] text-rmpg-600'
                    }`}
                  >
                    {enabled ? <ToggleRight className="w-3 h-3 text-brand-400" /> : <ToggleLeft className="w-3 h-3 text-rmpg-600" />}
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 block mb-1">Custom Style URL (optional, overrides default)</label>
            <input type="text" value={settings.custom_style_url}
              onChange={e => updateField('custom_style_url', e.target.value)}
              placeholder="mapbox://styles/..." className="input-dark text-[10px] w-full min-h-[32px] font-mono"
            />
          </div>
        </div>

        {/* Gesture Controls */}
        <div className="panel-beveled bg-surface-base p-4 space-y-3">
          <SectionLabel icon={Hand} label="Gesture Controls" />
          <div className="space-y-2.5">
            <ToggleField label="Scroll to Zoom" value={settings.scroll_zoom} onChange={v => updateField('scroll_zoom', v)} />
            <ToggleField label="Box Zoom (Shift+Click+Drag)" value={settings.box_zoom} onChange={v => updateField('box_zoom', v)} />
            <ToggleField label="Drag to Rotate" value={settings.drag_rotate} onChange={v => updateField('drag_rotate', v)} />
            <ToggleField label="Drag to Pan" value={settings.drag_pan} onChange={v => updateField('drag_pan', v)} />
            <ToggleField label="Double-Click to Zoom" value={settings.double_click_zoom} onChange={v => updateField('double_click_zoom', v)} />
            <ToggleField label="Touch Zoom & Rotate (mobile)" value={settings.touch_zoom_rotate} onChange={v => updateField('touch_zoom_rotate', v)} />
            <ToggleField label="Cooperative Gestures (mobile)" value={settings.cooperative_gestures} onChange={v => updateField('cooperative_gestures', v)} />
          </div>
        </div>

        {/* UI Controls */}
        <div className="panel-beveled bg-surface-base p-4 space-y-3">
          <SectionLabel icon={Monitor} label="UI Controls" />
          <div className="space-y-2.5">
            <ToggleField label="Show Mapbox Attribution" value={settings.show_attribution} onChange={v => updateField('show_attribution', v)} />
            <ToggleField label="Enable Map Rotation (bearing)" value={settings.rotation_enabled} onChange={v => updateField('rotation_enabled', v)} />
            <ToggleField label="Show Compass Control" value={settings.show_compass} onChange={v => updateField('show_compass', v)} />
            <ToggleField label="Show Zoom +/- Buttons" value={settings.show_zoom_controls} onChange={v => updateField('show_zoom_controls', v)} />
            <ToggleField label="Enable Keyboard Navigation" value={settings.keyboard_enabled} onChange={v => updateField('keyboard_enabled', v)} />
          </div>
        </div>

        {/* Clustering */}
        <div className="panel-beveled bg-surface-base p-4 space-y-3">
          <SectionLabel icon={Layers} label="Marker Clustering" />
          <div className="space-y-2.5">
            <ToggleField label="Enable Marker Clustering" value={settings.clustering_enabled} onChange={v => updateField('clustering_enabled', v)} />
            <InlineInput label="Cluster Radius (px)" value={settings.cluster_radius} onChange={v => updateField('cluster_radius', v)} min="1" max="200" suffix="px" />
            <InlineInput label="Max Cluster Zoom" value={settings.cluster_max_zoom} onChange={v => updateField('cluster_max_zoom', v)} min="1" max="22" />
          </div>
        </div>

        {/* Rendering & Performance */}
        <div className="panel-beveled bg-surface-base p-4 space-y-3">
          <SectionLabel icon={Settings2} label="Rendering & Performance" />
          <div className="space-y-2.5">
            <ToggleField label="Render World Copies" value={settings.render_world_copies} onChange={v => updateField('render_world_copies', v)} />
            <ToggleField label="Cross-Source Collisions" value={settings.cross_source_collisions} onChange={v => updateField('cross_source_collisions', v)} />
            <InlineInput label="Fade Duration (ms)" value={settings.fade_duration} onChange={v => updateField('fade_duration', v)} min="0" max="5000" suffix="ms" />
            <InlineInput label="Click Tolerance (px)" value={settings.click_tolerance} onChange={v => updateField('click_tolerance', v)} min="0" max="20" suffix="px" />
            <label className="text-[10px] text-rmpg-400 block mt-2 mb-0.5">Language (BCP 47, e.g. 'es', 'fr')</label>
            <input type="text" value={settings.language}
              onChange={e => updateField('language', e.target.value)}
              placeholder="en" className="input-dark text-[10px] w-full min-h-[28px] font-mono"
            />
            <label className="text-[10px] text-rmpg-400 block mt-2 mb-0.5">Local Ideograph Font Family</label>
            <input type="text" value={settings.local_ideograph_font_family}
              onChange={e => updateField('local_ideograph_font_family', e.target.value)}
              placeholder="sans-serif" className="input-dark text-[10px] w-full min-h-[28px] font-mono"
            />
          </div>
        </div>

        {/* Marker Behavior */}
        <div className="panel-beveled bg-surface-base p-4 space-y-3">
          <SectionLabel icon={CrosshairIcon} label="Marker Behavior" />
          <div className="space-y-2.5">
            <ToggleField label="Unit Marker Pulse Animation" value={settings.unit_marker_pulse} onChange={v => updateField('unit_marker_pulse', v)} />
            <ToggleField label="Call Marker Pulse Animation (P1/P2)" value={settings.call_marker_pulse} onChange={v => updateField('call_marker_pulse', v)} />
            <InlineInput label="Marker Font Size (px)" value={settings.marker_font_size} onChange={v => updateField('marker_font_size', v)} min="6" max="18" suffix="px" />
          </div>
        </div>

        {/* GeoJSON Layer Defaults */}
        <div className="panel-beveled bg-surface-base p-4 space-y-3 xl:col-span-2">
          <SectionLabel icon={Hexagon} label="GeoJSON Layer Defaults" />
          <div className="space-y-4">
            {LAYER_IDS.map(layerId => {
              const visible = settings.default_visible_layers.includes(layerId);
              const label = layerId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              const fill = (settings as any)[`layer_${layerId}_fill`] as string;
              const fillOpacity = (settings as any)[`layer_${layerId}_fill_opacity`] as number;
              const stroke = (settings as any)[`layer_${layerId}_stroke`] as string;
              const strokeOpacity = (settings as any)[`layer_${layerId}_stroke_opacity`] as number;
              const strokeWeight = (settings as any)[`layer_${layerId}_stroke_weight`] as number;
              const minZoom = (settings as any)[`layer_${layerId}_min_zoom`] as number | undefined;
              const hasFill = layerId !== 'highway' && layerId !== 'state_boundary';

              return (
                <div key={layerId} className="bg-surface-sunken border border-[#1a1a1a] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => {
                        const current = settings.default_visible_layers;
                        const updated = current.includes(layerId)
                          ? current.filter(l => l !== layerId)
                          : [...current, layerId];
                        updateField('default_visible_layers', updated);
                      }}
                        className={`text-[10px] px-2 py-1 border transition-colors ${visible ? 'bg-brand-900/20 border-brand-700/40 text-brand-300' : 'bg-[#0a0a0a] border-[#222] text-rmpg-600'}`}
                      >
                        {visible ? 'ON' : 'OFF'}
                      </button>
                      <span className="text-[11px] font-semibold text-rmpg-200">{label}</span>
                    </div>
                    {minZoom !== undefined && (
                      <span className="text-[9px] text-rmpg-600">Min Zoom: {minZoom}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {hasFill && (
                      <>
                        <ColorInput label="Fill" value={fill} onChange={v => updateField(`layer_${layerId}_fill` as any, v)} />
                        <OpacitySlider label="Fill Opacity" value={fillOpacity} onChange={v => updateField(`layer_${layerId}_fill_opacity` as any, v)} />
                      </>
                    )}
                    <ColorInput label="Stroke" value={stroke} onChange={v => updateField(`layer_${layerId}_stroke` as any, v)} />
                    <OpacitySlider label="Stroke Opacity" value={strokeOpacity} onChange={v => updateField(`layer_${layerId}_stroke_opacity` as any, v)} />
                    <InlineInput label="Stroke Weight" value={strokeWeight} onChange={v => updateField(`layer_${layerId}_stroke_weight` as any, v)} min="0.5" max="6" step="0.1" suffix="px" />
                    {minZoom !== undefined && (
                      <InlineInput label="Min Zoom" value={minZoom} onChange={v => updateField(`layer_${layerId}_min_zoom` as any, v)} min="0" max="22" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* GPS Tracking */}
        <div className="panel-beveled bg-surface-base p-4 space-y-3">
          <SectionLabel icon={Satellite} label="GPS Tracking" />
          <div className="space-y-2.5">
            <ToggleField label="High-Accuracy GPS" value={settings.gps_high_accuracy} onChange={v => updateField('gps_high_accuracy', v)} />
            <InlineInput label="Batch Interval (ms)" value={settings.gps_batch_interval_ms} onChange={v => updateField('gps_batch_interval_ms', v)} min="1000" max="60000" step="500" suffix="ms" />
            <InlineInput label="Max Accuracy (m)" value={settings.gps_max_accuracy_meters} onChange={v => updateField('gps_max_accuracy_meters', v)} min="10" max="1000" suffix="m" />
            <InlineInput label="Max Speed (m/s)" value={settings.gps_max_speed_ms} onChange={v => updateField('gps_max_speed_ms', v)} min="10" max="200" suffix="m/s" />
            <p className="text-[9px] text-rmpg-600 mt-1">GPS settings affect battery life and tracking precision. Changes apply on next page load.</p>
          </div>
        </div>

        {/* Map Export & Screenshot */}
        <div className="panel-beveled bg-surface-base p-4 space-y-3">
          <SectionLabel icon={Save} label="Map Export & Screenshot" />
          <div className="space-y-2.5">
            <label className="text-[10px] text-rmpg-400 block mb-1">Screenshot Map Style</label>
            <select value={settings.screenshot_style}
              onChange={e => updateField('screenshot_style', e.target.value)}
              className="input-dark text-[10px] w-full min-h-[32px]"
            >
              {STYLE_OPTIONS.map(s => (
                <option key={s.id} value={s.id}>{s.label} — {s.desc}</option>
              ))}
            </select>
            <InlineInput label="Screenshot Width (px)" value={settings.screenshot_width} onChange={v => updateField('screenshot_width', v)} min="320" max="3840" suffix="px" />
            <InlineInput label="Screenshot Height (px)" value={settings.screenshot_height} onChange={v => updateField('screenshot_height', v)} min="240" max="2160" suffix="px" />
          </div>
        </div>

        {/* Max Bounds */}
        <div className="panel-beveled bg-surface-base p-4 space-y-3 xl:col-span-2">
          <SectionLabel icon={Crosshair} label="Max Bounds (Restrict visible area — leave empty for no restriction)" />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-[10px] text-rmpg-500 font-semibold mb-1">Southwest Corner</div>
              <InlineInput label="Latitude" value={settings.max_bounds_sw_lat ?? ''} onChange={v => updateField('max_bounds_sw_lat', v === '' ? null : v)} step="0.0001" min="-90" max="90" />
              <InlineInput label="Longitude" value={settings.max_bounds_sw_lng ?? ''} onChange={v => updateField('max_bounds_sw_lng', v === '' ? null : v)} step="0.0001" min="-180" max="180" />
            </div>
            <div className="space-y-2">
              <div className="text-[10px] text-rmpg-500 font-semibold mb-1">Northeast Corner</div>
              <InlineInput label="Latitude" value={settings.max_bounds_ne_lat ?? ''} onChange={v => updateField('max_bounds_ne_lat', v === '' ? null : v)} step="0.0001" min="-90" max="90" />
              <InlineInput label="Longitude" value={settings.max_bounds_ne_lng ?? ''} onChange={v => updateField('max_bounds_ne_lng', v === '' ? null : v)} step="0.0001" min="-180" max="180" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[10px] text-rmpg-400 cursor-pointer">
      <button type="button" role="switch" aria-checked={value}
        onClick={() => onChange(!value)}
        className={`w-7 h-4 rounded-sm flex items-center transition-colors px-[2px] ${
          value ? 'bg-brand-700/60 justify-end' : 'bg-rmpg-700 justify-start'
        }`}
      >
        <div className={`w-2.5 h-2.5 rounded-sm ${value ? 'bg-brand-400' : 'bg-rmpg-500'}`} />
      </button>
      {label}
    </label>
  );
}

function CheckMini(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] text-rmpg-400">
      <span className="w-14 shrink-0">{label}</span>
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        className="w-6 h-6 p-0 border border-[#333] bg-transparent cursor-pointer rounded-sm"
      />
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        className="input-dark text-[10px] w-20 text-center font-mono min-h-[24px]"
      />
    </label>
  );
}

function OpacitySlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] text-rmpg-400">
      <span className="w-[72px] shrink-0">{label}</span>
      <input type="range" min="0" max="1" step="0.01" value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-16 h-3 accent-brand-400 cursor-pointer"
      />
      <span className="text-[10px] font-mono text-rmpg-500 w-8 text-right">{value.toFixed(2)}</span>
    </label>
  );
}
