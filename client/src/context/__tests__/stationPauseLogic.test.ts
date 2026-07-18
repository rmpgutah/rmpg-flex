import { describe, it, expect } from 'vitest';
import { stationPauseAction, type GeofenceAlertPayload } from '../stationPauseLogic';

function payload(overrides: Partial<GeofenceAlertPayload>): GeofenceAlertPayload {
  return {
    unitId: 1,
    zoneId: 10,
    zoneType: 'station',
    eventType: 'enter',
    ...overrides,
  };
}

describe('stationPauseAction', () => {
  it('pauses on station zone enter', () => {
    expect(stationPauseAction(payload({ zoneType: 'station', eventType: 'enter' }))).toBe('pause');
  });

  it('resumes on station zone exit', () => {
    expect(stationPauseAction(payload({ zoneType: 'station', eventType: 'exit' }))).toBe('resume');
  });

  it('returns null for non-station zone types', () => {
    expect(stationPauseAction(payload({ zoneType: 'patrol_required', eventType: 'enter' }))).toBeNull();
    expect(stationPauseAction(payload({ zoneType: 'exclusion', eventType: 'exit' }))).toBeNull();
  });

  it('returns null for transfer events', () => {
    expect(stationPauseAction(payload({ zoneType: 'station', eventType: 'transfer' }))).toBeNull();
  });
});
