import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import SpmGroup from '../../pages/dashboard/SpmGroup';

interface ShiftComparisonProps {
  dayShift: number;
  nightShift: number;
  dayCalls?: number;
  nightCalls?: number;
  className?: string;
}

export default function ShiftComparison({
  dayShift,
  nightShift,
  dayCalls = 0,
  nightCalls = 0,
  className = '',
}: ShiftComparisonProps) {
  const data = [
    { name: 'Officers', Day: dayShift, Night: nightShift },
    { name: 'Calls', Day: dayCalls, Night: nightCalls },
  ];

  return (
    <div className={className}>
      <SpmGroup title="Shift Comparison">
        <div className="p-3">
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={data} layout="vertical" margin={{ left: 40, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--spm-border)" horizontal={false} />
              <XAxis type="number" tick={{ fill: 'var(--spm-text-muted)', fontSize: 9 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: 'var(--spm-text)', fontSize: 9 }} width={40} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--surface-raised)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '2px',
                  color: 'var(--text-primary)',
                  fontSize: '11px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  padding: '6px 10px',
                }}
                cursor={{ fill: 'rgb(var(--spm-text-muted-rgb) / 0.08)' }}
              />
              <Bar dataKey="Day" fill="var(--stat-accent-amber)" radius={[0, 2, 2, 0]} isAnimationActive={true} animationDuration={600} />
              <Bar dataKey="Night" fill="var(--stat-accent-default)" radius={[0, 2, 2, 0]} isAnimationActive={true} animationDuration={600} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center justify-center gap-4 mt-1">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--stat-accent-amber)' }} />
              <span className="text-[9px] text-rmpg-300 font-semibold uppercase tracking-wider">Day (06-18)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--stat-accent-default)' }} />
              <span className="text-[9px] text-rmpg-300 font-semibold uppercase tracking-wider">Night (18-06)</span>
            </div>
          </div>
        </div>
      </SpmGroup>
    </div>
  );
}
