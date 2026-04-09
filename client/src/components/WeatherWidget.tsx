// ============================================================
// RMPG Flex — Weather Widget (Dashboard)
// Shows current conditions from Open-Meteo API
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { Cloud, Droplets, Wind, Thermometer, Sun, CloudRain, CloudSnow, CloudLightning, CloudFog, RefreshCw, Loader2 } from 'lucide-react';
import { fetchWeather, type WeatherData } from '../utils/weather';

function getWeatherIcon(code: number, isDay: boolean): React.ElementType {
  if (code === 0 || code === 1) return Sun;
  if (code === 2 || code === 3) return Cloud;
  if (code === 45 || code === 48) return CloudFog;
  if (code >= 51 && code <= 67) return CloudRain;
  if (code >= 71 && code <= 86) return CloudSnow;
  if (code >= 95) return CloudLightning;
  return Cloud;
}

function getWindDirection(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

export default function WeatherWidget() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    const data = await fetchWeather();
    if (data) { setWeather(data); setError(false); }
    else { setError(true); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 10 minutes
  useEffect(() => {
    const interval = setInterval(refresh, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading && !weather) {
    return (
      <div className="panel-beveled bg-surface-base p-3 flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 text-rmpg-500 animate-spin" />
        <span className="text-[10px] text-rmpg-500">Loading weather...</span>
      </div>
    );
  }

  if (error && !weather) {
    return (
      <div className="panel-beveled bg-surface-base p-3 text-center">
        <Cloud className="w-5 h-5 text-rmpg-600 mx-auto mb-1" />
        <p className="text-[9px] text-rmpg-500">Weather unavailable</p>
        <button onClick={refresh} className="toolbar-btn text-[8px] mt-1" style={{ padding: '1px 6px' }}>
          <RefreshCw className="w-2.5 h-2.5" /> Retry
        </button>
      </div>
    );
  }

  if (!weather) return null;

  const WeatherIcon = getWeatherIcon(weather.conditionCode, weather.isDay);

  return (
    <div className="panel-beveled bg-surface-base">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-rmpg-700/30">
        <span className="text-[9px] text-rmpg-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
          <Cloud className="w-3 h-3" /> Current Weather
        </span>
        <button onClick={refresh} className="text-rmpg-600 hover:text-rmpg-400" title="Refresh weather">
          <RefreshCw className={`w-2.5 h-2.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="p-3">
        <div className="flex items-center gap-3">
          {/* Temperature + condition */}
          <div className="flex items-center gap-2">
            <WeatherIcon className="w-7 h-7 text-brand-400" />
            <div>
              <div className="text-xl font-bold font-mono text-white">{weather.temperature}°<span className="text-xs text-rmpg-400">F</span></div>
              <div className="text-[10px] text-rmpg-300">{weather.condition}</div>
            </div>
          </div>

          {/* Details grid */}
          <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-0.5 ml-3 border-l border-rmpg-700/30 pl-3">
            <div className="flex items-center gap-1.5 text-[9px]">
              <Thermometer className="w-2.5 h-2.5 text-rmpg-500" />
              <span className="text-rmpg-500">Feels</span>
              <span className="text-rmpg-300 font-mono">{weather.feelsLike}°F</span>
            </div>
            <div className="flex items-center gap-1.5 text-[9px]">
              <Wind className="w-2.5 h-2.5 text-rmpg-500" />
              <span className="text-rmpg-500">Wind</span>
              <span className="text-rmpg-300 font-mono">{weather.windSpeed} mph {getWindDirection(weather.windDirection)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[9px]">
              <Droplets className="w-2.5 h-2.5 text-rmpg-500" />
              <span className="text-rmpg-500">Humidity</span>
              <span className="text-rmpg-300 font-mono">{weather.humidity}%</span>
            </div>
            <div className="flex items-center gap-1.5 text-[9px]">
              <CloudRain className="w-2.5 h-2.5 text-rmpg-500" />
              <span className="text-rmpg-500">Precip</span>
              <span className="text-rmpg-300 font-mono">{weather.precipitation} in</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
