import React from 'react';
import { AlertTriangle, Shield, Skull, Flame, Siren, Heart, UserX, AlertOctagon, Eye } from 'lucide-react';

export interface WarningTag {
  type: string;
  label: string;
  severity: 'critical' | 'high' | 'medium';
  source: string;
}

interface WarningTagsProps {
  warnings: WarningTag[];
  compact?: boolean;
}

const SEVERITY_STYLES: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  critical: {
    bg: 'rgba(220, 38, 38, 0.25)',
    border: '#dc2626',
    text: '#fca5a5',
    glow: '0 0 6px rgba(220, 38, 38, 0.4)',
  },
  high: {
    bg: 'rgba(245, 158, 11, 0.2)',
    border: '#f59e0b',
    text: '#fcd34d',
    glow: '0 0 4px rgba(245, 158, 11, 0.3)',
  },
  medium: {
    bg: 'rgba(59, 130, 246, 0.15)',
    border: '#888888',
    text: '#cccccc',
    glow: 'none',
  },
};

const TYPE_ICONS: Record<string, React.FC<{ className?: string; style?: React.CSSProperties }>> = {
  ARMED: Skull,
  WARRANT: AlertOctagon,
  DV: Shield,
  SEX_OFFENDER: UserX,
  GANG: UserX,
  HAZMAT: Flame,
  HAZARD: Flame,
  BARRICADE: Shield,
  INJURIES: Heart,
  CAUTION: AlertTriangle,
  DRUGS: AlertTriangle,
  ALCOHOL: AlertTriangle,
  PROBATION: AlertTriangle,
  PTS: Eye,
};

export default function WarningTags({ warnings, compact = false }: WarningTagsProps) {
  if (!warnings || warnings.length === 0) return null;

  // Sort: critical first, then high, then medium
  const sorted = [...warnings].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2 };
    return (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
  });

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1">
        {sorted.map((w, i) => {
          const style = SEVERITY_STYLES[w.severity] || SEVERITY_STYLES.medium;
          return (
            <span
              key={`${w.type}-${i}`}
              className="inline-flex items-center gap-0.5 px-1 py-0 text-[8px] font-bold font-mono uppercase tracking-wider animate-pulse"
              style={{
                background: style.bg,
                border: `1px solid ${style.border}`,
                color: style.text,
                boxShadow: style.glow,
              }}
              title={`${w.label} — Source: ${w.source}`}
            >
              <AlertTriangle style={{ width: 7, height: 7 }} />
              {w.label.length > 12 ? w.label.substring(0, 12) + '\u2026' : w.label}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {sorted.map((w, i) => {
        const style = SEVERITY_STYLES[w.severity] || SEVERITY_STYLES.medium;
        const Icon = TYPE_ICONS[w.type] || AlertTriangle;
        return (
          <div
            key={`${w.type}-${i}`}
            className="flex items-center gap-2 px-2 py-1 text-[10px] font-bold font-mono uppercase tracking-wider"
            style={{
              background: style.bg,
              border: `1px solid ${style.border}`,
              color: style.text,
              boxShadow: style.glow,
            }}
          >
            <Icon style={{ width: 11, height: 11, flexShrink: 0 }} />
            <span className="flex-1 truncate">{w.label}</span>
            <span className="text-[8px] opacity-60 normal-case">{w.source}</span>
          </div>
        );
      })}
    </div>
  );
}
