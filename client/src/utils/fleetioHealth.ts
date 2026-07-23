// Mirrors the worker-side threshold in src/utils/fleetio/sync.ts's
// isFleetioQueueUnhealthy — kept as a small, independently-testable
// duplicate since client code can't import from src/ (Worker) code.
// Keep the two thresholds in sync if either changes.
export interface FleetioSyncStatus {
  failed_total: number;
  oldest_pending_created_at: string | null;
}

const UNHEALTHY_FAILED_THRESHOLD = 5;
const UNHEALTHY_PENDING_AGE_MS = 2 * 60 * 60 * 1000;

export function isFleetioSyncStatusUnhealthy(status: FleetioSyncStatus, nowMs: number): boolean {
  if (status.failed_total >= UNHEALTHY_FAILED_THRESHOLD) return true;
  if (status.oldest_pending_created_at) {
    const raw = status.oldest_pending_created_at;
    const parsed = Date.parse(raw.includes('T') ? raw : `${raw}Z`);
    if (Number.isFinite(parsed) && nowMs - parsed > UNHEALTHY_PENDING_AGE_MS) return true;
  }
  return false;
}
