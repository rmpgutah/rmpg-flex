import React from 'react';
import { Package, AlertTriangle } from 'lucide-react';
import SpmGroup from '../../pages/dashboard/SpmGroup';

interface EvidenceSummaryProps {
  total: number;
  checkedOut: number;
  pendingDisposal: number;
  className?: string;
}

export default function EvidenceSummary({
  total,
  checkedOut,
  pendingDisposal,
  className = '',
}: EvidenceSummaryProps) {
  return (
    <div className={className}>
      <SpmGroup title="Evidence">
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-rmpg-400" />
              <span className="text-[10px] text-rmpg-400 font-bold uppercase tracking-wider">Total Items</span>
            </div>
            <span className="text-sm font-bold font-mono tabular-nums text-rmpg-200">{total}</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-rmpg-400">Checked Out</span>
            <span className="font-bold font-mono tabular-nums text-amber-400">{checkedOut}</span>
          </div>
          {pendingDisposal > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-red-400 bg-red-900/20 p-1.5 panel-beveled">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              <span className="font-bold uppercase tracking-wider">{pendingDisposal} items pending disposal</span>
            </div>
          )}
        </div>
      </SpmGroup>
    </div>
  );
}
