import { BarChart3 } from 'lucide-react';

export default function AnalyticsTab() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 size={14} className="text-brand-gold-500" />
        <span className="text-[11px] font-semibold text-rmpg-100 uppercase tracking-wider">Analytics</span>
      </div>
      <div className="text-[11px] text-rmpg-500 text-center py-6">Loading analytics…</div>
    </div>
  );
}
