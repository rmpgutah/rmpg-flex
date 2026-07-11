import React from 'react';
import { GraduationCap, AlertTriangle, CheckCircle } from 'lucide-react';
import SpmGroup from '../../pages/dashboard/SpmGroup';

interface TrainingComplianceProps {
  completed: number;
  total: number;
  overdue: number;
  expiringSoon: number;
  className?: string;
}

export default function TrainingCompliance({
  completed,
  total,
  overdue,
  expiringSoon,
  className = '',
}: TrainingComplianceProps) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className={className}>
      <SpmGroup title="Training">
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-rmpg-400" />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-rmpg-400 font-bold uppercase tracking-wider">Compliance</span>
                <span className="text-xs font-bold font-mono tabular-nums text-rmpg-200">{pct}%</span>
              </div>
              <div className="progress-bar-track mt-1">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="flex items-center gap-1.5 text-green-400 bg-green-900/10 p-1.5 panel-beveled">
              <CheckCircle className="w-3 h-3 flex-shrink-0" />
              <span className="font-bold font-mono tabular-nums">{completed}/{total}</span>
            </div>
            {overdue > 0 && (
              <div className="flex items-center gap-1.5 text-red-400 bg-red-900/10 p-1.5 panel-beveled">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                <span className="font-bold font-mono tabular-nums">{overdue} overdue</span>
              </div>
            )}
          </div>
          {expiringSoon > 0 && (
            <div className="text-[10px] text-amber-400 font-semibold text-center">
              {expiringSoon} expiring within 30 days
            </div>
          )}
        </div>
      </SpmGroup>
    </div>
  );
}
