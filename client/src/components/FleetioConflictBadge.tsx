import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import Tooltip from './ui/Tooltip';

export interface ConflictBadgeConflict {
  id: number;
  field: string;
  local_value?: string | null;
  remote_value?: string | null;
  rmpg_table?: string;
  rmpg_id?: number;
  resolution?: string | null;
  created_at?: string;
}

interface FleetioConflictBadgeProps {
  conflict: ConflictBadgeConflict;
  compact?: boolean;
  onResolved?: () => void;
}

export default function FleetioConflictBadge({ conflict, compact, onResolved }: FleetioConflictBadgeProps) {
  const [resolving, setResolving] = useState(false);

  if (conflict.resolution && conflict.resolution !== 'unresolved') {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
        <CheckCircle2 className="w-2.5 h-2.5" />
        {conflict.resolution === 'local_wins' ? 'Kept local' : conflict.resolution === 'remote_wins' ? 'Used remote' : 'Resolved'}
      </span>
    );
  }

  const resolve = (resolution: 'local_wins' | 'remote_wins') => {
    setResolving(true);
    apiFetch<{ success: boolean }>(`/fleetio/conflicts/${conflict.id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    })
      .then(() => { setResolving(false); onResolved?.(); })
      .catch(() => setResolving(false));
  };

  if (compact) {
    return (
      <Tooltip
        content={
          <div className="space-y-1">
            <div className="font-semibold text-amber-300">{conflict.field}</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px]">
              <span className="text-rmpg-400">Local:</span>
              <span className="text-rmpg-100 truncate max-w-[120px]">{conflict.local_value ?? '—'}</span>
              <span className="text-rmpg-400">Remote:</span>
              <span className="text-rmpg-100 truncate max-w-[120px]">{conflict.remote_value ?? '—'}</span>
            </div>
          </div>
        }
        position="top"
      >
        <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-sm bg-amber-500/10 text-amber-400 border border-amber-500/30 cursor-help">
          <AlertTriangle className="w-2.5 h-2.5" />
          {conflict.field}
        </span>
      </Tooltip>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-sm bg-amber-500/10 text-amber-300 border border-amber-500/30">
      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
      <span className="font-mono">{conflict.field}</span>
      <span className="text-[9px] text-rmpg-400 mx-1">local: {conflict.local_value ?? '—'}</span>
      <span className="text-[9px] text-rmpg-400 mr-1">vs remote: {conflict.remote_value ?? '—'}</span>
      <button
        type="button"
        disabled={resolving}
        onClick={() => resolve('local_wins')}
        className="text-[9px] px-1 py-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
      >
        Keep local
      </button>
      <button
        type="button"
        disabled={resolving}
        onClick={() => resolve('remote_wins')}
        className="text-[9px] px-1 py-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
      >
        Use remote
      </button>
    </div>
  );
}
