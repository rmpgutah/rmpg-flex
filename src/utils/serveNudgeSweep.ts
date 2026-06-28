// src/utils/serveNudgeSweep.ts
import { log } from './logger';
import type { Bindings } from '../types';
import { query, queryFirst, execute } from './db';
import { classifyServeJob, shouldNotify, type AttentionSettings } from './serveAttention';

const TITLES: Record<string, string> = {
  deadline_passed: 'OVERDUE serve', deadline_approaching: 'Serve deadline soon',
  diligence_gap: 'Serve attempt overdue (diligence)', unassigned_near_deadline: 'Unassigned serve near deadline',
};
const PRIORITY: Record<string, string> = { deadline_passed: 'high', unassigned_near_deadline: 'high', deadline_approaching: 'normal', diligence_gap: 'normal' };

export async function sweepServeNudges(db: Bindings['DB'], _env: Bindings): Promise<number> {
  let settings: AttentionSettings & { renotify_hours: number; notify_supervisor_email: number; digest_sender_user_id: number | null };
  try {
    const s = await queryFirst<any>(db, 'SELECT * FROM serve_nudge_settings WHERE id = 1');
    settings = {
      approaching_hours: s?.approaching_hours ?? 48, diligence_gap_days: s?.diligence_gap_days ?? 3,
      unassigned_window_hours: s?.unassigned_window_hours ?? 72, renotify_hours: s?.renotify_hours ?? 24,
      notify_supervisor_email: s?.notify_supervisor_email ?? 1, digest_sender_user_id: s?.digest_sender_user_id ?? null,
    };
  } catch (err: any) { console.error('[serve-nudge] settings load failed:', err?.message); return 0; }

  let jobs: any[];
  try {
    jobs = await query<any>(db,
      `SELECT q.id, q.status, q.officer_id, q.deadline, q.defendant_name, q.recipient_name,
              (SELECT MAX(a.attempt_at) FROM serve_attempts a WHERE a.serve_queue_id = q.id) AS last_attempt_at
         FROM serve_queue q WHERE q.status NOT IN ('served','cancelled','failed') LIMIT 2000`);
  } catch (err: any) { console.error('[serve-nudge] jobs load failed:', err?.message); return 0; }

  const supervisors = await query<any>(db, "SELECT id, email FROM users WHERE role IN ('admin','manager','supervisor')").catch(() => []);
  const now = new Date().toISOString();
  const overdueForEmail: any[] = [];
  let notified = 0;

  for (const j of jobs) {
    const conditions = classifyServeJob({ id: j.id, status: j.status, officer_id: j.officer_id, deadline: j.deadline, last_attempt_at: j.last_attempt_at }, now, settings);
    for (const cond of conditions) {
      try {
        const nudge = await queryFirst<any>(db, 'SELECT last_notified_at FROM serve_nudges WHERE serve_queue_id = ? AND condition = ?', j.id, cond);
        if (!shouldNotify(nudge?.last_notified_at ?? null, now, settings.renotify_hours)) continue;
        const who = j.defendant_name ?? j.recipient_name ?? `Job ${j.id}`;
        const title = TITLES[cond]; const prio = PRIORITY[cond];
        const recipients = new Set<number>();
        if (j.officer_id != null) recipients.add(j.officer_id);
        for (const s of supervisors) recipients.add(s.id);
        for (const uid of recipients) {
          await execute(db,
            `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
             VALUES ('serve_nudge', ?, ?, ?, 'serve_job', ?, ?, 0, datetime('now','localtime'))`,
            prio, title, `${title}: ${who}`, j.id, uid);
        }
        await execute(db,
          `INSERT INTO serve_nudges (serve_queue_id, condition, last_notified_at) VALUES (?, ?, datetime('now','localtime'))
           ON CONFLICT(serve_queue_id, condition) DO UPDATE SET last_notified_at = datetime('now','localtime')`,
          j.id, cond);
        notified++;
        if (cond === 'deadline_passed') overdueForEmail.push({ who, id: j.id, deadline: j.deadline });
      } catch (err: any) { console.error(`[serve-nudge] job ${j.id}/${cond} failed:`, err?.message); }
    }
  }

  // Supervisor email digest for overdue — enqueue into the durable outbox (drained by the email cron).
  if (settings.notify_supervisor_email && settings.digest_sender_user_id && overdueForEmail.length) {
    const to = supervisors.filter((s) => s.email).map((s) => ({ emailAddress: { address: s.email } }));
    if (to.length) {
      const rows = overdueForEmail.map((o) => `<li>${o.who} (job ${o.id}) — deadline ${o.deadline ?? 'n/a'}</li>`).join('');
      const payload = JSON.stringify({
        message: { subject: `RMPG: ${overdueForEmail.length} process-serve job(s) OVERDUE`, body: { contentType: 'HTML', content: `<p>The following process-serve jobs are past deadline:</p><ul>${rows}</ul>` }, toRecipients: to },
        saveToSentItems: true,
      });
      try { await execute(db, "INSERT INTO email_outbox (owner_user_id, payload, status) VALUES (?, ?, 'pending')", settings.digest_sender_user_id, payload); }
      catch (err: any) { console.error('[serve-nudge] email enqueue failed:', err?.message); }
    }
  }
  return notified;
}
