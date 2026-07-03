import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiFetchMock = vi.fn();
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import { rescheduleAgendaItem } from './agendaMutations';

beforeEach(() => { apiFetchMock.mockReset(); apiFetchMock.mockResolvedValue({}); });

describe('rescheduleAgendaItem', () => {
  it('serve: PATCHes /serve-intake/schedule/:id with scheduled_date and officer_id', async () => {
    await rescheduleAgendaItem({ source: 'serve', originalId: 42, date: '2026-07-11', officerId: 9 });
    expect(apiFetchMock).toHaveBeenCalledWith('/serve-intake/schedule/42', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduled_date: '2026-07-11', officer_id: 9 }),
    });
  });

  it('serve: translates a 409 overlap into an actionable message', async () => {
    apiFetchMock.mockRejectedValueOnce(
      Object.assign(new Error('overlap'), { status: 409, payload: { error: 'overlap', conflicts: [] } }),
    );
    await expect(
      rescheduleAgendaItem({ source: 'serve', originalId: 42, date: '2026-07-11', officerId: 9 }),
    ).rejects.toThrow('That time conflicts with another scheduled attempt for this officer — pick a different slot or officer.');
  });

  it('shift: PUTs /shift-plans/:id with date only', async () => {
    await rescheduleAgendaItem({ source: 'shift', originalId: 5, date: '2026-07-12', officerId: null });
    expect(apiFetchMock).toHaveBeenCalledWith('/shift-plans/5', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-07-12' }),
    });
  });

  it('custom: PATCHes /scheduler/events/:id with event_date and officer_id', async () => {
    await rescheduleAgendaItem({ source: 'custom', originalId: 11, date: '2026-07-13', officerId: 3 });
    expect(apiFetchMock).toHaveBeenCalledWith('/scheduler/events/11', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_date: '2026-07-13', officer_id: 3 }),
    });
  });

  it('court: throws without calling apiFetch', async () => {
    await expect(
      rescheduleAgendaItem({ source: 'court', originalId: 1, date: '2026-07-14', officerId: null }),
    ).rejects.toThrow('Court dates are set by the court — not editable here.');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
