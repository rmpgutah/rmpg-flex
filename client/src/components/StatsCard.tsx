import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import SparklineChart from './dashboard/SparklineChart';

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
  sparklineData?: number[];
  animated?: boolean;
}

const ACCENT_COLORS: Record<string, string> = {
  blue: 'border-brand-700',
  red: 'border-red-700',
  green: 'border-green-700',
  amber: 'border-amber-700',
  purple: 'border-purple-700',
  gold: 'border-brand-gold-600',
};

const ICON_COLORS: Record<string, string> = {
  blue: 'text-brand-400 bg-brand-900/50',
  red: 'text-red-400 bg-red-900/50',
  green: 'text-green-400 bg-green-900/50',
  amber: 'text-amber-400 bg-amber-900/50',
  purple: 'text-purple-400 bg-purple-900/50',
  gold: 'text-brand-gold-400 bg-brand-gold-900/30',
};

const VALUE_COLORS: Record<string, string> = {
  blue: 'text-brand-400',
  red: 'text-red-400',
  green: 'text-green-400',
  amber: 'text-amber-400',
  purple: 'text-purple-400',
  gold: 'text-brand-gold-400',
};

const TREND_COLOR_MAP: Record<string, string> = {
  green: 'text-green-400',
  red: 'text-red-400',
  amber: 'text-amber-400',
  gray: 'text-rmpg-300',
};

function StatsCard({
  icon: Icon,
  label,
  value,
  trend,
  trendValue,
  trendColor = 'gray',
  accent = 'blue',
  className = '',
  onClick,
  sparklineData,
  animated = true,
}: StatsCardProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  const accentVar: Record<string, string> = {
    blue: 'var(--stat-accent-default)',
    red: 'var(--stat-accent-red)',
    green: 'var(--stat-accent-green)',
    amber: 'var(--stat-accent-amber)',
    purple: 'var(--stat-accent-purple)',
    gold: 'var(--brand-gold)',
  };
  const glowColor = accentVar[accent] || accentVar.blue;
  // 25% / 13% alpha tints of the accent for glow/border washes (replaces the
  // old hex+alpha-suffix concat, which required a literal hex string).
  const glow25 = `color-mix(in srgb, ${glowColor} 25%, transparent)`;
  const glow13 = `color-mix(in srgb, ${glowColor} 13%, transparent)`;

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      aria-label={`${label}: ${value}`}
      className={`
        relative overflow-hidden border-l-4 panel-beveled
        ${ACCENT_COLORS[accent] || ACCENT_COLORS.blue}
        ${onClick ? 'cursor-pointer hover:brightness-110 transition-all duration-150 focus-visible:ring-1 focus-visible:ring-brand-500 focus-visible:outline-none active:scale-[0.99]' : ''}
        ${animated ? 'animate-stagger' : ''}
        hover-lift
        ${className}
      `}
      style={{ background: 'var(--surface-sunken)' }}
    >
      {/* Top accent glow line */}
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${glow25}, transparent)` }} />

      <div className="p-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[9px] font-bold uppercase mb-1.5 tracking-widest" style={{ color: glowColor, letterSpacing: '0.12em' }}>
              {label}
            </p>
            <p className={`text-2xl font-black font-mono tabular-nums ${VALUE_COLORS[accent] || VALUE_COLORS.blue}`}
              style={{ textShadow: `0 0 12px ${glow25}, 0 1px 2px rgba(0 0 0 / 0.5)`, lineHeight: 1 }}>
              {value}
            </p>
          </div>
          <div className="p-1.5 panel-inset" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${glow13}` }}>
            <Icon className="w-5 h-5" style={{ color: glowColor }} aria-hidden="true" />
          </div>
        </div>

        {(trend != null || (trendValue != null && trendValue !== '')) && (
          <div className={`flex items-center gap-1.5 mt-2.5 pt-1.5 ${TREND_COLOR_MAP[trendColor]}`}
            style={{ borderTop: '1px solid rgba(74,74,74,0.35)' }}>
            <TrendIcon className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
            {trendValue && <span className="text-[10px] font-medium tabular-nums">{trendValue}</span>}
          </div>
        )}
      </div>

      {sparklineData && sparklineData.length > 0 && (
        <div className="sparkline-container">
          <SparklineChart data={sparklineData} width={60} height={32} color={glowColor} />
        </div>
      )}
    </div>
  );
}

export default React.memo(StatsCard);
