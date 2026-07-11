import React from 'react';

interface ResponseTimeGaugeProps {
  value: number;
  max?: number;
  label?: string;
  threshold?: number;
  size?: number;
  strokeWidth?: number;
}

function getColor(value: number, threshold: number): string {
  if (value <= threshold) return 'var(--sev-ok)';
  if (value <= threshold * 1.5) return 'var(--sev-warn)';
  return 'var(--sev-critical)';
}

export default function ResponseTimeGauge({
  value,
  max = 30,
  label = 'Avg Response',
  threshold = 10,
  size = 100,
  strokeWidth = 8,
}: ResponseTimeGaugeProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(value / max, 1);
  const offset = circumference * (1 - fraction);
  const color = getColor(value, threshold);
  const displayValue = value < 60 ? `${Math.round(value)}m` : `${Math.round(value)}m`;

  return (
    <div className="gauge-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="gauge-bg" cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} />
        <circle
          className="gauge-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="gauge-center">
        <span className="text-lg font-bold font-mono tabular-nums" style={{ color }}>{displayValue}</span>
        <span className="text-[8px] text-rmpg-400 uppercase font-bold tracking-wider mt-0.5">{label}</span>
      </div>
    </div>
  );
}
