// ============================================================
// RMPG Flex — Patrol Monitor
// Background interval that checks for overdue patrol scans.
// When a checkpoint goes overdue (past its scan_required_interval),
// creates notifications for the assigned officer and supervisors.
// ============================================================

import { getDb } from '../models/database';
import { createNotification } from '../routes/notifications';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startPatrolMonitor(intervalMs: number = 5 * 60 * 1000): void {
  if (intervalHandle) return; // Already running

  console.log(`[Patrol Monitor] Starting — checking every ${intervalMs / 1000}s`);

  intervalHandle = setInterval(() => {
    try {
      checkOverdueScans();
    } catch (err) {
      console.error('[Patrol Monitor] Error during scan check:', err);
    }
  }, intervalMs);

  // Run once immediately
  setTimeout(() => {
    try { checkOverdueScans(); } catch (err) {
      console.error('[Patrol Monitor] Initial check error:', err);
    }
  }, 10_000);
}

export function stopPatrolMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[Patrol Monitor] Stopped');
  }
}

function checkOverdueScans(): void {
  const db = getDb();

  // Get active checkpoints with their required interval
  const checkpoints = db.prepare(`
    SELECT pc.id, pc.name, pc.scan_required_interval_minutes, pc.assigned_officer_id,
           pc.description
    FROM patrol_checkpoints pc
    WHERE pc.is_active = 1
      AND pc.scan_required_interval_minutes > 0
  `).all() as any[];

  if (checkpoints.length === 0) return;

  const now = Date.now();

  for (const cp of checkpoints) {
    // Find last scan for this checkpoint
    const lastScan = db.prepare(`
      SELECT scanned_at FROM patrol_scans
      WHERE checkpoint_id = ?
      ORDER BY scanned_at DESC LIMIT 1
    `).get(cp.id) as any;

    if (!lastScan) continue; // Never scanned — skip (avoid alerting on brand new checkpoints)

    const lastScanTime = new Date(lastScan.scanned_at).getTime();
    const overdueThreshold = cp.scan_required_interval_minutes * 60 * 1000;
    const timeSinceLastScan = now - lastScanTime;

    if (timeSinceLastScan > overdueThreshold) {
      // Check if we already sent a notification in the last interval
      // Use parameterized offset string to avoid SQL injection
      const offsetStr = `-${Math.max(1, Math.floor(Number(cp.scan_required_interval_minutes) || 60))} minutes`;
      const existingNotif = db.prepare(`
        SELECT id FROM notifications
        WHERE entity_type = 'patrol_checkpoint' AND entity_id = ?
          AND type = 'patrol_missed'
          AND created_at >= datetime('now', ?)
      `).get(cp.id, offsetStr) as any;

      if (existingNotif) continue; // Already notified

      const overdueMinutes = Math.round(timeSinceLastScan / 60000);
      const title = `MISSED SCAN: ${cp.name}`;
      const body = `Checkpoint "${cp.name}" (${cp.description || 'N/A'}) is ${overdueMinutes}min overdue. Required interval: ${cp.scan_required_interval_minutes}min.`;

      // Notify assigned officer
      if (cp.assigned_officer_id) {
        createNotification(
          cp.assigned_officer_id,
          'patrol_missed',
          title,
          body,
          'patrol_checkpoint',
          cp.id,
          'high',
          'patrol.checkpoint_missed',
        );
      }

      // Notify all supervisors (admin + manager roles)
      const supervisors = db.prepare(
        "SELECT id FROM users WHERE role IN ('admin', 'manager') AND status = 'active'"
      ).all() as any[];

      for (const sup of supervisors) {
        if (sup.id !== cp.assigned_officer_id) {
          createNotification(
            sup.id,
            'patrol_missed',
            title,
            body,
            'patrol_checkpoint',
            cp.id,
            'high',
            'patrol.checkpoint_missed',
          );
        }
      }

      console.log(`[Patrol Monitor] Overdue: ${cp.name} — ${overdueMinutes}min`);
    }
  }
}
