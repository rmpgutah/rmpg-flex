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
import { classifySeverity } from '../utils/alertSeverity';
import { announceWithSeverity, isEdgeTTSEnabled } from '../utils/edgeTTS';
import {
  composeDispatchNarrative,
  composePanicNarrative,
  composeBoloNarrative,
  composeBackupNarrative,
  composePursuitNarrative,
} from '../utils/narrativeComposer';
import type { AlertBannerItem } from '../components/DispatchAlertBanner';

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
    sector_name: raw.sector_name || '',
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

// ── Unique alert ID generator ──
let alertIdCounter = 0;
function nextAlertId(): string { return `alert-${Date.now()}-${++alertIdCounter}`; }

/**
 * App-wide dispatch voice alert hook.
 * Call once in Layout.tsx — subscribes to all dispatch-related
 * WebSocket events and fires the appropriate voice announcements.
 *
 * When `onAlert` is provided, each event also pushes a visual
 * AlertBannerItem for the DispatchAlertBanner overlay.
 */
export function useDispatchVoiceAlerts(options?: {
  onAlert?: (alert: AlertBannerItem) => void;
  voiceAlert?: (narrative: string, severity: 'minor' | 'moderate' | 'major') => void;
}): void {
  const { subscribe } = useWebSocket();
  const onAlert = options?.onAlert;
  const voiceAlert = options?.voiceAlert;

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // Route TTS through voice channel when active, otherwise direct
    type AlertSeverity = 'minor' | 'moderate' | 'major';
    const speak = (text: string, severity: AlertSeverity) => {
      if (voiceAlert) {
        voiceAlert(text, severity);
      } else {
        announceWithSeverity(text, severity);
      }
    };

    // ── Dispatch updates (call created, status changed, units dispatched) ──
    unsubs.push(
      subscribe('dispatch_update', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const action = data.action || msg.action;

        if (action === 'call_created' && data.call) {
          const call = normalizeCallForVoice(data.call);
          const { severity } = classifySeverity('call_created', call);
          if (isEdgeTTSEnabled()) {
            const text = composeDispatchNarrative(call, undefined, {
              threatContext: data.threatContext || undefined,
              nearestUnits: data.nearestUnits || undefined,
            });
            speak(text, severity);
          } else {
            announceNewCall(call);
            announceCallAlerts(call);
          }
          onAlert?.({ id: nextAlertId(), severity, title: 'New Call', message: call.description || call.narrative || call.call_type || '', timestamp: Date.now() });
        }

        if (action === 'call_status_changed' && data.call) {
          const call = normalizeCallForVoice(data.call);
          const status = data.status || call.status;
          if (status && !isEdgeTTSEnabled()) {
            announceStatusChange(call, status);
          }
          if (status === 'dispatched') {
            const { severity } = classifySeverity('call_dispatched', call);
            if (isEdgeTTSEnabled()) {
              const text = composeDispatchNarrative(call);
              speak(text, severity);
            } else {
              announceDispatchEvent(call);
            }
            onAlert?.({ id: nextAlertId(), severity, title: 'Dispatched', message: `${call.assigned_units?.join(', ') || 'Unit'} — ${call.call_type || call.nature || ''} at ${call.location || ''}`, timestamp: Date.now() });
          }
        }

        if (action === 'units_dispatched') {
          const call = normalizeCallForVoice(data.call);
          if (!isEdgeTTSEnabled()) {
            announceUnitDispatched(call, data.units);
          }
        }

        if (action === 'ai_analysis' && data.analysis?.safetyBriefing && data.analysis.confidence > 0.7) {
          const severity = data.analysis.severityOverride || 'moderate';
          speak(
            `AI safety alert, call ${data.call_number}: ${data.analysis.safetyBriefing}`,
            severity
          );
          onAlert?.({
            id: nextAlertId(),
            severity,
            title: 'AI SAFETY ALERT',
            message: data.analysis.safetyBriefing,
            timestamp: Date.now(),
          });
        }

        if (action === 'arrest_created' && data.arrest) {
          const a = data.arrest;
          speak(`Arrest booked. ${a.subject_name || 'Subject'}, ${a.charge || 'charge pending'}.`, 'minor');
        }

        if (action === 'citation_issued' && data.citation) {
          const c = data.citation;
          speak(`Citation issued. ${c.subject_name || 'Subject'}, ${c.violation || ''}.`, 'minor');
        }
      })
    );

    // ── Panic alert ──
    unsubs.push(
      subscribe('panic_alert', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const officerName = data.user_name || data.userName || data.officerName || 'Unknown officer';
        if (isEdgeTTSEnabled()) {
          const loc = data.location || data.gps_address || '';
          const cs = data.call_sign || data.unit || '';
          speak(composePanicNarrative(officerName, loc, cs), 'major');
        } else {
          announcePanicAlert(officerName);
        }
        onAlert?.({ id: nextAlertId(), severity: 'major', title: 'PANIC', message: officerName, timestamp: Date.now() });
      })
    );

    // ── BOLO alert ──
    unsubs.push(
      subscribe('bolo_alert', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const boloTitle = data.title || data.subject || 'Alert';
        if (isEdgeTTSEnabled()) {
          speak(composeBoloNarrative({
            type: boloTitle,
            description: data.description || data.details || '',
            vehicle_description: data.vehicle_description || data.vehicle || '',
            suspect_description: data.suspect_description || '',
            last_seen_location: data.last_seen_location || '',
            direction_of_travel: data.direction_of_travel || '',
          }), 'moderate');
        } else {
          announceBolo(boloTitle, data.priority);
        }
        onAlert?.({ id: nextAlertId(), severity: 'moderate', title: 'BOLO', message: boloTitle, timestamp: Date.now() });
      })
    );

    // ── Warrant hit from safety screening ──
    unsubs.push(
      subscribe('call:warrant_alert', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const subjectName = data.subject_name || data.name || 'Unknown subject';
        if (isEdgeTTSEnabled()) {
          speak(`Warrant hit on ${subjectName}`, 'moderate');
        } else {
          announceWarrantHit(subjectName);
        }
        onAlert?.({ id: nextAlertId(), severity: 'moderate', title: 'WARRANT HIT', message: subjectName, timestamp: Date.now() });
      })
    );

    // ── Backup request ──
    unsubs.push(
      subscribe('backup_request', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const unit = data.call_sign || data.unit || 'Unknown unit';
        const loc = data.location || 'unknown location';
        if (isEdgeTTSEnabled()) {
          speak(composeBackupNarrative(unit, loc, data.call_number), 'moderate');
        } else {
          announceBackupRequest({ officer_name: unit, location: loc });
        }
        onAlert?.({ id: nextAlertId(), severity: 'moderate', title: 'BACKUP', message: `${unit} — ${loc}`, timestamp: Date.now() });
      })
    );

    // ── Pursuit update ──
    unsubs.push(
      subscribe('pursuit_update', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const unit = data.call_sign || data.unit || 'Unknown unit';
        const direction = data.direction || '';
        if (isEdgeTTSEnabled()) {
          speak(composePursuitNarrative({
            unit,
            direction,
            location: data.location || '',
            speed: data.speed || '',
            vehicle_description: data.vehicle_description || '',
          }), 'major');
        } else {
          announcePursuit({ officer_name: unit, direction });
        }
        onAlert?.({ id: nextAlertId(), severity: 'major', title: 'PURSUIT', message: `${unit}${direction ? ` — ${direction}` : ''}`, timestamp: Date.now() });
      })
    );

    // ── All-units broadcast ──
    unsubs.push(
      subscribe('all_units', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const allUnitsMsg = data.message || data.text || '';
        if (isEdgeTTSEnabled()) {
          speak(`All units: ${allUnitsMsg}`, 'moderate');
        } else {
          announceAllUnits(allUnitsMsg);
        }
      })
    );

    // ── Welfare check (directed at this officer) ──
    unsubs.push(
      subscribe('welfare_check', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const text = data.message || 'Status check. Are you code 4?';
        if (voiceAlert) {
          voiceAlert(text, 'moderate');
        } else {
          announceWithSeverity(text, 'moderate');
        }
        onAlert?.({ id: nextAlertId(), severity: 'moderate', title: 'WELFARE CHECK', message: text, timestamp: Date.now() });
      })
    );

    // ── Welfare emergency (all units) ──
    unsubs.push(
      subscribe('welfare_emergency', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const text = data.message || 'Welfare emergency. All units respond.';
        if (voiceAlert) {
          voiceAlert(text, 'major');
        } else {
          announceWithSeverity(text, 'major');
        }
        onAlert?.({ id: nextAlertId(), severity: 'major', title: 'WELFARE EMERGENCY', message: text, timestamp: Date.now() });
      })
    );

    // ── Welfare alert (supervisor notification) ──
    unsubs.push(
      subscribe('welfare_alert', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const text = data.message || 'Officer welfare alert.';
        if (voiceAlert) {
          voiceAlert(text, 'moderate');
        } else {
          announceWithSeverity(text, 'moderate');
        }
        onAlert?.({ id: nextAlertId(), severity: 'moderate', title: 'WELFARE ALERT', message: text, timestamp: Date.now() });
      })
    );

    // ── Warrant scanner hits ──
    unsubs.push(
      subscribe('warrant', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        // Only voice auto-detected warrant hits, not manual warrant CRUD
        if (data.auto_detected || data.scanner_hit) {
          const subject = data.subject_name || data.name || 'Unknown subject';
          const charge = data.charge_description || data.offense || 'Unknown charge';
          const warrantType = data.warrant_type || 'unknown';
          const bail = data.bail_amount ? `, bail $${Number(data.bail_amount).toLocaleString()}` : '';
          const text = `Warrant hit. ${warrantType} warrant on ${subject}. ${charge}${bail}.`;
          const sev: AlertSeverity = warrantType === 'felony' ? 'major' : 'moderate';
          speak(text, sev);
          onAlert?.({ id: nextAlertId(), severity: sev, title: 'WARRANT HIT', message: `${subject} — ${charge}`, timestamp: Date.now() });
        }
      })
    );

    unsubs.push(
      subscribe('warrants_updated', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        if (data.action === 'warrant_served') {
          speak(`Warrant served on ${data.subject_name || 'subject'}.`, 'minor');
        }
      })
    );

    // ── Map safety alerts ──
    unsubs.push(
      subscribe('safety:broadcast', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const alertType = data.alert_type || data.type || 'Safety alert';
        const location = data.location || data.address || 'unknown location';
        const unit = data.call_sign || data.unit || '';
        const text = `Safety alert. ${alertType.replace(/_/g, ' ').toUpperCase()}${unit ? ` reported by ${unit}` : ''} at ${location}.`;
        const sev: AlertSeverity = ['officer_down', 'active_shooter', 'shots_fired'].includes(alertType) ? 'major' : 'moderate';
        speak(text, sev);
        onAlert?.({ id: nextAlertId(), severity: sev, title: 'SAFETY ALERT', message: `${alertType} — ${location}`, timestamp: Date.now() });
      })
    );

    // ── Integration health alerts ──
    unsubs.push(
      subscribe('integration_health_alert', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const system = data.system || data.name || 'Unknown system';
        const status = data.status || 'offline';
        if (status === 'offline' || status === 'error' || status === 'degraded') {
          const text = `System alert. ${system} is ${status}. Proceed with caution.`;
          speak(text, 'moderate');
          onAlert?.({ id: nextAlertId(), severity: 'moderate', title: 'SYSTEM ALERT', message: `${system} ${status}`, timestamp: Date.now() });
        }
      })
    );

    // ── Trespass order violations ──
    unsubs.push(
      subscribe('trespass_order_violated', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const subject = data.subject_name || 'Unknown subject';
        const property = data.property_name || data.property_address || 'unknown property';
        const arrest = data.arrest_authority ? ' Arrest authority granted.' : '';
        const text = `Trespass violation. ${subject} at ${property}.${arrest}`;
        speak(text, 'moderate');
        onAlert?.({ id: nextAlertId(), severity: 'moderate', title: 'TRESPASS VIOLATION', message: `${subject} — ${property}`, timestamp: Date.now() });
      })
    );

    // ── Dispatch broadcast messages ──
    unsubs.push(
      subscribe('dispatch_broadcast', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const message = data.message || data.text || '';
        const from = data.from_name || data.dispatcher || 'Dispatch';
        if (message) {
          const text = `${from}: ${message}`;
          speak(text, 'minor');
        }
      })
    );

    // ── Emergency messages ──
    unsubs.push(
      subscribe('emergency_message', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const message = data.message || data.text || data.content || '';
        const from = data.sender_name || data.from || 'Unknown';
        const text = `Emergency message from ${from}. ${message}`;
        speak(text, 'major');
        onAlert?.({ id: nextAlertId(), severity: 'major', title: 'EMERGENCY MSG', message: `${from}: ${message.slice(0, 50)}`, timestamp: Date.now() });
      })
    );

    // ── New messages (high priority only) ──
    unsubs.push(
      subscribe('new_message', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        if (data.priority === 'high' || data.priority === 'emergency' || data.channel === 'dispatch') {
          const from = data.sender_name || data.from || 'Unknown';
          const preview = (data.content || data.text || '').slice(0, 80);
          const text = `Message from ${from}. ${preview}`;
          speak(text, data.priority === 'emergency' ? 'major' : 'moderate');
        }
      })
    );

    // ── Serve manager attempts ──
    unsubs.push(
      subscribe('serve:attempt', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const status = data.result || data.status || 'attempted';
        const subject = data.subject_name || data.respondent || 'subject';
        if (status === 'served') {
          speak(`Service completed. ${subject} has been served.`, 'minor');
        } else if (status === 'failed' || status === 'unable') {
          speak(`Service attempt failed for ${subject}. ${data.reason || ''}`, 'minor');
        }
      })
    );

    // ── Radio cross-integration (selcall pages) ──
    unsubs.push(
      subscribe('radio_transmit_start', (_msg) => {
        // Don't announce — just track that radio is active
        // The voice channel can check this to avoid mic conflicts
      })
    );

    unsubs.push(
      subscribe('selcall_page', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const from = data.from_full_name || data.from_call_sign || 'Unknown';
        const message = data.message || '';
        const text = `Selcall page from ${from}. ${message}`;
        speak(text, 'moderate');
      })
    );

    // ── Email notifications (urgent only) ──
    unsubs.push(
      subscribe('email:new_messages', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const count = data.newCount || data.count || 0;
        if (count > 0 && data.has_urgent) {
          speak(`${count} new email${count > 1 ? 's' : ''}, including urgent messages.`, 'minor');
        }
      })
    );

    // ── Security events ──
    unsubs.push(
      subscribe('security:updated', (msg) => {
        const data = (msg.data || msg.payload || msg) as any;
        const action = data.action || data.entity || 'Security event';
        if (['device_removed', 'sessions_terminated', 'ip_blocked'].includes(action)) {
          speak(`Security alert. ${action.replace(/_/g, ' ').toUpperCase()}.`, 'moderate');
          onAlert?.({ id: nextAlertId(), severity: 'moderate', title: 'SECURITY', message: action.replace(/_/g, ' ').toUpperCase(), timestamp: Date.now() });
        }
      })
    );

    return () => {
      unsubs.forEach(fn => fn());
    };
  }, [subscribe, onAlert, voiceAlert]);
}
