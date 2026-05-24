// useDispatchVoice — single subscription that maps every Spillman-parity
// WS event from the CF DispatchHub onto the existing voice + tone surface.
//
// The Worker side (src/routes/dispatch/*) now emits:
//   - dispatch_assignment       (targeted to assigned officer)
//   - call_status_for_officer   (targeted, short status form)
//   - premise_alert_for_unit    (targeted)
//   - dispatch_alert            (officer-safety flag)
//   - panic_alert               (targeted to dispatch/supervisors)
//
// This hook lives at the top of the app (mounted by AuthenticatedShell
// inside WebSocketProvider) so it runs for every signed-in client.
// Voice rules:
//   - dispatch_assignment → distinctive p1_alert/alert tone + detailed
//     announcement (unit, type, priority, address, flags). Spillman
//     pattern.
//   - call_status_for_officer → minimal chirp + short phrase
//     ("Call update", "Note added") — keeps the radio quiet.
//   - premise_alert_for_unit → caution tone + premise speak.
//   - panic_alert → panic_continuous tone + announcePanicAlert.

import { useEffect, useRef } from 'react';
import { useWebSocket } from '../context/WebSocketContext';
import { useAuth } from '../context/AuthContext';
import { playTone } from '../utils/dispatchTones';
import {
  announceDispatchEvent,
  announcePanicAlert,
  announceBackupRequest,
  getVoiceAlertsEnabled,
} from '../utils/voiceAlerts';
import { speak } from '../utils/edgeTTS';

// Short status phrases — these match what dispatchers tap to acknowledge
// over the radio. Kept terse so the voice queue doesn't drown ambient
// chatter when activity is heavy.
const SHORT_PHRASES: Record<string, string> = {
  note_added:           'Note added',
  call_updated:         'Call update',
  call_enroute:         'En route confirmed',
  call_onscene:         'On scene',
  call_cleared:         'Call clear',
  call_status_changed:  'Status update',
};

export function useDispatchVoice() {
  const { subscribe } = useWebSocket();
  const { user } = useAuth();
  // Last-fired guard — prevents a single event reaching us via two
  // subscriptions (legacy dispatcher brain + this hook) from firing
  // a tone twice in the same animation frame.
  const lastKeyRef = useRef<{ key: string; ts: number } | null>(null);

  function shouldFire(key: string): boolean {
    const now = Date.now();
    if (lastKeyRef.current && lastKeyRef.current.key === key && now - lastKeyRef.current.ts < 250) {
      return false;
    }
    lastKeyRef.current = { key, ts: now };
    return true;
  }

  useEffect(() => {
    if (!user) return;
    if (!getVoiceAlertsEnabled()) return;

    const unsubs: Array<() => void> = [];

    // ── Detailed dispatch announcement to the assigned officer ──
    unsubs.push(subscribe('dispatch_assignment', (msg: any) => {
      const data = msg.data ?? msg;
      const call = data.call ?? data;
      if (!call) return;
      const key = `dispatch_assignment:${call.id}:${data.unit_id ?? 'multi'}`;
      if (!shouldFire(key)) return;
      // Replayed messages came in from the 5-min reconnect window —
      // tone already fired live, don't fire it again.
      if (msg.replayed) return;
      playTone('p1_alert');
      // announceDispatchEvent's CallFlags type uses string fields
      // (Spillman record format). Coerce truthy server flags into
      // their canonical string so the announcement reads correctly.
      const strFlag = (v: unknown) => (v ? String(v) : '');
      void announceDispatchEvent({
        call_number: call.call_number,
        priority: call.priority,
        incident_type: call.incident_type,
        location: call.location_address,
        location_address: call.location_address,
        weapons_involved: strFlag(call.weapons_involved),
        domestic_violence: strFlag(call.domestic_violence),
        injuries_reported: strFlag(call.injuries_reported),
        mental_health_crisis: strFlag(call.mental_health_crisis),
        felony_in_progress: strFlag(call.felony_in_progress),
        officer_safety_caution: strFlag(call.officer_safety_caution),
      } as any);
    }));

    // ── Short status form — "Call update", "Note added" ──
    unsubs.push(subscribe('call_status_for_officer', (msg: any) => {
      const data = msg.data ?? msg;
      const action = String(data.action || 'call_status_changed');
      const phrase = data.short || SHORT_PHRASES[action] || 'Status update';
      const key = `call_status:${data.call_id ?? data.call?.id ?? ''}:${action}`;
      if (!shouldFire(key)) return;
      if (msg.replayed) return;
      playTone('chirp');
      void speak(phrase, 'minor');
    }));

    // ── Premise alert auto-push (officer enroute, safety info) ──
    unsubs.push(subscribe('premise_alert_for_unit', (msg: any) => {
      const data = msg.data ?? msg;
      const key = `premise:${data.call_id ?? ''}:${data.alert_id ?? ''}`;
      if (!shouldFire(key)) return;
      if (msg.replayed) return;
      playTone('caution');
      const warnings = Array.isArray(data.warnings) ? data.warnings : [];
      const labels = warnings.slice(0, 3).map((w: any) => w.label).filter(Boolean).join('. ');
      void speak(`Premise alert. ${labels || 'Check call details.'}`, 'major');
    }));

    // ── Officer-safety flag (separate channel from premise) ──
    unsubs.push(subscribe('dispatch_alert', (msg: any) => {
      const data = msg.data ?? msg;
      const key = `os_flag:${data.call_id ?? ''}`;
      if (!shouldFire(key)) return;
      if (msg.replayed) return;
      playTone('warning');
      const warnings = Array.isArray(data.warnings) ? data.warnings : [];
      const labels = warnings.slice(0, 3).map((w: any) => w.label).filter(Boolean).join('. ');
      void speak(`Officer safety. ${labels || 'Check call details.'}`, 'major');
    }));

    // ── Panic / welfare emergency — distinct continuous tone ──
    const panicHandler = (msg: any) => {
      const data = msg.data ?? msg;
      const panic = data.panic ?? data;
      const action = data.action ?? panic.action;
      // Only fire tone for activations / escalations — not for
      // acknowledgements / resolutions which are good news.
      if (['panic_acknowledged', 'panic_resolved', 'panic_cancelled', 'panic_false_alarm'].includes(action)) {
        playTone('chirp');
        return;
      }
      const key = `panic:${panic.id ?? data.user_id ?? ''}:${action ?? 'active'}`;
      if (!shouldFire(key)) return;
      if (msg.replayed) return;
      playTone('panic_continuous');
      void announcePanicAlert(
        panic.user_name || data.officer_name,
        panic.location_address,
        panic.call_sign || data.call_sign,
      );
    };
    unsubs.push(subscribe('panic_alert', panicHandler));
    unsubs.push(subscribe('welfare_emergency', panicHandler));

    // ── Backup requests — different tone, different cadence ──
    unsubs.push(subscribe('dispatch_update', (msg: any) => {
      const data = msg.data ?? msg;
      if (data.action !== 'backup_requested') return;
      const key = `backup:${data.call_id ?? ''}`;
      if (!shouldFire(key)) return;
      if (msg.replayed) return;
      playTone('alarm');
      void announceBackupRequest({
        officer_name: data.officer_name,
        location: data.location_address,
        call_number: data.call_number,
      });
    }));

    return () => { for (const u of unsubs) u(); };
  }, [subscribe, user]);
}
