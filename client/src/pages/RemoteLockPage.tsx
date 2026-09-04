import React, { useState, useEffect, useCallback } from 'react';
import { Lock, Unlock, AlertTriangle, Search, ShieldOff, RefreshCw, Download, Copy } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { parseTimestamp } from '../utils/dateUtils';
import { downloadTextFile, lockUnitsToCsv } from '../utils/rmsListExport';

interface LockUnit {
  unit_id: string;
  officer_name: string;
  badge: string;
  status: 'locked' | 'unlocked';
  locked_at?: string;
  locked_by?: string;
  reason?: string;
}

const QUICK_REASONS = ['Evidence tampering', 'Lost device', 'Unauthorized use', 'Maintenance'];

const LABEL: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--field-label-color)',
};

const CARD: React.CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 2,
  padding: '8px 10px',
};

const BTN_BASE: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 600,
  padding: '3px 10px',
  borderRadius: 2,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  letterSpacing: '0.04em',
};

function fmtTs(ts?: string): string {
  if (!ts) return '';
  try {
    return parseTimestamp(ts).toLocaleString('en-US', {
      timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch {
    return ts;
  }
}

export default function RemoteLockPage() {
  const { user } = useAuth();
  const [units, setUnits] = useState<LockUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'locked' | 'unlocked'>('all');

  // Lock modal state
  const [lockTarget, setLockTarget] = useState<LockUnit | null>(null);
  const [lockReason, setLockReason] = useState('');
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState('');

  // Unlock modal state
  const [unlockTarget, setUnlockTarget] = useState<LockUnit | null>(null);
  const [unlockBusy, setUnlockBusy] = useState(false);

  // Emergency lock all
  const [emergencyStep, setEmergencyStep] = useState<0 | 1 | 2>(0);
  const [emergencyBusy, setEmergencyBusy] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  const poll = useCallback(() => {
    apiFetch<{ units: LockUnit[] }>('/system/lock-status')
      .then(r => {
        if (r?.units) setUnits(r.units);
        setFetchError(false);
        setLastPoll(new Date());
      })
      .catch(() => { setFetchError(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    poll();
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, [isAdmin, poll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLockTarget(null);
        setUnlockTarget(null);
        setEmergencyStep(0);
        setLockError('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function doLock() {
    if (!lockTarget || !lockReason.trim()) { setLockError('Reason is required.'); return; }
    setLockBusy(true);
    setLockError('');
    try {
      await apiFetch('/system/remote-lock', {
        method: 'POST',
        body: JSON.stringify({ unit_id: lockTarget.unit_id, reason: lockReason.trim() }),
      });
      setUnits(prev => prev.map(u =>
        u.unit_id === lockTarget.unit_id
          ? { ...u, status: 'locked', locked_at: new Date().toISOString(), locked_by: user?.full_name ?? user?.username ?? 'You', reason: lockReason.trim() }
          : u
      ));
      setLockTarget(null);
      setLockReason('');
    } catch (e: unknown) {
      setLockError(e instanceof Error ? e.message : 'Lock failed. Try again.');
    } finally {
      setLockBusy(false);
    }
  }

  async function doUnlock() {
    if (!unlockTarget) return;
    setUnlockBusy(true);
    try {
      await apiFetch(`/system/remote-lock/${encodeURIComponent(unlockTarget.unit_id)}`, { method: 'DELETE' });
      setUnits(prev => prev.map(u =>
        u.unit_id === unlockTarget.unit_id
          ? { ...u, status: 'unlocked', locked_at: undefined, locked_by: undefined, reason: undefined }
          : u
      ));
      setUnlockTarget(null);
    } catch {
      // keep modal open; user can retry
    } finally {
      setUnlockBusy(false);
    }
  }

  async function doEmergencyLockAll() {
    setEmergencyBusy(true);
    try {
      const unlocked = units.filter(u => u.status === 'unlocked');
      await Promise.all(unlocked.map(u =>
        apiFetch('/system/remote-lock', {
          method: 'POST',
          body: JSON.stringify({ unit_id: u.unit_id, reason: 'Emergency lock — all units' }),
        })
      ));
      setUnits(prev => prev.map(u => ({
        ...u,
        status: 'locked',
        locked_at: new Date().toISOString(),
        locked_by: user?.full_name ?? user?.username ?? 'You',
        reason: 'Emergency lock — all units',
      })));
    } catch {
      // partial success — re-poll to get real state
      poll();
    } finally {
      setEmergencyBusy(false);
      setEmergencyStep(0);
    }
  }

  if (!isAdmin) {
    return (
      <div style={{ background: 'var(--surface-base)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <ShieldOff style={{ width: 28, height: 28, color: 'var(--text-secondary)', margin: '0 auto 10px' }} />
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Insufficient privileges</div>
          <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Admin or manager role required to access remote lock management.</div>
        </div>
      </div>
    );
  }

  const filtered = units.filter(u => {
    if (statusFilter !== 'all' && u.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.officer_name.toLowerCase().includes(q) || u.badge.toLowerCase().includes(q) || u.unit_id.toLowerCase().includes(q);
  });

  const lockedCount = units.filter(u => u.status === 'locked').length;
  const unlockedCount = units.filter(u => u.status === 'unlocked').length;

  return (
    <div style={{ background: 'var(--surface-base)', minHeight: '100vh', padding: 16, maxWidth: 700 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lock style={{ width: 14, height: 14, color: 'var(--sev-critical)' }} />
          <span style={{ ...LABEL, fontSize: 11 }}>Remote Device Lock</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastPoll && (
            <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
              Updated {lastPoll.toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
            </span>
          )}
          <button type="button" onClick={poll} title="Refresh"
            style={{ ...BTN_BASE, background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', padding: '3px 6px' }}>
            <RefreshCw style={{ width: 10, height: 10 }} />
          </button>
          <button type="button" disabled={filtered.length === 0}
            onClick={() => downloadTextFile('remote-lock-units.csv', lockUnitsToCsv(filtered))}
            title="Export CSV"
            style={{ ...BTN_BASE, background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', padding: '3px 6px', opacity: filtered.length === 0 ? 0.4 : 1 }}>
            <Download style={{ width: 10, height: 10 }} />
          </button>
        </div>
      </div>

      {/* Warning banner */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--sev-warn)', background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: '5px 8px', marginBottom: 12 }}>
        <AlertTriangle style={{ width: 11, height: 11, flexShrink: 0 }} />
        Locking a device will immediately restrict the officer's access. Use only for lost, stolen, or compromised devices.
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'Total', val: units.length, color: 'var(--text-primary)', filter: 'all' as const },
          { label: 'Locked', val: lockedCount, color: 'var(--sev-critical)', filter: 'locked' as const },
          { label: 'Unlocked', val: unlockedCount, color: 'var(--sev-ok)', filter: 'unlocked' as const },
        ].map(s => (
          <button type="button" key={s.label} onClick={() => setStatusFilter(s.filter)}
            style={{ ...CARD, flex: 1, textAlign: 'center', cursor: 'pointer', borderColor: statusFilter === s.filter ? 'var(--brand-400)' : 'var(--border-subtle)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.val}</div>
            <div style={{ ...LABEL, marginTop: 2 }}>{s.label}</div>
          </button>
        ))}
      </div>

      {/* Search + Emergency lock all */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', width: 11, height: 11, color: 'var(--text-secondary)' }} />
          <input
            type="text"
            placeholder="Search by officer, badge, unit…"
            aria-label="Search by officer, badge, or unit"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 24, paddingRight: 8, paddingTop: 5, paddingBottom: 5, fontSize: 10, background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)', outline: 'none' }}
          />
        </div>
        {emergencyStep === 0 && (
          <button type="button" onClick={() => setEmergencyStep(1)}
            style={{ ...BTN_BASE, background: 'transparent', border: '1px solid var(--sev-critical)', color: 'var(--sev-critical)', whiteSpace: 'nowrap' }}>
            <Lock style={{ width: 10, height: 10 }} /> Lock All
          </button>
        )}
        {emergencyStep === 1 && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: 'var(--sev-warn)', whiteSpace: 'nowrap' }}>Lock all {unlockedCount} units?</span>
            <button type="button" onClick={() => setEmergencyStep(2)}
              style={{ ...BTN_BASE, background: 'var(--sev-warn)', border: 'none', color: '#000' }}>
              Confirm
            </button>
            <button type="button" onClick={() => setEmergencyStep(0)}
              style={{ ...BTN_BASE, background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              Cancel
            </button>
          </div>
        )}
        {emergencyStep === 2 && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: 'var(--sev-critical)', whiteSpace: 'nowrap', fontWeight: 700 }}>FINAL CONFIRM</span>
            <button type="button" onClick={doEmergencyLockAll} disabled={emergencyBusy}
              style={{ ...BTN_BASE, background: 'var(--sev-critical)', border: 'none', color: '#fff' }}>
              {emergencyBusy ? 'Locking…' : 'Lock All Now'}
            </button>
            <button type="button" onClick={() => setEmergencyStep(0)} disabled={emergencyBusy}
              style={{ ...BTN_BASE, background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Unit list */}
      {loading ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)', padding: 12 }}>Loading units…</div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)', padding: 12 }}>{search ? 'No units match your search.' : 'No online units.'}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {filtered.map(u => (
            <div key={u.unit_id} style={{
              ...CARD,
              borderColor: u.status === 'locked' ? 'var(--sev-critical)' : 'var(--border-subtle)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              {/* Status icon */}
              <div style={{ flexShrink: 0 }}>
                {u.status === 'locked'
                  ? <Lock style={{ width: 14, height: 14, color: 'var(--sev-critical)' }} />
                  : <Unlock style={{ width: 14, height: 14, color: 'var(--sev-ok)' }} />
                }
              </div>

              {/* Officer info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{u.officer_name}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Badge {u.badge}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>·</span>
                  <span
                    role="button"
                    tabIndex={0}
                    title="Copy unit id"
                    onClick={() => navigator.clipboard.writeText(u.unit_id).catch(() => undefined)}
                    style={{ fontSize: 9, color: 'var(--text-secondary)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  >
                    {u.unit_id} <Copy style={{ width: 8, height: 8 }} />
                  </span>
                  {/* Status badge */}
                  <span style={{
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    padding: '1px 5px',
                    borderRadius: 2,
                    background: u.status === 'locked' ? 'var(--sev-critical)' : 'var(--sev-ok)',
                    color: '#fff',
                  }}>
                    {u.status.toUpperCase()}
                  </span>
                </div>
                {u.status === 'locked' && (
                  <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {u.reason && <span style={{ color: 'var(--sev-critical)' }}>{u.reason}</span>}
                    {u.locked_at && <span> · {fmtTs(u.locked_at)}</span>}
                    {u.locked_by && <span> · by {u.locked_by}</span>}
                  </div>
                )}
              </div>

              {/* Action button */}
              {u.status === 'unlocked' ? (
                <button type="button" onClick={() => { setLockTarget(u); setLockReason(''); setLockError(''); }}
                  style={{ ...BTN_BASE, background: 'transparent', border: '1px solid var(--sev-critical)', color: 'var(--sev-critical)', flexShrink: 0 }}>
                  <Lock style={{ width: 10, height: 10 }} /> Lock
                </button>
              ) : (
                <button type="button" onClick={() => setUnlockTarget(u)}
                  style={{ ...BTN_BASE, background: 'transparent', border: '1px solid var(--sev-ok)', color: 'var(--sev-ok)', flexShrink: 0 }}>
                  <Unlock style={{ width: 10, height: 10 }} /> Unlock
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lock modal */}
      {lockTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0 0 0 / 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--sev-critical)', borderRadius: 2, padding: 18, width: 340, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <Lock style={{ width: 13, height: 13, color: 'var(--sev-critical)' }} />
              <span style={{ ...LABEL, color: 'var(--sev-critical)', fontSize: 10 }}>Lock Device — {lockTarget.officer_name}</span>
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginBottom: 10 }}>
              Badge {lockTarget.badge} · {lockTarget.unit_id}. A lock reason is required.
            </div>

            {/* Quick reason buttons */}
            <div style={{ ...LABEL, marginBottom: 5 }}>Quick reasons</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {QUICK_REASONS.map(r => (
                <button key={r} type="button" onClick={() => setLockReason(r)}
                  style={{
                    ...BTN_BASE,
                    background: lockReason === r ? 'var(--brand-400)' : 'var(--surface-base)',
                    border: `1px solid ${lockReason === r ? 'var(--brand-400)' : 'var(--border-subtle)'}`,
                    color: lockReason === r ? '#fff' : 'var(--text-primary)',
                  }}>
                  {r}
                </button>
              ))}
            </div>

            {/* Custom reason */}
            <div style={{ ...LABEL, marginBottom: 4 }}>Reason</div>
            <input
              type="text"
              value={lockReason}
              onChange={e => { setLockReason(e.target.value); setLockError(''); }}
              placeholder="Enter lock reason…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 10, background: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)', outline: 'none', marginBottom: 4 }}
            />
            {lockError && <div style={{ fontSize: 9, color: 'var(--sev-critical)', marginBottom: 8 }}>{lockError}</div>}

            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              <button type="button" onClick={doLock} disabled={lockBusy || !lockReason.trim()}
                style={{ ...BTN_BASE, background: 'var(--sev-critical)', border: 'none', color: '#fff', flex: 1, justifyContent: 'center', opacity: lockBusy || !lockReason.trim() ? 0.6 : 1 }}>
                <Lock style={{ width: 10, height: 10 }} />
                {lockBusy ? 'Locking…' : 'Confirm Lock'}
              </button>
              <button type="button" onClick={() => { setLockTarget(null); setLockReason(''); setLockError(''); }} disabled={lockBusy}
                style={{ ...BTN_BASE, background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unlock modal */}
      {unlockTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0 0 0 / 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--sev-ok)', borderRadius: 2, padding: 18, width: 320, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Unlock style={{ width: 13, height: 13, color: 'var(--sev-ok)' }} />
              <span style={{ ...LABEL, color: 'var(--sev-ok)', fontSize: 10 }}>Unlock Device — {unlockTarget.officer_name}</span>
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Badge {unlockTarget.badge} · {unlockTarget.unit_id}
              {unlockTarget.reason && <><br />Locked reason: <span style={{ color: 'var(--text-primary)' }}>{unlockTarget.reason}</span></>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={doUnlock} disabled={unlockBusy}
                style={{ ...BTN_BASE, background: 'var(--sev-ok)', border: 'none', color: '#fff', flex: 1, justifyContent: 'center', opacity: unlockBusy ? 0.6 : 1 }}>
                <Unlock style={{ width: 10, height: 10 }} />
                {unlockBusy ? 'Unlocking…' : 'Confirm Unlock'}
              </button>
              <button type="button" onClick={() => setUnlockTarget(null)} disabled={unlockBusy}
                style={{ ...BTN_BASE, background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
