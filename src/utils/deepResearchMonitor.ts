// src/utils/deepResearchMonitor.ts
// Cron-driven re-run of due Deep Research monitors. Robust across deploys/DO
// evictions (a DO self-alarm for a multi-day interval would be lost). Called
// from the per-minute scheduled() trigger.
import type { Bindings } from '../types';
import { query, execute } from './db';

interface DueJob {
  id: string; org_id: number | null; subject: string; subject_type: string;
  context: string | null; monitor_interval_days: number | null; run_count: number;
}

/** Re-kick deep-research jobs whose monitor interval has come due. Returns the
 *  number of jobs re-launched. */
export async function sweepDeepResearchMonitors(env: Bindings): Promise<number> {
  const due = await query<DueJob>(
    env.DB,
    `SELECT id, org_id, subject, subject_type, context, monitor_interval_days, run_count
       FROM deep_research_jobs
      WHERE monitor_interval_days IS NOT NULL AND next_run_at IS NOT NULL
        AND next_run_at <= datetime('now') AND status IN ('done', 'error')
      LIMIT 25`,
  );
  let n = 0;
  for (const j of due) {
    const runNo = (j.run_count || 1) + 1;
    // Clear next_run_at so the sweep can't double-fire before this run finishes;
    // the DO resets next_run_at when it completes.
    await execute(env.DB,
      `UPDATE deep_research_jobs SET status='queued', progress=0, run_count=?, next_run_at=NULL, updated_at=datetime('now') WHERE id=?`,
      runNo, j.id);
    const stub = env.DEEP_RESEARCH.get(env.DEEP_RESEARCH.idFromName(j.id));
    await stub.fetch('https://do/start', {
      method: 'POST',
      body: JSON.stringify({
        jobId: j.id, orgId: j.org_id, subject: j.subject, subjectType: j.subject_type,
        context: j.context || '', seedAngles: [], monitorIntervalDays: j.monitor_interval_days, runNo,
      }),
    });
    n++;
  }
  return n;
}
