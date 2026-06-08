// ============================================================
// RMPG Flex — SafetyDashboardPanel Component
// Collapsible safety metrics panel for the map. Shows real-time
// officer safety data: shift risk, threats, welfare, environment.
// ============================================================

import React, { useState } from 'react';
import {
  X,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Sun,
  Moon,
  Sunset,
  AlertTriangle,
  Shield,
  Eye,
  Crosshair,
  Users,
  Activity,
  Gauge,
  School,
  Wind,
  Snowflake,
  Clock,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────

interface ShiftRisk {
  shift_name: string;
  weapon_calls: number;
  dv_calls: number;
  injury_calls: number;
  drug_calls: number;
  active_warrants: number;
  officers_in_risk_zones: number;
  trend: string;
  alerts: string[];
}

interface EnvironmentData {
  lighting: string;
  sunriseSunset: {
    sunrise: string;
    sunset: string;
    minutesToTransition: number;
    nextTransition: string;
  } | null;
  lowVisibility: boolean;
  weatherHazards: string[];
  icyRoad: boolean;
  windCondition: { speed: number; direction: string } | null;
  visibilityRange: number;
  schoolZoneActive: boolean;
}

interface UnitSafety {
  loneOfficers: string[];
  exposureWarnings: { callSign: string; minutes: number }[];
  stationaryUnits: string[];
  speedAnomalies: { callSign: string; speed: number }[];
  coveragePercent: number;
}

interface SafetyDashboardProps {
  shiftRisk: ShiftRisk | null;
  environment: EnvironmentData;
  unitSafety: UnitSafety;
  onClose: () => void;
}

// ─── Helpers ────────────────────────────────────────────────

function riskScore(sr: ShiftRisk): number {
  return (
    sr.weapon_calls * 15 +
    sr.dv_calls * 10 +
    sr.injury_calls * 8 +
    sr.drug_calls * 5 +
    sr.active_warrants * 3 +
    sr.officers_in_risk_zones * 12
  );
}

function riskColor(score: number): string {
  if (score <= 25) return '#22c55e';
  if (score <= 50) return '#f59e0b';
  if (score <= 75) return '#ef4444';
  return '#991b1b';
}

function coverageColor(pct: number): string {
  if (pct >= 80) return '#22c55e';
  if (pct >= 60) return '#f59e0b';
  return '#ef4444';
}

// ─── Collapsible Section ────────────────────────────────────

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      {/* #29: Section toggle with smooth chevron rotation */}
      <button type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full text-left py-1 transition-all duration-150 active:scale-[0.97] hover:bg-[#181818]/30 rounded-sm"
        aria-expanded={open}
      >
        <ChevronRight size={10} className="text-rmpg-500 transition-transform duration-200" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-rmpg-400">
          {title}
        </span>
      </button>
      {open && <div className="pl-1 pb-2">{children}</div>}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────

export default function SafetyDashboardPanel({
  shiftRisk,
  environment,
  unitSafety,
  onClose,
}: SafetyDashboardProps) {
  const score = shiftRisk ? riskScore(shiftRisk) : 0;
  const color = riskColor(score);

  const TrendIcon =
    shiftRisk?.trend === 'increasing'
      ? TrendingUp
      : shiftRisk?.trend === 'decreasing'
        ? TrendingDown
        : ArrowRight;

  const LightingIcon =
    environment.lighting === 'daylight'
      ? Sun
      : environment.lighting === 'twilight'
        ? Sunset
        : Moon;

  return (
    <div
      className="panel-beveled bg-surface-base flex flex-col overflow-hidden transition-all duration-200 ease-out shadow-lg backdrop-blur-sm"
      style={{ maxWidth: 320, maxHeight: '80vh' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ background: '#050505', borderBottom: '1px solid #282828' }}
      >
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-rmpg-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-rmpg-200">
            Safety Dashboard
          </span>
        </div>
        <button type="button" onClick={onClose} className="toolbar-btn p-1 hover:bg-[#181818] transition-colors duration-150 rounded-sm" title="Close" aria-label="Close safety dashboard">
          <X size={12} className="text-rmpg-400" />
        </button>
      </div>

      {/* Scrollable body */}
      <div
        className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent"
        style={{ scrollbarWidth: 'thin' }}
      >
        {/* ── Section 1: Shift Risk Score ──────────────────── */}
        <Section title="Shift Risk Score">
          {shiftRisk ? (
            <div className="flex items-center gap-3">
              {/* Gauge arc */}
              <div className="relative" style={{ width: 56, height: 56 }}>
                <svg viewBox="0 0 56 56" role="img" aria-label={`Risk score gauge: ${score}`} className="w-full h-full" style={{ filter: `drop-shadow(0 0 4px ${color}30)` }}>
                  {/* Background arc */}
                  <circle
                    cx="28"
                    cy="28"
                    r="22"
                    fill="none"
                    stroke="#1e1e1e"
                    strokeWidth="5"
                    strokeDasharray="103.67 138.23"
                    strokeLinecap="round"
                    transform="rotate(135 28 28)"
                  />
                  {/* Value arc */}
                  <circle
                    cx="28"
                    cy="28"
                    r="22"
                    fill="none"
                    stroke={color}
                    strokeWidth="5"
                    strokeDasharray={`${Math.min(score, 100) * 1.0367} 138.23`}
                    strokeLinecap="round"
                    transform="rotate(135 28 28)"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-sm font-bold ${score > 75 ? 'animate-pulse' : ''}`} style={{ color, textShadow: `0 0 8px ${color}40` }}>
                    {score}
                  </span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-rmpg-200 font-semibold truncate">
                  {shiftRisk.shift_name}
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <TrendIcon size={11} style={{ color }} />
                  <span className="text-[10px] capitalize" style={{ color }}>
                    {shiftRisk.trend}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-[10px] text-rmpg-600">No shift data</div>
          )}
        </Section>

        {/* ── Section 2: Active Threats ────────────────────── */}
        <Section title="Active Threats">
          <div className="grid grid-cols-2 gap-1">
            <ThreatCard
              label="Weapon"
              count={shiftRisk?.weapon_calls ?? 0}
              ledColor="#ef4444"
            />
            <ThreatCard
              label="DV"
              count={shiftRisk?.dv_calls ?? 0}
              ledColor="#f59e0b"
            />
            <ThreatCard
              label="Injury"
              count={shiftRisk?.injury_calls ?? 0}
              ledColor="#f97316"
            />
            <ThreatCard
              label="Drug"
              count={shiftRisk?.drug_calls ?? 0}
              ledColor="#a855f7"
            />
          </div>
          {shiftRisk && shiftRisk.active_warrants > 0 && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-rmpg-300">
              <AlertTriangle size={10} className="text-red-500" />
              <span>{shiftRisk.active_warrants} active warrants in area</span>
            </div>
          )}
        </Section>

        {/* ── Section 3: Officer Welfare ───────────────────── */}
        <Section title="Officer Welfare">
          <div className="space-y-1">
            {/* Lone officers */}
            <WelfareRow
              icon={<Users size={10} />}
              label="Lone officers"
              value={unitSafety?.loneOfficers?.length ?? 0}
              warn={(unitSafety?.loneOfficers?.length ?? 0) > 0}
              detail={
                (unitSafety?.loneOfficers?.length ?? 0) > 0
                  ? unitSafety.loneOfficers.join(', ')
                  : undefined
              }
            />

            {/* Risk zones */}
            <WelfareRow
              icon={<Crosshair size={10} />}
              label="In risk zones"
              value={shiftRisk?.officers_in_risk_zones ?? 0}
              warn={(shiftRisk?.officers_in_risk_zones ?? 0) > 0}
            />

            {/* Stationary */}
            {(unitSafety?.stationaryUnits?.length ?? 0) > 0 && (
              <WelfareRow
                icon={<Clock size={10} />}
                label="Stationary"
                value={unitSafety.stationaryUnits.length}
                warn
                detail={unitSafety.stationaryUnits.join(', ')}
              />
            )}

            {/* Speed anomalies */}
            {(unitSafety?.speedAnomalies ?? []).map((sa) => (
              <div
                key={sa.callSign}
                className="flex items-center gap-1 text-[10px]"
              >
                <span className="led-dot led-red" />
                <span className="text-red-400 font-semibold">
                  {sa.callSign}
                </span>
                <span className="text-rmpg-500">{sa.speed} mph</span>
              </div>
            ))}

            {/* Exposure warnings */}
            {(unitSafety?.exposureWarnings ?? []).map((ew) => (
              <div
                key={ew.callSign}
                className="flex items-center gap-1 text-[10px]"
              >
                <Activity size={9} className="text-amber-500" />
                <span className="text-rmpg-300">{ew.callSign}</span>
                <span className="text-amber-400">{ew.minutes}m exposure</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Section 4: Environment ───────────────────────── */}
        <Section title="Environment">
          <div className="space-y-1">
            {/* Lighting */}
            <div className="flex items-center gap-2">
              <LightingIcon size={12} className="text-rmpg-300" />
              <span className="text-xs text-rmpg-200 capitalize">
                {environment.lighting}
              </span>
              {environment.sunriseSunset && (
                <span className="text-[10px] text-rmpg-500 ml-auto">
                  {environment.sunriseSunset.nextTransition} in{' '}
                  {environment.sunriseSunset.minutesToTransition}m
                </span>
              )}
            </div>

            {/* Weather hazards */}
            {environment.weatherHazards.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {environment.weatherHazards.map((h) => (
                  <span
                    key={h}
                    className="rounded-sm px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
                    style={{ background: 'rgba(245,158,11,0.15)' }}
                  >
                    {h}
                  </span>
                ))}
              </div>
            )}

            {/* Icy roads */}
            {environment.icyRoad && (
              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                <Snowflake size={10} />
                <span>Icy road conditions</span>
              </div>
            )}

            {/* Wind */}
            {environment.windCondition && (
              <div className="flex items-center gap-1 text-[10px] text-rmpg-300">
                <Wind size={10} />
                <span>
                  {environment.windCondition.speed} mph{' '}
                  {environment.windCondition.direction}
                </span>
              </div>
            )}

            {/* Visibility */}
            <div className="flex items-center gap-1 text-[10px] text-rmpg-300">
              <Eye size={10} />
              <span>
                Visibility: {environment.visibilityRange} mi
                {environment.lowVisibility && (
                  <span className="text-amber-400 ml-1">(Low)</span>
                )}
              </span>
            </div>

            {/* School zone */}
            {environment.schoolZoneActive && (
              <div className="flex items-center gap-1">
                <span
                  className="rounded-sm px-1.5 py-0.5 text-[10px] font-bold text-yellow-200"
                  style={{ background: 'rgba(234,179,8,0.2)' }}
                >
                  <School size={9} className="inline mr-1" />
                  SCHOOL ZONE ACTIVE
                </span>
              </div>
            )}
          </div>
        </Section>

        {/* ── Section 5: Coverage ──────────────────────────── */}
        <Section title="Coverage">
          <div className="flex items-center gap-2">
            <Gauge size={14} style={{ color: coverageColor(unitSafety.coveragePercent) }} />
            <div className="flex-1 h-2 rounded-sm overflow-hidden" style={{ background: '#1e1e1e' }}>
              <div
                className="h-full rounded-sm transition-all duration-500"
                style={{
                  width: `${Math.min(unitSafety.coveragePercent, 100)}%`,
                  background: coverageColor(unitSafety.coveragePercent),
                }}
              />
            </div>
            <span
              className="text-xs font-bold tabular-nums"
              style={{ color: coverageColor(unitSafety.coveragePercent) }}
            >
              {unitSafety.coveragePercent}%
            </span>
          </div>
        </Section>

        {/* ── Section 6: Alerts History ────────────────────── */}
        {shiftRisk && shiftRisk.alerts.length > 0 && (
          <Section title="Alerts History" defaultOpen={false}>
            <div
              className="space-y-0.5 max-h-[120px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent"
              style={{ scrollbarWidth: 'thin' }}
            >
              {shiftRisk.alerts.map((alert, i) => (
                <div
                  key={`alert-${i}-${alert.slice(0, 20)}`}
                  className="text-[10px] text-rmpg-400 pl-2"
                  style={{
                    borderLeft: '2px solid #282828',
                  }}
                >
                  {alert}
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function ThreatCard({
  label,
  count,
  ledColor,
}: {
  label: string;
  count: number;
  ledColor: string;
}) {
  return (
    <div
      className="rounded-sm p-1.5 flex items-center gap-1.5 transition-all duration-150 hover:border-[#3c3c3c]"
      style={{ background: '#050505', border: '1px solid #282828' }}
    >
      <span className="led-dot" style={{ background: count > 0 ? ledColor : '#444444' }} />
      <span className="text-sm font-bold text-rmpg-200 tabular-nums">{count}</span>
      <span className="text-[10px] text-rmpg-500">{label}</span>
    </div>
  );
}

function WelfareRow({
  icon,
  label,
  value,
  warn,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  warn?: boolean;
  detail?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px]">
        {warn ? (
          <span className="text-amber-400">{icon}</span>
        ) : (
          <span className="text-rmpg-500">{icon}</span>
        )}
        <span className={warn ? 'text-amber-300' : 'text-rmpg-400'}>{label}</span>
        <span
          className={`ml-auto font-bold tabular-nums ${warn ? 'text-amber-300' : 'text-rmpg-300'}`}
        >
          {value}
        </span>
      </div>
      {detail && (
        <div className="text-[10px] text-rmpg-500 pl-3 truncate">{detail}</div>
      )}
    </div>
  );
}
