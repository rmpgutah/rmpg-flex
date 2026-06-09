import { describe, it, expect, vi } from 'vitest';
import {
  NIGHT_RECOLOR, DAY_PRESET, NAV_THEMES, applyNavTheme,
  type ThemeableMap,
} from '../navThemePresets';

// Hex tokens with a clearly blue-dominant channel (b >> r,g) are forbidden.
function hasBlueToken(value: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return false;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return b > r + 16 && b > g + 16;
}

describe('navThemePresets — well-formed, zero blue', () => {
  it('night preset is structurally valid', () => {
    expect(NIGHT_RECOLOR.styleUrl).toMatch(/^mapbox:\/\//);
    expect(Array.isArray(NIGHT_RECOLOR.recolor)).toBe(true);
    expect(NIGHT_RECOLOR.recolor.length).toBeGreaterThan(0);
    expect(NIGHT_RECOLOR.markerColor).toBe('#d4a017');
  });

  it('day preset has no recolor and a light style', () => {
    expect(DAY_PRESET.recolor).toEqual([]);
    expect(DAY_PRESET.styleUrl).toMatch(/^mapbox:\/\//);
  });

  it('no blue tokens in any preset color', () => {
    const allColors = [
      ...NIGHT_RECOLOR.recolor.map(o => o.value),
      NIGHT_RECOLOR.markerColor,
      ...DAY_PRESET.recolor.map(o => o.value),
      DAY_PRESET.markerColor,
    ];
    for (const c of allColors) {
      expect(hasBlueToken(c), `blue token: ${c}`).toBe(false);
    }
  });

  it('NAV_THEMES maps both names', () => {
    expect(NAV_THEMES.night).toBe(NIGHT_RECOLOR);
    expect(NAV_THEMES.day).toBe(DAY_PRESET);
  });
});

describe('navThemePresets — applyNavTheme', () => {
  it('applies matching recolor ops, guarding each', () => {
    const setPaintProperty = vi.fn();
    const map: ThemeableMap = {
      getStyle: () => ({
        layers: [
          { id: 'background', type: 'background' },
          { id: 'water', type: 'fill' },
          { id: 'landuse', type: 'fill' },
          { id: 'road-label', type: 'symbol' },
        ],
      }),
      setPaintProperty,
    };
    const preset = applyNavTheme(map, 'night');
    expect(preset).toBe(NIGHT_RECOLOR);
    expect(setPaintProperty).toHaveBeenCalledWith('background', 'background-color', '#000000');
    expect(setPaintProperty).toHaveBeenCalledWith('water', 'fill-color', '#050505');
    expect(setPaintProperty).toHaveBeenCalledWith('landuse', 'fill-color', '#050505');
    // symbol layer untouched
    expect(setPaintProperty).not.toHaveBeenCalledWith('road-label', expect.anything(), expect.anything());
  });

  it('never throws when style is missing', () => {
    const map: ThemeableMap = { getStyle: () => undefined, setPaintProperty: vi.fn() };
    expect(() => applyNavTheme(map, 'day')).not.toThrow();
  });
});
