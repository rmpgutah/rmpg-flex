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
import type { ContextMenuItem } from '../context/ContextMenuContext';
import { Pill, TrendingUp, Scale, Shield, DollarSign, Plus, Pencil, Trash2, Eye } from 'lucide-react';
import { formatEnumValue } from '../utils/formatters';
import { narcCasesToCsv, downloadTextFile } from '../utils/rmsListExport';

interface NarcCase {
  id: number;
  case_number: string;
  case_type: string;
  subject_name: string;
  location: string;
  substance: string;
  quantity: string;
  street_value: number;
  status: string;
  priority: string;
  notes: string;
}
interface NarcStats {
  totalInvestigations: number;
  totalSeizures: number;
  totalStreetValue: number;
  activeCIs: number;
}

const EMPTY_FORM = {
  case_number: '',
  case_type: 'investigation',
  subject_name: '',
  location: '',
  substance: '',
  quantity: '',
  street_value: 0,
  status: 'open',
  priority: 'normal',
  notes: '',
};

// Roles allowed to create / edit / delete narcotics cases.
const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);

export default function NarcoticsPage() {
  const { user } = useAuth();
  const canManage = MANAGE_ROLES.has(user?.role ?? '');

  const [searchParams, setSearchParams] = useSearchParams();

  const [cases, setCases] = useState<NarcCase[]>([]);
  const [stats, setStats] = useState<NarcStats>({
    totalInvestigations: 0,
    totalSeizures: 0,
    totalStreetValue: 0,
    activeCIs: 0,
  });
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const searchRef = useRef<HTMLInputElement>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<NarcCase | null>(null);
  const [formData, setFormData] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NarcCase | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { addToast } = useToast();
  const m = useMenuActions();

  // Deep-link: read params ONCE at mount so they survive later setSearchParams calls.
  const pendingNarcoticsIdRef = useRef<string | null>(searchParams.get('narcotics_id'));
  const pendingCaseIdRef      = useRef<string | null>(searchParams.get('case_id'));

  const fetchData = useCallback(async () => {
    try {
      const c = await apiFetch<NarcCase[]>('/narcotics/cases');
      const s = await apiFetch<NarcStats>('/narcotics/stats').catch(
        () => ({ totalInvestigations: 0, totalSeizures: 0, totalStreetValue: 0, activeCIs: 0 } as NarcStats),
      );
      setCases(c);
      setStats(s);
      setLoadState('ok');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // -- Deep-link hydration --
  // Applied once after first successful data load. Strips params after use
  // so refresh does not loop. Mirrors VictimServicesPage / AffairsPage.
  useEffect(() => {
    if (loadState !== 'ok') return;

    const narcIdRaw = pendingNarcoticsIdRef.current;
    const caseIdRaw = pendingCaseIdRef.current;
    if (!narcIdRaw && !caseIdRaw) return;

    pendingNarcoticsIdRef.current = null;
    pendingCaseIdRef.current      = null;

    const next = new URLSearchParams(searchParams);
    next.delete('narcotics_id');
    next.delete('case_id');

    if (narcIdRaw) {
      const id = Number(narcIdRaw);
      if (Number.isFinite(id) && id > 0) {
        const hit = cases.find((c) => c.id === id);
        if (hit) {
          openEdit(hit);
        } else {
          apiFetch<NarcCase>(`/narcotics/cases/${id}`)
            .then((rec) => { if (rec) openEdit(rec); })
            .catch(() => addToast(`Narcotics case #${id} not found`, 'warning'));
        }
      }
    } else if (caseIdRaw) {
      const caseNum = caseIdRaw.trim();
      const hit = cases.find((c) => c.case_number === caseNum);
      if (hit) {
        openEdit(hit);
      } else {
        addToast(`No narcotics case found for case # ${caseNum}`, 'warning');
      }
    }

    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState]);

  // -- Keyboard shortcuts --
  // N opens the New modal (canManage only, not while typing in a field).
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

  const openEdit = (rec: NarcCase) => {
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
        await apiFetch(`/narcotics/cases/${editingRecord.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
        addToast('Case updated', 'success');
      } else {
        await apiFetch('/narcotics/cases', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
        addToast('Case created', 'success');
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
      await apiFetch(`/narcotics/cases/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      fetchData();
      addToast('Case deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // -- Filtered view --
  const needle = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return cases.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (!needle) return true;
      const blob = [c.case_number, c.case_type, c.substance, c.location, c.status, c.priority]
        .join(' ')
        .toLowerCase();
      return blob.includes(needle);
    });
  }, [cases, needle, statusFilter]);

  const hasFilter = !!needle || statusFilter !== 'ALL';

  const columns = [
    { key: 'case_number', label: 'Case #' },
    { key: 'case_type', label: 'Type', render: (r: NarcCase) => formatEnumValue(r.case_type) },
    { key: 'subject_name', label: 'Subject' },
    { key: 'substance', label: 'Substance' },
    {
      key: 'street_value',
      label: 'Street Value',
      render: (r: NarcCase) => `$${(r.street_value || 0).toLocaleString()}`,
    },
    {
      key: 'status',
      label: 'Status',
      render: (r: NarcCase) => (
        <span className={`badge ${r.status === 'open' || r.status === 'active' ? 'badge-p1' : 'badge-p4'}`}>
          {formatEnumValue(r.status)}
        </span>
      ),
    },
    { key: 'priority', label: 'Priority', render: (r: NarcCase) => formatEnumValue(r.priority) },
    {
      key: 'actions',
      label: '',
      width: '80px',
      render: (r: NarcCase) => (
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
    : loadState === 'error'  ? 'Failed to load narcotics cases'
    : hasFilter              ? 'No cases match the current filter'
    :                          'No narcotics cases on file';

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="NARCOTICS & VICE" icon={Pill}>
        <input
          ref={searchRef}
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-dark text-xs h-[28px] w-44"
          aria-label="Search narcotics cases"
        />
        <select
          aria-label="Filter by status"
          className="select-dark text-xs h-7"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="ALL">All statuses</option>
          <option value="open">Open</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </select>
        <button
          type="button"
          className="toolbar-btn"
          style={{ height: 28, padding: '0 10px' }}
          disabled={filtered.length === 0}
          onClick={() => downloadTextFile('narcotics-cases.csv', narcCasesToCsv(filtered))}
        >CSV</button>
        {canManage && (
          <button
            onClick={openNew}
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 28, padding: '0 10px' }}
            title="New Case (N)"
          >
            <Plus size={13} /> New Case
          </button>
        )}
      </PanelTitleBar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="ACTIVE INVESTIGATIONS" value={String(stats.totalInvestigations)} icon={Shield} />
        <StatsCard label="TOTAL SEIZURES" value={String(stats.totalSeizures)} icon={Scale} />
        <StatsCard label="STREET VALUE" value={`$${(stats.totalStreetValue || 0).toLocaleString()}`} icon={DollarSign} />
        <StatsCard label="ACTIVE CIs" value={String(stats.activeCIs)} icon={TrendingUp} />
      </div>

      {loadState === 'error' && (
        <div className="p-3 text-xs text-red-400 flex items-center justify-between">
          <span>Failed to load narcotics cases.</span>
          <button type="button" className="toolbar-btn" onClick={() => { setLoadState('loading'); void fetchData(); }}>Retry</button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={filtered}
        emptyMessage={emptyMessage}
        onRowClick={canManage ? openEdit : undefined}
        rowContextMenu={(r): ContextMenuItem[] => [
          m.action('Open', () => openEdit(r), { icon: <Eye size={12} /> }),
          ...(canManage ? [
            m.action('Edit', () => openEdit(r), { icon: <Pencil size={12} /> }),
            m.separator(),
          ] : [m.separator()]),
          m.copyId(r.id),
          m.copy('Copy case #', r.case_number),
          ...(canManage ? [
            m.action('Delete', () => setDeleteTarget(r), { danger: true, icon: <Trash2 size={12} /> }),
          ] : []),
        ]}
      />

      {/* Form modal */}
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
              {editingRecord ? 'Edit Case' : 'New Case'}
            </h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ff-narcoticspage-0" className="text-[9px] text-rmpg-400 uppercase font-bold">Case # *</label>
                <input
                  id="ff-narcoticspage-0"
                  value={formData.case_number}
                  onChange={(e) => setFormData({ ...formData, case_number: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-narcoticspage-1" className="text-[9px] text-rmpg-400 uppercase font-bold">Type</label>
                <select
                  id="ff-narcoticspage-1"
                  value={formData.case_type}
                  onChange={(e) => setFormData({ ...formData, case_type: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                >
                  <option value="investigation">Investigation</option>
                  <option value="buy_bust">Buy Bust</option>
                  <option value="ci_management">CI Management</option>
                  <option value="surveillance">Surveillance</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label htmlFor="ff-narcoticspage-2" className="text-[9px] text-rmpg-400 uppercase font-bold">Subject</label>
                <input
                  id="ff-narcoticspage-2"
                  value={formData.subject_name}
                  onChange={(e) => setFormData({ ...formData, subject_name: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-narcoticspage-3" className="text-[9px] text-rmpg-400 uppercase font-bold">Location</label>
                <input
                  id="ff-narcoticspage-3"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-narcoticspage-4" className="text-[9px] text-rmpg-400 uppercase font-bold">Substance</label>
                <input
                  id="ff-narcoticspage-4"
                  value={formData.substance}
                  onChange={(e) => setFormData({ ...formData, substance: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-narcoticspage-5" className="text-[9px] text-rmpg-400 uppercase font-bold">Quantity</label>
                <input
                  id="ff-narcoticspage-5"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-narcoticspage-6" className="text-[9px] text-rmpg-400 uppercase font-bold">Street Value</label>
                <input
                  id="ff-narcoticspage-6"
                  type="number"
                  value={formData.street_value}
                  onChange={(e) => setFormData({ ...formData, street_value: parseFloat(e.target.value) || 0 })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-narcoticspage-7" className="text-[9px] text-rmpg-400 uppercase font-bold">Status</label>
                <select
                  id="ff-narcoticspage-7"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                >
                  <option value="open">Open</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                  <option value="pending_review">Pending Review</option>
                </select>
              </div>
              <div>
                <label htmlFor="ff-narcoticspage-8" className="text-[9px] text-rmpg-400 uppercase font-bold">Priority</label>
                <select
                  id="ff-narcoticspage-8"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor="ff-narcoticspage-9" className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label>
              <textarea
                id="ff-narcoticspage-9"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="input-dark w-full mt-1 text-xs"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setFormOpen(false)} className="toolbar-btn px-4" style={{ height: 28 }}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={formSubmitting || !formData.case_number}
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
        title="Delete Narcotics Case"
        message={`Permanently delete case ${deleteTarget?.case_number ?? ''}?`}
        details={
          deleteTarget && (
            <>
              {deleteTarget.subject_name && <div>Subject: {deleteTarget.subject_name}</div>}
              {deleteTarget.substance && <div>Substance: {deleteTarget.substance}</div>}
              {deleteTarget.location && <div className="text-rmpg-500">{deleteTarget.location}</div>}
              {deleteTarget.status && <div className="text-rmpg-500">Status: {formatEnumValue(deleteTarget.status)}</div>}
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
