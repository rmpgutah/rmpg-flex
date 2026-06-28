import { describe, it, expect } from 'vitest';
import { buildMovementReport, classifyDrivingEvent, type FixPoint } from '../vehicleTelemetry';

const BASE = Date.parse('2026-06-03T12:00:00Z');
const iso = (sec: number) => new Date(BASE + sec * 1000).toISOString();

/** Build a track moving due-east at a fixed ground speed, with no device speed
 *  (forces the position-derived path). ~84,360 m per degree lng at lat 40.75. */
function eastward(mps: number, seconds: number, withDeviceSpeed = false): FixPoint[] {
  const lat = 40.75;
  const mPerDeg = 84360;
  const out: FixPoint[] = [];
  for (let i = 0; i <= seconds; i++) {
    out.push({
      lat,
      lng: -111.89 + (mps * i) / mPerDeg,
      speed: withDeviceSpeed ? mps : null,
      heading: 90,
      accuracy: 20,
      timestamp: iso(i),
    });
  }
  return out;
}

describe('classifyDrivingEvent', () => {
  it('returns null below the speed gate', () => {
    expect(classifyDrivingEvent(-0.9, 0, 3)).toBeNull();
  });
  it('flags harsh braking by severity band', () => {
    expect(classifyDrivingEvent(-0.4, 0, 40)).toMatchObject({ kind: 'brake', severity: 1 });
    expect(classifyDrivingEvent(-0.5, 0, 40)).toMatchObject({ kind: 'brake', severity: 2 });
    expect(classifyDrivingEvent(-0.7, 0, 40)).toMatchObject({ kind: 'brake', severity: 3 });
  });
  it('flags harsh acceleration', () => {
    expect(classifyDrivingEvent(0.32, 0, 25)).toMatchObject({ kind: 'accel', severity: 1 });
  });
  it('flags hard cornering regardless of turn direction', () => {
    expect(classifyDrivingEvent(0, 0.5, 35)).toMatchObject({ kind: 'corner', severity: 2 });
    expect(classifyDrivingEvent(0, -0.5, 35)).toMatchObject({ kind: 'corner', severity: 2 });
  });
  it('reports the most severe of competing forces', () => {
    // mild accel + severe corner → corner wins
    expect(classifyDrivingEvent(0.31, 0.65, 40)).toMatchObject({ kind: 'corner', severity: 3 });
  });
  it('ignores unremarkable motion', () => {
    expect(classifyDrivingEvent(0.1, 0.1, 30)).toBeNull();
  });
});

describe('buildMovementReport', () => {
  it('returns an empty report for too-short tracks', () => {
    const r = buildMovementReport([]);
    expect(r.speedSource).toBe('none');
    expect(r.totalMi).toBe(0);
    expect(r.series).toHaveLength(0);
  });

  it('derives speed from position when the device reports none', () => {
    const r = buildMovementReport(eastward(20, 6)); // ~20 m/s ≈ 44.7 mph
    expect(r.speedSource).toBe('derived');
    expect(r.maxMph).toBeGreaterThanOrEqual(43);
    expect(r.maxMph).toBeLessThanOrEqual(46);
    expect(r.totalMi).toBeGreaterThan(0);
    expect(r.movingMs).toBeGreaterThan(0);
  });

  it('uses device speed when present', () => {
    const r = buildMovementReport(eastward(20, 6, true));
    expect(r.speedSource).toBe('device');
    expect(r.maxMph).toBeGreaterThanOrEqual(43);
  });

  it('counts a stop when the vehicle decelerates to rest', () => {
    const moving = eastward(18, 5); // 6 points moving
    const lastLng = moving[moving.length - 1].lng;
    // append 3 stationary fixes at the final position
    for (let i = 1; i <= 3; i++) {
      moving.push({ lat: 40.75, lng: lastLng, speed: null, heading: 90, accuracy: 20, timestamp: iso(5 + i) });
    }
    const r = buildMovementReport(moving);
    expect(r.stops).toBeGreaterThanOrEqual(1);
    expect(r.idleMs).toBeGreaterThan(0);
  });

  it('records a hard-braking event on a sharp deceleration', () => {
    // fast then abruptly slow: device speeds 25 m/s → 2 m/s in 1s ≈ −0.96 g
    const track: FixPoint[] = [
      { lat: 40.75, lng: -111.89, speed: 25, heading: 90, accuracy: 15, timestamp: iso(0) },
      { lat: 40.75, lng: -111.8895, speed: 25, heading: 90, accuracy: 15, timestamp: iso(1) },
      { lat: 40.75, lng: -111.8894, speed: 2, heading: 90, accuracy: 15, timestamp: iso(2) },
    ];
    const r = buildMovementReport(track);
    expect(r.maxBrakeG).toBeGreaterThan(0.35);
    expect(r.events.some((e) => e.kind === 'brake')).toBe(true);
  });
});
