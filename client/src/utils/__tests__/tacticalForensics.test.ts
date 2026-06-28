import { describe, it, expect } from 'vitest';
import {
  instAccelG, activeThreats, severityColor, zoomTransform, evidenceStampLines, evidenceFilename,
} from '../tacticalForensics';
import type { GpsPoint } from '../dashcamForensics';

const pt = (speed: number, tSec: number): GpsPoint =>
  ({ latitude: 40.7, longitude: -111.88, speed, altitude: 1300, timestamp: 1_000_000_000_000 + tSec * 1000 });

describe('tacticalForensics — g-force', () => {
  it('is negative under braking, positive under acceleration', () => {
    const braking = [pt(40, 0), pt(40, 0.5), pt(20, 1), pt(10, 1.5), pt(5, 2)];
    expect(instAccelG(braking, 1)).toBeLessThan(0);
    const accel = [pt(5, 0), pt(15, 0.5), pt(30, 1), pt(45, 1.5)];
    expect(instAccelG(accel, 1)).toBeGreaterThan(0);
    expect(instAccelG([pt(10, 0)], 0)).toBe(0);
  });
});

describe('tacticalForensics — threats', () => {
  it('flags hard braking + speeding over posted limit', () => {
    const t = activeThreats({ speed: 50, turnRate: 2, accelG: -0.7, postedLimit: 30 });
    expect(t.map((x) => x.key).sort()).toEqual(['brake', 'speed']);
    expect(t.find((x) => x.key === 'brake')!.severity).toBe('critical');
    expect(t.find((x) => x.key === 'speed')!.severity).toBe('critical');
  });
  it('flags sharp turns with direction', () => {
    expect(activeThreats({ speed: 20, turnRate: 30, accelG: 0 })[0].label).toContain('R');
    expect(activeThreats({ speed: 20, turnRate: -30, accelG: 0 })[0].label).toContain('L');
  });
  it('uses absolute thresholds when no posted limit', () => {
    expect(activeThreats({ speed: 85, turnRate: 0, accelG: 0 })[0].severity).toBe('critical');
    expect(activeThreats({ speed: 30, turnRate: 0, accelG: 0 })).toEqual([]);
  });
  it('flags rapid acceleration', () => {
    expect(activeThreats({ speed: 30, turnRate: 0, accelG: 0.6 }).map((x) => x.key)).toContain('accel');
  });
  it('severityColor maps tiers', () => {
    expect(severityColor('critical')).toBe('#ef4444');
    expect(severityColor('warning')).toBe('#d4a017');
  });
});

describe('tacticalForensics — zoom', () => {
  it('centres on the box and scales it up, capped', () => {
    const z = zoomTransform([600, 360, 120, 90], 1280, 720, 0.6, 4);
    expect(z.scale).toBeGreaterThan(1.2);
    expect(z.scale).toBeLessThanOrEqual(4);
    expect(z.originXPct).toBeCloseTo((660 / 1280) * 100, 0);
    expect(z.originYPct).toBeCloseTo((405 / 720) * 100, 0);
  });
  it('a near-full-frame box barely zooms', () => {
    expect(zoomTransform([0, 0, 1280, 720], 1280, 720).scale).toBeCloseTo(1.2);
  });
});

describe('tacticalForensics — evidence stamp', () => {
  it('composes chain-of-custody lines from available metadata', () => {
    const lines = evidenceStampLines({
      eventType: 'Lane_Departure', device: 'cp160817', address: '7324 S 525 E, Midvale, UT',
      timestamp: '2026-06-12 11:00:17', lat: 40.61961, lng: -111.87664, speed: 21, plate: '6KJ4L5',
      officer: 'C. Zamora', playbackTime: 3.2,
    });
    expect(lines[0]).toContain('FORENSIC EVIDENCE');
    expect(lines.some((l) => l.includes('Lane Departure'))).toBe(true);
    expect(lines.some((l) => l.includes('6KJ4L5'))).toBe(true);
    expect(lines.some((l) => l.includes('40.61961'))).toBe(true);
  });
  it('skips missing fields gracefully', () => {
    const lines = evidenceStampLines({});
    expect(lines).toHaveLength(1); // just the header
  });
  it('builds a safe filename', () => {
    const f = evidenceFilename({ device: 'cp160817', timestamp: '2026-06-12 11:00:17', plate: '6KJ-4L5' });
    expect(f).toMatch(/^rmpg-evidence_cp160817_\d+_6KJ4L5\.jpg$/);
  });
});
