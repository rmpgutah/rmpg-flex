// client/src/pages/warrants/WarrantsListTab.tsx
// ============================================================
// Warrants — List tab
// ============================================================
// Extracted from the WarrantsPage.tsx megafile (see
// docs/superpowers/specs/2026-07-14-warrants-page-rebuild-design.md and
// docs/superpowers/plans/2026-07-14-warrants-list-tab-extraction.md).
//
// Owns: the warrant list/filters/search/sort/pagination/batch-actions,
// the selected-warrant detail panel, and the Serve/Delete/Archive/
// Unarchive/Update-status actions (all of which mutate this tab's own
// `warrants` array, hence why they live here and not in the shell).
//
// The New/Edit Warrant form modal is still owned by the shell
// (WarrantsPage.tsx) — deliberately deferred to a later extraction phase.
// Because that modal's save handler needs to update THIS tab's warrant
// list and error banner, this component exposes a WarrantsListTabHandle
// via forwardRef/useImperativeHandle that the shell calls into after a
// successful save.
// ============================================================

import React, {
  forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState,
} from 'react';
import type { NavigateFunction } from 'react-router';
import { useSearchParams } from 'react-router';
import {
  AlertTriangle, Archive, Activity, CheckCircle, Clock, Edit, Eye, FileText,
  Gavel, Loader2, MapPin, Pencil, Plus, Printer, RotateCcw, Scale, Search,
  Shield, Trash2, User, X, XCircle,
} from 'lucide-react';
import IconButton from '../../components/IconButton';
import ConfirmDialog from '../../components/ConfirmDialog';
import ViewOnMapLink from '../../components/ViewOnMapLink';
import JurisdictionLookup from '../../components/JurisdictionLookup';
import PrintRecordButton from '../../components/PrintRecordButton';
import LegalDataHunterValidateButton from '../../components/LegalDataHunterValidateButton';
import WarrantScreeningStatus from '../../components/WarrantScreeningStatus';
import LinkedEmailsSection from '../../components/LinkedEmailsSection';
import EmailedDocuments from '../../components/EmailedDocuments';
import CollapsibleSection from '../../components/CollapsibleSection';
import EmptyState from '../../components/EmptyState';
import StatusPill from '../../components/warrants/StatusPill';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';
import { useLiveSync } from '../../hooks/useLiveSync';
import { useWebSocket } from '../../context/WebSocketContext';
import type { ScraperWsEvent } from '../../types/scrapers';
import type { WSMessage } from '../../types';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import { toDisplayLabel } from '../../utils/formatters';
import { useWatchedWarrantIds } from './useWatchedWarrantIds';
import { formatDate, formatDateTime, parseTimestamp } from '../../utils/dateUtils';
import {
  priorityBucket, priorityChipClass, formatAge, freshnessClass, freshnessIcon,

} from '../../utils/warrantListHelpers';
import { buildWarrantPacketPdf } from '../../utils/warrantPacket';
import { downloadRecordPdf } from '../../utils/recordPdfGenerator';
import { displayUserName } from '../../utils/userDisplay';
import type { User as UserType } from '../../types';
import type { Warrant, UnifiedWarrant } from '../WarrantsPage';

export interface WarrantsListTabHandle {
  /** Re-fetch the current page of the list (used after the shell's Form modal saves). */
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  /** Patch a single warrant in the already-loaded list without a full refetch. */
  applyWarrantUpdate: (updated: Warrant) => void;
  /** If `id` matches the currently-selected/expanded warrant, re-fetch its detail. */
  refetchIfSelected: (id: number) => void;
  /** Surface an error in this tab's error banner (used by the shell's Form modal). */
  setListError: (message: string | null) => void;
  /** Seed the search box with a query (used by the Dashboard tab's quick search). */
  setSearchQuery: (query: string) => void;
}

export interface WarrantsListTabProps {
  /** Controls visibility without unmounting — see the shell-wiring task (Task 5). */
  isVisible: boolean;
  user: UserType | null;
  isAdminOrManager: boolean;
  /** admin | supervisor | manager — mirrors the server's requireRole for /warrants/:id/reopen. */
  isAdminSupervisorOrManager: boolean;
  isGodMode: boolean;
  canManageWarrants: boolean;
  isMobile: boolean;
  navigate: NavigateFunction;
  /** From the shell's useSearchParams() — read once on mount for deep-link init. */
  initialPersonId: string | null;
  initialWarrantId: string | null;
  /** Whether the shell's Form modal is currently open (used to hide the mobile FAB). */
  formOpen: boolean;
  onOpenNewForm: () => void;
  onOpenEditForm: (w: Warrant) => void;
  onOpenPersonProfile: (personId: number) => void;
}

// ============================================================
// Constants (temporarily duplicated from WarrantsPage.tsx — see the
// extraction plan; a later phase may hoist these to a shared module)
// ============================================================

// ── External (scraped) warrant rows ─────────────────────────────────────────
// GET /warrants/unified merges local `warrants` rows with `scraped_warrants`
// rows pulled by the national scrapers, and mints a SYNTHETIC string id for
// the latter — `scraped-<n>` (src/routes/warrants.ts). Those ids have no
// backing row in the `warrants` table, so every /warrants/:id call made with
// one (detail, single-warrant PDF, serve, archive, status, delete, reopen)
// is rejected by the server's `Number.isFinite(id)` guard with a 400
// "Invalid warrant id" — which showed up live as a stream of console 400s
// whenever a dispatcher clicked a national-source row.
//
// Detection is by id SHAPE rather than by the `source` field, because `source`
// is free-form (`row.source_key ?? row.source ?? 'national'`) while the id
// prefix is minted in exactly one place and is therefore reliable.
const isExternalWarrantId = (id: number | string | null | undefined): boolean =>
  typeof id === 'string' && !/^\d+$/.test(id);

const EXTERNAL_WARRANT_READONLY_MSG =
  'External (scraped) warrant — read-only until it is imported into the local system.';

const WARRANT_TYPES: { value: string; label: string }[] = [
  { value: 'arrest', label: 'Arrest' },
  { value: 'search', label: 'Search' },
  { value: 'bench', label: 'Bench' },
  { value: 'civil', label: 'Civil' },
  { value: 'other', label: 'Other' },
];

const WARRANT_STATUSES: { value: string; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'served', label: 'Served' },
  { value: 'recalled', label: 'Recalled' },
  { value: 'expired', label: 'Expired' },
  { value: 'quashed', label: 'Quashed' },
];

const OFFENSE_LEVELS: { value: string; label: string }[] = [
  { value: 'felony', label: 'Felony' },
  { value: 'misdemeanor', label: 'Misdemeanor' },
  { value: 'infraction', label: 'Infraction' },
  { value: 'civil', label: 'Civil' },
];

const TYPE_COLORS: Record<string, string> = {
  arrest: 'bg-red-900/40 text-red-300 border-red-700/50',
  search: 'bg-surface-sunken text-rmpg-300 border-border-default',
  bench: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  civil: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
  other: 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50',
};

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  arrest: Shield,
  search: Search,
  bench: Gavel,
  civil: Scale,
  other: FileText,
};

const SEVERITY_COLORS: Record<string, string> = {
  felony: 'bg-red-900/50 text-red-400 border-red-700/50',
  misdemeanor: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  infraction: 'bg-yellow-900/50 text-yellow-400 border-yellow-700/50',
  civil: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
};

function formatCurrency(amount: number | null): string {
  const n = Number(amount);
  if (amount == null || !Number.isFinite(n)) return '-'; // sentinel string → '-', never $NaN
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

const SENTINEL_TXT = new Set(['none', 'n/a', 'na', '0', 'null', '']);
// Utah/scraped charges arrive as a JSON-stringified array ('["BATTERY"]').
// Render the human form: parse the array and join, fall back to the raw
// string for already-plain values. Guards against JSON.parse yielding a
// non-array (number/object) which would throw on .join and leak the raw
// brackets into the UI (the '["FAILURE TO REMAIN…"]' display bug).
function chargesFromJson(charges: string | null | undefined): string {
  if (!charges || SENTINEL_TXT.has(String(charges).trim().toLowerCase())) return '';
  const raw = String(charges).trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String).join('; ');
    if (parsed == null) return '';
    return String(parsed);
  } catch {
    return raw;
  }
}

// Filter chip used in the Warrants tab list filter bar
function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider border ${active ? 'bg-[var(--brand-gold)] text-black border-[var(--brand-gold)]' : 'bg-transparent text-rmpg-300 border-rmpg-600 hover:border-rmpg-400'}`}
    >
      {children}
    </button>
  );
}

const WarrantsListTab = forwardRef<WarrantsListTabHandle, WarrantsListTabProps>(function WarrantsListTab(props, ref) {
  const { isVisible } = props;
  const { addToast } = useToast();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const serveTitleId = useId();

  const [searchParams, setSearchParams] = useSearchParams();

  // ── ?warrant_id=<id> deep-link auto-select — resolved AFTER warrants
  // hydrate; we hold the pending id in a ref so a rerender doesn't
  // re-attempt the lookup.
  const pendingWarrantIdRef = useRef<string | null>(props.initialWarrantId);
  const [filterPersonId, setFilterPersonId] = useState<string | null>(props.initialPersonId);

  // ============================================================
  // WARRANTS TAB STATE
  // ============================================================
  const [warrants, setWarrants] = useState<UnifiedWarrant[]>([]);
  // Mirror of `warrants` for callbacks that must read the current list without
  // taking it as a dependency (fetchWarrantDetail / handlePrintWarrantPdf need
  // it only to resolve external rows, and re-identifying them on every list
  // refresh would churn useImperativeHandle).
  const warrantsRef = useRef<UnifiedWarrant[]>([]);
  useEffect(() => { warrantsRef.current = warrants; }, [warrants]);
  const [selectedWarrant, setSelectedWarrant] = useState<Warrant | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterSource, setFilterSource] = useState<string>('');
  const [filterCourt, setFilterCourt] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);

  // ── Utah warrant poll status strip — last run summary + live in-progress
  // updates via the same 'scraper_events' WS channel the Sources/Scrapers
  // Live Feed uses (see utahWarrantPoller.ts run_started/run_progress/
  // run_completed/run_failed broadcasts).
  const [pollStatus, setPollStatus] = useState<{
    status: 'running' | 'completed' | 'failed';
    started_at: string;
    completed_at: string | null;
    persons_checked: number;
    persons_total: number | null;
    new_warrants_found: number;
    warrants_cleared: number;
    errors: number;
    error_message: string | null;
  } | null>(null);
  const { subscribe } = useWebSocket();

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ data: Array<{
      status: 'running' | 'completed' | 'failed'; started_at: string; completed_at: string | null;
      persons_checked: number; new_warrants_found: number; warrants_cleared: number;
      errors: number; error_message: string | null;
    }> }>('/warrants/watch/runs?limit=1')
      .then((res) => {
        if (cancelled) return;
        const run = res?.data?.[0];
        if (run) {
          setPollStatus({ ...run, persons_total: null });
        }
      })
      .catch(() => { /* poll status strip is informational only — fail silent */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handler = (msg: WSMessage) => {
      const data = (msg as { data?: ScraperWsEvent }).data;
      if (!data || data.source_key !== 'utah-warrant-watch') return;
      if (data.event === 'run_started') {
        setPollStatus({
          status: 'running', started_at: data.started_at, completed_at: null,
          persons_checked: 0, persons_total: null, new_warrants_found: 0,
          warrants_cleared: 0, errors: 0, error_message: null,
        });
      } else if (data.event === 'run_progress') {
        setPollStatus((prev) => prev && prev.status === 'running' ? {
          ...prev,
          persons_checked: data.persons_checked,
          persons_total: data.persons_total,
          new_warrants_found: data.new_warrants_found,
          errors: data.errors,
        } : prev);
      } else if (data.event === 'run_completed') {
        setPollStatus((prev) => prev ? {
          ...prev, status: 'completed', completed_at: new Date().toISOString(),
          new_warrants_found: data.parsed, warrants_cleared: data.updated,
        } : prev);
      } else if (data.event === 'run_failed') {
        setPollStatus((prev) => prev ? {
          ...prev, status: 'failed', completed_at: new Date().toISOString(), error_message: data.error,
        } : prev);
      }
    };
    const unsubscribe = subscribe('scraper_events', handler);
    return () => unsubscribe();
  }, [subscribe]);

  // Batch selection
  const [batchSelected, setBatchSelected] = useState<Set<number>>(new Set());
  const [batchStatus, setBatchStatus] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  // Bulk-action confirms — replace native window.confirm with ConfirmDialog
  // so the operator gets a themed modal that matches the rest of the page.
  const [bulkUpdateConfirmOpen, setBulkUpdateConfirmOpen] = useState(false);
  const [bulkArchiveConfirmOpen, setBulkArchiveConfirmOpen] = useState(false);
  const [bulkPrintConfirmOpen, setBulkPrintConfirmOpen] = useState(false);

  // Phase 1 sort + filter chips state
  const [sortKey, setSortKey] = useState<'priority' | 'age' | 'freshness' | 'alpha'>('priority');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [filterPriority, setFilterPriority] = useState(false);
  const [filterSinceWeek, setFilterSinceWeek] = useState(false);
  const [filterMatches, setFilterMatches] = useState(false);
  const [filterStateChip, setFilterStateChip] = useState<string>('');
  const [filterFederal, setFilterFederal] = useState(false);
  const [filterArchivedChip, setFilterArchivedChip] = useState(false);
  const [filterWatchedOnly, setFilterWatchedOnly] = useState(false);
  const { watchedIds, refresh: refreshWatchedIds } = useWatchedWarrantIds();

  // Serve modal
  const [serveModalOpen, setServeModalOpen] = useState(false);
  const [serveLocation, setServeLocation] = useState('');
  const [serving, setServing] = useState(false);

  // Delete confirm
  const [deletingWarrant, setDeletingWarrant] = useState<Warrant | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Single-warrant archive confirm (detail panel toolbar)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveTargetId, setArchiveTargetId] = useState<number | null>(null);

  const anyFilterActive = filterPriority || filterSinceWeek || filterMatches || !!filterStateChip || filterFederal || filterArchivedChip || filterWatchedOnly;

  function toggleSort(key: 'priority' | 'age' | 'freshness' | 'alpha') {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortOrder(key === 'priority' ? 'desc' : 'asc');
    }
  }

  function clearAllFilters() {
    setFilterPriority(false);
    setFilterSinceWeek(false);
    setFilterMatches(false);
    setFilterStateChip('');
    setFilterFederal(false);
    setFilterArchivedChip(false);
    setFilterWatchedOnly(false);
  }

  // Batch actions all POST integer id arrays to /warrants/batch-update,
  // /bulk-archive, /bulk-review and the packet builder — external (scraped)
  // rows have no local id to send, so they're excluded from selection.
  const batchSelectableWarrants = warrants.filter((w) => !isExternalWarrantId(w.id));
  const toggleBatchSelect = (id: number) => {
    if (isExternalWarrantId(id)) { addToast(EXTERNAL_WARRANT_READONLY_MSG, 'warning'); return; }
    setBatchSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (batchSelected.size === batchSelectableWarrants.length) {
      setBatchSelected(new Set());
    } else {
      setBatchSelected(new Set(batchSelectableWarrants.map(w => w.id)));
    }
  };
  const handleBatchUpdate = async () => {
    if (batchSelected.size === 0 || !batchStatus) return;
    setBulkUpdateConfirmOpen(true);
  };
  const performBatchUpdate = async () => {
    setBulkUpdateConfirmOpen(false);
    if (batchSelected.size === 0 || !batchStatus) return;
    setBatchSubmitting(true);
    try {
      await apiFetch('/warrants/batch-update', {
        method: 'PUT',
        body: JSON.stringify({ ids: Array.from(batchSelected), status: batchStatus }),
      });
      setBatchSelected(new Set());
      setBatchStatus('');
      fetchWarrants({ silent: true });
    } catch (err: any) { addToast(err?.message || 'Batch update failed', 'error'); }
    finally { setBatchSubmitting(false); }
  };

  // Phase 1 bulk handlers — Archive / Mark Reviewed / Print Packet
  const handleBulkArchive = async () => {
    if (!batchSelected.size) return;
    setBulkArchiveConfirmOpen(true);
  };
  const performBulkArchive = async () => {
    setBulkArchiveConfirmOpen(false);
    if (!batchSelected.size) return;
    try {
      const res = await apiFetch<{ archived: number; skipped: number }>('/warrants/bulk-archive', {
        method: 'POST',
        body: JSON.stringify({ warrant_ids: Array.from(batchSelected) }),
      });
      addToast(`Archived ${res.archived} warrant(s)${res.skipped ? `, skipped ${res.skipped} already-archived` : ''}`, 'success');
      setBatchSelected(new Set());
      fetchWarrants({ silent: true });
    } catch (err: any) {
      addToast(err?.message || 'Bulk archive failed', 'error');
    }
  };

  const handleBulkReview = async () => {
    if (!batchSelected.size) return;
    try {
      const res = await apiFetch<{ reviewed: number }>('/warrants/bulk-review', {
        method: 'POST',
        body: JSON.stringify({ warrant_ids: Array.from(batchSelected) }),
      });
      addToast(`Marked ${res.reviewed} warrant(s) reviewed`, 'success');
      setBatchSelected(new Set());
      fetchWarrants({ silent: true });
    } catch (err: any) {
      addToast(err?.message || 'Bulk review failed', 'error');
    }
  };

  const handleBulkPrintPacket = async () => {
    if (!batchSelected.size) return;
    if (batchSelected.size > 200) { addToast('Packet print limited to 200 warrants', 'error'); return; }
    if (batchSelected.size > 50) {
      setBulkPrintConfirmOpen(true);
      return;
    }
    await performBulkPrintPacket();
  };
  const performBulkPrintPacket = async () => {
    setBulkPrintConfirmOpen(false);
    if (!batchSelected.size) return;
    const ids = Array.from(batchSelected);
    try {
      await buildWarrantPacketPdf(ids, {
        full_name: props.user?.full_name,
        badge_number: props.user?.badge_number,
      });
    } catch (err: any) {
      addToast(err?.message || 'Packet generation failed', 'error');
    }
  };

  // Phase 1: download a single-warrant PDF for the currently selected warrant
  const handlePrintWarrantPdf = async (id: number | string) => {
    try {
      // External (scraped) rows can't be re-fetched by id (see
      // isExternalWarrantId) — print from the loaded list row instead.
      let raw: any;
      if (isExternalWarrantId(id)) {
        raw = warrantsRef.current.find((w) => String(w.id) === String(id));
        if (!raw) {
          addToast('That external warrant is no longer in the current view', 'warning');
          return;
        }
      } else {
        const res = await apiFetch<any>(`/warrants/${id}`);
        raw = (res && typeof res === 'object' && 'data' in res ? res.data : res) || {};
      }

      const printedByName = displayUserName(props.user);

      const data: any = {
        ...raw,
        subject_aliases: raw.subject_aliases
          ? (Array.isArray(raw.subject_aliases) ? raw.subject_aliases : [raw.subject_aliases])
          : undefined,
        printed_by_name: printedByName,
        printed_by_badge: props.user?.badge_number,
        printed_at: new Date().toISOString(),
      };

      // Filename fallback ladder — warrant_number is often the literal
      // sentinel "N/A" (the warrant create form defaults it that way for
      // manually-entered warrants), so a naive `warrant-${warrant_number}`
      // produced files named `warrant-N_A.pdf` / `N_A_warrant.pdf`
      // depending on internal sanitization. Try real warrant_number first,
      // then subject-name + local id, then bare id, so every download
      // gets an operator-readable name.
      const sentinelRe = /^(n\/a|none|null|undefined)$/i;
      const rawWarrantNumber = typeof raw.warrant_number === 'string' ? raw.warrant_number.trim() : '';
      const goodWarrantNumber = rawWarrantNumber && !sentinelRe.test(rawWarrantNumber) ? rawWarrantNumber : '';
      const subjectSlug = [raw.subject_last_name, raw.subject_first_name]
        .map((s: any) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean)
        .join('-');
      const filenameStem =
        goodWarrantNumber
          || (subjectSlug ? `${subjectSlug}-${id}` : `warrant-${id}`);
      // Sanitize: replace anything that would confuse a filesystem (path
      // separators, control chars) with a hyphen. Allowed: word chars,
      // hyphen, period, parens, space.
      const safeStem = filenameStem.replace(/[^\w\-. ()]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      const filename = `warrant-${safeStem || id}.pdf`;

      await downloadRecordPdf('warrant', data, filename);
    } catch (err: any) {
      addToast(err?.message || 'Failed to print warrant PDF', 'error');
    }
  };

  // ============================================================
  // WARRANTS TAB FETCHES
  // ============================================================

  // Debounce search query — 400ms delay prevents hammering API on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchWarrants = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterType) params.set('type', filterType);
      if (filterSource) params.set('source', filterSource);
      if (filterCourt) params.set('court', filterCourt);
      if (filterSeverity) params.set('severity', filterSeverity);
      if (filterPersonId) params.set('person_id', filterPersonId);
      if (debouncedSearch) params.set('subject_name', debouncedSearch);
      params.set('archived', showArchived ? 'true' : 'false');
      params.set('page', String(page));
      params.set('per_page', '50');
      // Phase 1 sort + filter chips
      if (sortKey) params.set('sort', sortKey);
      if (sortOrder) params.set('order', sortOrder);
      if (filterPriority) params.set('priority_min', '70');
      if (filterSinceWeek) params.set('since_days', '7');
      if (filterMatches) params.set('matches_person', '1');
      if (filterStateChip) params.set('state', filterStateChip);
      if (filterFederal) params.set('state_prefix', 'fed_');
      if (filterArchivedChip) params.set('include_archived', '1');
      if (filterWatchedOnly) params.set('watched_only', '1');

      // Try unified endpoint first, fall back to standard.
      // Both API shapes are normalised to UnifiedWarrant[] before calling
      // setWarrants so the rest of the component always works with one
      // consistent interface regardless of which endpoint responded.
      const normaliseItems = (items: Warrant[]): UnifiedWarrant[] =>
        items.map((w) => ({
          ...w,
          // Ensure the optional UnifiedWarrant-specific field is always
          // present so downstream code never sees an undefined shape.
          source: w.source ?? null,
        }));

      try {
        const res = await apiFetch<{ warrants: Warrant[]; total: number }>(
          `/warrants/unified?${params.toString()}`
        );
        const items = normaliseItems(res.warrants || []);
        setWarrants(items);
        setTotalCount(res.total || 0);
        setTotalPages(Math.ceil((res.total || 0) / 50) || 1);
      } catch {
        // Fallback to standard endpoint
        const res = await apiFetch<{ data: Warrant[]; pagination: { total: number; totalPages: number } }>(
          `/warrants?${params.toString()}`
        );
        const items = normaliseItems(res.data || []);
        setWarrants(items);
        setTotalPages(res.pagination?.totalPages || 1);
        setTotalCount(res.pagination?.total || 0);
      }
    } catch (err: any) {
      if (!options?.silent) setError(err?.message || 'Failed to load warrants');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [filterStatus, filterType, filterSource, filterCourt, filterSeverity, filterPersonId, debouncedSearch, showArchived, page, sortKey, sortOrder, filterPriority, filterSinceWeek, filterMatches, filterStateChip, filterFederal, filterArchivedChip, filterWatchedOnly]);

  // This component only ever exists in the warrants-tab context —
  // `isVisible` governs display, not mount — so fetch on mount and on
  // every filter/sort/page change rather than gating on an activeTab check.
  useEffect(() => {
    fetchWarrants();
  }, [fetchWarrants]);

  // Phase 1: hydrate filter chips from URL on mount.
  // Uses searchParams (via useSearchParams) so react-router owns the URL and
  // ?warrant_id= / ?personId= deep-links are not clobbered on first render.
  useEffect(() => {
    setFilterPriority(searchParams.get('priority_min') === '70');
    setFilterSinceWeek(searchParams.get('since_days') === '7');
    setFilterMatches(searchParams.get('matches_person') === '1');
    setFilterStateChip(searchParams.get('state') || '');
    setFilterFederal(searchParams.get('state_prefix') === 'fed_');
    setFilterArchivedChip(searchParams.get('include_archived') === '1');
    setFilterWatchedOnly(searchParams.get('watched_only') === '1');
    // Also hydrate the ?status= deep-link into the dropdown filter so that
    // /warrants?status=active lands with the Active filter pre-selected.
    const statusParam = searchParams.get('status');
    if (statusParam && WARRANT_STATUSES.some(s => s.value === statusParam)) {
      setFilterStatus(statusParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 1: persist filter chips to URL when they change.
  // Uses setSearchParams so react-router remains the single URL authority —
  // window.history.replaceState was previously used here but it silently
  // dropped params managed by react-router (e.g. ?warrant_id=).
  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      // Remove chip params that are no longer active; set those that are.
      if (filterPriority) next.set('priority_min', '70'); else next.delete('priority_min');
      if (filterSinceWeek) next.set('since_days', '7'); else next.delete('since_days');
      if (filterMatches) next.set('matches_person', '1'); else next.delete('matches_person');
      if (filterStateChip) next.set('state', filterStateChip); else next.delete('state');
      if (filterFederal) next.set('state_prefix', 'fed_'); else next.delete('state_prefix');
      if (filterArchivedChip) next.set('include_archived', '1'); else next.delete('include_archived');
      if (filterWatchedOnly) next.set('watched_only', '1'); else next.delete('watched_only');
      return next;
    }, { replace: true });
  }, [filterPriority, filterSinceWeek, filterMatches, filterStateChip, filterFederal, filterArchivedChip, filterWatchedOnly, setSearchParams]);

  // Live sync — skip while form modal is open to prevent UI freezes during person search
  const silentRefreshWarrants = useCallback(() => {
    if (props.formOpen) return; // Don't refresh list while editing
    fetchWarrants({ silent: true });
  }, [fetchWarrants, props.formOpen]);
  // 'warrants' matches the liveBroadcast module derived from /api/warrants/*
  // mutations; 'alerts' never fired (no producer emits that module).
  useLiveSync('warrants', silentRefreshWarrants);

  // Fetch warrant detail.
  //
  // External (scraped) rows have no /warrants/:id endpoint — the unified list
  // row IS the whole record, so open the detail pane straight from it instead
  // of firing a request the server can only answer with a 400.
  const fetchWarrantDetail = useCallback(async (id: number | string) => {
    if (isExternalWarrantId(id)) {
      const row = warrantsRef.current.find((w) => String(w.id) === String(id));
      if (row) setSelectedWarrant(row);
      else addToast('That external warrant is no longer in the current view', 'warning');
      return;
    }
    try {
      const detail = await apiFetch<Warrant>(`/warrants/${id}`);
      setSelectedWarrant(detail);
    } catch { /* keep existing */ }
  }, [addToast]);

  // ── /warrants?warrant_id=<id> deep-link auto-select ──
  // Once the warrants list hydrates, find the target by id and select it. If
  // the row is not in the current paged view, fall through to a direct fetch
  // by id (so deep-links to archived or off-page warrants still land). Strip
  // the query after so a refresh doesn't re-trigger the lookup.
  useEffect(() => {
    const target = pendingWarrantIdRef.current;
    if (!target) return;
    if (loading) return;
    const hit = warrants.find((w) => String(w.id) === String(target));
    if (hit) {
      pendingWarrantIdRef.current = null;
      fetchWarrantDetail(hit.id);
      const next = new URLSearchParams(searchParams);
      next.delete('warrant_id');
      setSearchParams(next, { replace: true });
      return;
    }
    // Wait until the list has actually hydrated before trying the fallback.
    if (warrants.length === 0) return;
    // Not in the paged list — try a direct fetch by id (handles archived /
    // off-page targets).
    pendingWarrantIdRef.current = null;
    const numeric = Number(target);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      addToast(`Warrant ${target} not found`, 'warning');
    } else {
      (async () => {
        try {
          const detail = await apiFetch<Warrant>(`/warrants/${numeric}`);
          setSelectedWarrant(detail);
        } catch {
          addToast(`Warrant ${target} not in the current view (try clearing filters or unarchiving)`, 'warning');
        }
      })();
    }
    const next = new URLSearchParams(searchParams);
    next.delete('warrant_id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warrants, loading]);

  const handleServe = async () => {
    if (!selectedWarrant) return;
    if (isExternalWarrantId(selectedWarrant.id)) { addToast(EXTERNAL_WARRANT_READONLY_MSG, 'warning'); return; }
    setServing(true);
    try {
      const updated = await apiFetch<Warrant>(`/warrants/${selectedWarrant.id}/serve`, {
        method: 'PUT',
        body: JSON.stringify({ served_location: serveLocation.trim() || null }),
      });
      setWarrants((prev) => prev.map((w) => w.id === selectedWarrant.id ? { ...w, ...updated } : w));
      setSelectedWarrant(prev => prev ? { ...prev, ...updated } : prev);
      setServeModalOpen(false);
      setServeLocation('');
    } catch (err: any) {
      setError(err?.message || 'Failed to serve warrant');
    } finally {
      setServing(false);
    }
  };

  const handleArchive = async (id: number | string) => {
    if (isExternalWarrantId(id)) { addToast(EXTERNAL_WARRANT_READONLY_MSG, 'warning'); return; }
    try {
      await apiFetch(`/warrants/${id}/archive`, { method: 'POST' });
      await fetchWarrants({ silent: true });
      if (selectedWarrant?.id === id) setSelectedWarrant(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to archive warrant');
    }
  };

  const performArchive = async () => {
    setArchiveConfirmOpen(false);
    if (archiveTargetId == null) return;
    await handleArchive(archiveTargetId);
    setArchiveTargetId(null);
  };

  const handleUnarchive = async (id: number | string) => {
    if (isExternalWarrantId(id)) { addToast(EXTERNAL_WARRANT_READONLY_MSG, 'warning'); return; }
    try {
      await apiFetch(`/warrants/${id}/unarchive`, { method: 'POST' });
      await fetchWarrants({ silent: true });
      if (selectedWarrant?.id === id) fetchWarrantDetail(id);
    } catch (err: any) {
      setError(err?.message || 'Failed to unarchive warrant');
    }
  };

  const handleDelete = async () => {
    if (!deletingWarrant) return;
    if (isExternalWarrantId(deletingWarrant.id)) {
      addToast(EXTERNAL_WARRANT_READONLY_MSG, 'warning');
      setDeletingWarrant(null);
      return;
    }
    setDeleteLoading(true);
    try {
      await apiFetch(`/warrants/${deletingWarrant.id}`, { method: 'DELETE' });
      setDeletingWarrant(null);
      if (selectedWarrant?.id === deletingWarrant.id) setSelectedWarrant(null);
      await fetchWarrants({ silent: true });
    } catch (err: any) {
      setError(err?.message || 'Failed to delete warrant');
      setDeletingWarrant(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleUpdateStatus = async (id: number | string, newStatus: string) => {
    if (isExternalWarrantId(id)) { addToast(EXTERNAL_WARRANT_READONLY_MSG, 'warning'); return; }
    try {
      const updated = await apiFetch<Warrant>(`/warrants/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      setWarrants((prev) => prev.map((w) => w.id === id ? { ...w, ...updated } : w));
      if (selectedWarrant?.id === id) fetchWarrantDetail(id);
    } catch (err: any) {
      setError(err?.message || 'Failed to update status');
    }
  };

  const handleReopenWarrant = async (id: number | string) => {
    if (isExternalWarrantId(id)) { addToast(EXTERNAL_WARRANT_READONLY_MSG, 'warning'); return; }
    try {
      const updated = await apiFetch<Warrant>(`/warrants/${id}/reopen`, { method: 'POST' });
      setWarrants((prev) => prev.map((w) => w.id === id ? { ...w, ...updated } : w));
      if (selectedWarrant?.id === id) fetchWarrantDetail(id);
    } catch (err: any) {
      setError(err?.message || 'Failed to reopen warrant');
    }
  };

  // ── Right-click context menu (shared by list + table rows) ──
  const handleToggleWatch = useCallback(async (w: Warrant) => {
    // intel_watchlist.entity_id is an integer FK — a synthetic `scraped-<n>`
    // id can't be stored there.
    if (isExternalWarrantId(w.id)) { addToast(EXTERNAL_WARRANT_READONLY_MSG, 'warning'); return; }
    const isWatched = watchedIds.has(w.id);
    try {
      if (isWatched) {
        await apiFetch(`/intel/watchlist/warrant/${w.id}`, { method: 'DELETE' });
        addToast(`Stopped watching ${w.warrant_number}`, 'success');
      } else {
        await apiFetch('/intel/watchlist', {
          method: 'POST',
          body: JSON.stringify({ entity_type: 'warrant', entity_id: w.id, reason: 'flagged from warrants list' }),
        });
        addToast(`Watching ${w.warrant_number}`, 'success');
      }
      await refreshWatchedIds();
    } catch {
      addToast(isWatched ? 'Failed to unwatch warrant' : 'Failed to watch warrant', 'error');
    }
  }, [watchedIds, refreshWatchedIds, addToast]);

  const buildWarrantMenu = (w: Warrant): ContextMenuItem[] => {
    const isActive = w.status === 'active';
    const isArchived = !!w.archived_at;
    // External (scraped) rows have no local record to mutate — omit every write
    // action rather than offering buttons that can only fail (see
    // isExternalWarrantId). The read-only entries below still work.
    const isExternal = isExternalWarrantId(w.id);
    return [
      m.action('View warrant', () => fetchWarrantDetail(w.id), { icon: <Eye size={12} /> }),
      ...(w.subject_person_id
        ? [m.action('View subject', () => props.onOpenPersonProfile(w.subject_person_id!), { icon: <User size={12} /> })]
        : []),
      ...(w.subject_name && !/^(none|n\/a)$/i.test(w.subject_name)
        ? [m.go('Run NCIC on subject', `/ncic?type=person&q=${encodeURIComponent(w.subject_name)}`, <User size={12} />)]
        : []),
      ...(isExternal ? [] : [
        m.action('Edit warrant', () => props.onOpenEditForm(w), { icon: <Pencil size={12} /> }),
        m.action(
          watchedIds.has(w.id) ? 'Unwatch this warrant' : 'Watch this warrant',
          () => handleToggleWatch(w),
          { icon: <Eye size={12} /> },
        ),
      ]),
      m.separator(),
      ...(isActive && !isExternal
        ? [
            m.action('Mark served', () => handleUpdateStatus(w.id, 'served'), { icon: <CheckCircle size={12} /> }),
            m.action('Recall', () => handleUpdateStatus(w.id, 'recalled'), { icon: <XCircle size={12} /> }),
          ]
        : []),
      m.separator(),
      m.copy('Copy warrant #', w.warrant_number),
      m.copy('Copy subject', w.subject_name),
      m.copyId(w.id),
      ...(w.subject_person_id
        ? [
            m.go('Person record', `/records?tab=persons&personId=${w.subject_person_id}`, <FileText size={12} />),
            m.go('Arrest history', `/records?tab=arrests&personId=${w.subject_person_id}`, <FileText size={12} />),
          ]
        : []),
      ...(isExternal ? [] : [
        m.separator(),
        ...(isArchived
          ? [m.action('Unarchive', () => handleUnarchive(w.id), { icon: <RotateCcw size={12} /> })]
          : [m.action('Archive', () => handleArchive(w.id), { icon: <Archive size={12} /> })]),
        m.action('Delete', () => setDeletingWarrant(w), { icon: <Trash2 size={12} />, danger: true }),
      ]),
    ];
  };

  useImperativeHandle(ref, () => ({
    refresh: (opts) => fetchWarrants(opts),
    applyWarrantUpdate: (updated) => {
      setWarrants((prev) => prev.map((w) => w.id === updated.id ? { ...w, ...updated } : w));
      if (selectedWarrant?.id === updated.id) setSelectedWarrant((prev) => prev ? { ...prev, ...updated } : prev);
    },
    refetchIfSelected: (id) => {
      if (selectedWarrant?.id === id) fetchWarrantDetail(id);
    },
    setListError: (message) => setError(message),
    setSearchQuery: (query: string) => setSearchQuery(query),
  }), [fetchWarrants, selectedWarrant, fetchWarrantDetail]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ display: isVisible ? undefined : 'none' }}>
      {pollStatus && (
        // pointer-events-none: this strip is PURELY INFORMATIONAL — no buttons,
        // no links, only a title tooltip — so it never needs to receive clicks.
        // Verified live on 2026-07-30 that while this banner was present, a
        // DOM hit-test at the Screening tab's own centre returned THIS div and
        // not the tab (isSelfOrChild: false): every tab click on the Warrants
        // page was being swallowed. Making the strip click-transparent removes
        // that failure mode regardless of what causes the overlap, without
        // altering any layout geometry — safer than guessing at z-index on a
        // nav bar. The remaining 23px layout shift this strip causes when it
        // appears is a separate (cosmetic) misclick hazard, still open.
        <div
          className="flex items-center gap-2 px-2 py-1 mb-1.5 border border-surface-base bg-surface-deep text-[9px] uppercase font-semibold tracking-wide pointer-events-none"
          title={pollStatus.error_message ?? undefined}
        >
          {pollStatus.status === 'running' ? (
            <Loader2 className="w-3 h-3 text-brand-400 animate-spin shrink-0" />
          ) : pollStatus.status === 'failed' ? (
            <XCircle className="w-3 h-3 text-red-400 shrink-0" />
          ) : (
            <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />
          )}
          <span className="text-rmpg-400">Utah Warrant Poll:</span>
          {pollStatus.status === 'running' ? (
            <span className="text-brand-300">
              Running{pollStatus.persons_total ? ` — ${pollStatus.persons_checked}/${pollStatus.persons_total} checked` : '…'}
            </span>
          ) : pollStatus.status === 'failed' ? (
            <span className="text-red-400">Failed — {pollStatus.error_message ?? 'unknown error'}</span>
          ) : (
            <span className="text-rmpg-300">
              {pollStatus.persons_checked > 0 && `${pollStatus.persons_checked} checked, `}
              {pollStatus.new_warrants_found} found, {pollStatus.warrants_cleared} cleared
              {pollStatus.errors > 0 && `, ${pollStatus.errors} errors`}
            </span>
          )}
          {pollStatus.completed_at && (
            <span className="text-rmpg-500 ml-auto normal-case font-normal">
              {formatDateTime(pollStatus.completed_at)}
            </span>
          )}
        </div>
      )}
      <div className={`flex-1 ${props.isMobile ? 'flex flex-col' : 'flex'} overflow-hidden`}>
        {/* LEFT: Warrant List */}
        {/* Desktop width: the detail pane used to hold a fixed 45% even with
            NOTHING selected, squeezing this table into ~770px when it needs
            ~1324px — so BAIL, ATTEMPTS and DATE were hidden behind a horizontal
            scrollbar while half the screen showed an empty panel (measured live
            2026-07-30: table scrollWidth 1324 in a 987px container). Give the
            list the full width until a row is actually selected. */}
        <div className={`${props.isMobile ? (selectedWarrant ? 'hidden' : 'flex-1') : (selectedWarrant ? 'w-[55%]' : 'w-full')} flex flex-col ${!props.isMobile && selectedWarrant ? 'border-r border-rmpg-600' : ''}`}>
          {/* Filters (thin bar) */}
          <div className={`flex ${props.isMobile ? 'flex-col gap-1' : 'items-center gap-1.5'} px-2 py-1 border-b border-surface-base bg-surface-deep`}>
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" />
              <input id="ff-warrantslisttab-0"
                type="text"
                className={`input-dark w-full pl-7 ${searchQuery ? 'pr-7' : 'pr-2'} ${props.isMobile ? 'text-sm py-2.5' : 'text-xs'}`}
                placeholder="Search by name, warrant #, or charge..." aria-label="Search by name, warrant #, or charge..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { setDebouncedSearch(searchQuery); setPage(1); } }}
                style={props.isMobile ? { minHeight: 44 } : undefined}
              />
              {searchQuery && (
                <IconButton onClick={() => { setSearchQuery(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300" aria-label="Clear search">
                  <X className="w-3.5 h-3.5" />
                </IconButton>
              )}
            </div>
            <div className={`flex ${props.isMobile ? 'gap-1.5 flex-wrap' : 'gap-2'}`}>
              <select id="ff-warrantslisttab-1"
                className={`input-dark ${props.isMobile ? 'flex-1 text-sm py-2' : 'text-xs w-28'}`}
                value={filterStatus}
                onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
                style={props.isMobile ? { minHeight: 44 } : undefined}
              >
                <option value="">All Status</option>
                {WARRANT_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <select id="ff-warrantslisttab-2"
                className={`input-dark ${props.isMobile ? 'flex-1 text-sm py-2' : 'text-xs w-28'}`}
                value={filterType}
                onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
                style={props.isMobile ? { minHeight: 44 } : undefined}
              >
                <option value="">All Types</option>
                {WARRANT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <select id="ff-warrantslisttab-3"
                className={`input-dark ${props.isMobile ? 'flex-1 text-sm py-2' : 'text-xs w-32'}`}
                value={filterSeverity}
                onChange={(e) => { setFilterSeverity(e.target.value); setPage(1); }}
                style={props.isMobile ? { minHeight: 44 } : undefined}
              >
                <option value="">All Severity</option>
                {OFFENSE_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
              {/* Court filter */}
              <input id="ff-warrantslisttab-4"
                type="text"
                className={`input-dark ${props.isMobile ? 'flex-1 text-sm py-2' : 'text-xs w-28'}`}
                placeholder="Court..."
                value={filterCourt}
                onChange={(e) => { setFilterCourt(e.target.value); setPage(1); }}
                style={props.isMobile ? { minHeight: 44 } : undefined}
              />
              {/* Source filter */}
              <select id="ff-warrantslisttab-5"
                className={`input-dark ${props.isMobile ? 'flex-1 text-sm py-2' : 'text-xs w-28'}`}
                value={filterSource}
                onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}
                style={props.isMobile ? { minHeight: 44 } : undefined}
              >
                <option value="">All Sources</option>
                <option value="manual">Local</option>
                <option value="utah_api">Utah API</option>
                <option value="scraper">Scraped</option>
              </select>
            </div>
            {/* Action buttons inline with filter bar */}
            {!showArchived && props.isAdminOrManager && (
              <button type="button" onClick={props.onOpenNewForm} className="toolbar-btn toolbar-btn-primary text-[9px] px-3 py-1.5 font-semibold shrink-0">
                <Plus className="w-3 h-3" /> New Warrant
              </button>
            )}
            <button type="button"
              onClick={() => { setShowArchived(!showArchived); setPage(1); }}
              className={`toolbar-btn text-[9px] px-3 py-1.5 font-semibold shrink-0 ${showArchived ? 'text-amber-400' : ''}`}
              title={showArchived ? 'Show active warrants' : 'Show archived warrants'}
            >
              <Archive className="w-3 h-3" />
              {showArchived ? 'Showing Archived' : 'Archives'}
            </button>
          </div>

          {/* Filter chips bar (Phase 1) */}
          <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-rmpg-700 bg-surface-sunken">
            <FilterChip active={!anyFilterActive} onClick={clearAllFilters}>All</FilterChip>
            <FilterChip active={filterPriority} onClick={() => { setFilterPriority(v => !v); setPage(1); }}>High priority</FilterChip>
            <FilterChip active={filterSinceWeek} onClick={() => { setFilterSinceWeek(v => !v); setPage(1); }}>New this week</FilterChip>
            <FilterChip active={filterMatches} onClick={() => { setFilterMatches(v => !v); setPage(1); }}>Matches our person</FilterChip>
            <select id="ff-warrantslisttab-6"
              value={filterStateChip}
              onChange={(e) => { setFilterStateChip(e.target.value); setPage(1); }}
              className="select-dark text-xs w-32"
              style={{ minHeight: 26 }}
            >
              <option value="">By state</option>
              <option value="UT">UT</option>
              <option value="NV">NV</option>
              <option value="WY">WY</option>
              <option value="CO">CO</option>
              <option value="CA">CA</option>
              <option value="TX">TX</option>
              <option value="AZ">AZ</option>
              <option value="NM">NM</option>
              <option value="ID">ID</option>
            </select>
            <FilterChip active={filterFederal} onClick={() => { setFilterFederal(v => !v); setPage(1); }}>Federal only</FilterChip>
            <FilterChip active={filterArchivedChip} onClick={() => { setFilterArchivedChip(v => !v); setPage(1); }}>Show archived</FilterChip>
            <FilterChip active={filterWatchedOnly} onClick={() => { setFilterWatchedOnly(v => !v); setPage(1); }}>My Watched Warrants</FilterChip>
          </div>

          {/* Person filter indicator */}
          {filterPersonId && (
            <div className="px-3 py-1.5 bg-brand-900/30 border-b border-brand-700/50 text-brand-300 text-xs flex items-center gap-2">
              <User className="w-3 h-3" />
              <span>Filtered by person #{filterPersonId}</span>
              <button type="button" onClick={() => { setFilterPersonId(null); setPage(1); }} className="ml-auto text-brand-400 hover:text-rmpg-100 text-[10px] underline">Clear filter</button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-3 py-2 bg-red-900/30 border-b border-red-700/50 text-red-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-3 h-3" /> {error}
              <IconButton onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300" aria-label="Dismiss error"><X className="w-3 h-3" /></IconButton>
            </div>
          )}

          {/* Batch Actions Bar */}
          {batchSelected.size > 0 && (props.isGodMode || props.isAdminOrManager) && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 bg-brand-900/20 border-b border-brand-700/50">
              <span className="text-[10px] font-bold text-brand-300">{batchSelected.size} selected</span>
              <select id="ff-warrantslisttab-7" value={batchStatus} onChange={e => setBatchStatus(e.target.value)} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-2 py-0.5 outline-none">
                <option value="">Set Status...</option>
                <option value="served">Served</option>
                <option value="recalled">Recalled</option>
                <option value="quashed">Quashed</option>
                <option value="expired">Expired</option>
              </select>
              <button type="button" onClick={handleBatchUpdate} disabled={!batchStatus || batchSubmitting} className="toolbar-btn toolbar-btn-primary text-[10px] px-2 py-0.5 disabled:opacity-40">
                {batchSubmitting ? 'Updating...' : 'Apply'}
              </button>
              <span className="mx-1 text-rmpg-600">|</span>
              <button type="button" onClick={handleBulkPrintPacket} className="toolbar-btn text-[10px] px-2 py-0.5">Print packet PDF</button>
              <button type="button" onClick={handleBulkReview} className="toolbar-btn text-[10px] px-2 py-0.5">Mark reviewed</button>
              <button type="button" onClick={handleBulkArchive} className="toolbar-btn text-[10px] px-2 py-0.5">Archive</button>
              <button type="button" onClick={() => setBatchSelected(new Set())} className="toolbar-btn text-[10px] px-2 py-0.5">Clear</button>
            </div>
          )}

          {/* Table */}
          <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
            {loading ? (
              <div className="flex items-center justify-center h-full text-rmpg-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" role="status" aria-label="Loading" /> Loading warrants...
              </div>
            ) : warrants.length === 0 ? (
              (() => {
                // Differentiate "no data yet" from "filter/search returned
                // nothing" — the operator needs to know whether to broaden
                // the search or to create the first record.
                const hasActiveFilter =
                  !!searchQuery || !!filterStatus || !!filterType ||
                  !!filterSource || !!filterCourt || !!filterSeverity ||
                  !!filterPersonId || filterPriority || filterSinceWeek ||
                  filterMatches || !!filterStateChip || filterFederal ||
                  filterArchivedChip || filterWatchedOnly;
                if (showArchived) {
                  return (
                    <EmptyState
                      icon={Gavel}
                      title="No archived warrants"
                      description={hasActiveFilter ? 'Try clearing filters to see all archived warrants.' : 'Nothing has been archived yet.'}
                    />
                  );
                }
                if (hasActiveFilter) {
                  return (
                    <EmptyState
                      icon={Search}
                      title="No warrants match your filters"
                      description="Try clearing filters or broadening the search."
                    />
                  );
                }
                return (
                  <EmptyState
                    icon={Gavel}
                    title="No warrants on file"
                    description="Create a new warrant to get started."
                    action={props.isAdminOrManager ? { label: 'New Warrant', onClick: props.onOpenNewForm } : undefined}
                  />
                );
              })()
            ) : props.isMobile ? (
              <div>
                {warrants.map((w) => (
                  <button type="button"
                    key={w.id}
                    onClick={() => fetchWarrantDetail(w.id)}
                    onContextMenu={(e) => openMenu(e, buildWarrantMenu(w))}
                    className={`w-full text-left px-3 py-3 border-b border-rmpg-700/50 transition-colors hover:bg-surface-raised ${selectedWarrant?.id === w.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent'}`}
                    style={{ minHeight: 56 }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono font-bold text-rmpg-100">{w.warrant_number || '-'}</span>
                      <div className="flex items-center gap-1">
                        <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded-sm border ${TYPE_COLORS[w.type] || TYPE_COLORS.other}`}>
                          {(w.type || 'WARRANT').toUpperCase()}
                        </span>
                        <StatusPill status={w.status} />
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-rmpg-100 font-semibold">{w.subject_name || '—'}</span>
                      {w.subject_dob && <span className="text-[10px] text-rmpg-500">DOB {formatDate(w.subject_dob)}</span>}
                    </div>
                    <div className="text-xs text-rmpg-400 truncate mt-0.5">{chargesFromJson(w.charge_description)}</div>
                    <div className="text-[10px] text-rmpg-500 mt-0.5">
                      {formatDate(w.created_at)}{w.offense_level ? ` • ${toDisplayLabel(w.offense_level)}` : ''}
                      {w.source ? ` • ${w.source}` : ''}
                    </div>
                    {/* UPGRADE 42: Expiration warning highlight */}
                    {w.expires_at && w.status === 'active' && (() => {
                      const daysLeft = Math.ceil((parseTimestamp(w.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                      if (daysLeft < 0) return <div className="text-[9px] text-red-400 font-bold mt-0.5 flex items-center gap-1"><AlertTriangle size={9} /> EXPIRED {Math.abs(daysLeft)}d ago</div>;
                      if (daysLeft <= 30) return <div className="text-[9px] text-amber-400 font-bold mt-0.5 flex items-center gap-1"><Clock size={9} /> Expires in {daysLeft}d</div>;
                      return null;
                    })()}
                  </button>
                ))}
              </div>
            ) : (
              <table className="table-dark">
                <thead className="sticky top-0 z-10 bg-surface-deep">
                  <tr>
                    {(props.isGodMode || props.isAdminOrManager) && (
                      <th style={{ width: 30 }}>
                        <input id="ff-warrantslisttab-8" type="checkbox" checked={batchSelected.size === batchSelectableWarrants.length && batchSelectableWarrants.length > 0} onChange={toggleSelectAll} className="accent-brand-500" />
                      </th>
                    )}
                    <th style={{ width: 28 }} className="text-center" title="Matches our person">★</th>
                    <th style={{ width: 80 }} className="cursor-pointer select-none" onClick={() => toggleSort('priority')}>
                      Priority {sortKey === 'priority' && (sortOrder === 'desc' ? '↓' : '↑')}
                    </th>
                    <th style={{ width: 60 }} className="cursor-pointer select-none" onClick={() => toggleSort('age')}>
                      Age {sortKey === 'age' && (sortOrder === 'desc' ? '↓' : '↑')}
                    </th>
                    <th style={{ width: 90 }} className="cursor-pointer select-none" onClick={() => toggleSort('freshness')}>
                      Freshness {sortKey === 'freshness' && (sortOrder === 'desc' ? '↓' : '↑')}
                    </th>
                    <th style={{ width: 50 }}>Source</th>
                    <th style={{ width: 80 }}>Status</th>
                    <th style={{ width: 120 }}>Warrant #</th>
                    <th>Subject</th>
                    <th style={{ width: 80 }}>Type</th>
                    <th>Charge</th>
                    <th style={{ width: 80 }}>Severity</th>
                    <th style={{ width: 90 }}>Court</th>
                    <th style={{ width: 80 }}>Bail</th>
                    <th style={{ width: 60 }}>Attempts</th>
                    <th style={{ width: 95 }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {warrants.map((w) => (
                    <tr
                      key={w.id}
                      onClick={() => fetchWarrantDetail(w.id)}
                      onContextMenu={(e) => openMenu(e, buildWarrantMenu(w))}
                      className={`cursor-pointer hover:bg-surface-raised/50 transition-colors ${selectedWarrant?.id === w.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : ''} ${batchSelected.has(w.id) ? 'bg-brand-900/10' : ''}`}
                    >
                      {(props.isGodMode || props.isAdminOrManager) && (
                        <td onClick={e => e.stopPropagation()} className="py-2">
                          <input
                            id="ff-warrantslisttab-9"
                            type="checkbox"
                            checked={batchSelected.has(w.id)}
                            onChange={() => toggleBatchSelect(w.id)}
                            disabled={isExternalWarrantId(w.id)}
                            title={isExternalWarrantId(w.id) ? EXTERNAL_WARRANT_READONLY_MSG : undefined}
                            className="accent-brand-500 disabled:opacity-30"
                          />
                        </td>
                      )}
                      <td className="text-center py-2">
                        {w.matches_person ? <span className="text-amber-400" title="Matches our person">★</span> : null}
                      </td>
                      <td className="py-2">
                        <span title={`Priority score: ${w.priority_score ?? 'N/A'}/100 (${priorityBucket(w.priority_score)})`} className={`inline-block px-1.5 py-0.5 text-[9px] uppercase font-bold border ${priorityChipClass(priorityBucket(w.priority_score))}`}>
                          {priorityBucket(w.priority_score)}
                        </span>
                      </td>
                      <td className="text-xs text-rmpg-300 font-mono py-2">{formatAge(w.age_days)}</td>
                      <td className="text-xs py-2">
                        <span className="mr-1">{freshnessIcon(freshnessClass(w.freshness_days))}</span>
                        <span className="text-rmpg-400 font-mono">{formatAge(w.freshness_days)}</span>
                      </td>
                      {/* Was stateFromSource(w.source) — a client-side re-derivation
                          whose regex was prefix-anchored and matched none of the
                          live source keys ('ada-county-id', 'natrona-county-wy',
                          'ohio-drc-pval'), so this column read '—' on EVERY row.
                          The server now resolves this once, authoritatively, via
                          src/utils/warrantSourceState.ts. Render it; don't re-derive. */}
                      <td className="text-xs font-mono text-rmpg-300 py-2">{w.source_state ?? '—'}</td>
                      <td className="py-2">
                        <StatusPill status={w.status} />
                        {w.expires_at && w.status === 'active' && (() => {
                          const daysLeft = Math.ceil((parseTimestamp(w.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                          if (daysLeft < 0) return <span className="ml-1 text-[8px] bg-red-900/50 text-red-400 border border-red-700/50 px-1 py-0.5 rounded-sm font-bold">EXPIRED</span>;
                          if (daysLeft <= 7) return <span className="ml-1 text-[8px] bg-amber-900/50 text-amber-400 border border-amber-700/50 px-1 py-0.5 rounded-sm font-bold">{daysLeft}d</span>;
                          return null;
                        })()}
                      </td>
                      <td className="font-mono text-xs text-rmpg-100 font-bold py-2">{w.warrant_number || '-'}</td>
                      <td className="text-xs py-2">
                        <div className="flex items-center gap-2">
                          {w.subject_photo_url ? (
                            <img src={w.subject_photo_url} alt="" className="w-6 h-6 rounded-sm object-cover border border-rmpg-600" />
                          ) : null}
                          <button type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (w.subject_person_id) props.onOpenPersonProfile(w.subject_person_id);
                            }}
                            className={`text-rmpg-200 ${w.subject_person_id ? 'hover:text-brand-300 cursor-pointer' : ''}`}
                          >
                            <div className="flex flex-col gap-0.5">
                              <span className="text-rmpg-100 font-semibold">{w.subject_name || '—'}</span>
                              {w.subject_dob && <span className="text-[10px] text-rmpg-500">DOB {formatDate(w.subject_dob)}</span>}
                            </div>
                          </button>
                        </div>
                      </td>
                      <td className="py-2">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded-sm border ${TYPE_COLORS[w.type] || TYPE_COLORS.other}`}>
                          {(() => { const Icon = TYPE_ICONS[w.type] || TYPE_ICONS.other; return <Icon className="w-3 h-3" />; })()}
                          {(w.type || 'WARRANT').toUpperCase()}
                        </span>
                      </td>
                      <td className="text-xs text-rmpg-300 truncate max-w-[200px] py-2">{chargesFromJson(w.charge_description)}</td>
                      <td className="py-2">
                        {w.offense_level ? (
                          <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded-sm border ${SEVERITY_COLORS[w.offense_level] || 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50'}`}>
                            {w.offense_level.toUpperCase()}
                          </span>
                        ) : <span className="text-rmpg-500">-</span>}
                      </td>
                      <td className="text-[10px] text-rmpg-400 truncate py-2">{w.issuing_court || '-'}</td>
                      <td className="text-xs text-rmpg-400 font-mono py-2">{w.bail_amount ? formatCurrency(w.bail_amount) : '-'}</td>
                      <td className="text-center py-2">
                        {w.service_attempt_count > 0 ? (
                          <span className="text-amber-400 font-mono">{w.service_attempt_count}</span>
                        ) : (
                          <span className="text-rmpg-500">&mdash;</span>
                        )}
                      </td>
                      <td className="text-xs text-rmpg-400 py-2">{formatDate(w.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination (thin) */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-2 py-[2px] border-t border-surface-base bg-surface-deep">
              <span className={`${props.isMobile ? 'text-xs' : 'text-[9px]'} text-rmpg-500 font-mono tabular-nums`}>
                {page}/{totalPages} &middot; {totalCount}
              </span>
              <div className="flex gap-1">
                <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="toolbar-btn text-[9px] disabled:opacity-40">Prev</button>
                <button type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="toolbar-btn text-[9px] disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Warrant Detail */}
        {/* Hidden until a row is selected on desktop too — see the width note on
            the list pane above. An empty 45% panel is not worth three hidden
            columns of warrant data. */}
        <div className={`${selectedWarrant ? 'flex-1' : 'hidden'} flex flex-col overflow-hidden`}>
          <div className={`flex ${props.isMobile ? 'flex-wrap gap-1' : 'items-center gap-1'} px-3 py-1 border-b border-rmpg-700 bg-[var(--grid-header-bg)]`}>
            <Gavel className="w-3 h-3 text-brand-400" />
            <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-widest">Warrant Detail</span>
            <span className="flex-1" />
            {props.isMobile && selectedWarrant && (
              <button type="button" onClick={() => setSelectedWarrant(null)} className="toolbar-btn text-[9px]" style={props.isMobile ? { minHeight: 44 } : undefined}>&larr; Back</button>
            )}
            {/* entityId drives an attachment lookup keyed on a local record —
                omit it for external (scraped) rows, which have none. */}
            <PrintRecordButton
              recordType="warrant"
              recordData={selectedWarrant}
              identifier={selectedWarrant?.warrant_number}
              entityType="warrant"
              entityId={isExternalWarrantId(selectedWarrant?.id) ? undefined : selectedWarrant?.id}
              label="Print"
            />
            {selectedWarrant && isExternalWarrantId(selectedWarrant.id) && (
              <span
                className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-amber-500/40 text-amber-400"
                title={EXTERNAL_WARRANT_READONLY_MSG}
              >
                External · read-only
              </span>
            )}
            {selectedWarrant && !selectedWarrant.archived_at && !isExternalWarrantId(selectedWarrant.id) && (
              <>
                {selectedWarrant.status === 'active' && props.canManageWarrants && (
                  <>
                    <button type="button" onClick={() => { setServeLocation(''); setServeModalOpen(true); }} className="toolbar-btn toolbar-btn-primary text-[9px]" style={props.isMobile ? { minHeight: 48 } : undefined}>
                      <CheckCircle className="w-3 h-3" /> Serve
                    </button>
                    <button type="button" onClick={() => props.onOpenEditForm(selectedWarrant)} className="toolbar-btn text-[9px]" style={props.isMobile ? { minHeight: 48 } : undefined}>
                      <Edit className="w-3 h-3" /> Edit
                    </button>
                    <button type="button" onClick={() => handleUpdateStatus(selectedWarrant.id, 'recalled')} className="toolbar-btn text-[9px] text-amber-400" style={props.isMobile ? { minHeight: 48 } : undefined}>
                      <XCircle className="w-3 h-3" /> Recall
                    </button>
                  </>
                )}
                {selectedWarrant.status !== 'active' && (
                  <>
                    {props.isAdminSupervisorOrManager && (
                      <button type="button" onClick={() => handleReopenWarrant(selectedWarrant.id)} className="toolbar-btn text-[9px] text-green-400" title="Reopen this warrant" style={props.isMobile ? { minHeight: 48 } : undefined}>
                        <RotateCcw className="w-3 h-3" /> Reopen
                      </button>
                    )}
                    {props.isAdminOrManager && (
                      <>
                        <button type="button" onClick={() => { setArchiveTargetId(selectedWarrant.id); setArchiveConfirmOpen(true); }} className="toolbar-btn text-[9px]" title="Archive this warrant" style={props.isMobile ? { minHeight: 48 } : undefined}>
                          <Archive className="w-3 h-3" /> Archive
                        </button>
                        <button type="button" onClick={() => setDeletingWarrant(selectedWarrant)} className="toolbar-btn text-[9px] text-red-400" title="Permanently delete" style={props.isMobile ? { minHeight: 48 } : undefined}>
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      </>
                    )}
                  </>
                )}
              </>
            )}
            {selectedWarrant?.archived_at && props.isAdminOrManager && !isExternalWarrantId(selectedWarrant.id) && (
              <button type="button" onClick={() => handleUnarchive(selectedWarrant.id)} className="toolbar-btn text-[9px] text-amber-400" style={props.isMobile ? { minHeight: 48 } : undefined}>
                <RotateCcw className="w-3 h-3" /> Unarchive
              </button>
            )}
          </div>

          {selectedWarrant ? (
            <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent p-4 space-y-4">
              {/* Header */}
              <div className="panel-beveled p-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h2 className="text-lg font-bold text-rmpg-100 font-mono">{selectedWarrant.warrant_number}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold rounded-sm border ${TYPE_COLORS[selectedWarrant.type] || TYPE_COLORS.other}`}>
                        {(selectedWarrant.type || 'WARRANT').toUpperCase()} WARRANT
                      </span>
                      <StatusPill status={selectedWarrant.status} size="md" />
                      {selectedWarrant.offense_level && (
                        <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold rounded-sm border ${SEVERITY_COLORS[selectedWarrant.offense_level] || 'bg-rmpg-700/40 text-rmpg-200 border-rmpg-600/50'}`}>
                          {selectedWarrant.offense_level.toUpperCase()}
                        </span>
                      )}
                      {selectedWarrant.archived_at && (
                        <span className="inline-flex px-2 py-0.5 text-[10px] font-bold rounded-sm border bg-amber-900/40 text-amber-300 border-amber-700/50">
                          ARCHIVED
                        </span>
                      )}
                    </div>
                  </div>
                  {selectedWarrant.bail_amount != null && selectedWarrant.bail_amount > 0 && (
                    <div className="text-right">
                      <span className="text-[9px] text-rmpg-500 uppercase">Bail</span>
                      <div className="text-sm font-bold text-green-400 font-mono">{formatCurrency(selectedWarrant.bail_amount)}</div>
                    </div>
                  )}
                </div>

                {/* Statute + Charge */}
                {(selectedWarrant as any).statute_citation && (
                  <div className="mb-2">
                    <span className="text-[10px] text-[var(--brand-gold)] uppercase font-bold tracking-wider">Statute</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand-900/30 text-brand-300 border border-brand-700/40 text-xs font-mono font-bold">
                        <Scale className="w-3 h-3" />
                        {(selectedWarrant as any).statute_citation}
                      </span>
                    </div>
                  </div>
                )}
                <div className="mb-3">
                  <span className="text-[10px] text-[var(--brand-gold)] uppercase font-bold tracking-wider">Charge Description</span>
                  <p className="text-sm text-rmpg-100 mt-0.5">{chargesFromJson(selectedWarrant.charge_description)}</p>
                  <LegalDataHunterValidateButton
                    charge={chargesFromJson(selectedWarrant.charge_description)}
                    state={selectedWarrant.source_state ?? undefined}
                    warrantId={isExternalWarrantId(selectedWarrant.id) ? undefined : selectedWarrant.id}
                  />
                </div>

                {/* Dates row (compact) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
                  <div>
                    <span className="text-rmpg-500 text-[9px]">Entered</span>
                    <div className="text-rmpg-300">{formatDateTime(selectedWarrant.created_at)}</div>
                    <div className="text-rmpg-500 text-[9px]">{selectedWarrant.entered_by_name || 'Unknown'}</div>
                  </div>
                  {selectedWarrant.expires_at && (
                    <div>
                      <span className="text-rmpg-500 text-[9px]">Expires</span>
                      <div className="text-amber-400">{formatDate(selectedWarrant.expires_at)}</div>
                    </div>
                  )}
                  {selectedWarrant.served_at && (
                    <div>
                      <span className="text-rmpg-500 text-[9px]">Served</span>
                      <div className="text-green-400">{formatDateTime(selectedWarrant.served_at)}</div>
                      {selectedWarrant.served_by_name && <div className="text-rmpg-500 text-[9px]">{selectedWarrant.served_by_name}</div>}
                      {selectedWarrant.served_location && (
                        <div className="text-rmpg-500 text-[9px] flex items-center gap-1 mt-0.5">
                          <MapPin className="w-2.5 h-2.5" /> {selectedWarrant.served_location}
                          <ViewOnMapLink address={selectedWarrant.served_location} label={selectedWarrant.subject_name || undefined} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Subject Info */}
              {selectedWarrant.subject_name && (
                <div className="panel-beveled p-4">
                  <h3 className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-widest flex items-center gap-2 mb-3">
                    <User className="w-4 h-4 text-[var(--brand-gold)]" /> Subject Information
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1.5 text-[11px]">
                    <div>
                      <span className="text-rmpg-400">Name</span>
                      <div className="text-rmpg-100 font-bold">{selectedWarrant.subject_name}</div>
                    </div>
                    {selectedWarrant.subject_dob && (
                      <div>
                        <span className="text-rmpg-500 text-[9px]">DOB</span>
                        <div className="text-rmpg-300">{formatDate(selectedWarrant.subject_dob)}</div>
                      </div>
                    )}
                    {selectedWarrant.subject_gender && (
                      <div>
                        <span className="text-rmpg-500 text-[9px]">Gender</span>
                        <div className="text-rmpg-300">{selectedWarrant.subject_gender}</div>
                      </div>
                    )}
                    {selectedWarrant.subject_race && (
                      <div>
                        <span className="text-rmpg-500 text-[9px]">Race</span>
                        <div className="text-rmpg-300">{selectedWarrant.subject_race}</div>
                      </div>
                    )}
                    {selectedWarrant.subject_height && (
                      <div>
                        <span className="text-rmpg-500 text-[9px]">Height</span>
                        <div className="text-rmpg-300">{selectedWarrant.subject_height}</div>
                      </div>
                    )}
                    {selectedWarrant.subject_weight && (
                      <div>
                        <span className="text-rmpg-500 text-[9px]">Weight</span>
                        <div className="text-rmpg-300">{selectedWarrant.subject_weight}</div>
                      </div>
                    )}
                    {selectedWarrant.subject_hair_color && (
                      <div>
                        <span className="text-rmpg-500 text-[9px]">Hair</span>
                        <div className="text-rmpg-300">{selectedWarrant.subject_hair_color}</div>
                      </div>
                    )}
                    {selectedWarrant.subject_eye_color && (
                      <div>
                        <span className="text-rmpg-500 text-[9px]">Eyes</span>
                        <div className="text-rmpg-300">{selectedWarrant.subject_eye_color}</div>
                      </div>
                    )}
                    {selectedWarrant.subject_address && (
                      <div className="col-span-2">
                        <span className="text-rmpg-500 text-[9px]">Address</span>
                        <div className="text-rmpg-300 flex items-center gap-1.5">
                          {selectedWarrant.subject_address}
                          <ViewOnMapLink address={selectedWarrant.subject_address} label={selectedWarrant.subject_name || undefined} />
                        </div>
                        <div className="mt-1">
                          <JurisdictionLookup address={selectedWarrant.subject_address} />
                        </div>
                      </div>
                    )}
                  </div>
                  {selectedWarrant.subject_person_id && (
                    <div className="flex gap-2 flex-wrap mt-3">
                      <button type="button" onClick={() => props.navigate(`/records?tab=persons&personId=${selectedWarrant.subject_person_id}`)}
                        className="toolbar-btn text-[9px]"><User className="w-3 h-3" /> View Record</button>
                      <button type="button" onClick={() => props.navigate(`/dispatch?personId=${selectedWarrant.subject_person_id}`)}
                        className="toolbar-btn text-[9px]"><Activity className="w-3 h-3" /> View Calls</button>
                      <button type="button" onClick={() => props.navigate(`/records?tab=arrests&personId=${selectedWarrant.subject_person_id}`)}
                        className="toolbar-btn text-[9px]"><Shield className="w-3 h-3" /> View Arrests</button>
                    </div>
                  )}
                </div>
              )}

              {/* Screening Status — unified cross-source (Interpol, OFAC,
                  Utah SOR, NSOPW, UDC, etc.) status for the warrant subject.
                  Auto-screened when the warrant's subject_person_id is set
                  or changed (src/routes/warrants.ts); "Screen Now" re-runs
                  on demand. Supersedes the NSOPW-only panel on this surface. */}
              {selectedWarrant.subject_person_id && (
                <WarrantScreeningStatus
                  personId={selectedWarrant.subject_person_id}
                  subjectSurname={selectedWarrant.subject_last_name ?? undefined}
                />
              )}

              {/* Court Info */}
              {(selectedWarrant.issuing_court || selectedWarrant.issuing_judge) && (
                <div className="panel-beveled p-4">
                  <h3 className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-widest flex items-center gap-2 mb-3">
                    <Gavel className="w-4 h-4 text-[var(--brand-gold)]" /> Court Information
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    {selectedWarrant.issuing_court && (
                      <div>
                        <span className="text-rmpg-500 text-[9px]">Issuing Court</span>
                        <div className="text-rmpg-300">{selectedWarrant.issuing_court}</div>
                      </div>
                    )}
                    {selectedWarrant.issuing_judge && (
                      <div>
                        <span className="text-rmpg-500 text-[9px]">Issuing Judge</span>
                        <div className="text-rmpg-200">{selectedWarrant.issuing_judge}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Notes */}
              {selectedWarrant.notes && (
                <div className="panel-beveled p-4">
                  <h3 className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-widest mb-2">Notes</h3>
                  <p className="text-xs text-rmpg-200 whitespace-pre-wrap">{selectedWarrant.notes}</p>
                </div>
              )}

              {/* Activity Log */}
              {selectedWarrant.activity && selectedWarrant.activity.length > 0 && (
                <div className="panel-beveled p-4">
                  <h3 className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-widest flex items-center gap-2 mb-3">
                    <Clock className="w-4 h-4 text-[var(--brand-gold)]" /> Activity Log
                  </h3>
                  <div className="space-y-1">
                    {selectedWarrant.activity.map((a) => (
                      <div key={a.id} className="flex items-start gap-1.5 text-[10px]">
                        <span className="text-rmpg-600 whitespace-nowrap font-mono tabular-nums">{formatDateTime(a.created_at)}</span>
                        <span className="text-rmpg-400">{a.details}</span>
                        <span className="text-rmpg-600 ml-auto whitespace-nowrap">{a.user_name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Phase 1: Source / Provenance */}
              {(selectedWarrant as any).source_scraper_name && (
                <CollapsibleSection title="Source / Provenance" defaultOpen={false}>
                  <div className="text-xs space-y-1 p-2">
                    <div>Scraper: <span className="text-rmpg-200">{(selectedWarrant as any).source_scraper_name}</span></div>
                    <div>State: <span className="text-rmpg-200">{selectedWarrant.source_state ?? '—'}</span></div>
                    {(selectedWarrant as any).source_url && (
                      <div>URL: <a href={(selectedWarrant as any).source_url} target="_blank" rel="noreferrer" className="text-amber-400 underline">link</a></div>
                    )}
                    <div>Last refreshed: {(selectedWarrant as any).last_scraped_at ? formatDateTime((selectedWarrant as any).last_scraped_at) : '—'}</div>
                  </div>
                </CollapsibleSection>
              )}

              {/* Phase 1: RMPG Encounters */}
              {Array.isArray((selectedWarrant as any).rmpg_encounters) && (selectedWarrant as any).rmpg_encounters.length > 0 && (
                <CollapsibleSection
                  title="RMPG Encounters"
                  count={(selectedWarrant as any).rmpg_encounters.length}
                  defaultOpen={false}
                >
                  <div className="p-2">
                    {(selectedWarrant as any).rmpg_encounters.slice(0, 20).map((e: any, i: number) => (
                      <div key={i} className="text-xs py-1 border-b border-rmpg-700">
                        <span className="text-rmpg-400">{e.date ? formatDate(e.date) : '—'}</span>
                        <span className="text-rmpg-200 ml-2">{e.context}</span>
                        {e.property && <span className="text-rmpg-500 ml-2">— {e.property}</span>}
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              )}

              {/* Phase 1: Known Associates & Vehicles */}
              {((Array.isArray((selectedWarrant as any).known_associates) && (selectedWarrant as any).known_associates.length > 0) ||
                (Array.isArray((selectedWarrant as any).known_vehicles) && (selectedWarrant as any).known_vehicles.length > 0)) && (
                <CollapsibleSection title="Known Associates & Vehicles" defaultOpen={false}>
                  <div className="p-2 space-y-1">
                    {(selectedWarrant as any).known_associates?.map((a: any, i: number) => (
                      <div key={`a${i}`} className="text-xs text-rmpg-200">{a.name} <span className="text-rmpg-500">({a.relationship || '—'})</span></div>
                    ))}
                    {(selectedWarrant as any).known_vehicles?.map((v: any, i: number) => (
                      <div key={`v${i}`} className="text-xs text-rmpg-200 font-mono">{v.plate} <span className="text-rmpg-500">{v.description}</span></div>
                    ))}
                  </div>
                </CollapsibleSection>
              )}

              {/* Linked Emails (autolinker + manual) */}
              {/* Both key off a local warrant id — external (scraped) rows have
                  no local record, so querying them only produces 400s. */}
              {!isExternalWarrantId(selectedWarrant.id) && (
                <>
                  <LinkedEmailsSection entityType="warrant" entityId={selectedWarrant.id} />
                  <EmailedDocuments recordType="warrant" recordId={selectedWarrant.id} />
                </>
              )}

              {/* Phase 1: Print PDF action */}
              <button
                type="button"
                onClick={() => handlePrintWarrantPdf(selectedWarrant.id)}
                className="toolbar-btn toolbar-btn-primary w-full mt-3 flex items-center justify-center gap-2"
              >
                <Printer className="w-3 h-3" /> Print PDF
              </button>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-rmpg-400">
              <div className="text-center">
                <img src="/rmpg flex.png" alt="RMPG" className="w-20 h-20 mx-auto mb-4 opacity-15" draggable={false} />
                <Gavel className="w-8 h-8 mx-auto mb-2 text-rmpg-500" />
                <p className="text-sm">Select a warrant to view details</p>
                <p className="text-xs text-rmpg-500 mt-1">or create a new warrant</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SERVE MODAL */}
      {serveModalOpen && selectedWarrant && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby={serveTitleId}>
          <div className={`panel-beveled ${props.isMobile ? 'w-full mx-4' : 'w-[400px]'} bg-surface-base`}>
            <div className="flex items-center justify-between p-4 border-b border-rmpg-600">
              <h2 id={serveTitleId} className="text-sm font-bold text-rmpg-100">Serve Warrant</h2>
              <IconButton onClick={() => setServeModalOpen(false)} className="text-rmpg-400 hover:text-rmpg-100" aria-label="Close serve modal"><X className="w-4 h-4" /></IconButton>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-xs text-rmpg-300">
                Mark warrant <span className="font-bold text-rmpg-100 font-mono">{selectedWarrant.warrant_number}</span> as served?
              </p>
              <div>
                <label htmlFor="ff-warrantslisttab-10" className="field-label">Location Served (optional)</label>
                <input id="ff-warrantslisttab-10"
                  type="text"
                  className="input-dark text-xs w-full min-h-[36px]"
                  value={serveLocation}
                  onChange={(e) => setServeLocation(e.target.value)}
                  placeholder="e.g. 123 Main St, Salt Lake City"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setServeModalOpen(false)} className="toolbar-btn text-xs">Cancel</button>
                <button type="button" onClick={handleServe} disabled={serving} className="toolbar-btn toolbar-btn-primary text-xs">
                  {serving ? <Loader2 className="w-3 h-3 animate-spin mr-1" role="status" aria-label="Loading" /> : <CheckCircle className="w-3 h-3 mr-1" />}
                  Confirm Served
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE FAB */}
      {props.isMobile && !selectedWarrant && !showArchived && !props.formOpen && props.isAdminOrManager && (
        <IconButton onClick={props.onOpenNewForm} className="mobile-fab" aria-label="New Warrant">
          <Plus className="w-6 h-6" />
        </IconButton>
      )}

      {/* DELETE CONFIRM */}
      <ConfirmDialog
        isOpen={deletingWarrant !== null}
        onClose={() => setDeletingWarrant(null)}
        onConfirm={handleDelete}
        title="Delete Warrant"
        message={`Are you sure you want to permanently delete warrant "${deletingWarrant?.warrant_number}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteLoading}
      />

      {/* BULK STATUS-UPDATE CONFIRM (replaces native confirm) */}
      <ConfirmDialog
        isOpen={bulkUpdateConfirmOpen}
        onClose={() => setBulkUpdateConfirmOpen(false)}
        onConfirm={performBatchUpdate}
        title="Update Warrant Status"
        message={`Update ${batchSelected.size} warrant${batchSelected.size === 1 ? '' : 's'} to "${batchStatus}"?`}
        confirmLabel="Update"
        isLoading={batchSubmitting}
      />

      {/* BULK ARCHIVE CONFIRM (replaces native confirm) */}
      <ConfirmDialog
        isOpen={bulkArchiveConfirmOpen}
        onClose={() => setBulkArchiveConfirmOpen(false)}
        onConfirm={performBulkArchive}
        title="Archive Warrants"
        message={`Archive ${batchSelected.size} warrant${batchSelected.size === 1 ? '' : 's'}? Archived warrants can be restored later.`}
        confirmLabel="Archive"
      />

      {/* SINGLE ARCHIVE CONFIRM (detail panel toolbar) */}
      <ConfirmDialog
        isOpen={archiveConfirmOpen}
        onClose={() => { setArchiveConfirmOpen(false); setArchiveTargetId(null); }}
        onConfirm={performArchive}
        title="Archive Warrant"
        message="Archive this warrant? It can be restored later."
        confirmLabel="Archive"
      />

      {/* BULK PRINT-PACKET CONFIRM (replaces native confirm; >50 warrants) */}
      <ConfirmDialog
        isOpen={bulkPrintConfirmOpen}
        onClose={() => setBulkPrintConfirmOpen(false)}
        onConfirm={performBulkPrintPacket}
        title="Print Warrant Packet"
        message={`Print ${batchSelected.size} warrants as a single packet? This may take 30+ seconds.`}
        confirmLabel="Print Packet"
      />
    </div>
  );
});

export default WarrantsListTab;
