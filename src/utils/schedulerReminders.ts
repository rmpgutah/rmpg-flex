// ============================================================
// Scheduler reminder sweep — fires alert-hub reminders for
// scheduler_events whose notify_at has arrived. Runs from the
// every-minute cron in src/index.ts, mirroring the pattern in
// serveAttemptScheduler.sweepAttemptNotifications.
// ============================================================
import { query, execute } from './db';
import { log } from './logger';
import type { Bindings } from '../types';

function denverNowLocal(): string {
  // "YYYY-MM-DDTHH:MM" in America/Denver — same format notify_at is stored in.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export async function sweepSchedulerReminders(db: D1Database, env: Bindings): Promise<number> {
  const now = denverNowLocal();
  const due = await query<{
    id: number; title: string; event_date: string; start_time: string | null;
    officer_id: number | null; call_id: number | null; serve_queue_id: number | null;
    location: string | null; category: string | null;
  }>(db, `SELECT id, title, event_date, start_time, officer_id, call_id, serve_queue_id, location, category
          FROM scheduler_events
          WHERE notify_at IS NOT NULL AND notified = 0 AND status = 'scheduled' AND notify_at <= ?
          LIMIT 25`, now);
  if (!due.length) return 0;

  let fired = 0;
  for (const ev of due) {
    try {
      const { emitAlert } = await import('./alertHub');
      await emitAlert(env, 'scheduler_reminder', {
        action: 'scheduler_reminder',
        eventId: ev.id,
        title: ev.title,
        eventDate: ev.event_date,
        startTime: ev.start_time,
        location: ev.location,
        category: ev.category,
        officerId: ev.officer_id,
        callId: ev.call_id,
        serveQueueId: ev.serve_queue_id,
        message: `Scheduled: ${ev.title} — ${ev.event_date}${ev.start_time ? ` ${ev.start_time}` : ''}${ev.location ? ` @ ${ev.location}` : ''}`,
      });
      fired++;
    } catch (err) {
      log.warn('[scheduler] reminder emit failed', { id: ev.id });
    }
    // Mark notified even on emit failure — a broken alert hub must not
    // re-fire the same reminder every minute forever.
    await execute(db, 'UPDATE scheduler_events SET notified = 1 WHERE id = ?', ev.id);
  }
  if (fired) log.info('[scheduler] reminders fired', { fired });
  return fired;
}
