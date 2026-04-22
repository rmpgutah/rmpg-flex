// ============================================================
// RMPG Flex — Route Comparison Panel
// Side-by-side stats for two selected unit trails. Both trails
// are already rendered on the map via the breadcrumb effect;
// this panel is purely the numeric comparison — distance,
// duration, max speed, avg speed, point count — with a Δ column
// so supervisors can see at a glance "who covered more ground,
// who was faster, who was idle longer".
//
// Purely derived from the trails array passed in. No fetch, no
// side effects. Parent (MapPage) controls which units are picked
// so persistence + keyboard shortcuts can hook in later.
// ============================================================

import React from 'react';
import { X } from 'lucide-react';
import type { UnitTrail } from '../utils/trailStats';
import { computeTrailStats } from '../utils/trailStats';

interface Props {
  trails: UnitTrail[];
  unitAId: string | number | null;
  unitBId: string | number | null;
  onChangeA: (id: string | number | null) => void;
  onChangeB: (id: string | number | null) => void;
  onClose: () => void;
}

function formatMiles(m: number): string { return `${(m / 1609.344).toFixed(2)} mi`; }
function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}
function formatMph(mps: number | null): string {
  return mps == null ? '—' : `${Math.round(mps * 2.23694)} mph`;
}

/** Diff label — signed prefix, muted zero. */
function signed(delta: number, unit: string): string {
  if (Math.abs(delta) < 0.001) return `±0 ${unit}`;
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(delta).toFixed(unit === 'mi' ? 2 : 0)} ${unit}`;
}

export default function RouteComparePanel({
  trails,
  unitAId,
  unitBId,
  onChangeA,
  onChangeB,
  onClose,
}: Props) {
  const a = trails.find((t) => String(t.unit_id) === String(unitAId)) || null;
  const b = trails.find((t) => String(t.unit_id) === String(unitBId)) || null;
  const statsA = a ? computeTrailStats(a) : null;
  const statsB = b ? computeTrailStats(b) : null;

  return (
    <div
      className="absolute z-[999]"
      style={{
        bottom: 48,
        right: 16,
        minWidth: 320,
        maxWidth: 380,
        background: 'rgba(6,12,20,0.95)',
        border: '1px solid #d4a01780',
        padding: '8px 12px',
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        fontSize: 10,
        color: '#d1d5db',
        letterSpacing: '0.04em',
        borderRadius: 2,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ color: '#d4a017', fontWeight: 900, letterSpacing: '0.15em' }}>COMPARE TRAILS</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close route comparison"
          style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: 0 }}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {trails.length < 2 ? (
        <div style={{ fontSize: 9, color: '#6b7280', fontStyle: 'italic' }}>
          Need at least 2 tracked units to compare.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 8, color: '#5a6e80', fontWeight: 900, marginBottom: 2 }}>UNIT A</div>
              <select
                value={unitAId == null ? '' : String(unitAId)}
                onChange={(e) => onChangeA(e.target.value || null)}
                style={{
                  width: '100%',
                  background: '#141414',
                  border: '1px solid #2b2b2b',
                  color: '#d1d5db',
                  fontSize: 10,
                  fontFamily: 'inherit',
                  padding: '2px 4px',
                  borderRadius: 2,
                }}
                aria-label="Select unit A"
              >
                <option value="">— pick a unit —</option>
                {trails.map((t) => (
                  <option key={t.unit_id} value={t.unit_id}>
                    {t.call_sign}{t.officer_name ? ` · ${t.officer_name}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 8, color: '#5a6e80', fontWeight: 900, marginBottom: 2 }}>UNIT B</div>
              <select
                value={unitBId == null ? '' : String(unitBId)}
                onChange={(e) => onChangeB(e.target.value || null)}
                style={{
                  width: '100%',
                  background: '#141414',
                  border: '1px solid #2b2b2b',
                  color: '#d1d5db',
                  fontSize: 10,
                  fontFamily: 'inherit',
                  padding: '2px 4px',
                  borderRadius: 2,
                }}
                aria-label="Select unit B"
              >
                <option value="">— pick a unit —</option>
                {trails.map((t) => (
                  <option key={t.unit_id} value={t.unit_id}>
                    {t.call_sign}{t.officer_name ? ` · ${t.officer_name}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!statsA || !statsB ? (
            <div style={{ fontSize: 9, color: '#6b7280', fontStyle: 'italic' }}>
              Pick two units to see the comparison.
            </div>
          ) : (
            <div style={{ borderTop: '1px solid #2b2b2b', paddingTop: 6 }}>
              <Row label="Distance"  aVal={formatMiles(statsA.distanceMeters)} bVal={formatMiles(statsB.distanceMeters)}
                   delta={signed((statsA.distanceMeters - statsB.distanceMeters) / 1609.344, 'mi')} />
              <Row label="Duration"  aVal={formatDuration(statsA.durationSec)} bVal={formatDuration(statsB.durationSec)}
                   delta={signed((statsA.durationSec - statsB.durationSec) / 60, 'min')} />
              <Row label="Max speed" aVal={formatMph(statsA.maxSpeedMps)}     bVal={formatMph(statsB.maxSpeedMps)}
                   delta={signed(((statsA.maxSpeedMps || 0) - (statsB.maxSpeedMps || 0)) * 2.23694, 'mph')} />
              <Row label="Avg speed" aVal={formatMph(statsA.avgSpeedMps)}     bVal={formatMph(statsB.avgSpeedMps)}
                   delta={signed((statsA.avgSpeedMps - statsB.avgSpeedMps) * 2.23694, 'mph')} />
              <Row label="Points"    aVal={String(statsA.pointCount)}         bVal={String(statsB.pointCount)}
                   delta={signed(statsA.pointCount - statsB.pointCount, 'pts')} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, aVal, bVal, delta }: { label: string; aVal: string; bVal: string; delta: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '70px 1fr 1fr 1fr',
        gap: 4,
        padding: '2px 0',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <span style={{ color: '#5a6e80', fontWeight: 900, fontSize: 9 }}>{label.toUpperCase()}</span>
      <span style={{ color: '#d1d5db' }}>{aVal}</span>
      <span style={{ color: '#d1d5db' }}>{bVal}</span>
      <span style={{ color: delta.startsWith('+') ? '#22c55e' : delta.startsWith('−') ? '#ef4444' : '#6b7280' }}>{delta}</span>
    </div>
  );
}
