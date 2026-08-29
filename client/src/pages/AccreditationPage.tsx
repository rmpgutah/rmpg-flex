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
import { Award, CheckCircle, Clock, FileText, Plus, Pencil, Trash2, Eye, Loader2 } from 'lucide-react';
import { toDisplayLabel } from '../utils/formatters';
import { accreditationStandardsToCsv, downloadTextFile } from '../utils/rmsListExport';

interface Standard {
  id: number;
  standard_number: string;
  standard_name: string;
  category: string;
  description: string;
  compliance_status: string;
  last_reviewed: string;
  next_review: string;
  notes: string;
}
interface AccStats {
  standardsTotal: number;
  standardsCompliant: number;
  compliancePct: number;
  nextAssessment: string;
}

const EMPTY_FORM = {
  standard_number: '',
  standard_name: '',
  category: '',
  description: '',
  compliance_status: 'pending',
  last_reviewed: '',
  next_review: '',
  notes: '',
};

const MGMT_ROLES = new Set(['admin', 'manager']);

export default function AccreditationPage() {
  const { user } = useAuth();
  const canManage = MGMT_ROLES.has(user?.role ?? '');

  const [standards, setStandards] = useState<Standard[]>([]);
  const [stats, setStats] = useState<AccStats>({
    standardsTotal: 0,
    standardsCompliant: 0,
    compliancePct: 0,
    nextAssessment: '',
  });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const searchRef = useRef<HTMLInputElement>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Standard | null>(null);
  const [formData, setFormData] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const { addToast } = useToast();
  const m = useMenuActions();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Deep-link: ?standard_id= or ?accred_id= ──────────────────
  const didHydrate = useRef(false);

  const fetchData = useCallback(async () => {
    setFetchError(false);
    try {
      const [s, st] = await Promise.all([
        apiFetch<Standard[]>('/accreditation/standards').catch(() => null),
        apiFetch<AccStats>('/accreditation/stats').catch(() => null),
      ]);
      if (s === null && st === null) {
        setFetchError(true);
      } else {
        setStandards(s ?? []);
        setStats(
          st ?? { standardsTotal: 0, standardsCompliant: 0, compliancePct: 0, nextAssessment: '' }
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Hydrate deep-link after data arrives (runs once after loading resolves)
  useEffect(() => {
    if (loading || didHydrate.current) return;
    didHydrate.current = true;

    const targetId = searchParams.get('standard_id') ?? searchParams.get('accred_id');
    if (!targetId) return;

    const rec = standards.find((s) => String(s.id) === targetId);
    if (rec) openEdit(rec);

    // Strip the param without adding a history entry
    const next = new URLSearchParams(searchParams);
    next.delete('standard_id');
    next.delete('accred_id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, standards]);

  // ── N shortcut: open New Standard when not in a form field ────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (formOpen || deleteId !== null) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, formOpen, deleteId]);

  // ── Esc cascade: confirm-delete → form → nothing ──────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deleteId !== null) {
        e.stopPropagation();
        setDeleteId(null);
        return;
      }
      if (formOpen) {
        e.stopPropagation();
        setFormOpen(false);
      }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [formOpen, deleteId]);

  const openNew = () => {
    setEditingRecord(null);
    setFormData({ ...EMPTY_FORM });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (rec: Standard) => {
    setEditingRecord(rec);
    setFormData({
      standard_number: rec.standard_number ?? '',
      standard_name: rec.standard_name ?? '',
      category: rec.category ?? '',
      description: rec.description ?? '',
      compliance_status: rec.compliance_status ?? 'pending',
      last_reviewed: rec.last_reviewed ?? '',
      next_review: rec.next_review ?? '',
      notes: rec.notes ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  };

  const handleSave = async () => {
    setFormSubmitting(true);
    setFormError(null);
    try {
      if (editingRecord) {
        await apiFetch(`/accreditation/standards/${editingRecord.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
        addToast('Standard updated', 'success');
      } else {
        await apiFetch('/accreditation/standards', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
        addToast('Standard added', 'success');
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
    if (!deleteId) return;
    setDeleteSubmitting(true);
    try {
      await apiFetch(`/accreditation/standards/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null);
      fetchData();
      addToast('Standard deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // ── Client-side search filter ──────────────────────────────────
  const filteredStandards = standards.filter((s) => {
    if (statusFilter !== 'ALL' && s.compliance_status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.standard_number?.toLowerCase().includes(q) ||
      s.standard_name?.toLowerCase().includes(q) ||
      s.category?.toLowerCase().includes(q) ||
      s.compliance_status?.toLowerCase().includes(q)
    );
  });

  const columns = [
    { key: 'standard_number', label: 'Standard #' },
    { key: 'standard_name', label: 'Name' },
    { key: 'category', label: 'Category' },
    {
      key: 'compliance_status',
      label: 'Status',
      render: (r: Standard) => (
        <span
          className={`badge ${
            r.compliance_status === 'compliant'
              ? 'badge-available'
              : r.compliance_status === 'non_compliant'
                ? 'badge-busy'
                : 'badge-pending'
          }`}
        >
          {toDisplayLabel(r.compliance_status)}
        </span>
      ),
    },
    {
      key: 'last_reviewed',
      label: 'Last Reviewed',
      render: (r: Standard) => r.last_reviewed || '--',
    },
    {
      key: 'next_review',
      label: 'Next Review',
      render: (r: Standard) => r.next_review || '--',
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            label: '',
            width: '80px',
            render: (r: Standard) => (
              <div className="flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                  className="text-rmpg-400 hover:text-rmpg-100"
                  title="Edit"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteId(r.id); }}
                  className="text-red-500 hover:text-red-300"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ),
          },
        ]
      : []),
  ];

  // ── Empty-state: loading / error / no-data / no-results ───────
  let emptyMessage = 'No accreditation standards on record';
  if (fetchError) emptyMessage = 'Failed to load standards — check connection';
  else if ((search.trim() || statusFilter !== 'ALL') && standards.length > 0)
    emptyMessage = `No standards match the current filter`;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="ACCREDITATION" icon={Award}>
        <button
          type="button"
          className="toolbar-btn"
          style={{ height: 28, padding: '0 10px' }}
          disabled={filteredStandards.length === 0}
          onClick={() => downloadTextFile('accreditation-standards.csv', accreditationStandardsToCsv(filteredStandards))}
        >CSV</button>
        {canManage && (
          <button
            onClick={openNew}
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 28, padding: '0 10px' }}
            title="New Standard (N)"
          >
            <Plus size={13} /> New Standard
          </button>
        )}
      </PanelTitleBar>

      {/* Stats row — shown inline; spinner while loading */}
      {loading ? (
        <div className="flex items-center gap-2 text-[10px] text-rmpg-500 p-3">
          <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" />
          Loading accreditation data…
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatsCard label="TOTAL STANDARDS" value={String(stats.standardsTotal)} icon={FileText} />
          <StatsCard label="COMPLIANT" value={String(stats.standardsCompliant)} icon={CheckCircle} />
          <StatsCard label="COMPLIANCE RATE" value={`${stats.compliancePct}%`} icon={Award} />
          <StatsCard label="NEXT ASSESSMENT" value={stats.nextAssessment || 'N/A'} icon={Clock} />
        </div>
      )}

      {fetchError && (
        <div className="p-3 text-xs text-red-400 flex items-center justify-between">
          <span>Failed to load accreditation standards.</span>
          <button type="button" className="toolbar-btn" onClick={() => { setLoading(true); void fetchData(); }}>Retry</button>
        </div>
      )}

      {/* Search / filter */}
      {!loading && (
        <div className="flex items-center gap-2">
          <input
            ref={searchRef}
            type="search"
            placeholder="Filter standards… (/)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-dark w-full max-w-xs text-xs"
            aria-label="Filter standards"
          />
          <select
            aria-label="Filter by compliance status"
            className="select-dark text-xs h-7"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">All statuses</option>
            <option value="compliant">Compliant</option>
            <option value="non_compliant">Non-compliant</option>
            <option value="pending">Pending</option>
          </select>
        </div>
      )}

      <DataTable
        columns={columns}
        data={filteredStandards}
        emptyMessage={emptyMessage}
        onRowClick={canManage ? openEdit : undefined}
        enableContextMenu
        rowContextMenu={(row: Standard): ContextMenuItem[] => [
          m.action('Open', () => openEdit(row), { icon: <Eye size={12} /> }),
          ...(canManage
            ? [
                m.action('Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
                m.separator(),
                m.copyId(row.id),
                m.action('Delete', () => setDeleteId(row.id), {
                  danger: true,
                  icon: <Trash2 size={12} />,
                }),
              ]
            : [m.separator(), m.copyId(row.id)]),
        ]}
      />

      {/* ── New / Edit modal ─────────────────────────────────── */}
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
              {editingRecord ? 'Edit Standard' : 'New Standard'}
            </h3>
            {formError && (
              <div className="text-xs text-red-400 mb-2" role="alert">
                {formError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ff-accredpage-0" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Standard # *
                </label>
                <input
                  id="ff-accredpage-0"
                  value={formData.standard_number}
                  onChange={(e) => setFormData({ ...formData, standard_number: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-accredpage-1" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Name *
                </label>
                <input
                  id="ff-accredpage-1"
                  value={formData.standard_name}
                  onChange={(e) => setFormData({ ...formData, standard_name: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-accredpage-2" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Category
                </label>
                <input
                  id="ff-accredpage-2"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-accredpage-3" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Status
                </label>
                <select
                  id="ff-accredpage-3"
                  value={formData.compliance_status}
                  onChange={(e) => setFormData({ ...formData, compliance_status: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="compliant">Compliant</option>
                  <option value="non_compliant">Non-Compliant</option>
                </select>
              </div>
              <div>
                <label htmlFor="ff-accredpage-4" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Last Reviewed
                </label>
                <input
                  id="ff-accredpage-4"
                  type="date"
                  value={formData.last_reviewed}
                  onChange={(e) => setFormData({ ...formData, last_reviewed: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-accredpage-5" className="text-[9px] text-rmpg-400 uppercase font-bold">
                  Next Review
                </label>
                <input
                  id="ff-accredpage-5"
                  type="date"
                  value={formData.next_review}
                  onChange={(e) => setFormData({ ...formData, next_review: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor="ff-accredpage-6" className="text-[9px] text-rmpg-400 uppercase font-bold">
                Description
              </label>
              <textarea
                id="ff-accredpage-6"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="input-dark w-full mt-1 text-xs"
                rows={2}
              />
            </div>
            <div className="mt-3">
              <label htmlFor="ff-accredpage-7" className="text-[9px] text-rmpg-400 uppercase font-bold">
                Notes
              </label>
              <textarea
                id="ff-accredpage-7"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="input-dark w-full mt-1 text-xs"
                rows={2}
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
                disabled={formSubmitting || !formData.standard_number || !formData.standard_name}
                className="toolbar-btn toolbar-btn-primary px-4"
                style={{ height: 28 }}
              >
                {formSubmitting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation (ConfirmDialog replaces inline modal) */}
      <ConfirmDialog
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Standard"
        message="This permanently removes this accreditation standard and cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteSubmitting}
      />
    </div>
  );
}
