import { describe, it, expect } from 'vitest';
import { formatWeatherWind, formatWeatherPdfLine } from '../cfsWeatherFormat';
import { wmoToFormValue } from '../weather';

describe('cfs weather display', () => {
  it('formats wind with direction and gusts', () => {
    expect(formatWeatherWind({
      wind_mph: 8, wind_dir: 'NW', wind_gust_mph: 14, scene_category: 'Sunny',
    })).toBe('8 mph NW G14');
  });

  it('builds the PDF weather summary line', () => {
    expect(formatWeatherPdfLine({
      temp_f: 72, scene_category: 'Sunny', wind_mph: 8, wind_dir: 'NW',
    })).toBe('72°F  ·  Sunny  ·  8 mph NW');
  });
});

describe('wmoToFormValue', () => {
  it('maps thunderstorms and sun to CFS categories', () => {
    expect(wmoToFormValue(0)).toBe('Sunny');
    expect(wmoToFormValue(95)).toBe('Thunderstorm');
    expect(wmoToFormValue(3)).toBe('Overcast');
  });
});
