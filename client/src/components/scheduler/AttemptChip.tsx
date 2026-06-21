import { Pin, AlertTriangle } from 'lucide-react';
import type { ScheduleSlot } from '../../utils/schedulerView';

interface Props {
  slot: ScheduleSlot;
  onClick?: () => void;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
}

const TIER_CLASSES: Record<string, string> = {
  critical: 'bg-red-700/30 border-l-2 border-red-500 text-red-100',
  tight:    'bg-amber-700/30 border-l-2 border-amber-400 text-amber-100',
  standard: 'bg-blue-700/30 border-l-2 border-blue-400 text-blue-100',
};

function surnameOf(name: string | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? name).toUpperCase();
}

export default function AttemptChip({ slot, onClick, onDragStart }: Props) {
  const tier = (slot.urgency_tier ?? 'standard') as keyof typeof TIER_CLASSES;
  const cls = TIER_CLASSES[tier];
  const surname = surnameOf(slot.recipient_name);
  const time = `${slot.window_start}–${slot.window_end}`;

  return (
    <div
      draggable
      onClick={onClick}
      onDragStart={onDragStart}
      className={`${cls} relative h-full w-full overflow-hidden rounded-[2px] px-1 py-0.5 text-[10px] leading-tight cursor-grab active:cursor-grabbing`}
      title={`${slot.recipient_name ?? ''} • ${slot.case_number ?? ''} • ${time}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="truncate font-semibold">{surname}</span>
        {slot.manually_moved ? <Pin size={8} className="shrink-0 mt-0.5" /> : null}
        {tier === 'critical' ? <AlertTriangle size={8} className="shrink-0 mt-0.5" /> : null}
      </div>
      <div className="text-[9px] opacity-80 tabular-nums">{time}</div>
    </div>
  );
}
