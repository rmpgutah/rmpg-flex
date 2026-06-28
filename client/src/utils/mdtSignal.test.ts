import { describe, it, expect } from 'vitest';
import { describeSignal, routeForSignal, severityForSignal, type MDTMsg } from './mdtSignal';

const msg = (type: string, payload: Record<string, any> = {}): MDTMsg => ({
  id: 1, type, payload, created_at: '2026-06-13T00:00:00Z',
});

describe('mdtSignal', () => {
  it('describes the existing phone signals (regression)', () => {
    expect(describeSignal(msg('person', { name: 'Doe', dob: '1990' }))).toContain('Doe');
    expect(describeSignal(msg('plate', { plate: '7ABC123' }))).toContain('7ABC123');
    expect(describeSignal(msg('scan'))).toContain('DL Search');
  });

  it('describes the new signals', () => {
    expect(describeSignal(msg('alpr_hit', { plate: '7ABC123', detail: 'STOLEN' }))).toContain('ALPR HIT');
    expect(describeSignal(msg('alpr_hit', { plate: '7ABC123', detail: 'STOLEN' }))).toContain('STOLEN');
    expect(describeSignal(msg('vehicle_oos', { defects: 'Brakes' }))).toContain('OUT OF SERVICE');
    expect(describeSignal(msg('vehicle_oos', { defects: 'Brakes', phase: 'post_trip' }))).toContain('post-trip');
    expect(describeSignal(msg('shift_summary', { calls: 5, miles: 120 }))).toContain('5 calls');
    expect(describeSignal(msg('cfs_action', { label: 'Request K9' }))).toContain('Request K9');
    expect(describeSignal(msg('evidence', { classification: 'EVIDENCE' }))).toContain('Evidence logged');
  });

  it('falls back for unknown types', () => {
    expect(describeSignal(msg('mystery'))).toContain('mystery');
  });

  it('routes urgent/actionable signals, leaves informational ones', () => {
    expect(routeForSignal('alpr_hit')).toBe('/ncic');
    expect(routeForSignal('vehicle_oos')).toBe('/fleet');
    expect(routeForSignal('person')).toBe('/dl-search'); // regression
    expect(routeForSignal('plate')).toBe('/ncic');
    expect(routeForSignal('shift_summary')).toBeNull();
    expect(routeForSignal('cfs_action')).toBeNull();
    expect(routeForSignal('evidence')).toBeNull();
  });

  it('escalates severity for hits / OOS', () => {
    expect(severityForSignal('alpr_hit')).toBe('error');
    expect(severityForSignal('vehicle_oos')).toBe('error');
    expect(severityForSignal('person')).toBe('info');
    expect(severityForSignal('shift_summary')).toBe('info');
  });
});
