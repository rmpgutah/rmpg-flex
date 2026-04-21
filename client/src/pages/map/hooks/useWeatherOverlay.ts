import { useState, useEffect, useRef } from 'react';

const API_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=40.7608&longitude=-111.8910&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m,apparent_temperature,uv_index,visibility&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FDenver&forecast_days=1';

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

interface WeatherData {
  temp: number;
  weatherCode: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  feelsLike: number | null;
  uvIndex: number | null;
  visibility: number | null; // meters
  sunrise: string | null;
  sunset: string | null;
  fetchedAt: number;
}

// Module-level cache so it survives re-mounts
let cachedWeather: WeatherData | null = null;

export interface UseWeatherOverlayResult {
  temp: number | null;
  weatherCode: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  feelsLike: number | null;
  uvIndex: number | null;
  visibility: number | null;
  sunrise: string | null;
  sunset: string | null;
  loading: boolean;
  error: string | null;
}

function isCacheValid(): boolean {
  return cachedWeather !== null && Date.now() - cachedWeather.fetchedAt < CACHE_TTL;
}

async function fetchWeather(signal?: AbortSignal): Promise<WeatherData> {
  const res = await fetch(API_URL, { signal });
  if (!res.ok) throw new Error(`Weather API ${res.status}`);
  const json = await res.json();
  const c = json.current;
  const d = json.daily;
  return {
    temp: Math.round(c.temperature_2m),
    weatherCode: c.weather_code,
    humidity: c.relative_humidity_2m,
    windSpeed: Math.round(c.wind_speed_10m),
    windDirection: c.wind_direction_10m ?? null,
    feelsLike: c.apparent_temperature != null ? Math.round(c.apparent_temperature) : null,
    uvIndex: c.uv_index ?? null,
    visibility: c.visibility ?? null,
    sunrise: d?.sunrise?.[0] ?? null,
    sunset: d?.sunset?.[0] ?? null,
    fetchedAt: Date.now(),
  };
}

export function useWeatherOverlay(): UseWeatherOverlayResult {
  const [data, setData] = useState<WeatherData | null>(cachedWeather);
  const [loading, setLoading] = useState(!isCacheValid());
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    const load = async () => {
      if (isCacheValid()) {
        setData(cachedWeather);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const weather = await fetchWeather(abortController.signal);
        cachedWeather = weather;
        if (!cancelled) {
          setData(weather);
          setError(null);
        }
      } catch (e) {
        // Degrade gracefully — keep stale cache if available
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Weather unavailable');
          if (cachedWeather) setData(cachedWeather);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    // Auto-refresh every 15 minutes
    intervalRef.current = setInterval(load, CACHE_TTL);

    return () => {
      cancelled = true;
      abortController.abort();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return {
    temp: data?.temp ?? null,
    weatherCode: data?.weatherCode ?? null,
    humidity: data?.humidity ?? null,
    windSpeed: data?.windSpeed ?? null,
    windDirection: data?.windDirection ?? null,
    feelsLike: data?.feelsLike ?? null,
    uvIndex: data?.uvIndex ?? null,
    visibility: data?.visibility ?? null,
    sunrise: data?.sunrise ?? null,
    sunset: data?.sunset ?? null,
    loading,
    error,
  };
}
