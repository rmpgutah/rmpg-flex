import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { useAuth } from '../context/AuthContext';
import { Shield, AlertTriangle, ClipboardCheck, FileText, Plus, Pencil, Trash2 } from 'lucide-react';
import { riskAssessmentsToCsv, downloadTextFile } from '../utils/rmsListExport';

interface RiskAssessment {
  id: number;
  assessment_number?: string;
  entity_type: string;
  risk_level: string;
  risk_category?: string;
  description?: string;
  mitigation_plan?: string;
  assessed_date?: string;
  status?: string;
}

const EMPTY_FORM: Record<string, string> = {
  entity_type:     '',
  risk_level:      'low',
  risk_category:   '',
  description:     '',
  mitigation_plan: '',
};

function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export default function RiskPage() {
  const [assessments, setAssessments]     = useState<RiskAssessment[]>([]);
  const [loading, setLoading]             = useState(true);
  const [hasLoaded, setHasLoaded]         = useState(false);
  const [stats, setStats]                 = useState({ active_assessments: 0, pending_inspections: 0, open_claims: 0 });
  const [editingRecord, setEditingRecord] = useState<RiskAssessment | null>(null);
  const [showForm, setShowForm]           = useState(false);
  const [formData, setFormData]           = useState<Record<string, string>>(EMPTY_FORM);
  const [submitting, setSubmitting]       = useState(false);
  const [deleteId, setDeleteId]           = useState<number | null>(null);
  const [deleteBusy, setDeleteBusy]       = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [searchQuery, setSearchQuery]     = useState('');
  const [levelFilter, setLevelFilter]     = useState('ALL');
  const { addToast }                      = useToast();
  const m                                 = useMenuActions();
  const { user }                          = useAuth();
  const [searchParams, setSearchParams]   = useSearchParams();

  // ── Role gates ─────────────────────────────────────────────────────
  // POST / PUT / DELETE → admin | manager only (mirrors server-side gate)
  const canWrite = user?.role === 'admin' || user?.role === 'manager';

  // Capture ?risk_id= before any setSearchParams call clears it
  const pendingRiskIdRef = useRef<string | null>(searchParams.get('risk_id'));

  // ── Fetch ───────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const r = await apiFetch<{ data: RiskAssessment[] }>('/risk/assessments');
      setAssessments(r.data || []);
      const s = await apiFetch<{ active_assessments: number; pending_inspections: number; open_claims: number }>('/risk/stats');
      setStats(s);
    } catch {
      setError('Failed to load risk data');
    }
  }, []);

  useEffect(() => {
    fetchData().finally(() => {
      setLoading(false);
      setHasLoaded(true);
    });
  }, [fetchData]);

  // ── Deep-link: ?risk_id= — open the matching row then strip the param ──
  useEffect(() => {
    if (!hasLoaded) return;
    const pendingId = pendingRiskIdRef.current;
    if (!pendingId) return;
    const numericId = parseInt(pendingId, 10);
    if (!isNaN(numericId)) {
      const hit = assessments.find((a) => a.id === numericId);
      if (hit) openEdit(hit);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('risk_id');
    setSearchParams(next, { replace: true });
    pendingRiskIdRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLoaded, assessments]);

  // ── Form helpers ────────────────────────────────────────────────────
  const openNew = () => {
    setEditingRecord(null);
    setFormData({ ...EMPTY_FORM });
    setShowForm(true);
  };
  const openEdit = (rec: RiskAssessment) => {
    setEditingRecord(rec);
    setFormData({
      entity_type:     rec.entity_type     ?? '',
      risk_level:      rec.risk_level      ?? 'low',
      risk_category:   rec.risk_category   ?? '',
      description:     rec.description     ?? '',
      mitigation_plan: rec.mitigation_plan ?? '',
    });
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditingRecord(null); };

  const handleSave = async () => {
    if (!canWrite) return;
    setSubmitting(true);
    try {
      if (editingRecord) {
        await apiFetch('/risk/assessments/' + editingRecord.id, { method: 'PUT', body: JSON.stringify(formData) });
      } else {
        await apiFetch('/risk/assessments', { method: 'POST', body: JSON.stringify(formData) });
      }
      closeForm();
      fetchData();
      addToast(editingRecord ? 'Assessment updated' : 'Assessment created', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId || !canWrite) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/risk/assessments/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null);
      fetchData();
      addToast('Assessment deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'n' || e.key === 'N') {
        if (isTypingInField(e.target)) return;
        if (showForm || deleteId !== null) return;
        if (!canWrite) return;
        e.preventDefault();
        openNew();
        return;
      }
      if (e.key === 'Escape') {
        if (isTypingInField(e.target)) return;
        if (deleteId !== null) { e.stopPropagation(); setDeleteId(null); return; }
        if (showForm)          { e.stopPropagation(); closeForm();       return; }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm, deleteId, canWrite]);

  // ── Filtered list ───────────────────────────────────────────────────
  const q = searchQuery.trim().toLowerCase();
  const hasSearch = q.length > 0 || levelFilter !== 'ALL';
  const filtered = assessments.filter((a) => {
    if (levelFilter !== 'ALL' && (a.risk_level ?? '') !== levelFilter) return false;
    if (!q) return true;
    return (
      (a.entity_type       ?? '').toLowerCase().includes(q) ||
      (a.risk_category     ?? '').toLowerCase().includes(q) ||
      (a.risk_level        ?? '').toLowerCase().includes(q) ||
      (a.status            ?? '').toLowerCase().includes(q) ||
      (a.assessment_number ?? '').toLowerCase().includes(q)
    );
  });

  // ── Columns ─────────────────────────────────────────────────────────
  const columns = [
    { key: 'assessment_number', label: 'Assessment #' },
    { key: 'entity_type',       label: 'Entity' },
    { key: 'risk_level',        label: 'Risk Level' },
    { key: 'risk_category',     label: 'Category' },
    { key: 'assessed_date',     label: 'Date' },
    { key: 'status',            label: 'Status' },
    ...(canWrite ? [{
      key: 'actions',
      label: '',
      width: '80px',
      render: (row: RiskAssessment) => (
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(row); }}
            className="text-rmpg-400 hover:text-rmpg-100"
            aria-label="Edit assessment"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }}
            className="text-red-500 hover:text-red-300"
            aria-label="Delete assessment"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ),
    }] : []),
  ];

  // ── Empty state strings ─────────────────────────────────────────────
  const emptyMessage = hasSearch
    ? `No assessments match "${searchQuery}"`
    : 'No risk assessments on record';

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="RISK MANAGEMENT" icon={Shield}>
        <input
          type="search"
          placeholder="Filter…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input-dark text-[11px] h-[28px] px-2 w-40"
          aria-label="Filter assessments"
        />
        <select aria-label="Filter by risk level" className="select-dark text-[11px] h-[28px]" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
          <option value="ALL">All levels</option>
          {['low', 'medium', 'high', 'critical'].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button
          type="button"
          className="toolbar-btn"
          style={{ height: 28, padding: '0 10px' }}
          disabled={filtered.length === 0}
          onClick={() => downloadTextFile('risk-assessments.csv', riskAssessmentsToCsv(filtered))}
        >CSV</button>
        {canWrite && (
          <button
            onClick={openNew}
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 28, padding: '0 10px' }}
            title="New Assessment (N)"
          >
            <Plus size={13} /> New Assessment
          </button>
        )}
      </PanelTitleBar>

      {error && (
        <div className="border border-red-700/40 bg-red-900/20 text-red-400 text-[11px] px-3 py-2 flex items-center justify-between" role="alert">
          <span>{error}</span>
          <button type="button" className="toolbar-btn" style={{ height: 26 }} onClick={() => { setLoading(true); fetchData().finally(() => { setLoading(false); setHasLoaded(true); }); }}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={AlertTriangle} label="Active Assessments" value={stats.active_assessments} />
        <StatsCard icon={ClipboardCheck} label="Pending Inspections" value={stats.pending_inspections} />
        <StatsCard icon={FileText} label="Open Claims" value={stats.open_claims} />
      </div>

      {loading && (
        <div className="text-center py-8 text-rmpg-500 text-xs">Loading risk records…</div>
      )}

      {!loading && filtered.length === 0 && !hasSearch && canWrite && (
        <div className="text-center py-2 text-xs text-rmpg-500">
          <button onClick={openNew} className="text-brand-400 hover:text-brand-300 underline">
            Create the first assessment
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={loading ? [] : filtered}
        emptyMessage={emptyMessage}
        onRowClick={(row) => openEdit(row as RiskAssessment)}
        rowContextMenu={(row) => [
          m.action('Open / Edit', () => openEdit(row as RiskAssessment), { icon: <Pencil size={12} /> }),
          m.separator(),
          m.copyId((row as RiskAssessment).id),
          m.copy('Copy assessment #', (row as RiskAssessment).assessment_number ?? ''),
          ...(canWrite
            ? [m.action('Delete', () => setDeleteId((row as RiskAssessment).id), { danger: true, icon: <Trash2 size={12} /> })]
            : []),
        ]}
      />

      {/* ── Create / Edit modal ───────────────────────────────────────── */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 overflow-y-auto p-4"
          onClick={closeForm}
        >
          <div
            className="bg-surface-raised border border-rmpg-700 p-6 max-w-lg w-full my-auto"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-rmpg-100 mb-4">
              {editingRecord ? 'Edit Assessment' : 'New Assessment'}
            </h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="ff-riskpage-0" className="text-[10px] text-rmpg-400 uppercase font-semibold">
                  Entity Type <span className="text-red-500">*</span>
                </label>
                <input
                  id="ff-riskpage-0"
                  className="input-dark mt-1"
                  value={formData.entity_type}
                  onChange={(e) => setFormData({ ...formData, entity_type: e.target.value })}
                  autoFocus
                  placeholder="e.g. premise, officer, vehicle"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-riskpage-1" className="text-[10px] text-rmpg-400 uppercase font-semibold">Risk Level</label>
                  <select
                    id="ff-riskpage-1"
                    className="select-dark mt-1"
                    value={formData.risk_level}
                    onChange={(e) => setFormData({ ...formData, risk_level: e.target.value })}
                  >
                    {['low', 'moderate', 'high', 'critical'].map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-riskpage-2" className="text-[10px] text-rmpg-400 uppercase font-semibold">Category</label>
                  <input
                    id="ff-riskpage-2"
                    className="input-dark mt-1"
                    value={formData.risk_category}
                    onChange={(e) => setFormData({ ...formData, risk_category: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="ff-riskpage-3" className="text-[10px] text-rmpg-400 uppercase font-semibold">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="ff-riskpage-3"
                  rows={3}
                  className="input-dark mt-1"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="ff-riskpage-4" className="text-[10px] text-rmpg-400 uppercase font-semibold">Mitigation Plan</label>
                <textarea
                  id="ff-riskpage-4"
                  rows={2}
                  className="input-dark mt-1"
                  value={formData.mitigation_plan}
                  onChange={(e) => setFormData({ ...formData, mitigation_plan: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={closeForm} className="toolbar-btn px-4" style={{ height: 28 }}>Cancel</button>
              <button
                onClick={handleSave}
                disabled={submitting}
                className="toolbar-btn toolbar-btn-primary px-4"
                style={{ height: 28 }}
              >
                {submitting ? 'Saving…' : editingRecord ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation ───────────────────────────────────────── */}
      <ConfirmDialog
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Assessment"
        message="This permanently removes the risk assessment and cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteBusy}
      />
    </div>
  );
}
