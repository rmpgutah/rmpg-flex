// ============================================================
// RMPG Flex — Weather Utility
// Uses Open-Meteo API (free, no API key required)
// Provides current conditions for auto-fill and dashboard widget
// ============================================================

export interface WeatherData {
  temperature: number;        // °F
  feelsLike: number;          // °F
  condition: string;          // Human-readable: "Clear", "Rain", "Snow", etc.
  conditionCode: number;      // WMO weather code
  windSpeed: number;          // mph
  windDirection: number;      // degrees
  humidity: number;           // %
  isDay: boolean;
  precipitation: number;      // inches
  updatedAt: string;          // ISO timestamp
}

// WMO Weather Interpretation Codes → human-readable conditions
const WMO_CODES: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing Fog',
  51: 'Light Drizzle',
  53: 'Drizzle',
  55: 'Heavy Drizzle',
  56: 'Freezing Drizzle',
  57: 'Heavy Freezing Drizzle',
  61: 'Light Rain',
  63: 'Rain',
  65: 'Heavy Rain',
  66: 'Freezing Rain',
  67: 'Heavy Freezing Rain',
  71: 'Light Snow',
  73: 'Snow',
  75: 'Heavy Snow',
  77: 'Snow Grains',
  80: 'Light Showers',
  81: 'Showers',
  82: 'Heavy Showers',
  85: 'Light Snow Showers',
  86: 'Heavy Snow Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm w/ Hail',
  99: 'Severe Thunderstorm w/ Hail',
};

// Map WMO code to the form dropdown values used in IncidentFormModal
export function wmoToFormValue(code: number): string {
  if (code === 0 || code === 1) return 'Clear';
  if (code === 2) return 'Partly Cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain';
  if (code >= 85 && code <= 86) return 'Snow';
  if (code >= 95) return 'Rain'; // thunderstorms
  return 'Unknown';
}

let cachedWeather: WeatherData | null = null;
let cacheExpiry = 0;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

export async function fetchWeather(lat?: number, lon?: number): Promise<WeatherData | null> {
  // Return cache if fresh
  if (cachedWeather && Date.now() < cacheExpiry) return cachedWeather;

  // Get coordinates from params or browser geolocation
  let latitude = lat;
  let longitude = lon;

  if (latitude == null || longitude == null) {
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 5000, maximumAge: 600000 });
      });
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
    } catch {
      // Default to Salt Lake City area (RMPG base)
      latitude = 40.76;
      longitude = -111.89;
    }
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const c = data.current;

    cachedWeather = {
      temperature: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      condition: WMO_CODES[c.weather_code] || 'Unknown',
      conditionCode: c.weather_code,
      windSpeed: Math.round(c.wind_speed_10m),
      windDirection: c.wind_direction_10m,
      humidity: c.relative_humidity_2m,
      isDay: c.is_day === 1,
      precipitation: c.precipitation,
      updatedAt: new Date().toISOString(),
    };
    cacheExpiry = Date.now() + CACHE_DURATION;

    return cachedWeather;
  } catch {
    return null;
  }
}

export function getCachedWeather(): WeatherData | null {
  if (cachedWeather && Date.now() < cacheExpiry) return cachedWeather;
  return null;
}
