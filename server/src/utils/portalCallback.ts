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

    const apiKey = decryptApiKey(keyRow.config_value);

    // Get URL (default to production)
    const urlRow = db.prepare(
      "SELECT config_value FROM system_config WHERE config_key = 'rmpgutahps_url' AND category = 'integrations' AND is_active = 1 LIMIT 1"
    ).get() as { config_value: string } | undefined;

    const url = urlRow?.config_value || 'https://rmpgutahps.us';

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
    if (callData.source !== 'online') return;

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

    const payload = {
      case_id: sourceId,
      status: portalStatus,
      result: callData.process_service_result || null,
      notes: callData.notes || null,
      served_at: callData.process_served_at || null,
      attempts: callData.process_attempts || 0,
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
