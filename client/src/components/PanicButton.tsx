import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, X, MapPin, Mic, MicOff } from 'lucide-react';
import { useWebSocket } from '../context/WebSocketContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import { usePanicAudio } from '../hooks/usePanicAudio';
import { useToast } from './ToastProvider';
import ConfirmDialog from './ConfirmDialog';
import { safeTimeStr } from '../utils/dateUtils';
import { playTone } from '../utils/dispatchTones';

// ─── Panic Alarm — continuous until acknowledged (Spillman) ──────
// Authentic Spillman Flex: the console alarm sounds CONTINUOUSLY
// until a dispatcher acknowledges — it never times out on its own.
// Loops the user-remappable Emergency/Panic tone slot from the
// unified dispatchTones system (default: APX emergency warble;
// Settings can map it to the sampled panic_continuous asset).
// ─────────────────────────────────────────────────────────────────
function playPanicAlarm(): { stop: () => void } {
  let stopped = false;
  let current: { stop: () => void } | null = playTone('alarm');
  // 3s cycle covers the longest mappable tone (panic_continuous, 2.4s)
  // without overlapping copies.
  const timer = setInterval(() => {
    if (stopped) return;
    current?.stop();
    current = playTone('alarm');
  }, 3000);
  return {
    stop: () => { if (!stopped) { stopped = true; clearInterval(timer); current?.stop(); } },
  };
}

interface PanicAlert {
  panic_id?: number;
  user_id?: number;
  user_name: string;
  badge_number?: string;
  role: string;
  message?: string;
  latitude?: number;
  longitude?: number;
  triggered_at: string;
  call_number?: string;
  call_id?: string | number;
  location_address?: string;
  unit_call_sign?: string;
  acknowledged_by?: string;
  acknowledged_at?: string;
  escalation_level?: number;
}

// Roles that can mark false alarm
const SUPERVISOR_ROLES = ['admin', 'manager', 'supervisor'];

// ─── Platform detection ─────────────────────────────────────
const isCapacitor = typeof (window as any).Capacitor !== 'undefined';
const isAndroid = isCapacitor && (window as any).Capacitor?.getPlatform?.() === 'android';
const isElectron = !!(window as any).electron?.isElectron;

interface PanicButtonProps {
  latitude?: number | null;
  longitude?: number | null;
}

export default function PanicButton({ latitude, longitude }: PanicButtonProps) {
  const { user } = useAuth();
  const { subscribe } = useWebSocket();
  const panicAudio = usePanicAudio();
  const { addToast } = useToast();
  const [sending, setSending] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [incomingAlert, setIncomingAlert] = useState<PanicAlert | null>(null);
  const [ownPanicId, setOwnPanicId] = useState<number | null>(null);
  const [ownPanicTime, setOwnPanicTime] = useState<number | null>(null);
  const [forceDeactivateOpen, setForceDeactivateOpen] = useState(false);
  const [notesKind, setNotesKind] = useState<'false-alarm' | 'code4' | null>(null);
  const [notesText, setNotesText] = useState('');
  const alarmRef = useRef<{ stop: () => void } | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Hardware Button Panic Trigger ────────────────────────────
  // Supports multiple activation methods:
  // 1. Volume Up held for 3 seconds
  // 2. Volume Up pressed 4 times rapidly (within 2 seconds)
  // Works on Android (Capacitor) and desktop (Electron)
  const volumeUpPressTimesRef = useRef<number[]>([]);
  const volumeUpHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeUpHeldRef = useRef(false);
  // Panic id currently shown on this console — guards against AlertHubDO's
  // 15s redelivery restarting the alarm/voice room for an alert already up.
  const displayedPanicIdRef = useRef<number | string | null>(null);
  const sendingRef = useRef(false); // synchronous guard — React state is async and races

  const triggerHardwarePanic = useCallback(async () => {
    // Synchronous ref guard prevents double-fire from hold + rapid press race
    if (sendingRef.current || sending) return;
    sendingRef.current = true;
    // Clear both trigger mechanisms so only one fires
    if (volumeUpHoldTimerRef.current) {
      clearTimeout(volumeUpHoldTimerRef.current);
      volumeUpHoldTimerRef.current = null;
    }
    volumeUpPressTimesRef.current = [];
    volumeUpHeldRef.current = false;
    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);

    // Directly trigger panic (no confirmation needed for hardware trigger)
    setSending(true);
    try {
      const result = await apiFetch<{ id?: number }>('/dispatch/panic', {
        method: 'POST',
        body: JSON.stringify({
          latitude: latitude ?? null,
          longitude: longitude ?? null,
          trigger_method: 'hardware_button',
        }),
      });
      if (result?.id) {
        setOwnPanicId(result.id);
        setOwnPanicTime(Date.now());
      }
      // Start live mic broadcast for 60 seconds
      panicAudio.startBroadcast(result?.id);
    } catch (err) {
      console.error('Failed to send hardware panic alert:', err);
      addToast('PANIC ALERT FAILED -- Retry or radio dispatch!', 'error', 15000);
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, [sending, latitude, longitude, panicAudio, addToast]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Volume Up = "AudioVolumeUp" on Android WebView, also catch "VolumeUp"
      if (e.key === 'AudioVolumeUp' || e.key === 'VolumeUp' || e.code === 'AudioVolumeUp') {
        // Prevent default volume change in the app
        e.preventDefault();

        // Skip repeated keydown events (key held down fires keydown repeatedly)
        if (e.repeat) return;

        // Already sending — ignore further triggers
        if (sendingRef.current) return;

        // Method 1: Long press (3 seconds)
        if (!volumeUpHeldRef.current) {
          volumeUpHeldRef.current = true;
          volumeUpHoldTimerRef.current = setTimeout(() => {
            triggerHardwarePanic();
            volumeUpHeldRef.current = false;
          }, 3000);
        }

        // Method 2: Rapid presses (4 within 2 seconds)
        const now = Date.now();
        volumeUpPressTimesRef.current.push(now);
        // Keep only presses within last 2 seconds
        volumeUpPressTimesRef.current = volumeUpPressTimesRef.current.filter(
          t => now - t < 2000
        );
        if (volumeUpPressTimesRef.current.length >= 4) {
          volumeUpPressTimesRef.current = [];
          triggerHardwarePanic();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'AudioVolumeUp' || e.key === 'VolumeUp' || e.code === 'AudioVolumeUp') {
        // Cancel hold timer if released before 3 seconds
        if (volumeUpHoldTimerRef.current) {
          clearTimeout(volumeUpHoldTimerRef.current);
          volumeUpHoldTimerRef.current = null;
        }
        volumeUpHeldRef.current = false;
      }
    };

    // Hardware-button panic trigger is **Android-only**. On desktop
    // (Electron / Windows / Mac) any `AudioVolumeUp` keydown event —
    // from a laptop volume key, a USB headset volume control, a radio
    // PTT keycode, an external keypad media key, or even a stuck key —
    // would race the 3s long-press timer and fire a phantom panic.
    // Phantom alarms desensitize officers and waste responder time, so
    // on desktop the panic button MUST be triggered manually only.
    if (isAndroid) {
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('keyup', handleKeyUp);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      if (volumeUpHoldTimerRef.current) {
        clearTimeout(volumeUpHoldTimerRef.current);
      }
    };
  }, [triggerHardwarePanic]);

  // Listen for incoming panic alerts and their lifecycle updates.
  //
  // PANIC-1: the server (AlertHubDO via emitAlert) fans EVERY panic lifecycle
  // event out as a single message type — `panic_alert` — discriminated by an
  // `action` field (panic_activated / panic_acknowledged / panic_resolved /
  // panic_cancelled / panic_false_alarm / panic_escalated), mirroring how
  // dispatch_update carries an action. The old code subscribed to bespoke
  // top-level types ('panic_resolved', …) that the server NEVER sends, so
  // alarms never auto-cleared fleet-wide on ack/resolve/cancel. Consolidate
  // into ONE subscription that branches on msg.action.
  useEffect(() => {
    // Clear local alarm + overlay + voice room. Used by every terminal action.
    const dismissLocal = () => {
      setIncomingAlert(null);
      alarmRef.current?.stop();
      alarmRef.current = null;
      panicAudio.stopListening?.();
      setOwnPanicId(null);
      setOwnPanicTime(null);
      displayedPanicIdRef.current = null;
    };

    const unsub = subscribe('panic_alert', (msg: any) => {
      // Broadcast frame: { type:'panic_alert', action, panic:{…full row…} }.
      // Tolerate flatter/legacy shapes too (data/payload wrappers, fields
      // hoisted to the top level).
      const env = msg.data || msg.payload || msg;
      const panic = env.panic || env;                       // the panic_alerts row
      const action: string = msg.action || env.action || 'panic_activated';
      const panicId = panic?.id ?? env.panic_id ?? env.id;

      switch (action) {
        case 'panic_acknowledged':
          // Ack silences the alarm but keeps the unit emergent — update the
          // overlay to show who acknowledged, stop the audible alarm.
          setIncomingAlert(prev => prev ? {
            ...prev,
            acknowledged_by: panic?.acknowledged_by || panic?.user_name || env.user_name,
            acknowledged_at: panic?.acknowledged_at || new Date().toISOString(),
          } : prev);
          alarmRef.current?.stop();
          alarmRef.current = null;
          break;

        case 'panic_resolved':
          dismissLocal();
          addToast('Panic alert resolved', 'success', 5000);
          break;

        case 'panic_cancelled':
          dismissLocal();
          break;

        case 'panic_false_alarm':
          dismissLocal();
          addToast('Panic marked as false alarm', 'info', 5000);
          break;

        case 'panic_escalated':
          setIncomingAlert(prev => prev ? {
            ...prev,
            escalation_level: panic?.escalation_level ?? env.escalation_level,
          } : prev);
          break;

        case 'panic_activated':
        default: {
          // New alarm. Don't show your own panic back to yourself.
          const senderId = panic?.user_id ?? panic?.officer_id ?? env.user_id;
          if (senderId && user?.id && String(senderId) === String(user.id)) return;
          // AlertHubDO re-delivers an unacked panic every 15s (and replays on
          // reconnect). The overlay + continuous alarm are already running for
          // this panic — don't restart the alarm or reset the voice room on a
          // redelivery of the same id.
          if (panicId != null && displayedPanicIdRef.current === panicId && alarmRef.current) break;
          displayedPanicIdRef.current = panicId ?? null;
          // Normalize to the PanicAlert overlay shape (panic row + panic_id).
          setIncomingAlert({ ...panic, panic_id: panicId } as PanicAlert);
          // Set the sender's user ID so the "Respond" talk-back button works.
          if (senderId) panicAudio.setSenderUserId?.(Number(senderId));
          // Open the panic voice room to hear the officer's distress audio live.
          if (panicId != null) panicAudio.listen?.(Number(panicId));
          // Audible alarm — Spillman: continuous until acknowledged, and the
          // overlay NEVER auto-dismisses while unacknowledged. An officer
          // emergency must not silently disappear from a console.
          alarmRef.current?.stop();
          alarmRef.current = playPanicAlarm();
          break;
        }
      }
    });

    return () => unsub();
  }, [subscribe, user?.id, panicAudio, addToast]);

  // Server-side acknowledge — sends POST to /dispatch/panic/:id/acknowledge
  const acknowledgeAlert = useCallback(async () => {
    const panicId = incomingAlert?.panic_id;
    if (panicId) {
      try {
        await apiFetch(`/dispatch/panic/${panicId}/acknowledge`, { method: 'POST' });
      } catch (err) {
        console.error('Failed to acknowledge panic:', err);
      }
    }
    // Always dismiss locally even if server call fails
    setIncomingAlert(null);
    alarmRef.current?.stop();
    alarmRef.current = null;
    panicAudio.stopListening?.();
  }, [incomingAlert?.panic_id, panicAudio]);

  // Cancel own panic (within 30 seconds)
  const cancelOwnPanic = useCallback(async () => {
    if (!ownPanicId) return;
    try {
      await apiFetch(`/dispatch/panic/${ownPanicId}/cancel`, { method: 'POST' });
      setOwnPanicId(null);
      setOwnPanicTime(null);
      addToast('Panic alert cancelled', 'info', 5000);
    } catch (err) {
      console.error('Failed to cancel panic:', err);
      addToast('Failed to cancel panic alert', 'error', 5000);
    }
  }, [ownPanicId, addToast]);

  // False alarm (supervisor+ only)
  const markFalseAlarm = useCallback(() => {
    if (!incomingAlert?.panic_id) return;
    setNotesText('');
    setNotesKind('false-alarm');
  }, [incomingAlert?.panic_id]);

  // Code 4 — resolve (supervisor+). Spillman: after acknowledging, the
  // dispatcher explicitly clears the emergency once the officer is code 4;
  // this is the normal terminal transition (false-alarm is the exception
  // path). Clears the alert row + the unit's EMERGENCY overlay fleet-wide.
  const resolveCode4 = useCallback(() => {
    if (!incomingAlert?.panic_id) return;
    setNotesText('');
    setNotesKind('code4');
  }, [incomingAlert?.panic_id]);

  // Admin fallback — force-deactivate sweeps ALL panic state server-side
  // (alert row, unit EMERGENCY overlay, P1 CAD call, AlertHubDO nag), even
  // when the normal resolve/cancel transitions are stuck or already ran.
  const forceDeactivate = useCallback(async () => {
    const panicId = incomingAlert?.panic_id;
    if (!panicId) return;
    try {
      await apiFetch(`/dispatch/panic/${panicId}/deactivate`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'Deactivated from panic overlay' }),
      });
      setIncomingAlert(null);
      alarmRef.current?.stop();
      alarmRef.current = null;
      addToast('Panic force-deactivated', 'success', 5000);
    } catch (err) {
      console.error('Failed to force-deactivate panic:', err);
      addToast('Failed to force-deactivate panic', 'error', 5000);
    }
  }, [incomingAlert?.panic_id, addToast]);

  const submitPanicNotes = useCallback(async () => {
    const panicId = incomingAlert?.panic_id;
    if (!panicId || !notesKind) return;
    const kind = notesKind;
    const notes = notesText.trim();
    setNotesKind(null);
    try {
      if (kind === 'false-alarm') {
        await apiFetch(`/dispatch/panic/${panicId}/false-alarm`, {
          method: 'POST',
          body: JSON.stringify({ notes: notes || 'No notes provided' }),
        });
      } else {
        await apiFetch(`/dispatch/panic/${panicId}/resolve`, {
          method: 'POST',
          body: JSON.stringify({ notes: notes || 'Code 4 — emergency resolved' }),
        });
      }
      setIncomingAlert(null);
      alarmRef.current?.stop();
      alarmRef.current = null;
    } catch (err) {
      console.error(kind === 'false-alarm' ? 'Failed to mark false alarm:' : 'Failed to resolve panic:', err);
      addToast(kind === 'false-alarm' ? 'Failed to mark false alarm' : 'Failed to resolve panic', 'error', 5000);
    }
  }, [incomingAlert?.panic_id, notesKind, notesText, addToast]);

  // Check if current user can cancel (own panic within 30s)
  const canCancel = ownPanicId && ownPanicTime && (Date.now() - ownPanicTime < 30000);

  // Check if current user is supervisor+
  const isSupervisor = user?.role && SUPERVISOR_ROLES.includes(user.role);
  // Admin/manager only — gates the force-deactivate fallback (server enforces too)
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  const handlePanicClick = () => {
    setConfirmVisible(true);
    // Auto-cancel confirmation after 5 seconds
    confirmTimerRef.current = setTimeout(() => {
      setConfirmVisible(false);
    }, 5000);
  };

  const handleConfirm = async () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmVisible(false);
    setSending(true);

    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);

    try {
      const result = await apiFetch<{ id?: number }>('/dispatch/panic', {
        method: 'POST',
        body: JSON.stringify({
          latitude: latitude ?? null,
          longitude: longitude ?? null,
        }),
      });
      if (result?.id) {
        setOwnPanicId(result.id);
        setOwnPanicTime(Date.now());
      }
      // Start live mic broadcast for 60 seconds
      panicAudio.startBroadcast(result?.id);
    } catch (err) {
      console.error('Failed to send panic alert:', err);
      addToast('PANIC ALERT FAILED -- Retry or radio dispatch!', 'error', 15000);
    } finally {
      setSending(false);
    }
  };

  const handleCancel = () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmVisible(false);
  };

  return (
    <>
      {/* PANIC Button */}
      <div className="relative">
        {confirmVisible ? (
          <div className="flex items-center gap-1">
            <button type="button"
              onClick={handleConfirm}
              className="panic-btn-confirm animate-emergency-blink"
              title="CONFIRM — Send emergency alert NOW"
            >
              <AlertTriangle style={{ width: 11, height: 11 }} />
              CONFIRM
            </button>
            <button type="button"
              onClick={handleCancel}
              className="px-2 py-1 text-[9px] font-bold uppercase"
              style={{ background: 'var(--border-subtle)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button type="button"
              onClick={handlePanicClick}
              disabled={sending || panicAudio.isBroadcasting}
              className="panic-btn"
              title="PANIC -- Send emergency alert to all dispatch and users"
            >
              {panicAudio.isBroadcasting ? (
                <>
                  <Mic style={{ width: 12, height: 12 }} className="animate-emergency-blink" />
                  <span>LIVE {panicAudio.broadcastTimeLeft}s</span>
                </>
              ) : (
                <>
                  <AlertTriangle style={{ width: 12, height: 12 }} />
                  <span>{sending ? 'SENDING...' : 'PANIC'}</span>
                </>
              )}
            </button>
            {canCancel && (
              <button type="button"
                onClick={cancelOwnPanic}
                className="px-2 py-1 text-[9px] font-bold uppercase"
                style={{ background: 'var(--surface-raised)', border: '1px solid var(--sev-warn)', color: 'var(--sev-warn)' }}
                title="Cancel your panic alert"
              >
                CANCEL
              </button>
            )}
          </div>
        )}
      </div>

      {/* Incoming Panic Alert Overlay */}
      {incomingAlert && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center max-h-screen panic-overlay" role="alertdialog" aria-modal="true" aria-label="Incoming panic alert">
          <div className="absolute inset-0 bg-black/70 animate-emergency-blink" style={{ animationDuration: '0.5s' }} />
          <div
            className="relative max-w-md w-full mx-4 panic-alert-card"
            onClick={e => e.stopPropagation()}
          >
            {/* Pulsing border */}
            <div className="absolute inset-0 animate-emergency-pulse" style={{ border: '3px solid var(--sev-critical)', pointerEvents: 'none' }} />

            {/* Header */}
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ background: 'linear-gradient(180deg, rgba(var(--sev-critical-rgb) / 0.8), rgba(var(--sev-critical-rgb) / 0.6))' }}
            >
              <AlertTriangle className="animate-emergency-blink" style={{ width: 20, height: 20, color: 'var(--text-primary)' }} />
              <span className="text-sm font-bold uppercase tracking-widest text-rmpg-100">
                Emergency Panic Alert
              </span>
              <button type="button"
                onClick={acknowledgeAlert}
                className="ml-auto p-1 hover:bg-red-800/50 transition-colors"
              >
                <X style={{ width: 14, height: 14, color: 'var(--text-primary)' }} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-3" style={{ background: 'var(--surface-overlay)', borderTop: '2px solid var(--sev-critical)' }}>
              <div className="text-center">
                <div className="text-lg font-bold text-red-400 animate-emergency-blink">
                  {incomingAlert.user_name}
                </div>
                <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  {incomingAlert.badge_number && `Badge: ${incomingAlert.badge_number} | `}
                  {(incomingAlert.role || '').toUpperCase()}
                  {incomingAlert.unit_call_sign && ` | Unit: ${incomingAlert.unit_call_sign}`}
                </div>
              </div>

              {/* Auto-created dispatch card info */}
              {incomingAlert.call_number && (
                <div className="text-center p-2" style={{ background: 'var(--surface-overlay)', border: '1px solid var(--sev-critical)' }}>
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <span
                      className="px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider animate-emergency-blink"
                      style={{ background: 'var(--sev-critical)', color: 'var(--text-primary)', letterSpacing: '1.5px' }}
                    >
                      P1
                    </span>
                    <span className="text-xs font-bold text-rmpg-100 font-mono">
                      {incomingAlert.call_number}
                    </span>
                    <span
                      className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider"
                      style={{ background: 'rgba(var(--sev-ok-rgb) / 0.2)', color: 'var(--sev-ok)', letterSpacing: '1px' }}
                    >
                      DISPATCHED
                    </span>
                  </div>
                  <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wide">
                    Officer Assist — Panic Alarm
                  </div>
                </div>
              )}

              {incomingAlert.message && (
                <div className="text-xs text-center text-rmpg-100 p-2" style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-default)' }}>
                  {incomingAlert.message}
                </div>
              )}

              {/* Reverse-geocoded address */}
              {incomingAlert.location_address && (
                <div className="text-center text-[10px] font-mono text-rmpg-100 p-1.5" style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-default)' }}>
                  <MapPin style={{ width: 9, height: 9, display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                  {incomingAlert.location_address}
                </div>
              )}

              {/* Raw GPS coordinates */}
              {(incomingAlert.latitude != null && incomingAlert.longitude != null) && (
                <div className="flex items-center justify-center gap-1 text-[10px] font-mono text-fg-muted">
                  <MapPin style={{ width: 10, height: 10 }} />
                  {incomingAlert.latitude.toFixed(5)}, {incomingAlert.longitude.toFixed(5)}
                </div>
              )}

              <div className="text-center text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {safeTimeStr(incomingAlert.triggered_at)}
              </div>

              {/* Acknowledged indicator */}
              {incomingAlert.acknowledged_by && (
                <div className="text-center text-[10px] font-mono p-1.5" style={{ background: 'rgba(var(--sev-ok-rgb) / 0.08)', border: '1px solid rgba(var(--sev-ok-rgb) / 0.4)', color: 'var(--sev-ok)' }}>
                  Acknowledged by {incomingAlert.acknowledged_by}
                  {incomingAlert.acknowledged_at && ` at ${safeTimeStr(incomingAlert.acknowledged_at)}`}
                </div>
              )}

              {/* Escalation level indicator */}
              {incomingAlert.escalation_level && incomingAlert.escalation_level > 1 && (
                <div className="text-center text-[10px] font-bold uppercase tracking-wider p-1" style={{ background: 'rgba(var(--sev-critical-rgb) / 0.1)', border: '1px solid rgba(var(--sev-critical-rgb) / 0.5)', color: 'var(--sev-critical)' }}>
                  Escalation Level {incomingAlert.escalation_level}
                </div>
              )}

              {/* Live Audio Indicator — shows when receiving panic mic broadcast */}
              {panicAudio.isReceiving && (
                <div
                  className="flex items-center justify-center gap-2 p-2 animate-emergency-pulse"
                  style={{ background: 'rgba(var(--sev-critical-rgb) / 0.1)', border: '1px solid rgba(var(--sev-critical-rgb) / 0.5)' }}
                >
                  <Mic size={14} color="var(--sev-critical)" className="animate-emergency-blink" />
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--sev-critical-soft)' }}>
                    Live Audio — Listening...
                  </span>
                  <span className="led-dot led-red animate-led-blink" />
                </div>
              )}

              {/* Respond Button — talk back to panic sender */}
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  {!panicAudio.isReceiving && panicAudio.panicSenderUserId && (
                    <button type="button"
                      onClick={() => {
                        if (panicAudio.isResponding) {
                          panicAudio.stopResponse();
                        } else {
                          panicAudio.startResponse(panicAudio.panicSenderUserId!);
                        }
                      }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold uppercase tracking-wide ${
                        panicAudio.isResponding
                          ? 'btn-success'
                          : 'btn-primary'
                      }`}
                    >
                      {panicAudio.isResponding ? (
                        <>
                          <MicOff size={12} />
                          Stop Talking
                        </>
                      ) : (
                        <>
                          <Mic size={12} />
                          Respond
                        </>
                      )}
                    </button>
                  )}
                  <button type="button"
                    onClick={acknowledgeAlert}
                    aria-label="Acknowledge panic alert"
                    className={`${!panicAudio.isReceiving && panicAudio.panicSenderUserId ? '' : 'w-full'} btn-danger py-2 justify-center flex-1`}
                  >
                    ACKNOWLEDGE
                  </button>
                </div>
                {/* Code 4 / resolve — supervisor+ only (Spillman: dispatcher
                    clears the emergency when the officer is code 4) */}
                {isSupervisor && incomingAlert.panic_id && (
                  <button type="button"
                    onClick={resolveCode4}
                    className="w-full py-1.5 text-[10px] font-bold uppercase tracking-wider text-center"
                    style={{ background: 'var(--surface-raised)', border: '1px solid rgba(var(--sev-ok-rgb) / 0.5)', color: 'var(--sev-ok)' }}
                  >
                    Code 4 — Resolve
                  </button>
                )}
                {/* False alarm — supervisor+ only */}
                {isSupervisor && incomingAlert.panic_id && (
                  <button type="button"
                    onClick={markFalseAlarm}
                    className="w-full py-1.5 text-[10px] font-bold uppercase tracking-wider text-center"
                    style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
                  >
                    Mark False Alarm
                  </button>
                )}
                {notesKind && (
                  <div className="space-y-1.5 p-2" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)' }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
                      {notesKind === 'false-alarm' ? 'False alarm notes' : 'Code 4 notes'}
                    </div>
                    <textarea
                      value={notesText}
                      onChange={(e) => setNotesText(e.target.value)}
                      rows={2}
                      className="w-full px-2 py-1.5 text-[11px] bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 resize-none"
                      placeholder="Optional notes"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setNotesKind(null); setNotesText(''); }}
                        className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitPanicNotes()}
                        className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: 'var(--surface-raised)', border: '1px solid rgba(var(--sev-ok-rgb) / 0.5)', color: 'var(--sev-ok)' }}
                      >
                        Submit
                      </button>
                    </div>
                  </div>
                )}
                {/* Admin fallback — force-deactivate from any state */}
                {isAdmin && incomingAlert.panic_id && (
                  <button type="button"
                    onClick={() => setForceDeactivateOpen(true)}
                    className="w-full py-1.5 text-[10px] font-bold uppercase tracking-wider text-center"
                    style={{ background: 'var(--surface-raised)', border: '1px solid rgba(var(--sev-critical-rgb) / 0.5)', color: 'var(--sev-critical)' }}
                  >
                    Force Deactivate (Admin)
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        isOpen={forceDeactivateOpen}
        onClose={() => setForceDeactivateOpen(false)}
        onConfirm={() => {
          setForceDeactivateOpen(false);
          void forceDeactivate();
        }}
        title="Force-deactivate panic"
        message="Force-deactivate this panic? This clears the alert, the unit EMERGENCY state, and the P1 call for ALL consoles."
        confirmLabel="Deactivate"
        confirmVariant="danger"
      />
    </>
  );
}
