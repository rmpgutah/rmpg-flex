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
import crypto from 'crypto';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import config from '../config';

export type AuditAction =
  // Auth
  | 'user_login'
  | 'user_logout'
  | 'password_changed'
  | 'login_failed'
  | 'session_anomaly'
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
  | 'person_archived'
  | 'person_unarchived'
  | 'vehicle_archived'
  | 'vehicle_unarchived'
  | 'evidence_archived'
  | 'evidence_unarchived'
  | 'property_created'
  | 'property_updated'
  | 'property_deleted'
  | 'property_archived'
  | 'property_unarchived'
  | 'custody_entry'
  | 'evidence_check_in'
  | 'evidence_check_out'
  | 'evidence_transfer'
  | 'evidence_lab_submit'
  | 'evidence_release'
  | 'evidence_dispose'
  | 'criminal_history_created'
  | 'criminal_history_updated'
  | 'criminal_history_deleted'
  | 'client_person_linked'
  | 'client_person_updated'
  | 'client_person_unlinked'
  | 'record_linked'
  | 'record_unlinked'
  // Warrants & Citations
  | 'warrant_created'
  | 'warrant_updated'
  | 'warrant_served'
  | 'warrant_deleted'
  | 'person_intel_search'
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
  | 'user_terminated'
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
  | 'dashcam_burn_started'
  | 'dashcam_thumbnail_uploaded'
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
  // Offline Sync
  | 'offline_sync_pull'
  | 'offline_sync_push'
  | 'offline_secret_accessed'
  | 'offline_secret_generated'
  | 'offline_secrets_bulk_generated'
  | 'offline_secrets_bulk_accessed'
  // User Preferences
  | 'preferences_updated'
  | 'preferences_reset'
  // Microbilt / OFAC
  | 'microbilt_credentials_updated'
  | 'microbilt_credentials_cleared'
  | 'microbilt_products_updated'
  | 'ofac_search'
  // Generic CRUD (used by newer routes)
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'SEARCH'
  | 'BLOCK'
  | 'EXPORT'
  | 'ADMIN_PASSWORD_RESET'
  | 'LOGIN'
  | 'MOVE_EMAIL'
  | 'CANCEL_EMAIL';

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
  | 'forensic_case'
  | 'offline_sync'
  | 'offline_secret'
  | 'user_preferences'
  | 'ofac_screening'
  | 'case'
  | 'patrol_checkpoint'
  | 'invoice_line_item'
  | 'scheduled_email'
  | 'property'
  | 'record_link'
  | 'criminal_history'
  | 'court_event'
  | 'field_interview'
  | 'trespass_order'
  | 'code_violation'
  | 'vehicle_tow'
  | 'attachment'
  | 'case'
  | 'case_note'
  | 'company_documents'
  | 'users'
  | 'scheduled_email'
  | 'invoice_line_item'
  | 'patrol_checkpoint';

// ─── Audit Log Integrity ─────────────────────────────────
// Each log entry includes an HMAC hash of its contents, chained to the previous
// entry's hash. This creates a tamper-evident chain — modifying any entry
// invalidates all subsequent hashes, making tampering detectable.
let lastLogHash = '';

function computeLogHash(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: string,
  details: string,
  ip: string,
  timestamp: string,
): string {
  const data = `${lastLogHash}|${userId}|${action}|${entityType}|${entityId}|${details}|${ip}|${timestamp}`;
  const hash = crypto.createHmac('sha256', config.jwt.secret)
    .update(data).digest('hex').slice(0, 32);
  lastLogHash = hash;
  return hash;
}

// Sensitive field patterns that must never appear in audit log details
const SENSITIVE_PATTERNS = [
  /password[_\s]*(?:hash)?["']?\s*[:=]\s*["']?[^\s,}"']+/gi,
  /secret["']?\s*[:=]\s*["']?[^\s,}"']+/gi,
  /token["']?\s*[:=]\s*["']?[^\s,}"']+/gi,
  /totp[_\s]*(?:secret|key)["']?\s*[:=]\s*["']?[^\s,}"']+/gi,
  /api[_\s]*key["']?\s*[:=]\s*["']?[^\s,}"']+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT tokens (eyJ... pattern)
];

function maskSensitiveData(text: string): string {
  if (!text || text.length === 0) return text;
  let masked = text.length > 2000 ? text.substring(0, 2000) : text;
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0; // Reset global regex state
    masked = masked.replace(pattern, '[REDACTED]');
  }
  return masked;
}

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
  entityId: string | number | bigint,
  details: string,
): void {
  try {
    const db = getDb();
    const userId = req.user?.userId ?? null;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const requestId = req.headers['x-request-id'] || '';

    // Truncate details, strip control characters, and mask sensitive data
    const safeDetails = maskSensitiveData(
      details.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').substring(0, 1000)
    );
    // Append request ID for correlation if available
    const detailsWithId = requestId ? `${safeDetails} [req:${requestId}]` : safeDetails;

    const now = localNow();
    const logHash = computeLogHash(userId, action, entityType, String(entityId), detailsWithId, ip, now);

    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at, log_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, action, entityType, String(entityId), detailsWithId, ip, now, logHash);
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
  entityId: string | number | bigint,
  details: string,
): void {
  try {
    const db = getDb();
    const now = localNow();
    const logHash = computeLogHash(null, action, entityType, String(entityId), details, 'system', now);
    db.prepare(`
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at, log_hash)
      VALUES (NULL, ?, ?, ?, ?, 'system', ?, ?)
    `).run(action, entityType, String(entityId), details, now, logHash);
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
      INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, ip_address, created_at, log_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const batchInsert = db.transaction(() => {
      for (const entry of entries) {
        const safeDetails = maskSensitiveData(
          entry.details.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').substring(0, 1000)
        );
        const logHash = computeLogHash(userId, entry.action, entry.entityType, String(entry.entityId), safeDetails, ip, now);
        stmt.run(userId, entry.action, entry.entityType, String(entry.entityId), safeDetails, ip, now, logHash);
      }
    });

    batchInsert();
  } catch (err) {
    console.error('[AUDIT] Failed to batch-log:', err);
  }
}

// ─── Security Event Logging (SIEM-ready) ────────────────
// Structured security events logged to stdout in JSON format.
// Can be ingested by Splunk, ELK, CloudWatch, or any SIEM that reads structured logs.
const SECURITY_EVENT_ACTIONS = new Set([
  'login_failed', 'user_login', 'user_logout', 'password_changed',
  'session_anomaly', 'BLOCK', 'user_deactivated', 'user_terminated',
  'config_updated', 'user_created', 'panic_activated',
]);

export function securityEvent(
  event: string,
  severity: 'info' | 'warning' | 'critical',
  data: Record<string, unknown>,
): void {
  const entry = {
    '@timestamp': new Date().toISOString(),
    event_type: 'security',
    event,
    severity,
    ...data,
  };
  // Structured JSON line — SIEM-compatible
  console.log(`[SECURITY] ${JSON.stringify(entry)}`);
}
