import React from 'react';

interface SparklineChartProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

export default function SparklineChart({
  data,
  width = 60,
  height = 24,
  color = 'var(--spm-text-muted)',
  className = '',
}: SparklineChartProps) {
  if (!data.length) return null;

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  });

  const polyline = points.join(' ');
  const areaPoints = `0,${height} ${polyline} ${width},${height}`;

  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`spark-grad-${color.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#spark-grad-${color.replace(/\W/g, '')})`} points={areaPoints} />
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={polyline} />
    </svg>
  );
}
