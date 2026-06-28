import { describe, it, expect } from 'vitest';
import {
  dispositionCounts,
  filterClearedInWindow,
  startOfTodayMt,
  todayMtWindow,
} from '../clearedSummaryPdf';
import type { CallForService } from '../../types';

// Minimal Call factory — only the fields the helpers actually inspect.
// Cast through unknown because the real CallForService has ~80 fields and we
// only need ~10 for these pure-helper tests.
function call(
  id: string,
  status: string,
  clearedAtIso: string | null,
  disposition: string | null = null,
): CallForService {
  return {
    id,
    call_number: `CFS25-${id.padStart(5, '0')}`,
    incident_type: 'patrol_check',
    priority: 'P3',
    status,
    location: '123 Test St',
    description: 'test',
    source: 'phone',
    assigned_units: [],
    notes: [],
    disposition: disposition ?? undefined,
    created_at: '2026-06-21T00:30:00Z',
    cleared_at: clearedAtIso ?? undefined,
  } as unknown as CallForService;
}

describe('dispositionCounts', () => {
  it('groups by disposition + sorts descending by count', () => {
    const calls = [
      call('1', 'cleared', '2026-06-21T18:00:00Z', 'cleared'),
      call('2', 'cleared', '2026-06-21T18:01:00Z', 'cleared'),
      call('3', 'cleared', '2026-06-21T18:02:00Z', 'gone_on_arrival'),
    ];
    const counts = dispositionCounts(calls);
    expect(counts[0]).toEqual({ code: 'cleared', count: 2 });
    expect(counts[1]).toEqual({ code: 'gone_on_arrival', count: 1 });
  });
  it('renders missing dispositions as em-dash', () => {
    const counts = dispositionCounts([call('1', 'cleared', '2026-06-21T18:00:00Z')]);
    expect(counts[0].code).toBe('—');
  });
  it('returns [] for an empty list', () => {
    expect(dispositionCounts([])).toEqual([]);
  });
});

describe('filterClearedInWindow', () => {
  const win = {
    start: new Date('2026-06-21T06:00:00Z'), // ≈ 00:00 MT (MDT)
    end:   new Date('2026-06-21T20:00:00Z'),
  };
  it('keeps cleared calls inside the window', () => {
    const inside = call('1', 'cleared', '2026-06-21T14:00:00Z');
    expect(filterClearedInWindow([inside], win)).toHaveLength(1);
  });
  it('keeps closed calls (closed is treated as cleared for the summary)', () => {
    const closed = call('1', 'closed', '2026-06-21T14:00:00Z');
    expect(filterClearedInWindow([closed], win)).toHaveLength(1);
  });
  it('drops non-cleared statuses', () => {
    const active = call('1', 'active', '2026-06-21T14:00:00Z');
    expect(filterClearedInWindow([active], win)).toHaveLength(0);
  });
  it('drops cleared calls outside the window', () => {
    const before = call('1', 'cleared', '2026-06-20T14:00:00Z');
    const after = call('2', 'cleared', '2026-06-22T14:00:00Z');
    expect(filterClearedInWindow([before, after], win)).toHaveLength(0);
  });
  it('falls back to created_at when cleared_at is missing', () => {
    const r = call('1', 'cleared', null);
    r.created_at = '2026-06-21T14:00:00Z';
    expect(filterClearedInWindow([r], win)).toHaveLength(1);
  });
});

describe('startOfTodayMt / todayMtWindow', () => {
  it('returns a Date whose Mountain-Time hour reads as 00', () => {
    const start = startOfTodayMt(new Date('2026-06-21T15:00:00Z'));
    const hour = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Denver', hour: '2-digit', hour12: false,
    }).format(start);
    expect(hour).toBe('00');
  });
  it('todayMtWindow.end is on or after .start', () => {
    const w = todayMtWindow(new Date('2026-06-21T15:00:00Z'));
    expect(w.end.getTime()).toBeGreaterThanOrEqual(w.start.getTime());
  });
});
