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
  // Arrests & Jail
  | 'arrest_created'
  | 'arrest_updated'
  | 'arrest_deleted'
  | 'arrest_imported'
  | 'arrest_linked'
  | 'arrest_unlinked'
  | 'jail_roster_config_updated'
  | 'jail_roster_sync_triggered'
  | 'jail_roster_errors_reset'
  // DL Records
  | 'dl_record_created'
  | 'dl_record_deleted'
  // Skip Tracer
  | 'skiptracer_search'
  | 'skiptracer_config_updated'
  | 'skiptracer_config_cleared'
  // Forensic Lab
  | 'forensic_case_created'
  | 'forensic_case_updated'
  | 'forensic_case_deleted'
  // IPED Digital Forensics
  | 'iped_job_created'
  | 'iped_job_cancelled'
  | 'iped_config_updated'
  | 'iped_config_cleared'
  | 'iped_hash_computed'
  | 'iped_hashset_imported'
  | 'iped_hashset_removed'
  // ClearPathGPS
  | 'clearpathgps_credentials_updated'
  | 'clearpathgps_credentials_cleared'
  | 'clearpathgps_toggled'
  | 'clearpathgps_mapping_created'
  | 'clearpathgps_mapping_removed'
  | 'clearpathgps_settings_updated'
  | 'clearpathgps_media_settings_updated'
  | 'clearpathgps_media_sync_triggered'
  // Dash Camera Videos
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
  | 'DELETE_EMAIL'
  | 'BATCH_EMAIL'
  | 'MARK_ALL_READ'
  | 'OAUTH_INITIATE'
  | 'SCHEDULE_EMAIL'
  // CRM
  | 'crm_task_created'
  | 'crm_task_updated'
  | 'crm_task_deleted'
  | 'crm_activity_logged'
  // Generic CRUD (used by newer routes)
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'SEARCH';

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
  | 'arrest_record'
  | 'serve_queue'
  | 'dl_record'
  | 'skiptracer'
  | 'iped_job'
  | 'iped_hashset'
  | 'jail_roster'
  | 'integration'
  | 'dashcam_video'
  | 'dashcam_video_link'
  | 'email'
  | 'email_folder'
  | 'email_template'
  | 'email_link'
  | 'email_schedule'
  | 'system_config'
  | 'colorado_doc_offenders'
  | 'crm_task'
  | 'crm_activity'
  | 'crm_leads'
  | 'crm_lead_activity'
  | 'crm_proposals'
  | 'crm_proposal_templates'
  | 'lead_scrape_sources'
  | 'forensic_case';

/**
 * Log an action to the activity_log table.
 *
 * @param req        Express request (extracts user_id and IP)
 * @param action     What happened (e.g., 'incident_created')
 * @param entityType What kind of entity was affected
 * @param entityId   The ID of the affected entity
 * @param details    Human-readable description of the action
 */
export function auditLog(
  req: Request,
  action: AuditAction,
  entityType: AuditEntityType,
  entityId: string | number,
  details: string,
): void {
  try {
    const db = getDb();
    const userId = req.user?.userId ?? null;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, action, entityType, String(entityId), details, ip, localNow());
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
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at)
      VALUES (NULL, ?, ?, ?, ?, 'system', ?)
    `).run(action, entityType, String(entityId), details, localNow());
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

    const batchInsert = db.transaction(() => {
      for (const entry of entries) {
        stmt.run(userId, entry.action, entry.entityType, String(entry.entityId), entry.details, ip, now);
      }
    });

    batchInsert();
  } catch (err) {
    console.error('[AUDIT] Failed to batch-log:', err);
  }
}
