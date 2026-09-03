import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  BarChart3,
  Calendar,
  Download,
  Loader2,
  TrendingUp,
  Database,
  MapPin,
  FileText,
  AlertTriangle,
  Check,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  Legend,
  AreaChart,
  Area,
  LabelList,
} from 'recharts';
import { apiFetch } from '../hooks/useApi';
import { useIsMobile } from '../hooks/useIsMobile';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { localToday, dateToLocalYMD, parseTimestamp } from '../utils/dateUtils';
import { generatePatrolTrackingPdf } from '../utils/patrolTrackingPdfGenerator';
import { formatIncidentType } from '../utils/caseNumbers';
import { toDisplayLabel } from '../utils/formatters';
import { chartSeriesColors, chartPriorityColor } from '../utils/chartPalette';
import { downloadTextFile, reportCatalogToCsv } from '../utils/rmsListExport';

// ============================================================
// Types
// ============================================================

interface DashboardData {
  activeCalls: number;
  todayCalls: number;
  unitsOnDuty: number;
  totalUnits: number;
  pendingReports: number;
  activeBolos: number;
  avgResponseMinutes: number;
  callsByPriority: Array<{ priority: string; count: number }>;
  callsByStatus: Array<{ status: string; count: number }>;
  recentActivity: any[];
  officersOnDuty: any[];
  callsByHour: any[];
}

interface IncidentsSummaryData {
  days?: number;
  total: number;
  // The handler returns by_type (NOT a `data`/`group_key` array). Typing it
  // correctly lets the chart and CSV export read the real shape without an
  // `as any` cast — and fixes the CSV crash where `.data.forEach` ran on
  // undefined.
  by_type: Array<{ type: string; count: number }>;
  by_status?: Array<{ status: string; count: number }>;
  by_day?: Array<{ date: string; count: number }>;
}

interface ResponseTimesData {
  overall: {
    avgDispatchMinutes: number;
    avgTotalResponseMinutes: number;
    minResponseMinutes: number;
    maxResponseMinutes: number;
    totalCalls: number;
    /** Calls meeting the SLA, counted PER CALL in SQL — not derived from daily averages. */
    slaMetCount: number;
    /** Server's SLA target, so the tile and the chart's target line cannot drift from it. */
    slaTargetMinutes: number;
  };
  byPriority: Array<{ priority: string; avg_response_minutes: number; count: number }>;
  dailyTrend: Array<{ date: string; avg_response_minutes: number; count: number }>;
}

interface OfficerActivityData {
  officer_id: number;
  full_name: string;
  badge_number: string;
  incidents_written: number;
  calls_responded: number;
  total_hours: number;
}

// ============================================================
// Constants
// ============================================================

// Built at render time (not module scope) — the cursor fill is derived from
// the theme-resolved gold series color, which is only correct once the theme
// class has been stamped on <html>.
function chartTooltipStyle() {
  return {
    contentStyle: {
      backgroundColor: 'var(--surface-deep)',
      border: '1px solid var(--border-default)',
      borderRadius: '2px',
      color: 'var(--text-primary)',
      fontSize: '11px',
      fontFamily: 'Arial, sans-serif',
      boxShadow: '0 4px 12px rgb(0 0 0 / 0.4)',
    },
    cursor: { fill: `color-mix(in srgb, ${chartSeriesColors()[2]} 12%, transparent)` },
  };
}

// ============================================================
// Helper Functions
// ============================================================

function getDateRange(range: string): { startDate: string; endDate?: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (range) {
    case 'today':
      return { startDate: dateToLocalYMD(today) };

    case 'last_7_days': {
      const date = new Date(today);
      date.setDate(date.getDate() - 7);
      return { startDate: dateToLocalYMD(date) };
    }

    case 'last_14_days': {
      const date = new Date(today);
      date.setDate(date.getDate() - 14);
      return { startDate: dateToLocalYMD(date) };
    }

    case 'last_30_days': {
      const date = new Date(today);
      date.setDate(date.getDate() - 30);
      return { startDate: dateToLocalYMD(date) };
    }

    case 'this_month': {
      const date = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: dateToLocalYMD(date) };
    }

    case 'last_month': {
      const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const endDate = new Date(today.getFullYear(), today.getMonth(), 0);
      return {
        startDate: dateToLocalYMD(startDate),
        endDate: dateToLocalYMD(endDate),
      };
    }

    case 'this_quarter': {
      const quarter = Math.floor(today.getMonth() / 3);
      const date = new Date(today.getFullYear(), quarter * 3, 1);
      return { startDate: dateToLocalYMD(date) };
    }

    default:
      return { startDate: dateToLocalYMD(today) };
  }
}

function formatGroupKey(key: string): string {
  // Use formatIncidentType first (it knows official labels), fall back to toDisplayLabel
  const typed = formatIncidentType(key);
  return typed !== key ? typed : toDisplayLabel(key);
}

function formatDateLabel(dateStr: string): string {
  const date = parseTimestamp(dateStr);
  return date.toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric' });
}

function exportToCSV(
  incidentsData: IncidentsSummaryData | null,
  officerActivity: OfficerActivityData[],
  stats: {
    totalCalls: number;
    incidentsFiled: number;
    avgResponse: string;
    slaMet: string;
    activeOfficers: number;
  }
) {
  const sections: string[] = [];
  // Quote every field and double internal quotes. Without this, an officer
  // name in "Last, First" format (common) injected a stray comma and shifted
  // every subsequent column in the export.
  const cell = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (...cells: unknown[]): string => cells.map(cell).join(',');

  // Summary section
  sections.push('SUMMARY STATISTICS');
  sections.push(row('Metric', 'Value'));
  sections.push(row('Total Calls', stats.totalCalls));
  sections.push(row('Incidents Filed', stats.incidentsFiled));
  sections.push(row('Avg Response Time', stats.avgResponse));
  sections.push(row('SLA Met', stats.slaMet));
  sections.push(row('Active Officers', stats.activeOfficers));
  sections.push('');

  // Incidents by type — iterate the handler's real `by_type` shape (the old
  // code read `.data`/`group_key`, which don't exist → empty/crash on export).
  if (incidentsData?.by_type?.length) {
    sections.push('INCIDENTS BY TYPE');
    sections.push(row('Type', 'Count'));
    incidentsData.by_type.forEach(item => {
      sections.push(row(formatGroupKey(item.type), item.count));
    });
    sections.push('');
  }

  // Officer activity
  if (officerActivity.length > 0) {
    sections.push('OFFICER ACTIVITY');
    sections.push(row('Officer Name', 'Badge Number', 'Calls Responded', 'Incidents Written', 'Total Hours'));
    officerActivity.forEach(officer => {
      sections.push(row(
        officer.full_name, officer.badge_number, officer.calls_responded,
        officer.incidents_written, (Number(officer.total_hours) || 0).toFixed(1),
      ));
    });
  }

  const csv = sections.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `rmpg-reports-${localToday()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ============================================================
// Main Component
// ============================================================

// ═══════════════════════════════════════════════════════════
// Feature 27: Report Approval Queue Component
// ═══════════════════════════════════════════════════════════
function ReportApprovalQueue({ canDelete }: { canDelete: boolean }) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  // Inline return-reason modal — replaces the native window.prompt() that
  // previously gated the supervisor return-for-revision action. The native
  // dialog had no a11y, no keyboard polish, and gave the supervisor no
  // visible context for WHICH report they were rejecting until they hit
  // Cancel and re-read the row. Same pattern as Court Tracker #1607 and
  // Cases #1604 (last big native-dialog cluster in the audit).
  const [returnTarget, setReturnTarget] = useState<any | null>(null);
  const [returnReason, setReturnReason] = useState('');
  // ConfirmDialog state for delete report — gated to admin/manager via
  // the canDelete prop so officers and supervisors can't accidentally
  // destroy a report from the queue. Replaces a potential window.confirm.
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  const fetchQueue = useCallback(async () => {
    try {
      const data = await apiFetch<any[]>('/records/reports/approval-queue');
      setReports(Array.isArray(data) ? data : []);
    } catch { setReports([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const handleApprove = async (id: string) => {
    setProcessing(id);
    try {
      await apiFetch(`/records/reports/${id}/approve`, { method: 'POST' });
      setReports(prev => prev.filter(r => String(r.id) !== id));
    } catch { /* ignore */ }
    finally { setProcessing(null); }
  };

  const openReturnDialog = (r: any) => {
    setReturnTarget(r);
    setReturnReason('');
  };

  const submitReturn = async () => {
    const target = returnTarget;
    const reason = returnReason.trim();
    if (!target || !reason) return;
    const id = String(target.id);
    setProcessing(id);
    try {
      await apiFetch(`/records/reports/${id}/return`, { method: 'POST', body: JSON.stringify({ reason }) });
      setReports(prev => prev.filter(r => String(r.id) !== id));
    } catch { /* ignore */ }
    finally {
      setProcessing(null);
      setReturnTarget(null);
      setReturnReason('');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = String(deleteTarget.id);
    setProcessing(id);
    try {
      await apiFetch(`/records/reports/${id}`, { method: 'DELETE' });
      setReports(prev => prev.filter(r => String(r.id) !== id));
    } catch { /* ignore */ }
    finally {
      setProcessing(null);
      setDeleteTarget(null);
    }
  };

  // Esc cascade: delete confirm → return-reason modal. Implemented inside a
  // single capture-phase effect so it fires before the parent page's Esc
  // handler, giving the inner layer a chance to consume it first.
  useEffect(() => {
    if (!deleteTarget && !returnTarget) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (deleteTarget) { setDeleteTarget(null); return; }
      if (returnTarget) { setReturnTarget(null); setReturnReason(''); }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [deleteTarget, returnTarget]);

  const buildReportMenu = (r: any): ContextMenuItem[] => [
    m.action('Approve', () => handleApprove(String(r.id)), { icon: <Check size={12} />, disabled: processing === String(r.id) }),
    m.action('Return for revision', () => openReturnDialog(r), { icon: <RotateCcw size={12} />, danger: true, disabled: processing === String(r.id) }),
    ...(canDelete ? [
      m.separator(),
      m.action('Delete report', () => setDeleteTarget(r), { icon: <Trash2 size={12} />, danger: true, disabled: processing === String(r.id) }),
    ] : []),
    m.separator(),
    m.copy('Copy incident #', r.incident_number),
    m.copyId(r.id),
  ];

  if (loading) return (
    <div className="flex items-center gap-2 text-[10px] text-rmpg-500">
      <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading approval queue" />
      Loading queue...
    </div>
  );
  if (reports.length === 0) return (
    <div className="flex flex-col items-center justify-center py-6 text-rmpg-500">
      <FileText className="w-6 h-6 text-rmpg-600 mb-2" />
      <span className="text-[10px]">No reports pending review</span>
    </div>
  );

  return (
    <div className="space-y-2">
      {reports.map((r: any) => (
        <div key={r.id} className="panel-beveled p-3 flex items-center gap-3" onContextMenu={(e) => openMenu(e, buildReportMenu(r))}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-green-400 font-mono">{r.incident_number}</span>
              <span className="text-[10px] text-rmpg-300">{formatIncidentType(r.incident_type)}</span>
              <span className="px-1 py-0 text-[8px] font-bold bg-purple-900/40 text-purple-400 border border-purple-700/50">PENDING REVIEW</span>
            </div>
            <div className="text-[9px] text-rmpg-400 mt-0.5">
              {r.officer_name && <span>{r.officer_name}</span>}
              {r.badge_number && <span className="ml-1">#{r.badge_number}</span>}
              <span className="ml-2">{r.created_at ? parseTimestamp(r.created_at).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : ''}</span>
            </div>
            {r.narrative && <div className="text-[9px] text-rmpg-500 mt-0.5 truncate max-w-[300px]">{r.narrative.slice(0, 100)}</div>}
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button type="button"
              onClick={() => handleApprove(String(r.id))}
              disabled={processing === String(r.id)}
              className="toolbar-btn text-[9px] bg-green-900/30 text-green-400 border-green-700/30 hover:bg-green-800/40"
            >
              Approve
            </button>
            <button type="button"
              onClick={() => openReturnDialog(r)}
              disabled={processing === String(r.id)}
              className="toolbar-btn text-[9px] bg-red-900/30 text-red-400 border-red-700/30 hover:bg-red-800/40"
            >
              Return
            </button>
            {canDelete && (
              <button type="button"
                onClick={() => setDeleteTarget(r)}
                disabled={processing === String(r.id)}
                className="toolbar-btn text-[9px] bg-red-900/20 text-red-500 border-red-800/30 hover:bg-red-900/40"
                aria-label="Delete report"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      ))}

      {/* ConfirmDialog for report deletion — gated to admin/manager via canDelete. */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete Report"
        message="Permanently delete this report from the approval queue? This action cannot be undone."
        details={deleteTarget && (
          <>
            <div><span className="text-rmpg-400">Incident:</span> <span className="font-mono">{deleteTarget.incident_number || '—'}</span></div>
            {deleteTarget.incident_type && <div><span className="text-rmpg-400">Type:</span> {formatIncidentType(deleteTarget.incident_type)}</div>}
            {deleteTarget.officer_name && <div><span className="text-rmpg-400">Author:</span> {deleteTarget.officer_name}</div>}
          </>
        )}
        confirmLabel="Delete Report"
        confirmVariant="danger"
        isLoading={processing === String(deleteTarget?.id)}
      />

      {/* Inline return-reason modal — replaces the native window.prompt(). */}
      {returnTarget && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="return-modal-title"
          onClick={() => { setReturnTarget(null); setReturnReason(''); }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="presentation" />
          <div
            className="relative w-full max-w-md mx-4 bg-surface-base border border-rmpg-600 shadow-md animate-scale-in my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-4 py-2 border-b border-rmpg-600"
              style={{ background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)' }}
            >
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-red-400" />
                <h2 id="return-modal-title" className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">Return Report for Revision</h2>
              </div>
              <button
                type="button"
                onClick={() => { setReturnTarget(null); setReturnReason(''); }}
                className="p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-rmpg-100 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-rmpg-200 leading-relaxed">
                Tell the author what needs to change. The supervisor note attaches to the report and shows in their queue on next login.
              </p>
              <div className="pl-3 border-l-2 border-rmpg-600 text-[10px] text-rmpg-300 space-y-0.5">
                <div><span className="text-rmpg-400">Incident:</span> <span className="font-mono">{returnTarget.incident_number || '—'}</span></div>
                {returnTarget.incident_type && <div><span className="text-rmpg-400">Type:</span> {formatIncidentType(returnTarget.incident_type)}</div>}
                {returnTarget.officer_name && <div><span className="text-rmpg-400">Author:</span> {returnTarget.officer_name}{returnTarget.badge_number ? ` #${returnTarget.badge_number}` : ''}</div>}
              </div>
              <label className="block text-[10px] uppercase tracking-wider text-rmpg-400 font-bold">
                Return reason
                <textarea
                  autoFocus
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  rows={4}
                  placeholder="e.g. Add witness statements, clarify timeline of events…"
                  className="mt-1 w-full input-dark text-xs px-2 py-1.5 font-sans normal-case"
                />
              </label>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setReturnTarget(null); setReturnReason(''); }}
                  className="toolbar-btn text-xs"
                  disabled={processing === String(returnTarget.id)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitReturn}
                  disabled={!returnReason.trim() || processing === String(returnTarget.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide border shadow-sm transition-colors bg-red-700 hover:bg-red-600 border-red-500 text-rmpg-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processing === String(returnTarget.id) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Return for revision
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Feature 11: Daily Briefing Generator Component
// ═══════════════════════════════════════════════════════════════
function DailyBriefingCard() {
  const [briefing, setBriefing] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const loadBriefing = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<any>('/reports/daily-briefing');
      setBriefing(data);
      setExpanded(true);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  return (
    <div className="bg-surface-base panel-beveled">
      <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-green-400" />
          <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Daily Shift Briefing</h3>
        </div>
        <button type="button" onClick={loadBriefing} disabled={loading} className="toolbar-btn text-[9px]">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : 'Generate'}
        </button>
      </div>
      {expanded && briefing && (
        <div className="p-4 space-y-3 text-xs">
          <div>
            <div className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-1.5">Previous Day Stats</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="panel-beveled bg-surface-sunken p-2 text-center">
                <div className="text-lg font-bold font-mono text-brand-400">{briefing.prevDayStats?.total_calls || 0}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">Calls</div>
              </div>
              <div className="panel-beveled bg-surface-sunken p-2 text-center">
                <div className="text-lg font-bold font-mono text-red-400">{briefing.prevDayStats?.p1_calls || 0}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">P1 Calls</div>
              </div>
              <div className="panel-beveled bg-surface-sunken p-2 text-center">
                <div className="text-lg font-bold font-mono text-amber-400">{briefing.prevDayStats?.p2_calls || 0}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">P2 Calls</div>
              </div>
              <div className="panel-beveled bg-surface-sunken p-2 text-center">
                <div className="text-lg font-bold font-mono text-rmpg-400">{briefing.prevDayStats?.avg_response || 'N/A'}m</div>
                <div className="text-[8px] text-rmpg-500 uppercase">Avg Response</div>
              </div>
            </div>
          </div>
          {briefing.activeBolos?.length > 0 && (
            <div>
              <div className="text-[9px] text-red-400 uppercase font-bold tracking-wider mb-1">Active BOLOs ({briefing.activeBolos.length})</div>
              {briefing.activeBolos.slice(0, 5).map((b: any) => (
                <div key={b.id} className="text-[10px] text-rmpg-300 py-0.5">
                  <span className="text-red-400 font-mono mr-1">{b.bolo_number}</span> {b.title}
                </div>
              ))}
            </div>
          )}
          {briefing.activeWarrants?.length > 0 && (
            <div>
              <div className="text-[9px] text-amber-400 uppercase font-bold tracking-wider mb-1">Active Warrants ({briefing.activeWarrants.length})</div>
              {briefing.activeWarrants.slice(0, 5).map((w: any) => (
                <div key={w.id} className="text-[10px] text-rmpg-300 py-0.5">
                  <span className="text-amber-400 font-mono mr-1">{w.warrant_number}</span> {w.charge_description}
                </div>
              ))}
            </div>
          )}
          {briefing.trendingIncidents?.length > 0 && (
            <div>
              <div className="text-[9px] text-brand-400 uppercase font-bold tracking-wider mb-1">Trending (7-day)</div>
              {briefing.trendingIncidents.map((t: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-[10px] text-rmpg-300 py-0.5">
                  <span>{formatIncidentType(t.incident_type)}</span>
                  <span className="font-mono font-bold">{t.count}</span>
                </div>
              ))}
            </div>
          )}
          {briefing.personnelOnDuty?.length > 0 && (
            <div>
              <div className="text-[9px] text-green-400 uppercase font-bold tracking-wider mb-1">Personnel On Duty ({briefing.personnelOnDuty.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {briefing.personnelOnDuty.map((p: any, i: number) => (
                  <span key={i} className="px-1.5 py-0.5 bg-green-900/20 border border-green-700/30 text-[9px] text-green-400 font-mono">{p.call_sign} ({p.full_name})</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Feature 12: Weekly Activity Digest Component
// ═══════════════════════════════════════════════════════════════
function WeeklyDigestCard() {
  const [digest, setDigest] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const loadDigest = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<any>('/reports/weekly-digest');
      setDigest(data);
      setExpanded(true);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  return (
    <div className="bg-surface-base panel-beveled">
      <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-purple-400" />
          <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Weekly Activity Digest</h3>
        </div>
        <button type="button" onClick={loadDigest} disabled={loading} className="toolbar-btn text-[9px]">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : 'Generate'}
        </button>
      </div>
      {expanded && digest && (
        <div className="p-4 space-y-3 text-xs">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {[
              { label: 'Calls', value: digest.summary?.totalCalls || 0, color: 'var(--text-muted)' },
              { label: 'Incidents', value: digest.summary?.totalIncidents || 0, color: 'var(--stat-accent-green)' },
              { label: 'Citations', value: digest.summary?.totalCitations || 0, color: 'var(--stat-accent-amber)' },
              { label: 'Arrests', value: digest.summary?.totalArrests || 0, color: 'var(--stat-accent-red-bright)' },
              { label: 'Avg Response', value: digest.summary?.avgResponseMinutes ? `${digest.summary.avgResponseMinutes}m` : 'N/A', color: 'var(--text-muted)' },
            ].map(s => (
              <div key={s.label} className="panel-beveled bg-surface-sunken p-2 text-center">
                <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">{s.label}</div>
              </div>
            ))}
          </div>
          {digest.byDay?.length > 0 && (
            <div>
              <div className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-1.5">Daily Breakdown</div>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={digest.byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} tickFormatter={(d: string) => parseTimestamp(d).toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'short' })} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} allowDecimals={false} />
                  <Tooltip {...chartTooltipStyle()} />
                  <Bar dataKey="count" fill="var(--text-muted)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {digest.topIncidentTypes?.length > 0 && (
            <div>
              <div className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-1">Top Incident Types</div>
              {digest.topIncidentTypes.slice(0, 5).map((t: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-[10px] text-rmpg-300 py-0.5">
                  <span>{formatIncidentType(t.incident_type)}</span>
                  <span className="font-mono font-bold">{t.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Features 3, 7, 8, 9, 10: Specialized Report Cards
// ═══════════════════════════════════════════════════════════════
function CrimeTrendCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await apiFetch<any>('/reports/crime-trends')); } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="bg-surface-base panel-beveled p-4 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-brand-400" role="status" aria-label="Loading" /> <span className="text-xs text-rmpg-400">Loading crime trends...</span></div>;
  if (!data) return null;

  return (
    <div className="bg-surface-base panel-beveled">
      <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5 text-red-400" />
        <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Crime Trend Analysis</h3>
      </div>
      <div className="p-4 space-y-3">
        {data.monthlyTrend?.length > 0 && (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={data.monthlyTrend}>
              <defs>
                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--sev-critical)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--sev-critical)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} allowDecimals={false} />
              <Tooltip {...chartTooltipStyle()} />
              <Area type="monotone" dataKey="count" stroke="var(--sev-critical)" strokeWidth={2} fill="url(#trendGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
        {data.trends?.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 z-10 bg-surface-sunken">
                <tr className="border-b border-rmpg-600">
                  <th className="px-2 py-1.5 text-left text-rmpg-400 font-bold uppercase">Type</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Current</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Prev Month</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">MoM %</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Last Year</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">YoY %</th>
                </tr>
              </thead>
              <tbody>
                {data.trends.slice(0, 10).map((t: any) => (
                  <tr key={t.type} className="border-b border-rmpg-700/50 hover:bg-surface-raised transition-colors">
                    <td className="px-2 py-1.5 text-rmpg-200">{formatIncidentType(t.type)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-rmpg-200">{t.current}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-rmpg-400">{t.previous}</td>
                    <td className={`px-2 py-1.5 text-right font-mono font-bold ${t.momChange > 0 ? 'text-red-400' : t.momChange < 0 ? 'text-green-400' : 'text-rmpg-400'}`}>
                      {t.momChange > 0 ? '+' : ''}{t.momChange}%
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-rmpg-400">{t.lastYear}</td>
                    <td className={`px-2 py-1.5 text-right font-mono font-bold ${t.yoyChange > 0 ? 'text-red-400' : t.yoyChange < 0 ? 'text-green-400' : 'text-rmpg-400'}`}>
                      {t.yoyChange > 0 ? '+' : ''}{t.yoyChange}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CitationRevenueCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<any>('/reports/citation-revenue').then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="bg-surface-base panel-beveled p-4 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-brand-400" role="status" aria-label="Loading" /> <span className="text-xs text-rmpg-400">Loading citation revenue...</span></div>;
  if (!data) return null;

  return (
    <div className="bg-surface-base panel-beveled">
      <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
        <Database className="w-3.5 h-3.5 text-green-400" />
        <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Citation Revenue Report</h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Total Fines', value: `$${(data.summary?.total_fines || 0).toLocaleString()}`, color: 'var(--text-muted)' },
            { label: 'Collected', value: `$${(data.summary?.collected || 0).toLocaleString()}`, color: 'var(--stat-accent-green)' },
            { label: 'Outstanding', value: `$${(data.summary?.outstanding || 0).toLocaleString()}`, color: 'var(--stat-accent-amber)' },
            { label: 'Dismissed', value: `$${(data.summary?.dismissed || 0).toLocaleString()}`, color: 'var(--stat-accent-red-bright)' },
          ].map(s => (
            <div key={s.label} className="panel-beveled bg-surface-sunken p-2 text-center">
              <div className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[8px] text-rmpg-500 uppercase">{s.label}</div>
            </div>
          ))}
        </div>
        {data.monthlyRevenue?.length > 0 && (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.monthlyRevenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
              <Tooltip {...chartTooltipStyle()} />
              <Legend wrapperStyle={{ color: 'var(--text-muted)', fontSize: '9px' }} />
              <Bar dataKey="collected" name="Collected" fill="var(--sev-ok)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="outstanding" name="Outstanding" fill="var(--sev-warn)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function BeatActivityCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<any>('/reports/beat-activity').then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading || !data) return null;

  return (
    <div className="bg-surface-base panel-beveled">
      <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
        <MapPin className="w-3.5 h-3.5 text-rmpg-400" />
        <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Beat Activity Report</h3>
      </div>
      <div className="p-4">
        {data.beats?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 z-10 bg-surface-sunken">
                <tr className="border-b border-rmpg-600">
                  <th className="px-2 py-1.5 text-left text-rmpg-400 font-bold uppercase">Beat</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Calls</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Incidents</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Citations</th>
                </tr>
              </thead>
              <tbody>
                {data.beats.map((b: any) => (
                  <tr key={b.beat_code} className="border-b border-rmpg-700/50 hover:bg-surface-raised transition-colors">
                    <td className="px-2 py-1.5 text-rmpg-200 font-mono font-bold">{b.beat_name || b.beat_code}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-rmpg-400">{b.calls}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-rmpg-200">{b.incidents}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-rmpg-200">{b.citations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="text-xs text-rmpg-500 text-center py-4">No beat activity data available</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Feature 14 & 15: Report Scheduling + Templates UI
// ═══════════════════════════════════════════════════════════════
function ReportSchedulesCard() {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<any[]>('/reports/schedules').catch(() => []),
      apiFetch<any[]>('/reports/templates').catch(() => []),
    ]).then(([s, t]) => {
      setSchedules(Array.isArray(s) ? s : []);
      setTemplates(Array.isArray(t) ? t : []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-surface-base panel-beveled">
        <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-amber-400" />
          <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Scheduled Reports ({schedules.length})</h3>
        </div>
        <div className="p-3">
          {schedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-rmpg-500">
              <Calendar className="w-6 h-6 text-rmpg-600 mb-2" />
              <span className="text-[10px]">No scheduled reports configured</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {schedules.map((s: any) => (
                <div key={s.id} className="flex items-center gap-2 panel-beveled bg-surface-sunken p-2">
                  <span className={`led-dot ${s.is_active ? 'led-green' : 'led-off'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-rmpg-200 font-bold truncate">{s.name}</div>
                    <div className="text-[9px] text-rmpg-500">{s.frequency} &middot; {s.report_type}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="bg-surface-base panel-beveled">
        <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-purple-400" />
          <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Report Templates ({templates.length})</h3>
        </div>
        <div className="p-3">
          {templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-rmpg-500">
              <FileText className="w-6 h-6 text-rmpg-600 mb-2" />
              <span className="text-[10px]">No report templates saved</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {templates.map((t: any) => (
                <div key={t.id} className="flex items-center gap-2 panel-beveled bg-surface-sunken p-2">
                  <FileText className="w-3 h-3 text-purple-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-rmpg-200 font-bold truncate">{t.name}</div>
                    <div className="text-[9px] text-rmpg-500">{t.report_type}{t.description ? ` - ${t.description}` : ''}</div>
                  </div>
                  {t.is_default ? <span className="text-[8px] text-green-400 font-bold uppercase">Default</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Valid date-range presets accepted by the URL deep-link. Anything outside
// this list is silently dropped so a bad URL doesn't put the page into an
// invalid state where the select shows nothing.
const VALID_DATE_RANGES = new Set([
  'today', 'last_7_days', 'last_14_days', 'last_30_days',
  'this_month', 'last_month', 'this_quarter', 'custom',
]);

// IDs of report cards an operator can scroll-deep-link to. Used for the
// optional `?card=` query param so a supervisor can hand a colleague a
// URL that opens straight to the Patrol Tracking generator or Crime Trend
// table without forcing them to scroll the long dashboard. The values are
// matched against `data-report-card="..."` anchors on each card root.
const SCROLLABLE_CARDS = new Set([
  'patrol-tracking', 'crime-trends', 'beat-activity', 'citation-revenue',
  'daily-briefing', 'weekly-digest', 'schedules-templates', 'approval-queue',
]);

export default function ReportsPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Role gates — create = admin|manager, delete = admin|manager only.
  const canCreate = useMemo(() => user?.role === 'admin' || user?.role === 'manager', [user?.role]);
  const canDelete = useMemo(() => user?.role === 'admin' || user?.role === 'manager', [user?.role]);

  // Hydrate date-range state from URL params on first render so a deep-link
  // like /reports?range=last_30_days lands the operator on the right window
  // immediately — supervisors share Reports links in Slack/email all the
  // time, and the previous behavior (always last_14_days regardless of URL)
  // silently swallowed those params.
  const initialRange = (() => {
    const r = searchParams.get('range');
    return r && VALID_DATE_RANGES.has(r) ? r : 'last_14_days';
  })();
  const initialCustomStart = searchParams.get('start_date') || '';
  const initialCustomEnd = searchParams.get('end_date') || '';
  const [dateRange, setDateRange] = useState(initialRange);
  const [customStartDate, setCustomStartDate] = useState(initialCustomStart);
  const [customEndDate, setCustomEndDate] = useState(initialCustomEnd);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // ── URL deep-link: scroll-to-card ─────────────────────────────────
  // Consumes ?card=<id> by scrolling that card into view once the page has
  // finished its first data fetch (so the card is mounted). Honors the
  // Dashboard-emit / page-consume contract used across the other audited
  // pages — Reports is the natural cross-page drill-down target (a Crime
  // Trend chip on the Dashboard, a "view full report" link from the
  // Patrol page, etc.).
  const pendingCardScrollRef = useRef<string | null>(searchParams.get('card'));
  useEffect(() => {
    const target = pendingCardScrollRef.current;
    if (!target || loading) return;
    if (!SCROLLABLE_CARDS.has(target)) {
      pendingCardScrollRef.current = null;
      return;
    }
    pendingCardScrollRef.current = null;
    // requestAnimationFrame so the card's height settles before the scroll.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-report-card="${target}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Brief highlight so the operator's eye lands on the right card —
        // pure CSS class toggle, no layout shift.
        el.classList.add('ring-2', 'ring-brand-400/40');
        window.setTimeout(() => el.classList.remove('ring-2', 'ring-brand-400/40'), 1500);
      }
    });
  }, [loading]);

  // ── URL deep-link: ?report_id=<id> / ?type=<val> ──────────────────
  // ?report_id: scroll to the approval-queue card + toast the queued ID.
  // ?type: pre-select the date range corresponding to a report type slug
  //        (e.g. ?type=crime-trends scrolls to that card).
  // Both are consumed once on mount (useRef guard) and stripped from the
  // URL so a back-forward doesn't re-trigger them.
  const deepLinkConsumedRef = useRef(false);
  useEffect(() => {
    if (deepLinkConsumedRef.current || loading) return;
    deepLinkConsumedRef.current = true;

    const reportId = searchParams.get('report_id');
    const typeParam = searchParams.get('type');

    // Strip both one-shot params immediately so the URL stays clean.
    if (reportId || typeParam) {
      const next = new URLSearchParams(searchParams);
      next.delete('report_id');
      next.delete('type');
      setSearchParams(next, { replace: true });
    }

    if (reportId) {
      // Scroll approval queue card into view and toast the target ID.
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('[data-report-card="approval-queue"]');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('ring-2', 'ring-brand-400/40');
          window.setTimeout(() => el.classList.remove('ring-2', 'ring-brand-400/40'), 1500);
        }
      });
      addToast(`Viewing report #${reportId} in approval queue`, 'info');
    }

    if (typeParam && SCROLLABLE_CARDS.has(typeParam)) {
      // ?type matches a scrollable card slug — scroll to it.
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-report-card="${typeParam}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('ring-2', 'ring-brand-400/40');
          window.setTimeout(() => el.classList.remove('ring-2', 'ring-brand-400/40'), 1500);
        }
      });
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror state -> URL so a refresh keeps the window. Wrapped in an effect
  // so we don't fight React's render cycle. We use replace:true to avoid
  // polluting the back-button history with every preset change.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (dateRange !== 'last_14_days') next.set('range', dateRange); else next.delete('range');
    if (dateRange === 'custom' && customStartDate) next.set('start_date', customStartDate);
    else next.delete('start_date');
    if (dateRange === 'custom' && customEndDate) next.set('end_date', customEndDate);
    else next.delete('end_date');
    // Strip the one-shot card param after the scroll effect consumed it.
    if (pendingCardScrollRef.current === null && next.has('card')) next.delete('card');
    const cur = searchParams.toString();
    const nxt = next.toString();
    if (cur !== nxt) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, customStartDate, customEndDate]);

  // State for all API data
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [incidentsData, setIncidentsData] = useState<IncidentsSummaryData | null>(null);
  const [responseTimesData, setResponseTimesData] = useState<ResponseTimesData | null>(null);
  const [officerActivity, setOfficerActivity] = useState<OfficerActivityData[]>([]);

  // Upgrade: Comparison data
  const [comparisonData, setComparisonData] = useState<{
    period: string;
    calls: { current: number; previous: number; change: number };
    incidents: { current: number; previous: number; change: number };
    citations: { current: number; previous: number; change: number };
    responseTime: { current: number | null; previous: number | null; change: number | null };
  } | null>(null);

  // Upgrade: Report schedules
  const [reportSchedules, setReportSchedules] = useState<any[]>([]);

  // Fetch all data
  useEffect(() => {
    let cancelled = false;

    async function fetchAllData() {
      setLoading(true);
      setError(null);

      try {
        let startDate: string;
        let endDate: string | undefined;
        if (dateRange === 'custom' && customStartDate) {
          startDate = customStartDate;
          endDate = customEndDate || undefined;
        } else {
          const range = getDateRange(dateRange);
          startDate = range.startDate;
          endDate = range.endDate;
        }
        const dateParams = new URLSearchParams({ startDate });
        if (endDate) dateParams.append('endDate', endDate);
        // The incidents-summary / response-times / officer-activity handlers
        // honor ONLY `?days=N` — they ignore startDate/endDate. Without this the
        // range picker did nothing: every selection returned the fixed 30-day
        // default. Translate the chosen window into an inclusive day count.
        const startMs = new Date(`${startDate}T00:00:00`).getTime();
        const endMs = endDate ? new Date(`${endDate}T00:00:00`).getTime() : Date.now();
        const days = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
        dateParams.append('days', String(days));

        // Fetch all endpoints in parallel. Each is independently fault-tolerant
        // — /reports/dashboard and /officer-activity fall through to legacy and
        // may 404/500; without per-fetch .catch one failure rejected Promise.all
        // and blanked the ENTIRE Reports page. Now a missing endpoint only leaves
        // its own card empty.
        const [dashboard, incidents, responseTimes, officers] = await Promise.all([
          apiFetch<DashboardData>('/reports/dashboard').catch(() => null),
          apiFetch<IncidentsSummaryData>(`/reports/incidents-summary?groupBy=type&${dateParams.toString()}`).catch(() => null),
          apiFetch<ResponseTimesData>(`/reports/response-times?${dateParams.toString()}`).catch(() => null),
          apiFetch<OfficerActivityData[]>(`/reports/officer-activity?${dateParams.toString()}`).catch(() => null),
        ]);

        if (cancelled) return;
        if (dashboard) setDashboardData(dashboard);
        if (incidents) setIncidentsData(incidents);
        if (responseTimes) setResponseTimesData(responseTimes);
        if (Array.isArray(officers)) setOfficerActivity(officers);

        // Upgrade: Fetch comparison data and schedules in background
        apiFetch<any>('/reports/comparison?period=week')
          .then(data => { if (!cancelled && data) setComparisonData(data); })
          .catch(() => { /* optional */ });
        apiFetch<any>('/reports/schedules')
          .then(data => {
            if (cancelled) return;
            // Tolerate both shapes: the handler returns a bare array, but a
            // legacy/stub path may wrap it as { data: [...] }. The old code
            // only accepted the wrapped form, so the panel never populated.
            const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : null);
            if (list) setReportSchedules(list);
          })
          .catch(() => { /* optional */ });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load reports data');
        addToast('Failed to load reports data', 'error');
        console.error('Error fetching reports:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAllData();
    return () => { cancelled = true; };
  }, [dateRange, customStartDate, customEndDate, reloadTick]);

  // Compute stats
  const stats = {
    // Was `incidentsData?.total` — identical to incidentsFiled below, so the
    // KPI ribbon showed "Total Calls" and "Incidents Filed" as the same
    // number (both 0) while the "This Week vs Last Week" panel correctly
    // showed real call volume from a different endpoint. responseTimesData
    // already carries a real per-range call count; use that instead.
    totalCalls: responseTimesData?.overall?.totalCalls || 0,
    incidentsFiled: incidentsData?.total || 0,
    avgResponse: responseTimesData?.overall?.avgTotalResponseMinutes
      ? `${responseTimesData.overall.avgTotalResponseMinutes.toFixed(1)}m`
      : '0.0m',
    // PER-CALL SLA compliance, straight from the server.
    //
    // This used to be derived from dailyTrend by crediting a whole day's calls
    // when that DAY'S AVERAGE was <= 5 — wrong in both directions: a day
    // averaging 4.9 counted every call as met even if several took 20 minutes,
    // and a day averaging 5.1 counted none even if most were under target.
    // dailyTrend carries only averages, so the correct figure is not derivable
    // here at all; overall.slaMetCount is computed per row in SQL.
    slaMet: responseTimesData?.overall?.totalCalls
      ? `${Math.round(((responseTimesData.overall.slaMetCount ?? 0) / responseTimesData.overall.totalCalls) * 100)}%`
      : '0%',
    activeOfficers: dashboardData?.officersOnDuty?.length || 0,
  };

  // Prepare chart data
  // Sorted descending; the bar length encodes the count and the Y axis encodes
  // the category, so color carries no information and stays constant.
  // Beyond MAX_INCIDENT_BARS the tail folds into a visible "Other" bar rather
  // than being silently dropped.
  const MAX_INCIDENT_BARS = 10;
  const incidentsSorted = [...(incidentsData?.by_type ?? [])].sort((a, b) => b.count - a.count);
  const incidentsHead = incidentsSorted.slice(0, MAX_INCIDENT_BARS);
  const incidentsTail = incidentsSorted.slice(MAX_INCIDENT_BARS);
  const incidentsChartData = [
    ...incidentsHead.map((item) => ({ name: formatGroupKey(item.type), value: item.count })),
    ...(incidentsTail.length
      ? [{ name: `Other (${incidentsTail.length})`, value: incidentsTail.reduce((s, i) => s + i.count, 0) }]
      : []),
  ];

  // Sourced from responseTimesData, NOT dashboardData.callsByPriority. The
  // dashboard field is scoped to CURRENTLY-ACTIVE calls (StatusBar and the
  // Dashboard P1-P4 tiles both want that), so on this page — which is driven
  // by a date-range selector — it rendered "No data for selected filters"
  // whenever nothing was active, even with 23 calls in the window. Same fix
  // already applied to totalCalls above.
  const priorityChartData = (Array.isArray(responseTimesData?.byPriority) ? responseTimesData.byPriority : []).map(item => ({
    priority: item.priority,
    count: item.count,
    fill: chartPriorityColor(item.priority),
  }));

  // The chart's target line reads the SAME server value the SLA tile is scored
  // against, so the dashed line can never disagree with the percentage beside
  // it. Both were independently hardcoded to 5 before.
  const slaTarget = responseTimesData?.overall?.slaTargetMinutes ?? 5;
  const responseTimeChartData = (Array.isArray(responseTimesData?.dailyTrend) ? responseTimesData.dailyTrend : []).map(item => ({
    date: formatDateLabel(item.date),
    avgMinutes: parseFloat((Number(item.avg_response_minutes) || 0).toFixed(1)),
    targetMinutes: slaTarget,
  }));

  const officerChartData = officerActivity.map(officer => ({
    name: (officer.full_name || '').split(' ').slice(-1)[0] || '?', // Last name only
    calls: officer.calls_responded,
    incidents: officer.incidents_written,
  }));

  const handleExport = () => {
    exportToCSV(incidentsData, officerActivity, stats);
  };

  // Set document title
  useEffect(() => { document.title = 'Reports & Analytics \u2014 RMPG Flex'; }, []);

  // \u2500\u2500 Keyboard shortcuts \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Esc smart-cascade: close error banner first, then exit custom range.
  // stopPropagation per branch so inner layers (ReportApprovalQueue's own
  // Esc handler for the delete confirm / return modal) consume it first.
  //
  // `N`: open the Custom Report Builder \u2014 gated to canCreate (admin|manager)
  // so officers don't accidentally land on the builder. Typing-suppressed so
  // it doesn't fire while editing the custom-range date inputs or modals.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (error) { e.stopPropagation(); setError(null); return; }
        if (dateRange === 'custom') { e.stopPropagation(); setDateRange('last_14_days'); return; }
        // No more open layers on this page \u2014 let the global Esc handler
        // (if any) catch it. We don't navigate back to Dashboard on Esc
        // because the operator might be reading a chart.
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if ((e.key === 'n' || e.key === 'N') && canCreate) {
        e.preventDefault();
        navigate('/reports/custom');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [error, dateRange, navigate, canCreate]);

  return (
    <div className={`${isMobile ? 'p-3 space-y-3' : 'p-6 space-y-6'} animate-fade-in overflow-auto`}>
      {/* Portal Header */}
      {!isMobile && (
        <div className="panel-beveled bg-surface-base overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-2.5 relative">
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, var(--surface-raised), var(--text-muted) 30%, var(--text-muted) 70%, var(--surface-raised))' }} />
            <RmpgLogo height={64} />
            <div className="flex-1">
              <h1 className="text-sm font-bold tracking-wider uppercase text-rmpg-100">Reports & Analytics</h1>
              <p className="text-[9px] tracking-wide text-rmpg-500">Rocky Mountain Protective Group, LLC</p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      {!isMobile && <PanelTitleBar title="REPORTS & ANALYTICS" icon={BarChart3}>
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-rmpg-300" />
          <select id="ff-reportspage-0"
            className="select-dark text-xs w-44"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            disabled={loading}
          >
            <option value="today">Today</option>
            <option value="last_7_days">Last 7 Days</option>
            <option value="last_14_days">Last 14 Days</option>
            <option value="last_30_days">Last 30 Days</option>
            <option value="this_month">This Month</option>
            <option value="last_month">Last Month</option>
            <option value="this_quarter">This Quarter</option>
            <option value="custom">Custom Range</option>
          </select>
          {dateRange === 'custom' && (
            <div className="flex items-center gap-2 ml-1 pl-2 border-l border-rmpg-700">
              <input id="ff-reportspage-1"
                type="date"
                className="input-dark text-xs px-2 py-1 font-mono min-h-[36px]"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                style={{ colorScheme: 'dark' }}
              />
              <span className="text-rmpg-400 text-[10px] uppercase font-bold tracking-wide">to</span>
              <input id="ff-reportspage-2"
                type="date"
                className="input-dark text-xs px-2 py-1 font-mono min-h-[36px]"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                style={{ colorScheme: 'dark' }}
              />
            </div>
          )}
        </div>
        <PrintButton />
        {canCreate && (
          <button type="button"
            className="toolbar-btn"
            onClick={() => navigate('/reports/custom')}
          >
            <Database className="w-3.5 h-3.5" /> Custom Builder
          </button>
        )}
        <button type="button"
          className="toolbar-btn"
          onClick={handleExport}
          disabled={loading || !incidentsData}
          style={{ opacity: (loading || !incidentsData) ? 0.4 : 1 }}
        >
          <Download className="w-3.5 h-3.5" /> Export
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => downloadTextFile('report-catalog.csv', reportCatalogToCsv(
            [...SCROLLABLE_CARDS].map((id) => ({ id, name: id, category: 'dashboard' })),
          ))}
        >CSV</button>
      </PanelTitleBar>}

      {/* Mobile control bar — desktop hides this and uses the PanelTitleBar above */}
      {isMobile && (
        <div className="panel-beveled bg-surface-base p-3 space-y-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-400 flex-shrink-0" />
            <h1 className="text-xs font-bold tracking-wider uppercase text-rmpg-100 flex-1">Reports & Analytics</h1>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-rmpg-300 flex-shrink-0" />
            <select
              className="select-dark text-xs flex-1 min-h-[44px]"
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              disabled={loading}
              aria-label="Date range"
            >
              <option value="today">Today</option>
              <option value="last_7_days">Last 7 Days</option>
              <option value="last_14_days">Last 14 Days</option>
              <option value="last_30_days">Last 30 Days</option>
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
              <option value="this_quarter">This Quarter</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          {dateRange === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="input-dark text-xs px-2 font-mono w-full min-h-[44px]"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                style={{ colorScheme: 'dark' }}
                aria-label="Start date"
              />
              <span className="text-rmpg-400 text-[10px] uppercase font-bold tracking-wide flex-shrink-0">to</span>
              <input
                type="date"
                className="input-dark text-xs px-2 font-mono w-full min-h-[44px]"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                style={{ colorScheme: 'dark' }}
                aria-label="End date"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {canCreate && (
              <button type="button"
                className="toolbar-btn justify-center min-h-[44px]"
                onClick={() => navigate('/reports/custom')}
              >
                <Database className="w-3.5 h-3.5" /> Builder
              </button>
            )}
            <button type="button"
              className="toolbar-btn justify-center min-h-[44px]"
              onClick={handleExport}
              disabled={loading || !incidentsData}
              style={{ opacity: (loading || !incidentsData) ? 0.4 : 1 }}
            >
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="bg-red-900/30 border border-red-700/50 text-red-300 px-3 py-2 text-xs flex items-center gap-2 rounded-sm">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" className="toolbar-btn" onClick={() => { setError(null); setReloadTick((n) => n + 1); }}>Retry</button>
          <button type="button" onClick={() => setError(null)} className="text-red-500 hover:text-red-300 ml-2 text-[10px]">Dismiss</button>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-96 gap-3">
          <Loader2 className="w-8 h-8 text-brand-400 animate-spin" role="status" aria-label="Loading" />
          <span className="text-[10px] text-rmpg-500 uppercase tracking-wider">Loading analytics data...</span>
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-5 gap-3'}`}>
            {[
              { label: 'Total Calls', value: stats.totalCalls, color: 'var(--text-muted)', border: 'border-l-rmpg-500' },
              { label: 'Incidents Filed', value: stats.incidentsFiled, color: 'var(--sev-ok)', border: 'border-l-green-500' },
              { label: 'Avg Response', value: stats.avgResponse, color: 'var(--sev-warn)', border: 'border-l-amber-500' },
              { label: 'SLA Met', value: stats.slaMet, color: 'var(--stat-accent-purple)', border: 'border-l-purple-500' },
              { label: 'Active Officers', value: stats.activeOfficers, color: 'var(--sev-critical)', border: 'border-l-red-500' },
            ].map((s) => (
              <div key={s.label} className={`bg-surface-base panel-beveled p-3 border-l-[3px] ${s.border} hover:bg-surface-raised transition-all duration-200 group cursor-default`}>
                <p className="text-2xl font-black font-mono group-hover:brightness-110 transition-all" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[9px] text-rmpg-400 uppercase mt-1 font-bold tracking-wider">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Upgrade: Week-over-Week Comparison */}
          {/* Guard on responseTime specifically: a malformed/placeholder
              comparison payload (e.g. the proxy stub's old {current,previous,
              deltas} shape) lacks responseTime, and reading .current off it
              threw and took down the whole page via the ErrorBoundary. */}
          {comparisonData?.responseTime && (
            <div className="panel-beveled p-4 bg-surface-base">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-brand-blue" />
                <span className="text-xs font-bold text-rmpg-100 uppercase">This Week vs Last Week</span>
              </div>
              <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-4 gap-3'}`}>
                {[
                  { label: 'Calls', ...comparisonData.calls },
                  { label: 'Incidents', ...comparisonData.incidents },
                  { label: 'Citations', ...comparisonData.citations },
                  { label: 'Avg Response', current: comparisonData.responseTime.current, previous: comparisonData.responseTime.previous, change: comparisonData.responseTime.change },
                ].map(item => (
                  <div key={item.label} className="bg-surface-sunken p-3 text-center">
                    <div className="text-lg font-bold text-rmpg-100 font-mono">{item.current ?? '-'}{item.label === 'Avg Response' && item.current != null ? 'm' : ''}</div>
                    <div className="text-[9px] text-rmpg-400 uppercase">{item.label}</div>
                    {item.change != null && (
                      <div className={`text-[10px] font-bold mt-0.5 ${item.change > 0 ? (item.label === 'Avg Response' ? 'text-red-400' : 'text-green-400') : item.change < 0 ? (item.label === 'Avg Response' ? 'text-green-400' : 'text-amber-400') : 'text-rmpg-400'}`}>
                        {item.change > 0 ? '+' : ''}{item.change}%
                        <span className="text-rmpg-500 ml-1">vs prev {item.previous ?? '-'}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upgrade: Report Schedules */}
          {reportSchedules.length > 0 && (
            <div className="panel-beveled p-4 bg-surface-base">
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-bold text-rmpg-100 uppercase">Scheduled Reports</span>
                <span className="ml-auto text-[9px] text-rmpg-500">{reportSchedules.length} active</span>
              </div>
              <div className="space-y-1.5">
                {reportSchedules.slice(0, 5).map((s: any) => (
                  <div key={s.id} className="flex items-center gap-2 text-xs text-rmpg-300 bg-surface-sunken px-3 py-1.5">
                    <span className={`w-2 h-2 rounded-full ${s.enabled ? 'bg-green-500' : 'bg-rmpg-600'}`} />
                    <span className="font-bold">{s.name}</span>
                    <span className="text-rmpg-500">{toDisplayLabel(s.frequency)}</span>
                    {s.time_of_day && <span className="text-rmpg-500">{s.time_of_day}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Feature 27: Report Approval Queue */}
          <div data-report-card="approval-queue" className="panel-beveled p-4 bg-surface-base transition-shadow">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-bold text-rmpg-100 uppercase">Report Approval Queue</span>
            </div>
            <ReportApprovalQueue canDelete={canDelete} />
          </div>

          {/* Charts Grid */}
          <div className={`grid ${isMobile ? 'grid-cols-1 gap-3' : 'grid-cols-2 gap-4'}`}>
            {/* Incidents by Type (sorted horizontal bar) */}
            <div className="bg-surface-base panel-beveled hover:border-rmpg-600 transition-all duration-150">
              <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-brand-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Incidents by Type</h3>
              </div>
              <div className="p-4">
                {incidentsChartData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
                    <BarChart3 className="w-8 h-8 mb-2 opacity-50" />
                    <p className="text-sm">No data for selected filters</p>
                  </div>
                ) : (
                <div className="p-2" style={{ background: 'var(--chart-plot-surface)' }}>
                  <ResponsiveContainer width="100%" height={Math.max(200, incidentsChartData.length * 26)}>
                    <BarChart
                      data={incidentsChartData}
                      layout="vertical"
                      margin={{ top: 4, right: 36, bottom: 4, left: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" horizontal={false} />
                      <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={110}
                        tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                      />
                      <Tooltip {...chartTooltipStyle()} />
                      <Bar dataKey="value" fill={chartSeriesColors()[0]} radius={[0, 2, 2, 0]}>
                        <LabelList
                          dataKey="value"
                          position="right"
                          style={{ fill: 'var(--text-secondary)', fontSize: 10, fontFamily: 'Arial, sans-serif' }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                )}
              </div>
            </div>

            {/* Calls by Priority (Bar) */}
            <div className="bg-surface-base panel-beveled hover:border-rmpg-600 transition-all duration-150">
              <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Calls by Priority</h3>
              </div>
              <div className="p-4">
              {priorityChartData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
                  <BarChart3 className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">No data for selected filters</p>
                </div>
              ) : (
              <div className="p-2" style={{ background: 'var(--chart-plot-surface)' }}>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={priorityChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="priority" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                  <Tooltip {...chartTooltipStyle()} />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {priorityChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
              )}
              </div>
            </div>

            {/* Response Times Trend (Line) */}
            <div className="bg-surface-base panel-beveled hover:border-rmpg-600 transition-all duration-150">
              <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-red-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Response Time Trend (minutes)</h3>
              </div>
              <div className="p-4">
              {responseTimeChartData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
                  <BarChart3 className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">No data for selected filters</p>
                </div>
              ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={responseTimeChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} domain={[0, 'auto']} />
                  <Tooltip {...chartTooltipStyle()} />
                  <Legend wrapperStyle={{ color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'Arial, sans-serif' }} />
                  <Line type="monotone" dataKey="avgMinutes" name="Avg Response" stroke="var(--text-muted)" strokeWidth={2} dot={{ fill: 'var(--text-muted)', r: 3 }} />
                  <Line type="monotone" dataKey="targetMinutes" name="Target" stroke="var(--brand-gold)" strokeDasharray="5 5" strokeWidth={1} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              )}
              </div>
            </div>

            {/* Officer Activity (Bar) */}
            <div className="bg-surface-base panel-beveled hover:border-rmpg-600 transition-all duration-150">
              <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-green-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Officer Activity Comparison</h3>
              </div>
              <div className="p-4">
              {officerChartData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
                  <BarChart3 className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-sm">No data for selected filters</p>
                </div>
              ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={officerChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} width={70} />
                  <Tooltip {...chartTooltipStyle()} />
                  <Legend wrapperStyle={{ color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'Arial, sans-serif' }} />
                  <Bar dataKey="calls" name="Calls" fill="var(--text-muted)" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="incidents" name="Incidents" fill="var(--brand-gold)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              )}
              </div>
            </div>
          </div>

          {/* Call Volume Trend (Area Chart) */}
          {responseTimesData?.dailyTrend && responseTimesData.dailyTrend.length > 1 && (
            <div className="bg-surface-base panel-beveled hover:border-rmpg-600 transition-all duration-150">
              <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-brand-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Call Volume Trend</h3>
              </div>
              <div className="p-4">
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={responseTimesData.dailyTrend.map(item => ({
                  date: formatDateLabel(item.date),
                  calls: item.count,
                }))}>
                  <defs>
                    <linearGradient id="callVolumeGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--text-muted)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--text-muted)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} allowDecimals={false} />
                  <Tooltip {...chartTooltipStyle()} />
                  <Area type="monotone" dataKey="calls" name="Calls" stroke="var(--text-muted)" strokeWidth={2} fill="url(#callVolumeGradient)" />
                </AreaChart>
              </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Response Time by Priority (Grouped Bar) */}
          {responseTimesData?.byPriority && responseTimesData.byPriority.length > 0 && (
            <div className="bg-surface-base panel-beveled hover:border-rmpg-600 transition-all duration-150">
              <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-purple-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Response Time by Priority (minutes)</h3>
              </div>
              <div className="p-4">
              <div className="p-2" style={{ background: 'var(--chart-plot-surface)' }}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={responseTimesData.byPriority.map(item => ({
                  priority: item.priority,
                  avgMinutes: parseFloat((Number(item.avg_response_minutes) || 0).toFixed(1)),
                  count: item.count,
                  fill: chartPriorityColor(item.priority),
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                  <XAxis dataKey="priority" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                  <Tooltip {...chartTooltipStyle()} />
                  <Legend wrapperStyle={{ color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'Arial, sans-serif' }} />
                  <Bar dataKey="avgMinutes" name="Avg Response (min)" radius={[4, 4, 0, 0]}>
                    {responseTimesData.byPriority.map((item, i) => (
                      <Cell key={i} fill={chartPriorityColor(item.priority)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
              </div>
            </div>
          )}

          {/* ── Patrol Tracking Report Generator ── */}
          <div data-report-card="patrol-tracking" className="transition-shadow"><PatrolTrackingCard /></div>

          {/* ═══ Feature 3: Crime Trend Analysis ═══ */}
          <div data-report-card="crime-trends" className="transition-shadow"><CrimeTrendCard /></div>

          {/* ═══ Feature 4: Beat Activity Report ═══ */}
          <div data-report-card="beat-activity" className="transition-shadow"><BeatActivityCard /></div>

          {/* ═══ Feature 9: Citation Revenue Report ═══ */}
          <div data-report-card="citation-revenue" className="transition-shadow"><CitationRevenueCard /></div>

          {/* ═══ Feature 11 & 12: Briefing & Digest ═══ */}
          <div className={`grid ${isMobile ? 'grid-cols-1 gap-3' : 'grid-cols-2 gap-4'}`}>
            <div data-report-card="daily-briefing" className="transition-shadow"><DailyBriefingCard /></div>
            <div data-report-card="weekly-digest" className="transition-shadow"><WeeklyDigestCard /></div>
          </div>

          {/* ═══ Feature 14 & 15: Schedules & Templates ═══ */}
          <div data-report-card="schedules-templates" className="transition-shadow"><ReportSchedulesCard /></div>
        </>
      )}
    </div>
  );
}

// ── Patrol Tracking Report Card ──────────────────────────
function PatrolTrackingCard() {
  const { addToast } = useToast();
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<'hours' | 'range'>('hours');
  const [hours, setHours] = useState(8);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [unitId, setUnitId] = useState('');
  const [units, setUnits] = useState<{ id: number; call_sign: string }[]>([]);
  const [generating, setGenerating] = useState(false);
  const [includeGeocode, setIncludeGeocode] = useState(true);
  const [preview, setPreview] = useState<{ totalUnits: number; totalPoints: number; totalMiles: number; totalMinutes: number } | null>(null);

  // Fetch available units
  useEffect(() => {
    apiFetch<any[]>('/dispatch/units')
      .then((res) => {
        if (Array.isArray(res)) {
          setUnits(res.map((u: any) => ({ id: u.id, call_sign: u.call_sign || `Unit ${u.id}` })));
        }
      })
      .catch((err) => { console.warn('[ReportsPage] fetch units failed:', err); addToast('Failed to load units', 'error'); });
  }, [addToast]);

  const handleGenerate = async () => {
    setGenerating(true);
    setPreview(null);
    try {
      const params = new URLSearchParams();
      if (mode === 'range' && startDate && endDate) {
        // Use local timezone offset to avoid UTC drift
        const tzOffset = new Date().getTimezoneOffset();
        const tzSign = tzOffset <= 0 ? '+' : '-';
        const tzHrs = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
        const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0');
        const tz = `${tzSign}${tzHrs}:${tzMins}`;
        params.set('startDate', `${startDate}T00:00:00${tz}`);
        params.set('endDate', `${endDate}T23:59:59${tz}`);
      } else {
        params.set('hours', String(hours));
      }
      if (unitId) params.set('unitId', unitId);
      if (includeGeocode) params.set('geocode', 'true');

      const data = await apiFetch<any>(`/reports/patrol-tracking?${params}`);
      if (!data?.trails?.length) {
        // Native alert() blocked the page on render thread and the supervisor
        // had to click OK to dismiss before being able to change the date
        // range. A non-blocking toast lets them adjust filters immediately.
        addToast('No patrol tracking data found for the selected period.', 'warning');
        return;
      }

      // Show preview stats
      const totalMiles = data.trails.reduce((s: number, t: any) => s + (t.stats?.total_distance_miles || 0), 0);
      const totalMinutes = data.trails.reduce((s: number, t: any) => s + (t.stats?.duration_minutes || 0), 0);
      setPreview({
        totalUnits: data.total_units,
        totalPoints: data.total_points,
        totalMiles: Math.round(totalMiles * 100) / 100,
        totalMinutes,
      });

      await generatePatrolTrackingPdf(data);
      addToast('Patrol tracking report generated successfully', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to generate patrol tracking report', 'error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-surface-base panel-beveled p-4 hover:border-rmpg-600 transition-all duration-150">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-brand-400" />
          <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Patrol Tracking Report</h3>
          <span className="text-[8px] text-rmpg-600 font-mono">PS-210</span>
        </div>
      </div>
      <p className="text-[10px] text-rmpg-500 mb-3">
        Generate a detailed GPS breadcrumb report showing patrol routes, speeds, zones, response times, and road locations.
      </p>

      {/* Row 1: Mode toggle + Unit selector */}
      <div className="flex items-center gap-3 flex-wrap mb-2">
        {/* Mode toggle */}
        <div className="flex items-center gap-1 bg-rmpg-800 rounded-sm p-0.5">
          <button type="button"
            onClick={() => setMode('hours')}
            className={`text-[9px] px-2 py-0.5 rounded-sm font-bold uppercase ${mode === 'hours' ? 'bg-brand-500/20 text-brand-400' : 'text-rmpg-500 hover:text-rmpg-300'}`}
          >
            Quick
          </button>
          <button type="button"
            onClick={() => setMode('range')}
            className={`text-[9px] px-2 py-0.5 rounded-sm font-bold uppercase ${mode === 'range' ? 'bg-brand-500/20 text-brand-400' : 'text-rmpg-500 hover:text-rmpg-300'}`}
          >
            Date Range
          </button>
        </div>

        {/* Unit selector */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="ff-reportspage-3" className="text-[10px] text-rmpg-400 font-bold uppercase">Unit:</label>
          <select id="ff-reportspage-3"
            value={unitId}
            onChange={e => setUnitId(e.target.value)}
            className="select-dark text-[10px] w-28"
          >
            <option value="">All Units</option>
            {units.map(u => (
              <option key={u.id} value={u.id}>{u.call_sign}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: Date controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {mode === 'hours' ? (
          <div className="flex items-center gap-1.5">
            <label htmlFor="ff-reportspage-4" className="text-[10px] text-rmpg-400 font-bold uppercase">Hours:</label>
            <select id="ff-reportspage-4"
              value={hours}
              onChange={e => setHours(parseInt(e.target.value, 10))}
              className="select-dark text-[10px] w-20"
            >
              <option value={4}>4 hrs</option>
              <option value={8}>8 hrs</option>
              <option value={12}>12 hrs</option>
              <option value={24}>24 hrs</option>
            </select>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <label htmlFor="ff-reportspage-5" className="text-[10px] text-rmpg-400 font-bold uppercase">Start:</label>
              <input id="ff-reportspage-5"
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="input-dark text-[10px] w-28 px-1.5 py-0.5 min-h-[36px]"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label htmlFor="ff-reportspage-6" className="text-[10px] text-rmpg-400 font-bold uppercase">End:</label>
              <input id="ff-reportspage-6"
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="input-dark text-[10px] w-28 px-1.5 py-0.5 min-h-[36px]"
              />
            </div>
          </>
        )}

        <label className="flex items-center gap-1.5 text-[10px] text-rmpg-400 cursor-pointer">
          <input id="ff-reportspage-7"
            type="checkbox"
            checked={includeGeocode}
            onChange={e => setIncludeGeocode(e.target.checked)}
            className="w-3 h-3"
          />
          Include roads
        </label>

        <button type="button"
          onClick={handleGenerate}
          disabled={generating}
          className={`toolbar-btn toolbar-btn-primary text-[10px] px-4 py-1.5 flex items-center justify-center gap-1.5 ${isMobile ? 'w-full min-h-[44px]' : 'ml-auto'}`}
        >
          {generating ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <FileText className="w-3 h-3" />}
          {generating ? 'Generating...' : 'Export PDF'}
        </button>
      </div>

      {/* Preview stats */}
      {preview && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] text-rmpg-400 font-mono border-t border-rmpg-700/50 pt-2">
          <span>Units: <strong className="text-rmpg-100">{preview.totalUnits}</strong></span>
          <span>Points: <strong className="text-rmpg-100">{preview.totalPoints}</strong></span>
          <span>Miles: <strong className="text-brand-400">{preview.totalMiles}</strong></span>
          <span>Duration: <strong className="text-rmpg-100">{preview.totalMinutes} min</strong></span>
        </div>
      )}
    </div>
  );
}
