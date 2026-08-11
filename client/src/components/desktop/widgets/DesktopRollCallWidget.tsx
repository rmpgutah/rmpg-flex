import React, { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface Unit { id: number; unit_id: string; status: string; full_name?: string; beat?: string; }

const STATUS_COLORS: Record<string, string> = {
  available: 'var(--sev-ok, #22c55e)',
  busy: 'var(--sev-warn, #f59e0b)',
  'on-call': 'var(--brand-400)',
  'traffic-stop': 'var(--sev-high, #f97316)',
  'out-of-service': 'var(--sev-critical, #ef4444)',
};

export default function DesktopRollCallWidget() {
  const [units, setUnits] = useState<Unit[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const r = await apiFetch<{ units: Unit[] }>('/dispatch/units');
        if (r?.units) setUnits(r.units);
      } catch { /* offline */ }
    }
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, []);

  const oos = units.filter(u => u.status === 'out-of-service').length;

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Users className="w-3 h-3" style={{ color: 'var(--brand-400)' }} />
        <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>ROLL CALL</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-secondary)' }}>{units.length} on duty</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {units.slice(0, 6).map(u => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[u.status] ?? 'var(--text-secondary)', display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontSize: 9, color: 'var(--text-primary)', flexGrow: 1 }}>{u.unit_id}</span>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{u.beat ?? ''}</span>
          </div>
        ))}
      </div>
      {oos > 0 && <div style={{ fontSize: 9, color: 'var(--sev-critical, #ef4444)', marginTop: 4 }}>{oos} OOS</div>}
    </div>
  );
}
