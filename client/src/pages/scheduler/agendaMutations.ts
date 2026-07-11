// One call-site for "move this agenda item" regardless of which module owns
// the underlying row. Each branch wraps an endpoint that already existed
// before this feature — see docs/superpowers/plans/2026-07-02-unified-schedule-calendar.md
// for why no new backend endpoint was added.
import { apiFetch } from '../../hooks/useApi';
import { describeServeScheduleError } from '../../utils/serveScheduleErrors';
import type { AgendaSource } from './agendaToCalendarEvents';

export interface RescheduleArgs {
  source: AgendaSource;
  originalId: number | string;
  date: string;      // YYYY-MM-DD, the new date the item was dropped on
  officerId: number | null; // new officer if the item was dropped in a different officer column; null if unchanged/no such column
}

export async function rescheduleAgendaItem({ source, originalId, date, officerId }: RescheduleArgs): Promise<void> {
  switch (source) {
    case 'serve':
      try {
        await apiFetch(`/serve-intake/schedule/${originalId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduled_date: date, officer_id: officerId }),
        });
      } catch (err) {
        throw describeServeScheduleError(err);
      }
      return;
    case 'shift':
      await apiFetch(`/shift-plans/${originalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      return;
    case 'custom':
      await apiFetch(`/scheduler/events/${originalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_date: date, officer_id: officerId }),
      });
      return;
    case 'court':
      throw new Error('Court dates are set by the court — not editable here.');
  }
}
