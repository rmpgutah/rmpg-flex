import React from 'react';
import { X, Loader2 } from 'lucide-react';

export interface AssignmentProposal {
  callId: number;
  incidentNumber: string;
  address: string;
  priority: string;
  suggestedUnit: string;     // unit call_sign
  suggestedUnitId: number;
  currentAssignment: string | null;
  eta: string;               // ISO datetime
  changed: boolean;          // different from current assignment
}

interface Props {
  proposals: AssignmentProposal[];
  droppedServices: string[];  // call ids that couldn't be assigned
  accepted: Set<number>;      // callIds user has accepted
  onToggle: (callId: number) => void;
  onApplyAll: () => void;
  onClose: () => void;
  applying: boolean;
}

const DENVER_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function formatEta(iso: string): string {
  try {
    return DENVER_FMT.format(new Date(iso)); // new-date-ok — iso is a Mapbox ISO 8601 string
  } catch {
    return iso;
  }
}

const PRIORITY_STYLE: Record<string, string> = {
  P1: 'text-red-400',
  P2: 'text-amber-400',
  P3: 'text-rmpg-300',
  P4: 'text-green-400',
};

export default function AssignmentProposalModal({
  proposals,
  droppedServices,
  accepted,
  onToggle,
  onApplyAll,
  onClose,
  applying,
}: Props) {
  const changed = proposals.filter((p) => p.changed);
  const unchanged = proposals.filter((p) => !p.changed);
  const acceptedCount = accepted.size;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div
        className="bg-surface-raised border border-rmpg-700 flex flex-col w-full max-w-4xl mx-4 max-h-[80vh]"
        style={{ borderRadius: 2 }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 border-b border-rmpg-700 flex-shrink-0"
          style={{ background: 'var(--surface-deep)' }}
        >
          <span className="text-sm font-bold text-rmpg-100 tracking-wide">Assignment Suggestions</span>
          <button
            type="button"
            onClick={onClose}
            className="text-rmpg-400 hover:text-rmpg-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Summary strip */}
        <div
          className="px-4 py-1.5 border-b border-rmpg-700 flex items-center gap-3 text-[10px] font-mono flex-shrink-0"
          style={{ background: 'var(--surface-sunken)' }}
        >
          <span className="text-rmpg-300">
            <strong className="text-rmpg-100">{proposals.length}</strong> calls optimized
          </span>
          <span className="text-rmpg-600">·</span>
          <span className="text-rmpg-300">
            <strong className="text-amber-400">{changed.length}</strong> changed
          </span>
          <span className="text-rmpg-600">·</span>
          <span className="text-rmpg-300">
            <strong className={droppedServices.length > 0 ? 'text-red-400' : 'text-rmpg-400'}>{droppedServices.length}</strong> dropped
          </span>
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-[11px] font-mono border-collapse">
            <thead className="sticky top-0" style={{ background: 'var(--surface-deep)' }}>
              <tr className="text-[9px] font-semibold text-rmpg-400 uppercase">
                <th className="text-left px-3 py-[3px] border-b border-rmpg-700">PRI</th>
                <th className="text-left px-3 py-[3px] border-b border-rmpg-700">CALL</th>
                <th className="text-left px-3 py-[3px] border-b border-rmpg-700">ADDRESS</th>
                <th className="text-left px-3 py-[3px] border-b border-rmpg-700">SUGGESTED UNIT</th>
                <th className="text-left px-3 py-[3px] border-b border-rmpg-700">ETA</th>
                <th className="text-left px-3 py-[3px] border-b border-rmpg-700">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr
                  key={p.callId}
                  className={`border-b border-rmpg-800 hover:bg-rmpg-900/30 transition-colors ${
                    accepted.has(p.callId) ? 'bg-blue-900/10' : ''
                  }`}
                >
                  <td className={`px-3 py-[2px] font-bold ${PRIORITY_STYLE[p.priority] ?? 'text-rmpg-300'}`}>
                    {p.priority}
                  </td>
                  <td className="px-3 py-[2px] text-rmpg-200">{p.incidentNumber}</td>
                  <td className="px-3 py-[2px] text-rmpg-300 max-w-[200px] truncate" title={p.address}>
                    {p.address}
                  </td>
                  <td className="px-3 py-[2px]">
                    <span className="text-rmpg-100 font-semibold">{p.suggestedUnit}</span>
                    {p.changed && p.currentAssignment && (
                      <span className="ml-1.5 text-rmpg-500 line-through">{p.currentAssignment}</span>
                    )}
                  </td>
                  <td className="px-3 py-[2px] text-rmpg-300">{formatEta(p.eta)}</td>
                  <td className="px-3 py-[2px]">
                    {p.changed ? (
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={accepted.has(p.callId)}
                          onChange={() => onToggle(p.callId)}
                          className="w-3 h-3 cursor-pointer"
                        />
                        <span className={`text-[9px] ${accepted.has(p.callId) ? 'text-blue-400' : 'text-rmpg-400'}`}>
                          Accept
                        </span>
                      </label>
                    ) : (
                      <span className="px-1.5 py-0.5 text-[8px] bg-rmpg-800/50 text-rmpg-500 border border-rmpg-700/40">
                        No change
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Dropped services */}
          {droppedServices.length > 0 && (
            <div
              className="mx-3 my-2 px-3 py-2 border border-amber-700/40 text-[10px] text-amber-400"
              style={{ background: 'rgb(var(--sev-warn-rgb, 245 158 11) / 0.08)' }}
            >
              <span className="font-bold">⚠ {droppedServices.length} call{droppedServices.length !== 1 ? 's' : ''}</span>
              {' '}could not be optimally assigned — assign manually
            </div>
          )}

          {proposals.length === 0 && (
            <div className="py-8 text-center text-rmpg-500 text-xs">No proposals available</div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-4 py-2.5 border-t border-rmpg-700 flex-shrink-0 gap-3"
          style={{ background: 'var(--surface-deep)' }}
        >
          <span className="text-[10px] text-rmpg-500 font-mono">
            {acceptedCount} of {changed.length} accepted
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              className="px-3 py-1.5 text-xs border border-rmpg-700 text-rmpg-300 hover:text-rmpg-100 hover:border-rmpg-600 transition-colors disabled:opacity-50"
              style={{ borderRadius: 2 }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onApplyAll}
              disabled={applying || acceptedCount === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition-colors"
              style={{
                background: 'var(--brand-blue, #1d4ed8)',
                borderRadius: 2,
              }}
            >
              {applying && <Loader2 className="w-3 h-3 animate-spin" />}
              Apply {acceptedCount > 0 ? acceptedCount : ''} accepted
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
