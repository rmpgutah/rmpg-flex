import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';

interface SafetyPerson {
  id: number;
  first_name?: string;
  last_name?: string;
  name?: string;
  flag_type?: string;
  officer_safety_flag?: string;
  last_known_address?: string;
  address?: string;
}

function flagLabel(p: SafetyPerson): string {
  const raw = (p.flag_type ?? p.officer_safety_flag ?? '').toUpperCase();
  if (raw.includes('WEAPON')) return 'WEAPONS';
  if (raw.includes('MENTAL')) return 'MENTAL HEALTH';
  if (raw.includes('VIOLEN')) return 'VIOLENT';
  return raw || 'FLAGGED';
}

function flagColor(label: string): string {
  if (label === 'WEAPONS') return 'var(--sev-critical)';
  if (label === 'MENTAL HEALTH') return 'var(--sev-warn)';
  return 'var(--sev-critical)';
}

function personName(p: SafetyPerson): string {
  if (p.name) return p.name;
  const parts = [p.last_name, p.first_name].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Unknown';
}

export default function DesktopOfficerSafetyWidget() {
  const [persons, setPersons] = useState<SafetyPerson[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const fetchFlags = useCallback(async () => {
    try {
      const resp = await apiFetch<{ data: SafetyPerson[] } | SafetyPerson[]>(
        '/records/persons?officer_safety=true&limit=5',
      );
      const rows: SafetyPerson[] = Array.isArray(resp) ? resp : ((resp as { data: SafetyPerson[] }).data ?? []);
      setPersons(rows);
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFlags();
    const iv = setInterval(fetchFlags, 10 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchFlags]);

  const count = persons?.length ?? 0;

  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 2,
        padding: '10px 14px',
        width: 220,
        maxHeight: 180,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          Officer Safety Flags
        </div>
        {count > 0 && (
          <span
            style={{
              background: 'var(--sev-critical)',
              color: 'var(--text-primary)',
              borderRadius: 2,
              fontSize: 10,
              fontWeight: 700,
              padding: '0 5px',
              lineHeight: '16px',
            }}
          >
            {count}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ flex: 1 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ background: 'var(--surface-base)', borderRadius: 2, height: 28, marginBottom: 4 }} />
          ))}
        </div>
      ) : unavailable ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>Safety flag data unavailable</div>
      ) : count === 0 ? (
        <div className="flex items-center gap-2" style={{ color: 'var(--sev-ok)', fontSize: 11 }}>
          <span>✓</span>
          <span>No active officer safety flags in area</span>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {persons!.map(p => {
            const fl = flagLabel(p);
            return (
              <div key={p.id} style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4, marginBottom: 4 }}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold" style={{ color: 'var(--text-primary)', fontSize: 11 }}>
                    {personName(p)}
                  </span>
                  <span
                    style={{
                      background: flagColor(fl),
                      color: '#fff',
                      fontSize: 8,
                      fontWeight: 700,
                      borderRadius: 2,
                      padding: '1px 4px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {fl}
                  </span>
                </div>
                {(p.last_known_address ?? p.address) && (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 10, marginTop: 1 }}>
                    {p.last_known_address ?? p.address}
                  </div>
                )}
              </div>
            );
          })}
          <button
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--accent-silver-400)',
              fontSize: 10,
              padding: 0,
              marginTop: 2,
            }}
            onClick={() => {}}
          >
            View all →
          </button>
        </div>
      )}
    </div>
  );
}
