import { Cloud, CloudRain, CloudLightning, Sun, Wind } from 'lucide-react';
import { formatWeatherWind } from '../utils/cfsWeatherFormat';
import type { CallForService } from '../types';

type Snap = NonNullable<CallForService['weather_snapshot']>;

function iconFor(category: string | undefined) {
  const c = (category || '').toLowerCase();
  if (c.includes('thunder')) return CloudLightning;
  if (c.includes('rain') || c.includes('shower')) return CloudRain;
  if (c.includes('wind')) return Wind;
  if (c.includes('overcast') || c.includes('cloud') || c.includes('fog') || c.includes('snow')) return Cloud;
  return Sun;
}

export function CfsWeatherStrip({
  snapshot,
  conditions,
  compact = false,
  className = '',
}: {
  snapshot?: Snap | null;
  conditions?: string;
  compact?: boolean;
  className?: string;
}) {
  if (!snapshot && !conditions) return null;
  const category = snapshot?.scene_category || snapshot?.condition || conditions || '';
  const Icon = iconFor(category);
  const temp = snapshot?.temp_f != null ? `${Math.round(snapshot.temp_f)}°F` : '';
  const wind = formatWeatherWind(snapshot);
  const src = snapshot?.source === 'historical' ? 'hist' : snapshot ? 'live' : '';

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-rmpg-200 ${className}`}
      title={snapshot?.observed_at ? `Observed ${snapshot.observed_at}` : undefined}
    >
      <Icon className="w-3.5 h-3.5 text-accent-silver-400 shrink-0" aria-hidden />
      {temp && <span className="font-semibold text-rmpg-100 tabular-nums">{temp}</span>}
      {category && <span className="text-rmpg-100">{category}</span>}
      {wind && (
        <span className="text-rmpg-300 inline-flex items-center gap-0.5">
          <Wind className="w-3 h-3" aria-hidden />
          {wind}
        </span>
      )}
      {!compact && snapshot?.humidity != null && (
        <span className="text-rmpg-400">RH {snapshot.humidity}%</span>
      )}
      {!compact && snapshot?.visibility_mi != null && (
        <span className="text-rmpg-400">Vis {snapshot.visibility_mi} mi</span>
      )}
      {src && <span className="text-[9px] uppercase tracking-wider text-rmpg-500">{src}</span>}
    </div>
  );
}

export function WeatherQuickChips({
  value,
  onSelect,
}: {
  value?: string;
  onSelect: (value: string) => void;
}) {
  const chips = ['Sunny', 'Overcast', 'Rain', 'Thunderstorm', 'Windy'] as const;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip) => {
        const on = value === chip;
        return (
          <button
            key={chip}
            type="button"
            onClick={() => onSelect(chip)}
            className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border transition-colors"
            style={{
              borderColor: on ? 'var(--accent-silver-400)' : 'var(--border-default)',
              color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: on ? 'rgba(195,204,214,0.12)' : 'transparent',
            }}
          >
            {chip}
          </button>
        );
      })}
    </div>
  );
}
