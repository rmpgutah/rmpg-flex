// ============================================================
// RMPG Flex — Dispatch Alert Banner (Tiered Visual Alerts)
// Renders minor/moderate/major severity banners at top of screen
// for dispatch events (panic, BOLO, officer down, etc.)
// ============================================================

import { useEffect, useRef } from 'react';
import { Info, AlertTriangle, ShieldAlert, X } from 'lucide-react';
import type { AlertSeverity } from '../utils/alertSeverity';

export interface AlertBannerItem {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: number;
}

interface DispatchAlertBannerProps {
  alerts: AlertBannerItem[];
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  major: 0,
  moderate: 1,
  minor: 2,
};

const MINOR_AUTO_DISMISS_MS = 5000;

function severityIcon(severity: AlertSeverity) {
  switch (severity) {
    case 'major':
      return <ShieldAlert className="w-4 h-4 shrink-0" />;
    case 'moderate':
      return <AlertTriangle className="w-4 h-4 shrink-0" />;
    case 'minor':
      return <Info className="w-4 h-4 shrink-0" />;
  }
}

function severityClasses(severity: AlertSeverity): string {
  switch (severity) {
    case 'major':
      return 'bg-red-900/90 border-red-500/70 text-red-100';
    case 'moderate':
      return 'bg-amber-900/80 border-amber-500/50 text-amber-100 animate-pulse';
    case 'minor':
      return 'bg-gray-900/80 border-gray-500/50 text-gray-100';
  }
}

export default function DispatchAlertBanner({ alerts, onDismiss, onDismissAll }: DispatchAlertBannerProps) {
  const autoDismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Auto-dismiss minor alerts after 5 seconds
  useEffect(() => {
    const timers = autoDismissTimers.current;
    const minorAlerts = alerts.filter((a) => a.severity === 'minor');

    for (const alert of minorAlerts) {
      if (!timers.has(alert.id)) {
        const timer = setTimeout(() => {
          onDismiss(alert.id);
          timers.delete(alert.id);
        }, MINOR_AUTO_DISMISS_MS);
        timers.set(alert.id, timer);
      }
    }

    // Clean up timers for alerts that no longer exist
    for (const [id, timer] of timers) {
      if (!alerts.some((a) => a.id === id)) {
        clearTimeout(timer);
        timers.delete(id);
      }
    }

    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, [alerts, onDismiss]);

  if (alerts.length === 0) return null;

  const sorted = [...alerts].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const hasMajor = sorted.some((a) => a.severity === 'major');

  return (
    <>
      {/* Red radial gradient overlay for major alerts — strobe 3 pulses */}
      {hasMajor && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(220, 38, 38, 0.15) 0%, transparent 70%)',
            animation: 'strobe 0.6s ease-in-out 3',
            zIndex: 9998,
          }}
        />
      )}

      {/* Alert banners container */}
      <div className="fixed top-0 left-0 right-0 z-[9999] flex flex-col items-center pointer-events-none">
        <div className="w-full max-w-2xl space-y-2 p-2 pointer-events-auto">
          {/* Dismiss all button */}
          {alerts.length > 2 && (
            <button
              onClick={onDismissAll}
              className="w-full text-center text-xs font-mono text-zinc-400 hover:text-white bg-zinc-900/80 border border-zinc-700/50 rounded px-3 py-1 transition-colors"
            >
              Dismiss all ({alerts.length})
            </button>
          )}

          {/* Individual alert banners */}
          {sorted.map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start gap-2 border rounded px-3 py-2 font-mono text-sm ${severityClasses(alert.severity)}`}
            >
              {severityIcon(alert.severity)}
              <div className="flex-1 min-w-0">
                <div className="font-bold leading-tight">{alert.title}</div>
                <div className="opacity-80 leading-tight">{alert.message}</div>
              </div>
              <button
                onClick={() => onDismiss(alert.id)}
                className="shrink-0 p-0.5 hover:bg-white/10 rounded transition-colors"
                aria-label="Dismiss alert"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
