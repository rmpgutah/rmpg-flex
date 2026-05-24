// ============================================================
// RMPG Flex — Audit Logger Utility
// ============================================================
// Centralized audit logging for all data-modifying operations.
// Replaces ad-hoc INSERT INTO activity_log calls scattered
// throughout route handlers with a clean, type-safe API.
//
// Usage in routes:
//   import { auditLog } from '../utils/auditLogger';
//   auditLog(req, 'incident_created', 'incident', newId, 'Created incident #RKY26-00001');
// ============================================================

import { Request } from 'express';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';

export type AuditAction =
  // Auth
  | 'user_login'
  | 'user_logout'
  | 'password_changed'
  | 'login_failed'
  // Dispatch
  | 'call_created'
  | 'call_updated'
  | 'call_closed'
  | 'call_deleted'
  | 'unit_status_changed'
  | 'unit_assigned'
  | 'unit_unassigned'
  | 'panic_activated'
  // Incidents
  | 'incident_created'
  | 'incident_updated'
  | 'incident_status_changed'
  | 'incident_deleted'
  | 'supplement_added'
  // Records
  | 'person_created'
  | 'person_updated'
  | 'person_deleted'
  | 'vehicle_created'
  | 'vehicle_updated'
  | 'vehicle_deleted'
  | 'evidence_created'
  | 'evidence_updated'
  | 'evidence_deleted'
  | 'record_linked'
  | 'record_unlinked'
  // Warrants & Citations
  | 'warrant_created'
  | 'warrant_updated'
  | 'warrant_served'
  | 'warrant_deleted'
  | 'citation_created'
  | 'citation_updated'
  | 'citation_voided'
  | 'citation_deleted'
  // Personnel
  | 'officer_created'
  | 'officer_updated'
  | 'officer_archived'
  | 'schedule_created'
  | 'schedule_updated'
  | 'time_entry_created'
  | 'time_entry_updated'
  | 'credential_added'
  | 'credential_updated'
  | 'training_added'
  | 'training_updated'
  | 'deployment_created'
  | 'deployment_updated'
  // Fleet
  | 'vehicle_fleet_created'
  | 'vehicle_fleet_updated'
  | 'maintenance_logged'
  | 'inspection_completed'
  | 'fuel_logged'
  // Communications
  | 'message_sent'
  | 'bolo_created'
  | 'bolo_updated'
  | 'bolo_cancelled'
  | 'broadcast_sent'
  // Admin
  | 'user_created'
  | 'user_updated'
  | 'user_deactivated'
  | 'config_updated'
  | 'client_created'
  | 'client_updated'
  // Uploads
  | 'file_uploaded'
  | 'file_deleted'
  // Reports
  | 'report_generated'
  | 'report_exported'
  // Patrol
  | 'checkpoint_created'
  | 'checkpoint_updated'
  | 'checkpoint_deleted'
  | 'patrol_scan_logged'
  // Invoices
  | 'invoice_created'
  | 'invoice_updated'
  | 'payment_recorded'
  // Integrations
  | 'api_key_created'
  | 'api_key_revoked'
  | 'api_key_activated'
  | 'api_key_deleted'
  // Arrests
  | 'arrest_created'
  | 'arrest_updated'
  | 'arrest_deleted'
  | 'arrest_imported'
  | 'arrest_linked'
  | 'arrest_unlinked'
  // CRM
  | 'crm_task_created'
  | 'crm_task_updated'
  | 'crm_task_deleted'
  | 'crm_activity_logged'
  // Dashcam
  | 'dashcam_uploaded'
  | 'dashcam_updated'
  | 'dashcam_deleted'
  | 'dashcam_linked'
  | 'dashcam_unlinked'
  // Email
  | 'SEND_EMAIL'
  | 'REPLY_EMAIL'
  | 'REPLY_ALL_EMAIL'
  | 'FORWARD_EMAIL'
  | 'SCHEDULE_EMAIL'
  | 'DELETE_EMAIL'
  | 'BATCH_EMAIL'
  | 'MARK_ALL_READ'
  | 'OAUTH_INITIATE'
  // Search / CRUD
  | 'SEARCH'
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'EXPORT'
  // Skip Tracker
  | 'skiptracer_search'
  | 'skiptracer_config_updated'
  | 'skiptracer_config_cleared'
  // Jail Roster
  | 'jail_roster_sync_triggered'
  | 'jail_roster_config_updated'
  | 'jail_roster_errors_reset'
  // Preferences
  | 'preferences_updated'
  | 'preferences_reset'
  // Safety
  | 'safety_alert_broadcast'
  // Extensible: allow any string for new features
  | (string & {});

export type AuditEntityType =
  | 'user'
  | 'call'
  | 'incident'
  | 'person'
  | 'vehicle'
  | 'evidence'
  | 'unit'
  | 'warrant'
  | 'citation'
  | 'officer'
  | 'schedule'
  | 'time_entry'
  | 'credential'
  | 'training'
  | 'deployment'
  | 'fleet_vehicle'
  | 'maintenance'
  | 'inspection'
  | 'fuel_log'
  | 'message'
  | 'bolo'
  | 'config'
  | 'client'
  | 'file'
  | 'report'
  | 'checkpoint'
  | 'patrol_scan'
  | 'invoice'
  | 'payment'
  | 'api_key'
  | 'arrest'
  | 'dashcam'
  | 'email'
  | 'crm_task'
  | 'crm_lead'
  | 'crm_proposal'
  | 'crm_competitor'
  | 'service_request'
  | 'skiptracer'
  | 'jail_roster'
  | 'preferences'
  | 'safety_alert'
  | 'firecrawl'
  | 'geofence'
  | (string & {});

/**
 * Log an action to the activity_log table.
 *
 * @param req        Express request (extracts user_id and IP)
 * @param action     What happened (e.g., 'incident_created')
 * @param entityType What kind of entity was affected
 * @param entityId   The ID of the affected entity
 * @param details    Human-readable description of the action
 */
// [FIX 48] Max detail string length to prevent oversized audit entries
const MAX_DETAILS_LENGTH = 4000;

function stringifyAuditDetails(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown serialization error';
    return `[unserializable audit details: ${message}]`;
  }
}

function buildAuditDetails(detailsOrBefore: unknown, afterOrDetails?: unknown): string {
  if (afterOrDetails === undefined) {
    return stringifyAuditDetails(detailsOrBefore);
  }

  if (typeof afterOrDetails === 'string') {
    return afterOrDetails;
  }

  if (detailsOrBefore == null && afterOrDetails == null) {
    return '';
  }

  return stringifyAuditDetails({
    before: detailsOrBefore ?? null,
    after: afterOrDetails ?? null,
  });
}

export function auditLog(
  req: Request,
  action: AuditAction,
  entityType: AuditEntityType,
  entityId: string | number,
  detailsOrBefore?: unknown,
  afterOrDetails?: unknown,
): void {
  try {
    const db = getDb();
    const userId = req.user?.userId ?? null;
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const details = buildAuditDetails(detailsOrBefore, afterOrDetails);

    // [FIX 49] Truncate details to prevent oversized DB rows
    const truncatedDetails = details && details.length > MAX_DETAILS_LENGTH
      ? details.substring(0, MAX_DETAILS_LENGTH) + '... [truncated]'
      : details;

    // [FIX 50] Sanitize entityId to string safely (handle undefined/null)
    const safeEntityId = entityId != null ? String(entityId) : '';

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, action, entityType, safeEntityId, truncatedDetails || '', ip, localNow());
  } catch (err) {
    // Never let audit logging break the actual operation
    console.error('[AUDIT] Failed to log:', action, entityType, entityId, err);
  }
}

/**
 * Log an action with a system user (for automated operations).
 */
export function auditLogSystem(
  action: AuditAction,
  entityType: AuditEntityType,
  entityId: string | number,
  details: string,
): void {
  try {
    const db = getDb();
    // [FIX 51] Truncate system audit details too
    const truncatedDetails = details && details.length > MAX_DETAILS_LENGTH
      ? details.substring(0, MAX_DETAILS_LENGTH) + '... [truncated]'
      : details;
    const safeEntityId = entityId != null ? String(entityId) : '';

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (NULL, ?, ?, ?, ?, 'system', ?)
    `).run(action, entityType, safeEntityId, truncatedDetails || '', localNow());
  } catch (err) {
    console.error('[AUDIT] Failed to log system action:', action, entityType, entityId, err);
  }
}

/**
 * Bulk-log multiple actions in a single transaction.
 * Useful for batch operations.
 */
export function auditLogBatch(
  req: Request,
  entries: Array<{
    action: AuditAction;
    entityType: AuditEntityType;
    entityId: string | number;
    details: string;
  }>,
): void {
  try {
    const db = getDb();
    const userId = req.user?.userId ?? null;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = localNow();

    const stmt = db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // [FIX 52] Limit batch size to prevent extremely large transactions
    const MAX_BATCH = 500;
    const limitedEntries = entries.slice(0, MAX_BATCH);

    const batchInsert = db.transaction(() => {
      for (const entry of limitedEntries) {
        // [FIX 53] Truncate batch entry details
        const truncated = entry.details && entry.details.length > MAX_DETAILS_LENGTH
          ? entry.details.substring(0, MAX_DETAILS_LENGTH) + '... [truncated]'
          : entry.details;
        stmt.run(userId, entry.action, entry.entityType, String(entry.entityId ?? ''), truncated || '', ip, now);
      }
    });

    batchInsert();
  } catch (err) {
    console.error('[AUDIT] Failed to batch-log:', err);
  }
}
