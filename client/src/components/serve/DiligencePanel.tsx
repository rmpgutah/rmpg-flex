// ============================================================
// DiligencePanel — the Rule 4(d) record, where the officer works
// ============================================================
// Shown inside ServeJobCard's expanded body. Answers, at a glance:
// can I post / sub-serve this yet, and what is still missing from
// the affidavit if I can't?
//
// Colour rules: strength is a REPORTED CONDITION, so it uses the
// severity ramp (red/amber/green), not brand chrome. Gold is not
// used here at all — it is reserved for field labels and panel
// headers, and a gold badge would read as decoration next to the
// severity colours it sits beside.
// ============================================================

import { ShieldCheck, ShieldAlert, ShieldX, Clock, CalendarDays } from 'lucide-react';
import {
  assessDiligence,
  diligenceSummary,
  type DiligenceAssessment,
} from '../../utils/serveDiligenceChain';
import type { ServeAttempt } from '../../types';

const STRENGTH_STYLE: Record<
  DiligenceAssessment['strength'],
  { chip: string; icon: typeof ShieldCheck; label: string }
> = {
  none:     { chip: 'text-fg-secondary bg-surface-sunken/70 border-border-default/50', icon: ShieldX,     label: 'NO RECORD' },
  weak:     { chip: 'text-red-300 bg-red-900/40 border-red-600/60',                icon: ShieldX,     label: 'WEAK' },
  adequate: { chip: 'text-amber-300 bg-amber-900/30 border-amber-600/50',          icon: ShieldAlert, label: 'ADEQUATE' },
  strong:   { chip: 'text-green-300 bg-green-900/40 border-green-600/50',          icon: ShieldCheck, label: 'STRONG' },
};

const ALL_BANDS = ['morning', 'afternoon', 'evening'] as const;

export default function DiligencePanel({ attempts }: { attempts: readonly ServeAttempt[] }) {
  const a = assessDiligence(attempts);
  const style = STRENGTH_STYLE[a.strength];
  const Icon = style.icon;

  return (
    <div className="p-2 rounded-[2px] border border-border-default/40 bg-surface-sunken/30">
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="text-[9px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--panel-header-color)' }}
        >
          Diligence
        </span>
        <span
          className={`inline-flex items-center gap-0.5 text-[8px] font-bold px-1 py-0 rounded-[2px] border ${style.chip}`}
          title={`Diligence strength: ${style.label.toLowerCase()}`}
        >
          <Icon className="w-2.5 h-2.5" />
          {style.label}
        </span>
        <span className="text-[9px] text-fg-muted ml-auto tabular-nums">{diligenceSummary(a)}</span>
      </div>

      {/* Rule 4(d) gate — the single fact that decides whether posting is
          available. Stated plainly rather than left for the officer to infer
          from the attempt count. */}
      <div className="flex items-center gap-1.5 text-[10px] mb-1.5">
        <span className="text-fg-muted">Utah R. Civ. P. 4(d) floor:</span>
        <span className={a.meetsRule4dFloor ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
          {a.meetsRule4dFloor ? 'MET — posting / sub-service available' : 'NOT MET — 2+ attempts required'}
        </span>
      </div>

      {/* Time-band coverage. Unfilled bands are the actionable bit: they tell
          the officer exactly which slot to go take next. */}
      <div className="flex items-center gap-3 text-[9px] mb-1">
        <span className="flex items-center gap-1 text-fg-muted">
          <Clock className="w-2.5 h-2.5" />
          {ALL_BANDS.map((b) => (
            <span
              key={b}
              title={a.bandsCovered.includes(b) ? `${b} covered` : `${b} not yet attempted`}
              className={`px-1 rounded-[2px] border capitalize ${
                a.bandsCovered.includes(b)
                  ? 'text-rmpg-100 border-accent-silver-500/50 bg-accent-silver-500/15'
                  : 'text-fg-muted border-border-subtle'
              }`}
            >
              {b.slice(0, 3)}
            </span>
          ))}
        </span>
        <span className="flex items-center gap-1 text-fg-muted">
          <CalendarDays className="w-2.5 h-2.5" />
          <span className={a.hasWeekendAttempt ? 'text-rmpg-100' : 'text-fg-muted'}>
            {a.hasWeekendAttempt ? 'weekend attempted' : 'no weekend attempt'}
          </span>
        </span>
        {a.distinctDays > 0 && (
          <span className="text-fg-muted tabular-nums">
            {a.distinctDays} day{a.distinctDays === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {a.gaps.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {a.gaps.map((g) => (
            <li key={g} className="text-[9px] text-amber-400/90 leading-tight">• {g}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
