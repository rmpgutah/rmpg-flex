import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';

interface ActiveUnit {
  id: number;
  unit_id?: string;
  unit_number?: string;
  officer_name?: string;
  first_name?: string;
  last_name?: string;
  status?: string;
  status_code?: string;
}

function statusColor(status?: string): string {
  const s = (status ?? '').toLowerCase();
  if (s.includes('available') || s === 'av' || s === '10-8') return '#22c55e';
  if (s.includes('busy') || s === 'busy' || s.includes('on call') || s === '10-6') return 'var(--sev-warn)';
  if (s.includes('out') || s.includes('off')) return 'var(--text-secondary)';
  return 'var(--accent-silver-400)';
}

function statusDot(status?: string): string {
  const s = (status ?? '').toLowerCase();
  if (s.includes('available') || s === 'av') return '●';
  if (s.includes('busy') || s.includes('on call')) return '●';
  return '○';
}

function officerLabel(unit: ActiveUnit): string {
  if (unit.officer_name) return unit.officer_name;
  if (unit.first_name || unit.last_name) return `${unit.first_name ?? ''} ${unit.last_name ?? ''}`.trim();
  return '—';
}

export default function DesktopUnitProximityWidget() {
  const [units, setUnits] = useState<ActiveUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function load() {
    try {
      const data = await apiFetch<ActiveUnit[]>('/dispatch/units?status=active&limit=8');
      setUnits(Array.isArray(data) ? data : []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{ width: 220, padding: '6px 8px', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 2 }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
        ACTIVE UNITS
      </div>
      {loading ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Loading…</div>
      ) : error ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Unable to load</div>
      ) : units.length === 0 ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>No active units</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {units.map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
              <span style={{ color: statusColor(u.status ?? u.status_code), fontSize: 10, flexShrink: 0 }}>
                {statusDot(u.status ?? u.status_code)}
              </span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0, minWidth: 32 }}>
                {u.unit_id ?? u.unit_number ?? `U${u.id}`}
              </span>
              <span style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 9 }}>
                {officerLabel(u)}
              </span>
              <span style={{ fontSize: 8, color: statusColor(u.status ?? u.status_code), flexShrink: 0 }}>
                {(u.status ?? u.status_code ?? '').toUpperCase().slice(0, 6)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
