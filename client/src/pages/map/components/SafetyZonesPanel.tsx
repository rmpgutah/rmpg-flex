// ============================================================
// RMPG Flex — SafetyZonesPanel Component
// Floating safety zone analysis panel. Shows risk zones with
// aggregate stats, incident breakdowns, days filter, refresh,
// and navigate-to-zone capability.
// ============================================================

import React from 'react';
import { X, ShieldAlert, AlertTriangle, Loader2, RefreshCw, MapPin, Crosshair, Swords, Heart, Scale } from 'lucide-react';
import { parseTimestamp } from '../../../utils/dateUtils';

// ─── Types ──────────────────────────────────────────────────

interface SafetyZone {
  latitude: number;
  longitude: number;
  risk_level: 'high' | 'moderate';
  weapons_count: number;
  dv_count: number;
  injuries_count: number;
  total_flagged: number;
  last_incident?: string;
  incident_types?: string;
}

interface SafetyZonesPanelProps {
  zones: SafetyZone[];
  loading: boolean;
  days: number;
  onDaysChange: (d: number) => void;
  onRefresh: () => void;
  onNavigate: (lat: number, lng: number) => void;
  onClose: () => void;
}

// ─── Component ──────────────────────────────────────────────

export default function SafetyZonesPanel({
  zones,
  loading,
  days,
  onDaysChange,
  onRefresh,
  onNavigate,
  onClose,
}: SafetyZonesPanelProps) {
  const highCount = zones.filter((z) => z.risk_level === 'high').length;
  const moderateCount = zones.filter((z) => z.risk_level === 'moderate').length;

  const totalWeapons = zones.reduce((s, z) => s + z.weapons_count, 0);
  const totalDV = zones.reduce((s, z) => s + z.dv_count, 0);
  const totalInjury = zones.reduce((s, z) => s + z.injuries_count, 0);
  const totalFlagged = zones.reduce((s, z) => s + z.total_flagged, 0);

  return (
    <div className="panel-beveled bg-surface-base overflow-hidden transition-all duration-200 ease-out shadow-lg backdrop-blur-sm" style={{ maxWidth: 300 }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: '#050505', borderBottom: '1px solid #282828' }}
      >
        <div className="flex items-center gap-2">
          <ShieldAlert size={14} className="text-red-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-rmpg-200">
            Safety Zones
          </span>
          {zones.length > 0 && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-red-900/30 text-red-400">
              {zones.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button type="button"
            onClick={onRefresh}
            className="toolbar-btn p-1 hover:bg-[#181818] transition-all duration-150 active:scale-[0.97] rounded-sm"
            title="Refresh"
            aria-label="Refresh safety zones"
          >
            <RefreshCw size={11} className={`text-rmpg-400 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button type="button"
            onClick={onClose}
            className="toolbar-btn p-1 hover:bg-[#181818] transition-colors duration-150 rounded-sm"
            title="Close"
            aria-label="Close safety zones panel"
          >
            <X size={12} className="text-rmpg-400" />
          </button>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="p-2 space-y-2">
        {/* ── Days filter ─────────────────────────────────── */}
        <div className="flex items-center gap-1">
          <span className="text-[7px] text-rmpg-500 uppercase font-bold w-8">Range:</span>
          {[30, 60, 90, 180, 365].map((d) => (
            <button type="button"
              key={d}
              onClick={() => onDaysChange(d)}
              className={`px-1.5 py-0.5 text-[7px] font-mono font-bold rounded-sm transition-all duration-150 active:scale-[0.97] ${
                days === d
                  ? 'bg-red-900/50 text-red-400 border border-red-700/50'
                  : 'text-rmpg-500 hover:text-rmpg-300'
              }`}
            >
              {d < 365 ? `${d}d` : '1y'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-4">
            <Loader2 size={14} className="animate-spin text-rmpg-400" />
            <span className="text-[9px] font-mono text-rmpg-500">Analyzing zones…</span>
          </div>
        ) : zones.length === 0 ? (
          <div className="py-4 text-center text-[9px] font-mono text-rmpg-500 border border-dashed border-[#2b2b2b] rounded-sm mx-1">
            <div className="text-rmpg-600 mb-1">No flagged zones found</div>
            <div className="text-[8px] text-rmpg-600">Try expanding the date range or refreshing</div>
          </div>
        ) : (
          <>
            {/* ── Risk summary ────────────────────────────── */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-3">
                {/* #51: Risk summary dots with LED glow */}
                <div className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#ef4444', boxShadow: '0 0 6px #ef444480' }} />
                  <span className="text-[10px] font-mono font-bold text-red-400 tabular-nums">{highCount}</span>
                  <span className="text-[8px] text-rmpg-500">HIGH</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#f59e0b', boxShadow: '0 0 6px #f59e0b80' }} />
                  <span className="text-[10px] font-mono font-bold text-amber-400 tabular-nums">{moderateCount}</span>
                  <span className="text-[8px] text-rmpg-500">MOD</span>
                </div>
              </div>
              <span className="text-[9px] font-mono text-rmpg-400">{totalFlagged} total incidents</span>
            </div>

            {/* ── Aggregate stats ─────────────────────────── */}
            <div
              className="grid grid-cols-3 gap-1 rounded-sm px-1 py-2"
              style={{ background: '#050505', border: '1px solid #282828' }}
            >
              <div className="text-center">
                <Swords size={12} className="text-red-400 mx-auto mb-0.5" />
                <div className="text-[12px] font-mono font-black text-red-400">{totalWeapons}</div>
                <div className="text-[7px] uppercase tracking-wider text-rmpg-500">Weapons</div>
              </div>
              <div className="text-center">
                <Heart size={12} className="text-amber-400 mx-auto mb-0.5" />
                <div className="text-[12px] font-mono font-black text-amber-400">{totalDV}</div>
                <div className="text-[7px] uppercase tracking-wider text-rmpg-500">DV</div>
              </div>
              <div className="text-center">
                <Scale size={12} className="text-orange-400 mx-auto mb-0.5" />
                <div className="text-[12px] font-mono font-black text-orange-400">{totalInjury}</div>
                <div className="text-[7px] uppercase tracking-wider text-rmpg-500">Injury</div>
              </div>
            </div>

            {/* ── Zone list ───────────────────────────────── */}
            <div className="text-[8px] text-rmpg-500 uppercase tracking-widest font-bold px-1">Zones</div>
            <div className="max-h-52 space-y-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent" style={{ scrollbarWidth: 'thin' }}>
              {zones.map((zone, idx) => {
                const isHigh = zone.risk_level === 'high';
                const color = isHigh ? '#ef4444' : '#f59e0b';
                const types = zone.incident_types?.split(',').slice(0, 3).map(t => t.trim()).filter(Boolean) || [];
                const lastDate = zone.last_incident ? parseTimestamp(zone.last_incident).toLocaleDateString() : null;

                return (
                  <button type="button"
                    key={`${zone.latitude}-${zone.longitude}-${idx}`}
                    onClick={() => onNavigate(zone.latitude, zone.longitude)}
                    className="w-full text-left rounded-sm px-2 py-1.5 transition-all duration-150 hover:brightness-125 active:scale-[0.97]"
                    aria-label={`Navigate to ${zone.risk_level} risk zone with ${zone.total_flagged} incidents`}
                    style={{
                      background: isHigh ? '#1a0808' : '#1a1508',
                      border: `1px solid ${isHigh ? '#3b1111' : '#3b2e0a'}`,
                      borderLeft: `3px solid ${color}`,
                    }}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={10} style={{ color }} />
                        <span className="text-[9px] font-mono font-bold uppercase" style={{ color }}>
                          {zone.risk_level}
                        </span>
                        {isHigh && <span className="led-dot led-red animate-led-pulse" style={{ width: 4, height: 4 }} />}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono font-bold text-rmpg-300">
                          {zone.total_flagged}
                        </span>
                        <MapPin size={9} className="text-rmpg-500" />
                      </div>
                    </div>
                    {/* Stat pills */}
                    <div className="flex items-center gap-1 flex-wrap">
                      {zone.weapons_count > 0 && (
                        <span className="text-[7px] font-mono px-1 py-0 rounded-sm bg-red-900/40 text-red-400">
                          {zone.weapons_count} wpn
                        </span>
                      )}
                      {zone.dv_count > 0 && (
                        <span className="text-[7px] font-mono px-1 py-0 rounded-sm bg-amber-900/40 text-amber-400">
                          {zone.dv_count} DV
                        </span>
                      )}
                      {zone.injuries_count > 0 && (
                        <span className="text-[7px] font-mono px-1 py-0 rounded-sm bg-orange-900/40 text-orange-400">
                          {zone.injuries_count} inj
                        </span>
                      )}
                      {lastDate && (
                        <span className="text-[7px] font-mono text-rmpg-600 ml-auto">
                          {lastDate}
                        </span>
                      )}
                    </div>
                    {/* Incident types */}
                    {types.length > 0 && (
                      <div className="text-[7px] font-mono text-rmpg-500 mt-0.5 truncate">
                        {types.join(' · ')}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
