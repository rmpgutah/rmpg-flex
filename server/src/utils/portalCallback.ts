// ============================================================
// RMPG Flex — Portal Status Callback Utility
// ============================================================
// When a dispatch call with source='online' gets its status
// updated, this utility pushes the update back to rmpgutahps.us.
//
// Silent fail — logs errors but never blocks dispatch updates.
// ============================================================

import { getDb } from '../models/database';
import { decryptApiKey } from './serveManagerClient';

// ── Status Mapping ──────────────────────────────────────────

function mapFlexStatusToPortal(status: string, processResult: string | null): string {
  switch (status) {
    case 'pending':
      return 'Open';
    case 'dispatched':
    case 'enroute':
    case 'onscene':
      return 'In Progress';
    case 'cleared':
      return processResult === 'served' ? 'Served' : 'Closed';
    case 'closed':
      return 'Closed';
    default:
      return 'In Progress';
  }
}

// ── Extract source_id from description/notes ────────────────

function extractSourceId(callData: any): string | null {
  const text = `${callData.description || ''} ${callData.notes || ''}`;
  const match = text.match(/\[source_id:([^\]]+)\]/);
  return match ? match[1] : null;
}

// ── Portal API Key & URL Resolution ─────────────────────────

function getPortalConfig(): { url: string; apiKey: string } | null {
  try {
    const db = getDb();

    // Get API key
    const keyRow = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'rmpgutahps_api_key' AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;

    if (!keyRow?.config_value) {
      return null;
    }

    let apiKey: string;
    try {
      apiKey = decryptApiKey(keyRow.config_value);
    } catch (decryptErr) {
      console.error('[PortalCallback] Failed to decrypt portal API key:', decryptErr instanceof Error ? decryptErr.message : decryptErr);
      return null;
    }

    // Get URL (default to production)
    const urlRow = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'rmpgutahps_url' AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;

    const url = urlRow?.config_value || 'https://rmpgutahps.us';

    // Basic URL validation
    if (!url.startsWith('https://')) {
      console.error('[PortalCallback] Portal URL must use HTTPS:', url);
      return null;
    }

    return { url, apiKey };
  } catch (err) {
    console.error('[PortalCallback] Failed to resolve portal config:', err);
    return null;
  }
}

// ── Main Export ──────────────────────────────────────────────

/**
 * Notify the rmpgutahps.us portal of a status change on a
 * dispatch call that originated from the portal (source='online').
 *
 * This function is fire-and-forget — it never throws.
 */
export async function notifyPortalStatusUpdate(callData: any): Promise<void> {
  try {
    // Only notify for calls that came from the portal
    if (!callData || callData.source !== 'online') return;

    if (!callData.status || typeof callData.status !== 'string') {
      console.warn('[PortalCallback] Cannot notify: missing or invalid status in call', callData.id);
      return;
    }

    const sourceId = extractSourceId(callData);
    if (!sourceId) {
      console.warn('[PortalCallback] Cannot notify: no source_id found in call', callData.id);
      return;
    }

    const portalConfig = getPortalConfig();
    if (!portalConfig) {
      // Portal callback not configured — silently skip
      return;
    }

    const portalStatus = mapFlexStatusToPortal(
      callData.status,
      callData.process_service_result || null,
    );

    // Look up linked serve_queue entry for enhanced status data
    let serveStatus: string | null = null;
    let serveAttempts = 0;
    try {
      const db = getDb();
      const serveJob = db.prepare('SELECT id, status, attempt_count FROM serve_queue WHERE call_id = ?').get(callData.id) as any;
      if (serveJob) {
        serveStatus = serveJob.status || null;
        serveAttempts = serveJob.attempt_count || 0;
      }
    } catch (serveErr) {
      console.error('[PortalCallback] Failed to look up serve_queue for call:', serveErr instanceof Error ? serveErr.message : serveErr);
    }

    const payload = {
      case_id: sourceId,
      status: portalStatus,
      result: callData.process_service_result || null,
      notes: callData.notes || null,
      served_at: callData.process_served_at || null,
      attempts: callData.process_attempts || 0,
      serve_status: serveStatus,
      serve_attempts: serveAttempts,
    };

    const response = await fetch(`${portalConfig.url}/api/external/cases/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': portalConfig.apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000), // 10 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      console.error(`[PortalCallback] Failed to notify portal: ${response.status} — ${errorText}`);
      return;
    }

    console.log(`[PortalCallback] Notified portal: case_id=${sourceId} status=${portalStatus}`);
  } catch (err: any) {
    // Silent fail — never block the dispatch update
    console.error('[PortalCallback] Error notifying portal:', err.message || err);
  }
}
