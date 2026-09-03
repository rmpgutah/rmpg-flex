import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Radio, Search, RefreshCw, Users, CheckCircle, AlertCircle, XCircle, X, Download, Copy, Pause } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { downloadTextFile, formatRadioLine, unitsBoardToCsv, unitsBoardToTsv } from '../utils/rmsListExport';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DispatchUnit {
  id: number;
  unit_id: string;
  officer_name: string;
  badge: string;
  status: string;
  role?: string;
  current_call_id?: number | null;
  current_call_number?: string | null;
  location_description?: string | null;
  queued_call_ids?: number[];
}

type FilterMode = 'ALL' | 'AVAILABLE' | 'ON-CALL' | 'OUT';

const STATUS_LABELS: Record<string, string> = {
  available: 'Available',
  busy: 'Busy',
  'on-call': 'On Call',
  'traffic-stop': 'Traffic Stop',
  'out-of-service': 'Out of Service',
};

const CHANGEABLE_STATUSES = [
  'available',
  'busy',
  'on-call',
  'traffic-stop',
  'out-of-service',
];

// ─── Status helpers ───────────────────────────────────────────────────────────

function statusColorClass(status: string): string {
  switch (status) {
    case 'available':
      return 'text-[color:var(--sev-ok)]';
    case 'busy':
      return 'text-[color:var(--sev-warn)]';
    case 'on-call':
      return 'text-[color:var(--sev-critical)]';
    case 'traffic-stop':
      return 'text-[color:var(--sev-warn)]';
    case 'out-of-service':
    default:
      return 'text-[color:var(--text-secondary)]';
  }
}

function statusBgClass(status: string): string {
  switch (status) {
    case 'available':
      return 'bg-[color:var(--sev-ok)]/15 border border-[color:var(--sev-ok)]/30';
    case 'busy':
      return 'bg-[color:var(--sev-warn)]/15 border border-[color:var(--sev-warn)]/30';
    case 'on-call':
      return 'bg-[color:var(--sev-critical)]/15 border border-[color:var(--sev-critical)]/30';
    case 'traffic-stop':
      return 'bg-[color:var(--sev-warn)]/10 border border-[color:var(--sev-warn)]/25';
    case 'out-of-service':
    default:
      return 'bg-[color:var(--surface-sunken)]/50 border border-[color:var(--border-subtle)]';
  }
}

function statusDotClass(status: string): string {
  switch (status) {
    case 'available':
      return 'bg-[color:var(--sev-ok)]';
    case 'busy':
      return 'bg-[color:var(--sev-warn)]';
    case 'on-call':
      return 'bg-[color:var(--sev-critical)]';
    case 'traffic-stop':
      return 'bg-[color:var(--sev-warn)]';
    case 'out-of-service':
    default:
      return 'bg-[color:var(--text-secondary)]';
  }
}

function matchesFilter(unit: DispatchUnit, filter: FilterMode): boolean {
  switch (filter) {
    case 'AVAILABLE':
      return unit.status === 'available';
    case 'ON-CALL':
      return unit.status === 'on-call' || unit.status === 'busy' || unit.status === 'traffic-stop';
    case 'OUT':
      return unit.status === 'out-of-service';
    default:
      return true;
  }
}

// ─── Status Change Modal ──────────────────────────────────────────────────────

interface StatusModalProps {
  unit: DispatchUnit;
  onClose: () => void;
  onSave: (unitId: number, status: string) => Promise<void>;
}

function StatusModal({ unit, onClose, onSave }: StatusModalProps) {
  const [selected, setSelected] = useState(unit.status);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (selected === unit.status) { onClose(); return; }
    setSaving(true);
    try {
      await onSave(unit.id, selected);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [selected, unit, onSave, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="rounded-[2px] shadow-2xl w-80 overflow-hidden"
        style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2" style={{ background: 'var(--surface-base)', borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--field-label-color)' }}>
            Change Unit Status
          </span>
          <button onClick={onClose} className="p-0.5 rounded-[2px] hover:bg-white/10 transition-colors">
            <X size={13} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
        <div className="p-3">
          <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
            Unit <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{unit.unit_id}</span> — {unit.officer_name}
          </p>
          <div className="space-y-1">
            {CHANGEABLE_STATUSES.map(s => (
              <button
                key={s}
                onClick={() => setSelected(s)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[2px] text-xs transition-colors"
                style={{
                  background: selected === s ? 'var(--surface-sunken)' : 'transparent',
                  border: selected === s ? '1px solid var(--border-default)' : '1px solid transparent',
                  color: 'var(--text-primary)',
                }}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(s)}`} />
                {STATUS_LABELS[s] ?? s}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={onClose}
              className="flex-1 py-1 text-xs rounded-[2px] transition-colors"
              style={{ background: 'var(--surface-sunken)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-1 text-xs rounded-[2px] font-semibold transition-colors disabled:opacity-50"
              style={{ background: 'var(--brand-500)', color: '#fff', border: 'none' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Unit Card ────────────────────────────────────────────────────────────────

interface UnitCardProps {
  unit: DispatchUnit;
  canChangeStatus: boolean;
  onClick: () => void;
}

function UnitCard({ unit, canChangeStatus, onClick }: UnitCardProps) {
  const label = STATUS_LABELS[unit.status] ?? unit.status;

  return (
    <div
      className={`relative flex flex-col gap-1.5 p-2.5 rounded-[2px] transition-all ${canChangeStatus ? 'cursor-pointer hover:brightness-110' : ''}`}
      style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', minWidth: 180, maxWidth: 220, width: '100%' }}
      onClick={canChangeStatus ? onClick : undefined}
      title={canChangeStatus ? 'Click to change status' : undefined}
    >
      {/* Badge + unit id row */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          <Shield size={11} style={{ color: 'var(--field-label-color)', flexShrink: 0 }} />
          <span className="text-[10px] font-bold tracking-wide" style={{ color: 'var(--field-label-color)' }}>
            #{unit.badge}
          </span>
        </div>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[2px]" style={{ background: 'var(--surface-sunken)', color: 'var(--text-secondary)' }}>
          {unit.unit_id}
        </span>
        <button
          type="button"
          title="Copy radio line"
          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(formatRadioLine(unit)).catch(() => undefined); }}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-secondary)' }}
        >
          <Copy size={10} />
        </button>
      </div>

      {/* Officer name */}
      <p className="text-[11px] font-semibold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
        {unit.officer_name}
      </p>

      {/* Status badge */}
      <div className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-[2px] self-start ${statusBgClass(unit.status)}`}>
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotClass(unit.status)}`} />
        <span className={`text-[10px] font-semibold ${statusColorClass(unit.status)}`}>{label}</span>
      </div>

      {/* Call number if on call + queued count */}
      {unit.current_call_number && (
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          <Radio size={10} style={{ color: 'var(--sev-critical)', flexShrink: 0 }} />
          <span className="text-[10px] font-mono" style={{ color: 'var(--sev-critical)' }}>
            Call {unit.current_call_number}
          </span>
          {(unit.queued_call_ids?.length ?? 0) > 0 && (
            <span
              className="text-[9px] font-semibold px-1 rounded-[2px]"
              style={{ background: 'var(--sev-warn)', color: 'var(--text-on-warn)', lineHeight: '14px' }}
              title={`${unit.queued_call_ids!.length} call${unit.queued_call_ids!.length > 1 ? 's' : ''} queued`}
            >
              +{unit.queued_call_ids!.length} queued
            </span>
          )}
        </div>
      )}

      {/* Location */}
      {unit.location_description && (
        <p className="text-[9px] truncate" style={{ color: 'var(--text-secondary)' }}>
          {unit.location_description}
        </p>
      )}

      {/* Role tag */}
      {unit.role && (
        <p className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          {unit.role}
        </p>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UnitStatusBoardPage() {
  const { user } = useAuth();
  const [units, setUnits] = useState<DispatchUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('ALL');
  const [search, setSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [modalUnit, setModalUnit] = useState<DispatchUnit | null>(null);
  const [pollMs, setPollMs] = useState(20_000);
  const [engagedFirst, setEngagedFirst] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const isAdmin = user?.role === 'admin';
  const isSupervisor = isAdmin || user?.role === 'supervisor' || user?.role === 'manager';

  const canChangeStatus = isAdmin;

  // ── Fetch ────────────────────────────────────────────────────────────────────

  const fetchUnits = useCallback(async () => {
    try {
      const data = await apiFetch<DispatchUnit[]>('/dispatch/units');
      if (!mountedRef.current) return;
      setUnits(Array.isArray(data) ? data : []);
      setLastUpdated(new Date());
      setSecondsAgo(0);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load units');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUnits();
    if (pollMs <= 0) return;
    const interval = setInterval(fetchUnits, pollMs);
    return () => clearInterval(interval);
  }, [fetchUnits, pollMs]);

  // ── Seconds-ago ticker ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!lastUpdated) return;
    const tick = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
    }, 1_000);
    return () => clearInterval(tick);
  }, [lastUpdated]);

  // ── Status change ────────────────────────────────────────────────────────────

  const handleStatusChange = useCallback(async (unitId: number, status: string) => {
    try {
      await apiFetch(`/dispatch/units/${unitId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setToast('Status updated');
      setTimeout(() => setToast(null), 2500);
      await fetchUnits();
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : 'Status change failed');
      setTimeout(() => setToast(null), 3500);
      throw e;
    }
  }, [fetchUnits]);

  // ── Counts ──────────────────────────────────────────────────────────────────

  const countAvailable = units.filter(u => u.status === 'available').length;
  const countOnCall = units.filter(u => u.status === 'on-call' || u.status === 'busy' || u.status === 'traffic-stop').length;
  const countOut = units.filter(u => u.status === 'out-of-service').length;

  // ── Filtered list ────────────────────────────────────────────────────────────

  const q = search.trim().toLowerCase();
  let visible = units.filter(u => {
    if (!matchesFilter(u, filter)) return false;
    if (!q) return true;
    return (
      (u.officer_name?.toLowerCase() ?? '').includes(q) ||
      (u.badge?.toLowerCase() ?? '').includes(q) ||
      (u.unit_id?.toLowerCase() ?? '').includes(q) ||
      (u.current_call_number?.toLowerCase() ?? '').includes(q)
    );
  });
  if (engagedFirst) {
    visible = [...visible].sort((a, b) => {
      const rank = (s: string) => (s === 'available' ? 2 : s === 'out-of-service' ? 3 : 1);
      return rank(a.status) - rank(b.status);
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);
      if (e.key === 'Escape') {
        setModalUnit(null);
        setSearch('');
      }
      if (typing) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'r' || e.key === 'R') { setLoading(true); fetchUnits(); }
      if (e.key === 'a' || e.key === 'A') setFilter('AVAILABLE');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fetchUnits]);

  // ── Filter tab helper ────────────────────────────────────────────────────────

  const filterBtn = (mode: FilterMode, label: string, count?: number) => (
    <button
      key={mode}
      onClick={() => setFilter(mode)}
      className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-[2px] transition-colors"
      style={{
        background: filter === mode ? 'var(--brand-600)' : 'var(--surface-sunken)',
        color: filter === mode ? 'var(--text-on-brand)' : 'var(--text-secondary)',
        border: filter === mode ? '1px solid var(--brand-500)' : '1px solid var(--border-subtle)',
      }}
    >
      {label}{count !== undefined ? ` (${count})` : ''}
    </button>
  );

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--surface-base)', color: 'var(--text-primary)' }}>
      <PanelTitleBar title="UNIT STATUS BOARD" icon={Users} />

      {/* Counts bar */}
      <div
        className="flex items-center gap-4 px-4 py-2 flex-wrap"
        style={{ background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-1.5">
          <CheckCircle size={12} style={{ color: 'var(--sev-ok)' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-bold" style={{ color: 'var(--sev-ok)' }}>{countAvailable}</span> Available
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <AlertCircle size={12} style={{ color: 'var(--sev-warn)' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-bold" style={{ color: 'var(--sev-warn)' }}>{countOnCall}</span> Engaged
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <XCircle size={12} style={{ color: 'var(--text-secondary)' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-bold">{countOut}</span> Out of Service
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <RefreshCw size={10} style={{ color: 'var(--text-secondary)' }} />
          <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            {lastUpdated
              ? secondsAgo < 5
                ? 'Just updated'
                : `Updated ${secondsAgo}s ago`
              : 'Loading…'}
          </span>
          <button
            onClick={() => { setLoading(true); fetchUnits(); }}
            className="ml-1 px-1.5 py-0.5 text-[10px] rounded-[2px] transition-colors"
            style={{ background: 'var(--surface-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
            title="Refresh now"
          >
            Refresh
          </button>
          <select
            value={String(pollMs)}
            onChange={e => setPollMs(Number(e.target.value))}
            className="text-[10px] rounded-[2px] px-1 py-0.5"
            style={{ background: 'var(--surface-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
            title="Auto-refresh"
          >
            <option value="10000">10s</option>
            <option value="20000">20s</option>
            <option value="30000">30s</option>
            <option value="0">Pause</option>
          </select>
          {pollMs === 0 && <Pause size={10} style={{ color: 'var(--text-secondary)' }} />}
          <button
            type="button"
            disabled={visible.length === 0}
            onClick={() => downloadTextFile('unit-status.csv', unitsBoardToCsv(visible))}
            className="px-1.5 py-0.5 text-[10px] rounded-[2px]"
            style={{ background: 'var(--surface-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            <Download size={10} className="inline" /> CSV
          </button>
          <button
            type="button"
            disabled={visible.length === 0}
            onClick={() => navigator.clipboard.writeText(unitsBoardToTsv(visible)).then(() => { setToast('Copied TSV'); setTimeout(() => setToast(null), 2000); }).catch(() => undefined)}
            className="px-1.5 py-0.5 text-[10px] rounded-[2px]"
            style={{ background: 'var(--surface-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            Copy TSV
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-4 py-2 flex-wrap"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        {/* Filter buttons */}
        <div className="flex items-center gap-1">
          {filterBtn('ALL', 'All', units.length)}
          {filterBtn('AVAILABLE', 'Available', countAvailable)}
          {filterBtn('ON-CALL', 'On Call', countOnCall)}
          {filterBtn('OUT', 'Out', countOut)}
        </div>
        <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={engagedFirst} onChange={e => setEngagedFirst(e.target.checked)} />
          Engaged first
        </label>
        {toast && <span className="text-[10px]" style={{ color: 'var(--text-primary)' }}>{toast}</span>}

        {/* Search */}
        <div className="relative ml-auto">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Officer, badge, call… (/)"
            className="pl-6 pr-2 py-1 text-[11px] rounded-[2px] outline-none w-48"
            style={{
              background: 'var(--surface-sunken)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2"
            >
              <X size={10} style={{ color: 'var(--text-secondary)' }} />
            </button>
          )}
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && units.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Loading units…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <AlertCircle size={20} style={{ color: 'var(--sev-critical)' }} />
            <p className="text-xs" style={{ color: 'var(--sev-critical)' }}>{error}</p>
            <button
              onClick={fetchUnits}
              className="px-2 py-1 text-[11px] rounded-[2px]"
              style={{ background: 'var(--surface-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
            >
              Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Users size={24} style={{ color: 'var(--text-secondary)', opacity: 0.4 }} />
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {units.length === 0 ? 'No on-duty units' : 'No units match filter'}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visible.map(unit => (
              <UnitCard
                key={unit.id}
                unit={unit}
                canChangeStatus={canChangeStatus}
                onClick={() => setModalUnit(unit)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status change modal */}
      {modalUnit && (
        <StatusModal
          unit={modalUnit}
          onClose={() => setModalUnit(null)}
          onSave={handleStatusChange}
        />
      )}
    </div>
  );
}
