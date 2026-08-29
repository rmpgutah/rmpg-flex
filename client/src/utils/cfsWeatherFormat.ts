import type { CallForService } from '../types';

type Snap = NonNullable<CallForService['weather_snapshot']>;

export function formatWeatherWind(snap: Snap | null | undefined): string {
  if (!snap || snap.wind_mph == null) return '';
  const dir = snap.wind_dir ? ` ${snap.wind_dir}` : '';
  const gust = snap.wind_gust_mph != null && snap.wind_gust_mph > (snap.wind_mph ?? 0)
    ? ` G${Math.round(snap.wind_gust_mph)}`
    : '';
  return `${Math.round(snap.wind_mph)} mph${dir}${gust}`;
}

export function formatWeatherPdfLine(snap: Snap | null | undefined, fallback?: string): string {
  if (!snap) return fallback || '';
  const parts = [
    snap.temp_f != null ? `${Math.round(snap.temp_f)}°F` : '',
    snap.scene_category || snap.condition || fallback || '',
    formatWeatherWind(snap),
  ].filter(Boolean);
  return parts.join('  ·  ');
}
