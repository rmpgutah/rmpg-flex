import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useCountUp } from '../hooks/useCountUp';

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

function AnimatedValue({ value, className }: { value: string | number; className: string }) {
  const numericValue = typeof value === 'number' ? value : parseInt(String(value), 10);
  const isNumeric = typeof value === 'number' || (!isNaN(numericValue) && String(numericValue) === String(value));
  const animated = useCountUp(isNumeric ? numericValue : 0);

  return (
    <p className={className}>
      {isNumeric ? animated : value}
    </p>
  );
}

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
      className={`
        relative overflow-hidden p-3 border-l-4 panel-beveled shimmer-on-hover card-glass stat-pod
        ${ACCENT_COLORS[accent] || ACCENT_COLORS.blue}
        bg-surface-base
        ${onClick ? 'cursor-pointer hover:bg-surface-raised transition-all duration-150' : ''}
        ${className}
      `}
    >
      {/* Ambient glow accent at top */}
      <div className="absolute top-0 left-0 right-0 h-[1px] opacity-40" style={{
        background: `linear-gradient(90deg, transparent, ${
          accent === 'red' ? '#dc2626' : accent === 'green' ? '#22c55e' : accent === 'amber' ? '#f59e0b' : accent === 'purple' ? '#a855f7' : '#1a5a9e'
        }40, transparent)`
      }} />

      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">
            {label}
          </p>
          <AnimatedValue value={value} className={`text-xl font-bold font-mono ${VALUE_COLORS[accent] || VALUE_COLORS.blue}`} />
        </div>
        <div className={`p-1.5 panel-inset ${ICON_COLORS[accent] || ICON_COLORS.blue}`} style={{
          boxShadow: `0 0 8px ${
            accent === 'red' ? 'rgba(220,38,38,0.15)' : accent === 'green' ? 'rgba(34,197,94,0.15)' : accent === 'amber' ? 'rgba(245,158,11,0.15)' : accent === 'purple' ? 'rgba(168,85,247,0.15)' : 'rgba(26,90,158,0.15)'
          }`
        }}>
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
