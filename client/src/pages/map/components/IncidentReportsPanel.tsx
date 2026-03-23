// ============================================================
// RMPG Flex — IncidentReportsPanel Component
// Floating summary panel shown when the Incident Reports
// toggle is active on the map. Displays count + days range
// and directs users to click map markers for details.
// ============================================================

import React from 'react';
import { X, FileText, Info } from 'lucide-react';

interface IncidentReportsPanelProps {
  count: number;
  loading: boolean;
  days: number;
  onClose: () => void;
}

export default function IncidentReportsPanel({
  count,
  loading,
  days,
  onClose,
}: IncidentReportsPanelProps) {
  return (
    <div className="panel-beveled bg-surface-base overflow-hidden" style={{ maxWidth: 260 }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: '#0d1520', borderBottom: '1px solid #1e2a3a' }}
      >
        <div className="flex items-center gap-2">
          <FileText size={12} className="text-emerald-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-rmpg-200 font-mono">
            Incident Reports
          </span>
          {!loading && (
            <span
              className="text-[9px] font-mono font-bold text-emerald-300 bg-emerald-900/40 px-1.5 py-0.5 rounded"
              style={{ minWidth: 20, textAlign: 'center' }}
            >
              {count}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="toolbar-btn p-1"
          aria-label="Close incident reports panel"
          title="Close"
        >
          <X size={12} className="text-rmpg-400" />
        </button>
      </div>

      {/* Summary */}
      <div className="px-3 py-2 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 py-2">
            <div className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-[9px] font-mono text-rmpg-500">Loading reports...</span>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] font-mono text-rmpg-500 uppercase">Total</span>
              <span className="text-[9px] font-mono font-bold text-emerald-300">{count}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] font-mono text-rmpg-500 uppercase">Range</span>
              <span className="text-[9px] font-mono text-rmpg-300">
                Last {days} day{days !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        )}

        {/* Info note */}
        <div
          className="flex items-start gap-1.5 px-2 py-1.5 rounded"
          style={{ background: '#0d1520', border: '1px solid #1e2a3a' }}
        >
          <Info size={10} className="text-emerald-500 mt-0.5 shrink-0" />
          <span className="text-[9px] font-mono text-rmpg-500 leading-tight">
            Click markers on map for details
          </span>
        </div>
      </div>
    </div>
  );
}
