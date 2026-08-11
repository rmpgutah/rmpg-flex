import React, { useState, useEffect } from 'react';
import { Cloud } from 'lucide-react';

interface WeatherData { tempF: number; windMph: number; visibilityMi: number; description: string; }

function weatherDesc(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly Cloudy';
  if (code <= 49) return 'Foggy';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

export default function DesktopWeatherWidget() {
  const [wx, setWx] = useState<WeatherData | null>(null);
  const [error, setError] = useState(false);

  async function fetchWeather() {
    try {
      const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=40.7608&longitude=-111.891&current=temperature_2m,wind_speed_10m,visibility,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch');
      const d = await r.json();
      const c = d?.current;
      if (!c) { setError(true); return; }
      setWx({
        tempF: Math.round(c.temperature_2m),
        windMph: Math.round(c.wind_speed_10m),
        visibilityMi: Math.round((c.visibility ?? 0) / 5280 * 10) / 10,
        description: weatherDesc(c.weather_code ?? 0),
      });
    } catch { setError(true); }
  }

  useEffect(() => {
    fetchWeather();
    const iv = setInterval(fetchWeather, 600000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Cloud className="w-3 h-3" style={{ color: 'var(--brand-400)' }} />
        <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>WEATHER — SLC</span>
      </div>
      {error && <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Unavailable</div>}
      {wx && (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{wx.tempF}°</span>
            <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>F</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{wx.description}</div>
          <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2 }}>Wind {wx.windMph} mph · Vis {wx.visibilityMi} mi</div>
          {wx.visibilityMi < 1 && (
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--sev-warn, #f59e0b)', marginTop: 4 }}>⚠ LOW VIS</div>
          )}
        </div>
      )}
    </div>
  );
}
