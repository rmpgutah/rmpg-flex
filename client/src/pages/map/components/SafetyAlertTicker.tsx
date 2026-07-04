import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { SafetyAlertItem } from '../../../hooks/useSafetyAlertFeed';

interface SafetyAlertTickerProps {
  items: SafetyAlertItem[];
  count: number;
  loading: boolean;
}

const SEVERITY_COLOR: Record<SafetyAlertItem['severity'], string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
};

function AlertRow({ item }: { item: SafetyAlertItem }) {
  const color = SEVERITY_COLOR[item.severity];
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs" style={{ borderLeft: `2px solid ${color}` }}>
      <span style={{ color }} className="font-semibold">{item.label}</span>
      {item.detail && <span className="text-rmpg-400 truncate">{item.detail}</span>}
    </div>
  );
}

/** Unified panic/welfare/premise-alert feed for the Map page. The top 3
 *  items (already sorted panic > welfare > premise by useSafetyAlertFeed)
 *  stay visible in a compact strip even when collapsed — this is a display
 *  surface, not a control, so "collapsed" only hides items beyond the top 3,
 *  it never hides the highest-priority alerts entirely. */
export default function SafetyAlertTicker({ items, count }: SafetyAlertTickerProps) {
  const [expanded, setExpanded] = useState(false);
  if (count === 0) return null;

  const visibleItems = expanded ? items : items.slice(0, 3);

  return (
    <div className="absolute top-14 left-3 z-20 bg-surface-raised/95 border border-border-default backdrop-blur-sm" style={{ borderRadius: 2, minWidth: 220, maxWidth: 320 }}>
      <button
        type="button"
        aria-label={`Safety alerts (${count})`}
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
      >
        <AlertTriangle className="w-3.5 h-3.5 text-[#ef4444]" />
        <span className="text-rmpg-200 text-xs font-semibold flex-1">Safety Alerts</span>
        <span className="bg-[#ef4444] text-white text-[10px] font-bold px-1.5 rounded-sm">{count}</span>
      </button>
      <div className="flex flex-col gap-0.5 pb-1">
        {visibleItems.map(item => <AlertRow key={item.id} item={item} />)}
      </div>
    </div>
  );
}
