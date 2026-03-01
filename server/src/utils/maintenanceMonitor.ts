// ============================================================
// RMPG Flex — Maintenance Monitor
// Background interval that performs automated housekeeping:
//   1. Auto-expire BOLOs past their expires_at date
//   2. Auto-expire trespass orders past their expiration_date
//   3. Mark credentials as 'expired' when past expiry_date
//   4. Auto-close cleared calls after configurable timeout (default 30min)
//   5. Auto-archive dispatch calls older than 90 days
//   6. Generate credential expiry notifications (30-day warning)
// Runs every 15 minutes. Safe to call multiple times (idempotent).
// ============================================================

import { getDb } from '../models/database';
import { createNotification } from '../routes/notifications';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startMaintenanceMonitor(intervalMs: number = 15 * 60 * 1000): void {
  if (intervalHandle) return; // Already running

  console.log(`[Maintenance] Starting — checking every ${intervalMs / 1000}s`);

  intervalHandle = setInterval(() => {
    try {
      runMaintenanceTasks();
    } catch (err) {
      console.error('[Maintenance] Error during maintenance cycle:', err);
    }
  }, intervalMs);

  // Run once after a 30s delay (let the server fully start first)
  setTimeout(() => {
    try { runMaintenanceTasks(); } catch (err) {
      console.error('[Maintenance] Initial cycle error:', err);
    }
  }, 30_000);
}

export function stopMaintenanceMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[Maintenance] Stopped');
  }
}

function runMaintenanceTasks(): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  let actions = 0;

  // ── 1. Auto-expire BOLOs ──────────────────────────────────
  try {
    const expiredBolos = db.prepare(`
      UPDATE bolos SET status = 'expired'
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at < datetime('now','localtime')
    `).run();
    if (expiredBolos.changes > 0) {
      console.log(`[Maintenance] Expired ${expiredBolos.changes} BOLO(s)`);
      actions += expiredBolos.changes;
    }
  } catch (err: any) {
    console.error('[Maintenance] BOLO expiry error:', err.message);
  }

  // ── 2. Auto-expire trespass orders ────────────────────────
  try {
    const expiredTrespass = db.prepare(`
      UPDATE trespass_orders SET status = 'expired'
      WHERE status = 'active'
        AND expiration_date IS NOT NULL
        AND expiration_date < datetime('now','localtime')
    `).run();
    if (expiredTrespass.changes > 0) {
      console.log(`[Maintenance] Expired ${expiredTrespass.changes} trespass order(s)`);
      actions += expiredTrespass.changes;
    }
  } catch (err: any) {
    console.error('[Maintenance] Trespass expiry error:', err.message);
  }

  // ── 3. Mark expired credentials ───────────────────────────
  try {
    const expiredCreds = db.prepare(`
      UPDATE credentials SET status = 'expired'
      WHERE status = 'active'
        AND expiry_date IS NOT NULL
        AND expiry_date < date('now','localtime')
        AND archived_at IS NULL
    `).run();
    if (expiredCreds.changes > 0) {
      console.log(`[Maintenance] Expired ${expiredCreds.changes} credential(s)`);
      actions += expiredCreds.changes;
    }
  } catch (err: any) {
    console.error('[Maintenance] Credential expiry error:', err.message);
  }

  // ── 4. Auto-close cleared calls after timeout (default 30 minutes) ──
  try {
    // Configurable: admin can set 'auto_close_minutes' in system_config
    let autoCloseMinutes = 30;
    try {
      const cfg = db.prepare(`SELECT config_value FROM system_config WHERE config_key = 'auto_close_minutes' AND is_active = 1`).get() as any;
      if (cfg) autoCloseMinutes = parseInt(cfg.config_value, 10) || 30;
    } catch { /* default 30 */ }

    const autoClosed = db.prepare(`
      UPDATE calls_for_service SET status = 'closed', closed_at = datetime('now','localtime'), updated_at = datetime('now','localtime')
      WHERE status = 'cleared'
        AND cleared_at IS NOT NULL
        AND cleared_at < datetime('now','localtime','-${autoCloseMinutes} minutes')
        AND archived_at IS NULL
    `).run();
    if (autoClosed.changes > 0) {
      console.log(`[Maintenance] Auto-closed ${autoClosed.changes} cleared call(s) (>${autoCloseMinutes}min)`);
      actions += autoClosed.changes;

      // Log each auto-closed call for audit trail
      const justClosed = db.prepare(`
        SELECT id, call_number FROM calls_for_service
        WHERE status = 'closed' AND closed_at >= datetime('now','localtime','-1 minutes')
          AND cleared_at < datetime('now','localtime','-${autoCloseMinutes} minutes')
      `).all() as any[];
      for (const c of justClosed) {
        try {
          db.prepare(`
            INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address)
            VALUES (0, 'auto_close', 'call', ?, ?, 'system')
          `).run(c.id, `${c.call_number} auto-closed after ${autoCloseMinutes}min cleared timeout`);
        } catch { /* non-fatal */ }
      }
    }
  } catch (err: any) {
    console.error('[Maintenance] Call auto-close error:', err.message);
  }

  // ── 5. Auto-archive old dispatch calls (>90 days, closed) ──
  try {
    const archivedCalls = db.prepare(`
      UPDATE calls_for_service SET archived_at = datetime('now','localtime')
      WHERE archived_at IS NULL
        AND status IN ('closed', 'cleared')
        AND created_at < datetime('now','localtime','-90 days')
    `).run();
    if (archivedCalls.changes > 0) {
      console.log(`[Maintenance] Auto-archived ${archivedCalls.changes} old call(s)`);
      actions += archivedCalls.changes;
    }
  } catch (err: any) {
    console.error('[Maintenance] Call archive error:', err.message);
  }

  // ── 6. Credential expiry warnings (30-day lookahead) ──────
  // Only creates notifications once per credential per day (uses tag to prevent duplicates)
  try {
    const today = new Date().toISOString().split('T')[0];
    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + 30);
    const cutoff = warningDate.toISOString().split('T')[0];

    const expiringCreds = db.prepare(`
      SELECT c.id, c.credential_type, c.expiry_date, c.officer_id,
             u.full_name as officer_name
      FROM credentials c
      JOIN users u ON c.officer_id = u.id
      WHERE c.status = 'active'
        AND c.archived_at IS NULL
        AND c.expiry_date IS NOT NULL
        AND c.expiry_date <= ?
        AND c.expiry_date >= date('now','localtime')
    `).all(cutoff) as any[];

    for (const cred of expiringCreds) {
      const daysLeft = Math.ceil((new Date(cred.expiry_date).getTime() - Date.now()) / 86400000);
      // Only notify at key intervals: 30, 14, 7, 3, 1 days
      if (![30, 14, 7, 3, 1].includes(daysLeft)) continue;

      const tag = `cred-expiry-${cred.id}-${today}`;
      const existingNotif = db.prepare(
        `SELECT id FROM notifications WHERE type = 'credential_expiry' AND body LIKE ? AND created_at >= date('now','localtime')`
      ).get(`%${tag}%`);

      if (!existingNotif) {
        try {
          const priority = daysLeft <= 3 ? 'critical' : daysLeft <= 7 ? 'high' : 'normal';
          // Notify the officer
          createNotification(
            cred.officer_id,
            'credential_expiry',
            `${cred.credential_type} expires in ${daysLeft} day(s)`,
            `Your ${cred.credential_type} expires on ${cred.expiry_date}. Please renew promptly. [${tag}]`,
            'credential',
            cred.id,
            priority as 'normal' | 'high' | 'critical',
          );
          // Notify admins/supervisors
          const admins = db.prepare(`SELECT id FROM users WHERE role IN ('admin', 'manager') AND status = 'active'`).all() as any[];
          for (const admin of admins) {
            createNotification(
              admin.id,
              'credential_expiry',
              `${cred.officer_name}: ${cred.credential_type} expires in ${daysLeft} day(s)`,
              `${cred.officer_name}'s ${cred.credential_type} expires on ${cred.expiry_date}. [${tag}]`,
              'credential',
              cred.id,
              priority as 'normal' | 'high' | 'critical',
            );
          }
          actions++;
        } catch (nErr: any) {
          // createNotification might not exist or fail — non-fatal
          console.error('[Maintenance] Notification error:', nErr.message);
        }
      }
    }
  } catch (err: any) {
    console.error('[Maintenance] Credential warning error:', err.message);
  }

  if (actions > 0) {
    console.log(`[Maintenance] Cycle complete — ${actions} action(s) taken`);
  }
}
