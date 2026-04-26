import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, X, Volume2, VolumeX, BellRing } from 'lucide-react';
import {
  acknowledgeAlert,
  acknowledgeAllAlerts,
  listPendingAlerts,
  subscribeEscalation,
} from '../utils/alertEscalation';
import { playToneAsync } from '../utils/dispatchTones';

// ============================================================
// Alert ACK Banner
// ============================================================
// Persistent fixed-position strip that appears whenever one or
// more critical alerts are pending acknowledgment in the
// alertEscalation queue. Dispatcher clicks ACK to silence a
// specific alert (stops its 30s repeat); ACK ALL clears
// everything in one shot.
//
// Why a banner and not a modal?
//   • Modal would block the rest of the dispatch console — the
//     last thing you want when an officer is in trouble.
//   • The banner lives at the top of the viewport, always visible,
//     stays out of the way of map / call list interaction.
//
// Stays mounted at the app root so a backgrounded tab returning to
// foreground sees the same persistent state. State sync via the
// existing `subscribeEscalation` channel — no Redux/Context needed.
// ============================================================

interface PendingDisplay {
  key: string;
  firstFiredAt: number;
  repeatCount: number;
  category: string;
  label?: string;
  unit?: string;
  officerName?: string;
  detail?: string;
}

function formatAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

export default function AlertAckBanner() {
  const [pending, setPending] = useState<PendingDisplay[]>(() => listPendingAlerts());
  const [, setNow] = useState(Date.now()); // tick state to refresh ages

  // Subscribe to queue changes from the escalation module.
  useEffect(() => {
    const refresh = () => setPending(listPendingAlerts());
    refresh();
    return subscribeEscalation(refresh);
  }, []);

  // Refresh age display every second while any alerts are pending.
  // Stopped when queue empties to avoid waking the timer needlessly.
  useEffect(() => {
    if (pending.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pending.length]);

  const handleAck = useCallback((key: string) => {
    acknowledgeAlert(key);
    // Brief audible confirmation — the "ack" tone defined in
    // dispatchTones (40ms 1500 Hz pip).
    playToneAsync('ack').catch(() => { /* ignore */ });
  }, []);

  const handleAckAll = useCallback(() => {
    if (!window.confirm(`Acknowledge all ${pending.length} pending alerts?`)) return;
    acknowledgeAllAlerts();
    playToneAsync('ack').catch(() => { /* ignore */ });
  }, [pending.length]);

  // No pending alerts → render nothing (zero footprint).
  if (pending.length === 0) return null;

  // Sort newest-first so the most recent alert is at the top.
  // Spillman convention: most recent = top of stack, most actionable.
  const sorted = [...pending].sort((a, b) => b.firstFiredAt - a.firstFiredAt);

  // Severity-based banner color. Panic > GPS Lost > Pursuit > others.
  const hasPanic = sorted.some(a => a.category === 'panic');
  const hasGpsLost = sorted.some(a => a.category === 'gps_gap_critical');
  const hasPursuit = sorted.some(a => a.category === 'pursuit_speed');
  const stripBg = hasPanic ? 'bg-red-900/85' : hasGpsLost ? 'bg-red-800/85' : hasPursuit ? 'bg-fuchsia-900/85' : 'bg-amber-900/85';
  const stripBorder = hasPanic || hasGpsLost ? 'border-red-500' : hasPursuit ? 'border-fuchsia-500' : 'border-amber-500';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed top-0 left-0 right-0 z-[10000] ${stripBg} backdrop-blur-sm border-b-2 ${stripBorder} shadow-lg`}
      style={{ borderRadius: 0 }}
    >
      <div className="flex items-stretch">
        {/* Left fixed icon block */}
        <div className="flex items-center px-3 py-2 bg-black/40 border-r border-white/10">
          <BellRing className="w-5 h-5 text-white animate-pulse" aria-hidden="true" />
          <span className="ml-2 text-[11px] font-bold uppercase tracking-wider text-white">
            {pending.length} ALERT{pending.length === 1 ? '' : 'S'}
          </span>
        </div>

        {/* Scrollable list of alerts */}
        <div className="flex-1 overflow-x-auto flex items-center">
          {sorted.map(alert => {
            const ageMs = Date.now() - alert.firstFiredAt;
            return (
              <div
                key={alert.key}
                className="flex items-center gap-2 px-3 py-1.5 border-r border-white/10 min-w-0 hover:bg-black/20"
              >
                <AlertTriangle className="w-4 h-4 text-white flex-shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[12px] font-bold text-white whitespace-nowrap">
                    <span>{alert.label || alert.category.toUpperCase()}</span>
                    {alert.unit && <span className="text-amber-300">{alert.unit}</span>}
                    <span className="text-white/60 font-mono text-[10px]">{formatAge(ageMs)}</span>
                  </div>
                  <div className="text-[10px] text-white/80 truncate">
                    {alert.officerName ? `${alert.officerName}` : ''}
                    {alert.officerName && alert.detail ? ' · ' : ''}
                    {alert.detail || ''}
                    {alert.repeatCount > 0 && (
                      <span className="ml-2 text-amber-300">repeated {alert.repeatCount}×</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleAck(alert.key)}
                  className="ml-2 px-2 py-0.5 bg-white text-black text-[10px] font-bold uppercase tracking-wide hover:bg-amber-200 active:bg-amber-300"
                  style={{ borderRadius: 2 }}
                  aria-label={`Acknowledge ${alert.label || alert.category} alert for ${alert.unit || ''}`}
                  title="Stop this alert from repeating"
                >
                  ACK
                </button>
              </div>
            );
          })}
        </div>

        {/* Right fixed actions */}
        <div className="flex items-center gap-1 px-2 py-1 bg-black/40 border-l border-white/10">
          {pending.length > 1 && (
            <button
              type="button"
              onClick={handleAckAll}
              className="px-2 py-1 bg-white text-black text-[10px] font-bold uppercase tracking-wide hover:bg-amber-200 active:bg-amber-300"
              style={{ borderRadius: 2 }}
              title="Acknowledge all pending alerts"
            >
              ACK ALL
            </button>
          )}
        </div>
      </div>

      {/* Hairline pulsing accent at top — signals the strip is "live" */}
      <div className="absolute top-0 left-0 right-0 h-px bg-white/40 animate-pulse" aria-hidden="true" />
      {/* Suppress unused-import warnings for icons reserved for future use. */}
      <span className="hidden"><Volume2 /><VolumeX /><X /></span>
    </div>
  );
}
