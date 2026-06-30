import React from 'react';
import { Truck, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import SpmGroup from '../../pages/dashboard/SpmGroup';

interface FleetSummaryProps {
  total: number;
  inService: number;
  inMaintenance: number;
  overdueService: number;
  className?: string;
}

export default function FleetSummary({
  total,
  inService,
  inMaintenance,
  overdueService,
  className = '',
}: FleetSummaryProps) {
  return (
    <div className={className}>
      <SpmGroup title="Fleet">
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-rmpg-400 font-bold uppercase tracking-wider">Total Vehicles</span>
            <span className="text-sm font-bold font-mono tabular-nums text-rmpg-200">{total}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col items-center p-1.5 bg-surface-sunken panel-beveled">
              <CheckCircle className="w-3.5 h-3.5 text-green-400 mb-0.5" />
              <span className="text-xs font-bold font-mono tabular-nums text-green-400">{inService}</span>
              <span className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider">In Svc</span>
            </div>
            <div className="flex flex-col items-center p-1.5 bg-surface-sunken panel-beveled">
              <Clock className="w-3.5 h-3.5 text-amber-400 mb-0.5" />
              <span className="text-xs font-bold font-mono tabular-nums text-amber-400">{inMaintenance}</span>
              <span className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider">Maint</span>
            </div>
            <div className="flex flex-col items-center p-1.5 bg-surface-sunken panel-beveled">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 mb-0.5" />
              <span className="text-xs font-bold font-mono tabular-nums text-red-400">{overdueService}</span>
              <span className="text-[8px] text-rmpg-500 uppercase font-bold tracking-wider">Due</span>
            </div>
          </div>
        </div>
      </SpmGroup>
    </div>
  );
}
