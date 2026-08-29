import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import type { ContextMenuItem } from '../context/ContextMenuContext';
import { Bell, AlertTriangle, ShieldCheck, DollarSign, Plus, Pencil, Trash2, Eye } from 'lucide-react';

import { formatEnumValue } from '../utils/formatters';
import ViewOnMapLink from '../components/ViewOnMapLink';
import { alarmAccountsToCsv, downloadTextFile } from '../utils/rmsListExport';

interface AlarmAccount {
  id: number;
  account_number: string;
  account_name: string;
  address: string;
  contact_name: string;
  contact_phone: string;
  permit_number: string;
  permit_status: string;
  permit_expiry: string;
  alarm_type: string;
  false_alarm_count: number;
  status: string;
  notes: string;
}
interface AlarmStats {
  totalAlarms: number;
  falseAlarms: number;
  permitsActive: number;
  permitsExpired: number;
  revenueCollected: number;
}

const EMPTY_FORM = {
  account_number: '',
  account_name: '',
  address: '',
  contact_name: '',
  contact_phone: '',
  permit_number: '',
  permit_status: 'active',
  permit_expiry: '',
  alarm_type: 'burglary',
  false_alarm_count: 0,
  status: 'active',
  notes: '',
};

// Roles that may create / edit alarm accounts (mirrors server WRITE_ROLES)
const WRITE_ROLES = new Set(['admin', 'manager', 'supervisor']);
// Roles that may delete alarm accounts (mirrors server DELETE_ROLES)
const DELETE_ROLES = new Set(['admin', 'manager']);

type LoadState = 'loading' | 'ok' | 'error';

export default function AlarmManagementPage() {
  const { user } = useAuth();
  const canWrite  = WRITE_ROLES.has(user?.role ?? '');
  const canDelete = DELETE_ROLES.has(user?.role ?? '');

  const [searchParams, setSearchParams] = useSearchParams();

  const [accounts, setAccounts] = useState<AlarmAccount[]>([]);
  const [stats, setStats] = useState<AlarmStats>({
    totalAlarms: 0,
    falseAlarms: 0,
    permitsActive: 0,
    permitsExpired: 0,
    revenueCollected: 0,
  });
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const searchRef = useRef<HTMLInputElement>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AlarmAccount | null>(null);
  const [formData, setFormData] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AlarmAccount | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { addToast } = useToast();
  const m = useMenuActions();

  // Deep-link: capture param ONCE at mount before any setSearchParams wipes it.
  const pendingAlarmIdRef = useRef<string | null>(searchParams.get('alarm_id'));

  const fetchData = useCallback(async () => {
    try {
      const a = await apiFetch<AlarmAccount[]>('/alarms/accounts');
      const s = await apiFetch<AlarmStats>('/alarms/stats').catch(
        () => ({ totalAlarms: 0, falseAlarms: 0, permitsActive: 0, permitsExpired: 0, revenueCollected: 0 } as AlarmStats),
      );
      setAccounts(a);
      setStats(s);
      setLoadState('ok');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // -- Deep-link hydration --
  // Applied once after first successful data load. Strips ?alarm_id= after
  // use so a refresh does not re-open the modal. Mirrors VictimServicesPage.
  useEffect(() => {
    if (loadState !== 'ok') return;

    const raw = pendingAlarmIdRef.current;
    if (!raw) return;
    pendingAlarmIdRef.current = null;

    const next = new URLSearchParams(searchParams);
    next.delete('alarm_id');
    setSearchParams(next, { replace: true });

    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) return;

    const hit = accounts.find((a) => a.id === id);
    if (hit) {
      openEdit(hit);
    } else {
      apiFetch<AlarmAccount>(`/alarms/accounts/${id}`)
        .then((rec) => { if (rec) openEdit(rec); })
        .catch(() => addToast(`Alarm account #${id} not found`, 'warning'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState]);

  // -- Keyboard shortcuts --
  // N  -> open New Account modal (canWrite only, not while typing in a field).
  // Esc -> close smallest-open-first: delete confirm > form modal.
  useEffect(() => {
    const isTypingInField = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    };

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteTarget !== null) { e.stopPropagation(); setDeleteTarget(null); return; }
        if (formOpen)              { e.stopPropagation(); setFormOpen(false);    return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if ((e.key === 'n' || e.key === 'N') && canWrite) {
        e.preventDefault();
        openNew();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteTarget, formOpen, canWrite]);

  const openNew = () => {
    setEditingRecord(null);
    setFormData({ ...EMPTY_FORM });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (rec: AlarmAccount) => {
    setEditingRecord(rec);
    setFormData({ ...rec } as typeof EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const handleSave = async () => {
    setFormSubmitting(true);
    setFormError(null);
    try {
      if (editingRecord) {
        await apiFetch(`/alarms/accounts/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
        addToast('Account updated', 'success');
      } else {
        await apiFetch('/alarms/accounts', { method: 'POST', body: JSON.stringify(formData) });
        addToast('Account created', 'success');
      }
      setFormOpen(false);
      fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setFormError(msg);
      addToast(msg, 'error');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/alarms/accounts/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      fetchData();
      addToast('Account deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = accounts.filter((a) => {
    if (typeFilter !== 'ALL' && a.alarm_type !== typeFilter) return false;
    if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
    if (!q) return true;
    return (
      a.account_name.toLowerCase().includes(q) ||
      a.account_number.toLowerCase().includes(q) ||
      a.address.toLowerCase().includes(q)
    );
  });
  const hasFilter = !!q || typeFilter !== 'ALL' || statusFilter !== 'ALL';

  const columns = [
    { key: 'account_number', label: 'Account #' },
    { key: 'account_name', label: 'Name' },
    {
      key: 'address',
      label: 'Address',
      render: (r: AlarmAccount) => (
        <span className="flex items-center gap-1.5">
          {r.address}
          <ViewOnMapLink address={r.address} label={r.account_name} />
        </span>
      ),
    },
    {
      key: 'permit_status',
      label: 'Permit',
      render: (r: AlarmAccount) => (
        <span className={`badge ${r.permit_status === 'active' ? 'badge-available' : r.permit_status === 'expired' ? 'badge-busy' : 'badge-pending'}`}>
          {formatEnumValue(r.permit_status)}
        </span>
      ),
    },
    { key: 'false_alarm_count', label: 'False Alarms' },
    {
      key: 'status',
      label: 'Status',
      render: (r: AlarmAccount) => (
        <span className={`badge ${r.status === 'active' ? 'badge-available' : 'badge-p4'}`}>
          {formatEnumValue(r.status)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: '80px',
      render: (r: AlarmAccount) => (
        <div className="flex gap-2">
          {canWrite && (
            <button
              onClick={(e) => { e.stopPropagation(); openEdit(r); }}
              className="text-rmpg-400 hover:text-rmpg-100"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}
              className="text-red-500 hover:text-red-300"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const falseRate = stats.totalAlarms > 0 ? Math.round((stats.falseAlarms / stats.totalAlarms) * 100) : 0;

  // -- Empty-state helpers --
  const emptyMessage =
    loadState === 'loading' ? 'Loading alarm accounts...' :
    loadState === 'error'   ? 'Failed to load alarm accounts' :
    hasFilter               ? 'No accounts match the current filter' :
                              'No alarm accounts on file';

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="ALARM MANAGEMENT" icon={Bell}>
        {canWrite && (
          <button
            onClick={openNew}
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 28, padding: '0 10px' }}
            title="New alarm account (N)"
          >
            <Plus size={13} /> New Account
          </button>
        )}
      </PanelTitleBar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL ALARMS"     value={String(stats.totalAlarms)}                              icon={Bell} />
        <StatsCard label="FALSE ALARM RATE" value={`${falseRate}%`}                                       icon={AlertTriangle} />
        <StatsCard label="ACTIVE PERMITS"   value={String(stats.permitsActive)}                           icon={ShieldCheck} />
        <StatsCard label="REVENUE"          value={`$${(stats.revenueCollected || 0).toLocaleString()}`} icon={DollarSign} />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search accounts…"
          className="input-dark text-xs w-64"
          style={{ height: 28 }}
          aria-label="Search alarm accounts"
        />
        <select
          aria-label="Filter by alarm type"
          className="select-dark text-xs h-7"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="ALL">All types</option>
          <option value="burglary">Burglary</option>
          <option value="robbery">Robbery</option>
          <option value="panic">Panic</option>
          <option value="fire">Fire</option>
          <option value="medical">Medical</option>
          <option value="other">Other</option>
        </select>
        <select
          aria-label="Filter by status"
          className="select-dark text-xs h-7"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="ALL">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button
          type="button"
          className="toolbar-btn"
          style={{ height: 28, padding: '0 10px' }}
          disabled={filtered.length === 0}
          onClick={() => downloadTextFile('alarm-accounts.csv', alarmAccountsToCsv(filtered))}
        >CSV</button>
      </div>

      {loadState === 'error' && (
        <div className="p-3 text-xs text-red-400 flex items-center justify-between">
          <span>Failed to load alarm accounts.</span>
          <button type="button" className="toolbar-btn" onClick={() => { setLoadState('loading'); void fetchData(); }}>Retry</button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={filtered}
        emptyMessage={emptyMessage}
        onRowClick={canWrite ? openEdit : undefined}
        enableContextMenu
        rowContextMenu={(row: AlarmAccount): ContextMenuItem[] => [
          m.action('Open', () => openEdit(row), { icon: <Eye size={12} /> }),
          ...(canWrite  ? [m.action('Edit',   () => openEdit(row),        { icon: <Pencil size={12} /> })] : []),
          m.separator(),
          m.copyId(row.id),
          m.copy('Copy account #', row.account_number),
          ...(canDelete ? [m.action('Delete', () => setDeleteTarget(row), { danger: true, icon: <Trash2 size={12} /> })] : []),
        ]}
      />

      {/* New / Edit form modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto p-4"
          onClick={() => setFormOpen(false)}
        >
          <div
            className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full my-auto"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">
              {editingRecord ? 'Edit Account' : 'New Account'}
            </h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ff-alarm-0" className="text-[9px] text-rmpg-400 uppercase font-bold">Account # *</label>
                <input id="ff-alarm-0" value={formData.account_number} onChange={(e) => setFormData({ ...formData, account_number: e.target.value })} className="input-dark w-full mt-1 text-xs" />
              </div>
              <div>
                <label htmlFor="ff-alarm-1" className="text-[9px] text-rmpg-400 uppercase font-bold">Name *</label>
                <input id="ff-alarm-1" value={formData.account_name} onChange={(e) => setFormData({ ...formData, account_name: e.target.value })} className="input-dark w-full mt-1 text-xs" />
              </div>
              <div className="col-span-2">
                <label htmlFor="ff-alarm-2" className="text-[9px] text-rmpg-400 uppercase font-bold">Address *</label>
                <input id="ff-alarm-2" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="input-dark w-full mt-1 text-xs" />
              </div>
              <div>
                <label htmlFor="ff-alarm-3" className="text-[9px] text-rmpg-400 uppercase font-bold">Contact</label>
                <input id="ff-alarm-3" value={formData.contact_name} onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })} className="input-dark w-full mt-1 text-xs" />
              </div>
              <div>
                <label htmlFor="ff-alarm-4" className="text-[9px] text-rmpg-400 uppercase font-bold">Phone</label>
                <input id="ff-alarm-4" value={formData.contact_phone} onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })} className="input-dark w-full mt-1 text-xs" />
              </div>
              <div>
                <label htmlFor="ff-alarm-5" className="text-[9px] text-rmpg-400 uppercase font-bold">Permit #</label>
                <input id="ff-alarm-5" value={formData.permit_number} onChange={(e) => setFormData({ ...formData, permit_number: e.target.value })} className="input-dark w-full mt-1 text-xs" />
              </div>
              <div>
                <label htmlFor="ff-alarm-6" className="text-[9px] text-rmpg-400 uppercase font-bold">Permit Status</label>
                <select id="ff-alarm-6" value={formData.permit_status} onChange={(e) => setFormData({ ...formData, permit_status: e.target.value })} className="input-dark w-full mt-1 text-xs">
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="suspended">Suspended</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
              <div>
                <label htmlFor="ff-alarm-7" className="text-[9px] text-rmpg-400 uppercase font-bold">Permit Expiry</label>
                <input id="ff-alarm-7" type="date" value={formData.permit_expiry} onChange={(e) => setFormData({ ...formData, permit_expiry: e.target.value })} className="input-dark w-full mt-1 text-xs" />
              </div>
              <div>
                <label htmlFor="ff-alarm-8" className="text-[9px] text-rmpg-400 uppercase font-bold">Alarm Type</label>
                <select id="ff-alarm-8" value={formData.alarm_type} onChange={(e) => setFormData({ ...formData, alarm_type: e.target.value })} className="input-dark w-full mt-1 text-xs">
                  <option value="burglary">Burglary</option>
                  <option value="robbery">Robbery</option>
                  <option value="panic">Panic</option>
                  <option value="fire">Fire</option>
                  <option value="medical">Medical</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label htmlFor="ff-alarm-9" className="text-[9px] text-rmpg-400 uppercase font-bold">False Alarms</label>
                <input id="ff-alarm-9" type="number" value={formData.false_alarm_count} onChange={(e) => setFormData({ ...formData, false_alarm_count: parseInt(e.target.value) || 0 })} className="input-dark w-full mt-1 text-xs" />
              </div>
              <div>
                <label htmlFor="ff-alarm-10" className="text-[9px] text-rmpg-400 uppercase font-bold">Status</label>
                <select id="ff-alarm-10" value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} className="input-dark w-full mt-1 text-xs">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="no_response">No Response</option>
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor="ff-alarm-11" className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label>
              <textarea id="ff-alarm-11" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="input-dark w-full mt-1 text-xs" rows={3} />
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setFormOpen(false)} className="toolbar-btn px-4" style={{ height: 28 }}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={formSubmitting || !formData.account_number || !formData.account_name || !formData.address}
                className="toolbar-btn toolbar-btn-primary px-4"
                style={{ height: 28 }}
              >
                {formSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation (ConfirmDialog replaces inline modal) */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Alarm Account"
        message="This permanently removes this alarm account and cannot be undone."
        details={
          deleteTarget
            ? <><span className="font-semibold">{deleteTarget.account_name}</span>{' — '}{deleteTarget.account_number}</>
            : undefined
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleting}
      />
    </div>
  );
}
