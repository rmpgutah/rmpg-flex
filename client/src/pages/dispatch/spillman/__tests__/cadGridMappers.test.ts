import { describe, it, expect } from 'vitest';
import {
  spillmanPriorityNumber, partitionCalls, cadUnitStatusLabel,
  cadUnitColor, timeHHMM, callToRow, unitToRow,
} from '../cadGridMappers';

describe('spillmanPriorityNumber', () => {
  it('maps P1..P4 straight to 1..4', () => {
    expect(spillmanPriorityNumber('P1')).toBe(1);
    expect(spillmanPriorityNumber('P4')).toBe(4);
  });
  it('is defensive about junk', () => {
    expect(spillmanPriorityNumber(undefined as any)).toBe(3);
    expect(spillmanPriorityNumber('nope' as any)).toBe(3);
  });
});

describe('partitionCalls', () => {
  const mk = (id: string, status: string) => ({ id, status } as any);
  it('splits working calls into undispatched vs dispatched and drops closed ones', () => {
    const calls = [
      mk('a', 'pending'), mk('b', 'on_hold'),
      mk('c', 'dispatched'), mk('d', 'enroute'), mk('e', 'onscene'),
      mk('f', 'cleared'), mk('g', 'closed'), mk('h', 'cancelled'), mk('i', 'archived'),
    ];
    const { undispatched, dispatched } = partitionCalls(calls);
    expect(undispatched.map((c) => c.id)).toEqual(['a', 'b']);
    expect(dispatched.map((c) => c.id)).toEqual(['c', 'd', 'e']);
  });
});

describe('cadUnitStatusLabel', () => {
  it('renders Spillman-style short codes', () => {
    expect(cadUnitStatusLabel('available')).toBe('AVL');
    expect(cadUnitStatusLabel('enroute')).toBe('ENR');
    expect(cadUnitStatusLabel('onscene')).toBe('ONS');
    expect(cadUnitStatusLabel('out_of_service')).toBe('OOS');
    expect(cadUnitStatusLabel(undefined)).toBe('—');
  });
});

describe('cadUnitColor', () => {
  it('routes through the fixed Spillman status palette', () => {
    expect(cadUnitColor('available')).toBe('var(--spm-stat-avail)');
    expect(cadUnitColor('enroute')).toBe('var(--spm-stat-enrt)');
    expect(cadUnitColor('onscene')).toBe('var(--spm-stat-busy)');
    expect(cadUnitColor('off_duty')).toBe('inherit');
  });
});

describe('timeHHMM', () => {
  it('formats an ISO timestamp as HH:MM and tolerates junk', () => {
    expect(timeHHMM('2026-07-02T09:05:00Z')).toMatch(/^\d{2}:\d{2}$/);
    expect(timeHHMM(undefined)).toBe('');
    expect(timeHHMM('not-a-date')).toBe('');
  });
});

describe('row projections', () => {
  it('callToRow projects the grid fields and keeps the call', () => {
    const call = {
      id: 'c1', call_number: '2026-000451', incident_type: 'alarm_call',
      priority: 'P2', status: 'on_hold', location: '100 S MAIN ST',
      assigned_units: ['P12', 'S3'], beat_name: 'B4',
      created_at: '2026-07-02T09:00:00Z',
    } as any;
    const row = callToRow(call);
    expect(row.id).toBe('c1');
    expect(row.call).toBe(call);
    expect(row.pri).toBe(2);
    expect(row.type).toBe('ALARM CALL');
    expect(row.units).toBe('P12 S3');
    expect(row.status).toBe('ON HOLD');
    expect(row.zone).toBe('B4');
  });

  it('unitToRow resolves the call number through the lookup', () => {
    const unit = {
      id: 'u1', call_sign: 'P12', officer_name: 'ZAMORA',
      status: 'dispatched', current_call_id: 'c9',
      last_status_change: '2026-07-02T09:11:00Z', assigned_beat: 'B2',
    } as any;
    const row = unitToRow(unit, (id) => (id === 'c9' ? '2026-000460' : ''));
    expect(row.call_sign).toBe('P12');
    expect(row.status).toBe('DSP');
    expect(row.call_number).toBe('2026-000460');
    expect(row.beat).toBe('B2');
  });
});
