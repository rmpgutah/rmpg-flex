/**
 * FlexOS Ambient Status Bar
 *
 * A slim, always-visible strip anchored above the taskbar that shows live
 * operational metrics: active calls, critical calls, on-duty units, and
 * available units. Polls every 15 s via the existing ambient-stats endpoint.
 *
 * z-index 990 — below taskbar (1000), above desktop content.
 */
import React, { useEffect, useState } from 'react';
import { Radio, AlertTriangle, Users, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { getTaskbarPosition, getTaskbarSize } from '../../utils/taskbarPreferences';
import { TASKBAR_HEIGHT_PX } from './DesktopTaskbar';

interface AmbientStats {
  active_calls: number;
  critical_calls: number;
  total_units: number;
  available_units: number;
}

const STATUS_BAR_HEIGHT = 22;

export { STATUS_BAR_HEIGHT };

function Metric({
  icon: Icon,
  label,
  value,
  alert,
}: {
  icon: React.ElementType;
  label: string;
  value: number | null;
  alert?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '0 10px',
        borderRight: '1px solid rgba(195,204,214,0.08)',
      }}
    >
      <Icon
        style={{
          width: 10,
          height: 10,
          color: alert && (value ?? 0) > 0 ? 'var(--sev-critical, #ef4444)' : 'var(--text-muted, #8da0b3)',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 9, color: 'var(--text-muted, #8da0b3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: alert && (value ?? 0) > 0 ? 'var(--sev-critical, #ef4444)' : 'var(--text-primary, #f0f4f9)',
          minWidth: 18,
          textAlign: 'right',
        }}
      >
        {value === null ? '—' : value}
      </span>
    </div>
  );
}

export default function FlexOSStatusBar() {
  const [stats, setStats] = useState<AmbientStats | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await apiFetch<AmbientStats>('/dispatch/aggregates/ambient-stats');
        if (!cancelled && data) {
          setStats(data);
          setLastUpdated(new Date());
        }
      } catch {
        // silent — status bar is non-critical; stale data is fine
      }
    };

    poll();
    const id = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const taskbarPos = getTaskbarPosition();
  const taskbarH = TASKBAR_HEIGHT_PX[getTaskbarSize()];

  const positionStyle: React.CSSProperties =
    taskbarPos === 'top'
      ? { top: taskbarH }
      : { bottom: taskbarH };

  return (
    <div
      aria-label="FlexOS operational status"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        height: STATUS_BAR_HEIGHT,
        ...positionStyle,
        background: 'rgba(15,32,53,0.82)',
        backdropFilter: 'blur(6px)',
        borderTop: taskbarPos === 'top' ? 'none' : '1px solid rgba(195,204,214,0.06)',
        borderBottom: taskbarPos === 'top' ? '1px solid rgba(195,204,214,0.06)' : 'none',
        display: 'flex',
        alignItems: 'center',
        zIndex: 990,
        overflow: 'hidden',
      }}
    >
      {/* Brand chip */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '0 10px',
        borderRight: '1px solid rgba(195,204,214,0.08)',
      }}>
        <ShieldCheck style={{ width: 10, height: 10, color: 'var(--accent-silver-400, #c3ccd6)' }} />
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent-silver-400, #c3ccd6)' }}>
          FlexOS
        </span>
      </div>

      <Metric icon={Radio} label="Active" value={stats?.active_calls ?? null} />
      <Metric icon={AlertTriangle} label="Critical" value={stats?.critical_calls ?? null} alert />
      <Metric icon={Users} label="Units" value={stats?.total_units ?? null} />
      <Metric icon={ShieldCheck} label="Available" value={stats?.available_units ?? null} />

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Last-updated timestamp */}
      {lastUpdated && (
        <span style={{ fontSize: 8, color: 'var(--text-muted, #8da0b3)', padding: '0 10px', letterSpacing: '0.04em' }}>
          {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      )}
    </div>
  );
}
