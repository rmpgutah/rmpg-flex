// src/utils/serveAttention.ts
// Pure needs-attention classifier for process-serve jobs. No DB access.

export type AttentionCondition =
  | 'deadline_passed' | 'deadline_approaching' | 'diligence_gap' | 'unassigned_near_deadline';

export interface AttentionSettings {
  approaching_hours: number;
  diligence_gap_days: number;
  unassigned_window_hours: number;
}

export interface ServeJobForAttention {
  id: number;
  status: string;
  officer_id: number | null;
  deadline: string | null;
  last_attempt_at: string | null;
}

const CLOSED = new Set(['served', 'cancelled', 'failed']);

function hoursBetween(aIso: string, bIso: string): number | null {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (a - b) / 3_600_000;
}

export function classifyServeJob(
  job: ServeJobForAttention, nowIso: string, settings: AttentionSettings,
): AttentionCondition[] {
  if (CLOSED.has(job.status)) return [];
  const out: AttentionCondition[] = [];

  // Deadline conditions (passed outranks approaching).
  if (job.deadline) {
    const hToDeadline = hoursBetween(job.deadline, nowIso);
    if (hToDeadline !== null) {
      if (hToDeadline < 0) out.push('deadline_passed');
      else if (hToDeadline <= settings.approaching_hours) out.push('deadline_approaching');
    }
  }

  // Diligence gap: assigned + open + (no attempt or last attempt older than gap).
  if (job.officer_id != null) {
    const gapHours = settings.diligence_gap_days * 24;
    if (!job.last_attempt_at) {
      out.push('diligence_gap');
    } else {
      const sinceLast = hoursBetween(nowIso, job.last_attempt_at);
      if (sinceLast !== null && sinceLast > gapHours) out.push('diligence_gap');
    }
  }

  // Unassigned near deadline.
  if (job.officer_id == null && job.deadline) {
    const hToDeadline = hoursBetween(job.deadline, nowIso);
    if (hToDeadline !== null && hToDeadline <= settings.unassigned_window_hours) {
      out.push('unassigned_near_deadline');
    }
  }

  return out;
}

export function shouldNotify(lastNotifiedAt: string | null, nowIso: string, renotifyHours: number): boolean {
  if (!lastNotifiedAt) return true;
  const since = hoursBetween(nowIso, lastNotifiedAt);
  if (since === null) return true;
  return since > renotifyHours;
}
