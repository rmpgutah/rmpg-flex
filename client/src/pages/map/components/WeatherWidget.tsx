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

// Wind direction degree → compass cardinal
function windCardinal(deg: number | null): string {
  if (deg == null) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

// Format sunrise/sunset time string (ISO) to short time
function formatSunTime(iso: string | null): string {
  if (!iso) return '--';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return '--'; }
}

// Visibility in miles
function formatVisibilityMi(meters: number | null): string {
  if (meters == null) return '--';
  const mi = meters / 1609.34;
  if (mi >= 10) return '10+ mi';
  return `${mi.toFixed(1)} mi`;
}

export default function WeatherWidget({ weather }: WeatherWidgetProps) {
  const { temp, weatherCode, humidity, windSpeed, windDirection, feelsLike, uvIndex, visibility, sunrise, sunset, loading } = weather;
  const { icon, label } = weatherInfo(weatherCode);

  const visStr = formatVisibilityMi(visibility);
  const sunriseStr = formatSunTime(sunrise);
  const sunsetStr = formatSunTime(sunset);
  const cardinal = windCardinal(windDirection);

  const tooltip =
    temp !== null
      ? `${label} · ${temp}°F${feelsLike != null ? ` (feels ${feelsLike}°F)` : ''}\nHumidity: ${humidity}%\nWind: ${windSpeed} mph ${cardinal}\nVisibility: ${visStr}${uvIndex != null ? `\nUV Index: ${uvIndex}` : ''}\nSunrise: ${sunriseStr} · Sunset: ${sunsetStr}`
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
          {/* Wind speed + direction compass arrow */}
          <span className="flex items-center gap-0.5 text-white/50 font-mono tabular-nums">
            {windDirection != null && (
              <span
                className="inline-block text-[9px] text-white/40"
                style={{ transform: `rotate(${windDirection}deg)`, lineHeight: 1 }}
                title={`Wind from ${cardinal} (${windDirection}°)`}
              >
                &#8595;
              </span>
            )}
            {windSpeed ?? '—'} mph
          </span>
          {/* Hover-expanded details */}
          <span className="hidden group-hover:inline text-white/30 text-[9px]">|</span>
          <span className="hidden group-hover:inline text-white/50 font-mono tabular-nums">{humidity ?? '—'}%</span>
          {/* Visibility on hover */}
          {visibility != null && (
            <>
              <span className="hidden group-hover:inline text-white/30 text-[9px]">|</span>
              <span className="hidden group-hover:inline text-white/50 font-mono tabular-nums text-[10px]">{visStr}</span>
            </>
          )}
          {/* UV index on hover */}
          {uvIndex != null && uvIndex > 0 && (
            <>
              <span className="hidden group-hover:inline text-white/30 text-[9px]">|</span>
              <span className={`hidden group-hover:inline font-mono tabular-nums text-[10px] ${
                uvIndex >= 8 ? 'text-red-400' : uvIndex >= 6 ? 'text-orange-400' : uvIndex >= 3 ? 'text-yellow-400' : 'text-white/50'
              }`}>UV {uvIndex}</span>
            </>
          )}
          {/* Sunrise/sunset on hover */}
          {sunrise && sunset && (
            <>
              <span className="hidden group-hover:inline text-white/30 text-[9px]">|</span>
              <span className="hidden group-hover:inline text-yellow-400/60 font-mono tabular-nums text-[9px]" title={`Sunrise ${sunriseStr}`}>
                &#9728;{sunriseStr}
              </span>
              <span className="hidden group-hover:inline text-gray-400/60 font-mono tabular-nums text-[9px]" title={`Sunset ${sunsetStr}`}>
                &#9790;{sunsetStr}
              </span>
            </>
          )}
        </>
      )}
    </div>
  );
}
