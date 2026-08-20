import { useMemo, useState } from 'react';
import { groupByDay, type ScheduleSlot } from '../../utils/schedulerView';
import { type DragPayload } from './dnd';

interface Props {
  anchorYmd: string;             // any date in the month to display
  slots: ScheduleSlot[];
  todayYmd: string;
  onDayClick?: (ymd: string) => void;
  onSlotDrop?: (slot: ScheduleSlot, target: { date: string; window_start: string; window_end: string }) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Build the visible month grid: leading blank cells from prior month so the
// first row starts on Sunday, then every day of the month, then trailing
// blanks if needed to fill the last row.
function monthCells(anchorYmd: string): Array<{ ymd: string | null; inMonth: boolean }> {
  const [y, m] = anchorYmd.split('-').map(Number);
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1)); // new-date-ok: epoch from Date.UTC, not a server string
  const firstWeekday = firstOfMonth.getUTCDay();
  const lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate(); // new-date-ok: epoch from Date.UTC, not a server string
  const cells: Array<{ ymd: string | null; inMonth: boolean }> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ ymd: null, inMonth: false });
  for (let d = 1; d <= lastOfMonth; d++) {
    const dd = String(d).padStart(2, '0');
    cells.push({ ymd: `${y}-${String(m).padStart(2, '0')}-${dd}`, inMonth: true });
  }
  while (cells.length % 7 !== 0) cells.push({ ymd: null, inMonth: false });
  return cells;
}

const TIER_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  tight: 'bg-amber-400',
  standard: 'bg-blue-400',
};

const TIER_BORDER: Record<string, string> = {
  critical: 'border-red-500',
  tight: 'border-amber-400',
  standard: 'border-blue-400',
};

// Month cells are aspect-square; more than this and the chips overflow the box.
const MAX_CHIPS = 3;

function surnameOf(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1].toUpperCase() : '—';
}

export default function MonthGrid({ anchorYmd, slots, todayYmd, onDayClick, onSlotDrop }: Props) {
  const cells = useMemo(() => monthCells(anchorYmd), [anchorYmd]);
  const grouped = useMemo(() => groupByDay(slots), [slots]);
  const [dragOverYmd, setDragOverYmd] = useState<string | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  // Month view rendered only aggregate tier badges, so there was no draggable
  // element anywhere in it — every drop handler below was unreachable and
  // "drag and drop doesn't work in month view" was literally true. Chips give
  // the drag a source, using the same `application/json` payload WeekTimeline
  // emits so a slot dragged in either view is understood by both.
  const handleDragStart = (slot: ScheduleSlot) => (e: React.DragEvent<HTMLDivElement>) => {
    const payload: DragPayload = {
      slot_id: slot.id,
      originating_date: slot.scheduled_date,
      officer_id: slot.officer_id,
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
  };

  const handleDrop = (ymd: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverYmd(null);
    if (!onSlotDrop) return;
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      const payload = JSON.parse(raw) as DragPayload;
      if (payload.originating_date === ymd) return; // no-op: same day
      const slot = slots.find((s) => s.id === payload.slot_id);
      if (!slot) return;
      // Drop onto a month day: keep existing window times, only change date
      onSlotDrop(slot, {
        date: ymd,
        window_start: slot.window_start,
        window_end: slot.window_end,
      });
    } catch { /* ignore malformed drag payload */ }
  };

  return (
    <div>
      <div className="grid grid-cols-7 border-t border-rmpg-700">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="text-[10px] font-semibold py-1 px-1 bg-surface-raised text-rmpg-200 border-r border-rmpg-700"
          >
            {w}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell.inMonth) {
            return (
              <div
                key={`blank-${i}`}
                className="aspect-square border-r border-t border-rmpg-700 bg-surface-base/40"
              />
            );
          }
          const daySlots = grouped.get(cell.ymd!) ?? [];
          const isToday = cell.ymd === todayYmd;
          const tierCounts = daySlots.reduce<Record<string, number>>((acc, s) => {
            const t = s.urgency_tier ?? 'standard';
            acc[t] = (acc[t] ?? 0) + 1;
            return acc;
          }, {});
          const visible = daySlots.slice(0, MAX_CHIPS);
          const overflow = daySlots.length - visible.length;
          return (
            // A <div role="button"> rather than a <button>: the draggable chips
            // below are interactive descendants, which is invalid inside a
            // button and lets the button swallow the drag gesture.
            <div
              key={cell.ymd}
              role="button"
              tabIndex={0}
              onClick={() => onDayClick?.(cell.ymd!)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onDayClick?.(cell.ymd!);
                }
              }}
              onDragOver={handleDragOver}
              onDragEnter={() => { if (onSlotDrop) setDragOverYmd(cell.ymd); }}
              onDragLeave={() => setDragOverYmd(null)}
              onDrop={handleDrop(cell.ymd!)}
              className={`aspect-square overflow-hidden border-r border-t border-rmpg-700 p-1 text-left hover:bg-brand-400/5 ${
                isToday ? 'ring-1 ring-inset ring-brand-400 bg-brand-500/10' : ''
              } ${
                dragOverYmd === cell.ymd ? 'ring-1 ring-inset ring-amber-400 bg-amber-400/5' : ''
              }`}
            >
              <div className="text-[10px] font-semibold text-rmpg-200">
                {parseInt(cell.ymd!.slice(8), 10)}
              </div>
              <div className="mt-1 flex flex-wrap gap-0.5">
                {(['critical', 'tight', 'standard'] as const).map((t) =>
                  tierCounts[t]
                    ? (
                      <span
                        key={t}
                        className={`inline-flex items-center gap-0.5 rounded-[2px] px-1 text-[9px] font-semibold text-white ${TIER_DOT[t]}`}
                      >
                        <span className="w-1 h-1 rounded-full bg-white/80" />
                        {tierCounts[t]}
                      </span>
                    ) : null,
                )}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {visible.map((slot) => (
                  <div
                    key={slot.id}
                    draggable={Boolean(onSlotDrop)}
                    onDragStart={handleDragStart(slot)}
                    onClick={(e) => e.stopPropagation()}
                    title={`${slot.recipient_name ?? ''} • ${slot.window_start}–${slot.window_end}`}
                    className={`truncate rounded-[2px] px-1 text-[9px] leading-tight text-rmpg-100 bg-surface-raised border-l-2 ${
                      TIER_BORDER[slot.urgency_tier ?? 'standard']
                    } ${onSlotDrop ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                    {surnameOf(slot.recipient_name)}
                  </div>
                ))}
                {overflow > 0 && (
                  <div className="px-1 text-[9px] text-fg-muted">+{overflow} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
