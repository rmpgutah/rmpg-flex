import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { Heart, Shield, Phone, FileText, Plus, Pencil, Trash2, Users, Eye } from 'lucide-react';

import { formatEnumValue } from '../utils/formatters';
import { victimCasesToCsv, downloadTextFile } from '../utils/rmsListExport';

interface Victim {
  id: number;
  victim_name: string;
  case_number: string;
  crime_type: string;
  status: string;
  phone: string;
  email: string;
  safety_plan: number;
  protective_order: number;
  notes: string;
}
interface Stats { totalVictims: number; activeVictims: number; safetyPlans: number; }

const EMPTY_FORM = {
  victim_name: '', case_number: '', crime_type: '', status: 'active',
  phone: '', email: '', address: '', safety_plan: 0, protective_order: 0, notes: '',
};

// Roles that may create / edit / delete victim records.
const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);

export default function VictimServicesPage() {
  const { user } = useAuth();
  const canManage = MANAGE_ROLES.has(user?.role ?? '');

  const [searchParams, setSearchParams] = useSearchParams();

  const [victims, setVictims] = useState<Victim[]>([]);
  const [stats, setStats] = useState<Stats>({ totalVictims: 0, activeVictims: 0, safetyPlans: 0 });
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const searchRef = useRef<HTMLInputElement>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Victim | null>(null);
  const [formData, setFormData] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Track the full row so the delete dialog can surface name + case + crime type.
  const [deleteTarget, setDeleteTarget] = useState<Victim | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { addToast } = useToast();
  const m = useMenuActions();

  // Deep-link: read params ONCE at mount so they survive later setSearchParams calls.
  const pendingVictimIdRef = useRef<string | null>(searchParams.get('victim_id'));
  const pendingCaseIdRef   = useRef<string | null>(searchParams.get('case_id'));

  const fetchData = useCallback(async () => {
    try {
      const v = await apiFetch<Victim[]>('/victim-services/victims');
      const s = await apiFetch<Stats>('/victim-services/stats').catch(
        () => ({ totalVictims: 0, activeVictims: 0, safetyPlans: 0 } as Stats),
      );
      setVictims(v);
      setStats(s);
      setLoadState('ok');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // -- Deep-link hydration --
  // Applied once after first successful data load. Strips params after
  // use so refresh does not loop. Mirrors AffairsPage / DashCamerasPage.
  useEffect(() => {
    if (loadState !== 'ok') return;

    const victimIdRaw = pendingVictimIdRef.current;
    const caseIdRaw   = pendingCaseIdRef.current;
    if (!victimIdRaw && !caseIdRaw) return;

    pendingVictimIdRef.current = null;
    pendingCaseIdRef.current   = null;

    const next = new URLSearchParams(searchParams);
    next.delete('victim_id');
    next.delete('case_id');

    if (victimIdRaw) {
      const id = Number(victimIdRaw);
      if (Number.isFinite(id) && id > 0) {
        const hit = victims.find((v) => v.id === id);
        if (hit) {
          openEdit(hit);
        } else {
          // Fetch the individual record (may be outside the 200-row page slice).
          apiFetch<Victim>(`/victim-services/victims/${id}`)
            .then((rec) => { if (rec) openEdit(rec); })
            .catch(() => addToast(`Victim #${id} not found`, 'warning'));
        }
      }
    } else if (caseIdRaw) {
      const caseNum = caseIdRaw.trim();
      const hit = victims.find((v) => v.case_number === caseNum);
      if (hit) {
        openEdit(hit);
      } else {
        addToast(`No victim record found for case ${caseNum}`, 'warning');
      }
    }

    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState]);

  // -- Keyboard shortcuts --
  // N opens the New modal (canManage only, not while typing).
  // Esc closes the smallest-open-first: delete confirm > form modal.
  useEffect(() => {
    const isTypingInField = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    };

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteTarget) { e.stopPropagation(); setDeleteTarget(null); return; }
        if (formOpen)     { e.stopPropagation(); setFormOpen(false);    return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if ((e.key === 'n' || e.key === 'N') && canManage) {
        e.preventDefault();
        openNew();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteTarget, formOpen, canManage]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => {
    setEditingRecord(null);
    setFormData({ ...EMPTY_FORM });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (rec: Victim) => {
    setEditingRecord(rec);
    setFormData({ ...EMPTY_FORM, ...rec });
    setFormError(null);
    setFormOpen(true);
  };

  const handleSave = async () => {
    setFormSubmitting(true);
    setFormError(null);
    try {
      if (editingRecord) {
        await apiFetch(`/victim-services/victims/${editingRecord.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
        addToast('Record updated', 'success');
      } else {
        await apiFetch('/victim-services/victims', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
        addToast('Victim added', 'success');
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
      await apiFetch(`/victim-services/victims/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      fetchData();
      addToast('Record deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // -- Filtered view --
  const needle = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return victims.filter((v) => {
      if (statusFilter !== 'ALL' && v.status !== statusFilter) return false;
      if (!needle) return true;
      const blob = [v.victim_name, v.case_number, v.crime_type, v.status]
        .join(' ')
        .toLowerCase();
      return blob.includes(needle);
    });
  }, [victims, needle, statusFilter]);

  const hasFilter = !!needle || statusFilter !== 'ALL';

  const columns = [
    { key: 'victim_name', label: 'Name' },
    { key: 'case_number', label: 'Case #' },
    { key: 'crime_type', label: 'Crime Type' },
    {
      key: 'status', label: 'Status',
      render: (r: Victim) => (
        <span className={`badge ${r.status === 'active' ? 'badge-p1' : 'badge-p4'}`}>
          {formatEnumValue(r.status)}
        </span>
      ),
    },
    {
      key: 'safety_plan', label: 'Safety Plan',
      render: (r: Victim) => r.safety_plan
        ? <span className="text-green-400">Yes</span>
        : <span className="text-rmpg-500">No</span>,
    },
    {
      key: 'protective_order', label: 'PO',
      render: (r: Victim) => r.protective_order
        ? <span className="text-green-400">Yes</span>
        : <span className="text-rmpg-500">No</span>,
    },
    {
      key: 'actions', label: '', width: '80px',
      render: (r: Victim) => (
        <div className="flex gap-2">
          {canManage && (
            <button
              onClick={(e) => { e.stopPropagation(); openEdit(r); }}
              className="text-rmpg-400 hover:text-rmpg-100"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
          )}
          {canManage && (
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

  // Three-state empty message: loading / fetch error / no data / no search results.
  const emptyMessage =
    loadState === 'loading' ? 'Loading…'
    : loadState === 'error'   ? 'Failed to load victim records'
    : hasFilter               ? 'No records match the current filter'
    :                           'No victim records on file';

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="VICTIM SERVICES" icon={Heart}>
        <input
          ref={searchRef}
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-dark text-xs h-[28px] w-44"
          aria-label="Search victim records"
        />
        <select
          aria-label="Filter by status"
          className="select-dark text-xs h-7"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="ALL">All statuses</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
          <option value="referred">Referred</option>
          <option value="pending">Pending</option>
        </select>
        <button
          type="button"
          className="toolbar-btn"
          style={{ height: 28, padding: '0 10px' }}
          disabled={filtered.length === 0}
          onClick={() => downloadTextFile('victim-cases.csv', victimCasesToCsv(filtered))}
        >CSV</button>
        {canManage && (
          <button
            onClick={openNew}
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 28, padding: '0 10px' }}
            title="New Victim (N)"
          >
            <Plus size={13} /> New Victim
          </button>
        )}
      </PanelTitleBar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL VICTIMS"  value={String(stats.totalVictims)}  icon={Users}    />
        <StatsCard label="ACTIVE CASES"   value={String(stats.activeVictims)} icon={Shield}   />
        <StatsCard label="SAFETY PLANS"   value={String(stats.safetyPlans)}   icon={Heart}    />
        <StatsCard label="STATUS"         value="OPERATIONAL"                 icon={FileText} />
      </div>

      {loadState === 'error' && (
        <div className="p-3 text-xs text-red-400 flex items-center justify-between">
          <span>Failed to load victim records.</span>
          <button type="button" className="toolbar-btn" onClick={() => { setLoadState('loading'); void fetchData(); }}>Retry</button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={filtered}
        emptyMessage={emptyMessage}
        onRowClick={canManage ? openEdit : undefined}
        rowContextMenu={(row) => [
          m.action('Open / edit', () => openEdit(row), { icon: <Eye size={12} /> }),
          m.separator(),
          m.copy('Copy name',  row.victim_name),
          m.copy('Copy case #', row.case_number),
          m.copy('Copy phone', row.phone, <Phone size={12} />),
          m.copyId(row.id),
          ...(canManage ? [
            m.separator(),
            m.action('Delete', () => setDeleteTarget(row), { danger: true, icon: <Trash2 size={12} /> }),
          ] : []),
        ]}
      />

      {/* Add / Edit modal */}
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
              {editingRecord ? 'Edit Victim Record' : 'New Victim Record'}
            </h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ff-vs-name" className="text-[9px] text-rmpg-400 uppercase font-bold">Name *</label>
                <input
                  id="ff-vs-name"
                  value={formData.victim_name}
                  onChange={(e) => setFormData({ ...formData, victim_name: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-vs-case" className="text-[9px] text-rmpg-400 uppercase font-bold">Case #</label>
                <input
                  id="ff-vs-case"
                  value={formData.case_number}
                  onChange={(e) => setFormData({ ...formData, case_number: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-vs-crime" className="text-[9px] text-rmpg-400 uppercase font-bold">Crime Type</label>
                <input
                  id="ff-vs-crime"
                  value={formData.crime_type}
                  onChange={(e) => setFormData({ ...formData, crime_type: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-vs-status" className="text-[9px] text-rmpg-400 uppercase font-bold">Status</label>
                <select
                  id="ff-vs-status"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                >
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                  <option value="referred">Referred</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
              <div>
                <label htmlFor="ff-vs-phone" className="text-[9px] text-rmpg-400 uppercase font-bold">Phone</label>
                <input
                  id="ff-vs-phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-vs-email" className="text-[9px] text-rmpg-400 uppercase font-bold">Email</label>
                <input
                  id="ff-vs-email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div className="col-span-2">
                <label htmlFor="ff-vs-address" className="text-[9px] text-rmpg-400 uppercase font-bold">Address</label>
                <input
                  id="ff-vs-address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div className="flex items-center gap-4 col-span-2">
                <label className="flex items-center gap-2 text-[11px] text-rmpg-300">
                  <input
                    id="ff-vs-safetyplan"
                    type="checkbox"
                    checked={formData.safety_plan === 1}
                    onChange={(e) => setFormData({ ...formData, safety_plan: e.target.checked ? 1 : 0 })}
                    className="w-3 h-3"
                  />
                  Safety Plan
                </label>
                <label className="flex items-center gap-2 text-[11px] text-rmpg-300">
                  <input
                    id="ff-vs-protorder"
                    type="checkbox"
                    checked={formData.protective_order === 1}
                    onChange={(e) => setFormData({ ...formData, protective_order: e.target.checked ? 1 : 0 })}
                    className="w-3 h-3"
                  />
                  Protective Order
                </label>
              </div>
            </div>

            <div className="mt-3">
              <label htmlFor="ff-vs-notes" className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label>
              <textarea
                id="ff-vs-notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="input-dark w-full mt-1 text-xs"
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setFormOpen(false)}
                className="toolbar-btn px-4"
                style={{ height: 28 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={formSubmitting || !formData.victim_name}
                className="toolbar-btn toolbar-btn-primary px-4"
                style={{ height: 28 }}
              >
                {formSubmitting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Victim Record"
        message="Permanently delete this victim record? This cannot be undone."
        details={
          deleteTarget && (
            <>
              <div className="font-semibold">{deleteTarget.victim_name}</div>
              {deleteTarget.case_number && <div>Case {deleteTarget.case_number}</div>}
              {deleteTarget.crime_type  && <div>{formatEnumValue(deleteTarget.crime_type)}</div>}
              {deleteTarget.status      && <div className="text-rmpg-500">Status: {deleteTarget.status}</div>}
            </>
          )
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleting}
      />
    </div>
  );
}
