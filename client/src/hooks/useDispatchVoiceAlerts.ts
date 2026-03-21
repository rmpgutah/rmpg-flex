// ============================================================
// RMPG Flex — App-Wide Dispatch Voice Alerts Hook
// Subscribes to WebSocket dispatch events and triggers voice
// announcements on every page (Dashboard, Map, MDT, etc.),
// not just DispatchPage. Runs inside Layout.tsx so it's always
// active while the user is logged in.
//
// The dedup cache in voiceAlerts.ts (60s TTL) prevents double-
// announcing if DispatchPage also triggers the same alert.
// ============================================================

import { useEffect } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import {
  announceNewCall,
  announceCallAlerts,
  announceStatusChange,
  announceUnitDispatched,
  announcePanicAlert,
  announceBolo,
  announceWarrantHit,
  announceDispatchEvent,
  announceBackupRequest,
  announcePursuit,
  announceAllUnits,
} from '../utils/voiceAlerts';

/**
 * Normalize DB column names to voice system field names.
 * The DB uses `location_address`, the voice system expects `location`.
 * The DB uses `narrative`, voice system also accepts `description`.
 * This ensures every field the dispatcher reads is populated.
 */
function normalizeCallForVoice(raw: any): any {
  if (!raw) return raw;
  return {
    ...raw,
    // Location mapping
    location: raw.location || raw.location_address || '',
    business_name: raw.business_name || raw.property_name || raw.client_name || '',
    // Zone/beat — DB stores zone_beat as "Z3/B1" or separate fields
    zone: raw.zone || raw.zone_name || raw.zone_id || (raw.zone_beat ? raw.zone_beat.split('/')[0]?.replace(/^Z/i, '') : '') || '',
    beat: raw.beat || raw.beat_name || raw.beat_id || (raw.zone_beat ? raw.zone_beat.split('/')[1]?.replace(/^B/i, '') : '') || '',
    section_name: raw.section_name || '',
    beat_descriptor: raw.beat_descriptor || '',
    // Narrative
    narrative: raw.narrative || raw.description || '',
    description: raw.description || raw.narrative || '',
    // Subject
    suspect_description: raw.suspect_description || raw.subject_description || '',
    subject_description: raw.subject_description || raw.suspect_description || '',
    // Assigned units — DB stores as JSON string
    assigned_units: Array.isArray(raw.assigned_units) ? raw.assigned_units
      : (typeof raw.assigned_units === 'string' ? tryParseJson(raw.assigned_units) : []),
    // Source
    source: raw.source || raw.call_source || '',
    // Apartment from location_room
    apartment: raw.apartment || raw.location_room || '',
  };
}

function tryParseJson(s: string): any[] {
  try { const r = JSON.parse(s); return Array.isArray(r) ? r : []; } catch { return []; }
}

/**
 * App-wide dispatch voice alert hook.
 * Call once in Layout.tsx — subscribes to all dispatch-related
 * WebSocket events and fires the appropriate voice announcements.
 */
export function useDispatchVoiceAlerts(): void {
  const { subscribe } = useWebSocket();

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // ── Dispatch updates (call created, status changed, units dispatched) ──
    unsubs.push(
      subscribe('dispatch_update', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const action = data.action || msg.action;

        if (action === 'call_created' && data.call) {
          const call = normalizeCallForVoice(data.call);
          announceNewCall(call);
          announceCallAlerts(call);
        }

        if (action === 'call_status_changed' && data.call) {
          const call = normalizeCallForVoice(data.call);
          const status = data.status || call.status;
          if (status) {
            announceStatusChange(call, status);
          }
          if (status === 'dispatched') {
            announceDispatchEvent(call);
          }
        }

        if (action === 'units_dispatched') {
          const call = normalizeCallForVoice(data.call);
          announceUnitDispatched(call, data.units);
        }
      })
    );

    // ── Panic alert ──
    unsubs.push(
      subscribe('panic_alert', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        announcePanicAlert(data.user_name || data.userName || data.officerName);
      })
    );

    // ── BOLO alert ──
    unsubs.push(
      subscribe('bolo_alert', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        announceBolo(data);
      })
    );

    // ── Warrant hit from safety screening ──
    unsubs.push(
      subscribe('call:warrant_alert', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        announceWarrantHit(data);
      })
    );

    // ── Backup request ──
    unsubs.push(
      subscribe('backup_request', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        announceBackupRequest(data);
      })
    );

    // ── Pursuit update ──
    unsubs.push(
      subscribe('pursuit_update', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        announcePursuit(data);
      })
    );

    // ── All-units broadcast ──
    unsubs.push(
      subscribe('all_units', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        announceAllUnits(data.message || data.text || '');
      })
    );

    return () => {
      unsubs.forEach(fn => fn());
    };
  }, [subscribe]);
}
