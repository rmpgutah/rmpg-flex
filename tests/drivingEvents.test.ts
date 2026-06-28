import { describe, it, expect } from 'vitest';
import { classifyDrivingEvent, fleetStatusFor } from '../src/utils/drivingEvents';

describe('drivingEvents.classifyDrivingEvent', () => {
  it('maps the real ClearPath labels we receive', () => {
    expect(classifyDrivingEvent('Automatic, Frontal Collision Warning')).toEqual({ type: 'fcw', severity: 'alert' });
    expect(classifyDrivingEvent('Automatic, Lane Departure')).toEqual({ type: 'ldw', severity: 'warning' });
    expect(classifyDrivingEvent('Automatic, Close Following')).toEqual({ type: 'tailgate', severity: 'warning' });
  });
  it('escalates impacts/SOS to critical', () => {
    expect(classifyDrivingEvent('Impact detected').severity).toBe('critical');
    expect(classifyDrivingEvent('SOS button').type).toBe('sos');
  });
  it('classifies driver-behavior + motion events', () => {
    expect(classifyDrivingEvent('Hard Brake')).toEqual({ type: 'hard_brake', severity: 'warning' });
    expect(classifyDrivingEvent('Distracted Driving')).toEqual({ type: 'distracted', severity: 'alert' });
    expect(classifyDrivingEvent('Drowsy / fatigue')).toEqual({ type: 'drowsy', severity: 'alert' });
    expect(classifyDrivingEvent('Overspeed 75mph')).toEqual({ type: 'speeding', severity: 'warning' });
    expect(classifyDrivingEvent('Ignition On')).toEqual({ type: 'ignition_on', severity: 'info' });
  });
  it('falls back to custom/info for unknown labels', () => {
    expect(classifyDrivingEvent('Wibble')).toEqual({ type: 'custom', severity: 'info' });
    expect(classifyDrivingEvent(null)).toEqual({ type: 'custom', severity: 'info' });
    expect(classifyDrivingEvent('')).toEqual({ type: 'custom', severity: 'info' });
  });
});

describe('drivingEvents.fleetStatusFor', () => {
  const now = 1_000_000_000_000;
  it('healthy within the stale window', () => {
    expect(fleetStatusFor(now - 60_000, now)).toBe('healthy');
  });
  it('stale between stale and down windows', () => {
    expect(fleetStatusFor(now - 20 * 60_000, now)).toBe('stale');
  });
  it('down past the down window or when never seen', () => {
    expect(fleetStatusFor(now - 2 * 60 * 60_000, now)).toBe('down');
    expect(fleetStatusFor(null, now)).toBe('down');
  });
});
