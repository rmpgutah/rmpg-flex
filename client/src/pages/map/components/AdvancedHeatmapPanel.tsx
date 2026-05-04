// ============================================================
// RMPG Flex — AdvancedHeatmapPanel Component
// Floating crime analysis panel for advanced heatmap controls.
// Mode selection, time/day filters, appearance tuning,
// incident type filter, temporal animation, comparison view,
// and statistical summary.
// ============================================================

import React, { useMemo, useCallback } from 'react';
import {
  SlidersHorizontal,
  Loader2,
  X,
  BarChart3,
  AlertTriangle,
  Clock,
  GitCompare,
  Play,
  Pause,
  RotateCw,
  Check,
  Zap,
} from 'lucide-react';
import type {
  HeatmapAdvancedMode,
  HeatmapResolution,
  HeatmapColorScheme,
} from '../hooks/useMapHeatmapAdvanced';

// ─── Props ──────────────────────────────────────────────────

interface AdvancedHeatmapPanelProps {
  // Mode
  mode: HeatmapAdvancedMode;
  onModeChange: (mode: HeatmapAdvancedMode) => void;
  // Filters
  hourRange: [number, number];
  onHourRangeChange: (range: [number, number]) => void;
  dayFilter: number[];
  onDayFilterChange: (days: number[]) => void;
  // Appearance
  colorScheme: HeatmapColorScheme;
  onColorSchemeChange: (scheme: HeatmapColorScheme) => void;
  opacity: number;
  onOpacityChange: (v: number) => void;
  radius: number;
  onRadiusChange: (v: number) => void;
  resolution: HeatmapResolution;
  onResolutionChange: (res: HeatmapResolution) => void;
  // Clusters
  showClusters: boolean;
  onShowClustersChange: (v: boolean) => void;
  clusterCount: number;
  // Incident types
  types: string[];
  onTypesChange: (types: string[]) => void;
  availableTypes: { incident_type: string; count: number }[];
  // Comparison
  comparisonDays: number;
  onComparisonDaysChange: (d: number) => void;
  // Temporal
  temporalHour: number;
  temporalPlaying: boolean;
  temporalSpeed: 1 | 2 | 4;
  onTemporalHourChange: (h: number) => void;
  onTemporalPlayingChange: (v: boolean) => void;
  onTemporalSpeedChange: (s: 1 | 2 | 4) => void;
  // Stats
  stats: {
    total: number;
    topTypes: { type: string; count: number }[];
    peakHour: number | null;
    peakDay: string | null;
  } | null;
  pointCount: number;
  comparisonPointCount: number;
  // Actions
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
}

// ─── Constants ──────────────────────────────────────────────

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const MODE_CONFIG: {
  key: HeatmapAdvancedMode;
  label: string;
  icon: React.ElementType;
  accent: string;
  accentBg: string;
}[] = [
  { key: 'density', label: 'DENSITY', icon: BarChart3, accent: '#888888', accentBg: 'rgba(136, 136, 136,0.15)' },
  { key: 'risk', label: 'RISK', icon: AlertTriangle, accent: '#ef4444', accentBg: 'rgba(239,68,68,0.15)' },
  { key: 'temporal', label: 'TEMPORAL', icon: Clock, accent: '#f97316', accentBg: 'rgba(249,115,22,0.15)' },
  { key: 'comparison', label: 'COMPARE', icon: GitCompare, accent: '#a855f7', accentBg: 'rgba(168,85,247,0.15)' },
];

const COLOR_SCHEME_GRADIENTS: Record<HeatmapColorScheme, string[]> = {
  heat: ['#888888', '#22c55e', '#eab308', '#f97316', '#ef4444'],
  risk: ['#22c55e', '#eab308', '#f97316', '#ef4444', '#7f1d1d'],
  // Renamed from 'blue' (removed from HeatmapColorScheme union during
  // the Spillman pure-black theme purge) to the current 'gold' variant.
  gold: ['#cccccc', '#888888', '#555555', '#222222', '#171717'],
  green: ['#86efac', '#22c55e', '#15803d', '#14532d', '#0a2918'],
  purple: ['#c4b5fd', '#a855f7', '#7c3aed', '#5b21b6', '#232323'],
};

const RESOLUTION_OPTIONS: { key: HeatmapResolution; label: string }[] = [
  { key: 'fine', label: 'Fine' },
  { key: 'medium', label: 'Medium' },
  { key: 'coarse', label: 'Coarse' },
];

const COMPARISON_PERIODS = [
  { days: 7, label: '7d' },
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

// ─── Quick Presets ─────────────────────────────────────────

interface HeatmapPreset {
  key: string;
  label: string;
  mode: HeatmapAdvancedMode;
  colorScheme: HeatmapColorScheme;
  radius: number;
  hourRange?: [number, number];
  accent: string;
}

const QUICK_PRESETS: HeatmapPreset[] = [
  { key: 'crime', label: 'Crime', mode: 'density', colorScheme: 'heat', radius: 30, accent: '#f97316' },
  { key: 'risk', label: 'Risk', mode: 'risk', colorScheme: 'risk', radius: 25, accent: '#ef4444' },
  { key: 'temporal', label: 'Temporal', mode: 'temporal', colorScheme: 'gold', radius: 20, accent: '#888888' },
  { key: 'night', label: 'Night Shift', mode: 'density', colorScheme: 'purple', radius: 30, hourRange: [19, 7], accent: '#a855f7' },
];

// ─── Helpers ────────────────────────────────────────────────

function formatHour(h: number): string {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hr}:00 ${ampm}`;
}

function formatHourCompact(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

// ─── Sub-components ─────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-1">
      <span className="text-[9px] uppercase tracking-widest font-bold text-rmpg-500">
        {children}
      </span>
    </div>
  );
}

{/* #38: Section divider with subtler gradient */}
function SectionDivider() {
  return <div className="mx-2" style={{ height: 1, background: 'linear-gradient(to right, transparent, #2b2b2b 30%, #2b2b2b 70%, transparent)' }} />;
}

// ─── Component ──────────────────────────────────────────────

export default function AdvancedHeatmapPanel({
  mode,
  onModeChange,
  hourRange,
  onHourRangeChange,
  dayFilter,
  onDayFilterChange,
  colorScheme,
  onColorSchemeChange,
  opacity,
  onOpacityChange,
  radius,
  onRadiusChange,
  resolution,
  onResolutionChange,
  showClusters,
  onShowClustersChange,
  clusterCount,
  types,
  onTypesChange,
  availableTypes,
  comparisonDays,
  onComparisonDaysChange,
  temporalHour,
  temporalPlaying,
  temporalSpeed,
  onTemporalHourChange,
  onTemporalPlayingChange,
  onTemporalSpeedChange,
  stats,
  pointCount,
  comparisonPointCount,
  loading,
  onRefresh,
  onClose,
}: AdvancedHeatmapPanelProps) {
  // ── Derived ──

  const activeMode = MODE_CONFIG.find((m) => m.key === mode)!;

  const topStatsMax = useMemo(() => {
    if (!stats?.topTypes?.length) return 1;
    return Math.max(...stats.topTypes.map((t) => t.count), 1);
  }, [stats]);

  // ── Quick preset handler ──

  const applyPreset = useCallback((preset: HeatmapPreset) => {
    onModeChange(preset.mode);
    onColorSchemeChange(preset.colorScheme);
    onRadiusChange(preset.radius);
    if (preset.hourRange) {
      onHourRangeChange(preset.hourRange);
    }
  }, [onModeChange, onColorSchemeChange, onRadiusChange, onHourRangeChange]);

  // ── Day filter helpers ──

  function toggleDay(d: number) {
    if (dayFilter.includes(d)) {
      onDayFilterChange(dayFilter.filter((x) => x !== d));
    } else {
      onDayFilterChange([...dayFilter, d].sort());
    }
  }

  function setDayPreset(days: number[]) {
    onDayFilterChange([...days].sort());
  }

  // ── Type filter helpers ──

  function toggleType(t: string) {
    if (types.includes(t)) {
      onTypesChange(types.filter((x) => x !== t));
    } else {
      onTypesChange([...types, t]);
    }
  }

  // ── Render ──

  return (
    <div
      className="panel-beveled rounded-sm flex flex-col transition-all duration-200 ease-out shadow-lg"
      style={{
        width: 400,
        maxHeight: '85vh',
        background: '#0a0a0a',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)',
        border: '1px solid #282828',
      }}
      role="complementary"
      aria-label="Advanced heatmap controls"
    >
      {/* ── Header Bar ────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ background: '#050505', borderBottom: '1px solid #282828' }}
      >
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal size={14} className="text-rmpg-400" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-rmpg-200">
            Advanced Heatmap
          </span>
          {loading && <Loader2 size={12} className="animate-spin text-rmpg-500" />}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button"
            onClick={onRefresh}
            className="toolbar-btn p-1 rounded-sm hover:bg-[#181818] transition-all duration-150 active:scale-[0.97]"
            title="Refresh data"
            aria-label="Refresh heatmap data"
          >
            <RotateCw size={12} className="text-rmpg-500 hover:text-rmpg-300" />
          </button>
          <button type="button"
            onClick={onClose}
            className="toolbar-btn p-1 rounded-sm hover:bg-[#181818] transition-all duration-150 active:scale-[0.97]"
            aria-label="Close advanced heatmap panel"
            title="Close"
          >
            <X size={13} className="text-rmpg-500 hover:text-rmpg-300" />
          </button>
        </div>
      </div>

      {/* ── Scrollable body ───────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent">
        {/* ── Section 1: Mode Selector ──────────────── */}
        <div className="px-4 pt-3 pb-2">
          <div className="grid grid-cols-4 gap-1.5">
            {MODE_CONFIG.map((m) => {
              const active = mode === m.key;
              const Icon = m.icon;
              return (
                <button type="button"
                  key={m.key}
                  onClick={() => onModeChange(m.key)}
                  className="flex flex-col items-center gap-1 py-2 px-1 rounded-sm transition-all duration-150 active:scale-[0.97] hover:bg-[#181818]/50"
                  style={{
                    background: active ? m.accentBg : 'rgba(255,255,255,0.02)',
                    border: active ? `2px solid ${m.accent}` : '1px solid #282828',
                    color: active ? m.accent : '#666666',
                  }}
                  aria-label={`${m.label} heatmap mode`}
                  title={`${m.label} - ${m.key === 'density' ? 'Show incident density' : m.key === 'risk' ? 'Show risk analysis' : m.key === 'temporal' ? 'Animate by time of day' : 'Compare time periods'}`}
                >
                  <Icon size={14} />
                  <span className="text-[8px] font-bold uppercase tracking-wider">
                    {m.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Quick Presets ── */}
          <div className="mt-2.5 pt-2" style={{ borderTop: '1px solid #282828' }}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Zap size={10} className="text-rmpg-500" />
              <span className="text-[8px] uppercase tracking-widest font-bold text-rmpg-500">Quick Presets</span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {QUICK_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset.key}
                  onClick={() => applyPreset(preset)}
                  className="px-1 py-1.5 rounded-sm text-[8px] font-bold uppercase tracking-wider transition-all duration-150 active:scale-[0.97] hover:brightness-125"
                  style={{
                    background: `${preset.accent}15`,
                    border: `1px solid ${preset.accent}40`,
                    color: preset.accent,
                  }}
                  title={`Apply ${preset.label} preset: ${preset.mode} mode, ${preset.colorScheme} colors, ${preset.radius}px radius${preset.hourRange ? `, ${formatHourCompact(preset.hourRange[0])}-${formatHourCompact(preset.hourRange[1])}` : ''}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <SectionDivider />

        {/* ── Section 2: Time Filters ──────────────── */}
        <SectionHeader>Time Filters</SectionHeader>
        <div className="px-4 pb-3 space-y-3">
          {/* Hour range */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[8px] uppercase tracking-wider text-rmpg-600 font-semibold">
                Hour Range
              </span>
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                style={{ background: '#050505', color: '#888888' }}
              >
                {formatHourCompact(hourRange[0])} &mdash; {formatHourCompact(hourRange[1])}:59
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-[7px] uppercase text-rmpg-600 block mb-0.5">From</label>
                <input
                  type="range"
                  min={0}
                  max={23}
                  value={hourRange[0]}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    onHourRangeChange([Math.min(v, hourRange[1]), hourRange[1]]);
                  }}
                  className="w-full h-1 accent-gray-500 cursor-pointer"
                  style={{ accentColor: activeMode.accent }}
                />
              </div>
              <div className="flex-1">
                <label className="text-[7px] uppercase text-rmpg-600 block mb-0.5">To</label>
                <input
                  type="range"
                  min={0}
                  max={23}
                  value={hourRange[1]}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    onHourRangeChange([hourRange[0], Math.max(v, hourRange[0])]);
                  }}
                  className="w-full h-1 accent-gray-500 cursor-pointer"
                  style={{ accentColor: activeMode.accent }}
                />
              </div>
            </div>
          </div>

          {/* Day of week */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[8px] uppercase tracking-wider text-rmpg-600 font-semibold">
                Day of Week
              </span>
              <div className="flex items-center gap-1.5">
                {[
                  { label: 'Weekdays', days: WEEKDAYS },
                  { label: 'Weekends', days: WEEKENDS },
                  { label: 'All', days: ALL_DAYS },
                ].map((preset) => (
                  <button type="button"
                    key={preset.label}
                    onClick={() => setDayPreset(preset.days)}
                    className="text-[7px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm transition-all duration-150 hover:text-rmpg-200 hover:bg-[#181818]/50 active:scale-[0.97]"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      color: '#666666',
                      border: '1px solid #282828',
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {DAY_LABELS.map((label, idx) => {
                const active = dayFilter.includes(idx);
                return (
                  <button type="button"
                    key={label}
                    onClick={() => toggleDay(idx)}
                    className="py-1.5 rounded-sm text-[9px] font-bold uppercase transition-all duration-150 text-center active:scale-[0.97] hover:bg-[#181818]/50"
                    style={{
                      background: active ? activeMode.accentBg : '#050505',
                      border: `1px solid ${active ? activeMode.accent + '55' : '#1e1e1e'}`,
                      color: active ? activeMode.accent : '#555555',
                    }}
                    aria-label={`Toggle ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][idx]}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <SectionDivider />

        {/* ── Section 3: Appearance Controls ────────── */}
        <SectionHeader>Appearance</SectionHeader>
        <div className="px-4 pb-3 space-y-3">
          {/* Color scheme */}
          <div>
            <span className="text-[8px] uppercase tracking-wider text-rmpg-600 font-semibold block mb-1.5">
              Color Scheme
            </span>
            <div className="flex items-center gap-2">
              {(Object.keys(COLOR_SCHEME_GRADIENTS) as HeatmapColorScheme[]).map((scheme) => {
                const active = colorScheme === scheme;
                const colors = COLOR_SCHEME_GRADIENTS[scheme];
                return (
                  <button type="button"
                    key={scheme}
                    onClick={() => onColorSchemeChange(scheme)}
                    className="flex flex-col items-center gap-1 group"
                    title={scheme.charAt(0).toUpperCase() + scheme.slice(1)}
                  >
                    <div
                      className="h-4 rounded-sm transition-all"
                      style={{
                        width: 52,
                        background: `linear-gradient(to right, ${colors.join(', ')})`,
                        outline: active ? `2px solid ${colors[2]}` : '2px solid transparent',
                        outlineOffset: 1,
                        opacity: active ? 1 : 0.6,
                      }}
                    />
                    <span
                      className="text-[7px] uppercase tracking-wider transition-colors"
                      style={{ color: active ? colors[2] : '#555555' }}
                    >
                      {scheme}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Opacity */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[8px] uppercase tracking-wider text-rmpg-600 font-semibold">
                  Opacity
                </span>
                <span className="text-[10px] font-mono text-rmpg-400">{opacity}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                value={opacity}
                onChange={(e) => onOpacityChange(Number(e.target.value))}
                className="w-full h-1 cursor-pointer"
                style={{ accentColor: activeMode.accent }}
              />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[8px] uppercase tracking-wider text-rmpg-600 font-semibold">
                  Radius
                </span>
                <span className="text-[10px] font-mono text-rmpg-400">{radius}px</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                value={radius}
                onChange={(e) => onRadiusChange(Number(e.target.value))}
                className="w-full h-1 cursor-pointer"
                style={{ accentColor: activeMode.accent }}
              />
            </div>
          </div>

          {/* Resolution */}
          <div className="flex items-center justify-between">
            <span className="text-[8px] uppercase tracking-wider text-rmpg-600 font-semibold">
              Resolution
            </span>
            <div className="flex items-center gap-1">
              {RESOLUTION_OPTIONS.map((opt) => {
                const active = resolution === opt.key;
                return (
                  <button type="button"
                    key={opt.key}
                    onClick={() => onResolutionChange(opt.key)}
                    className="px-2.5 py-1 rounded-sm text-[9px] font-semibold uppercase tracking-wider transition-all"
                    style={{
                      background: active ? activeMode.accentBg : '#050505',
                      border: `1px solid ${active ? activeMode.accent + '55' : '#1e1e1e'}`,
                      color: active ? activeMode.accent : '#555555',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Clusters toggle */}
          <div className="flex items-center justify-between">
            <span className="text-[8px] uppercase tracking-wider text-rmpg-600 font-semibold">
              Cluster Overlays
            </span>
            <div className="flex items-center gap-2">
              {showClusters && clusterCount > 0 && (
                <span
                  className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-sm"
                  style={{ background: activeMode.accentBg, color: activeMode.accent }}
                >
                  {clusterCount}
                </span>
              )}
              <button type="button"
                onClick={() => onShowClustersChange(!showClusters)}
                className="relative w-8 h-4 rounded-full transition-colors"
                style={{
                  background: showClusters ? activeMode.accent : '#1e1e1e',
                }}
              >
                <div
                  className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                  style={{ left: showClusters ? 17 : 2 }}
                />
              </button>
            </div>
          </div>
        </div>

        <SectionDivider />

        {/* ── Section 4: Incident Type Filter ──────── */}
        <SectionHeader>Incident Types</SectionHeader>
        <div className="px-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[8px] text-rmpg-600">
              {types.length} of {availableTypes.length} selected
            </span>
            <div className="flex items-center gap-1.5">
              <button type="button"
                onClick={() => onTypesChange(availableTypes.map((t) => t.incident_type))}
                className="text-[7px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm transition-colors hover:text-rmpg-200"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  color: '#666666',
                  border: '1px solid #282828',
                }}
              >
                All
              </button>
              <button type="button"
                onClick={() => onTypesChange([])}
                className="text-[7px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm transition-colors hover:text-rmpg-200"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  color: '#666666',
                  border: '1px solid #282828',
                }}
              >
                Clear
              </button>
            </div>
          </div>
          <div
            className="max-h-32 overflow-y-auto space-y-0.5 rounded-sm p-1"
            style={{ background: '#050505', border: '1px solid #282828', scrollbarWidth: 'thin' }}
          >
            {availableTypes.map((t) => {
              const checked = types.includes(t.incident_type);
              return (
                <button type="button"
                  key={t.incident_type}
                  onClick={() => toggleType(t.incident_type)}
                  className="flex items-center gap-2 w-full px-2 py-1 rounded-sm text-left transition-all duration-100 hover:bg-[#181818]/50 active:scale-[0.98]"
                >
                  <div
                    className="w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-all"
                    style={{
                      background: checked ? activeMode.accent : 'transparent',
                      borderColor: checked ? activeMode.accent : '#444444',
                    }}
                  >
                    {checked && <Check size={9} className="text-white" strokeWidth={3} />}
                  </div>
                  <span
                    className="text-[9px] flex-1 truncate"
                    style={{ color: checked ? '#e0e0e0' : '#666666' }}
                  >
                    {(t.incident_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  </span>
                  <span className="text-[8px] font-mono text-rmpg-600 shrink-0">{t.count}</span>
                </button>
              );
            })}
            {availableTypes.length === 0 && (
              <div className="text-center py-3 text-rmpg-600 text-[9px]">No incident types</div>
            )}
          </div>
        </div>

        <SectionDivider />

        {/* ── Section 5: Mode-Specific Controls ────── */}

        {/* Temporal mode */}
        {mode === 'temporal' && (
          <>
            <SectionHeader>Temporal Animation</SectionHeader>
            <div className="px-4 pb-3 space-y-3">
              {/* Digital time display */}
              <div
                className="flex items-center justify-center py-2 rounded-sm"
                style={{ background: '#050505', border: '1px solid #282828' }}
              >
                <span className="text-[18px] font-mono font-bold" style={{ color: '#f97316' }}>
                  {formatHourCompact(temporalHour)}
                </span>
                <span className="text-[10px] font-mono text-rmpg-500 ml-1.5">
                  &mdash; {formatHourCompact(temporalHour)}:59
                </span>
              </div>

              {/* Play/Pause + Speed */}
              <div className="flex items-center gap-3">
                <button type="button"
                  onClick={() => onTemporalPlayingChange(!temporalPlaying)}
                  className="flex items-center justify-center w-10 h-10 rounded-sm transition-all duration-150 active:scale-[0.97]"
                  style={{
                    background: temporalPlaying
                      ? 'rgba(249,115,22,0.2)'
                      : 'rgba(249,115,22,0.1)',
                    border: `1px solid ${temporalPlaying ? '#f97316' : '#f9731655'}`,
                    color: '#f97316',
                  }}
                  title={temporalPlaying ? 'Pause' : 'Play'}
                >
                  {temporalPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <div className="flex-1">
                  <input
                    type="range"
                    min={0}
                    max={23}
                    value={temporalHour}
                    onChange={(e) => onTemporalHourChange(Number(e.target.value))}
                    className="w-full h-1 cursor-pointer"
                    style={{ accentColor: '#f97316' }}
                  />
                  {/* Hour ticks */}
                  <div className="flex justify-between mt-0.5 px-0.5">
                    {[0, 6, 12, 18, 23].map((h) => (
                      <span key={h} className="text-[7px] font-mono text-rmpg-600">
                        {formatHourCompact(h)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Speed selector */}
              <div className="flex items-center justify-between">
                <span className="text-[8px] uppercase tracking-wider text-rmpg-600 font-semibold">
                  Speed
                </span>
                <div className="flex items-center gap-1">
                  {([1, 2, 4] as const).map((s) => {
                    const active = temporalSpeed === s;
                    return (
                      <button type="button"
                        key={s}
                        onClick={() => onTemporalSpeedChange(s)}
                        className="px-2.5 py-1 rounded-sm text-[9px] font-bold font-mono transition-all"
                        style={{
                          background: active ? 'rgba(249,115,22,0.15)' : '#050505',
                          border: `1px solid ${active ? '#f9731655' : '#1e1e1e'}`,
                          color: active ? '#f97316' : '#555555',
                        }}
                      >
                        {s}x
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: '#050505' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${((temporalHour + 1) / 24) * 100}%`,
                    background: 'linear-gradient(to right, #f97316, #ea580c)',
                  }}
                />
              </div>
            </div>
            <SectionDivider />
          </>
        )}

        {/* Comparison mode */}
        {mode === 'comparison' && (
          <>
            <SectionHeader>Comparison Period</SectionHeader>
            <div className="px-4 pb-3 space-y-3">
              {/* Period selector */}
              <div className="flex items-center gap-1.5">
                {COMPARISON_PERIODS.map((p) => {
                  const active = comparisonDays === p.days;
                  return (
                    <button type="button"
                      key={p.days}
                      onClick={() => onComparisonDaysChange(p.days)}
                      className="flex-1 py-1.5 rounded-sm text-[10px] font-bold font-mono text-center transition-all"
                      style={{
                        background: active ? 'rgba(168,85,247,0.15)' : '#050505',
                        border: `1px solid ${active ? '#a855f755' : '#1e1e1e'}`,
                        color: active ? '#a855f7' : '#555555',
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {/* Color legend */}
              <div
                className="flex items-center justify-between px-3 py-2 rounded-sm"
                style={{ background: '#050505', border: '1px solid #282828' }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444' }} />
                  <span className="text-[9px] text-rmpg-400">Current</span>
                  <span className="text-[10px] font-mono font-bold text-rmpg-300">
                    {pointCount.toLocaleString()}
                  </span>
                </div>
                <div
                  className="w-px h-4"
                  style={{ background: '#1e1e1e' }}
                />
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#888888' }} />
                  <span className="text-[9px] text-rmpg-400">Previous</span>
                  <span className="text-[10px] font-mono font-bold text-rmpg-300">
                    {comparisonPointCount.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Change indicator */}
              {pointCount > 0 && comparisonPointCount > 0 && (
                <div className="flex items-center justify-center gap-1.5">
                  {(() => {
                    const change = ((pointCount - comparisonPointCount) / comparisonPointCount) * 100;
                    const isUp = change > 0;
                    return (
                      <>
                        <span
                          className="text-[11px] font-mono font-bold"
                          style={{ color: isUp ? '#ef4444' : '#22c55e' }}
                        >
                          {isUp ? '+' : ''}{change.toFixed(1)}%
                        </span>
                        <span className="text-[8px] text-rmpg-500 uppercase">
                          vs previous {comparisonDays}d
                        </span>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
            <SectionDivider />
          </>
        )}

        {/* ── Section 6: Statistics ────────────────── */}
        {stats && (
          <>
            <SectionHeader>Statistics</SectionHeader>
            <div className="px-4 pb-4 space-y-3">
              {/* Total incidents */}
              <div
                className="flex items-center justify-between px-3 py-2.5 rounded-sm"
                style={{ background: '#050505', border: '1px solid #282828' }}
              >
                <span className="text-[8px] uppercase tracking-wider text-rmpg-500 font-semibold">
                  Total Incidents
                </span>
                <span className="text-[16px] font-mono font-bold" style={{ color: activeMode.accent }}>
                  {stats.total.toLocaleString()}
                </span>
              </div>

              {/* Top types with bar chart */}
              {stats.topTypes.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[8px] uppercase tracking-wider text-rmpg-600 font-semibold block mb-1">
                    Top Types
                  </span>
                  {stats.topTypes.slice(0, 3).map((t, i) => (
                    <div key={t.type} className="flex items-center gap-2">
                      <span className="text-[9px] text-rmpg-400 w-24 truncate shrink-0">
                        {(t.type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </span>
                      <div className="flex-1 h-3 rounded-sm overflow-hidden" style={{ background: '#050505' }}>
                        <div
                          className="h-full rounded-sm transition-all"
                          style={{
                            width: `${(t.count / topStatsMax) * 100}%`,
                            background: activeMode.accent,
                            opacity: 1 - i * 0.2,
                          }}
                        />
                      </div>
                      <span className="text-[9px] font-mono text-rmpg-400 w-8 text-right shrink-0">
                        {t.count}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Peak hour and peak day badges */}
              <div className="flex items-center gap-2">
                {stats.peakHour !== null && (
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm flex-1"
                    style={{ background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.25)' }}
                  >
                    <Clock size={10} className="text-orange-400 shrink-0" />
                    <div>
                      <div className="text-[7px] uppercase tracking-wider text-orange-500/70">
                        Peak Hour
                      </div>
                      <div className="text-[11px] font-mono font-bold text-orange-400">
                        {formatHour(stats.peakHour)}
                      </div>
                    </div>
                  </div>
                )}
                {stats.peakDay && (
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm flex-1"
                    style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.25)' }}
                  >
                    <BarChart3 size={10} className="text-purple-400 shrink-0" />
                    <div>
                      <div className="text-[7px] uppercase tracking-wider text-purple-500/70">
                        Peak Day
                      </div>
                      <div className="text-[11px] font-mono font-bold text-purple-400">
                        {stats.peakDay}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Point count footer */}
              <div className="flex items-center justify-center pt-1">
                <span className="text-[8px] font-mono text-rmpg-600">
                  {pointCount.toLocaleString()} data points loaded
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
