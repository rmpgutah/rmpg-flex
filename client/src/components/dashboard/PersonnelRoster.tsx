import React from 'react';
import { Users, Circle } from 'lucide-react';
import SpmGroup from '../../pages/dashboard/SpmGroup';

interface RosterEntry {
  name: string;
  badge?: string;
  status: string;
  statusColor?: string;
}

interface PersonnelRosterProps {
  onDuty: RosterEntry[];
  total: number;
  className?: string;
}

const STATUS_DOT: Record<string, string> = {
  available: 'led-green',
  dispatched: 'led-amber',
  enroute: 'led-blue',
  onscene: 'led-purple',
  busy: 'led-red',
  offduty: 'led-off',
};

export default function PersonnelRoster({
  onDuty,
  total,
  className = '',
}: PersonnelRosterProps) {
  return (
    <div className={className}>
      <SpmGroup title="Personnel">
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-green-400" />
              <span className="text-[10px] text-rmpg-400 font-bold uppercase tracking-wider">On Duty</span>
            </div>
            <span className="text-xs font-bold font-mono tabular-nums text-green-400">{onDuty.length}/{total}</span>
          </div>
          <div className="space-y-1 max-h-[160px] overflow-y-auto dash-scrollbar">
            {onDuty.slice(0, 12).map((entry, i) => (
              <div key={i} className="flex items-center gap-2 py-1 border-b border-rmpg-800/50 last:border-0">
                <span className={`led-dot ${STATUS_DOT[entry.status] || 'led-off'}`} />
                <span className="text-[11px] text-rmpg-200 font-medium truncate flex-1">{entry.name}</span>
                {entry.badge && <span className="text-[9px] text-rmpg-500 font-mono">#{entry.badge}</span>}
              </div>
            ))}
            {onDuty.length > 12 && (
              <div className="text-[10px] text-rmpg-400 text-center pt-1">+{onDuty.length - 12} more</div>
            )}
          </div>
        </div>
      </SpmGroup>
    </div>
  );
}
