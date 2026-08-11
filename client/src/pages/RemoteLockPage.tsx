import React, { useState, useEffect } from 'react';
import { Lock, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';

interface Unit { id: number; unit_id: string; status: string; full_name?: string; }

export default function RemoteLockPage() {
  const { user } = useAuth();
  const [units, setUnits] = useState<Unit[]>([]);
  const [locking, setLocking] = useState<number | null>(null);
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<Unit | null>(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  useEffect(() => {
    apiFetch<{ units: Unit[] }>('/dispatch/units')
      .then(r => { if (r?.units) setUnits(r.units); })
      .catch(() => {});
  }, []);

  async function doLock(unit: Unit) {
    setLocking(unit.id);
    try {
      await apiFetch('/system/remote-lock', { method: 'POST', body: JSON.stringify({ unit_id: unit.id }) });
      setLocked(prev => new Set([...prev, unit.id]));
    } catch { /* error */ }
    finally { setLocking(null); setConfirm(null); }
  }

  if (!isAdmin) {
    return <div style={{ padding: 16, fontSize: 10, color: 'var(--text-secondary)' }}>Admin or manager access required.</div>;
  }

  return (
    <div style={{ background: 'var(--surface-base)', minHeight: '100vh', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Lock className="w-4 h-4" style={{ color: 'var(--sev-critical, #ef4444)' }} />
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em' }}>REMOTE DEVICE LOCK</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--sev-warn, #f59e0b)', marginBottom: 12 }}>
        <AlertTriangle className="w-3 h-3" />
        Use only for lost or stolen devices. Sends an immediate lock signal.
      </div>
      {confirm && (
        <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--sev-critical, #ef4444)', borderRadius: 2, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--text-primary)', marginBottom: 8 }}>Lock unit <strong>{confirm.unit_id}</strong>? This cannot be undone remotely.</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => doLock(confirm)} disabled={locking !== null}
              style={{ fontSize: 9, padding: '4px 12px', background: 'var(--sev-critical, #ef4444)', color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer' }}>
              {locking === confirm.id ? 'Locking…' : 'Confirm Lock'}
            </button>
            <button type="button" onClick={() => setConfirm(null)}
              style={{ fontSize: 9, padding: '4px 12px', background: 'var(--surface-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {units.map(u => (
          <div key={u.id} style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)' }}>{u.unit_id}</div>
              <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{u.full_name ?? ''} · {u.status}</div>
            </div>
            {locked.has(u.id) ? (
              <span style={{ fontSize: 9, color: 'var(--sev-critical, #ef4444)', fontWeight: 600 }}>LOCKED</span>
            ) : (
              <button type="button" onClick={() => setConfirm(u)} disabled={locking !== null}
                style={{ fontSize: 9, padding: '3px 10px', background: 'var(--surface-base)', color: 'var(--sev-critical, #ef4444)', border: '1px solid var(--sev-critical, #ef4444)', borderRadius: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Lock className="w-2.5 h-2.5" /> Lock
              </button>
            )}
          </div>
        ))}
        {units.length === 0 && <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>No active units</div>}
      </div>
    </div>
  );
}
