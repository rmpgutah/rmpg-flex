import React, { useState, useEffect, useCallback } from 'react';
import {
  Map, Save, Loader2, RefreshCw, Globe2,
  Palette, ToggleLeft, ToggleRight,
  Layers, Crosshair, Navigation2, SlidersHorizontal,
  Hand, Monitor, Settings2, Type, Cpu,
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
        {/* Default View */}
        <div className="panel-beveled bg-surface-base p-4 space-y-3">
          <SectionLabel icon={Globe2} label="Default Map View" />
          <div className="space-y-2">
            <InlineInput label="Center Latitude" value={settings.default_center_lat} onChange={v => updateField('default_center_lat', v)} step="0.0001" min="-90" max="90" />
            <InlineInput label="Center Longitude" value={settings.default_center_lng} onChange={v => updateField('default_center_lng', v)} step="0.0001" min="-180" max="180" />
            <InlineInput label="Default Zoom" value={settings.default_zoom} onChange={v => updateField('default_zoom', v)} min="1" max="22" />
            <InlineInput label="Min Zoom" value={settings.min_zoom} onChange={v => updateField('min_zoom', v)} min="0" max="22" />
            <InlineInput label="Max Zoom" value={settings.max_zoom} onChange={v => updateField('max_zoom', v)} min="1" max="22" />
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

        {/* Interactions */}
        <div className="panel-beveled bg-surface-base p-4 space-y-3">
          <SectionLabel icon={Navigation2} label="Interactions & Controls" />
          <div className="space-y-2.5">
            <ToggleField label="Show Mapbox Attribution" value={settings.show_attribution} onChange={v => updateField('show_attribution', v)} />
            <ToggleField label="Enable Map Rotation" value={settings.rotation_enabled} onChange={v => updateField('rotation_enabled', v)} />
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
