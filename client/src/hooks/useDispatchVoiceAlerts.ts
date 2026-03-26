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
    const speak = (text: string, severity: 'minor' | 'moderate' | 'major') => {
      if (voiceAlert) {
        voiceAlert(text, severity);
      } else {
        speak(text, severity);
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

    return () => {
      unsubs.forEach(fn => fn());
    };
  }, [subscribe, onAlert, voiceAlert]);
}
