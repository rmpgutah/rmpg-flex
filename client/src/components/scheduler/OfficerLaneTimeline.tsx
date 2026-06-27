import { useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, Pin } from 'lucide-react';
import {
  type ScheduleSlot,
} from '../../utils/schedulerView';
import { groupByOfficerLane, extendRange, type RangeMode } from '../../utils/schedulerLanes';

export interface OfficerOption {
  id: number;
  name: string;
}

interface Props {
  anchorYmd: string;
  mode: RangeMode;
  slots: ScheduleSlot[];
  officers: OfficerOption[];
  todayYmd: string;
  /** Deep-link highlight: auto-scroll to this slot and ring it on first render. */
  highlightSlotId?: number;
  onSlotClick?: (slot: ScheduleSlot) => void;
  onSlotDrop?: (slot: ScheduleSlot, target: { date: string; officer_id: number | null }) => void;
  onQueueDrop?: (queueId: number, target: { date: string; officer_id: number | null }) => void;
  /** admin/manager only — gate dismiss (DELETE) icon on chip */
  onSlotDismiss?: (slot: ScheduleSlot) => void;
  /** admin/manager only — gate unassign (PATCH officer→null) icon on chip */
  onSlotUnassign?: (slot: ScheduleSlot) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIER_CLASSES: Record<string, string> = {
  critical: 'bg-red-700/30 border-l-2 border-red-500 text-red-100',
  tight:    'bg-amber-700/30 border-l-2 border-amber-400 text-amber-100',
  standard: 'bg-blue-700/30 border-l-2 border-blue-400 text-blue-100',
};

function formatHeader(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); // new-date-ok: epoch from Date.UTC, not a server string
  return `${WEEKDAYS[dt.getUTCDay()]} ${d}`;
}

export default function OfficerLaneTimeline({
  anchorYmd, mode, slots, officers, todayYmd,
  highlightSlotId, onSlotClick, onSlotDrop, onQueueDrop,
}: Props) {
  const days = useMemo(() => extendRange(anchorYmd, mode), [anchorYmd, mode]);
  const grouped = useMemo(() => groupByOfficerLane(slots), [slots]);

  // Deep-link scroll: fire once when highlightSlotId first resolves to a DOM node.
  const highlightFiredRef = useRef(false);
  useEffect(() => {
    if (!highlightSlotId || highlightFiredRef.current) return;
    const el = document.getElementById(`slot-${highlightSlotId}`);
    if (!el) return;
    highlightFiredRef.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightSlotId, slots]); // re-check when slots load

  // Lanes: every officer, plus an "Unassigned" lane keyed 0.
  const lanes: Array<{ id: number; name: string }> = [
    ...officers.map((o) => ({ id: o.id, name: o.name })),
    { id: 0, name: 'Unassigned' },
  ];

  const handleDragStart = (slot: ScheduleSlot) => (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('application/x-rmpg-slot', JSON.stringify({
      slot_id: slot.id, originating_date: slot.scheduled_date, officer_id: slot.officer_id,
    }));
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = (date: string, officerId: number) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = { date, officer_id: officerId === 0 ? null : officerId };
    // Scheduler-slot drag → reassign
    const slotPayload = e.dataTransfer.getData('application/x-rmpg-slot');
    if (slotPayload) {
      try {
        const payload = JSON.parse(slotPayload);
        const slot = slots.find((s) => s.id === payload.slot_id);
        if (slot && onSlotDrop) onSlotDrop(slot, target);
        return;
      } catch { /* ignore */ }
    }
    // Unassigned-queue drag → assign + schedule
    const queuePayload = e.dataTransfer.getData('application/x-rmpg-queue-item');
    if (queuePayload && onQueueDrop) {
      try {
        const payload = JSON.parse(queuePayload);
        onQueueDrop(payload.queue_id, target);
      } catch { /* ignore */ }
    }
  };

  const hasActions = Boolean(onSlotDismiss || onSlotUnassign);

  return (
    <div className="overflow-x-auto bg-surface-base border border-rmpg-700 rounded-[2px]">
      <div
        className="grid border-t border-rmpg-700 min-w-[700px]"
        style={{
          gridTemplateColumns: `120px repeat(${days.length}, minmax(80px, 1fr))`,
        }}
      >
        {/* Top-left corner */}
        <div className="bg-surface-raised border-r border-b border-rmpg-700" />
        {/* Day headers */}
        {days.map((d) => (
          <div
            key={d}
            className={`text-[10px] font-semibold px-1 py-1 border-r border-b border-rmpg-700 ${
              d === todayYmd ? 'bg-brand-500/15 text-brand-300' : 'bg-surface-raised text-rmpg-200'
            }`}
          >
            {formatHeader(d)}
          </div>
        ))}

        {/* Officer lanes */}
        {lanes.map((lane) => (
          <div key={lane.id} className="contents">
            <div
              id={lane.id !== 0 ? `officer-lane-${lane.id}` : undefined}
              className={`bg-surface-raised text-[10px] font-semibold px-1 py-1 border-r border-b border-rmpg-700 truncate${
                highlightOfficerId && lane.id === highlightOfficerId
                  ? ' ring-1 ring-brand-400 text-brand-300'
                  : ' text-rmpg-200'
              }`}
            >
              {lane.name}
            </div>
            {days.map((d) => {
              const cellSlots = grouped.get(d)?.get(lane.id) ?? [];
              return (
                <div
                  key={`${d}-${lane.id}`}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop(d, lane.id)}
                  className="border-r border-b border-rmpg-700 p-1 min-h-[40px] hover:bg-brand-400/5"
                >
                  {cellSlots.map((slot) => {
                    const tier = (slot.urgency_tier ?? 'standard') as keyof typeof TIER_CLASSES;
                    const isHighlighted = highlightSlotId === slot.id;
                    return (
                      <div
                        key={slot.id}
                        id={`slot-${slot.id}`}
                        draggable
                        onDragStart={handleDragStart(slot)}
                        onClick={() => onSlotClick?.(slot)}
                        className={`${TIER_CLASSES[tier]} relative rounded-[2px] px-1 py-0.5 mb-0.5 text-[10px] cursor-grab active:cursor-grabbing${isHighlighted ? ' ring-1 ring-brand-400' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate font-semibold">{(slot.recipient_name ?? '—').split(/\s+/).pop()?.toUpperCase()}</span>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {slot.manually_moved ? <Pin size={7} /> : null}
                            {tier === 'critical' ? <AlertTriangle size={7} /> : null}
                            {hasActions && (
                              <span className="hidden group-hover:flex items-center gap-0.5 ml-0.5">
                                {onSlotUnassign && slot.officer_id != null && (
                                  <button
                                    type="button"
                                    title="Unassign from officer"
                                    onClick={(e) => { e.stopPropagation(); onSlotUnassign(slot); }}
                                    className="p-px hover:text-amber-300 transition-colors"
                                    aria-label="Unassign slot"
                                  >
                                    <UserMinus size={8} />
                                  </button>
                                )}
                                {onSlotDismiss && (
                                  <button
                                    type="button"
                                    title="Dismiss slot"
                                    onClick={(e) => { e.stopPropagation(); onSlotDismiss(slot); }}
                                    className="p-px hover:text-red-300 transition-colors"
                                    aria-label="Dismiss slot"
                                  >
                                    <X size={8} />
                                  </button>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-[9px] opacity-70 tabular-nums">{slot.window_start}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
