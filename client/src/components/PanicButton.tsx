import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, X, MapPin, Mic, MicOff } from 'lucide-react';
import { useWebSocket } from '../context/WebSocketContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';
import { usePanicAudio } from '../hooks/usePanicAudio';
import { useToast } from './ToastProvider';
import { safeTimeStr } from '../utils/dateUtils';

// ─── Panic Alarm — loops the unified panicWarble tone ────────────
// Plays the Motorola APX emergency warble (960/1500Hz, 3s) in a
// loop for the specified duration. Uses the unified radioTones
// system so all emergency sounds are consistent.
// ─────────────────────────────────────────────────────────────────
/** Simple beep alarm as radioTones replacement */
function playPanicAlarm(durationMs = 10000): { stop: () => void } {
  let stopped = false;
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(960, ctx.currentTime);
  osc.frequency.setValueAtTime(1500, ctx.currentTime + 1.5);
  osc.frequency.setValueAtTime(960, ctx.currentTime + 3);
  osc.connect(gain);
  osc.start();
  const timer = setTimeout(() => { stopped = true; osc.stop(); gain.disconnect(); }, durationMs);
  return {
    stop: () => { if (!stopped) { stopped = true; clearTimeout(timer); osc.stop(); gain.disconnect(); } },
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
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      const result = await apiFetch<{ panic_id?: number }>('/dispatch/panic', {
        method: 'POST',
        body: JSON.stringify({
          latitude: latitude ?? null,
          longitude: longitude ?? null,
          trigger_method: 'hardware_button',
        }),
      });
      if (result?.panic_id) {
        setOwnPanicId(result.panic_id);
        setOwnPanicTime(Date.now());
      }
      // Start live mic broadcast for 60 seconds
      panicAudio.startBroadcast(result?.panic_id);
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

    // Only register hardware listeners on Android or Electron
    if (isAndroid || isElectron) {
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

  // Listen for incoming panic alerts and status updates
  useEffect(() => {
    const unsub = subscribe('panic_alert', (msg: any) => {
      const data = msg.data || msg.payload || msg;
      // Don't show your own panic alert back to yourself
      if (data.user_id && user?.id && String(data.user_id) === String(user.id)) return;
      setIncomingAlert(data);
      // Set the sender's user ID so the "Respond" talk-back button works
      if (data.user_id) {
        panicAudio.setSenderUserId?.(data.user_id);
      }
      // Play alarm
      alarmRef.current = playPanicAlarm(8000);
      // Auto-dismiss after 60 seconds (tracked for cleanup)
      if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = setTimeout(() => {
        setIncomingAlert(null);
        alarmRef.current?.stop();
      }, 60000);
    });

    // Panic acknowledged — update alert display
    const unsubAck = subscribe('panic_acknowledged', (msg: any) => {
      const data = msg.data || msg.payload || msg;
      setIncomingAlert(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          acknowledged_by: data.acknowledged_by || data.user_name,
          acknowledged_at: data.acknowledged_at || new Date().toISOString(),
        };
      });
      // Stop alarm sound on acknowledge
      alarmRef.current?.stop();
      alarmRef.current = null;
    });

    // Panic resolved — dismiss alert
    const unsubResolved = subscribe('panic_resolved', (msg: any) => {
      setIncomingAlert(null);
      alarmRef.current?.stop();
      alarmRef.current = null;
      setOwnPanicId(null);
      setOwnPanicTime(null);
      addToast('Panic alert resolved', 'success', 5000);
    });

    // Panic cancelled — dismiss alert
    const unsubCancelled = subscribe('panic_cancelled', (_msg: any) => {
      setIncomingAlert(null);
      alarmRef.current?.stop();
      alarmRef.current = null;
      setOwnPanicId(null);
      setOwnPanicTime(null);
    });

    // Panic false alarm — dismiss alert
    const unsubFalse = subscribe('panic_false_alarm', (_msg: any) => {
      setIncomingAlert(null);
      alarmRef.current?.stop();
      alarmRef.current = null;
      setOwnPanicId(null);
      setOwnPanicTime(null);
      addToast('Panic marked as false alarm', 'info', 5000);
    });

    // Panic escalated — update escalation level
    const unsubEscalated = subscribe('panic_escalated', (msg: any) => {
      const data = msg.data || msg.payload || msg;
      setIncomingAlert(prev => {
        if (!prev) return prev;
        return { ...prev, escalation_level: data.escalation_level };
      });
    });

    return () => {
      unsub();
      unsubAck();
      unsubResolved();
      unsubCancelled();
      unsubFalse();
      unsubEscalated();
      if (autoDismissTimerRef.current) clearTimeout(autoDismissTimerRef.current);
    };
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
  }, [incomingAlert?.panic_id]);

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
  const markFalseAlarm = useCallback(async () => {
    const panicId = incomingAlert?.panic_id;
    if (!panicId) return;
    const notes = window.prompt('Enter false alarm notes:');
    if (notes === null) return; // User cancelled prompt
    try {
      await apiFetch(`/dispatch/panic/${panicId}/false-alarm`, {
        method: 'POST',
        body: JSON.stringify({ notes: notes || 'No notes provided' }),
      });
      setIncomingAlert(null);
      alarmRef.current?.stop();
      alarmRef.current = null;
    } catch (err) {
      console.error('Failed to mark false alarm:', err);
      addToast('Failed to mark false alarm', 'error', 5000);
    }
  }, [incomingAlert?.panic_id, addToast]);

  // Check if current user can cancel (own panic within 30s)
  const canCancel = ownPanicId && ownPanicTime && (Date.now() - ownPanicTime < 30000);

  // Check if current user is supervisor+
  const isSupervisor = user?.role && SUPERVISOR_ROLES.includes(user.role);

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
      const result = await apiFetch<{ panic_id?: number }>('/dispatch/panic', {
        method: 'POST',
        body: JSON.stringify({
          latitude: latitude ?? null,
          longitude: longitude ?? null,
        }),
      });
      if (result?.panic_id) {
        setOwnPanicId(result.panic_id);
        setOwnPanicTime(Date.now());
      }
      // Start live mic broadcast for 60 seconds
      panicAudio.startBroadcast(result?.panic_id);
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
              style={{ background: '#222222', border: '1px solid #2a2a2a', color: '#888888' }}
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
                style={{ background: '#1a1a1a', border: '1px solid #f59e0b', color: '#f59e0b' }}
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
        <div className="fixed inset-0 z-[10000] flex items-center justify-center panic-overlay">
          <div className="absolute inset-0 bg-black/70 animate-emergency-blink" style={{ animationDuration: '0.5s' }} />
          <div
            className="relative max-w-md w-full mx-4 panic-alert-card"
            onClick={e => e.stopPropagation()}
          >
            {/* Pulsing border */}
            <div className="absolute inset-0 animate-emergency-pulse" style={{ border: '3px solid #ff0000', pointerEvents: 'none' }} />

            {/* Header */}
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ background: 'linear-gradient(180deg, #991b1b, #7f1d1d)' }}
            >
              <AlertTriangle className="animate-emergency-blink" style={{ width: 20, height: 20, color: '#ffffff' }} />
              <span className="text-sm font-bold uppercase tracking-widest text-white">
                Emergency Panic Alert
              </span>
              <button type="button"
                onClick={acknowledgeAlert}
                className="ml-auto p-1 hover:bg-red-800/50 transition-colors"
              >
                <X style={{ width: 14, height: 14, color: '#ffffff' }} />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-3" style={{ background: '#050505', borderTop: '2px solid #ff0000' }}>
              <div className="text-center">
                <div className="text-lg font-bold text-red-400 animate-emergency-blink">
                  {incomingAlert.user_name}
                </div>
                <div className="text-xs font-mono" style={{ color: '#888888' }}>
                  {incomingAlert.badge_number && `Badge: ${incomingAlert.badge_number} | `}
                  {(incomingAlert.role || '').toUpperCase()}
                  {incomingAlert.unit_call_sign && ` | Unit: ${incomingAlert.unit_call_sign}`}
                </div>
              </div>

              {/* Auto-created dispatch card info */}
              {incomingAlert.call_number && (
                <div className="text-center p-2" style={{ background: '#050505', border: '1px solid #dc2626' }}>
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <span
                      className="px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider animate-emergency-blink"
                      style={{ background: '#dc2626', color: '#fff', letterSpacing: '1.5px' }}
                    >
                      P1
                    </span>
                    <span className="text-xs font-bold text-white font-mono">
                      {incomingAlert.call_number}
                    </span>
                    <span
                      className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider"
                      style={{ background: '#166534', color: '#22c55e', letterSpacing: '1px' }}
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
                <div className="text-xs text-center text-white p-2" style={{ background: '#050505', border: '1px solid #2b2b2b' }}>
                  {incomingAlert.message}
                </div>
              )}

              {/* Reverse-geocoded address */}
              {incomingAlert.location_address && (
                <div className="text-center text-[10px] font-mono text-white p-1.5" style={{ background: '#050505', border: '1px solid #2b2b2b' }}>
                  <MapPin style={{ width: 9, height: 9, display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                  {incomingAlert.location_address}
                </div>
              )}

              {/* Raw GPS coordinates */}
              {(incomingAlert.latitude != null && incomingAlert.longitude != null) && (
                <div className="flex items-center justify-center gap-1 text-[10px] font-mono" style={{ color: '#666666' }}>
                  <MapPin style={{ width: 10, height: 10 }} />
                  {incomingAlert.latitude.toFixed(5)}, {incomingAlert.longitude.toFixed(5)}
                </div>
              )}

              <div className="text-center text-[10px] font-mono" style={{ color: '#383838' }}>
                {safeTimeStr(incomingAlert.triggered_at)}
              </div>

              {/* Acknowledged indicator */}
              {incomingAlert.acknowledged_by && (
                <div className="text-center text-[10px] font-mono p-1.5" style={{ background: '#0a1a0a', border: '1px solid #166534', color: '#22c55e' }}>
                  Acknowledged by {incomingAlert.acknowledged_by}
                  {incomingAlert.acknowledged_at && ` at ${safeTimeStr(incomingAlert.acknowledged_at)}`}
                </div>
              )}

              {/* Escalation level indicator */}
              {incomingAlert.escalation_level && incomingAlert.escalation_level > 1 && (
                <div className="text-center text-[10px] font-bold uppercase tracking-wider p-1" style={{ background: '#1a0505', border: '1px solid #dc2626', color: '#ef4444' }}>
                  Escalation Level {incomingAlert.escalation_level}
                </div>
              )}

              {/* Live Audio Indicator — shows when receiving panic mic broadcast */}
              {panicAudio.isReceiving && (
                <div
                  className="flex items-center justify-center gap-2 p-2 animate-emergency-pulse"
                  style={{ background: '#1a0505', border: '1px solid #dc2626' }}
                >
                  <Mic size={14} color="#ef4444" className="animate-emergency-blink" />
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#ef7a7a' }}>
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
                {/* False alarm — supervisor+ only */}
                {isSupervisor && incomingAlert.panic_id && (
                  <button type="button"
                    onClick={markFalseAlarm}
                    className="w-full py-1.5 text-[10px] font-bold uppercase tracking-wider text-center"
                    style={{ background: '#1a1a1a', border: '1px solid #444', color: '#888' }}
                  >
                    Mark False Alarm
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
