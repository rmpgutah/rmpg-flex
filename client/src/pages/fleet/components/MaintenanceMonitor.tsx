import React from 'react';
import { Wrench } from 'lucide-react';

interface Props {
  onSelectVehicle: (id: string) => void;
}

export default function MaintenanceMonitor({ onSelectVehicle }: Props) {
  return (
    <div className="p-3">
      <div className="panel-beveled p-4 bg-surface-base border-t-2 border-t-brand-500">
        <div className="flex items-center gap-2 mb-3">
          <Wrench className="w-4 h-4 text-brand-400" />
          <h3 className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">Maintenance Monitor</h3>
        </div>
        <p className="text-[10px] text-rmpg-400">Fleet maintenance overview — coming soon</p>
      </div>
    </div>
  );
}
