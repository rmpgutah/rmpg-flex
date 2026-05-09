// Scheduled task health reporting
import { logger } from './logger';

interface TaskHealth {
  name: string;
  lastRun: string | null;
  lastDurationMs: number | null;
  lastStatus: 'success' | 'failure' | 'running' | 'never_run';
  runCount: number;
  failureCount: number;
  nextScheduled: string | null;
  error?: string;
}

const taskRegistry = new Map<string, TaskHealth>();

/** Register a scheduled task for health monitoring */
export function registerTask(name: string, nextScheduled?: string): void {
  if (!taskRegistry.has(name)) {
    taskRegistry.set(name, {
      name,
      lastRun: null,
      lastDurationMs: null,
      lastStatus: 'never_run',
      runCount: 0,
      failureCount: 0,
      nextScheduled: nextScheduled || null,
    });
  }
}

/** Record the start of a task execution */
export function taskStarted(name: string): void {
  const task = taskRegistry.get(name);
  if (task) {
    task.lastStatus = 'running';
    task.lastRun = new Date().toISOString();
  }
}

/** Record the completion of a task execution */
export function taskCompleted(
  name: string,
  durationMs: number,
  nextScheduled?: string
): void {
  const task = taskRegistry.get(name);
  if (task) {
    task.lastStatus = 'success';
    task.lastDurationMs = durationMs;
    task.runCount++;
    if (nextScheduled) task.nextScheduled = nextScheduled;
  }
}

/** Record a task failure */
export function taskFailed(name: string, error: string): void {
  const task = taskRegistry.get(name);
  if (task) {
    task.lastStatus = 'failure';
    task.failureCount++;
    task.runCount++;
    task.error = error.slice(0, 200);
    logger.error({ task: name, error: error.slice(0, 200) }, 'Scheduled task failed');
  }
}

/** Get health report for all registered tasks */
export function getTaskHealthReport(): TaskHealth[] {
  return Array.from(taskRegistry.values());
}

/** Wrap a scheduled task function with health tracking */
export function trackTask<T>(name: string, fn: () => Promise<T>): () => Promise<T> {
  registerTask(name);

  return async () => {
    const start = performance.now();
    taskStarted(name);

    try {
      const result = await fn();
      taskCompleted(name, performance.now() - start);
      return result;
    } catch (err) {
      taskFailed(name, err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
}
