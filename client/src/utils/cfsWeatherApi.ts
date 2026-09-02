import { apiFetch } from '../hooks/useApi';
import type { CallForService } from '../types';

export type CfsWeatherSnapshot = NonNullable<CallForService['weather_snapshot']>;

export async function fetchCfsWeatherSnapshot(
  lat: number,
  lng: number,
  at?: string | null,
): Promise<CfsWeatherSnapshot | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const qs = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  if (at) qs.set('at', at);
  try {
    const res = await apiFetch<{ ok?: boolean } & CfsWeatherSnapshot>(`/weather/cfs?${qs.toString()}`);
    if (!res || (res as any).ok === false) return null;
    return res;
  } catch {
    return null;
  }
}
