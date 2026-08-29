import { describe, it, expect, vi } from 'vitest';
import {
  sceneCategoryFromObservation,
  lightingFromObservation,
  isLiveWeatherWindow,
  pickNearestHourIndex,
  parseWeatherAtMs,
  fetchCfsWeather,
  parseWeatherSnapshot,
  formatWeatherWind,
  LIVE_WINDOW_MS,
} from '../src/utils/cfsWeather';

describe('sceneCategoryFromObservation', () => {
  it('maps the dispatcher-facing CFS categories', () => {
    expect(sceneCategoryFromObservation(0, 5)).toBe('Sunny');
    expect(sceneCategoryFromObservation(3, 5)).toBe('Overcast');
    expect(sceneCategoryFromObservation(63, 8)).toBe('Rain');
    expect(sceneCategoryFromObservation(95, 8)).toBe('Thunderstorm');
    expect(sceneCategoryFromObservation(0, 22)).toBe('Windy');
    expect(sceneCategoryFromObservation(73, 40)).toBe('Snow');
    expect(sceneCategoryFromObservation(45, 3)).toBe('Fog');
  });

  it('lets thunderstorm beat wind', () => {
    expect(sceneCategoryFromObservation(99, 50)).toBe('Thunderstorm');
  });
});

describe('lightingFromObservation', () => {
  it('uses is_day when present', () => {
    expect(lightingFromObservation(true, null)).toBe('Daylight');
    expect(lightingFromObservation(false, null)).toBe('Dark - Street Lit');
  });
});

describe('isLiveWeatherWindow', () => {
  const now = Date.parse('2026-08-28T18:02:19Z');

  it('treats missing / future / recent times as live', () => {
    expect(isLiveWeatherWindow(null, now)).toBe(true);
    expect(isLiveWeatherWindow(now + 60_000, now)).toBe(true);
    expect(isLiveWeatherWindow(now - 10 * 60_000, now)).toBe(true);
  });

  it('treats a morning entry as historical when now is evening', () => {
    const morning = Date.parse('2026-08-28T13:28:29Z'); // 07:28 MT
    expect(isLiveWeatherWindow(morning, now)).toBe(false);
    expect(now - morning > LIVE_WINDOW_MS).toBe(true);
  });
});

describe('parseWeatherAtMs', () => {
  it('reads naive D1 timestamps as UTC', () => {
    expect(parseWeatherAtMs('2026-08-28 18:02:19')).toBe(Date.parse('2026-08-28T18:02:19Z'));
  });
});

describe('pickNearestHourIndex', () => {
  it('picks the closest hourly slot', () => {
    const times = ['2026-08-28T17:00', '2026-08-28T18:00', '2026-08-28T19:00'];
    expect(pickNearestHourIndex(times, Date.parse('2026-08-28T18:02:19Z'))).toBe(1);
  });
});

describe('fetchCfsWeather', () => {
  it('uses the current endpoint inside the live window', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      current: {
        time: '2026-08-28T18:00',
        temperature_2m: 72.4,
        apparent_temperature: 70,
        relative_humidity_2m: 22,
        precipitation: 0,
        weather_code: 0,
        cloud_cover: 5,
        visibility: 79200,
        wind_speed_10m: 8,
        wind_direction_10m: 315,
        wind_gusts_10m: 12,
        is_day: 1,
      },
      current_units: { visibility: 'ft' },
    }), { status: 200 }));

    const snap = await fetchCfsWeather({
      lat: 40.76,
      lng: -111.89,
      at: '2026-08-28 18:02:19',
      nowMs: Date.parse('2026-08-28T18:10:00Z'),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(snap).not.toBeNull();
    expect(snap!.source).toBe('live');
    expect(snap!.temp_f).toBe(72);
    expect(snap!.scene_category).toBe('Sunny');
    expect(snap!.wind_dir).toBe('NW');
    expect(snap!.lighting).toBe('Daylight');
    const liveUrl = String((fetchImpl.mock.calls as unknown as unknown[][])[0]?.[0]);
    expect(liveUrl).toContain('/v1/forecast');
    expect(liveUrl).toContain('current=');
  });

  it('uses hourly history when the entry time is older than the live window', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      hourly: {
        time: ['2026-08-28T13:00', '2026-08-28T14:00'],
        temperature_2m: [48, 51],
        apparent_temperature: [46, 49],
        relative_humidity_2m: [40, 38],
        precipitation: [0, 0],
        weather_code: [3, 3],
        cloud_cover: [90, 85],
        visibility: [52800, 52800],
        wind_speed_10m: [4, 6],
        wind_direction_10m: [180, 180],
        wind_gusts_10m: [7, 9],
        is_day: [1, 1],
      },
      hourly_units: { visibility: 'ft' },
    }), { status: 200 }));

    const snap = await fetchCfsWeather({
      lat: 40.76,
      lng: -111.89,
      at: '2026-08-28 13:28:29', // stored UTC
      nowMs: Date.parse('2026-08-28T18:02:19Z'),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(snap).not.toBeNull();
    expect(snap!.source).toBe('historical');
    expect(snap!.scene_category).toBe('Overcast');
    expect(snap!.temp_f).toBe(48);
    expect(String((fetchImpl.mock.calls as unknown as unknown[][])[0]?.[0])).toContain('hourly=');
  });
});

describe('parseWeatherSnapshot / formatWeatherWind', () => {
  it('round-trips JSON and formats wind', () => {
    const parsed = parseWeatherSnapshot(JSON.stringify({
      temp_f: 72, scene_category: 'Sunny', wind_mph: 8, wind_dir: 'NW', wind_gust_mph: 14,
    }));
    expect(parsed?.scene_category).toBe('Sunny');
    expect(formatWeatherWind(parsed)).toBe('8 mph NW G14');
  });
});
