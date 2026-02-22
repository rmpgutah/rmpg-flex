import React from 'react';

interface GaugeRingProps {
  value: number;
  max: number;
  color: string;
  label: string;
  size?: number;
}

export default function GaugeRing({ value, max, color, label, size = 80 }: GaugeRingProps) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const strokeW = size < 50 ? 4 : 6;
  const radius = (size - strokeW * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - pct);
  const filterId = `gauge-glow-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="relative flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feColorMatrix in="blur" type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.6 0"
              result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#282828" strokeWidth={strokeW} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={strokeW} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
          filter={pct > 0 ? `url(#${filterId})` : undefined}
          style={{ transition: 'stroke-dashoffset 0.8s ease-in-out' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="font-bold font-mono" style={{ color, fontSize: size < 50 ? 12 : 18 }}>{value}</span>
        {size >= 50 && <span className="text-[8px] text-rmpg-400 uppercase tracking-wider">{label}</span>}
      </div>
    </div>
  );
}
