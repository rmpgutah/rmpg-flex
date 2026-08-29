import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import JailFormModal, { JailFormData } from '../components/JailFormModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { useMenuActions } from '../utils/contextMenuActions';
import { useAuth } from '../context/AuthContext';
import type { ContextMenuItem } from '../context/ContextMenuContext';
import {
  Building2, Users, DoorOpen, ClipboardList, Plus, Pencil, Trash2, Eye, Database,
  ArrowRight, FileText, Printer, Search, X, RefreshCw,
} from 'lucide-react';
import {
  openJailBookingSheetPdf,
  openJailRosterSnapshotPdf,
  type InmateChargeRow,
} from '../utils/jailBookingSheetPdf';
import { parseTimestamp } from '../utils/dateUtils';
import { formatEnumValue } from '../utils/formatters';
import { inmateRosterToCsv, downloadTextFile } from '../utils/rmsListExport';

interface Inmate {
  id: number; booking_number: string; last_name: string; first_name: string;
  middle_name?: string; status: string; housing_unit: string; housing_cell?: string;
  booking_date: string; gender: string; dob: string;
  release_date?: string; release_reason?: string;
  arresting_agency?: string; arresting_officer_id?: number | null;
  arrest_incident_id?: number | null;
  bail_amount?: number | null; bond_type?: string;
  notes?: string; race?: string;
  height_inches?: number | null; weight_lbs?: number | null;
  hair_color?: string; eye_color?: string; skin_tone?: string;
  marks_scars_tattoos?: string;
}

interface RosterStats {
  population_summary?: { total_records?: number };
  active_bookings?: number;
  // recent_syncs[0] is the most-recent sync log row; finished_at tells us
  // when the 4h cron last ingested a scraper batch.
  recent_syncs?: Array<{
    county?: string; status?: string; records_found?: number;
    records_new?: number; finished_at?: string; error?: string;
  }>;
}

const STATUS_OPTIONS = ['booked', 'housed', 'court', 'medical', 'released', 'transferred'] as const;
type StatusFilter = '' | typeof STATUS_OPTIONS[number];

function fmtRelativeAge(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const t = parseTimestamp(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return 'just now';
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function JailPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canDelete = user?.role === 'admin' || user?.role === 'manager';
  const canCreate = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'supervisor';
  const [searchParams, setSearchParams] = useSearchParams();
  const [inmates, setInmates] = useState<Inmate[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, housed: 0, booked: 0 });
  // Count of scraped county-roster bookings (live in arrest_records, surfaced on
  // the Arrest Records page). This screen manages the manual `inmates` table, so
  // the scraped roster would otherwise be invisible from here.
  const [rosterCount, setRosterCount] = useState(0);
  // Most-recent scraper finish — feeds the "Roster synced Xh ago" pill so the
  // shift supervisor can tell at a glance whether the 4h cron is healthy.
  const [rosterLastSync, setRosterLastSync] = useState<string | null>(null);
  const [rosterLastStatus, setRosterLastStatus] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Inmate | undefined>(undefined);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [loadError, setLoadError] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const { addToast } = useToast();
  const m = useMenuActions();
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  const fetchInmates = useCallback(async () => {
    try {
      const r = await apiFetch<{ data: Inmate[]; pagination: any }>('/jail/inmates');
      setInmates(r.data || []);
      setLoadError(false);
    } catch { setLoadError(true); }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      // /jail/stats actually returns { total_inmates, by_status, by_classification }
      // — the old { total, housed, booked } shape here never matched, so
      // stats.total/.housed/.booked were always undefined and the three
      // StatsCards on this page silently rendered blank.
      const r = await apiFetch<{ total_inmates: number; by_status: Record<string, number> }>('/jail/stats');
      setStats({
        total: r.total_inmates ?? 0,
        housed: r.by_status?.housed ?? 0,
        booked: r.by_status?.booked ?? 0,
      });
    } catch { /* ignore */ }
  }, []);

  const fetchRosterCount = useCallback(async () => {
    try {
      const r = await apiFetch<RosterStats>('/jail-roster/statistics');
      setRosterCount(r?.population_summary?.total_records ?? r?.active_bookings ?? 0);
      const latest = Array.isArray(r?.recent_syncs) ? r.recent_syncs[0] : null;
      setRosterLastSync(latest?.finished_at || null);
      setRosterLastStatus(latest?.status || null);
    } catch {
      // scraper not provisioned — leave at 0 / null
      setRosterLastSync(null);
      setRosterLastStatus(null);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchInmates(), fetchStats(), fetchRosterCount()]).finally(() => setLoading(false));
  }, [fetchInmates, fetchStats, fetchRosterCount]);

  // ── URL deep-link contract (matches the v1024-v1058 cross-page pattern) ──
  // ?inmate_id=<n> / ?booking_id=<n>  → open the edit modal for that row,
  //                                     scroll the row into view, flash-highlight.
  // ?booking_number=BK-26-0042        → same as above by booking #.
  // ?status=<state>                   → preselect a status filter.
  // ?q=<term>                         → preselect the search term.
  // All five params are consumed once and stripped (replace:true) so a manual
  // refresh doesn't re-pop the modal / re-pin the operator to a stale link.
  const deepLinkConsumedRef = useRef(false);
  useEffect(() => {
    if (loading || deepLinkConsumedRef.current) return;
    const inmateIdParam = searchParams.get('inmate_id') || searchParams.get('booking_id');
    const bookingNumberParam = searchParams.get('booking_number');
    const statusParam = searchParams.get('status') as StatusFilter | null;
    const qParam = searchParams.get('q');

    let consumed = false;
    if (qParam) { setSearch(qParam); consumed = true; }
    if (statusParam && STATUS_OPTIONS.includes(statusParam as any)) {
      setStatusFilter(statusParam);
      consumed = true;
    }
    if (inmateIdParam) {
      const id = parseInt(inmateIdParam, 10);
      const target = inmates.find(i => i.id === id);
      if (target) {
        setEditingRecord(target); setFormError(null); setFormOpen(true);
        setHighlightId(id);
      } else {
        addToast(`Inmate #${inmateIdParam} not found in current view.`, 'warning');
      }
      consumed = true;
    } else if (bookingNumberParam) {
      const target = inmates.find(i => i.booking_number === bookingNumberParam);
      if (target) {
        setEditingRecord(target); setFormError(null); setFormOpen(true);
        setHighlightId(target.id);
      } else {
        addToast(`Booking ${bookingNumberParam} not found in current view.`, 'warning');
      }
      consumed = true;
    }

    if (consumed) {
      deepLinkConsumedRef.current = true;
      // Strip the consumed params so a refresh doesn't reapply them.
      const next = new URLSearchParams(searchParams);
      ['inmate_id', 'booking_id', 'booking_number', 'status', 'q'].forEach(k => next.delete(k));
      setSearchParams(next, { replace: true });
    }
  }, [loading, inmates, searchParams, setSearchParams, addToast]);

  // Flash-highlight fade — same 3s window as Equipment / FlexCam.
  useEffect(() => {
    if (highlightId === null) return;
    const row = rowRefs.current.get(highlightId);
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHighlightId(null), 3000);
    return () => clearTimeout(t);
  }, [highlightId]);

  const openNew = useCallback(() => {
    setEditingRecord(undefined); setFormError(null); setFormOpen(true);
  }, []);
  const openEdit = useCallback((rec: Inmate) => {
    setEditingRecord(rec); setFormError(null); setFormOpen(true);
  }, []);

  const handleFormSubmit = async (data: JailFormData) => {
    setFormSubmitting(true); setFormError(null);
    try {
      const body: Record<string, any> = { ...data };
      if (body.height_inches) body.height_inches = parseInt(body.height_inches);
      if (body.weight_lbs) body.weight_lbs = parseInt(body.weight_lbs);
      if (body.arresting_officer_id) body.arresting_officer_id = parseInt(body.arresting_officer_id);
      if (body.arrest_incident_id) body.arrest_incident_id = parseInt(body.arrest_incident_id);
      if (body.bail_amount) body.bail_amount = parseFloat(body.bail_amount);

      if (editingRecord) {
        await apiFetch(`/jail/inmates/${editingRecord.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiFetch('/jail/inmates', { method: 'POST', body: JSON.stringify(body) });
      }
      setFormOpen(false); setEditingRecord(undefined);
      fetchInmates(); fetchStats();
      addToast(editingRecord ? 'Inmate updated' : 'Inmate booked', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save inmate';
      setFormError(msg); addToast(msg, 'error');
    } finally { setFormSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await apiFetch(`/jail/inmates/${deleteId}`, { method: 'DELETE' });
      setDeleteId(null); fetchInmates(); fetchStats();
      addToast('Inmate record deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const deleteTarget = useMemo(
    () => deleteId ? inmates.find(i => i.id === deleteId) : null,
    [deleteId, inmates],
  );

  // ── Filtered view ─────────────────────────────────────────
  const filteredInmates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return inmates.filter(i => {
      if (statusFilter && i.status !== statusFilter) return false;
      if (!term) return true;
      const haystack = [
        i.booking_number, i.last_name, i.first_name, i.middle_name,
        i.housing_unit, i.housing_cell,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [inmates, search, statusFilter]);

  const filtersActive = !!search.trim() || !!statusFilter;
  const clearFilters = useCallback(() => { setSearch(''); setStatusFilter(''); }, []);

  // ── PDF actions ───────────────────────────────────────────
  const handlePrintBookingSheet = useCallback(async (row: Inmate) => {
    setPrintingId(row.id);
    let charges: InmateChargeRow[] = [];
    try {
      const r = await apiFetch<{ data: InmateChargeRow[] }>(`/jail/inmates/${row.id}/charges`);
      charges = r.data || [];
    } catch {
      addToast('Could not fetch charges — printing without them.', 'warning');
    }
    try {
      openJailBookingSheetPdf({
        inmate: row,
        charges,
        preparedBy: user?.full_name || user?.username || undefined,
      });
    } finally {
      setPrintingId(null);
    }
  }, [addToast, user]);

  const handlePrintRoster = useCallback(() => {
    const scope = filtersActive
      ? `Filtered${statusFilter ? ` · status=${statusFilter}` : ''}${search.trim() ? ` · "${search.trim()}"` : ''}`
      : 'All manually-booked inmates';
    openJailRosterSnapshotPdf({
      rows: filteredInmates,
      scope,
      preparedBy: user?.full_name || user?.username || undefined,
    });
  }, [filteredInmates, filtersActive, search, statusFilter, user]);

  // ── Esc smart-cascade ─────────────────────────────────────
  // Smallest-open-first: delete confirm → form modal → search field.
  // (FormModal handles its own Esc when open via the FormModal hook;
  //  this top-level handler only fires when nothing modal is open and
  //  closes the dialog ourselves to keep the cascade explicit.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deleteId !== null) {
        e.stopPropagation();
        setDeleteId(null);
        return;
      }
      // FormModal owns its Esc; do not double-close it here.
      if (formOpen) return;
      if (filtersActive) {
        e.stopPropagation();
        clearFilters();
        return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [deleteId, formOpen, filtersActive, clearFilters]);

  // ── N shortcut → New Inmate ───────────────────────────────
  // Typing-suppressed: don't swallow N when an input / select / textarea /
  // contentEditable element is focused. Matches the v1055 Equipment
  // / v1054 Training shortcut behavior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (t.isContentEditable) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key !== 'n' && e.key !== 'N') return;
      if (formOpen || deleteId !== null) return;
      if (!canCreate) return;
      e.preventDefault();
      openNew();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [formOpen, deleteId, canCreate, openNew]);

  const columns = [
    { key: 'booking_number', label: 'Booking #' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'first_name', label: 'First Name' },
    { key: 'status', label: 'Status' },
    { key: 'housing_unit', label: 'Housing' },
    { key: 'booking_date', label: 'Booking Date' },
    {
      key: 'actions', label: '', width: '130px', render: (row: Inmate) => (
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); handlePrintBookingSheet(row); }}
            disabled={printingId === row.id}
            className="text-rmpg-400 hover:text-brand-300 disabled:opacity-50"
            title="Print booking sheet (PDF)"
            aria-label={`Print booking sheet for ${row.booking_number}`}
          >
            <FileText size={12} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="text-rmpg-400 hover:text-rmpg-100" title="Edit" aria-label={`Edit ${row.booking_number}`}><Pencil size={12} /></button>
          {canDelete && (
            <button onClick={(e) => { e.stopPropagation(); setDeleteId(row.id); }} className="text-red-500 hover:text-red-300" title="Delete" aria-label={`Delete ${row.booking_number}`}><Trash2 size={12} /></button>
          )}
        </div>
      ),
    },
  ];

  // Wrap DataTable rows so deep-linked rows can flash-highlight. We pull
  // the row's <tr> out of the DOM by booking_number after render via a
  // ref map keyed on inmate.id.
  // NOTE: DataTable doesn't expose a per-row ref hook, so we attach via
  // a one-pass effect after filteredInmates change.
  useEffect(() => {
    if (highlightId === null) return;
    // best-effort: find the row's first cell containing the booking #
    const target = filteredInmates.find(i => i.id === highlightId);
    if (!target) return;
    const all = document.querySelectorAll<HTMLTableRowElement>('tr');
    for (const tr of Array.from(all)) {
      if (tr.textContent?.includes(target.booking_number)) {
        rowRefs.current.set(highlightId, tr);
        tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
  }, [highlightId, filteredInmates]);

  if (loading) return <div className="p-6 text-rmpg-500">Loading jail records...</div>;

  // Distinct empty states — separates "no manually-booked inmates yet"
  // (table is actually empty) from "no inmates match your filters" (the
  // filter chips are hiding rows). The original generic "No inmates in
  // custody" string conflated both, leaving the operator unsure whether
  // to clear filters or escalate to "why is jail empty?".
  const totalCount = inmates.length;
  const matchedCount = filteredInmates.length;
  const filteredEmpty = filtersActive && matchedCount === 0;
  const trueEmpty = !filtersActive && totalCount === 0;
  const emptyMessage = filteredEmpty
    ? `No inmates match these filters (0 of ${totalCount}).`
    : trueEmpty
      ? canCreate ? 'No inmates booked yet. Press N or click "New Inmate" to book one.' : 'No inmates booked yet.'
      : 'No inmates in custody';

  const rosterSyncLabel = (() => {
    if (!rosterLastSync) return null;
    const rel = fmtRelativeAge(rosterLastSync);
    const tag = rosterLastStatus === 'success' ? 'OK' : (rosterLastStatus || 'unknown').toUpperCase();
    return `Roster ${tag} · ${rel ?? rosterLastSync}`;
  })();

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="JAIL MANAGEMENT" icon={Building2}>
        <button
          type="button"
          className="toolbar-btn"
          style={{ height: 28, padding: '0 10px' }}
          disabled={filteredInmates.length === 0}
          onClick={() => downloadTextFile('jail-roster.csv', inmateRosterToCsv(filteredInmates))}
          title="CSV of booking #, status, housing — no names or DOB"
        >CSV</button>
        <button
          type="button"
          onClick={handlePrintRoster}
          className="toolbar-btn flex items-center gap-1.5"
          style={{ height: 28, padding: '0 10px' }}
          title={`Print roster snapshot (${matchedCount} row${matchedCount === 1 ? '' : 's'}) — PDF`}
          disabled={matchedCount === 0}
        >
          <Printer size={13} /> Roster PDF
        </button>
        {canCreate && (
          <button
            onClick={openNew}
            className="toolbar-btn flex items-center gap-1.5"
            style={{ height: 28, padding: '0 10px' }}
            title="Book a new inmate (press N)"
          >
            <Plus size={13} /> New Inmate
          </button>
        )}
      </PanelTitleBar>
      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={Users} label="Total Inmates" value={stats.total} />
        <StatsCard icon={DoorOpen} label="Currently Housed" value={stats.housed} />
        <StatsCard icon={ClipboardList} label="Booked (Intake)" value={stats.booked} />
      </div>

      {rosterCount > 0 && (
        <button
          type="button"
          onClick={() => navigate('/arrest-records')}
          className="w-full flex items-center gap-3 text-left bg-brand-900/15 border border-brand-700/40 hover:bg-brand-900/25 px-3 py-2 transition-colors"
          style={{ borderRadius: 2 }}
          title="Scraped county jail rosters (Salt Lake, etc.) live in Arrest Records">
          <Database size={16} className="text-brand-400 shrink-0" />
          <div className="flex-1">
            <div className="text-[12px] font-semibold text-rmpg-100">
              {rosterCount.toLocaleString()} scraped county-roster booking{rosterCount === 1 ? '' : 's'} available
            </div>
            <div className="text-[10px] text-rmpg-400 flex items-center gap-2">
              <span>This screen lists manually-booked inmates. View the auto-scraped county jail rosters in Arrest Records.</span>
              {rosterSyncLabel && (
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${
                    rosterLastStatus === 'success'
                      ? 'border-emerald-700/40 text-emerald-300 bg-emerald-900/20'
                      : 'border-amber-700/40 text-amber-300 bg-amber-900/20'
                  }`}
                  style={{ borderRadius: 2 }}
                  title={rosterLastSync ?? undefined}
                >
                  <RefreshCw size={9} /> {rosterSyncLabel}
                </span>
              )}
            </div>
          </div>
          <span className="flex items-center gap-1 text-[11px] font-semibold text-brand-400 shrink-0">
            View Arrest Roster <ArrowRight size={13} />
          </span>
        </button>
      )}

      {loadError && (
        <div className="p-3 text-xs text-red-400 flex items-center justify-between">
          <span>Failed to load inmates.</span>
          <button type="button" className="toolbar-btn" onClick={() => { setLoading(true); void Promise.all([fetchInmates(), fetchStats(), fetchRosterCount()]).finally(() => setLoading(false)); }}>Retry</button>
        </div>
      )}

      {/* Filter strip — search + status. Keeps DataTable thin (the table is
          purely a renderer; filter state lives here so the roster-PDF action
          and the Esc-cascade-clear can read it). */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500 pointer-events-none" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search booking #, name, unit… (/)"
            className="input-dark w-full pl-7 pr-2"
            style={{ height: 28 }}
            aria-label="Search inmates"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="select-dark"
          style={{ height: 28 }}
          aria-label="Status filter"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="toolbar-btn flex items-center gap-1"
            style={{ height: 28, padding: '0 10px' }}
            title="Clear search + status filter (Esc)"
          >
            <X size={12} /> Clear
          </button>
        )}
        <span className="text-[10px] text-rmpg-500 ml-auto">
          {matchedCount} of {totalCount} shown
        </span>
      </div>

      <DataTable
        columns={columns}
        data={filteredInmates}
        emptyMessage={emptyMessage}
        onRowClick={(row) => openEdit(row)}
        rowContextMenu={(row): ContextMenuItem[] => [
          m.action('Open', () => openEdit(row), { icon: <Eye size={12} /> }),
          m.action('Edit', () => openEdit(row), { icon: <Pencil size={12} /> }),
          m.action('Print booking sheet', () => handlePrintBookingSheet(row), { icon: <FileText size={12} /> }),
          m.separator(),
          m.copyId(row.id),
          m.copy('Copy booking #', row.booking_number),
          ...(canDelete ? [m.action('Delete', () => setDeleteId(row.id), { danger: true, icon: <Trash2 size={12} /> })] : []),
        ]}
      />

      {filteredEmpty && (
        <div className="flex items-center justify-center gap-2 text-xs text-rmpg-400">
          <span>Filters are hiding {totalCount} record{totalCount === 1 ? '' : 's'}.</span>
          <button
            type="button"
            onClick={clearFilters}
            className="toolbar-btn px-3"
            style={{ height: 26 }}
          >
            Clear filters
          </button>
        </div>
      )}

      <JailFormModal isOpen={formOpen} onClose={() => { setFormOpen(false); setEditingRecord(undefined); }}
        onSubmit={handleFormSubmit} isSubmitting={formSubmitting}
        editingRecord={editingRecord} submitError={formError} />

      <ConfirmDialog
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Inmate Record"
        message="This permanently removes the inmate and all associated charges, visitors, property, medical, disciplinary, and transport records. This cannot be undone."
        details={deleteTarget ? (
          <>
            <div><span className="text-rmpg-500">Booking #</span> {deleteTarget.booking_number}</div>
            <div><span className="text-rmpg-500">Name</span> {[deleteTarget.last_name, deleteTarget.first_name].filter(Boolean).join(', ')}</div>
            <div><span className="text-rmpg-500">Status</span> {formatEnumValue(deleteTarget.status)}</div>
            {deleteTarget.housing_unit && (
              <div><span className="text-rmpg-500">Housing</span> {deleteTarget.housing_unit}{deleteTarget.housing_cell ? ` / ${deleteTarget.housing_cell}` : ''}</div>
            )}
          </>
        ) : undefined}
        confirmLabel="Delete inmate"
        confirmVariant="danger"
        isLoading={deleting}
      />
    </div>
  );
}
