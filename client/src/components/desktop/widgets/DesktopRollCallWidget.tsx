import React, { useState, useEffect, useRef } from 'react';
import { Users } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface Unit {
  id: number;
  unit_id: string;
  status: string;
  full_name?: string;
  beat?: string;
}

function getStatusDotColor(status: string): string {
  if (status === 'available') return 'var(--sev-ok)';
  if (status === 'busy' || status === 'on-call' || status === 'traffic-stop') return 'var(--sev-warn)';
  return 'var(--text-secondary)';
}

function isOnCall(status: string): boolean {
  return status === 'busy' || status === 'on-call' || status === 'traffic-stop';
}

function getInitials(unit: Unit): string {
  if (unit.full_name) {
    const parts = unit.full_name.trim().split(' ').filter(Boolean);
    if (parts.length >= 2) return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
    return (parts[0] ?? '').slice(0, 2).toUpperCase();
  }
  return (unit.unit_id ?? '').slice(0, 2).toUpperCase();
}

function formatSecondsAgo(secs: number): string {
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}

const SKELETON_ROWS = 3;

export default function DesktopRollCallWidget() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [secondsSince, setSecondsSince] = useState(0);
  const lastFetchRef = useRef<number>(Date.now());

  useEffect(() => {
    async function load() {
      try {
        const r = await apiFetch<Unit[]>('/dispatch/units');
        if (Array.isArray(r)) setUnits(r);
      } catch { /* offline */ }
      lastFetchRef.current = Date.now();
      setSecondsSince(0);
      setLoading(false);
    }
    load();
    const poll = setInterval(load, 30000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsSince(Math.floor((Date.now() - lastFetchRef.current) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const totalUnits = units.length;
  const availableCount = units.filter(u => u.status === 'available').length;
  const onCallCount = units.filter(u => isOnCall(u.status)).length;
  const oosCount = units.filter(u => u.status === 'out-of-service').length;
  const displayUnits = units.slice(0, 5);
  const moreCount = units.length - 5;
  const noUnitsAlert = availableCount === 0 && onCallCount > 0;

  return (
    <div style={{ padding: 8, minWidth: 160 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
        <Users size={10} style={{ color: 'var(--field-label-color)', flexShrink: 0 }} />
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          color: 'var(--field-label-color)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}>
          UNITS
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          {totalUnits} on duty
        </span>
      </div>

      {/* Counts row */}
      {!loading && totalUnits > 0 && (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginBottom: 6, letterSpacing: '0.04em' }}>
          <span style={{ color: 'var(--sev-ok)', fontWeight: 600 }}>{availableCount} ONLINE</span>
          {onCallCount > 0 && (
            <>
              <span style={{ margin: '0 4px', opacity: 0.4 }}>·</span>
              <span style={{ color: 'var(--sev-warn)', fontWeight: 600 }}>{onCallCount} ON CALL</span>
            </>
          )}
          {oosCount > 0 && (
            <>
              <span style={{ margin: '0 4px', opacity: 0.4 }}>·</span>
              <span style={{ color: 'var(--text-secondary)' }}>{oosCount} OOS</span>
            </>
          )}
        </div>
      )}

      {/* No units alert */}
      {!loading && noUnitsAlert && (
        <div style={{
          fontSize: 9,
          fontWeight: 700,
          color: 'var(--sev-critical)',
          letterSpacing: '0.08em',
          marginBottom: 6,
          padding: '3px 5px',
          border: '1px solid var(--sev-critical)',
          borderRadius: 2,
          background: 'color-mix(in srgb, var(--sev-critical) 10%, transparent)',
        }}>
          NO UNITS AVAILABLE
        </div>
      )}

      {/* Unit list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {loading
          ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.4 }}>
                <div style={{
                  width: 20,
                  height: 20,
                  borderRadius: 2,
                  background: 'var(--surface-raised)',
                  flexShrink: 0,
                }} />
                <div style={{
                  height: 8,
                  borderRadius: 2,
                  background: 'var(--surface-raised)',
                  width: `${50 + i * 12}px`,
                }} />
                <div style={{
                  marginLeft: 'auto',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--surface-raised)',
                  flexShrink: 0,
                }} />
              </div>
            ))
          : displayUnits.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Initials avatar */}
                <div style={{
                  width: 20,
                  height: 20,
                  borderRadius: 2,
                  background: 'var(--surface-raised)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 7,
                  fontWeight: 700,
                  color: 'var(--brand-400)',
                  flexShrink: 0,
                  letterSpacing: '0.03em',
                }}>
                  {getInitials(u)}
                </div>
                {/* Name */}
                <span style={{
                  fontSize: 9,
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexGrow: 1,
                  minWidth: 0,
                }}>
                  {u.full_name ? u.full_name.split(' ').slice(-1)[0] : u.unit_id}
                </span>
                {/* Status dot */}
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: getStatusDotColor(u.status),
                  display: 'inline-block',
                  flexShrink: 0,
                }} />
              </div>
            ))
        }
      </div>

      {/* More link */}
      {!loading && moreCount > 0 && (
        <div style={{ fontSize: 9, color: 'var(--brand-400)', marginTop: 4, cursor: 'default', opacity: 0.8 }}>
          +{moreCount} more
        </div>
      )}

      {/* Last updated */}
      {!loading && (
        <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginTop: 6, opacity: 0.6 }}>
          Updated {formatSecondsAgo(secondsSince)}
        </div>
      )}
    </div>
  );
}
