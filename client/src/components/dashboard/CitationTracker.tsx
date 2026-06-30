import React from 'react';
import { FileText } from 'lucide-react';
import SpmGroup from '../../pages/dashboard/SpmGroup';

interface CitationTrackerProps {
  today: number;
  thisWeek: number;
  thisMonth: number;
  pendingReview: number;
  className?: string;
}

export default function CitationTracker({
  today,
  thisWeek,
  thisMonth,
  pendingReview,
  className = '',
}: CitationTrackerProps) {
  return (
    <div className={className}>
      <SpmGroup title="Citations">
        <div className="p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 mb-1">
            <FileText className="w-3.5 h-3.5 text-rmpg-400" />
            <span className="text-[10px] text-rmpg-400 font-bold uppercase tracking-wider flex-1">Period Totals</span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div className="bg-surface-sunken p-1 panel-beveled">
              <div className="text-xs font-bold font-mono tabular-nums text-amber-400">{today}</div>
              <div className="text-[7px] text-rmpg-500 uppercase font-bold tracking-wider">Today</div>
            </div>
            <div className="bg-surface-sunken p-1 panel-beveled">
              <div className="text-xs font-bold font-mono tabular-nums text-rmpg-200">{thisWeek}</div>
              <div className="text-[7px] text-rmpg-500 uppercase font-bold tracking-wider">Week</div>
            </div>
            <div className="bg-surface-sunken p-1 panel-beveled">
              <div className="text-xs font-bold font-mono tabular-nums text-rmpg-200">{thisMonth}</div>
              <div className="text-[7px] text-rmpg-500 uppercase font-bold tracking-wider">Month</div>
            </div>
          </div>
          {pendingReview > 0 && (
            <div className="text-[10px] text-amber-400 font-semibold text-center mt-1">
              {pendingReview} pending review
            </div>
          )}
        </div>
      </SpmGroup>
    </div>
  );
}
