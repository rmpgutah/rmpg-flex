import React from 'react';
import { Scale, AlertTriangle, CheckCircle } from 'lucide-react';
import SpmGroup from '../../pages/dashboard/SpmGroup';

interface IASummaryProps {
  openCases: number;
  underInvestigation: number;
  closedThisMonth: number;
  className?: string;
}

export default function IASummary({
  openCases,
  underInvestigation,
  closedThisMonth,
  className = '',
}: IASummaryProps) {
  return (
    <div className={className}>
      <SpmGroup title="IA">
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-rmpg-400" />
            <span className="text-[10px] text-rmpg-400 font-bold uppercase tracking-wider">Internal Affairs</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col items-center p-1.5 bg-surface-sunken panel-beveled">
              <span className={`text-xs font-bold font-mono tabular-nums ${openCases > 0 ? 'text-amber-400' : 'text-green-400'}`}>{openCases}</span>
              <span className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider">Open</span>
            </div>
            <div className="flex flex-col items-center p-1.5 bg-surface-sunken panel-beveled">
              <span className={`text-xs font-bold font-mono tabular-nums ${underInvestigation > 0 ? 'text-red-400' : 'text-rmpg-200'}`}>{underInvestigation}</span>
              <span className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider">Investigation</span>
            </div>
          </div>
          {closedThisMonth > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-green-400">
              <CheckCircle className="w-3 h-3" />
              <span className="font-medium">{closedThisMonth} closed this month</span>
            </div>
          )}
        </div>
      </SpmGroup>
    </div>
  );
}
