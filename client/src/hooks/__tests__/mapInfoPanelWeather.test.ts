import { describe, it, expect, vi } from 'vitest';

// mapbox-gl is imported for the popup construction path only; the pure
// normalizer under test never touches it.
vi.mock('mapbox-gl', () => ({ default: { Popup: class {} } }));

import { toWeatherInfo } from '../useMapInfoPanel';

describe('toWeatherInfo', () => {
  it('formats a complete observation', () => {
    const info = toWeatherInfo({
      temp_f: 78, feels_like_f: 82, condition: 'Clear', humidity: 21,
      wind_mph: 8, wind_dir: 'NW', wind_gust_mph: 22, visibility_mi: 10,
      pressure_in: 29.92, dew_point_f: 34,
    });
    expect(info).not.toBeNull();
    expect(info!.temp).toBe('78°F');
    expect(info!.feelsLike).toBe('feels 82°F');
    expect(info!.condition).toBe('Clear');
    expect(info!.wind).toBe('8 mph NW G22');
    expect(info!.humidity).toBe('21%');
    expect(info!.visibility).toBe('10 mi vis');
    expect(info!.pressure).toBe('29.92 inHg');
  });

  // This is the regression the operator reported: the popup rendered
  // "NaN°F · · Wind NaN mph undefined" because the route answered the raw
  // Open-Meteo shape while the caller destructured the normalized one.
  it('never emits NaN or "undefined" when the normalized fields are absent', () => {
    const info = toWeatherInfo({ current: { temperature_2m: 72, weather_code: 0 } });
    const serialized = JSON.stringify(info);
    expect(serialized).not.toContain('NaN');
    expect(serialized).not.toContain('undefined');
    // The raw block still carries a usable temperature, so it is used.
    expect(info!.temp).toBe('72°F');
    expect(info!.wind).toBeUndefined();
  });

  it('returns null when there is nothing worth rendering', () => {
    expect(toWeatherInfo(null)).toBeNull();
    expect(toWeatherInfo(undefined)).toBeNull();
    expect(toWeatherInfo({})).toBeNull();
    expect(toWeatherInfo({ temp_f: null, wind_mph: null, condition: 'Unknown' })).toBeNull();
  });

  it('omits the direction token rather than printing "undefined"', () => {
    expect(toWeatherInfo({ wind_mph: 12 })!.wind).toBe('12 mph');
    expect(toWeatherInfo({ wind_mph: 12, wind_dir: null })!.wind).toBe('12 mph');
  });

  it('suppresses a gust token that is not meaningfully above sustained wind', () => {
    expect(toWeatherInfo({ wind_mph: 20, wind_gust_mph: 22 })!.wind).toBe('20 mph');
    expect(toWeatherInfo({ wind_mph: 20, wind_gust_mph: 31 })!.wind).toBe('20 mph G31');
  });

  it('suppresses "feels like" when it rounds to the same number as the temperature', () => {
    expect(toWeatherInfo({ temp_f: 70, feels_like_f: 70.2 })!.feelsLike).toBeUndefined();
    expect(toWeatherInfo({ temp_f: 70, feels_like_f: 75 })!.feelsLike).toBe('feels 75°F');
  });

  it('drops the placeholder "Unknown" condition instead of showing it to an operator', () => {
    expect(toWeatherInfo({ temp_f: 60, condition: 'Unknown' })!.condition).toBeUndefined();
  });

  it('passes hazard level and reasons through for the popup warning row', () => {
    const info = toWeatherInfo({
      temp_f: 30, condition: 'Heavy Snow',
      hazard: { level: 'warning', reasons: ['Heavy Snow', 'Visibility 0.20 mi'] },
    });
    expect(info!.hazardLevel).toBe('warning');
    expect(info!.hazardReasons).toEqual(['Heavy Snow', 'Visibility 0.20 mi']);
  });

  it('picks a condition-appropriate icon', () => {
    expect(toWeatherInfo({ temp_f: 60, condition: 'Clear' })!.icon).toBe('☀️');
    expect(toWeatherInfo({ temp_f: 30, condition: 'Heavy Snow' })!.icon).toBe('🌨');
    expect(toWeatherInfo({ temp_f: 60, condition: 'Thunderstorm' })!.icon).toBe('⛈');
    expect(toWeatherInfo({ temp_f: 60, condition: 'Light Showers' })!.icon).toBe('🌧');
  });
});
