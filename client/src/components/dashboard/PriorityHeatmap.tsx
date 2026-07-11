import React, { useMemo } from 'react';

interface PriorityHeatmapProps {
  data: Array<{ priority: string; count: number }>;
  className?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  'P1': 'var(--sev-critical)',
  'P2': 'var(--sev-warn)',
  'P3': 'var(--sev-ok)',
  'P4': 'var(--sev-info)',
};

const PRIORITY_LABELS: Record<string, string> = {
  'P1': 'Emergency',
  'P2': 'Urgent',
  'P3': 'Routine',
  'P4': 'Scheduled',
};

export default function PriorityHeatmap({ data, className = '' }: PriorityHeatmapProps) {
  const maxCount = useMemo(() => Math.max(...data.map(d => d.count), 1), [data]);

  return (
    <div className={`space-y-1.5 ${className}`}>
      {data.map((item) => {
        const color = PRIORITY_COLORS[item.priority] || 'var(--text-muted)';
        const pct = (item.count / maxCount) * 100;
        return (
          <div key={item.priority} className="flex items-center gap-2">
            <span className="w-14 text-[10px] font-bold uppercase tracking-wider text-rmpg-400 flex-shrink-0">
              {PRIORITY_LABELS[item.priority] || item.priority}
            </span>
            <div className="flex-1 h-5 bg-surface-sunken rounded-sm overflow-hidden relative">
              <div
                className="h-full rounded-sm heatmap-cell flex items-center justify-end pr-1.5"
                style={{
                  width: `${Math.max(pct, 4)}%`,
                  background: `color-mix(in srgb, ${color} 40%, transparent)`,
                  borderRight: `2px solid ${color}`,
                }}
              >
                <span className="text-[10px] font-bold font-mono tabular-nums" style={{ color }}>
                  {item.count}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
