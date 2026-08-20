// Mirrors the worker-side threshold in src/utils/fleetio/sync.ts's
// isFleetioQueueUnhealthy — kept as a small, independently-testable
// duplicate since client code can't import from src/ (Worker) code.
// Keep the two thresholds in sync if either changes.
export interface FleetioSyncStatus {
  // Legacy all-directions failed count — kept for backward compatibility
  // with other consumers of this field. The "unhealthy" threshold does NOT
  // use this; see outbound_failed_total below.
  failed_total: number;
  // The failed count the "unhealthy" threshold actually applies to —
  // matches the worker-side getQueueHealth()/isFleetioQueueUnhealthy()
  // definition (outbound-only) exactly, so this badge and the cron alert
  // can't disagree.
  outbound_failed_total: number;
  oldest_pending_created_at: string | null;
}

const UNHEALTHY_FAILED_THRESHOLD = 5;
const UNHEALTHY_PENDING_AGE_MS = 2 * 60 * 60 * 1000;

export function isFleetioSyncStatusUnhealthy(status: FleetioSyncStatus, nowMs: number): boolean {
  if (status.outbound_failed_total >= UNHEALTHY_FAILED_THRESHOLD) return true;
  if (status.oldest_pending_created_at) {
    const raw = status.oldest_pending_created_at;
    const parsed = Date.parse(raw.includes('T') ? raw : `${raw}Z`);
    if (Number.isFinite(parsed) && nowMs - parsed > UNHEALTHY_PENDING_AGE_MS) return true;
  }
  return false;
}
