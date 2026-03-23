// ============================================================
// RMPG Flex — SafetyZonesPanel Component
// Floating summary panel for the map. Shows when the Safety
// Zones toggle is active — lists risk zones with aggregate
// stats for weapons, DV, and injury calls.
// ============================================================

import React from 'react';
import { X, ShieldAlert, AlertTriangle, Loader2 } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────

interface SafetyZone {
  latitude: number;
  longitude: number;
  risk_level: 'high' | 'moderate';
  weapons_count: number;
  dv_count: number;
  injuries_count: number;
  total_flagged: number;
}

interface SafetyZonesPanelProps {
  zones: SafetyZone[];
  loading: boolean;
  onClose: () => void;
}

// ─── Component ──────────────────────────────────────────────

export default function SafetyZonesPanel({
  zones,
  loading,
  onClose,
}: SafetyZonesPanelProps) {
  const highCount = zones.filter((z) => z.risk_level === 'high').length;
  const moderateCount = zones.filter((z) => z.risk_level === 'moderate').length;

  const totalWeapons = zones.reduce((s, z) => s + z.weapons_count, 0);
  const totalDV = zones.reduce((s, z) => s + z.dv_count, 0);
  const totalInjury = zones.reduce((s, z) => s + z.injuries_count, 0);

  return (
    <div className="panel-beveled bg-surface-base overflow-hidden" style={{ maxWidth: 280 }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: '#0d1520', borderBottom: '1px solid #1e2a3a' }}
      >
        <div className="flex items-center gap-2">
          <ShieldAlert size={14} className="text-red-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-rmpg-200">
            Safety Zones
          </span>
          <span className="text-[9px] font-mono text-rmpg-500">
            ({zones.length})
          </span>
        </div>
        <button
          onClick={onClose}
          className="toolbar-btn p-1"
          aria-label="Close safety zones panel"
          title="Close"
        >
          <X size={12} className="text-rmpg-400" />
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="p-2 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-4">
            <Loader2 size={14} className="animate-spin text-rmpg-400" />
            <span className="text-[9px] font-mono text-rmpg-500">Loading zones…</span>
          </div>
        ) : zones.length === 0 ? (
          <div className="py-4 text-center text-[9px] font-mono text-rmpg-500">
            No safety zones in view
          </div>
        ) : (
          <>
            {/* ── Risk summary ────────────────────────────── */}
            <div className="flex items-center gap-3 px-1">
              <div className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: '#ef4444' }}
                />
                <span className="text-[9px] font-mono text-red-400">
                  {highCount} High
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: '#f59e0b' }}
                />
                <span className="text-[9px] font-mono text-amber-400">
                  {moderateCount} Moderate
                </span>
              </div>
            </div>

            {/* ── Aggregate stats ─────────────────────────── */}
            <div
              className="grid grid-cols-3 gap-1 rounded-sm px-1 py-1.5"
              style={{ background: '#0d1520' }}
            >
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-rmpg-500">
                  Weapons
                </div>
                <div className="text-[9px] font-mono font-bold text-red-400">
                  {totalWeapons}
                </div>
              </div>
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-rmpg-500">
                  DV
                </div>
                <div className="text-[9px] font-mono font-bold text-amber-400">
                  {totalDV}
                </div>
              </div>
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-rmpg-500">
                  Injury
                </div>
                <div className="text-[9px] font-mono font-bold text-orange-400">
                  {totalInjury}
                </div>
              </div>
            </div>

            {/* ── Zone list ───────────────────────────────── */}
            <div
              className="max-h-40 space-y-1 overflow-y-auto pr-1"
              style={{ scrollbarWidth: 'thin' }}
            >
              {zones.map((zone, idx) => (
                <div
                  key={`${zone.latitude}-${zone.longitude}-${idx}`}
                  className="flex items-center justify-between rounded-sm px-2 py-1"
                  style={{
                    background: zone.risk_level === 'high' ? '#1a0a0a' : '#1a1508',
                    border: `1px solid ${zone.risk_level === 'high' ? '#3b1111' : '#3b2e0a'}`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    {zone.risk_level === 'high' ? (
                      <AlertTriangle size={10} className="text-red-500" />
                    ) : (
                      <AlertTriangle size={10} className="text-amber-500" />
                    )}
                    <span
                      className={`text-[9px] font-mono font-bold uppercase ${
                        zone.risk_level === 'high' ? 'text-red-400' : 'text-amber-400'
                      }`}
                    >
                      {zone.risk_level}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-rmpg-400">
                      {zone.total_flagged} flagged
                    </span>
                    <span className="text-[9px] font-mono text-rmpg-600">
                      {zone.latitude.toFixed(3)},{zone.longitude.toFixed(3)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
