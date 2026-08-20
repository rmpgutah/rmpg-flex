import React, { useState, useEffect } from 'react';

const CACHE_KEY = 'rmpg_weather_cache';
const API_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=40.7608&longitude=-111.891' +
  '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,' +
  'wind_speed_10m,weather_code,cloud_cover' +
  '&wind_speed_unit=mph&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FDenver';

interface WeatherCurrent {
  temperature_2m: number;
  relative_humidity_2m: number;
  apparent_temperature: number;
  precipitation: number;
  wind_speed_10m: number;
  weather_code: number;
  cloud_cover: number;
}

interface WeatherState {
  tempF: number;
  feelsLikeF: number;
  humidity: number;
  windMph: number;
  weatherCode: number;
  cloudCover: number;
}

function weatherEmoji(code: number): string {
  if (code <= 1) return '☀️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code >= 45 && code <= 48) return '🌫';
  if (code >= 51 && code <= 67) return '🌧';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '⛈';
  if (code >= 95 && code <= 99) return '⛈';
  return '🌡';
}

function weatherLabel(code: number): string {
  if (code <= 1) return 'Clear';
  if (code === 2) return 'Partly Cloudy';
  if (code === 3) return 'Overcast';
  if (code >= 45 && code <= 48) return 'Fog';
  if (code >= 51 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 95 && code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

function isLowVis(state: WeatherState): boolean {
  return state.cloudCover > 80 || state.weatherCode >= 45;
}

function loadCache(): WeatherState | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WeatherState;
  } catch {
    return null;
  }
}

function saveCache(state: WeatherState): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable — ignore
  }
}

export default function DesktopWeatherWidget() {
  const [wx, setWx] = useState<WeatherState | null>(loadCache);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);

  async function fetchWeather() {
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const c: WeatherCurrent = data?.current;
      if (!c) throw new Error('no current block');
      const state: WeatherState = {
        tempF: Math.round(c.temperature_2m),
        feelsLikeF: Math.round(c.apparent_temperature),
        humidity: Math.round(c.relative_humidity_2m),
        windMph: Math.round(c.wind_speed_10m),
        weatherCode: c.weather_code ?? 0,
        cloudCover: c.cloud_cover ?? 0,
      };
      saveCache(state);
      setWx(state);
      setFetchFailed(false);
    } catch {
      setFetchFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchWeather();
    const iv = setInterval(fetchWeather, 15 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  const noData = !wx;
  const showError = fetchFailed && noData;

  return (
    <div style={{ padding: 8, minWidth: 110 }}>
      {/* Header */}
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', marginBottom: 6, textTransform: 'uppercase' }}>
        WEATHER — SLC
      </div>

      {showError ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Weather unavailable</div>
      ) : (
        <div>
          {/* Emoji + temp row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 20, lineHeight: 1 }} aria-hidden="true">
              {loading && noData ? null : wx ? weatherEmoji(wx.weatherCode) : null}
            </span>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
              {loading && noData ? '—°' : wx ? `${wx.tempF}°` : '—°'}
              {!loading && wx && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 1 }}>F</span>}
            </span>
          </div>

          {/* Condition label */}
          {wx && (
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 3 }}>
              {weatherLabel(wx.weatherCode)}
            </div>
          )}

          {/* Feels like */}
          {wx && (
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginBottom: 1 }}>
              Feels {wx.feelsLikeF}°F
            </div>
          )}

          {/* Wind */}
          {wx && (
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginBottom: 1 }}>
              Wind {wx.windMph} mph
            </div>
          )}

          {/* Humidity */}
          {wx && (
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginBottom: 3 }}>
              Humidity {wx.humidity}%
            </div>
          )}

          {/* Low-vis warning */}
          {wx && isLowVis(wx) && (
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--sev-warn)', marginTop: 2 }}>
              ⚠ Low visibility
            </div>
          )}

          {/* Stale cache notice */}
          {fetchFailed && wx && (
            <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginTop: 3, fontStyle: 'italic' }}>
              cached
            </div>
          )}
        </div>
      )}
    </div>
  );
}
