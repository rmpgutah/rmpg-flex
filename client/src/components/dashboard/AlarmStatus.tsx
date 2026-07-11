import React from 'react';
import { Bell, BellOff, AlertTriangle } from 'lucide-react';
import SpmGroup from '../../pages/dashboard/SpmGroup';

interface AlarmStatusProps {
  totalMonitored: number;
  activeAlerts: number;
  pendingResponse: number;
  className?: string;
}

export default function AlarmStatus({
  totalMonitored,
  activeAlerts,
  pendingResponse,
  className = '',
}: AlarmStatusProps) {
  return (
    <div className={className}>
      <SpmGroup title="Alarms">
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-rmpg-400" />
              <span className="text-[10px] text-rmpg-400 font-bold uppercase tracking-wider">Monitored</span>
            </div>
            <span className="text-xs font-bold font-mono tabular-nums text-rmpg-200">{totalMonitored}</span>
          </div>
          {activeAlerts > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-red-400 bg-red-900/20 p-1.5 panel-beveled animate-led-pulse">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              <span className="font-bold uppercase tracking-wider">{activeAlerts} active alerts</span>
            </div>
          )}
          {pendingResponse > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400 bg-amber-900/15 p-1.5 panel-beveled">
              <Bell className="w-3 h-3 flex-shrink-0" />
              <span className="font-bold uppercase tracking-wider">{pendingResponse} pending response</span>
            </div>
          )}
          {activeAlerts === 0 && pendingResponse === 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-green-400">
              <BellOff className="w-3 h-3" />
              <span className="font-medium">All clear</span>
            </div>
          )}
        </div>
      </SpmGroup>
    </div>
  );
}
