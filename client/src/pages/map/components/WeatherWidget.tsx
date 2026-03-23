import React from 'react';
import type { UseWeatherOverlayResult } from '../hooks/useWeatherOverlay';

// WMO weather code → emoji + label
function weatherInfo(code: number | null): { icon: string; label: string } {
  if (code === null) return { icon: '—', label: 'Unknown' };
  if (code === 0) return { icon: '☀️', label: 'Clear' };
  if (code <= 3) return { icon: '🌤️', label: 'Partly cloudy' };
  if (code <= 48) return { icon: '🌫️', label: 'Fog' };
  if (code <= 57) return { icon: '🌧️', label: 'Drizzle' };
  if (code <= 67) return { icon: '🌧️', label: 'Rain' };
  if (code <= 77) return { icon: '🌨️', label: 'Snow' };
  if (code <= 82) return { icon: '🌧️', label: 'Showers' };
  if (code <= 86) return { icon: '🌨️', label: 'Snow showers' };
  if (code <= 99) return { icon: '⛈️', label: 'Thunderstorm' };
  return { icon: '—', label: 'Unknown' };
}

interface WeatherWidgetProps {
  weather: UseWeatherOverlayResult;
}

export default function WeatherWidget({ weather }: WeatherWidgetProps) {
  const { temp, weatherCode, humidity, windSpeed, loading } = weather;
  const { icon, label } = weatherInfo(weatherCode);

  const tooltip =
    temp !== null
      ? `${label} · ${temp}°F\nHumidity: ${humidity}%\nWind: ${windSpeed} mph`
      : 'Weather unavailable';

  return (
    <div
      role="status"
      aria-busy={loading}
      className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-white/80 select-none pointer-events-auto"
      style={{
        background: 'rgba(13,21,32,0.75)',
        backdropFilter: 'blur(6px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 2,
      }}
      title={tooltip}
    >
      {loading && temp === null ? (
        <span className="text-white/40">—</span>
      ) : temp === null && !loading ? (
        <span className="text-red-400/60" title="Weather data unavailable">!</span>
      ) : (
        <>
          <span>{icon}</span>
          <span className="font-medium tabular-nums">{temp ?? '—'}°F</span>
          <span className="text-white/40">|</span>
          <span className="text-white/50 tabular-nums">{windSpeed ?? '—'} mph</span>
        </>
      )}
    </div>
  );
}
