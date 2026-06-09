import { describe, it, expect } from 'vitest';
import { sunriseSunset, isDaylight } from '../solarPosition';

// Salt Lake City
const LAT = 40.7608;
const LNG = -111.891;

describe('solarPosition — sunriseSunset (SLC summer solstice)', () => {
  it('returns sunrise before sunset, within a plausible UTC window', () => {
    const date = new Date(Date.UTC(2026, 5, 21, 12, 0, 0)); // 2026-06-21
    const { sunrise, sunset } = sunriseSunset(LAT, LNG, date);
    expect(sunrise).not.toBeNull();
    expect(sunset).not.toBeNull();
    if (!sunrise || !sunset) return;
    expect(sunrise.getTime()).toBeLessThan(sunset.getTime());

    // SLC solstice sunrise ≈ 11:59 UTC (05:59 MDT), sunset ≈ 03:02 UTC next day
    // (21:02 MDT). The algorithm normalizes to same-day UTC hours; assert the
    // sunrise UTC hour lands ~12:00 ±30min.
    const sunriseUtcH = sunrise.getUTCHours() + sunrise.getUTCMinutes() / 60;
    expect(Math.abs(sunriseUtcH - 12.0)).toBeLessThan(0.5);
  });
});

describe('solarPosition — isDaylight', () => {
  it('true at local solar noon (≈19:00 UTC at SLC)', () => {
    const noonish = new Date(Date.UTC(2026, 5, 21, 19, 0, 0)); // ~13:00 MDT
    expect(isDaylight(LAT, LNG, noonish)).toBe(true);
  });
  it('false at local solar midnight (≈07:00 UTC at SLC)', () => {
    const midnightish = new Date(Date.UTC(2026, 5, 21, 7, 0, 0)); // ~01:00 MDT
    expect(isDaylight(LAT, LNG, midnightish)).toBe(false);
  });
  it('summer sunrise (UTC) is earlier than winter sunrise at SLC', () => {
    // Sunrise UTC hour is well within the same UTC day at SLC (no wrap),
    // so it is a stable comparison: longer summer days rise earlier.
    const summer = sunriseSunset(LAT, LNG, new Date(Date.UTC(2026, 5, 21, 12)));
    const winter = sunriseSunset(LAT, LNG, new Date(Date.UTC(2026, 11, 21, 12)));
    if (summer.sunrise && winter.sunrise) {
      const sH = summer.sunrise.getUTCHours() + summer.sunrise.getUTCMinutes() / 60;
      const wH = winter.sunrise.getUTCHours() + winter.sunrise.getUTCMinutes() / 60;
      expect(sH).toBeLessThan(wH);
    }
  });
});
