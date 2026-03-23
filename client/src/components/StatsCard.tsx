import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface StatsCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  trendColor?: 'green' | 'red' | 'amber' | 'gray';
  accent?: string;
  className?: string;
  onClick?: () => void;
}

const ACCENT_COLORS: Record<string, string> = {
  blue: 'border-brand-700',
  red: 'border-red-700',
  green: 'border-green-700',
  amber: 'border-amber-700',
  purple: 'border-purple-700',
};

const ICON_COLORS: Record<string, string> = {
  blue: 'text-brand-400 bg-brand-900/50',
  red: 'text-red-400 bg-red-900/50',
  green: 'text-green-400 bg-green-900/50',
  amber: 'text-amber-400 bg-amber-900/50',
  purple: 'text-purple-400 bg-purple-900/50',
};

const VALUE_COLORS: Record<string, string> = {
  blue: 'text-brand-400',
  red: 'text-red-400',
  green: 'text-green-400',
  amber: 'text-amber-400',
  purple: 'text-purple-400',
};

const TREND_COLOR_MAP: Record<string, string> = {
  green: 'text-green-400',
  red: 'text-red-400',
  amber: 'text-amber-400',
  gray: 'text-rmpg-300',
};

export default function StatsCard({
  icon: Icon,
  label,
  value,
  trend,
  trendValue,
  trendColor = 'gray',
  accent = 'blue',
  className = '',
  onClick,
}: StatsCardProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      aria-label={`${label}: ${value}`}
      className={`
        relative overflow-hidden p-3 border-l-4 panel-beveled
        ${ACCENT_COLORS[accent] || ACCENT_COLORS.blue}
        bg-surface-base
        ${onClick ? 'cursor-pointer hover:bg-surface-raised transition-all duration-150' : ''}
        ${className}
      `}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">
            {label}
          </p>
          <p className={`text-xl font-bold font-mono ${VALUE_COLORS[accent] || VALUE_COLORS.blue}`}>{value}</p>
        </div>
        <div className={`p-1.5 panel-inset ${ICON_COLORS[accent] || ICON_COLORS.blue}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>

      {(trend || trendValue) && (
        <div className={`flex items-center gap-1 mt-2 ${TREND_COLOR_MAP[trendColor]}`}>
          <TrendIcon className="w-3.5 h-3.5" />
          {trendValue && <span className="text-xs font-medium">{trendValue}</span>}
        </div>
      )}
    </div>
  );
}
