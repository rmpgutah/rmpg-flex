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
      aria-label={tooltip}
      className="group flex items-center gap-1.5 px-2 py-1 text-[11px] text-white/80 select-none pointer-events-auto transition-all duration-200 ease-out hover:gap-2.5 hover:px-3 shadow-lg"
      style={{
        background: 'rgba(13,21,32,0.75)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 2,
        textShadow: '0 1px 2px rgba(0,0,0,0.5)',
      }}
      title={tooltip}
    >
      {loading && temp === null ? (
        <span className="text-white/40 animate-pulse">—</span>
      ) : temp === null && !loading ? (
        <span className="text-red-400/60" title="Weather data unavailable">!</span>
      ) : (
        <>
          <span className="text-[13px] transition-all duration-200">{icon}</span>
          {/* #45: Weather values with font-mono for alignment */}
          <span className="font-medium font-mono tabular-nums">{temp ?? '—'}°F</span>
          <span className="text-white/30 text-[9px]">|</span>
          <span className="text-white/50 font-mono tabular-nums">{windSpeed ?? '—'} mph</span>
          <span className="hidden group-hover:inline text-white/30 text-[9px]">|</span>
          <span className="hidden group-hover:inline text-white/50 font-mono tabular-nums">{humidity ?? '—'}%</span>
        </>
      )}
    </div>
  );
}
