// ============================================================
// RMPG Flex — Radar 360º Panel
// ============================================================
// Situational-awareness display: a polar SVG sweep showing nearby
// calls, flagged persons, stolen vehicles, active units, and recent
// incidents plotted at their true bearing and distance from a center
// coordinate. Operator can adjust radius and filter by category.
//
// SVG polar math:
//   bearing 0° = North (top). Cartesian: x = cx + r·sin(θ), y = cy - r·cos(θ)
//   where θ = bearing in radians. Negative y because SVG flips the axis.
// ============================================================

import React, { useMemo, useState, useCallback } from 'react';
import {
  ScanLine, RefreshCw, AlertTriangle, Loader2,
  Radio, Car, User, Map, FileText, Wifi,
} from 'lucide-react';
import PanelTitleBar from './PanelTitleBar';
import IconButton from './IconButton';
import Radar360SignalsPanel from './Radar360SignalsPanel';
import type { RadarContact, ContactKind, UseRadar360Result } from '../hooks/useRadar360';

// ── Design tokens (theme-variable-backed, never hardcode hex) ──
const KIND_CONFIG: Record<ContactKind, {
  label: string;
  Icon: React.ElementType;
  dot: string;   // tailwind text-* or inline style color var
  ring: string;  // ring color var
}> = {
  call:     { label: 'Calls',    Icon: Radio,    dot: 'var(--sev-critical)', ring: 'var(--sev-critical)' },
  person:   { label: 'Persons',  Icon: User,     dot: 'var(--sev-warn)',     ring: 'var(--sev-warn)' },
  vehicle:  { label: 'Vehicles', Icon: Car,      dot: 'var(--sev-high)',     ring: 'var(--sev-high)' },
  unit:     { label: 'Units',    Icon: Map,      dot: 'var(--brand-400)',    ring: 'var(--brand-400)' },
  incident: { label: 'Incidents',Icon: FileText, dot: 'var(--text-muted)',   ring: 'var(--text-muted)' },
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: 'var(--sev-critical)',
  P2: 'var(--sev-high)',
  P3: 'var(--sev-warn)',
  P4: 'var(--text-muted)',
};

// ── Polar helpers ──────────────────────────────────────────

const SVG_SIZE = 240;
const CX = SVG_SIZE / 2;
const CY = SVG_SIZE / 2;
const MAX_R = SVG_SIZE / 2 - 16; // leave margin for labels

function polarToCartesian(bearingDeg: number, distFraction: number): { x: number; y: number } {
  const θ = (bearingDeg * Math.PI) / 180;
  const r = distFraction * MAX_R;
  return { x: CX + r * Math.sin(θ), y: CY - r * Math.cos(θ) };
}

// ── Contact dot ───────────────────────────────────────────

interface ContactDotProps {
  contact: RadarContact;
  radiusMi: number;
  selected: boolean;
  onSelect: (c: RadarContact) => void;
}

function ContactDot({ contact, radiusMi, selected, onSelect }: ContactDotProps) {
  const frac = Math.min(contact.distanceMi / radiusMi, 1);
  const { x, y } = polarToCartesian(contact.bearing, frac);
  const cfg = KIND_CONFIG[contact.kind];
  const hasSafetyFlag = contact.flags.includes('OFFICER SAFETY') || contact.flags.includes('STOLEN');
  const dotColor = hasSafetyFlag ? 'var(--sev-critical)' : cfg.dot;
  const r = selected ? 6 : hasSafetyFlag ? 5 : 4;

  return (
    <g
      role="button"
      aria-label={`${contact.kind}: ${contact.label}`}
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(contact)}
    >
      {selected && (
        <circle cx={x} cy={y} r={r + 4} fill="none" stroke={dotColor} strokeWidth={1.5} opacity={0.5} />
      )}
      {hasSafetyFlag && !selected && (
        <circle cx={x} cy={y} r={r + 3} fill="none" stroke={dotColor} strokeWidth={1} opacity={0.4}>
          <animate attributeName="r" values={`${r + 2};${r + 5};${r + 2}`} dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx={x} cy={y} r={r} fill={dotColor} opacity={0.9} />
      {/* Priority ring for calls */}
      {contact.kind === 'call' && contact.priority && (
        <circle
          cx={x} cy={y} r={r + 2}
          fill="none"
          stroke={PRIORITY_COLORS[contact.priority] ?? 'var(--text-muted)'}
          strokeWidth={1.5}
          opacity={0.7}
        />
      )}
    </g>
  );
}

// ── Main component ────────────────────────────────────────

type Tab = 'radar' | 'signals';

interface Props {
  radar: UseRadar360Result;
  /** Optional label for the scan center (e.g. call number, address). */
  centerLabel?: string;
  onClose?: () => void;
}

export default function Radar360Panel({ radar, centerLabel, onClose }: Props) {
  const {
    filtered, loading, error, scannedAt, refresh,
    visibleKinds, toggleKind, flaggedOnly, setFlaggedOnly,
    radiusMi, setRadiusMi,
    lat, lng, callId,
  } = radar;

  const [activeTab, setActiveTab] = useState<Tab>('radar');
  const [selected, setSelected] = useState<RadarContact | null>(null);

  const selectContact = useCallback((c: RadarContact) => {
    setSelected((prev) => (prev?.id === c.id && prev?.kind === c.kind ? null : c));
  }, []);

  // Compass ring labels (N/E/S/W + tick marks)
  const compassTicks = useMemo(() => {
    const dirs = [
      { deg: 0, label: 'N' }, { deg: 90, label: 'E' },
      { deg: 180, label: 'S' }, { deg: 270, label: 'W' },
    ];
    const minors = [45, 135, 225, 315];
    return { dirs, minors };
  }, []);

  // Time since scan
  const ageSec = scannedAt ? Math.round((Date.now() - scannedAt.getTime()) / 1000) : null;
  const ageLabel = ageSec == null ? '--' : ageSec < 10 ? 'just now' : `${ageSec}s ago`;

  const RADIUS_OPTIONS = [0.25, 0.5, 1, 2, 3, 5];

  return (
    <div
      className="bg-surface-base border border-border-default flex flex-col select-none"
      style={{ borderRadius: 2, width: 320, minHeight: 400 }}
    >
      {/* Title bar */}
      <PanelTitleBar
        title="RADAR 360°"
        icon={ScanLine}
        windowChrome
        onClose={onClose}
        statusLed={error ? 'red' : loading ? 'amber' : 'green'}
        ledPulse={loading}
      >
        <IconButton
          aria-label="Refresh radar scan"
          onClick={refresh}
          disabled={loading}
          className="ml-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </IconButton>
      </PanelTitleBar>

      {/* Tab bar */}
      <div className="flex border-b border-border-default">
        {([
          { id: 'radar' as Tab, label: 'Radar', Icon: ScanLine },
          { id: 'signals' as Tab, label: 'Signals', Icon: Wifi },
        ]).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold transition-colors"
            style={{
              borderBottom: activeTab === id ? '2px solid var(--brand-400)' : '2px solid transparent',
              color: activeTab === id ? 'var(--brand-400)' : 'var(--text-muted)',
            }}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Signals tab */}
      {activeTab === 'signals' && (
        <div className="px-3 py-2 flex-1 overflow-hidden">
          <Radar360SignalsPanel
            lat={lat ?? null}
            lng={lng ?? null}
            radiusMi={radiusMi}
            callId={callId ?? null}
          />
        </div>
      )}

      {/* Radar tab content (hidden when signals tab active) */}
      {activeTab === 'radar' && (<>

      {/* Scan metadata */}
      <div className="px-3 py-1.5 border-b border-border-default flex items-center justify-between gap-2">
        <span className="text-[9px] text-muted font-mono">
          {centerLabel ? <span className="text-brand-400 mr-1">{centerLabel}</span> : null}
          {ageLabel}
        </span>
        {error && (
          <span className="flex items-center gap-1 text-[9px]" style={{ color: 'var(--sev-critical)' }}>
            <AlertTriangle className="w-3 h-3" />scan failed
          </span>
        )}
        {/* Radius selector */}
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-muted">R:</span>
          {RADIUS_OPTIONS.map((r) => (
            <button
              key={r}
              onClick={() => setRadiusMi(r)}
              className="text-[9px] px-1 font-mono transition-colors"
              style={{
                color: radiusMi === r ? 'var(--panel-header-color)' : 'var(--text-muted)',
                fontWeight: radiusMi === r ? 700 : 400,
              }}
              aria-label={`Set radius to ${r} miles`}
            >
              {r < 1 ? `${r * 5280 / 1000 | 0}k` : `${r}mi`}
            </button>
          ))}
        </div>
      </div>

      {/* Radar display */}
      <div className="flex justify-center py-2 relative">
        {loading && filtered.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--brand-400)' }} />
          </div>
        )}
        <svg
          width={SVG_SIZE}
          height={SVG_SIZE}
          aria-label="Radar 360 display"
          role="img"
        >
          {/* Range rings */}
          {[0.25, 0.5, 0.75, 1].map((frac) => (
            <circle
              key={frac}
              cx={CX} cy={CY}
              r={frac * MAX_R}
              fill="none"
              stroke="var(--border-default)"
              strokeWidth={frac === 1 ? 1 : 0.5}
              opacity={frac === 1 ? 0.6 : 0.3}
            />
          ))}

          {/* Crosshairs */}
          <line x1={CX} y1={CY - MAX_R} x2={CX} y2={CY + MAX_R} stroke="var(--border-default)" strokeWidth={0.5} opacity={0.3} />
          <line x1={CX - MAX_R} y1={CY} x2={CX + MAX_R} y2={CY} stroke="var(--border-default)" strokeWidth={0.5} opacity={0.3} />

          {/* Diagonal ticks (NE/SE/SW/NW) */}
          {compassTicks.minors.map((deg) => {
            const outer = polarToCartesian(deg, 1);
            const inner = polarToCartesian(deg, 0.92);
            return <line key={deg} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="var(--border-default)" strokeWidth={0.5} opacity={0.3} />;
          })}

          {/* Compass labels */}
          {compassTicks.dirs.map(({ deg, label }) => {
            const pos = polarToCartesian(deg, 1.12);
            return (
              <text
                key={label}
                x={pos.x} y={pos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={8}
                fontFamily="Arial, sans-serif"
                fill="var(--text-muted)"
                opacity={0.8}
              >
                {label}
              </text>
            );
          })}

          {/* Range labels */}
          <text x={CX + 4} y={CY - MAX_R * 0.5 - 2} fontSize={7} fill="var(--text-muted)" opacity={0.5} fontFamily="Arial, sans-serif">
            {(radiusMi * 0.5).toFixed(1)}mi
          </text>
          <text x={CX + 4} y={CY - MAX_R + 8} fontSize={7} fill="var(--text-muted)" opacity={0.5} fontFamily="Arial, sans-serif">
            {radiusMi}mi
          </text>

          {/* Sweep animation — decorative */}
          {loading && (
            <line
              x1={CX} y1={CY}
              x2={CX} y2={CY - MAX_R}
              stroke="var(--brand-400)"
              strokeWidth={1}
              opacity={0.4}
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`0 ${CX} ${CY}`}
                to={`360 ${CX} ${CY}`}
                dur="2s"
                repeatCount="indefinite"
              />
            </line>
          )}

          {/* Center dot */}
          <circle cx={CX} cy={CY} r={4} fill="var(--brand-400)" opacity={0.9} />
          <circle cx={CX} cy={CY} r={7} fill="none" stroke="var(--brand-400)" strokeWidth={1} opacity={0.4} />

          {/* Contact dots */}
          {filtered.map((c) => (
            <ContactDot
              key={`${c.kind}-${c.id}`}
              contact={c}
              radiusMi={radiusMi}
              selected={selected?.id === c.id && selected?.kind === c.kind}
              onSelect={selectContact}
            />
          ))}
        </svg>
      </div>

      {/* Kind filter chips */}
      <div className="px-3 pb-2 flex flex-wrap gap-1">
        {(['call', 'person', 'vehicle', 'unit', 'incident'] as ContactKind[]).map((kind) => {
          const cfg = KIND_CONFIG[kind];
          const active = visibleKinds.has(kind);
          const count = filtered.filter((c) => c.kind === kind).length;
          return (
            <button
              key={kind}
              onClick={() => toggleKind(kind)}
              className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold border transition-all"
              style={{
                borderRadius: 2,
                borderColor: active ? cfg.dot : 'var(--border-default)',
                background: active ? `color-mix(in srgb, ${cfg.dot} 15%, transparent)` : 'transparent',
                color: active ? cfg.dot : 'var(--text-muted)',
              }}
              aria-pressed={active}
              aria-label={`Toggle ${cfg.label} (${count})`}
            >
              <cfg.Icon className="w-2.5 h-2.5" />
              {cfg.label}
              {count > 0 && <span className="ml-0.5 opacity-70">{count}</span>}
            </button>
          );
        })}
        <button
          onClick={() => setFlaggedOnly(!flaggedOnly)}
          className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold border transition-all"
          style={{
            borderRadius: 2,
            borderColor: flaggedOnly ? 'var(--sev-critical)' : 'var(--border-default)',
            background: flaggedOnly ? 'color-mix(in srgb, var(--sev-critical) 15%, transparent)' : 'transparent',
            color: flaggedOnly ? 'var(--sev-critical)' : 'var(--text-muted)',
          }}
          aria-pressed={flaggedOnly}
          aria-label="Show flagged contacts only"
        >
          <AlertTriangle className="w-2.5 h-2.5" />
          Flagged only
        </button>
      </div>

      {/* Selected contact detail */}
      {selected && (
        <div
          className="mx-3 mb-2 px-2 py-1.5 border text-[10px] space-y-0.5"
          style={{ borderRadius: 2, borderColor: KIND_CONFIG[selected.kind].dot }}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold" style={{ color: 'var(--panel-header-color)' }}>
              {selected.label}
            </span>
            <span className="font-mono text-muted">{selected.distanceMi} mi</span>
          </div>
          {selected.sublabel && (
            <div className="text-muted">{selected.sublabel}</div>
          )}
          <div className="flex flex-wrap gap-1 mt-0.5">
            <span className="font-mono text-muted">{Math.round(selected.bearing)}° · {selected.kind}</span>
            {selected.priority && (
              <span className="font-semibold px-1" style={{ color: PRIORITY_COLORS[selected.priority] }}>
                {selected.priority}
              </span>
            )}
            {selected.flags.map((f) => (
              <span key={f} className="px-1 text-[9px] font-bold" style={{ color: 'var(--sev-critical)' }}>
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Contact list (compact) */}
      {filtered.length > 0 && (
        <div className="border-t border-border-default mx-3 mb-2">
          <div className="max-h-28 overflow-y-auto space-y-px pt-1">
            {filtered.slice(0, 12).map((c) => {
              const cfg = KIND_CONFIG[c.kind];
              const isSelected = selected?.id === c.id && selected?.kind === c.kind;
              return (
                <button
                  key={`${c.kind}-${c.id}`}
                  onClick={() => selectContact(c)}
                  className="w-full flex items-center gap-1.5 px-1 py-0.5 text-left transition-colors hover:bg-surface-raised"
                  style={{
                    background: isSelected ? 'color-mix(in srgb, var(--brand-400) 10%, transparent)' : undefined,
                    borderRadius: 2,
                  }}
                  aria-label={`Select ${c.kind}: ${c.label}`}
                >
                  <cfg.Icon className="w-3 h-3 shrink-0" style={{ color: cfg.dot }} aria-hidden="true" />
                  <span className="text-[10px] flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                    {c.label}
                  </span>
                  {c.flags.slice(0, 1).map((f) => (
                    <span key={f} className="text-[8px] font-bold shrink-0" style={{ color: 'var(--sev-critical)' }}>{f}</span>
                  ))}
                  <span className="text-[9px] font-mono shrink-0 text-muted">{c.distanceMi}mi</span>
                </button>
              );
            })}
            {filtered.length > 12 && (
              <div className="text-[9px] text-muted text-center py-0.5">
                +{filtered.length - 12} more
              </div>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 && !loading && (
        <div className="text-center text-[10px] text-muted pb-3 px-3">
          {lat == null
            ? 'No scan center — right-click the map to set a position'
            : `No contacts within ${radiusMi} mi`}
        </div>
      )}

      {/* Total count footer */}
      <div className="border-t border-border-default px-3 py-1 flex items-center justify-between">
        <span className="text-[9px] text-muted font-mono">
          {filtered.length} contact{filtered.length !== 1 ? 's' : ''}
        </span>
        <span className="text-[9px] text-muted font-mono">{radiusMi} mi radius</span>
      </div>

      </>)}
    </div>
  );
}
