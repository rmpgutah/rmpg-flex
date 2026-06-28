import { describe, it, expect } from 'vitest';
import { computeSlaStatus, slaBadge } from './caseSla';

const NOW = new Date('2026-06-13T12:00:00');

describe('computeSlaStatus', () => {
  it('returns none for closed/canceled cases regardless of dates', () => {
    expect(computeSlaStatus({ due_date: '2026-01-01', status: 'closed', now: NOW }).state).toBe('none');
    expect(computeSlaStatus({ due_date: '2026-01-01', status: 'closed_cleared', now: NOW }).state).toBe('none');
    expect(computeSlaStatus({ due_date: '2026-01-01', status: 'canceled', now: NOW }).state).toBe('none');
  });

  it('returns none when there is no deadline basis', () => {
    expect(computeSlaStatus({ status: 'open', now: NOW }).state).toBe('none');
    expect(computeSlaStatus({ opened_date: '2026-06-01', sla_hours: 0, status: 'open', now: NOW }).state).toBe('none');
  });

  it('flags a past due_date as overdue with negative hoursRemaining', () => {
    const r = computeSlaStatus({ due_date: '2026-06-10', status: 'open', now: NOW });
    expect(r.state).toBe('overdue');
    expect(r.hoursRemaining! < 0).toBe(true);
  });

  it('marks a far-future due_date on_track', () => {
    expect(computeSlaStatus({ opened_date: '2026-06-12', due_date: '2026-09-01', status: 'open', now: NOW }).state).toBe('on_track');
  });

  it('marks a near due_date as due_soon (within 24h floor)', () => {
    // due end-of-day 2026-06-13 → ~12h out, under the 24h floor
    expect(computeSlaStatus({ opened_date: '2026-06-13', due_date: '2026-06-13', status: 'open', now: NOW }).state).toBe('due_soon');
  });

  it('uses opened_date + sla_hours when no due_date is set', () => {
    // opened 2026-06-13T00:00, +48h → due 2026-06-15T00:00, ~36h out
    const r = computeSlaStatus({ opened_date: '2026-06-13', sla_hours: 48, status: 'open', now: NOW });
    expect(r.state).toBe('on_track');
    expect(Math.round(r.hoursRemaining!)).toBe(36);
  });

  it('overdues an elapsed sla_hours window', () => {
    expect(computeSlaStatus({ opened_date: '2026-06-10', sla_hours: 24, status: 'open', now: NOW }).state).toBe('overdue');
  });

  it('scales due_soon to 25% of a long window', () => {
    // opened 2026-05-14, due 2026-06-18 → ~35d window; 25% ≈ 9d. now is ~5.5d
    // before due → inside the due-soon window.
    expect(computeSlaStatus({ opened_date: '2026-05-14', due_date: '2026-06-18', status: 'open', now: NOW }).state).toBe('due_soon');
  });

  it('ignores malformed dates (returns none)', () => {
    expect(computeSlaStatus({ due_date: 'garbage', status: 'open', now: NOW }).state).toBe('none');
  });
});

describe('slaBadge', () => {
  it('maps states to label + color', () => {
    expect(slaBadge('overdue')).toEqual({ label: 'OVERDUE', color: '#ef4444' });
    expect(slaBadge('due_soon')?.label).toBe('DUE SOON');
    expect(slaBadge('on_track')?.color).toBe('#22c55e');
    expect(slaBadge('none')).toBeNull();
  });
});
