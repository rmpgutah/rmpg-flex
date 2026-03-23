// ============================================================
// RMPG Flex — PredictionsPanel Component
// Sidebar panel listing predicted incident hotspots with
// scores, incident counts, and navigation to each zone.
// ============================================================

import React from 'react';
import { Navigation, AlertTriangle, Loader2 } from 'lucide-react';
import type { PredictedHotspot } from '../hooks/useMapPredictions';

interface PredictionsPanelProps {
  hotspots: PredictedHotspot[];
  loading?: boolean;
  onNavigate: (lat: number, lng: number) => void;
  onClose?: () => void;
}

export default function PredictionsPanel({
  hotspots,
  loading,
  onNavigate,
  onClose,
}: PredictionsPanelProps) {
  return (
    <div className="panel-beveled bg-surface-base overflow-hidden" style={{ width: 280 }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: '#0d1520', borderBottom: '1px solid #1e2a3a' }}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-rmpg-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-rmpg-200">
            Predicted Hotspots
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="toolbar-btn p-1"
            title="Close"
          >
            <span className="text-rmpg-400 text-xs">&times;</span>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-2 space-y-1 max-h-[400px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {loading && (
          <div className="flex items-center justify-center py-6 text-rmpg-500">
            <Loader2 size={16} className="animate-spin" />
            <span className="ml-2 text-xs">Loading predictions...</span>
          </div>
        )}

        {!loading && hotspots.length === 0 && (
          <div className="text-center py-6 text-rmpg-600 text-xs">
            No predicted hotspots for this period.
          </div>
        )}

        {hotspots.map((hs, idx) => {
          const isHigh = hs.score > 50;
          const color = isHigh ? '#dc2626' : '#f59e0b';

          return (
            <div
              key={`${hs.latitude}-${hs.longitude}`}
              className="rounded-sm p-2"
              style={{
                background: '#0d1520',
                border: '1px solid #1e2a3a',
              }}
            >
              {/* Score badge + top types */}
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-bold"
                    style={{
                      background: `${color}22`,
                      color,
                      border: `1px solid ${color}44`,
                    }}
                  >
                    {hs.score}
                  </span>
                  <span className="text-xs text-rmpg-300 font-mono">
                    {hs.incident_count} incidents
                  </span>
                </div>
              </div>

              {/* Top types */}
              {hs.top_types && (
                <div className="text-[10px] text-rmpg-400 font-mono mb-1.5 truncate" title={hs.top_types}>
                  {hs.top_types}
                </div>
              )}

              {/* Stats row */}
              <div className="flex items-center gap-3 text-[10px] font-mono mb-1.5">
                {hs.weapons_count > 0 && (
                  <span className="text-red-400">
                    {hs.weapons_count} weapons
                  </span>
                )}
                {hs.dv_count > 0 && (
                  <span className="text-amber-400">
                    {hs.dv_count} DV
                  </span>
                )}
              </div>

              {/* Navigate button */}
              <button
                onClick={() => onNavigate(hs.latitude, hs.longitude)}
                className="toolbar-btn flex items-center gap-1.5 px-2 py-1 text-[10px] w-full justify-center"
                title="Center map on this hotspot"
              >
                <Navigation size={10} />
                <span>Navigate</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {hotspots.length > 0 && (
        <div
          className="px-3 py-1.5 text-[9px] text-rmpg-600 font-mono"
          style={{ borderTop: '1px solid #1e2a3a' }}
        >
          {hotspots.length} hotspot{hotspots.length !== 1 ? 's' : ''} predicted
        </div>
      )}
    </div>
  );
}
