import React, { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { parseTimestamp } from '../../utils/dateUtils';

interface UnitRow {
  id: number;
  unit_id: string;
  full_name?: string;
  status: string;
  last_gps_update?: string;
}

function statusColor(s: string): string {
  if (s === 'available') return 'var(--sev-ok, #22c55e)';
  if (s === 'busy' || s === 'on-call' || s === 'traffic-stop') return 'var(--sev-warn, #f59e0b)';
  if (s === 'out-of-service') return 'var(--text-muted, #6b7280)';
  return 'var(--text-secondary, #adbccc)';
}

function statusLabel(s: string): string {
  return s.replace(/-/g, ' ').toUpperCase();
}

function gpsAge(ts: string | undefined): string {
  if (!ts) return '—';
  const ms = Date.now() - parseTimestamp(ts).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h`;
}

interface DesktopStatusBoardProps {
  onOpenUnit?: (id: number) => void;
}

export default function DesktopStatusBoard({ onOpenUnit }: DesktopStatusBoardProps) {
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    function load() {
      apiFetch<UnitRow[]>('/dispatch/units?on_duty=true')
        .then(rows => { if (!cancelled && Array.isArray(rows)) setUnits(rows); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div style={{ padding: 8, minWidth: 260 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
        <Users size={10} style={{ color: 'var(--field-label-color)', flexShrink: 0 }} />
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--field-label-color)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Officer Status Board
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-secondary)' }}>
          {loading ? '…' : `${units.length} on duty`}
        </span>
      </div>

      {/* Grid header */}
      {!loading && units.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 80px 36px', gap: 4, marginBottom: 4 }}>
          {['UNIT', 'OFFICER', 'STATUS', 'GPS'].map(h => (
            <span key={h} style={{ fontSize: 8, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{h}</span>
          ))}
        </div>
      )}

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ height: 22, background: 'var(--surface-base)', borderRadius: 2, opacity: 0.4 }} />
          ))
        ) : units.length === 0 ? (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '8px 0' }}>No units on duty</div>
        ) : (
          units.map(u => (
            <button
              key={u.id}
              type="button"
              onClick={() => onOpenUnit?.(u.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr 80px 36px',
                gap: 4,
                alignItems: 'center',
                padding: '3px 4px',
                background: 'transparent',
                border: '1px solid transparent',
                borderRadius: 2,
                cursor: onOpenUnit ? 'pointer' : 'default',
                textAlign: 'left',
                transition: 'background 100ms, border-color 100ms',
              }}
              onMouseEnter={e => {
                if (!onOpenUnit) return;
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.12)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(195,204,214,0.08)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.unit_id}
              </span>
              <span style={{ fontSize: 9, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.full_name ?? '—'}
              </span>
              <span style={{ fontSize: 8, fontWeight: 600, color: statusColor(u.status), letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {statusLabel(u.status)}
              </span>
              <span style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'right' }}>
                {gpsAge(u.last_gps_update)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
