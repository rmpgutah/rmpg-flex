import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import {
  ScrollText,
  Search,
  Filter,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Loader2,
  Clock,
  X,
  Plus,
  Edit,
  Trash2,
  LogIn,
  LogOut,
  Eye,
  FileText,
  ShieldCheck,
  ShieldOff,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import ExportButton from '../components/ExportButton';
import { localToday, parseTimestamp } from '../utils/dateUtils';
import { useToast } from '../components/ToastProvider';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { getAuditEntityRoute } from '../utils/auditEntityRoute';
import { openAuditLogPdf, type AuditLogEntryForPdf } from '../utils/auditLogPdf';
import { toDisplayLabel } from '../utils/formatters';
import { auditLogsToCsv, downloadTextFile } from '../utils/rmsListExport';

// Roles that may access the audit log. AdminRoute at the router level already
// gates to admin+manager, but we add a belt-and-suspenders in-page gate so
// any future route restructuring doesn't silently expose raw audit data.
const AUDIT_ROLES = new Set(['admin', 'manager']);

interface AuditLogEntry {
  id: number;
  user_id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  ip_address: string;
  created_at: string;
  user_name: string;
  badge_number: string;
  user_role: string;
}

interface AuditStats {
  totalEntries: number;
  entriesToday: number;
  topActions: Array<{ action: string; count: string }>;
  topUsers: Array<{ user_name: string; badge_number: string; count: string }>;
}

interface Filters {
  action: string;
  entityType: string;
  userId: string;
  startDate: string;
  endDate: string;
  search: string;
}

// Enhancement 44: Action type icons
const getActionIcon = (action: string): React.ElementType => {
  if (!action) return ScrollText;
  const a = action.toLowerCase();
  if (a.includes('created') || a.includes('create')) return Plus;
  if (a.includes('updated') || a.includes('update') || a.includes('status_change')) return Edit;
  if (a.includes('deleted') || a.includes('delete') || a.includes('cancelled')) return Trash2;
  if (a.includes('login') || a.includes('clock_in')) return LogIn;
  if (a.includes('logout') || a.includes('clock_out')) return LogOut;
  if (a.includes('view') || a.includes('export') || a.includes('download')) return Eye;
  return ScrollText;
};

const AuditLogPage: React.FC = () => {
  const { addToast } = useToast();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Role gate — belt-and-suspenders alongside AdminRoute in App.tsx.
  const canView = AUDIT_ROLES.has(user?.role ?? '');

  // Set document title
  useEffect(() => { document.title = 'Audit Log — RMPG Flex'; }, []);

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(100);

  // Ref for the search/details input — focused by the N shortcut.
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── URL deep-link contract ───────────────────────────────────────────
  // Accepted params on mount (all optional, all stripped after consumption):
  //   ?entry_id=<n>     Highlight + scroll a specific audit row (toast if absent
  //                     from the current page of results — pagination-aware).
  //   ?action=<str>     Pre-fill the Action filter.
  //   ?entityType=<str> Pre-fill the Entity Type filter (legacy: entity_type).
  //   ?entityId=<str>   With entityType, narrows by id (legacy: entity_id).
  //                     Server doesn't accept entity_id directly — emulated via
  //                     `search` so the row containing this id surfaces.
  //   ?user_id=<n>      Pre-fill the User filter (legacy: userId).
  //   ?date_from=<d>    Pre-fill the Start Date filter (legacy: startDate).
  //   ?date_to=<d>      Pre-fill the End Date filter (legacy: endDate).
  //   ?search=<str>     Pre-fill the search box.
  // Mirroring back into the URL is intentional only for entry_id — the
  // other filters can be heavy (full-table scans on prod D1) and we don't
  // want a stale browser-history entry to silently re-trigger them.
  const initialFilters = useMemo<Filters>(() => {
    const action = searchParams.get('action') || '';
    const entityType = searchParams.get('entityType') || searchParams.get('entity_type') || '';
    const userId = searchParams.get('user_id') || searchParams.get('userId') || '';
    const startDate = searchParams.get('date_from') || searchParams.get('startDate') || '';
    const endDate = searchParams.get('date_to') || searchParams.get('endDate') || '';
    const search = searchParams.get('search') || searchParams.get('q') || '';
    return { action, entityType, userId, startDate, endDate, search };
    // Only consumed on first render; intentionally not reactive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filters, setFilters] = useState<Filters>(initialFilters);

  // Pending entry to highlight (consumed once the matching row is in `logs`).
  const pendingEntryIdRef = useRef<string | null>(searchParams.get('entry_id'));
  const [highlightedEntryId, setHighlightedEntryId] = useState<number | null>(null);
  const entryRowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  // Compliance report + index stats
  const [complianceReport, setComplianceReport] = useState<any>(null);
  const [indexStats, setIndexStats] = useState<{ total_entries: number; estimated_size_mb: number } | null>(null);

  // Memoized filter dropdown values — derived from logs, recalculated only when logs change
  const uniqueActions = useMemo(() => {
    const actions = new Set<string>();
    logs.forEach((log) => {
      if (log.action) actions.add(log.action);
    });
    return Array.from(actions).sort();
  }, [logs]);

  const uniqueEntityTypes = useMemo(() => {
    const entityTypes = new Set<string>();
    logs.forEach((log) => {
      if (log.entity_type) entityTypes.add(log.entity_type);
    });
    return Array.from(entityTypes).sort();
  }, [logs]);

  const uniqueUsers = useMemo(() => {
    const usersMap = new Map<number, { name: string; badge: string }>();
    logs.forEach((log) => {
      if (log.user_id && log.user_name) {
        usersMap.set(log.user_id, { name: log.user_name, badge: log.badge_number });
      }
    });
    return Array.from(usersMap.entries())
      .map(([id, user]) => ({ id, name: user.name, badge: user.badge }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [logs]);

  // Fetch logs
  const fetchLogs = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString()
      });

      if (filters.action) queryParams.append('action', filters.action);
      if (filters.entityType) queryParams.append('entityType', filters.entityType);
      if (filters.userId) queryParams.append('userId', filters.userId);
      if (filters.startDate) queryParams.append('startDate', filters.startDate);
      if (filters.endDate) queryParams.append('endDate', filters.endDate);
      if (filters.search) queryParams.append('search', filters.search);

      const data = await apiFetch<{ data: AuditLogEntry[]; pagination: { total: number; totalPages: number } }>(`/audit/logs?${queryParams.toString()}`);

      setLogs(data?.data || []);
      setTotalPages(data?.pagination?.totalPages || 1);
      setTotal(data?.pagination?.total || 0);
    } catch (err) {
      console.error('Error fetching audit logs:', err);
      setError('Failed to load audit logs. Please try again.');
      addToast('Failed to load audit logs', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, limit, filters]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch<AuditStats>('/audit/stats');
      setStats(data);
    } catch (err) {
      console.error('Error fetching audit stats:', err);
      setError('Failed to load audit statistics.');
      addToast('Failed to load audit statistics', 'error');
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchLogs();
    fetchStats();
    apiFetch<any>('/audit/compliance-report?days=30').then(d => { if (d) setComplianceReport(d); }).catch(() => {});
    apiFetch<any>('/audit/index-stats').then(d => { if (d) setIndexStats({ total_entries: d.total_entries, estimated_size_mb: d.estimated_size_mb }); }).catch(() => {});
  }, [fetchLogs, fetchStats]);

  // Strip the deep-link params from the URL after the initial render. We keep
  // them for the first paint so initialFilters resolves; once the component is
  // mounted with state, the params are cosmetic noise (and would re-apply on
  // refresh, masking later operator edits). entry_id is stripped after the
  // highlight effect below.
  useEffect(() => {
    const consume = ['action', 'entityType', 'entity_type', 'user_id', 'userId',
                     'date_from', 'startDate', 'date_to', 'endDate', 'search', 'q'];
    let dirty = false;
    const next = new URLSearchParams(searchParams);
    for (const key of consume) {
      if (next.has(key)) { next.delete(key); dirty = true; }
    }
    if (dirty) setSearchParams(next, { replace: true });
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Highlight + scroll-to a deep-linked entry once it appears in the loaded
  // page of results. If it's not on the current page (server-side row miss),
  // surface a toast so the operator knows to widen filters / pagination
  // instead of staring at a screen they think is broken.
  useEffect(() => {
    const want = pendingEntryIdRef.current;
    if (!want || loading) return;
    const wantNum = parseInt(want, 10);
    if (!Number.isFinite(wantNum)) {
      pendingEntryIdRef.current = null;
      return;
    }
    const hit = logs.find((l) => l.id === wantNum);
    if (hit) {
      setHighlightedEntryId(wantNum);
      // Wait for the row to mount, then scroll it into view.
      requestAnimationFrame(() => {
        const el = entryRowRefs.current.get(wantNum);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      pendingEntryIdRef.current = null;
      const next = new URLSearchParams(searchParams);
      next.delete('entry_id');
      setSearchParams(next, { replace: true });
    } else if (logs.length > 0) {
      addToast(`Audit entry #${want} is not in the current view`, 'warning');
      pendingEntryIdRef.current = null;
      const next = new URLSearchParams(searchParams);
      next.delete('entry_id');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, loading]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLogs(true);
      fetchStats();
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchLogs, fetchStats]);

  // Reset to page 1 when filters change — skip the mount-time firing (the
  // Initial load effect above already fetches once; without this guard
  // page===1 on mount made this effect fetch a second time immediately).
  const filtersEffectMountedRef = useRef(false);
  useEffect(() => {
    if (!filtersEffectMountedRef.current) { filtersEffectMountedRef.current = true; return; }
    if (page !== 1) {
      setPage(1);
    } else {
      fetchLogs();
    }
  }, [filters]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  // N — focus the "Search Details" input to let the operator quickly narrow
  //     by detail text without reaching for the mouse.
  // Esc cascade — error banner → row highlight → active filters.
  //   The audit log is read-only; no modals exist. We intentionally do NOT
  //   reset the page number on Esc — that's a Reset semantic, not Cancel.
  const hasActiveFilters = useMemo(() => Object.values(filters).some(val => val !== ''), [filters]);

  // Stable ref so the keyboard handler doesn't recreate on every render.
  const hasActiveFiltersRef = useRef(hasActiveFilters);
  hasActiveFiltersRef.current = hasActiveFilters;
  const errorRef = useRef(error);
  errorRef.current = error;
  const highlightedRef = useRef(highlightedEntryId);
  highlightedRef.current = highlightedEntryId;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inTyping = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

      // N: focus the search details input (ignore when already typing).
      if ((e.key === 'n' || e.key === 'N' || e.key === '/') && !inTyping && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (e.key !== 'Escape') return;
      // Esc while a typing surface is focused → browser blurs it; we stop here.
      if (inTyping) return;
      e.stopPropagation();
      if (errorRef.current) { setError(null); return; }
      if (highlightedRef.current != null) { setHighlightedEntryId(null); return; }
      if (hasActiveFiltersRef.current) { clearFilters(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // Stable refs mean this effect runs only on mount/unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Get action color — stable callback, no dependencies
  const getActionColor = useCallback((action: string): string => {
    if (!action) return 'text-rmpg-300';
    const actionLower = action.toLowerCase();

    // Green: creates, login success, clock in
    if (actionLower.includes('_created') || actionLower === 'login_success' || actionLower === 'clock_in') {
      return 'text-green-400';
    }

    // Blue: updates, status changes, dispatch
    if (actionLower.includes('_updated') || actionLower === 'status_change' || actionLower === 'unit_dispatched') {
      return 'text-brand-400';
    }

    // Red: deletes, cancellations
    if (actionLower.includes('_deleted') || actionLower.includes('_cancelled') || actionLower === 'bolo_cancelled') {
      return 'text-red-400';
    }

    // Amber: submitted, approved, returned, login failed
    if (actionLower.includes('_submitted') || actionLower.includes('_approved') ||
        actionLower.includes('_returned') || actionLower === 'login_failed') {
      return 'text-amber-400';
    }

    // Gray: everything else
    return 'text-rmpg-300';
  }, []);

  // Format timestamp
  const formatTimestamp = (timestamp: string): string => {
    const date = parseTimestamp(timestamp);
    return date.toLocaleString('en-US', {
      timeZone: 'America/Denver',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  // ── Right-click context menu (read-only log rows) ──
  const buildLogMenu = (log: AuditLogEntry): ContextMenuItem[] => {
    const entry = [
      formatTimestamp(log.created_at),
      log.user_name || 'System',
      log.action,
      [log.entity_type, log.entity_id].filter(Boolean).join(' '),
      log.details,
    ].filter(Boolean).join(' | ');
    const route = getAuditEntityRoute(log.entity_type, log.entity_id);
    // Self-deep-link — lets a supervisor copy a URL to this exact entry for
    // an IA / discovery package without having to reproduce the filter state.
    const selfLink = `${window.location.origin}/audit?entry_id=${log.id}`;
    return [
      ...(route ? [m.go(route.label, route.path, <ExternalLink size={12} />), m.separator()] : []),
      m.copy('Copy entry', entry),
      ...(log.details ? [m.copy('Copy details', log.details)] : []),
      ...(log.entity_id ? [m.copy('Copy entity ID', log.entity_id)] : []),
      m.copy('Copy deep-link to entry', selfLink),
      m.separator(),
      m.copyId(log.id),
    ];
  };

  // Click-through: when the audit row is for a routable entity, jump to that
  // record on left-click. The right-click menu still offers Copy actions
  // even on non-routable rows (system events, retention purges).
  const openEntitySource = (log: AuditLogEntry) => {
    const route = getAuditEntityRoute(log.entity_type, log.entity_id);
    if (route) navigate(route.path);
  };

  // Clear all filters
  const clearFilters = () => {
    setFilters({
      action: '',
      entityType: '',
      userId: '',
      startDate: '',
      endDate: '',
      search: ''
    });
    setPage(1);
  };

  // Export to CSV — operational fields only (no details, IP, or user names).
  const exportToCSV = () => {
    downloadTextFile(`audit-log-${localToday()}.csv`, auditLogsToCsv(logs.map((log) => ({
      action: log.action,
      entity_type: log.entity_type,
      entity_id: String(log.entity_id ?? ''),
      created_at: log.created_at,
      badge_number: log.badge_number,
    }))));
  };

  // ── Court-ready PDF export ──
  // CSVs are good for spreadsheet review; PDFs are good for evidence.
  // The audit log is THE highest-evidentiary surface in the app: it proves
  // chain of custody and is regularly subpoena'd. Without a signable PDF
  // path the supervisor was reduced to screenshotting filter pages, which
  // loses pagination, total counts, and the filter snapshot. The util
  // also adds the tamper-evidence statement that makes the document
  // defensible in court.
  const exportToPdf = useCallback(() => {
    try {
      const entries: AuditLogEntryForPdf[] = logs.map((l) => ({
        id: l.id,
        user_id: l.user_id,
        user_name: l.user_name,
        badge_number: l.badge_number,
        user_role: l.user_role,
        action: l.action,
        entity_type: l.entity_type,
        entity_id: l.entity_id,
        details: l.details,
        ip_address: l.ip_address,
        created_at: l.created_at,
      }));
      openAuditLogPdf({
        entries,
        filters: {
          action: filters.action,
          entityType: filters.entityType,
          userId: filters.userId,
          startDate: filters.startDate,
          endDate: filters.endDate,
          search: filters.search,
        },
        totalMatching: total,
        exportedBy: user?.full_name || user?.email || undefined,
      });
    } catch (err) {
      addToast('Failed to generate audit log PDF', 'error');
    }
  }, [logs, filters, total, user, addToast]);

  // Handle filter changes
  const handleFilterChange = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  // ── Role gate — in-page restricted state ────────────────────────────
  if (!canView) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-3 text-center">
        <ShieldOff className="w-10 h-10 text-rmpg-600" />
        <p className="text-sm font-semibold text-rmpg-300">Access Restricted</p>
        <p className="text-xs text-rmpg-500">
          The Audit Log is restricted to administrators and managers. Contact your admin if you need access.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-surface-base min-h-screen text-rmpg-100">
      {/* Portal Header */}
      <div className="panel-beveled bg-surface-base overflow-hidden mb-6">
        <div className="flex items-center gap-4 px-4 py-2.5 relative">
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, var(--border-subtle), var(--rmpg-400) 30%, var(--rmpg-400) 70%, var(--border-subtle))' }} />
          <RmpgLogo height={64} />
          <div className="flex-1">
            <h1 className="text-sm font-bold tracking-wider uppercase" style={{ color: 'var(--text-secondary)' }}>Audit Log</h1>
            <p className="text-[9px] tracking-wide" style={{ color: 'var(--text-muted)' }}>Rocky Mountain Protective Group, LLC</p>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="mb-6">
        <PanelTitleBar title="AUDIT TRAIL" icon={ScrollText}>
          <button type="button"
            onClick={() => {
              fetchLogs(true);
              fetchStats();
            }}
            disabled={refreshing}
            className="toolbar-btn"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <ExportButton exportUrl="/audit/export?format=csv" exportFilename="audit_log_export.csv" />
          <PrintButton />
          <button type="button"
            onClick={exportToCSV}
            disabled={logs.length === 0}
            className="toolbar-btn toolbar-btn-primary print:hidden"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button type="button"
            onClick={exportToPdf}
            disabled={logs.length === 0}
            className="toolbar-btn toolbar-btn-primary print:hidden"
            title="Court-ready chain-of-custody PDF (Arial, signature block, tamper-evidence statement)"
          >
            <FileText className="w-3.5 h-3.5" />
            Court PDF
          </button>
        </PanelTitleBar>

        {/* Tamper-evidence pill — operational truth, not legal advice. The
            audit_log table is append-only at the application layer (no
            UPDATE / DELETE API; admin-only retention purges generate
            their own audit entries). Surfacing this on the page itself
            helps a supervisor reassure court counsel during a live
            discovery walk-through. */}
        <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 text-[10px] text-amber-300"
             style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border-subtle)' }}>
          <ShieldCheck className="w-3 h-3" />
          <span className="font-semibold uppercase tracking-wider">Append-only</span>
          <span className="text-rmpg-400">·</span>
          <span className="text-rmpg-400">No UPDATE/DELETE API on audit_log; retention purges are admin-only and themselves audited.</span>
        </div>

        {/* Stats Row */}
        {stats && (
          <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
            <div className="panel-beveled p-3" style={{ background: 'var(--surface-overlay)' }}>
              <div className="flex items-center gap-2 mb-2">
                <ScrollText className="w-4 h-4 text-brand-400" />
                <span className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">Total Entries</span>
              </div>
              <div className="text-2xl font-bold text-brand-400 font-mono">{stats.totalEntries.toLocaleString()}</div>
            </div>
            <div className="panel-beveled p-3" style={{ background: 'var(--surface-overlay)', borderLeft: stats.entriesToday > 0 ? '2px solid var(--sev-ok)' : undefined }}>
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-green-400" />
                <span className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">Today</span>
              </div>
              <div className="text-2xl font-bold text-green-400 font-mono">{stats.entriesToday.toLocaleString()}</div>
            </div>
            <div className="panel-beveled p-3" style={{ background: 'var(--surface-overlay)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">Top Action (30d)</span>
              </div>
              <div className="text-sm font-bold truncate font-mono text-amber-400">
                {stats.topActions[0]?.action || 'N/A'}
              </div>
              <div className="text-[10px] text-rmpg-500 mt-0.5">
                {stats.topActions[0]?.count ? `${stats.topActions[0].count} occurrences` : ''}
              </div>
              {stats.topActions.length > 1 && (
                <div className="mt-1.5 pt-1.5 border-t border-rmpg-700/50 space-y-0.5">
                  {stats.topActions.slice(1, 4).map((a) => (
                    <div key={a.action} className="flex items-center justify-between text-[9px]">
                      <span className="text-rmpg-400 truncate">{toDisplayLabel(a.action)}</span>
                      <span className="text-rmpg-500 font-mono ml-2">{a.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="panel-beveled p-3" style={{ background: 'var(--surface-overlay)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Filter className="w-4 h-4 text-rmpg-400" />
                <span className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">Top User (30d)</span>
              </div>
              <div className="text-sm font-bold truncate font-mono text-rmpg-400">
                {stats.topUsers[0]?.user_name || 'N/A'}
              </div>
              <div className="text-[10px] text-rmpg-500 mt-0.5">
                {stats.topUsers[0]?.count ? `${stats.topUsers[0].count} actions` : ''}
                {stats.topUsers[0]?.badge_number ? ` · Badge #${stats.topUsers[0].badge_number}` : ''}
              </div>
              {stats.topUsers.length > 1 && (
                <div className="mt-1.5 pt-1.5 border-t border-rmpg-700/50 space-y-0.5">
                  {stats.topUsers.slice(1, 4).map((u) => (
                    <div key={u.user_name} className="flex items-center justify-between text-[9px]">
                      <span className="text-rmpg-400 truncate">{u.user_name}</span>
                      <span className="text-rmpg-500 font-mono ml-2">{u.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Compliance + Index Stats Row */}
          {(complianceReport || indexStats) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
              {complianceReport && (
                <>
                  <div className="panel-beveled p-3" style={{ background: 'var(--surface-overlay)' }}>
                    <div className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1">Login Failure Rate</div>
                    <div className={`text-xl font-bold font-mono ${complianceReport.login_stats?.failure_rate > 20 ? 'text-red-400' : 'text-green-400'}`}>
                      {complianceReport.login_stats?.failure_rate ?? 0}%
                    </div>
                    <div className="text-[9px] text-rmpg-500 mt-0.5">
                      {complianceReport.login_stats?.failed ?? 0} failed / {(complianceReport.login_stats?.successful ?? 0) + (complianceReport.login_stats?.failed ?? 0)} total
                    </div>
                  </div>
                  <div className="panel-beveled p-3" style={{ background: 'var(--surface-overlay)' }}>
                    <div className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1">Active Users (30d)</div>
                    <div className="text-xl font-bold font-mono text-purple-400">
                      {complianceReport.active_users ?? 0}
                    </div>
                  </div>
                </>
              )}
              {indexStats && (
                <>
                  <div className="panel-beveled p-3" style={{ background: 'var(--surface-overlay)' }}>
                    <div className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1">Total Log Entries</div>
                    <div className="text-xl font-bold font-mono text-rmpg-200">
                      {indexStats.total_entries.toLocaleString()}
                    </div>
                  </div>
                  <div className="panel-beveled p-3" style={{ background: 'var(--surface-overlay)' }}>
                    <div className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-1">Est. Log Size</div>
                    <div className="text-xl font-bold font-mono text-rmpg-200">
                      {indexStats.estimated_size_mb} MB
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Compliance gaps — surfaced so the supervisor can see which calendar
              days fell below the 1-entry/day daily-coverage threshold and
              investigate accordingly. */}
          {complianceReport && Array.isArray(complianceReport.gaps) && complianceReport.gaps.length > 0 && (
            <div className="panel-beveled p-3 mt-3" style={{ background: 'var(--surface-overlay)', borderLeft: '2px solid var(--sev-warn)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[10px] text-amber-300 uppercase font-bold tracking-wider">Coverage Gaps (30d)</span>
                <span className="ml-auto text-[10px] text-rmpg-400 font-mono">
                  {complianceReport.gaps.length} of {complianceReport.report_period_days ?? 30} days
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {complianceReport.gaps.slice(0, 30).map((g: { date: string; actual: number }) => (
                  <span key={g.date}
                        className="text-[9px] font-mono px-1.5 py-0.5 border border-amber-700/40 text-amber-200"
                        title={`${g.actual} entries (below daily minimum)`}>
                    {g.date}
                  </span>
                ))}
                {complianceReport.gaps.length > 30 && (
                  <span className="text-[9px] text-rmpg-400">+{complianceReport.gaps.length - 30} more</span>
                )}
              </div>
            </div>
          )}
          </>
        )}
      </div>

      {/* Filter Bar */}
      <div className="panel-beveled p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-rmpg-300" />
          <span className="text-sm font-semibold">Filters</span>
          {hasActiveFilters && (
            <button type="button"
              onClick={clearFilters}
              className="ml-auto px-3 py-1 bg-rmpg-700 hover:bg-rmpg-600 text-xs flex items-center gap-1 border border-rmpg-600 transition-colors">
              <X className="w-3 h-3" />
              Clear All
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Action Filter */}
          <div>
            <label htmlFor="ff-auditlogpage-0" className="block text-xs text-rmpg-300 mb-1">Action:</label>
            <select id="ff-auditlogpage-0"
              value={filters.action}
              onChange={(e) => handleFilterChange('action', e.target.value)}
              className="select-dark text-xs"
            >
              <option value="">All Actions</option>
              {uniqueActions.map(action => (
                <option key={action} value={action}>{toDisplayLabel(action).toUpperCase()}</option>
              ))}
            </select>
          </div>

          {/* Entity Type Filter */}
          <div>
            <label htmlFor="ff-auditlogpage-1" className="block text-xs text-rmpg-300 mb-1">Entity Type:</label>
            <select id="ff-auditlogpage-1"
              value={filters.entityType}
              onChange={(e) => handleFilterChange('entityType', e.target.value)}
              className="select-dark text-xs"
            >
              <option value="">All Types</option>
              {uniqueEntityTypes.map(type => (
                <option key={type} value={type}>{toDisplayLabel(type).toUpperCase()}</option>
              ))}
            </select>
          </div>

          {/* User Filter */}
          <div>
            <label htmlFor="ff-auditlogpage-2" className="block text-xs text-rmpg-300 mb-1">User:</label>
            <select id="ff-auditlogpage-2"
              value={filters.userId}
              onChange={(e) => handleFilterChange('userId', e.target.value)}
              className="select-dark text-xs"
            >
              <option value="">All Users</option>
              {uniqueUsers.map(user => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.badge})
                </option>
              ))}
            </select>
          </div>

          {/* Start Date */}
          <div>
            <label htmlFor="ff-auditlogpage-3" className="block text-xs text-rmpg-300 mb-1">Start Date:</label>
            <div className="relative">
              <input id="ff-auditlogpage-3"
                type="date"
                value={filters.startDate}
                onChange={(e) => handleFilterChange('startDate', e.target.value)}
                className="input-dark text-xs min-h-[36px]"
              />
              <Calendar className="absolute right-2 top-2.5 w-4 h-4 text-rmpg-400 pointer-events-none" />
            </div>
          </div>

          {/* End Date */}
          <div>
            <label htmlFor="ff-auditlogpage-4" className="block text-xs text-rmpg-300 mb-1">End Date:</label>
            <div className="relative">
              <input id="ff-auditlogpage-4"
                type="date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange('endDate', e.target.value)}
                className="input-dark text-xs min-h-[36px]"
              />
              <Calendar className="absolute right-2 top-2.5 w-4 h-4 text-rmpg-400 pointer-events-none" />
            </div>
          </div>

          {/* Search — focused by the N shortcut */}
          <div>
            <label htmlFor="ff-auditlogpage-5" className="block text-xs text-rmpg-300 mb-1">Search Details:</label>
            <div className="relative">
              <input id="ff-auditlogpage-5"
                ref={searchInputRef}
                type="text"
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                placeholder="Search details… (/)" aria-label="Search audit log details"
                autoComplete="off"
                className="input-dark text-xs pl-8 min-h-[36px]"
              />
              <Search className="absolute left-2 top-2.5 w-4 h-4 text-rmpg-400 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-0 mb-3 px-3 py-2 bg-red-900/40 border border-red-700/50 text-red-300 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button type="button" className="toolbar-btn" onClick={() => { void fetchLogs(); void fetchStats(); }}>Retry</button>
          <button aria-label="Close" type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Results Summary */}
      <div className="mb-3 text-xs text-rmpg-300">
        Showing {logs.length > 0 ? ((page - 1) * limit + 1) : 0} - {Math.min(page * limit, total)} of {total.toLocaleString()} entries
      </div>

      {/* Table */}
      <div className="panel-beveled overflow-hidden bg-surface-base">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-brand-400" role="status" aria-label="Loading" />
            <span className="text-[10px] text-rmpg-500">Loading audit entries…</span>
          </div>
        ) : logs.length === 0 ? (
          // Empty-state distinction: the audit log is virtually never empty —
          // every login / dispatch action writes a row — so the bottom branch
          // is the "your active filters returned nothing" case.
          <div className="flex flex-col items-center justify-center py-20 text-rmpg-400 gap-1">
            <ScrollText className="w-10 h-10 mb-2 text-rmpg-600" />
            {hasActiveFilters ? (
              <>
                <p className="text-xs font-semibold">No entries match the active filters</p>
                <p className="text-[10px] text-rmpg-500">Try widening the date range, clearing a filter, or searching a different term.</p>
                <button type="button"
                  onClick={clearFilters}
                  className="mt-3 px-3 py-1.5 bg-rmpg-700 hover:bg-rmpg-600 text-[11px] flex items-center gap-1 border border-rmpg-600 transition-colors">
                  <X className="w-3 h-3" />
                  Clear all filters
                </button>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold">Audit log is empty</p>
                <p className="text-[10px] text-rmpg-500">No actions have been recorded yet on this database.</p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dark">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Badge</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                  <th>IP Address</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const route = getAuditEntityRoute(log.entity_type, log.entity_id);
                  const isHighlighted = highlightedEntryId === log.id;
                  return (
                  <tr
                    key={log.id}
                    ref={(el) => {
                      if (el) entryRowRefs.current.set(log.id, el);
                      else entryRowRefs.current.delete(log.id);
                    }}
                    // Highlight the deep-linked row with a brand-gold left rail
                    // until the operator clicks elsewhere or hits Esc.
                    className={`hover:bg-surface-raised ${isHighlighted ? 'bg-surface-raised' : ''} ${route ? 'cursor-pointer' : ''}`}
                    style={isHighlighted ? { boxShadow: 'inset 3px 0 0 var(--brand-400)' } : undefined}
                    onContextMenu={(e) => openMenu(e, buildLogMenu(log))}
                    // Left-click navigates to the source record when routable.
                    // Modifier keys still let supervisors open in a new tab via
                    // the right-click menu's "Open …" item.
                    onClick={(e) => {
                      if (e.defaultPrevented) return;
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      if (route) openEntitySource(log);
                    }}
                    title={route ? `Click to ${route.label.toLowerCase()}` : undefined}
                  >
                    <td className="px-3 py-1.5 whitespace-nowrap font-mono">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-rmpg-400" />
                        {formatTimestamp(log.created_at)}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {log.user_name || <span className="text-rmpg-400 italic">System</span>}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap font-mono">
                      {log.badge_number || <span className="text-rmpg-400">-</span>}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className={`font-semibold inline-flex items-center gap-1 ${getActionColor(log.action)}`}>
                        {(() => { const Icon = getActionIcon(log.action); return <Icon className="w-3 h-3" />; })()}
                        {log.action}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <div>
                          <div className="text-rmpg-200">{toDisplayLabel(log.entity_type)}</div>
                          <div className="text-rmpg-400 font-mono">{log.entity_id}</div>
                        </div>
                        {route && <ExternalLink className="w-3 h-3 text-brand-400 opacity-60" aria-hidden />}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 max-w-md">
                      <div className="truncate" title={log.details}>
                        {log.details}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-rmpg-300 font-mono">
                      {log.ip_address || <span className="text-rmpg-500">-</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-rmpg-300">
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-2 bg-rmpg-700 hover:bg-rmpg-600 text-xs flex items-center gap-1 border border-rmpg-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }

                return (
                  <button type="button"
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`px-3 py-2 text-xs border ${
                      page === pageNum
                        ? 'bg-brand-600 border-brand-500 text-rmpg-100'
                        : 'bg-rmpg-700 hover:bg-rmpg-600 border-rmpg-600'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-2 bg-rmpg-700 hover:bg-rmpg-600 text-xs flex items-center gap-1 border border-rmpg-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLogPage;
