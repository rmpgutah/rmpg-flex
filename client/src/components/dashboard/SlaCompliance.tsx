import React from 'react';
import { Clock, CheckCircle, XCircle } from 'lucide-react';
import ResponseTimeGauge from './ResponseTimeGauge';
import SpmGroup from '../../pages/dashboard/SpmGroup';

interface SlaComplianceProps {
  complianceRate: number;
  targetRate?: number;
  avgResponseMinutes: number;
  responseTarget?: number;
  totalCalls: number;
  metTarget: number;
  className?: string;
}

export default function SlaCompliance({
  complianceRate,
  targetRate = 90,
  avgResponseMinutes,
  responseTarget = 10,
  totalCalls,
  metTarget,
  className = '',
}: SlaComplianceProps) {
  const onTrack = complianceRate >= targetRate;
  const missed = totalCalls - metTarget;

  return (
    <div className={className}>
      <SpmGroup title="SLA Compliance">
        <div className="p-3">
          <div className="flex items-center gap-4">
            <ResponseTimeGauge
              value={avgResponseMinutes}
              max={30}
              threshold={responseTarget}
              label="Avg Response"
              size={80}
              strokeWidth={6}
            />
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-rmpg-400 font-bold uppercase tracking-wider">Compliance</span>
                <span className={`text-xs font-bold font-mono tabular-nums ${onTrack ? 'text-green-400' : 'text-red-400'}`}>
                  {complianceRate}%
                </span>
              </div>
              <div className="progress-bar-track h-2">
                <div
                  className={`progress-bar-fill ${onTrack ? 'success' : 'danger'}`}
                  style={{ width: `${Math.min(complianceRate, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-rmpg-400">
                <span className="flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-green-400" />
                  {metTarget} on time
                </span>
                {missed > 0 && (
                  <span className="flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-red-400" />
                    {missed} missed
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </SpmGroup>
    </div>
  );
}
