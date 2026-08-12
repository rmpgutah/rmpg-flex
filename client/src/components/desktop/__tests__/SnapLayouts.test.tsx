import { describe, it, expect } from 'vitest';
import { computeSnapZones } from '../SnapLayouts';

describe('computeSnapZones', () => {
  it('returns 4 zones on a 1200px wide viewport', () => {
    const zones = computeSnapZones(1200, 800, 48);
    expect(zones).toHaveLength(4);
    const ids = zones.map(z => z.id);
    expect(ids).toContain('left-half');
    expect(ids).toContain('right-half');
    expect(ids).toContain('top-left-quarter');
    expect(ids).toContain('top-right-quarter');
  });

  it('returns 6 zones on a 1400px wide viewport', () => {
    const zones = computeSnapZones(1400, 800, 48);
    expect(zones).toHaveLength(6);
    const ids = zones.map(z => z.id);
    expect(ids).toContain('left-third');
    expect(ids).toContain('center-third');
    expect(ids).toContain('right-third');
    expect(ids).toContain('top-left');
    expect(ids).toContain('top-right');
    expect(ids).toContain('right-two-thirds');
  });

  it('zone bounds do not overlap taskbar', () => {
    const zones = computeSnapZones(1400, 900, 56);
    for (const z of zones) {
      expect(z.y + z.height).toBeLessThanOrEqual(900 - 56);
    }
  });

  it('zones exactly tile the desktop area', () => {
    const dH = 800 - 48;
    const zones = computeSnapZones(1200, 800, 48);
    const leftHalf = zones.find(z => z.id === 'left-half')!;
    expect(leftHalf).toMatchObject({ x: 0, y: 0, width: 600, height: dH });
    const rightHalf = zones.find(z => z.id === 'right-half')!;
    expect(rightHalf).toMatchObject({ x: 600, y: 0, width: 600, height: dH });
  });
});
