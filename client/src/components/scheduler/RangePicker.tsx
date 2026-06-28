import { ChevronLeft, ChevronRight } from 'lucide-react';

export type RangeMode = 'week' | 'two-week' | 'month';

interface Props {
  anchorYmd: string;
  mode: RangeMode;
  onAnchorChange: (ymd: string) => void;
  onModeChange: (mode: RangeMode) => void;
}

const MODE_LABELS: Record<RangeMode, string> = {
  week: 'Week',
  'two-week': '2-Week',
  month: 'Month',
};
const MODE_DAYS: Record<RangeMode, number> = {
  week: 7,
  'two-week': 14,
  month: 31,
};

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days)); // new-date-ok: epoch from Date.UTC, not a server string
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function RangePicker({ anchorYmd, mode, onAnchorChange, onModeChange }: Props) {
  const days = MODE_DAYS[mode];
  const endYmd = shiftYmd(anchorYmd, days - 1);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Previous range"
        onClick={() => onAnchorChange(shiftYmd(anchorYmd, -days))}
        className="px-1 py-0.5 border border-rmpg-700 rounded-[2px] hover:bg-surface-raised"
      >
        <ChevronLeft size={12} />
      </button>
      <div className="text-[11px] tabular-nums text-rmpg-200">
        {anchorYmd} – {endYmd}
      </div>
      <button
        type="button"
        aria-label="Next range"
        onClick={() => onAnchorChange(shiftYmd(anchorYmd, days))}
        className="px-1 py-0.5 border border-rmpg-700 rounded-[2px] hover:bg-surface-raised"
      >
        <ChevronRight size={12} />
      </button>
      <div className="inline-flex border border-rmpg-700 rounded-[2px] overflow-hidden">
        {(['week', 'two-week', 'month'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onModeChange(v)}
            className={`px-2 py-0.5 text-[10px] uppercase ${
              mode === v ? 'bg-brand-500/20 text-brand-200' : 'bg-surface-base text-rmpg-300 hover:bg-surface-raised'
            }`}
          >
            {MODE_LABELS[v]}
          </button>
        ))}
      </div>
    </div>
  );
}
