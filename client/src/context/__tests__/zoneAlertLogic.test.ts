import { describe, it, expect } from 'vitest';
import { zoneEntryAlert } from '../zoneAlertLogic';

describe('zoneEntryAlert', () => {
  it('alerts on entering an alert zone', () => {
    expect(zoneEntryAlert({ unitId: 1, zoneId: 5, zoneType: 'alert', eventType: 'enter' })).toEqual({ show: true, zoneType: 'alert' });
  });
  it('alerts on entering a patrol_required zone', () => {
    expect(zoneEntryAlert({ unitId: 1, zoneId: 5, zoneType: 'patrol_required', eventType: 'enter' })?.show).toBe(true);
  });
  it('ignores station zones (handled separately by stationPauseAction)', () => {
    expect(zoneEntryAlert({ unitId: 1, zoneId: 5, zoneType: 'station', eventType: 'enter' })).toBe(null);
  });
  it('ignores exclusion zones (routing-only, not an alert)', () => {
    expect(zoneEntryAlert({ unitId: 1, zoneId: 5, zoneType: 'exclusion', eventType: 'enter' })).toBe(null);
  });
  it('ignores exit events', () => {
    expect(zoneEntryAlert({ unitId: 1, zoneId: 5, zoneType: 'alert', eventType: 'exit' })).toBe(null);
  });
});
