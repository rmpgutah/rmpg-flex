import React, { useMemo } from 'react';
import { Calendar } from 'lucide-react';
import SpmGroup from '../../pages/dashboard/SpmGroup';
import { parseTimestamp } from '../../utils/dateUtils';

interface CourtDate {
  id: number | string;
  case_number: string;
  court_name?: string;
  court_date: string;
  purpose?: string;
}

interface CourtCountdownProps {
  dates: CourtDate[];
  className?: string;
}

function getCountdown(target: Date): { days: number; hours: number; minutes: number } {
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0 };
  const totalMin = Math.floor(diff / 60000);
  return {
    days: Math.floor(totalMin / 1440),
    hours: Math.floor((totalMin % 1440) / 60),
    minutes: totalMin % 60,
  };
}

export default function CourtCountdown({ dates, className = '' }: CourtCountdownProps) {
  const sorted = useMemo(
    () => [...dates].sort((a, b) => parseTimestamp(a.court_date).getTime() - parseTimestamp(b.court_date).getTime()),
    [dates],
  );

  if (!dates.length) return null;

  const next = sorted[0];
  const target = parseTimestamp(next.court_date);
  const cd = getCountdown(target);
  const isUrgent = cd.days < 7;

  return (
    <div className={className}>
      <SpmGroup title="Court Countdown">
        <div className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className={`w-4 h-4 ${isUrgent ? 'text-amber-400' : 'text-rmpg-400'}`} />
            <span className="text-[10px] text-rmpg-300 font-semibold uppercase tracking-wider truncate flex-1">
              {next.case_number} — {next.court_name || 'Court'}
            </span>
          </div>
          <div className="flex items-center justify-center gap-3 py-1">
            <div className="countdown-unit">
              <span className="countdown-value" style={{ color: isUrgent ? 'var(--sev-warn)' : undefined }}>{cd.days}</span>
              <span className="countdown-label">Days</span>
            </div>
            <span className="text-rmpg-600 text-lg font-light">:</span>
            <div className="countdown-unit">
              <span className="countdown-value">{cd.hours}</span>
              <span className="countdown-label">Hours</span>
            </div>
            <span className="text-rmpg-600 text-lg font-light">:</span>
            <div className="countdown-unit">
              <span className="countdown-value">{String(cd.minutes).padStart(2, '0')}</span>
              <span className="countdown-label">Min</span>
            </div>
          </div>
          <div className="text-[10px] text-rmpg-400 text-center mt-1">
            {target.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            {next.purpose && ` — ${next.purpose}`}
          </div>
        </div>
      </SpmGroup>
    </div>
  );
}
