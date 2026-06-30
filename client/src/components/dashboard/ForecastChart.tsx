import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

interface ForecastDataPoint {
  hour: string;
  actual: number;
  forecast?: number;
}

interface ForecastChartProps {
  data: ForecastDataPoint[];
  className?: string;
}

export default function ForecastChart({ data, className = '' }: ForecastChartProps) {
  if (!data.length) return null;

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--spm-border)" vertical={false} />
          <XAxis dataKey="hour" tick={{ fill: 'var(--spm-text-muted)', fontSize: 9 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: 'var(--spm-text-muted)', fontSize: 9 }} allowDecimals={false} />
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
            formatter={(value: number, name: string) => [
              `${value} calls`,
              name === 'actual' ? 'Actual' : 'Forecast',
            ]}
          />
          <Bar dataKey="actual" fill="var(--stat-accent-green)" radius={[2, 2, 0, 0]} isAnimationActive={true} animationDuration={800} />
          {data.some(d => d.forecast != null) && (
            <Bar dataKey="forecast" fill="url(#forecastGrad)" radius={[2, 2, 0, 0]} isAnimationActive={true} animationDuration={800} className="forecast-line" />
          )}
          <defs>
            <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--stat-accent-amber)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--stat-accent-amber)" stopOpacity="0.08" />
            </linearGradient>
          </defs>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-3 mt-1 px-2">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--stat-accent-green)' }} />
          <span className="text-[9px] text-rmpg-300 font-semibold uppercase tracking-wider">Actual</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-0.5" style={{ background: 'var(--stat-accent-amber)', borderTop: '2px dashed var(--stat-accent-amber)' }} />
          <span className="text-[9px] text-rmpg-300 font-semibold uppercase tracking-wider">Forecast</span>
        </div>
      </div>
    </div>
  );
}
