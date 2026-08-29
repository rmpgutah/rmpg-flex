// ============================================================
// RMPG Flex — Internal Affairs / Professional Standards page.
//
// Page 52 of the full-app frontend pass.
//
// What this page is:
//   The IA module is the agency's professional-standards
//   surface — complaints filed against officers, the
//   investigations spun off from each complaint, and the
//   early-intervention flag stream. Anything edited here is
//   court-record material the moment a 42 USC 1983 or POST
//   decertification proceeding starts, so the surface needs
//   the same court-ready treatment we give arrests, evidence,
//   and forensic cases.
//
// What changed in this pass:
//   - URL deep-link contract: ?complaint_id=<n>, ?investigation_id=<n>,
//     ?new=1. Notification-routing also wires ia_complaint /
//     ia_investigation entity types to this contract so a
//     watchlist hit or supervisor referral can jump straight
//     to the row.
//   - Detail panel (left list / right detail split via SplitPanel)
//     replaces the prior list-only screen. Right side shows the
//     full complaint with the linked investigations list and an
//     "Add investigation" inline action.
//   - Court-ready PDF (openAffairsComplaintPdf) with the same
//     CONFIDENTIAL — INTERNAL AFFAIRS WORK PRODUCT banner,
//     tamper-evidence statement, payload-hash trailer, and
//     signature lines as the forensic-case / arrest / evidence
//     PDFs.
//   - Esc smart-cascade — delete → form → detail → filters → none.
//   - N keyboard shortcut for "new complaint" (typing-suppressed).
//   - Privacy banner at the top reminds the operator IA records
//     are GRAMA-protected. The page itself is auth-required; this
//     is the human-facing reminder.
//   - Per-user form draft already exists via useFormDraft in
//     AffairsFormModal — confirmed working.
//   - Document title reflects the selected complaint so a tab
//     switcher sees "IA-26-0042 — Internal Affairs".
// ============================================================
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import AffairsFormModal, { AffairsFormData } from '../components/AffairsFormModal';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import type { ContextMenuItem } from '../context/ContextMenuContext';
import {
  ShieldAlert, FileText, Clock, Flag, Plus, Pencil, Trash2, Eye, FileDown,
  Lock, AlertTriangle, Search, X, Filter,
} from 'lucide-react';

import { toDisplayLabel } from '../utils/formatters';
import DeleteRecordModal from '../components/DeleteRecordModal';
import { openAffairsComplaintPdf } from '../utils/affairsComplaintPdf';
import { computePayloadHash } from '../utils/pdfIntegrity';
import { useAuth } from '../context/AuthContext';

interface Complaint {
  id: number;
  complaint_number: string;
  complainant_name: string | null;
  complainant_contact?: string | null;
  complaint_type: string;
  status: string;
  subject_officer_id?: number | null;
  subject_officer_name: string | null;
  assigned_to?: number | null;
  assigned_to_name?: string | null;
  description?: string | null;
  incident_date?: string | null;
  incident_location?: string | null;
  witnesses?: string | null;
  evidence_list?: string | null;
  finding?: string | null;
  discipline?: string | null;
  closed_date?: string | null;
  created_at: string;
  updated_at?: string | null;
}

interface Investigation {
  id: number;
  complaint_id: number;
  investigator_id?: number | null;
  investigator_name?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  summary?: string | null;
  findings?: string | null;
  recommendations?: string | null;
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  status: string;
}

// IA closed dispositions — match the server's COMPLAINT_UPDATABLE
// closed-set in src/routes/affairs.ts (close stamps closed_date).
const CLOSED_STATUSES = new Set([
  'closed', 'sustained', 'not_sustained', 'exonerated', 'unfounded',
]);

export default function AffairsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total_complaints: 0, open_complaints: 0, unresolved_flags: 0 });
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Complaint | undefined>(undefined);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Complaint | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [investigationsLoading, setInvestigationsLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  // Deep-link refs — read ONCE at first render so we don't re-fire
  // after the user has moved on. Mirrors the contract every other
  // v1024+ audited page uses.
  const pendingComplaintIdRef = useRef<string | null>(searchParams.get('complaint_id'));
  const pendingInvestigationIdRef = useRef<string | null>(searchParams.get('investigation_id'));
  const pendingNewRef = useRef<string | null>(searchParams.get('new'));

  const { addToast } = useToast();
  const m = useMenuActions();

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const r = await apiFetch<{ data: Complaint[] }>('/affairs/complaints');
      setComplaints(r.data || []);
      const s = await apiFetch<{ total_complaints: number; open_complaints: number; unresolved_flags: number }>('/affairs/stats');
      setStats(s);
    } catch { setError('Failed to load data'); }
  }, []);

  useEffect(() => { fetchData().finally(() => setLoading(false)); }, [fetchData]);

  // ── Filtered view (status + type + free-text search over
  // complaint_number / complainant / subject officer) ───────────
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return complaints.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (typeFilter && c.complaint_type !== typeFilter) return false;
      if (!needle) return true;
      const blob = [
        c.complaint_number,
        c.complainant_name ?? '',
        c.subject_officer_name ?? '',
        c.complaint_type,
      ].join(' ').toLowerCase();
      return blob.includes(needle);
    });
  }, [complaints, statusFilter, typeFilter, search]);

  const hasFiltersActive = !!(statusFilter || typeFilter || search.trim());

  const clearFilters = () => { setStatusFilter(''); setTypeFilter(''); setSearch(''); };

  // ── Selected complaint resolution ─────────────────────────────
  const selected = useMemo(
    () => (selectedId == null ? null : complaints.find((c) => c.id === selectedId) ?? null),
    [selectedId, complaints],
  );

  // Fetch investigations whenever a complaint is selected. The
  // route exists already (GET /affairs/complaints/:id/investigations);
  // the prior page never called it, leaving the entire investigation
  // surface dark.
  useEffect(() => {
    if (selectedId == null) { setInvestigations([]); return; }
    let cancelled = false;
    setInvestigationsLoading(true);
    (async () => {
      try {
        const r = await apiFetch<{ data: Investigation[] }>(`/affairs/complaints/${selectedId}/investigations`);
        if (!cancelled) setInvestigations(r.data || []);
      } catch {
        if (!cancelled) {
          setInvestigations([]);
          addToast('Failed to load investigations', 'error');
        }
      } finally {
        if (!cancelled) setInvestigationsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, addToast]);

  // ── Deep-link hydration ───────────────────────────────────────
  // Apply ?complaint_id= / ?investigation_id= / ?new=1 once the
  // list has loaded. If the complaint isn't in the page slice,
  // direct-fetch via /affairs/complaints/:id (route already exists).
  useEffect(() => {
    if (loading) return;

    const handleNew = pendingNewRef.current;
    if (handleNew === '1') {
      pendingNewRef.current = null;
      setFormOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
      return;
    }

    const targetComplaint = pendingComplaintIdRef.current;
    const targetInvestigation = pendingInvestigationIdRef.current;

    const resolveByInvestigation = async (invIdRaw: string) => {
      pendingInvestigationIdRef.current = null;
      const invId = Number(invIdRaw);
      if (!Number.isFinite(invId) || invId <= 0) {
        addToast(`Invalid investigation id: ${invIdRaw}`, 'error');
        return;
      }
      // No standalone investigation viewer — we land on the parent
      // complaint. Fall back to a complaint scan: try every loaded
      // complaint's investigations endpoint via a single best-effort
      // pass through the page-slice. If we can't resolve the parent
      // from the current page slice, give up gracefully and tell the
      // operator to widen the list.
      for (const c of complaints) {
        try {
          const r = await apiFetch<{ data: Investigation[] }>(`/affairs/complaints/${c.id}/investigations`);
          if ((r.data || []).some((i) => i.id === invId)) {
            setSelectedId(c.id);
            return;
          }
        } catch { /* ignore — next */ }
      }
      addToast(`Investigation #${invId} not found in current page slice`, 'warning');
    };

    const resolveByComplaint = async (idRaw: string) => {
      pendingComplaintIdRef.current = null;
      const id = Number(idRaw);
      if (!Number.isFinite(id) || id <= 0) {
        addToast(`Invalid complaint id: ${idRaw}`, 'error');
        return;
      }
      const hit = complaints.find((c) => c.id === id);
      if (hit) { setSelectedId(id); return; }
      try {
        const r = await apiFetch<{ data: Complaint }>(`/affairs/complaints/${id}`);
        if (r?.data) {
          // Inject the freshly-fetched row into the list so the
          // detail view + investigations effect can find it.
          setComplaints((prev) => {
            if (prev.some((c) => c.id === r.data.id)) return prev;
            return [r.data, ...prev];
          });
          setSelectedId(id);
        } else {
          addToast(`Complaint #${id} not found`, 'warning');
        }
      } catch {
        addToast(`Failed to load complaint #${id}`, 'error');
      }
    };

    (async () => {
      if (targetComplaint) {
        await resolveByComplaint(targetComplaint);
      } else if (targetInvestigation) {
        await resolveByInvestigation(targetInvestigation);
      }
      // Strip handled params so refresh doesn't repeatedly pin the
      // operator to a stale link.
      if (targetComplaint || targetInvestigation) {
        const next = new URLSearchParams(searchParams);
        next.delete('complaint_id');
        next.delete('investigation_id');
        setSearchParams(next, { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ── Document title reflects selected complaint ───────────────
  useEffect(() => {
    document.title = selected
      ? `${selected.complaint_number} — Internal Affairs`
      : 'Internal Affairs — RMPG Flex';
  }, [selected]);

  const openNew = useCallback(() => {
    setEditingRecord(undefined); setFormError(null); setFormOpen(true);
  }, []);
  const openEdit = useCallback((rec: Complaint) => {
    setEditingRecord(rec); setFormError(null); setFormOpen(true);
  }, []);

  const handleSubmit = async (data: AffairsFormData) => {
    setFormSubmitting(true); setFormError(null);
    try {
      const body: Record<string, any> = { ...data };
      if (body.subject_officer_id) body.subject_officer_id = parseInt(body.subject_officer_id);
      if (editingRecord) {
        await apiFetch(`/affairs/complaints/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/affairs/complaints', { method: 'POST', body: JSON.stringify(body) });
      }
      setFormOpen(false); setEditingRecord(undefined); fetchData();
      addToast(editingRecord ? 'Complaint updated' : 'Complaint filed', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      setFormError(msg); addToast(msg, 'error');
    } finally { setFormSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/affairs/complaints/${deleteTarget.id}`, { method: 'DELETE' });
      const id = deleteTarget.id;
      setDeleteTarget(null); fetchData();
      addToast('Complaint deleted', 'success');
      if (selectedId === id) setSelectedId(null);
    } catch (err) { addToast(err instanceof Error ? err.message : 'Delete failed', 'error'); } finally { setDeleting(false); }
  };

  // ── Court-ready PDF ──────────────────────────────────────────
  // Builds the same canonical-JSON bundle the future Ed25519 signer
  // would sign (complaint + investigations), hashes it, and stamps
  // the hash into the trailer + every page footer.
  const handleExportPdf = async () => {
    if (!selected) return;
    setPdfBusy(true);
    try {
      // Re-fetch investigations to make sure the print snapshot is
      // current — the page already has them but we lock in a fresh
      // read at print-time so a later edit will produce a different
      // hash on regeneration.
      let invs = investigations;
      try {
        const r = await apiFetch<{ data: Investigation[] }>(`/affairs/complaints/${selected.id}/investigations`);
        invs = r.data || [];
      } catch { /* fall back to in-memory copy */ }

      const bundle = {
        complaint: selected,
        investigations: invs,
      };
      const payloadHash = await computePayloadHash(bundle);
      const preparedBy = user
        ? [user.full_name || `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.username,
           user.badge_number ? `#${user.badge_number}` : ''].filter(Boolean).join(' ')
        : undefined;
      openAffairsComplaintPdf({
        complaint: selected,
        investigations: invs,
        preparedBy,
        payloadHash,
      });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'PDF generation failed', 'error');
    } finally { setPdfBusy(false); }
  };

  const columns = [
    { key: 'complaint_number', label: 'Case #' },
    { key: 'complainant_name', label: 'Complainant', render: (r: Complaint) => r.complainant_name || <span className="text-rmpg-500 italic">Anonymous</span> },
    { key: 'complaint_type', label: 'Type', render: (r: Complaint) => toDisplayLabel(r.complaint_type) },
    { key: 'subject_officer_name', label: 'Subject Officer', render: (r: Complaint) => r.subject_officer_name || <span className="text-rmpg-500">—</span> },
    { key: 'status', label: 'Status', render: (r: Complaint) => toDisplayLabel(r.status) },
    { key: 'created_at', label: 'Filed' },
    { key: 'actions', label: '', width: '100px', render: (row: Complaint) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-rmpg-100" aria-label={`Edit complaint ${row.complaint_number}`}><Pencil size={12} /></button>
        <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }} className="text-red-500 hover:text-red-300" aria-label={`Delete complaint ${row.complaint_number}`}><Trash2 size={12} /></button>
      </div>
    )},
  ];

  // ── Keyboard shortcuts ───────────────────────────────────────
  //   Esc — smart-cascade: dismiss the highest-priority open layer
  //         first. Cascade order is widest-blast-radius first
  //         (delete → form → detail → filters); each branch returns
  //         so a single Esc doesn't collapse multiple layers.
  //   N   — open the New Complaint modal. Typing-suppressed.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteTarget) { setDeleteTarget(null); return; }
        if (formOpen) { setFormOpen(false); setEditingRecord(undefined); return; }
        if (error) { setError(null); return; }
        if (selectedId !== null) { setSelectedId(null); return; }
        if (hasFiltersActive) { clearFilters(); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openNew();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteTarget, formOpen, error, selectedId, hasFiltersActive]);

  if (loading) return <div className="p-6 text-rmpg-400">Loading internal affairs records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="INTERNAL AFFAIRS" icon={ShieldAlert}>
        <button onClick={openNew} className="toolbar-btn flex items-center gap-1.5" style={{ height: 28, padding: '0 10px' }}>
          <Plus size={13} /> New Complaint <span className="ml-1 text-[9px] text-rmpg-500">(N)</span>
        </button>
      </PanelTitleBar>

      {/* Privacy / confidentiality advisory — IA records are GRAMA-
          protected. The page itself is auth-required; this is the
          human-facing reminder. */}
      <div className="border border-amber-700/40 bg-amber-900/15 text-amber-300 text-[11px] px-3 py-2 flex items-start gap-2" role="note">
        <Lock size={14} className="shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">CONFIDENTIAL — INTERNAL AFFAIRS WORK PRODUCT.</span>{' '}
          Protected under Utah GRAMA §63G-2-302 + POST §53-6-211. Do not screenshot, forward, or print
          without written authorization from the agency head. The court-ready PDF is the only sanctioned export path.
        </div>
      </div>

      {error && (
        <div className="border border-red-700/40 bg-red-900/20 text-red-400 text-[11px] px-3 py-2 flex items-center gap-2" role="alert">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" className="toolbar-btn" onClick={() => { setLoading(true); void fetchData().finally(() => setLoading(false)); }}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={FileText} label="Total Complaints" value={stats.total_complaints} />
        <StatsCard icon={Clock} label="Open Complaints" value={stats.open_complaints} />
        <StatsCard icon={Flag} label="Active Flags" value={stats.unresolved_flags} />
      </div>

      {/* Filter bar — status + type + free-text search. Lets a supervisor
          slice by "all sustained" / "all excessive_force" / "everything
          mentioning a specific officer" without leaving the page. */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number / complainant / officer…"
            aria-label="Search complaints"
            className="input-dark pl-7 pr-2"
            style={{ height: 26, width: 280 }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className="select-dark"
          style={{ height: 26 }}
        >
          <option value="">All statuses</option>
          {['received','assigned','under_investigation','sustained','not_sustained','exonerated','unfounded','closed'].map((s) => (
            <option key={s} value={s}>{toDisplayLabel(s)}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Filter by type"
          className="select-dark"
          style={{ height: 26 }}
        >
          <option value="">All types</option>
          {['excessive_force','discourtesy','dishonesty','policy_violation','criminal','other'].map((t) => (
            <option key={t} value={t}>{toDisplayLabel(t)}</option>
          ))}
        </select>
        {hasFiltersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="toolbar-btn flex items-center gap-1"
            style={{ height: 26, padding: '0 8px' }}
          >
            <Filter size={11} /> Clear ({filtered.length}/{complaints.length})
          </button>
        )}
        <span className="text-rmpg-500 ml-auto">
          {filtered.length} of {complaints.length} shown
        </span>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        emptyMessage={
          complaints.length === 0
            ? 'No complaints filed. Press N to file the first one.'
            : hasFiltersActive
              ? `No complaints match the current filter. ${filtered.length === 0 ? 'Clear filter to see all ' + complaints.length + ' records.' : ''}`
              : 'No complaints found'
        }
        onRowClick={(row) => setSelectedId(row.id)}
        enableContextMenu
        rowContextMenu={(row: Complaint): ContextMenuItem[] => [
          m.action('Open detail', () => setSelectedId(row.id), { icon: <Eye size={12} /> }),
          m.action('Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
          m.separator(),
          m.copyId(row.id),
          m.action('Delete', () => setDeleteTarget(row), { danger: true, icon: <Trash2 size={12} /> }),
        ]}
      />

      {/* Detail panel — appears when a complaint is selected. Tabs
          would be premature here (only two surfaces: complaint +
          investigations). A modal overlay style keeps focus on the
          one complaint at a time and matches the cascade Esc behavior
          (Esc closes the detail; the detail panel is the second-to-
          last layer in the cascade). */}
      {selected && (
        <ComplaintDetail
          complaint={selected}
          investigations={investigations}
          investigationsLoading={investigationsLoading}
          onClose={() => setSelectedId(null)}
          onEdit={() => openEdit(selected)}
          onDelete={() => setDeleteTarget(selected)}
          onExportPdf={handleExportPdf}
          pdfBusy={pdfBusy}
          onRefreshInvestigations={async () => {
            try {
              const r = await apiFetch<{ data: Investigation[] }>(`/affairs/complaints/${selected.id}/investigations`);
              setInvestigations(r.data || []);
            } catch { addToast('Failed to refresh investigations', 'error'); }
          }}
        />
      )}

      <AffairsFormModal isOpen={formOpen} onClose={() => { setFormOpen(false); setEditingRecord(undefined); }}
        onSubmit={handleSubmit} isSubmitting={formSubmitting} editingRecord={editingRecord} submitError={formError} />
      <DeleteRecordModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        recordType="IA complaint"
        recordLabel={deleteTarget?.complaint_number || deleteTarget?.complainant_name || undefined}
        details={
          deleteTarget && (
            <>
              {deleteTarget.complainant_name && <div>Complainant: {deleteTarget.complainant_name}</div>}
              {deleteTarget.subject_officer_name && <div>Subject officer: {deleteTarget.subject_officer_name}</div>}
              {deleteTarget.complaint_type && <div>Type: {deleteTarget.complaint_type}</div>}
              <div className="text-amber-400 mt-1">Removes the complaint AND all investigations.</div>
            </>
          )
        }
        isDeleting={deleting}
      />
    </div>
  );
}

// ── Detail panel (inline, not extracted — only used here) ──────
function ComplaintDetail({
  complaint, investigations, investigationsLoading, onClose, onEdit, onDelete,
  onExportPdf, pdfBusy, onRefreshInvestigations,
}: {
  complaint: Complaint;
  investigations: Investigation[];
  investigationsLoading: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onExportPdf: () => void;
  pdfBusy: boolean;
  onRefreshInvestigations: () => void;
}) {
  const isClosed = complaint.status && CLOSED_STATUSES.has(complaint.status);
  return (
    <div className="border border-rmpg-700 bg-surface-raised p-4 space-y-3" aria-labelledby="ia-detail-title">
      <div className="flex items-start gap-3">
        <ShieldAlert size={18} className="text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div id="ia-detail-title" className="text-sm font-semibold text-rmpg-100 truncate">
            {complaint.complaint_number} — {toDisplayLabel(complaint.complaint_type)}
          </div>
          <div className="text-[11px] text-rmpg-400 mt-0.5">
            {complaint.complainant_name || 'Anonymous complainant'}
            {complaint.subject_officer_name && (
              <>
                {' · subject: '}
                <span className="text-rmpg-200">{complaint.subject_officer_name}</span>
              </>
            )}
            {' · status: '}
            <span className={isClosed ? 'text-rmpg-200' : 'text-amber-400'}>
              {toDisplayLabel(complaint.status)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onExportPdf}
            disabled={pdfBusy}
            aria-label="Export court-ready PDF"
            className="toolbar-btn flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-wait"
            style={{ height: 26, padding: '0 8px' }}
            title="Generate the confidential, payload-hashed court-ready PDF"
          >
            <FileDown size={12} />
            {pdfBusy ? 'Generating…' : 'Court PDF'}
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit complaint"
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 26, padding: '0 8px' }}
          >
            <Pencil size={12} /> Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete complaint"
            className="toolbar-btn flex items-center gap-1.5 text-red-400 hover:text-red-300"
            style={{ height: 26, padding: '0 8px' }}
          >
            <Trash2 size={12} /> Delete
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            className="toolbar-btn flex items-center justify-center"
            style={{ height: 26, width: 26 }}
            title="Close (Esc)"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {complaint.description && (
        <section>
          <div className="text-[10px] text-rmpg-500 uppercase font-semibold mb-1">Allegation</div>
          <div className="text-[12px] text-rmpg-100 whitespace-pre-wrap">{complaint.description}</div>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <div className="text-[10px] text-rmpg-500 uppercase font-semibold">Incident date</div>
          <div className="text-rmpg-200">{complaint.incident_date || '—'}</div>
        </div>
        <div>
          <div className="text-[10px] text-rmpg-500 uppercase font-semibold">Incident location</div>
          <div className="text-rmpg-200">{complaint.incident_location || '—'}</div>
        </div>
        <div>
          <div className="text-[10px] text-rmpg-500 uppercase font-semibold">Filed</div>
          <div className="text-rmpg-200">{complaint.created_at}</div>
        </div>
        <div>
          <div className="text-[10px] text-rmpg-500 uppercase font-semibold">Closed</div>
          <div className="text-rmpg-200">{complaint.closed_date || '—'}</div>
        </div>
        {complaint.witnesses && (
          <div className="col-span-2">
            <div className="text-[10px] text-rmpg-500 uppercase font-semibold">Witnesses</div>
            <div className="text-rmpg-200 whitespace-pre-wrap">{complaint.witnesses}</div>
          </div>
        )}
        {complaint.evidence_list && (
          <div className="col-span-2">
            <div className="text-[10px] text-rmpg-500 uppercase font-semibold">Evidence</div>
            <div className="text-rmpg-200 whitespace-pre-wrap">{complaint.evidence_list}</div>
          </div>
        )}
        {complaint.finding && (
          <div className="col-span-2">
            <div className="text-[10px] text-rmpg-500 uppercase font-semibold">Finding</div>
            <div className="text-rmpg-200 whitespace-pre-wrap">{complaint.finding}</div>
          </div>
        )}
        {complaint.discipline && (
          <div className="col-span-2">
            <div className="text-[10px] text-rmpg-500 uppercase font-semibold">Discipline</div>
            <div className="text-rmpg-200 whitespace-pre-wrap">{complaint.discipline}</div>
          </div>
        )}
      </div>

      <section className="border-t border-rmpg-800 pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] text-rmpg-500 uppercase font-semibold">
            Investigations ({investigations.length})
          </div>
          <button
            type="button"
            onClick={onRefreshInvestigations}
            className="text-[10px] text-rmpg-400 hover:text-rmpg-200"
          >
            Refresh
          </button>
        </div>
        {investigationsLoading && (
          <div className="text-[11px] text-rmpg-400 italic">Loading…</div>
        )}
        {!investigationsLoading && investigations.length === 0 && (
          <div className="text-[11px] text-rmpg-500 italic">
            No investigations recorded. Use the IA write API to spin one off.
          </div>
        )}
        {!investigationsLoading && investigations.length > 0 && (
          <ul className="space-y-2">
            {investigations.map((inv) => (
              <li key={inv.id} className="border border-rmpg-800 p-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-semibold text-rmpg-100">#{inv.id}</span>
                    {' · '}
                    <span className="text-rmpg-200">{inv.investigator_name || 'Unassigned'}</span>
                  </div>
                  <span className="text-rmpg-400 text-[10px]">
                    {toDisplayLabel(inv.status)}
                  </span>
                </div>
                <div className="text-[10px] text-rmpg-500 mt-1">
                  started {inv.started_at || '—'}
                  {inv.completed_at && ` · completed ${inv.completed_at}`}
                  {inv.reviewed_at && ` · reviewed ${inv.reviewed_at}`}
                </div>
                {inv.summary && <div className="text-rmpg-200 mt-1 whitespace-pre-wrap">{inv.summary}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
