import { describe, it, expect, beforeEach } from 'vitest';
import {
  chartSeriesColors, chartAxisColor, chartGridColor, chartLegendColor, resolveThemeColor,
  chartPriorityColors, chartPriorityColor, chartPlotSurface,
} from '../chartPalette';

describe('chartPalette', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  it('resolves a theme variable when set', () => {
    document.documentElement.style.setProperty('--text-muted', '#9bb0c7');
    expect(resolveThemeColor('--text-muted', '#000')).toBe('#9bb0c7');
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

describe('chart priority ramp', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
    document.documentElement.style.setProperty('--chart-pri-1', '#ff9483');
    document.documentElement.style.setProperty('--chart-pri-2', '#e08355');
    document.documentElement.style.setProperty('--chart-pri-3', '#a87e5b');
    document.documentElement.style.setProperty('--chart-pri-4', '#7e6f61');
    document.documentElement.style.setProperty('--chart-plot-surface', '#142840');
  });

  it('returns the four ramp steps in P1..P4 order', () => {
    expect(chartPriorityColors()).toEqual(['#ff9483', '#e08355', '#a87e5b', '#7e6f61']);
  });

  it('resolves the plot surface', () => {
    expect(chartPlotSurface()).toBe('#142840');
  });

  it('accepts both the "P1" and bare "1" key shapes', () => {
    // The map's ActiveCall.priority is a bare number string while the typed
    // CallPriority is 'P1'. Both must resolve or markers silently go gray.
    expect(chartPriorityColor('P1')).toBe('#ff9483');
    expect(chartPriorityColor('1')).toBe('#ff9483');
    expect(chartPriorityColor(1)).toBe('#ff9483');
    expect(chartPriorityColor('p4')).toBe('#7e6f61');
  });

  it('falls back to the most recessive step, never to a failing color', () => {
    expect(chartPriorityColor(undefined)).toBe('#7e6f61');
    expect(chartPriorityColor('banana')).toBe('#7e6f61');
    expect(chartPriorityColor('9')).toBe('#7e6f61');
  });
});
