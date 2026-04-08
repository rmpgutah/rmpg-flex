// ============================================================
// RMPG Flex — ThreatAssessmentPanel Component
// Floating panel for location-based threat assessment on the map.
// Shows threat score, factors, hazards, armed history, DV repeat
// locations, officer safety notes, and approach route recommendations.
// ============================================================

import React, { useState } from 'react';
import {
  X,
  Crosshair,
  MapPin,
  AlertTriangle,
  Navigation,
  Shield,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────

interface ThreatAssessmentPanelProps {
  assessment: {
    score: number;
    level: 'low' | 'moderate' | 'high' | 'critical';
    factors: string[];
    hazards: { lat: number; lng: number; type: string; description: string }[];
    armed_history: { lat: number; lng: number; incident_count: number; last_date: string }[];
    dv_repeat_locations: { lat: number; lng: number; call_count: number; address: string }[];
    recent_incidents: number;
    officer_safety_notes: string[];
  } | null;
  approachRoutes: {
    direction: string;
    heading: number;
    risk_level: 'low' | 'moderate' | 'high';
    notes: string;
  }[] | null;
  loading: boolean;
  onAssessCenter: () => void;
  onGetApproachRoutes: () => void;
  onClear: () => void;
  onClose: () => void;
}

// ─── Helpers ────────────────────────────────────────────────

const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  low: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e', border: '#22c55e' },
  moderate: { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b', border: '#f59e0b' },
  high: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444', border: '#ef4444' },
  critical: { bg: 'rgba(153,27,27,0.25)', text: '#fca5a5', border: '#991b1b' },
};

const RISK_COLORS: Record<string, string> = {
  low: '#22c55e',
  moderate: '#f59e0b',
  high: '#ef4444',
};

function scoreColor(score: number): string {
  if (score <= 25) return '#22c55e';
  if (score <= 50) return '#f59e0b';
  if (score <= 75) return '#ef4444';
  return '#991b1b';
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
      {/* #34: Section toggle with smooth chevron rotation */}
      <button type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full text-left py-1 hover:bg-[#141414]/30 rounded-sm transition-colors duration-100"
        aria-expanded={open}
      >
        <ChevronRight size={10} className="text-rmpg-500 transition-transform duration-200" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }} />
        <span className="text-[10px] font-bold uppercase tracking-widest text-rmpg-400">
          {title}
        </span>
      </button>
      {open && <div className="pl-1 pb-2">{children}</div>}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────

export default function ThreatAssessmentPanel({
  assessment,
  approachRoutes,
  loading,
  onAssessCenter,
  onGetApproachRoutes,
  onClear,
  onClose,
}: ThreatAssessmentPanelProps) {
  const levelStyle = assessment ? LEVEL_COLORS[assessment.level] : null;

  return (
    <div
      className="panel-beveled bg-surface-base flex flex-col overflow-hidden rounded-sm transition-all duration-200 ease-out shadow-lg backdrop-blur-sm"
      style={{ maxWidth: 300, maxHeight: '80vh' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ background: '#050505', borderBottom: '1px solid #1e2a3a' }}
      >
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-rmpg-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-rmpg-200">
            Threat Assessment
          </span>
        </div>
        <button type="button" onClick={onClose} className="toolbar-btn p-1 hover:bg-[#141414] transition-colors duration-150 rounded-sm" title="Close" aria-label="Close threat assessment">
          <X size={12} className="text-rmpg-400" />
        </button>
      </div>

      {/* Scrollable body */}
      <div
        className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent"
        style={{ scrollbarWidth: 'thin' }}
      >
        {/* ── Action Buttons ──────────────────────────────── */}
        <div className="flex gap-1">
          <button type="button"
            onClick={onAssessCenter}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-rmpg-200 transition-all duration-150 hover:text-white disabled:opacity-50 active:scale-[0.97]"
            style={{ background: '#141414', border: '1px solid #1e2a3a' }}
            aria-label="Assess threat at map center"
          >
            {loading ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Crosshair size={11} />
            )}
            Assess at Center
          </button>
          {assessment && (
            <button type="button"
              onClick={onClear}
              className="rounded-sm px-2 py-1.5 text-[10px] font-semibold text-rmpg-500 hover:text-rmpg-300 transition-colors"
              style={{ background: '#141414', border: '1px solid #1e2a3a' }}
            >
              Clear
            </button>
          )}
        </div>

        {/* ── No Assessment State ─────────────────────────── */}
        {!assessment && !loading && (
          <div className="text-[10px] text-rmpg-600 text-center py-4">
            Center the map on a location and click
            <br />
            &quot;Assess at Center&quot; to analyze threats
          </div>
        )}

        {/* ── Loading State ───────────────────────────────── */}
        {loading && !assessment && (
          <div className="flex flex-col items-center gap-2 py-6">
            <Loader2 size={20} className="animate-spin text-rmpg-400" />
            <span className="text-[10px] text-rmpg-500">Analyzing threat data...</span>
          </div>
        )}

        {/* ── Assessment Results ───────────────────────────── */}
        {assessment && (
          <>
            {/* Threat Score */}
            <Section title="Threat Score">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-baseline gap-0.5 rounded-sm px-2 py-1" style={{ background: `${scoreColor(assessment.score)}15` }}>
                    <span
                      className={`text-2xl font-bold tabular-nums font-mono ${assessment.level === 'critical' ? 'animate-pulse' : ''}`}
                      style={{ color: scoreColor(assessment.score), textShadow: `0 0 10px ${scoreColor(assessment.score)}30` }}
                    >
                      {assessment.score}
                    </span>
                    <span className="text-[10px] text-rmpg-600">/100</span>
                  </div>
                  <div
                    className="rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{
                      background: levelStyle?.bg,
                      color: levelStyle?.text,
                      border: `1px solid ${levelStyle?.border}`,
                    }}
                  >
                    {assessment.level}
                  </div>
                  <span className="text-[10px] text-rmpg-500 ml-auto tabular-nums font-bold text-white">
                    {assessment.recent_incidents} <span className="text-rmpg-500 font-normal">recent</span>
                  </span>
                </div>
                {/* Threat gauge bar */}
                <div className="h-1.5 rounded-sm overflow-hidden" style={{ background: '#1e1e1e' }}>
                  <div
                    className="h-full rounded-sm transition-all duration-500"
                    style={{ width: `${Math.min(assessment.score, 100)}%`, background: scoreColor(assessment.score) }}
                  />
                </div>
              </div>
            </Section>

            {/* Factors */}
            <Section title="Contributing Factors">
              {assessment.factors.length > 0 ? (
                <div className="space-y-0.5">
                  {assessment.factors.map((factor, i) => (
                    <div
                      key={`factor-${i}`}
                      className="flex items-start gap-1.5 text-[9px] font-mono text-rmpg-300"
                    >
                      <span className="text-rmpg-600 mt-px select-none">&bull;</span>
                      <span>{factor}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-rmpg-600">No contributing factors</div>
              )}
            </Section>

            {/* Officer Safety Notes */}
            {assessment.officer_safety_notes.length > 0 && (
              <Section title="Officer Safety Notes">
                <div className="space-y-1">
                  {assessment.officer_safety_notes.map((note, i) => (
                    <div
                      key={`note-${i}`}
                      className="flex items-start gap-1.5 text-[9px] font-mono"
                    >
                      <AlertTriangle
                        size={9}
                        className="text-amber-400 shrink-0 mt-px"
                      />
                      <span className="text-amber-300">{note}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Hazards */}
            {assessment.hazards.length > 0 && (
              <Section title="Nearby Hazards" defaultOpen={false}>
                <div className="space-y-1">
                  {assessment.hazards.map((hazard, i) => (
                    <div
                      key={`hazard-${i}`}
                      className="rounded-sm p-1.5 text-[9px] font-mono"
                      style={{ background: '#050505', border: '1px solid #1e2a3a' }}
                    >
                      <div className="flex items-center gap-1 text-rmpg-300">
                        <MapPin size={9} className="text-red-400 shrink-0" />
                        <span className="font-semibold text-rmpg-200 uppercase">
                          {(hazard.type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                        </span>
                      </div>
                      <div className="text-rmpg-400 mt-0.5 pl-3">
                        {hazard.description}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Armed History */}
            {assessment.armed_history.length > 0 && (
              <Section title="Armed History" defaultOpen={false}>
                <div className="space-y-1">
                  {assessment.armed_history.map((entry, i) => (
                    <div
                      key={`armed-${i}`}
                      className="flex items-center gap-1.5 text-[9px] font-mono hover:bg-[#141414]/50 rounded-sm px-1 -mx-1 transition-colors duration-150"
                    >
                      <span className="led-dot" style={{ background: '#ef4444' }} />
                      <span className="text-red-300 font-semibold tabular-nums">
                        {entry.incident_count}
                      </span>
                      <span className="text-rmpg-500">incidents</span>
                      <span className="text-rmpg-600 ml-auto tabular-nums">
                        {entry.last_date}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* DV Repeat Locations */}
            {assessment.dv_repeat_locations.length > 0 && (
              <Section title="DV Repeat Locations" defaultOpen={false}>
                <div className="space-y-1">
                  {assessment.dv_repeat_locations.map((loc, i) => (
                    <div
                      key={`dv-${i}`}
                      className="rounded-sm p-1.5 text-[9px] font-mono"
                      style={{ background: '#050505', border: '1px solid #1e2a3a' }}
                    >
                      <div className="flex items-center gap-1">
                        <AlertTriangle size={9} className="text-amber-400 shrink-0" />
                        <span className="text-rmpg-300 truncate">{loc.address}</span>
                      </div>
                      <div className="text-rmpg-500 pl-3 mt-0.5">
                        <span className="text-amber-300 font-semibold tabular-nums">
                          {loc.call_count}
                        </span>{' '}
                        previous calls
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Approach Routes ──────────────────────────── */}
            <Section title="Approach Routes">
              {!approachRoutes ? (
                <button type="button"
                  onClick={onGetApproachRoutes}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-rmpg-300 hover:text-white transition-all duration-150 disabled:opacity-50 active:scale-[0.97]"
                  style={{ background: '#141414', border: '1px solid #1e2a3a' }}
                  aria-label="Get approach routes"
                >
                  {loading ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Navigation size={11} />
                  )}
                  Get Approach Routes
                </button>
              ) : approachRoutes.length > 0 ? (
                <div className="space-y-1">
                  {approachRoutes.map((route, i) => {
                    const color = RISK_COLORS[route.risk_level] ?? '#888888';
                    return (
                      <div
                        key={`route-${i}`}
                        className="rounded-sm p-1.5"
                        style={{ background: '#050505', border: '1px solid #1e2a3a' }}
                      >
                        <div className="flex items-center gap-1.5">
                          <Navigation
                            size={11}
                            style={{
                              color,
                              transform: `rotate(${route.heading}deg)`,
                            }}
                          />
                          <span className="text-[10px] font-semibold text-rmpg-200 uppercase">
                            {route.direction}
                          </span>
                          <span
                            className="ml-auto rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase"
                            style={{
                              background: `${color}20`,
                              color,
                              border: `1px solid ${color}40`,
                            }}
                          >
                            {route.risk_level}
                          </span>
                        </div>
                        {route.notes && (
                          <div className="text-[9px] font-mono text-rmpg-400 mt-1 pl-4">
                            {route.notes}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[10px] text-rmpg-600">
                  No approach routes available
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
