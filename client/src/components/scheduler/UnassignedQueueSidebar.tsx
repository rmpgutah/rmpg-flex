import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';

export interface UnassignedQueueItem {
  id: number;
  recipient_name: string | null;
  case_number: string | null;
  deadline: string | null;
  urgency_tier: 'critical' | 'tight' | 'standard' | null;
  priority: string;
  document_type: string | null;
}

interface Props {
  onAssign?: (item: UnassignedQueueItem, officerId: number, date: string) => void;
}

const TIER_COLOR: Record<string, string> = {
  critical: 'text-red-300',
  tight: 'text-amber-300',
  standard: 'text-blue-300',
};

export default function UnassignedQueueSidebar({ onAssign }: Props) {
  const [items, setItems] = useState<UnassignedQueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const rows = await apiFetch<UnassignedQueueItem[]>(
        '/serve-intake/queue?officer_id=null&status=pending,assigned',
      );
      // Default sort: deadline ASC NULLS LAST, then urgency_tier (critical < tight < standard)
      const tierRank: Record<string, number> = { critical: 0, tight: 1, standard: 2 };
      rows.sort((a, b) => {
        if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
        if (a.deadline) return -1;
        if (b.deadline) return 1;
        return (tierRank[a.urgency_tier ?? 'standard'] ?? 3) - (tierRank[b.urgency_tier ?? 'standard'] ?? 3);
      });
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);
  useLiveSync('serve-schedule', refetch);

  const handleDragStart = (item: UnassignedQueueItem) => (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(
      'application/x-rmpg-queue-item',
      JSON.stringify({ queue_id: item.id }),
    );
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="bg-surface-base border border-rmpg-700 rounded-[2px] w-64 shrink-0">
      <div className="px-2 py-1 border-b border-rmpg-700 bg-surface-raised text-[11px] font-semibold uppercase tracking-wide text-rmpg-200">
        Unassigned Queue
        <span className="ml-2 text-rmpg-400 tabular-nums">{items.length}</span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {loading
          ? <div className="p-2 text-[11px] text-rmpg-400">Loading…</div>
          : items.length === 0
          ? <div className="p-2 text-[11px] text-rmpg-400">No unassigned papers.</div>
          : items.map((item) => {
              const tier = (item.urgency_tier ?? 'standard') as keyof typeof TIER_COLOR;
              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={handleDragStart(item)}
                  className="px-2 py-1 border-b border-rmpg-700 cursor-grab active:cursor-grabbing hover:bg-surface-raised"
                  title={`${item.recipient_name ?? ''} • ${item.case_number ?? ''}`}
                >
                  <div className="flex items-center gap-1 text-[11px] text-rmpg-100">
                    <span className="font-semibold truncate">{item.recipient_name ?? '—'}</span>
                    {tier === 'critical' ? <AlertTriangle size={9} className="shrink-0 text-red-400" /> : null}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-rmpg-400 tabular-nums">
                    <span className="truncate">{item.case_number ?? '—'}</span>
                    <span className={TIER_COLOR[tier]}>{item.deadline ?? 'no deadline'}</span>
                  </div>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}
