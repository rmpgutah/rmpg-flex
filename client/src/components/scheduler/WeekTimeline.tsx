import { useMemo, useState } from 'react';
import AttemptChip from './AttemptChip';
import {
  dayRangeFromAnchor,
  groupByDay,
  formatDayHeader,
  computeChipBand,
  type ScheduleSlot,
} from '../../utils/schedulerView';
import { snapToBand, type DragPayload } from './dnd';

interface Props {
  anchorYmd: string;             // first day of the visible window (YYYY-MM-DD)
  slots: ScheduleSlot[];
  todayYmd: string;              // for highlighting the Today column
  onSlotClick?: (slot: ScheduleSlot) => void;
  onSlotDrop?: (slot: ScheduleSlot, target: { date: string; window_start: string; window_end: string }) => void;
}

const HOUR_BANDS = ['06–08', '08–10', '10–12', '12–14', '14–16', '16–18', '18–20', '20–22', '22+'];

export default function WeekTimeline({
  anchorYmd, slots, todayYmd, onSlotClick, onSlotDrop,
}: Props) {
  const days = useMemo(() => dayRangeFromAnchor(anchorYmd, 7), [anchorYmd]);
  const grouped = useMemo(() => groupByDay(slots), [slots]);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  const handleDragStart = (slot: ScheduleSlot) => (e: React.DragEvent<HTMLDivElement>) => {
    const payload: DragPayload = {
      slot_id: slot.id,
      originating_date: slot.scheduled_date,
      officer_id: slot.officer_id,
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    // Reduce opacity of the dragged element so the user can see through it
    (e.currentTarget as HTMLElement).style.opacity = '0.4';
  };

  const handleDragOver = (cellKey: string) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCell(cellKey);
  };

  const handleDragLeave = () => {
    setDragOverCell(null);
  };

  const handleDrop = (date: string, row: number) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOverCell(null);
    if (!onSlotDrop) return;
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      const payload = JSON.parse(raw) as DragPayload;
      const slot = slots.find((s) => s.id === payload.slot_id);
      if (!slot) return;
      const window = snapToBand(row);
      onSlotDrop(slot, { date, ...window });
    } catch { /* ignore malformed drag payload */ }
  };

  return (
    <div className="overflow-x-auto">
      <div
        className="grid border-t border-rmpg-700 min-w-[700px]"
        style={{
          gridTemplateColumns: `48px repeat(7, minmax(80px, 1fr))`,
          gridTemplateRows: `26px repeat(9, 32px)`,
        }}
      >
        {/* Top-left corner */}
        <div className="bg-surface-raised border-r border-rmpg-700" />

        {/* Day headers */}
        {days.map((d) => (
          <div
            key={d}
            className={`text-[10px] font-semibold px-1 py-1 border-r border-rmpg-700 ${
              d === todayYmd ? 'bg-brand-500/15 text-brand-300' : 'bg-surface-raised text-rmpg-200'
            }`}
          >
            {formatDayHeader(d)}
          </div>
        ))}

        {/* Hour labels + drop targets */}
        {HOUR_BANDS.map((label, idx) => (
          <div key={`row-${idx}`} className="contents">
            <div className="text-[9px] text-rmpg-400 px-1 pt-0.5 border-r border-t border-rmpg-700 tabular-nums">
              {label}
            </div>
            {days.map((d) => (
              <div
                key={`${d}-${idx}`}
                className={`border-r border-t border-rmpg-700 relative transition-colors ${
                  dragOverCell === `${d}-${idx}` ? 'bg-amber-400/10 ring-1 ring-inset ring-amber-400/40' : 'hover:bg-brand-400/5'
                }`}
                onDragOver={handleDragOver(`${d}-${idx}`)}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop(d, idx + 1)}
              />
            ))}
          </div>
        ))}

        {/* Chips overlaid via grid-row positioning */}
        {days.map((d, dayIdx) => {
          const daySlots = grouped.get(d) ?? [];
          return daySlots.map((slot) => {
            const band = computeChipBand(slot.window_start, slot.window_end);
            return (
              <div
                key={slot.id}
                className="z-10 px-0.5 py-0.5"
                style={{
                  gridColumn: `${dayIdx + 2}`,
                  gridRow: `${band.rowStart + 1} / span ${band.rowSpan}`,
                }}
              >
                <AttemptChip
                  slot={slot}
                  onClick={() => onSlotClick?.(slot)}
                  onDragStart={handleDragStart(slot)}
                />
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}
