import { describe, it, expect } from 'vitest';
import { normalizeWeather } from '../src/routes/weather';
import { describeWeatherCode, degreesToCompass, isHazardousCode } from '../src/utils/weatherCodes';

const LAT = 40.643393;
const LNG = -111.495066;

// Live Open-Meteo answers visibility in FEET for our imperial query — the
// `current_units` block is what declares it, so fixtures carry it too.
function meteo(current: Record<string, unknown>, units: Record<string, string> = { visibility: 'ft' }) {
  return { current, current_units: units, timezone: 'America/Denver', elevation: 2100 };
}

describe('weatherCodes helpers', () => {
  it('maps known WMO codes and degrades unknown ones to Unknown', () => {
    expect(describeWeatherCode(0)).toBe('Clear');
    expect(describeWeatherCode(95)).toBe('Thunderstorm');
    expect(describeWeatherCode(1234)).toBe('Unknown');
    expect(describeWeatherCode(undefined)).toBe('Unknown');
    expect(describeWeatherCode(NaN)).toBe('Unknown');
  });

  it('returns null — never the string "undefined" — for a missing bearing', () => {
    expect(degreesToCompass(undefined)).toBeNull();
    expect(degreesToCompass(null)).toBeNull();
    expect(degreesToCompass(NaN)).toBeNull();
  });

  it('converts degrees to 16-point compass points, wrapping at 360', () => {
    expect(degreesToCompass(0)).toBe('N');
    expect(degreesToCompass(90)).toBe('E');
    expect(degreesToCompass(315)).toBe('NW');
    expect(degreesToCompass(360)).toBe('N');
    expect(degreesToCompass(-90)).toBe('W');
  });

  it('flags freezing, snow and thunderstorm codes as hazardous', () => {
    expect(isHazardousCode(0)).toBe(false);
    expect(isHazardousCode(63)).toBe(false); // plain rain is not a scene hazard
    expect(isHazardousCode(67)).toBe(true);  // heavy freezing rain
    expect(isHazardousCode(73)).toBe(true);  // snow
    expect(isHazardousCode(99)).toBe(true);  // severe thunderstorm
  });
});

describe('normalizeWeather', () => {
  it('produces the normalized fields the map popup reads', () => {
    const out = normalizeWeather(meteo({
      time: '2026-08-02T14:00',
      temperature_2m: 78.4,
      apparent_temperature: 76.1,
      relative_humidity_2m: 21,
      dew_point_2m: 34.2,
      weather_code: 0,
      wind_speed_10m: 8.3,
      wind_gusts_10m: 14.9,
      wind_direction_10m: 315,
      pressure_msl: 1013.25,
      visibility: 79200, // ft = 15 mi
      cloud_cover: 5,
      precipitation: 0,
      is_day: 1,
    }), LAT, LNG);

    expect(out.temp_f).toBe(78);
    expect(out.feels_like_f).toBe(76);
    expect(out.condition).toBe('Clear');
    expect(out.wind_mph).toBe(8);
    expect(out.wind_dir).toBe('NW');
    expect(out.humidity).toBe(21);
    expect(out.pressure_in).toBeCloseTo(29.92, 2);
    expect(out.visibility_mi).toBe(15);
    expect(out.is_day).toBe(true);
    expect(out.location).toEqual({
      lat: LAT, lng: LNG, timezone: 'America/Denver', elevation_ft: 6890,
    });
  });

  it('forwards the raw `current` block untouched for back-compat', () => {
    // DashboardPage.tsx reads resp.current.temperature_2m — dropping this
    // would silently blank the dashboard weather widget.
    const current = { temperature_2m: 72, weather_code: 3 };
    expect(normalizeWeather(meteo(current), LAT, LNG).current).toEqual(current);
  });

  it('emits null — never NaN — for fields the provider omitted', () => {
    const out = normalizeWeather({ current: {} }, LAT, LNG);
    expect(out.temp_f).toBeNull();
    expect(out.wind_mph).toBeNull();
    expect(out.wind_dir).toBeNull();
    expect(out.humidity).toBeNull();
    expect(out.condition).toBe('Unknown');
    // The whole payload must be JSON-clean: NaN serializes to null silently,
    // so assert on the pre-serialization values instead.
    expect(Object.values(out).some((v) => typeof v === 'number' && Number.isNaN(v))).toBe(false);
  });

  it('handles a completely absent current block', () => {
    const out = normalizeWeather({}, LAT, LNG);
    expect(out.current).toBeNull();
    expect(out.hazard).toEqual({ level: 'none', reasons: [] });
  });

  describe('hazard derivation', () => {
    it('reports no hazard on a calm clear day', () => {
      const out = normalizeWeather(meteo({
        temperature_2m: 70, apparent_temperature: 70, weather_code: 0,
        wind_speed_10m: 5, wind_gusts_10m: 9, visibility: 79200,
      }), LAT, LNG);
      expect(out.hazard.level).toBe('none');
      expect(out.hazard.reasons).toEqual([]);
    });

    it('raises an advisory for 40+ mph gusts', () => {
      const out = normalizeWeather(meteo({
        temperature_2m: 60, weather_code: 0, wind_gusts_10m: 45,
      }), LAT, LNG);
      expect(out.hazard.level).toBe('advisory');
      expect(out.hazard.reasons).toContain('Wind gusts 45 mph');
    });

    it('escalates to a warning for damaging gusts', () => {
      const out = normalizeWeather(meteo({
        temperature_2m: 60, weather_code: 0, wind_gusts_10m: 62,
      }), LAT, LNG);
      expect(out.hazard.level).toBe('warning');
    });

    it('escalates to a warning for freezing rain, but only advises for snow', () => {
      expect(normalizeWeather(meteo({ weather_code: 66 }), LAT, LNG).hazard.level).toBe('warning');
      expect(normalizeWeather(meteo({ weather_code: 73 }), LAT, LNG).hazard.level).toBe('advisory');
    });

    it('warns on whiteout visibility and advises on reduced visibility', () => {
      // 1000 ft ~= 0.19 mi -> warning; 4000 ft ~= 0.76 mi -> advisory.
      expect(normalizeWeather(meteo({ visibility: 1000 }), LAT, LNG).hazard.level).toBe('warning');
      expect(normalizeWeather(meteo({ visibility: 4000 }), LAT, LNG).hazard.level).toBe('advisory');
    });

    // Regression guard for the unit trap: the SAME number must mean different
    // things depending on the declared unit. A hardcoded divisor passes one of
    // these two assertions and fails the other.
    it('honours the declared visibility unit rather than assuming one', () => {
      const ft = normalizeWeather(meteo({ visibility: 5280 }, { visibility: 'ft' }), LAT, LNG);
      const m = normalizeWeather(meteo({ visibility: 5280 }, { visibility: 'm' }), LAT, LNG);
      expect(ft.visibility_mi).toBe(1);
      expect(m.visibility_mi).toBe(3.3);
      // 1 mi trips the advisory tier; 3.3 mi does not.
      expect(ft.hazard.level).toBe('advisory');
      expect(m.hazard.level).toBe('none');
    });

    it('uses apparent temperature, not raw temperature, for cold exposure', () => {
      // 15 F air but -5 F wind chill is what the officer actually stands in.
      const out = normalizeWeather(meteo({
        temperature_2m: 15, apparent_temperature: -5, weather_code: 0,
      }), LAT, LNG);
      expect(out.hazard.level).toBe('advisory');
      expect(out.hazard.reasons.some((r) => r.startsWith('Extreme cold'))).toBe(true);
    });

    it('a warning-tier reason cannot be downgraded by a later advisory-tier one', () => {
      const out = normalizeWeather(meteo({
        weather_code: 95,          // thunderstorm -> warning
        apparent_temperature: 101, // extreme heat -> advisory
        wind_gusts_10m: 42,        // advisory
      }), LAT, LNG);
      expect(out.hazard.level).toBe('warning');
      expect(out.hazard.reasons.length).toBe(3);
    });
  });
});
