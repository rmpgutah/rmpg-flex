import React, { useState, useEffect } from 'react';
import { Radio, AlertTriangle, Shield, Users, CheckCircle } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface BoloCall {
  id: number;
  nature?: string;
  priority?: string | number;
  location_address?: string;
  status?: string;
}

interface Warrant {
  id: number;
  warrant_number?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  charge?: string;
  warrant_type?: string;
}

interface PersonOfInterest {
  id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  flag_type?: string;
  last_known_address?: string;
}

interface Unit {
  id: number;
  unit_id?: string;
  unit_number?: string;
  officer_name?: string;
  officer?: string;
  status?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  '1': 'var(--sev-critical)',
  '2': 'var(--sev-warn)',
  '3': 'var(--sev-ok)',
  high: 'var(--sev-critical)',
  medium: 'var(--sev-warn)',
  low: 'var(--sev-ok)',
};

function personName(p: { name?: string; first_name?: string; last_name?: string }): string {
  if (p.first_name || p.last_name) return [p.first_name, p.last_name].filter(Boolean).join(' ');
  return p.name ?? '—';
}

interface Props {
  onClose?: () => void;
}

export default function DesktopShiftBriefing({ onClose }: Props) {
  const [bolos, setBolos] = useState<BoloCall[]>([]);
  const [warrants, setWarrants] = useState<Warrant[]>([]);
  const [persons, setPersons] = useState<PersonOfInterest[]>([]);
  const [personsAvail, setPersonsAvail] = useState(true);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    const controllers: AbortController[] = [];
    const sig = () => { const c = new AbortController(); controllers.push(c); return c.signal; };

    Promise.allSettled([
      apiFetch<BoloCall[] | { results?: BoloCall[] }>('/dispatch/calls?nature_contains=BOLO&status=active&limit=10')
        .then(d => setBolos(Array.isArray(d) ? d : (d.results ?? []))),
      apiFetch<Warrant[] | { results?: Warrant[] }>('/warrants?status=active&limit=10')
        .then(d => setWarrants(Array.isArray(d) ? d : (d.results ?? []))),
      apiFetch<PersonOfInterest[] | { results?: PersonOfInterest[] }>('/intel/persons?flag=officer_safety&limit=10')
        .then(d => setPersons(Array.isArray(d) ? d : (d.results ?? [])))
        .catch(() => setPersonsAvail(false)),
      apiFetch<Unit[] | { results?: Unit[] }>('/dispatch/units?status=active&limit=20')
        .then(d => setUnits(Array.isArray(d) ? d : (d.results ?? []))),
    ]).finally(() => setLoading(false));

    return () => controllers.forEach(c => c.abort());
  }, []);

  const sectionHeader = (icon: React.ReactNode, title: string, count: number): React.ReactNode => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      {icon}
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--panel-header-color, var(--accent-gold-300))' }}>
        {title}
      </span>
      <span style={{
        fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 2,
        background: count > 0 ? 'var(--sev-warn)' : 'var(--surface-sunken)',
        color: count > 0 ? '#fff' : 'var(--text-secondary)',
        marginLeft: 4,
      }}>{count}</span>
    </div>
  );

  const itemStyle: React.CSSProperties = {
    padding: '4px 8px', borderBottom: '1px solid rgba(195,204,214,0.07)', fontSize: 11,
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--surface-base)' }}>
        <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Loading shift briefing…</p>
      </div>
    );
  }

  if (acknowledged) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, background: 'var(--surface-base)' }}>
        <CheckCircle size={36} style={{ color: 'var(--sev-ok)' }} />
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Shift acknowledged. Good luck out there.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-base)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        <Radio size={14} style={{ color: 'var(--accent-silver-400)' }} />
        <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-primary)' }}>
          Shift Briefing
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          {new Date().toLocaleString()}
        </span>
      </div>

      {/* 4 sections */}
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* BOLOs */}
        <section style={{ background: 'var(--surface-raised)', borderRadius: 2, padding: 12, border: '1px solid var(--border-default)' }}>
          {sectionHeader(<AlertTriangle size={12} style={{ color: 'var(--sev-warn)' }} />, 'Active BOLOs', bolos.length)}
          {bolos.length === 0 ? (
            <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>No active BOLOs</p>
          ) : bolos.map(b => (
            <div key={b.id} style={itemStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {b.priority && (
                  <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 2, background: PRIORITY_COLORS[String(b.priority)] ?? 'var(--surface-sunken)', color: '#fff' }}>
                    P{b.priority}
                  </span>
                )}
                <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>{b.nature ?? 'BOLO'}</span>
              </div>
              {b.location_address && <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 1 }}>{b.location_address}</div>}
            </div>
          ))}
        </section>

        {/* Warrants */}
        <section style={{ background: 'var(--surface-raised)', borderRadius: 2, padding: 12, border: '1px solid var(--border-default)' }}>
          {sectionHeader(<Shield size={12} style={{ color: 'var(--sev-critical)' }} />, 'Active Warrants', warrants.length)}
          {warrants.length === 0 ? (
            <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>No active warrants</p>
          ) : warrants.map(w => (
            <div key={w.id} style={itemStyle}>
              <div style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>{personName(w)}</div>
              {w.charge && <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{w.charge}</div>}
              {w.warrant_type && <div style={{ fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{w.warrant_type}</div>}
            </div>
          ))}
        </section>

        {/* Persons of Interest */}
        {personsAvail && (
          <section style={{ background: 'var(--surface-raised)', borderRadius: 2, padding: 12, border: '1px solid var(--border-default)' }}>
            {sectionHeader(<AlertTriangle size={12} style={{ color: 'var(--sev-critical)' }} />, 'Persons of Interest', persons.length)}
            {persons.length === 0 ? (
              <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>None flagged</p>
            ) : persons.map(p => (
              <div key={p.id} style={itemStyle}>
                <div style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>{personName(p)}</div>
                {p.flag_type && <div style={{ fontSize: 9, color: 'var(--sev-critical)', textTransform: 'uppercase' }}>{p.flag_type.replace(/_/g, ' ')}</div>}
                {p.last_known_address && <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{p.last_known_address}</div>}
              </div>
            ))}
          </section>
        )}

        {/* On Duty */}
        <section style={{ background: 'var(--surface-raised)', borderRadius: 2, padding: 12, border: '1px solid var(--border-default)', gridColumn: personsAvail ? 'auto' : '1 / -1' }}>
          {sectionHeader(<Users size={12} style={{ color: 'var(--accent-silver-400)' }} />, "Who's On Duty", units.length)}
          {units.length === 0 ? (
            <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>No units active</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {units.map(u => (
                <div key={u.id} style={{
                  padding: '4px 8px', borderRadius: 2, fontSize: 10, fontWeight: 700,
                  background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', color: 'var(--text-primary)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 64,
                }}>
                  <span style={{ color: 'var(--accent-silver-400)', fontFamily: 'Arial, sans-serif' }}>{u.unit_id ?? u.unit_number ?? `U${u.id}`}</span>
                  {(u.officer_name ?? u.officer) && (
                    <span style={{ fontSize: 9, color: 'var(--text-secondary)', fontWeight: 400, textAlign: 'center' }}>
                      {u.officer_name ?? u.officer}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Acknowledge button */}
      <div style={{ padding: '10px 16px', background: 'var(--surface-raised)', borderTop: '1px solid var(--border-default)', flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => { setAcknowledged(true); setTimeout(() => onClose?.(), 2000); }}
          style={{
            fontSize: 12, fontWeight: 700, padding: '7px 28px', borderRadius: 2, cursor: 'pointer',
            background: 'var(--sev-ok)', border: 'none', color: '#fff',
          }}
        >
          Acknowledge &amp; Start Shift
        </button>
      </div>
    </div>
  );
}
