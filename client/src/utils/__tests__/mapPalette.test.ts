import { describe, it, expect } from 'vitest';
import { MAP_PALETTE, isArterialLayer, isMajorLabelLayer } from '../mapboxBasemap';

describe('MAP_PALETTE', () => {
  it('is fixed and does not depend on the active theme', () => {
    const before = { ...MAP_PALETTE };
    document.documentElement.className = 'theme-legacy-black';
    expect({ ...MAP_PALETTE }).toEqual(before);
    document.documentElement.className = '';
  });

  it('uses deep gold for arterial lines and lighter gold for major label text', () => {
    // Split by WCAG role: lines need 3:1, text needs 4.5:1 on navy.
    expect(MAP_PALETTE.arterial).toBe('#b8912f');
    expect(MAP_PALETTE.labelMajor).toBe('#d9bd72');
  });

  it('uses silver for secondary roads and minor labels', () => {
    expect(MAP_PALETTE.road).toBe('#c3ccd6');
    expect(MAP_PALETTE.labelMinor).toBe('#a0adbd');
  });

  it('uses navy for land and a darker navy for water', () => {
    expect(MAP_PALETTE.land).toBe('#22405f');
    expect(MAP_PALETTE.water).toBe('#142840');
  });
});

describe('layer matchers', () => {
  it('treats motorway, trunk and primary as arterials', () => {
    for (const id of ['road-motorway', 'bridge-trunk', 'road-primary-case']) {
      expect(isArterialLayer(id)).toBe(true);
    }
  });

  it('does not treat secondary or residential as arterials', () => {
    for (const id of ['road-secondary', 'road-residential', 'road-tertiary']) {
      expect(isArterialLayer(id)).toBe(false);
    }
  });

  it('treats city, town and major settlement labels as major', () => {
    for (const id of ['place-city-lg', 'place-town', 'settlement-major-label']) {
      expect(isMajorLabelLayer(id)).toBe(true);
    }
  });

  it('does not treat neighbourhood labels as major', () => {
    expect(isMajorLabelLayer('place-neighbourhood')).toBe(false);
  });
});
