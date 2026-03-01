// ============================================================
// RMPG Flex — Smart Unit Recommendation Panel
// Ranked list of available units sorted by proximity to a call.
// Shows distance/ETA for each unit with one-click assignment.
// Replaces the flat dropdown in the Assigned Units section.
// ============================================================

import React, { useMemo } from 'react';
import { Navigation, MapPin, Clock, Star, PlusCircle, Plus } from 'lucide-react';
import type { Unit } from '../types';
import { formatLabel } from '../utils/formatters';
import { rankUnits, type RankedUnit } from '../utils/unitRecommendation';

interface UnitRecommendationPanelProps {
  units: Unit[];
  callLat: number | null | undefined;
  callLng: number | null | undefined;
  assignedUnitIds: string[];
  onAssign: (unitId: string) => void;
  onCreateUnit?: () => void;
  onClose?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  available: '#22c55e',
  dispatched: '#f59e0b',
  enroute: '#3b82f6',
  onscene: '#a855f7',
  busy: '#ef4444',
};

export default function UnitRecommendationPanel({
  units,
  callLat,
  callLng,
  assignedUnitIds,
  onAssign,
  onCreateUnit,
  onClose,
}: UnitRecommendationPanelProps) {
  const ranked = useMemo(
    () => rankUnits(units, callLat, callLng, assignedUnitIds),
    [units, callLat, callLng, assignedUnitIds]
  );

  if (ranked.length === 0) {
    return (
      <div className="unit-rec-panel">
        <div className="unit-rec-header">
          <span className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider">No Units Available</span>
        </div>
        {onCreateUnit && (
          <button
            onClick={(e) => { e.stopPropagation(); onCreateUnit(); }}
            className="flex items-center gap-1 px-3 py-2 text-[10px] text-brand-400 hover:text-brand-300 font-bold w-full"
          >
            <Plus style={{ width: 10, height: 10 }} /> Create New Unit
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="unit-rec-panel">
      {/* Header */}
      <div className="unit-rec-header">
        <div className="flex items-center gap-1.5">
          <Navigation style={{ width: 10, height: 10, color: '#4ade80' }} />
          <span className="text-[10px] font-bold text-green-400 uppercase tracking-wider">
            Recommended Units
          </span>
        </div>
        <span className="text-[9px] text-rmpg-500">{ranked.length} available</span>
      </div>

      {/* Unit list */}
      <div className="unit-rec-list">
        {ranked.map((item: RankedUnit) => {
          const isTopPick = item.rank === 1 && item.unit.status === 'available';
          const statusColor = STATUS_COLORS[item.unit.status] || '#888';

          return (
            <div
              key={item.unit.id}
              className={`unit-rec-item ${isTopPick ? 'unit-rec-top-pick' : ''}`}
            >
              {/* Rank badge */}
              <div className="unit-rec-rank" style={{ color: isTopPick ? '#4ade80' : '#6b7280' }}>
                {isTopPick ? (
                  <Star style={{ width: 10, height: 10, fill: '#4ade80' }} />
                ) : (
                  <span className="text-[9px] font-bold">#{item.rank}</span>
                )}
              </div>

              {/* Status dot + Unit info */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span
                  className="flex-shrink-0 rounded-full"
                  style={{ width: 6, height: 6, background: statusColor }}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-white font-mono">
                      {item.unit.call_sign}
                    </span>
                    {item.unit.status !== 'available' && (
                      <span
                        className="text-[8px] uppercase font-bold px-1"
                        style={{ color: statusColor }}
                      >
                        {item.unit.status === 'onscene' ? 'ON SCN' : formatLabel(item.unit.status)}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-rmpg-400 truncate block">
                    {item.unit.officer_name || 'Unassigned'}
                  </span>
                </div>
              </div>

              {/* Distance / ETA */}
              {item.hasGps && (
                <div className="flex flex-col items-end flex-shrink-0 mr-2">
                  <div className="flex items-center gap-1 text-[10px] text-rmpg-300">
                    <MapPin style={{ width: 8, height: 8 }} />
                    <span className="font-mono">{item.distance.toFixed(1)} mi</span>
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-rmpg-500">
                    <Clock style={{ width: 7, height: 7 }} />
                    <span>~{Math.max(1, Math.round(item.eta))} min</span>
                  </div>
                </div>
              )}

              {/* Assign button */}
              <button
                onClick={(e) => { e.stopPropagation(); onAssign(item.unit.id); }}
                className={`unit-rec-assign-btn ${isTopPick ? 'unit-rec-assign-top' : ''}`}
                title={`Assign ${item.unit.call_sign}`}
              >
                <PlusCircle style={{ width: 10, height: 10 }} />
                <span>Assign</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {onCreateUnit && (
        <div className="unit-rec-footer">
          <button
            onClick={(e) => { e.stopPropagation(); onCreateUnit(); }}
            className="flex items-center gap-1 text-[10px] text-amber-500 hover:text-amber-400 font-bold"
          >
            <Plus style={{ width: 10, height: 10 }} /> Create New Unit
          </button>
        </div>
      )}
    </div>
  );
}
