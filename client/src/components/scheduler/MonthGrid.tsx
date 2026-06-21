import { useMemo } from 'react';
import { groupByDay, type ScheduleSlot } from '../../utils/schedulerView';

interface Props {
  anchorYmd: string;             // any date in the month to display
  slots: ScheduleSlot[];
  todayYmd: string;
  onDayClick?: (ymd: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Build the visible month grid: leading blank cells from prior month so the
// first row starts on Sunday, then every day of the month, then trailing
// blanks if needed to fill the last row.
function monthCells(anchorYmd: string): Array<{ ymd: string | null; inMonth: boolean }> {
  const [y, m] = anchorYmd.split('-').map(Number);
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const firstWeekday = firstOfMonth.getUTCDay();
  const lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
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

export default function MonthGrid({ anchorYmd, slots, todayYmd, onDayClick }: Props) {
  const cells = useMemo(() => monthCells(anchorYmd), [anchorYmd]);
  const grouped = useMemo(() => groupByDay(slots), [slots]);

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
          return (
            <button
              key={cell.ymd}
              type="button"
              onClick={() => onDayClick?.(cell.ymd!)}
              className={`aspect-square border-r border-t border-rmpg-700 p-1 text-left hover:bg-brand-400/5 ${
                isToday ? 'ring-1 ring-inset ring-brand-400 bg-brand-500/10' : ''
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
            </button>
          );
        })}
      </div>
    </div>
  );
}
