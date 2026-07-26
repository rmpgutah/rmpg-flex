import { describe, it, expect, beforeEach } from 'vitest';
import {
  chartSeriesColors, chartAxisColor, chartGridColor, chartLegendColor, resolveThemeColor,
} from '../chartPalette';

describe('chartPalette', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  it('resolves a theme variable when set', () => {
    document.documentElement.style.setProperty('--text-muted', '#b1c1d3');
    expect(resolveThemeColor('--text-muted', '#000')).toBe('#b1c1d3');
  });

  it('falls back when the variable is unset', () => {
    expect(resolveThemeColor('--not-a-real-var', '#123456')).toBe('#123456');
  });

  it('never returns legacy brand gold from any accessor', () => {
    const all = [...chartSeriesColors(), chartAxisColor(), chartGridColor(), chartLegendColor()];
    expect(all.join(' ').toLowerCase()).not.toContain('#d4a017');
    expect(all.join(' ')).not.toContain('212, 160, 23');
  });

  it('returns a non-empty, duplicate-free series palette', () => {
    const series = chartSeriesColors();
    expect(series.length).toBeGreaterThanOrEqual(4);
    expect(new Set(series).size).toBe(series.length);
  });
});
