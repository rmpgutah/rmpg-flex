// ============================================================
// RMPG Flex — WeatherPanel Component
// Floating weather/environment panel for the map page.
// Shows comprehensive weather and environmental data for
// officer safety: lighting, hazards, wind, visibility, alerts.
// ============================================================

import React from 'react';
import {
  X,
  Sun,
  Moon,
  Sunset,
  Cloud,
  CloudRain,
  CloudSnow,
  Wind,
  Snowflake,
  Eye,
  AlertTriangle,
  School,
  RefreshCw,
  Navigation,
  Loader2,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────

interface WeatherPanelProps {
  lighting: 'daylight' | 'twilight' | 'darkness';
  sunriseSunset: {
    sunrise: string;
    sunset: string;
    minutesToNextTransition: number;
    nextTransition: 'sunrise' | 'sunset';
  } | null;
  lowVisibility: boolean;
  weatherHazards: {
    freezing: boolean;
    highWind: boolean;
    rain: boolean;
    snow: boolean;
    description: string;
  };
  icyRoad: boolean;
  windCondition: { speed: number; direction: number; cardinal: string } | null;
  visibilityRange: number;
  schoolZoneActive: boolean;
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
}

// ─── Helpers ────────────────────────────────────────────────

function lightingConfig(lighting: WeatherPanelProps['lighting']) {
  switch (lighting) {
    case 'daylight':
      return { Icon: Sun, label: 'DAYLIGHT', color: 'text-green-400', bg: 'bg-green-400/10' };
    case 'twilight':
      return { Icon: Sunset, label: 'TWILIGHT', color: 'text-amber-400', bg: 'bg-amber-400/10' };
    case 'darkness':
      return { Icon: Moon, label: 'DARKNESS', color: 'text-blue-400', bg: 'bg-blue-400/10' };
  }
}

function headerIcon(lighting: WeatherPanelProps['lighting']) {
  switch (lighting) {
    case 'daylight':
      return Sun;
    case 'twilight':
      return Cloud;
    case 'darkness':
      return Moon;
  }
}

function visibilityColor(range: number): string {
  if (range >= 5000) return 'text-green-400';
  if (range >= 1000) return 'text-amber-400';
  return 'text-red-400';
}

function visibilityBarColor(range: number): string {
  if (range >= 5000) return 'bg-green-400';
  if (range >= 1000) return 'bg-amber-400';
  return 'bg-red-400';
}

function visibilityPercent(range: number): number {
  // Scale: 0m = 0%, 10000m+ = 100%
  return Math.min(100, Math.max(2, (range / 10000) * 100));
}

function formatVisibility(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

// ─── Component ──────────────────────────────────────────────

export default function WeatherPanel({
  lighting,
  sunriseSunset,
  lowVisibility,
  weatherHazards,
  icyRoad,
  windCondition,
  visibilityRange,
  schoolZoneActive,
  loading,
  onRefresh,
  onClose,
}: WeatherPanelProps) {
  const lc = lightingConfig(lighting);
  const HeaderIcon = headerIcon(lighting);
  const hasHazards = weatherHazards.freezing || weatherHazards.highWind || weatherHazards.rain || weatherHazards.snow;
  const hasAlerts = icyRoad || schoolZoneActive || lowVisibility;

  return (
    <div
      className="panel-beveled rounded-sm flex flex-col select-none pointer-events-auto transition-all duration-200 ease-out shadow-lg"
      style={{
        width: 320,
        background: '#0a0a0a',
        border: '1px solid #1e2a3a',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}
      role="complementary"
      aria-label="Weather and environment panel"
    >
      {/* ── Header ──────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ background: '#050505', borderBottom: '1px solid #1e2a3a' }}
      >
        <HeaderIcon size={14} className="text-white/60" />
        <span className="text-[10px] font-semibold tracking-widest text-white/80 uppercase flex-1">
          Environment
        </span>
        <button type="button"
          onClick={onRefresh}
          disabled={loading}
          className="p-1 rounded-sm text-white/40 hover:text-white/80 hover:bg-[#1a2636] transition-all duration-150 active:scale-[0.97] disabled:opacity-40"
          title="Refresh weather data"
          aria-label="Refresh weather data"
        >
          {loading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
        </button>
        <button type="button"
          onClick={onClose}
          className="p-1 rounded-sm text-white/40 hover:text-red-400 hover:bg-[#1a2636] transition-all duration-150 active:scale-[0.97]"
          title="Close panel"
          aria-label="Close environment panel"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex flex-col gap-0 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent" style={{ maxHeight: 480 }}>
        {/* ── Section 1: Lighting ───────────────────────── */}
        <div className="px-3 py-2.5" style={{ borderBottom: '1px solid #1e2a3a' }}>
          <div className="text-[9px] uppercase tracking-widest text-white/30 mb-2">
            Lighting Conditions
          </div>
          <div className="flex items-center gap-3 panel-inset p-2 rounded-sm" style={{ background: '#050505', border: '1px solid #1e2a3a' }}>
            <div className={`p-2 rounded-sm ${lc.bg}`}>
              <lc.Icon size={20} className={`${lc.color} transition-all duration-200`} />
            </div>
            <div className="flex-1">
              <div className={`text-[13px] font-bold tracking-wide ${lc.color}`}>
                {lc.label}
              </div>
              {sunriseSunset && (
                <div className="text-[10px] text-white/50 mt-0.5">
                  {sunriseSunset.minutesToNextTransition > 0 ? (
                    <span className="font-mono tabular-nums">
                      {sunriseSunset.minutesToNextTransition} min to {sunriseSunset.nextTransition}
                    </span>
                  ) : (
                    <span>Transition imminent</span>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* #43: Sunrise/sunset times with tabular-nums */}
          {sunriseSunset && (
            <div className="flex gap-4 mt-2 text-[10px] text-white/40 font-mono tabular-nums">
              <span>
                <Sun size={10} className="inline mr-1 text-amber-400/60" />
                {sunriseSunset.sunrise}
              </span>
              <span>
                <Moon size={10} className="inline mr-1 text-blue-400/60" />
                {sunriseSunset.sunset}
              </span>
            </div>
          )}
        </div>

        {/* ── Section 2: Weather ────────────────────────── */}
        <div className="px-3 py-2.5" style={{ borderBottom: '1px solid #1e2a3a' }}>
          <div className="text-[9px] uppercase tracking-widest text-white/30 mb-2">
            Weather
          </div>
          <div className="text-[12px] text-white/80 font-medium mb-2 border-l-2 border-[#999999] pl-2">
            {weatherHazards.description || 'No data'}
          </div>
          {hasHazards ? (
            <div className="flex flex-wrap gap-1.5">
              {/* #44: Hazard badges with rounded-sm for consistency */}
              {weatherHazards.freezing && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[9px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  <Snowflake size={10} className="animate-[spin_4s_linear_infinite]" />
                  FREEZING
                </span>
              )}
              {weatherHazards.highWind && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[9px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  <Wind size={10} />
                  HIGH WIND
                </span>
              )}
              {weatherHazards.rain && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[9px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  <CloudRain size={10} />
                  RAIN
                </span>
              )}
              {weatherHazards.snow && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[9px] font-semibold bg-sky-400/20 text-sky-200 border border-sky-400/30">
                  <CloudSnow size={10} />
                  SNOW
                </span>
              )}
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-semibold bg-green-500/15 text-green-400 border border-green-500/25">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              CLEAR CONDITIONS
            </div>
          )}
        </div>

        {/* ── Section 3: Wind ───────────────────────────── */}
        <div className="px-3 py-2.5" style={{ borderBottom: '1px solid #1e2a3a' }}>
          <div className="text-[9px] uppercase tracking-widest text-white/30 mb-2">
            Wind
          </div>
          {windCondition ? (
            <div className="flex items-center gap-4 panel-inset p-2 rounded-sm" style={{ background: '#050505', border: '1px solid #1e2a3a', borderLeft: '2px solid #22d3ee' }}>
              <div className="flex items-baseline gap-1">
                <span className="text-[20px] font-bold font-mono tabular-nums text-white/90">
                  {Math.round(windCondition.speed)}
                </span>
                <span className="text-[10px] text-white/40">mph</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-white/70">
                  {windCondition.cardinal}
                </span>
                {/* Wind compass */}
                <div
                  className="relative flex items-center justify-center"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.03)',
                  }}
                >
                  {/* Cardinal marks */}
                  <span className="absolute top-0.5 text-[6px] text-white/20">N</span>
                  <span className="absolute bottom-0.5 text-[6px] text-white/20">S</span>
                  <span className="absolute left-1 text-[6px] text-white/20">W</span>
                  <span className="absolute right-1 text-[6px] text-white/20">E</span>
                  <Navigation
                    size={14}
                    className="text-cyan-400 drop-shadow-[0_0_3px_rgba(34,211,238,0.5)]"
                    style={{
                      transform: `rotate(${windCondition.direction}deg)`,
                      transition: 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-white/30 italic">No wind data</div>
          )}
        </div>

        {/* ── Section 4: Visibility ─────────────────────── */}
        <div className="px-3 py-2.5" style={{ borderBottom: '1px solid #1e2a3a' }}>
          <div className="text-[9px] uppercase tracking-widest text-white/30 mb-2">
            Visibility
          </div>
          <div className="flex items-center gap-2 mb-1.5 border-l-2 border-[#999999] pl-2">
            <Eye size={13} className={visibilityColor(visibilityRange)} />
            <span className={`text-[14px] font-bold font-mono tabular-nums ${visibilityColor(visibilityRange)}`}>
              {formatVisibility(visibilityRange)}
            </span>
          </div>
          {/* Gauge bar */}
          <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${visibilityBarColor(visibilityRange)}`}
              style={{ width: `${visibilityPercent(visibilityRange)}%` }}
            />
          </div>
          {lowVisibility && (
            <div className="flex items-center gap-1.5 mt-1.5 text-[9px] text-red-400 font-semibold">
              <AlertTriangle size={10} />
              LOW VISIBILITY WARNING
            </div>
          )}
        </div>

        {/* ── Section 5: Active Alerts ──────────────────── */}
        {hasAlerts && (
          <div className="px-3 py-2.5">
            <div className="text-[9px] uppercase tracking-widest text-white/30 mb-2">
              Active Alerts
            </div>
            <div className="flex flex-col gap-1.5">
              {icyRoad && (
                <div
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm text-[10px] font-semibold text-blue-300"
                  style={{
                    background: 'rgba(59,130,246,0.08)',
                    borderLeft: '3px solid #888888',
                  }}
                >
                  <Snowflake size={12} className="text-blue-400" />
                  ICY ROADS
                </div>
              )}
              {schoolZoneActive && (
                <div
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm text-[10px] font-semibold text-amber-300"
                  style={{
                    background: 'rgba(245,158,11,0.08)',
                    borderLeft: '3px solid #f59e0b',
                  }}
                >
                  <School size={12} className="text-amber-400" />
                  SCHOOL ZONE ACTIVE
                </div>
              )}
              {lowVisibility && (
                <div
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm text-[10px] font-semibold text-red-300"
                  style={{
                    background: 'rgba(239,68,68,0.08)',
                    borderLeft: '3px solid #ef4444',
                  }}
                >
                  <Eye size={12} className="text-red-400" />
                  LOW VISIBILITY
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
