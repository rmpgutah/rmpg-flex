// ============================================================
// RMPG Flex — Multi-Stop Patrol Route Panel
// ============================================================
// Floating panel for building an optimized one-unit-many-calls patrol
// route (PSO client requests, welfare checks, paper service, etc.).
// Queue calls from their popups, pick the responding unit, and let the
// Mapbox Optimization API solve the fastest visiting order.
// ============================================================

import { Route, X, Trash2, Zap, GripVertical } from 'lucide-react';
import type { MultiStopRoute } from '../../../hooks/useMapRouting';
import type { MapUnit } from '../utils/mapConstants';
import { UNIT_STATUS_HEX } from '../../../utils/statusColors';

export interface QueuedStop {
  callNumber: string;
  lat: number;
  lng: number;
  label?: string;
}

interface Props {
  queue: QueuedStop[];
  units: MapUnit[];
  selectedUnit: string | null;
  result: MultiStopRoute | null;
  loading: boolean;
  isMobile: boolean;
  onSelectUnit: (callSign: string) => void;
  onRemoveStop: (callNumber: string) => void;
  onClear: () => void;
  onOptimize: () => void;
}

const GOLD = '#d4a017';
const PANEL_BG = 'rgba(10,10,10,0.96)';

export default function MultiStopRoutePanel({
  queue,
  units,
  selectedUnit,
  result,
  loading,
  isMobile,
  onSelectUnit,
  onRemoveStop,
  onClear,
  onOptimize,
}: Props) {
  if (queue.length === 0) return null;

  // Units that can actually be an origin (valid GPS).
  const routableUnits = units.filter((u) => u.latitude != null && u.longitude != null);
  const canOptimize = queue.length >= 1 && !!selectedUnit && !loading;

  return (
    <div
      className="absolute z-[1001] backdrop-blur-md"
      style={{
        ...(isMobile
          ? { top: 56, left: 8, right: 8 }
          : { top: 64, right: 16, width: 300 }),
        background: PANEL_BG,
        border: `1px solid ${GOLD}55`,
        borderRadius: 2,
        boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
        fontFamily: "'JetBrains Mono','Courier New',monospace",
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderBottom: `1px solid ${GOLD}33`,
          background: `linear-gradient(to right, ${GOLD}12, transparent)`,
        }}
      >
        <Route className="w-3.5 h-3.5" style={{ color: GOLD }} />
        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', color: GOLD, flex: 1 }}>
          PATROL ROUTE
        </span>
        <span
          style={{
            fontSize: 8,
            fontWeight: 900,
            color: '#0a0a0a',
            background: GOLD,
            borderRadius: 2,
            padding: '1px 5px',
          }}
        >
          {queue.length} STOP{queue.length === 1 ? '' : 'S'}
        </span>
        <button
          onClick={onClear}
          aria-label="Clear patrol route"
          style={{ background: 'none', border: 'none', color: '#777', cursor: 'pointer', padding: 0, display: 'flex' }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Unit selector */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ fontSize: 7, color: '#777', letterSpacing: '0.06em', marginBottom: 3, textTransform: 'uppercase' }}>
          Responding Unit
        </div>
        {routableUnits.length === 0 ? (
          <div style={{ fontSize: 9, color: '#ef4444' }}>No units with GPS available</div>
        ) : (
          <select id="ff-multistoproutepanel-0"
            value={selectedUnit ?? ''}
            onChange={(e) => onSelectUnit(e.target.value)}
            style={{
              width: '100%',
              background: '#050505',
              color: '#e0e0e0',
              border: '1px solid #2e2e2e',
              borderRadius: 2,
              fontSize: 10,
              fontFamily: "'JetBrains Mono',monospace",
              padding: '4px 6px',
              outline: 'none',
            }}
          >
            <option value="" disabled>
              Select unit…
            </option>
            {routableUnits.map((u) => (
              <option key={u.id} value={u.call_sign}>
                {u.call_sign} — {u.officer_name || 'Unassigned'}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Stops list — optimized order if we have a result, else queue order */}
      <div style={{ maxHeight: isMobile ? 180 : 260, overflowY: 'auto' }} className="scrollbar-dark">
        {result
          ? result.stops.map((s) => (
              <div
                key={s.callNumber}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderBottom: '1px solid #141414',
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    borderRadius: 2,
                    border: `1.5px solid ${GOLD}`,
                    background: 'linear-gradient(180deg,#1a1a1a,#070707)',
                    color: GOLD,
                    fontSize: 10,
                    fontWeight: 900,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {s.order}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.callNumber}
                  </div>
                  {s.label && (
                    <div style={{ fontSize: 8, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.label}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 9, color: GOLD, fontWeight: 800 }}>{s.legEta}</div>
                  <div style={{ fontSize: 7, color: '#666' }}>{s.legDistance}</div>
                </div>
              </div>
            ))
          : queue.map((s) => (
              <div
                key={s.callNumber}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  borderBottom: '1px solid #141414',
                }}
              >
                <GripVertical className="w-3 h-3" style={{ color: '#444', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.callNumber}
                  </div>
                  {s.label && (
                    <div style={{ fontSize: 8, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.label}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onRemoveStop(s.callNumber)}
                  aria-label={`Remove ${s.callNumber}`}
                  style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 2, display: 'flex', flexShrink: 0 }}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
      </div>

      {/* Result totals */}
      {result && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
            padding: '8px 10px',
            borderTop: `1px solid ${GOLD}33`,
            background: `linear-gradient(to right, ${GOLD}10, transparent)`,
          }}
        >
          <span style={{ fontSize: 7, color: '#777', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Total</span>
          <span style={{ fontSize: 15, fontWeight: 900, color: GOLD }}>{result.totalEta}</span>
          <span style={{ fontSize: 10, color: '#999' }}>{result.totalDistance}</span>
        </div>
      )}

      {/* Action */}
      <div style={{ padding: '8px 10px' }}>
        <button
          onClick={onOptimize}
          disabled={!canOptimize}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '6px 8px',
            background: canOptimize ? GOLD : '#1a1a1a',
            color: canOptimize ? '#0a0a0a' : '#555',
            border: `1px solid ${canOptimize ? GOLD : '#2e2e2e'}`,
            borderRadius: 2,
            fontSize: 9,
            fontWeight: 900,
            letterSpacing: '0.06em',
            fontFamily: "'JetBrains Mono',monospace",
            cursor: canOptimize ? 'pointer' : 'not-allowed',
            textTransform: 'uppercase',
            transition: 'background 0.15s ease',
          }}
        >
          <Zap className="w-3 h-3" />
          {loading ? 'Optimizing…' : result ? 'Re-optimize' : 'Optimize & Route'}
        </button>
      </div>
    </div>
  );
}
