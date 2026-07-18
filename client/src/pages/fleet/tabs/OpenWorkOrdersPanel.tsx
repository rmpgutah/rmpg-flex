// ═══════════════════════════════════════════════════════════════
// RMPG Flex — Open Work Orders Panel (per-vehicle summary)
//
// Compact summary of open/in-progress work orders for a single
// vehicle, mounted inside the Costs tab. "View all" deep-links to
// the fleet-wide Work Orders tab pre-filtered to this vehicle.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import type { WorkOrderStatus } from '../../../types';

interface WorkOrderSummaryRow {
  id: number;
  status: WorkOrderStatus;
  number: string | null;
  summary: string | null;
  opened_at: string;
}

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_parts: 'Waiting parts',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

interface Props {
  vehicleId: string;
  onViewAll: () => void;
}

export default function OpenWorkOrdersPanel({ vehicleId, onViewAll }: Props) {
  const [rows, setRows] = useState<WorkOrderSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<{ count: number; data: WorkOrderSummaryRow[] }>(`/work-orders?vehicle_id=${vehicleId}&open_only=1&limit=100`)
      .then((r) => { if (!cancelled) setRows(r?.data ?? []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (loading) return null;

  return (
    <div className="panel-beveled bg-surface-sunken p-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider flex items-center gap-1">
          <Wrench className="w-3 h-3" /> Open Work Orders{rows.length > 0 ? ` (${rows.length})` : ''}
        </div>
        <button type="button" onClick={onViewAll} className="text-[9px] text-brand-400 hover:underline">
          View all →
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="text-[10px] text-rmpg-500 py-1">No open work orders for this vehicle.</div>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-[10px] font-mono text-rmpg-200">
              <span className="truncate flex-1">{r.number ?? `#${r.id}`} — {r.summary ?? 'No summary'}</span>
              <span className="text-rmpg-400 ml-2">{STATUS_LABELS[r.status]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
