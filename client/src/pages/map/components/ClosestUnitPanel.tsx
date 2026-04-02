// ============================================================
// RMPG Flex — Closest Unit Panel
// Floating panel showing the closest available units to a
// dispatch call. Renders on the right side of the map.
// ============================================================

import React, { useState } from 'react';
import { X, Navigation, Loader2 } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { formatIncidentType } from '../../../utils/caseNumbers';
import { UNIT_STATUS_HEX, UNIT_STATUS_LABELS, PRIORITY_HEX } from '../../../utils/statusColors';
import type { ActiveCall } from '../utils/mapConstants';
import type { ClosestUnitResult } from '../hooks/useClosestUnit';

interface ClosestUnitPanelProps {
  call: ActiveCall;
  results: ClosestUnitResult[];
  onClose: () => void;
  onDispatchSuccess?: () => void;
}

export default function ClosestUnitPanel({
  call,
  results,
  onClose,
  onDispatchSuccess,
}: ClosestUnitPanelProps) {
  const [dispatchingUnitId, setDispatchingUnitId] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [dispatchedUnits, setDispatchedUnits] = useState<Set<string>>(new Set());

  const pColor = PRIORITY_HEX[call.priority] || '#6b7280';

  const handleDispatch = async (unitId: string) => {
    setDispatchingUnitId(unitId);
    setDispatchError(null);

    try {
      const res = await apiFetch<{ error?: string }>(`/dispatch/calls/${call.id}/assign-unit`, {
        method: 'POST',
        body: JSON.stringify({ unit_id: Number(unitId) }),
      });

      if (res && typeof res === 'object' && 'error' in res && res.error) {
        setDispatchError(String(res.error));
      } else {
        setDispatchedUnits(prev => new Set(prev).add(unitId));
        onDispatchSuccess?.();
      }
    } catch (err: any) {
      setDispatchError(err?.message || 'Failed to dispatch unit');
    } finally {
      setDispatchingUnitId(null);
    }
  };

  return (
    <div
      role="complementary"
      aria-label="Closest unit panel"
      className="absolute z-[1002] flex flex-col transition-all duration-200 ease-out shadow-lg"
      style={{
        top: 48,
        right: 12,
        width: 320,
        maxHeight: 'calc(100% - 64px)',
        background: '#0d1520',
        border: `1px solid ${pColor}40`,
        borderRadius: 2,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        fontFamily: "'Courier New','JetBrains Mono',monospace",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid #1e304860' }}
      >
        <Navigation className="w-3.5 h-3.5 shrink-0" style={{ color: '#60a5fa' }} />
        <span
          className="text-[10px] font-black uppercase tracking-wider flex-1"
          style={{ color: '#60a5fa', letterSpacing: '0.8px' }}
        >
          Closest Units
        </span>
        <button type="button"
          onClick={onClose}
          aria-label="Close closest units panel"
          className="p-0.5 hover:bg-[#1a2636] transition-all duration-150 active:scale-[0.97] rounded-sm"
          style={{ borderRadius: 2 }}
        >
          <X className="w-3.5 h-3.5 text-rmpg-500 hover:text-white" />
        </button>
      </div>

      {/* Call Info */}
      <div
        className="px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid #1e304830', background: '#141e2b' }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[9px] font-black px-1.5 py-0.5"
            style={{
              background: pColor,
              color: '#fff',
              borderRadius: 2,
              letterSpacing: '0.5px',
            }}
          >
            {call.priority}
          </span>
          <span className="text-[11px] font-bold" style={{ color: pColor }}>
            {call.call_number}
          </span>
        </div>
        <div className="text-[9px] font-semibold" style={{ color: '#e5e7eb' }}>
          {formatIncidentType(call.incident_type)}
        </div>
        <div className="text-[8px] mt-0.5" style={{ color: '#9ca3af' }}>
          {call.location_address}
        </div>
      </div>

      {/* Results List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent">
        {results.length === 0 ? (
          <div className="flex flex-col items-center text-center py-8 gap-2">
            <Navigation className="w-6 h-6" style={{ color: '#5a6e80', opacity: 0.4 }} />
            <div className="text-[10px] font-bold" style={{ color: '#5a6e80' }}>
              No available units found
            </div>
            <div className="text-[8px]" style={{ color: '#5a6e80' }}>
              All units are currently assigned or have no position data
            </div>
          </div>
        ) : (
          results.map((result, idx) => {
            const { unit, distanceMiles, estimatedMinutes } = result;
            const statusColor = UNIT_STATUS_HEX[unit.status] || '#6b7280';
            const statusLabel = UNIT_STATUS_LABELS[unit.status] || unit.status;
            const isDispatching = dispatchingUnitId === unit.id;
            const isDispatched = dispatchedUnits.has(unit.id);

            return (
              <div
                key={unit.id}
                className="px-3 py-2 hover:bg-[#1a2636]/30 transition-colors duration-100"
                style={{
                  borderBottom: idx < results.length - 1 ? '1px solid #1e304820' : undefined,
                  background: idx % 2 === 0 ? '#0d1520' : '#111b28',
                }}
              >
                <div className="flex items-center gap-2">
                  {/* Rank */}
                  <span
                    className="text-[8px] font-black w-4 text-center shrink-0"
                    style={{ color: '#5a6e80' }}
                  >
                    #{idx + 1}
                  </span>

                  {/* Status LED */}
                  <span
                    className="shrink-0"
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: statusColor,
                      boxShadow: `0 0 8px ${statusColor}80, 0 0 3px ${statusColor}40`,
                      border: `1px solid ${statusColor}60`,
                    }}
                  />

                  {/* Call Sign + Officer */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-black" style={{ color: statusColor }}>
                        {unit.call_sign}
                      </span>
                      <span
                        className="text-[7px] font-bold uppercase px-1 py-px"
                        style={{
                          background: `${statusColor}20`,
                          color: statusColor,
                          border: `1px solid ${statusColor}40`,
                          borderRadius: 2,
                          letterSpacing: '0.5px',
                        }}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <div
                      className="text-[9px] truncate"
                      style={{ color: '#9ca3af' }}
                    >
                      {unit.officer_name}
                    </div>
                  </div>

                  {/* #42: Distance + ETA with tabular-nums for alignment */}
                  <div className="text-right shrink-0">
                    <div className="text-[10px] font-bold font-mono tabular-nums" style={{ color: '#60a5fa' }}>
                      {distanceMiles < 0.1
                        ? '<0.1 mi'
                        : `${distanceMiles.toFixed(1)} mi`}
                    </div>
                    <div className="text-[8px] font-semibold font-mono tabular-nums" style={{ color: estimatedMinutes < 5 ? '#f59e0b' : '#9ca3af' }}>
                      ~{estimatedMinutes < 1
                        ? '<1 min'
                        : `${Math.round(estimatedMinutes)} min`}
                    </div>
                  </div>
                </div>

                {/* Dispatch Button */}
                <div className="mt-1.5 flex justify-end">
                  {isDispatched ? (
                    <span
                      className="text-[8px] font-black uppercase tracking-wider px-2 py-1"
                      style={{
                        color: '#22c55e',
                        background: '#22c55e15',
                        border: '1px solid #22c55e40',
                        borderRadius: 2,
                      }}
                    >
                      Dispatched
                    </span>
                  ) : (
                    <button type="button"
                      onClick={() => handleDispatch(unit.id)}
                      disabled={isDispatching}
                      aria-label={`Dispatch unit ${unit.call_sign}`}
                      className="flex items-center gap-1 px-2 py-1 transition-all duration-150 active:scale-[0.97] hover:brightness-125"
                      style={{
                        background: isDispatching ? '#88888820' : '#88888830',
                        border: '1px solid #88888880',
                        color: '#60a5fa',
                        fontSize: 8,
                        fontWeight: 900,
                        fontFamily: "'Courier New','JetBrains Mono',monospace",
                        cursor: isDispatching ? 'wait' : 'pointer',
                        letterSpacing: '0.5px',
                        textTransform: 'uppercase',
                        borderRadius: 2,
                        opacity: isDispatching ? 0.6 : 1,
                      }}
                    >
                      {isDispatching ? (
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      ) : (
                        <span>&#9654;</span>
                      )}
                      Dispatch
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Error */}
      {dispatchError && (
        <div
          className="px-3 py-2 shrink-0 text-[9px] font-bold"
          style={{
            color: '#ef4444',
            background: '#ef444410',
            borderTop: '1px solid #ef444430',
          }}
        >
          {dispatchError}
        </div>
      )}

      {/* Footer */}
      <div
        className="px-3 py-1.5 text-[7px] font-bold uppercase tracking-wider shrink-0"
        style={{
          color: '#5a6e80',
          borderTop: '1px solid #1e304830',
          background: '#141e2b',
          letterSpacing: '0.8px',
        }}
      >
        ETA is approximate ({'\u2248'}30 mph straight-line)
      </div>
    </div>
  );
}
