import { describe, it, expect } from 'vitest';
import {
  formatHeading, relativeBearing, backAzimuth, cardinal, normalizeDeg,
} from '../navHeading';

describe('navHeading — formatHeading', () => {
  it('zero-pads to 3 digits with cardinal', () => {
    expect(formatHeading(58)).toBe('058 ENE'); // 58° is ENE on a 16-point rose (56.25–78.75°)
    expect(formatHeading(0)).toBe('000 N');
    expect(formatHeading(360)).toBe('000 N');
    expect(formatHeading(180)).toBe('180 S');
    expect(formatHeading(270)).toBe('270 W');
  });
  it('cardinal boundaries (16-point rose)', () => {
    expect(cardinal(0)).toBe('N');
    expect(cardinal(45)).toBe('NE');
    expect(cardinal(90)).toBe('E');
    expect(cardinal(135)).toBe('SE');
    expect(cardinal(225)).toBe('SW');
    expect(cardinal(315)).toBe('NW');
    expect(cardinal(337.5)).toBe('NNW');  // exact NNW center (337.5/22.5=15)
    expect(cardinal(349)).toBe('N');      // rounds into N band (349/22.5≈15.5→16→0)
  });
});

describe('navHeading — normalizeDeg', () => {
  it('wraps negatives and overflow', () => {
    expect(normalizeDeg(-10)).toBe(350);
    expect(normalizeDeg(370)).toBe(10);
    expect(normalizeDeg(NaN)).toBe(0);
  });
});

describe('navHeading — relativeBearing wrap-around', () => {
  it('basic and seam-crossing cases', () => {
    expect(relativeBearing(90, 45)).toBe(45);
    expect(relativeBearing(10, 350)).toBe(20);   // crosses north
    expect(relativeBearing(350, 10)).toBe(340);  // other direction
    expect(relativeBearing(0, 0)).toBe(0);
  });
});

describe('navHeading — backAzimuth', () => {
  it('reciprocal bearing', () => {
    expect(backAzimuth(58)).toBe(238);
    expect(backAzimuth(238)).toBe(58);
    expect(backAzimuth(0)).toBe(180);
  });
});
