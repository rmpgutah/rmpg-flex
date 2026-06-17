// ============================================================
// RMPG Flex — Serve attempt schedule persistence + cron sweep
// ============================================================
// Persists the dated attempt windows produced by serveDiligencePlanner
// into serve_attempt_schedules so the dashboard calendar can query them
// and the per-minute cron can fire pre-event dispatch notifications.
//
// notify_at is stored as "YYYY-MM-DDTHH:MM" in America/Denver local time.
// D1 lexicographic comparison on that format is always correct because
// YYYY-MM-DDTHH:MM sorts identically to epoch ordering within a timezone.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../types';
import { execute, query, queryFirst } from './db';
import { emitAlert } from './alertHub';
import type { AttemptWindow } from './serveDiligencePlanner';

// ── Timezone helpers ─────────────────────────────────────────

const TZ = 'America/Denver';

// Convert America/Denver local "YYYY-MM-DD HH:MM" to UTC epoch ms.
// Tries MDT (UTC-7) then MST (UTC-6) and verifies via Intl round-trip
// so DST transitions are handled without hardcoding switch dates.
function localDenverToEpoch(date: string, hhmm: string): number {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  for (const off of ['-07:00', '-06:00']) {
    const d = new Date(`${date}T${hhmm}:00${off}`);
    if (fmt.format(d) === `${date} ${hhmm}`) return d.getTime();
  }
  return new Date(`${date}T${hhmm}:00-07:00`).getTime();
}

// Returns "YYYY-MM-DDTHH:MM" in America/Denver (lexicographically sortable).
export function epochToLocalDenverStr(epochMs: number): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs)).replace(' ', 'T');
}

// Current Denver local time as "YYYY-MM-DDTHH:MM".
export function denverNow(): string {
  return epochToLocalDenverStr(Date.now());
}

// ── Schedule persistence ─────────────────────────────────────

export async function persistAttemptSchedule(
  db: D1Database,
  queueId: number,
  plan: AttemptWindow[],
  nowIso: string,
): Promise<void> {
  const nowDenver = epochToLocalDenverStr(Date.parse(nowIso));

  // Clear any old slots for this queue entry (re-upload / re-generation).
  await execute(db, 'DELETE FROM serve_attempt_schedules WHERE queue_id = ?', queueId);

  for (const w of plan) {
    const [rawStart, rawEnd] = w.window.split('–').map((s) => s.trim());
    const windowStart = rawStart;
    const windowEnd = rawEnd || rawStart;

    const windowStartEpoch = localDenverToEpoch(w.date, windowStart);

    // Random offset: 30 min (1800 s) to 6 h (21600 s)
    const notifyBeforeSecs = Math.floor(Math.random() * (21600 - 1800 + 1)) + 1800;
    const notifyAtEpoch = windowStartEpoch - notifyBeforeSecs * 1000;
    const notifyAt = epochToLocalDenverStr(notifyAtEpoch);

    // If the notification time is already past, still persist the slot
    // (for calendar display) but mark notified=1 so the cron skips it.
    const alreadyPast = notifyAt <= nowDenver ? 1 : 0;

    await execute(
      db,
      `INSERT INTO serve_attempt_schedules
         (queue_id, attempt_number, scheduled_date, window_start, window_end,
          window_label, notify_at, notify_before_secs, notified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      queueId, w.attempt, w.date,
      windowStart, windowEnd,
      w.focus, notifyAt, notifyBeforeSecs, alreadyPast,
    );
  }
}

// ── Cron sweep ───────────────────────────────────────────────

interface ScheduleSweepRow {
  id: number;
  queue_id: number;
  attempt_number: number;
  scheduled_date: string;
  window_start: string;
  window_end: string;
  window_label: string;
  notify_before_secs: number;
  recipient_name: string | null;
  recipient_address: string | null;
  case_number: string | null;
  priority: string;
  deadline: string | null;
}

// Called from the per-minute cron handler. Emits serve_attempt_reminder
// alerts for any window whose random pre-event time has arrived.
export async function sweepAttemptNotifications(
  db: D1Database,
  env: Bindings,
): Promise<number> {
  // Guard: table may not exist on live yet (migration pending).
  const tableExists = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='serve_attempt_schedules'`,
  );
  if (!tableExists?.n) return 0;

  const now = denverNow();
  const due = await query<ScheduleSweepRow>(
    db,
    `SELECT s.id, s.queue_id, s.attempt_number, s.scheduled_date,
            s.window_start, s.window_end, s.window_label, s.notify_before_secs,
            q.recipient_name, q.recipient_address, q.case_number, q.priority, q.deadline
     FROM serve_attempt_schedules s
     JOIN serve_queue q ON q.id = s.queue_id
     WHERE s.notify_at <= ? AND s.notified = 0 AND s.dismissed = 0
       AND q.status NOT IN ('served','cancelled','failed')
     ORDER BY s.notify_at
     LIMIT 20`,
    now,
  );
  if (!due.length) return 0;

  for (const row of due) {
    const mins = Math.round(row.notify_before_secs / 60);
    const timeUntil = mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
    const name = row.recipient_name || 'recipient';
    const addr = row.recipient_address || '(address on file)';

    await emitAlert(env, 'serve_attempt_reminder', {
      action: 'serve_attempt_reminder',
      queueId: row.queue_id,
      attemptNumber: row.attempt_number,
      scheduledDate: row.scheduled_date,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      windowLabel: row.window_label,
      minutesBefore: mins,
      recipientName: name,
      recipientAddress: addr,
      caseNumber: row.case_number ?? null,
      priority: row.priority,
      deadline: row.deadline ?? null,
      message: `Attempt #${row.attempt_number} for ${name} @ ${addr} — window ${row.window_start}–${row.window_end} opens in ~${timeUntil}`,
    });

    await execute(
      db,
      'UPDATE serve_attempt_schedules SET notified = 1 WHERE id = ?',
      row.id,
    );
  }

  return due.length;
}
