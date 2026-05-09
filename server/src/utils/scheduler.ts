// ============================================================
// RMPG Flex — Job Scheduler (node-schedule)
// ============================================================
// Centralized cron-like scheduler for recurring tasks:
// - Nightly UCR/NIBRS statistical rollups
// - Warrant expiration alerts
// - Scheduled report generation (CompStat)
// - Sex offender registry sync
// - Evidence retention policy checks
// - Fleet maintenance reminders
// ============================================================

import schedule from 'node-schedule';
import { logger } from './logger';

// Track all scheduled jobs for status reporting
const scheduledJobs = new Map<string, { job: schedule.Job; description: string; lastRun?: Date; nextRun?: Date }>();

/**
 * Register a scheduled job with human-readable name and cron expression.
 * Timezone defaults to America/Denver (Mountain Time).
 */
export function scheduleJob(
  name: string,
  cronExpression: string,
  description: string,
  handler: () => void | Promise<void>
): schedule.Job {
  // Cancel existing job with same name if re-registering
  const existing = scheduledJobs.get(name);
  if (existing) {
    existing.job.cancel();
    logger.info({ scheduler: name }, 'Cancelled previous schedule');
  }

  const job = schedule.scheduleJob(
    name,
    { rule: cronExpression, tz: 'America/Denver' },
    async () => {
      const entry = scheduledJobs.get(name);
      if (entry) entry.lastRun = new Date();
      logger.info({ scheduler: name }, `Running scheduled job: ${description}`);
      try {
        await handler();
        logger.info({ scheduler: name }, 'Scheduled job completed');
      } catch (err) {
        logger.error({ err, scheduler: name }, 'Scheduled job failed');
      }
    }
  );

  scheduledJobs.set(name, {
    job,
    description,
    nextRun: job.nextInvocation() ? new Date(job.nextInvocation()!.getTime()) : undefined,
  });

  logger.info({ scheduler: name, cron: cronExpression, next: job.nextInvocation()?.toISOString() },
    `Scheduled: ${description}`);

  return job;
}

/**
 * Get status of all scheduled jobs (for admin dashboard).
 */
export function getSchedulerStatus(): Array<{
  name: string;
  description: string;
  nextRun: string | null;
  lastRun: string | null;
  active: boolean;
}> {
  const result: Array<{
    name: string;
    description: string;
    nextRun: string | null;
    lastRun: string | null;
    active: boolean;
  }> = [];

  for (const [name, entry] of scheduledJobs) {
    const nextInvocation = entry.job.nextInvocation();
    result.push({
      name,
      description: entry.description,
      nextRun: nextInvocation?.toISOString() || null,
      lastRun: entry.lastRun?.toISOString() || null,
      active: !!nextInvocation,
    });
  }

  return result;
}

/**
 * Cancel a specific scheduled job.
 */
export function cancelJob(name: string): boolean {
  const entry = scheduledJobs.get(name);
  if (!entry) return false;
  entry.job.cancel();
  scheduledJobs.delete(name);
  logger.info({ scheduler: name }, 'Job cancelled');
  return true;
}

/**
 * Cancel all scheduled jobs (for graceful shutdown).
 */
export function cancelAllJobs(): void {
  for (const [name, entry] of scheduledJobs) {
    entry.job.cancel();
    logger.info({ scheduler: name }, 'Job cancelled (shutdown)');
  }
  scheduledJobs.clear();
  schedule.gracefulShutdown();
}

/**
 * Run a named job immediately (for admin manual trigger).
 */
export async function runJobNow(name: string): Promise<boolean> {
  const entry = scheduledJobs.get(name);
  if (!entry) return false;
  entry.job.invoke();
  return true;
}

// ── Pre-defined schedule constants ────────────────────────
// Use these for consistency across the codebase

/** Every day at 2:00 AM Mountain Time */
export const DAILY_2AM = '0 2 * * *';

/** Every day at 3:00 AM Mountain Time */
export const DAILY_3AM = '0 3 * * *';

/** Every day at 6:00 AM Mountain Time */
export const DAILY_6AM = '0 6 * * *';

/** Every Monday at 6:00 AM Mountain Time */
export const WEEKLY_MON_6AM = '0 6 * * 1';

/** First of month at 3:00 AM Mountain Time */
export const MONTHLY_1ST_3AM = '0 3 1 * *';

/** Every hour at minute 0 */
export const HOURLY = '0 * * * *';

/** Every 15 minutes */
export const EVERY_15MIN = '*/15 * * * *';

/** Every 5 minutes */
export const EVERY_5MIN = '*/5 * * * *';
