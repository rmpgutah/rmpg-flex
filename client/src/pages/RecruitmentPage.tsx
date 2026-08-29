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
import { localToday, safeDateStr } from '../utils/dateUtils';
import { UserPlus, Users, CheckCircle, GraduationCap, Clock, Plus, Pencil, Trash2 } from 'lucide-react';
import { toDisplayLabel } from '../utils/formatters';
import { recruitmentPipelineToCsv, downloadTextFile } from '../utils/rmsListExport';

interface Candidate {
  id: number;
  candidate_name: string;
  email: string;
  phone: string;
  position: string;
  stage: string;
  applied_date: string;
  notes: string;
}
interface RecruitStats { applicants: number; inProcess: number; hired: number; academyClasses: number; }

const EMPTY_FORM = {
  candidate_name: '', email: '', phone: '', position: '',
  stage: 'applied', applied_date: localToday(), notes: '',
};

const STAGES = [
  'applied', 'screening', 'testing', 'oral_board', 'background',
  'conditional_offer', 'academy', 'fto', 'hired', 'rejected', 'withdrawn',
];

// Roles that may create / edit / delete candidate records.
const MANAGE_ROLES = new Set(['admin', 'manager', 'human_resources']);

export default function RecruitmentPage() {
  const { user } = useAuth();
  const canManage = MANAGE_ROLES.has(user?.role ?? '');

  const [searchParams, setSearchParams] = useSearchParams();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [stats, setStats] = useState<RecruitStats>({ applicants: 0, inProcess: 0, hired: 0, academyClasses: 0 });
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState(() => {
    try { return localStorage.getItem('rmpg_recruit_stage') || 'ALL'; } catch { return 'ALL'; }
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Candidate | null>(null);
  const [formData, setFormData] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Candidate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { addToast } = useToast();
  const m = useMenuActions();

  // Deep-link: capture params once at mount before any setSearchParams calls.
  const pendingApplicantIdRef = useRef<string | null>(searchParams.get('applicant_id'));
  const pendingRecruitIdRef   = useRef<string | null>(searchParams.get('recruit_id'));

  const fetchData = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        apiFetch<Candidate[]>('/recruitment/candidates').catch(() => [] as Candidate[]),
        apiFetch<RecruitStats>('/recruitment/stats').catch(
          () => ({ applicants: 0, inProcess: 0, hired: 0, academyClasses: 0 } as RecruitStats),
        ),
      ]);
      setCandidates(c);
      setStats(s);
      setLoadState('ok');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    try { localStorage.setItem('rmpg_recruit_stage', stageFilter); } catch { /* quota */ }
  }, [stageFilter]);

  // -- Deep-link hydration --
  // Applied once after first successful data load. Strips params after use so
  // refresh does not re-open the modal. Mirrors VictimServicesPage / AffairsPage.
  useEffect(() => {
    if (loadState !== 'ok') return;

    const applicantIdRaw = pendingApplicantIdRef.current;
    const recruitIdRaw   = pendingRecruitIdRef.current;
    if (!applicantIdRaw && !recruitIdRaw) return;

    pendingApplicantIdRef.current = null;
    pendingRecruitIdRef.current   = null;

    const next = new URLSearchParams(searchParams);
    next.delete('applicant_id');
    next.delete('recruit_id');

    const rawId = applicantIdRaw ?? recruitIdRaw;
    if (rawId) {
      const id = Number(rawId);
      if (Number.isFinite(id) && id > 0) {
        const hit = candidates.find((c) => c.id === id);
        if (hit) {
          openEdit(hit);
        } else {
          apiFetch<Candidate>(`/recruitment/candidates/${id}`)
            .then((rec) => { if (rec) openEdit(rec); })
            .catch(() => addToast(`Candidate #${id} not found`, 'warning'));
        }
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

  const openEdit = (rec: Candidate) => {
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
        await apiFetch(`/recruitment/candidates/${editingRecord.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
        addToast('Candidate updated', 'success');
      } else {
        await apiFetch('/recruitment/candidates', {
          method: 'POST',
          body: JSON.stringify(formData),
        });
        addToast('Candidate added', 'success');
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
      await apiFetch(`/recruitment/candidates/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      fetchData();
      addToast('Candidate deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Filtered view — driven by search input.
  const filtered = useMemo(() => {
    return candidates.filter((c) => {
      if (stageFilter !== 'ALL' && c.stage !== stageFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        c.candidate_name?.toLowerCase().includes(q) ||
        c.position?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.stage?.toLowerCase().includes(q)
      );
    });
  }, [candidates, search, stageFilter]);

  const columns = [
    { key: 'candidate_name', label: 'Name' },
    { key: 'position',       label: 'Position' },
    { key: 'email',          label: 'Email' },
    {
      key: 'stage', label: 'Stage',
      render: (r: Candidate) => (
        <span className={`badge ${r.stage === 'hired' ? 'badge-available' : r.stage === 'rejected' || r.stage === 'withdrawn' ? 'badge-busy' : 'badge-pending'}`}>
          {toDisplayLabel(r.stage)}
        </span>
      ),
    },
    {
      key: 'applied_date', label: 'Applied',
      render: (r: Candidate) => safeDateStr(r.applied_date),
    },
    ...(canManage ? [{
      key: 'actions', label: '', width: '80px',
      render: (r: Candidate) => (
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(r); }}
            className="text-rmpg-400 hover:text-rmpg-100"
            title="Edit"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}
            className="text-red-500 hover:text-red-300"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ),
    }] : []),
  ];

  // -- Empty state rendering --
  const renderBody = () => {
    if (loadState === 'loading') {
      return <div className="p-6 text-rmpg-400 text-xs">Loading recruitment data…</div>;
    }
    if (loadState === 'error') {
      return (
        <div className="p-6 text-red-400 text-xs flex items-center justify-between">
          <span>Failed to load recruitment data.</span>
          <button type="button" className="toolbar-btn" onClick={() => { setLoadState('loading'); void fetchData(); }}>Retry</button>
        </div>
      );
    }
    return (
      <DataTable
        columns={columns}
        data={filtered}
        emptyMessage={
          search.trim()
            ? `No candidates match "${search}"`
            : candidates.length === 0
              ? 'No candidates in the pipeline yet'
              : 'No candidates match the current filter'
        }
        onRowClick={openEdit}
        rowContextMenu={(row) => [
          m.action('Open / Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
          m.separator(),
          m.copy('Copy name', row.candidate_name),
          m.copyId(row.id),
          ...(canManage
            ? [m.action('Delete', () => setDeleteTarget(row), { danger: true, icon: <Trash2 size={12} /> })]
            : []),
        ]}
      />
    );
  };

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="RECRUITMENT" icon={UserPlus}>
        <input
          type="search"
          placeholder="Search candidates…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-dark text-xs h-7 px-2 w-44"
          aria-label="Search candidates"
        />
        <select
          aria-label="Filter by stage"
          className="select-dark text-xs h-7"
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
        >
          <option value="ALL">All stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{toDisplayLabel(s)}</option>)}
        </select>
        <button
          type="button"
          className="toolbar-btn"
          style={{ height: 28, padding: '0 10px' }}
          disabled={filtered.length === 0}
          onClick={() => downloadTextFile('recruitment-pipeline.csv', recruitmentPipelineToCsv(filtered))}
        >CSV</button>
        {canManage && (
          <button
            onClick={openNew}
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 28, padding: '0 10px' }}
            title="New Candidate (N)"
          >
            <Plus size={13} /> New Candidate
          </button>
        )}
      </PanelTitleBar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatsCard label="TOTAL APPLICANTS" value={String(stats.applicants)} icon={Users} />
        <StatsCard label="IN PROCESS"       value={String(stats.inProcess)}  icon={Clock} />
        <StatsCard label="HIRED (YTD)"      value={String(stats.hired)}      icon={CheckCircle} />
        <StatsCard label="ACADEMY CLASSES"  value={String(stats.academyClasses)} icon={GraduationCap} />
      </div>

      {renderBody()}

      {/* -- Add / Edit modal -- */}
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
              {editingRecord ? 'Edit Candidate' : 'New Candidate'}
            </h3>
            {formError && <div className="text-xs text-red-400 mb-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ff-recruitment-name" className="text-[9px] text-rmpg-400 uppercase font-bold">Name *</label>
                <input
                  id="ff-recruitment-name"
                  value={formData.candidate_name}
                  onChange={(e) => setFormData({ ...formData, candidate_name: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-recruitment-position" className="text-[9px] text-rmpg-400 uppercase font-bold">Position</label>
                <input
                  id="ff-recruitment-position"
                  value={formData.position}
                  onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-recruitment-email" className="text-[9px] text-rmpg-400 uppercase font-bold">Email</label>
                <input
                  id="ff-recruitment-email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-recruitment-phone" className="text-[9px] text-rmpg-400 uppercase font-bold">Phone</label>
                <input
                  id="ff-recruitment-phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
              <div>
                <label htmlFor="ff-recruitment-stage" className="text-[9px] text-rmpg-400 uppercase font-bold">Stage</label>
                <select
                  id="ff-recruitment-stage"
                  value={formData.stage}
                  onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                >
                  {STAGES.map((s) => <option key={s} value={s}>{toDisplayLabel(s)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ff-recruitment-date" className="text-[9px] text-rmpg-400 uppercase font-bold">Applied Date</label>
                <input
                  id="ff-recruitment-date"
                  type="date"
                  value={formData.applied_date}
                  onChange={(e) => setFormData({ ...formData, applied_date: e.target.value })}
                  className="input-dark w-full mt-1 text-xs"
                />
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor="ff-recruitment-notes" className="text-[9px] text-rmpg-400 uppercase font-bold">Notes</label>
              <textarea
                id="ff-recruitment-notes"
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
                disabled={formSubmitting || !formData.candidate_name}
                className="toolbar-btn toolbar-btn-primary px-4"
                style={{ height: 28 }}
              >
                {formSubmitting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -- Delete confirm -- */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Candidate"
        message="This permanently removes this candidate record and cannot be undone."
        details={deleteTarget && (
          <>
            <div><span className="text-rmpg-400">Name:</span> {deleteTarget.candidate_name}</div>
            <div><span className="text-rmpg-400">Position:</span> {deleteTarget.position || '—'}</div>
            <div><span className="text-rmpg-400">Stage:</span> {toDisplayLabel(deleteTarget.stage)}</div>
          </>
        )}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleting}
      />
    </div>
  );
}
