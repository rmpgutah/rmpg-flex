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
import { Share2, Building2, FileText, ArrowRightLeft, Plus, Pencil, Trash2, Eye } from 'lucide-react';
import { partnersToCsv, downloadTextFile } from '../utils/rmsListExport';

interface Partner {
  id: number;
  agency_name: string;
  agency_type?: string;
  jurisdiction?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  data_share_level: string;
  status?: string;
}

interface Stats {
  partners: number;
  active_agreements: number;
  total_exchanges: number;
}

export default function InteragencyPage() {
  const { user } = useAuth();
  // POST /interagency/partners requires admin or manager (enforced on server too)
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({ partners: 0, active_agreements: 0, total_exchanges: 0 });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const searchRef = useRef<HTMLInputElement>(null);
  const [editingRecord, setEditingRecord] = useState<Partner | null>(null);
  // showForm is tracked independently of editingRecord — the "New Partner" path
  // has editingRecord = null and still needs to open the form.
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<Partial<Partner>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Partner | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();
  const m = useMenuActions();

  // Deep-link: ?agency_id= — capture before first render strips it
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingAgencyIdRef = useRef<string | null>(searchParams.get('agency_id'));

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const r = await apiFetch<{ data: Partner[] }>('/interagency/partners');
      setPartners(r.data || []);
      const s = await apiFetch<Stats>('/interagency/stats');
      setStats(s);
    } catch {
      setError('Failed to load interagency data');
    }
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  // Hydrate deep-link after data loads; strip the param with replace so
  // Back doesn't re-trigger it.
  useEffect(() => {
    const target = pendingAgencyIdRef.current;
    if (!target || loading || partners.length === 0) return;
    pendingAgencyIdRef.current = null;
    const hit = partners.find((p) => String(p.id) === String(target));
    if (hit) {
      openEdit(hit);
    } else {
      addToast(`Agency ${target} not found`, 'warning');
    }
    const next = new URLSearchParams(searchParams);
    next.delete('agency_id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, partners]);

  // N key — open New Partner when no modal is open and not typing in a field
  useEffect(() => {
    if (!canEdit) return;
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement).isContentEditable) return;
      if (showForm || deleteTarget) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openNew();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, showForm, deleteTarget]);

  // Esc cascade — close innermost open layer and stop propagation
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deleteTarget) { e.stopPropagation(); setDeleteTarget(null); return; }
      if (showForm) { e.stopPropagation(); closeForm(); }
    };
    document.addEventListener('keydown', handleEsc, true);
    return () => document.removeEventListener('keydown', handleEsc, true);
  }, [deleteTarget, showForm]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const EMPTY_FORM: Partial<Partner> = {
    agency_name: '', agency_type: '', jurisdiction: '',
    contact_name: '', contact_email: '', contact_phone: '', data_share_level: 'none',
  };

  const openNew = () => { setEditingRecord(null); setFormData(EMPTY_FORM); setShowForm(true); };
  const openEdit = (rec: Partner) => { setEditingRecord(rec); setFormData({ ...rec }); setShowForm(true); };
  const closeForm = () => { setShowForm(false); setEditingRecord(null); };

  const handleSave = async () => {
    setSubmitting(true);
    try {
      if (editingRecord) {
        await apiFetch(`/interagency/partners/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(formData) });
      } else {
        await apiFetch('/interagency/partners', { method: 'POST', body: JSON.stringify(formData) });
      }
      closeForm();
      fetchData();
      addToast(editingRecord ? 'Partner updated' : 'Partner created', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/interagency/partners/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      fetchData();
      addToast('Partner deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Client-side search filter
  const filteredPartners = partners.filter((p) => {
    if (typeFilter !== 'ALL' && (p.agency_type || '') !== typeFilter) return false;
    if (statusFilter !== 'ALL' && (p.status || '') !== statusFilter) return false;
    if (!search.trim()) return true;
    return [p.agency_name, p.agency_type, p.jurisdiction, p.contact_name]
      .some((v) => v?.toLowerCase().includes(search.toLowerCase()));
  });
  const partnerTypes = Array.from(new Set(partners.map((p) => p.agency_type).filter(Boolean))) as string[];
  const partnerStatuses = Array.from(new Set(partners.map((p) => p.status).filter(Boolean))) as string[];

  const hasData = partners.length > 0;
  const hasSearchResults = filteredPartners.length > 0;
  const emptyMessage = !loading && hasData && !hasSearchResults
    ? `No partners match "${search}"`
    : 'No interagency partners have been configured yet';

  const columns = [
    { key: 'agency_name', label: 'Agency' },
    { key: 'agency_type', label: 'Type' },
    { key: 'jurisdiction', label: 'Jurisdiction' },
    { key: 'data_share_level', label: 'Share Level' },
    { key: 'status', label: 'Status' },
    ...(canEdit ? [{
      key: 'actions',
      label: '',
      width: '80px',
      render: (row: Partner) => (
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(row); }}
            className="text-rmpg-400 hover:text-rmpg-100"
            aria-label="Edit partner"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}
            className="text-red-500 hover:text-red-300"
            aria-label="Delete partner"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ),
    }] : []),
  ];

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="INTERAGENCY DATA SHARING" icon={Share2}>
        {error && (
          <div className="border border-red-700/40 bg-red-900/20 text-red-400 text-[11px] px-3 py-2 mb-3 flex items-center justify-between" role="alert">
            <span>{error}</span>
            <button type="button" className="toolbar-btn" style={{ height: 26 }} onClick={() => { setLoading(true); fetchData().finally(() => setLoading(false)); }}>Retry</button>
          </div>
        )}
        <button
          type="button"
          className="toolbar-btn"
          style={{ height: 28, padding: '0 10px' }}
          disabled={filteredPartners.length === 0}
          onClick={() => downloadTextFile('interagency-partners.csv', partnersToCsv(filteredPartners))}
        >CSV</button>
        {canEdit && (
          <button
            onClick={openNew}
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 28, padding: '0 10px' }}
            title="New partner (N)"
          >
            <Plus size={13} /> New Partner
          </button>
        )}
      </PanelTitleBar>

      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={Building2} label="Partner Agencies" value={stats.partners} />
        <StatsCard icon={FileText} label="Active Agreements" value={stats.active_agreements} />
        <StatsCard icon={ArrowRightLeft} label="Data Exchanges" value={stats.total_exchanges} />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={searchRef}
          className="input-dark w-full max-w-xs"
          placeholder="Search partners… (/)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search interagency partners"
        />
        <select aria-label="Filter by type" className="select-dark text-[11px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="ALL">All types</option>
          {partnerTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select aria-label="Filter by status" className="select-dark text-[11px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="ALL">All statuses</option>
          {partnerStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Content area: loading / zero-data empty state / table */}
      {loading ? (
        <div className="p-6 text-rmpg-400 text-xs">Loading interagency records…</div>
      ) : !hasData ? (
        <div className="p-8 text-center border border-rmpg-700/40 bg-surface-raised/30">
          <Building2 size={24} className="mx-auto mb-2 text-rmpg-600" />
          <p className="text-xs text-rmpg-400">{emptyMessage}</p>
          {canEdit && (
            <button onClick={openNew} className="toolbar-btn mt-3 flex items-center gap-1 mx-auto text-xs">
              <Plus size={12} /> Add First Partner
            </button>
          )}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredPartners}
          emptyMessage={emptyMessage}
          onRowClick={(row) => openEdit(row as Partner)}
          rowContextMenu={(row): ContextMenuItem[] => [
            m.action('Open', () => openEdit(row as Partner), { icon: <Eye size={12} /> }),
            ...(canEdit ? [
              m.action('Edit', () => openEdit(row as Partner), { icon: <Pencil size={12} /> }),
              m.separator(),
              m.copyId((row as Partner).id),
              m.copy('Copy agency', (row as Partner).agency_name),
              m.action('Delete', () => setDeleteTarget(row as Partner), { danger: true, icon: <Trash2 size={12} /> }),
            ] : [
              m.separator(),
              m.copyId((row as Partner).id),
              m.copy('Copy agency', (row as Partner).agency_name),
            ]),
          ]}
        />
      )}

      {/* ── New / Edit form modal ──────────────────────────────── */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto p-4"
          onClick={closeForm}
          role="dialog"
          aria-modal="true"
          aria-label={editingRecord ? 'Edit Partner' : 'New Partner'}
        >
          <div
            className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full my-auto"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">
              {editingRecord ? 'Edit Partner' : 'New Partner'}
            </h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="ff-interagency-0" className="text-[10px] text-rmpg-400 uppercase font-semibold">
                  Agency Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="ff-interagency-0"
                  className="input-dark mt-1"
                  value={formData.agency_name || ''}
                  onChange={(e) => setFormData({ ...formData, agency_name: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-interagency-1" className="text-[10px] text-rmpg-400 uppercase font-semibold">Type</label>
                  <input
                    id="ff-interagency-1"
                    className="input-dark mt-1"
                    value={formData.agency_type || ''}
                    onChange={(e) => setFormData({ ...formData, agency_type: e.target.value })}
                    placeholder="e.g. PD, Sheriff"
                  />
                </div>
                <div>
                  <label htmlFor="ff-interagency-2" className="text-[10px] text-rmpg-400 uppercase font-semibold">Jurisdiction</label>
                  <input
                    id="ff-interagency-2"
                    className="input-dark mt-1"
                    value={formData.jurisdiction || ''}
                    onChange={(e) => setFormData({ ...formData, jurisdiction: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-interagency-3" className="text-[10px] text-rmpg-400 uppercase font-semibold">Contact Name</label>
                  <input
                    id="ff-interagency-3"
                    className="input-dark mt-1"
                    value={formData.contact_name || ''}
                    onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="ff-interagency-4" className="text-[10px] text-rmpg-400 uppercase font-semibold">Contact Email</label>
                  <input
                    id="ff-interagency-4"
                    className="input-dark mt-1"
                    value={formData.contact_email || ''}
                    onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="ff-interagency-5" className="text-[10px] text-rmpg-400 uppercase font-semibold">Phone</label>
                <input
                  id="ff-interagency-5"
                  className="input-dark mt-1"
                  value={formData.contact_phone || ''}
                  onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="ff-interagency-6" className="text-[10px] text-rmpg-400 uppercase font-semibold">Share Level</label>
                <select
                  id="ff-interagency-6"
                  className="select-dark mt-1"
                  value={formData.data_share_level || 'none'}
                  onChange={(e) => setFormData({ ...formData, data_share_level: e.target.value })}
                >
                  {['none', 'basic', 'partial', 'full'].map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={closeForm} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button
                onClick={handleSave}
                disabled={submitting || !formData.agency_name?.trim()}
                className="toolbar-btn toolbar-btn-primary px-4"
                style={{ height: 28 }}
              >
                {submitting ? 'Saving…' : editingRecord ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation (ConfirmDialog replaces hand-rolled modal) ── */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Partner"
        message="This permanently removes the partner agency and cannot be undone."
        details={deleteTarget ? (
          <span>
            {deleteTarget.agency_name}
            {deleteTarget.jurisdiction ? ` — ${deleteTarget.jurisdiction}` : ''}
          </span>
        ) : undefined}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleting}
      />
    </div>
  );
}
