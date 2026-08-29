// ============================================================
// RMPG Flex — Process Server Field Suite
// Mobile-first page for managing serve jobs, route planning,
// attempt documentation, and skip traces.
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import RichTextArea from '../components/RichTextArea';
import {
  Plus, RefreshCw, MapPin, BarChart3, List, Map as MapIcon, Briefcase, Calendar,
  Route, Navigation, Loader2, CheckCircle, Circle, Eye, Pencil, ClipboardCheck,
  Search as SearchIcon, AlertTriangle, FileWarning, Users, Trash2, Zap, ArrowUpDown, X,
  FolderOpen, Layers, Printer, FileSignature, ScrollText, LineChart, Copy, Gauge, DollarSign,
  Settings,
} from 'lucide-react';
import ServeStatusFolder from '../components/serve/ServeStatusFolder';
import { computeArrivalsInOrder } from '../components/serve/ServeRoutePlanner';
import ConfirmDialog from '../components/ConfirmDialog';
import PdfPreviewModal from '../components/PdfPreviewModal';
import { useToast } from '../components/ToastProvider';
import AssignTab from './serve/AssignTab';
import MyRunTab from './serve/MyRunTab';
import PerformanceTab from './serve/PerformanceTab';
import AnalyticsTab from './serve/AnalyticsTab';
import SubjectFileTab from './serve/SubjectFileTab';
import CollectionDatabaseTab from './serve/CollectionDatabaseTab';
import { apiFetch } from '../hooks/useApi';
import { useOptimizationV2 } from '../hooks/useOptimizationV2';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { importWithRetry } from '../utils/importWithRetry';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../context/AuthContext';
import { initMapbox, getMapboxInstance, mapboxgl, MAPBOX_STYLE_DARK } from '../utils/mapboxLoader';
import { installWebglContextRecovery } from '../utils/webglRecovery';
import { getMapboxAccessToken } from '../utils/mapboxApiKey';
import { toDisplayLabel } from '../utils/formatters';
import { ORGANIZATION } from '../constants/organizationConstants';
import ServeJobCard from '../components/serve/ServeJobCard';
import ServeAttemptModal from '../components/serve/ServeAttemptModal';
import EditServeAttemptModal from '../components/serve/EditServeAttemptModal';
import ServeRoutePlanner from '../components/serve/ServeRoutePlanner';
import ServeSkipTracePanel from '../components/serve/ServeSkipTracePanel';
import ServeAuditLogModal from '../components/serve/ServeAuditLogModal';
import FormModal from '../components/FormModal';
import AddressAutocomplete, { type ParsedAddress } from '../components/AddressAutocomplete';
import DocumentTypeSelector from '../components/serve/DocumentTypeSelector';
import type { ServeJob, ServeAttempt, ServeAttemptData, ServeSkipAddress, ServeFolder } from '../types';
import { deriveServeFolder, SERVE_FOLDER_CONFIG } from '../types';
import ExportButton from '../components/ExportButton';
import { useFormDraft } from '../hooks/useFormDraft';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import FloatingSaveBar from '../components/FloatingSaveBar';
import { parseTimestamp } from '../utils/dateUtils';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';
import { applyRmpgBasemap, getThemeColorRgb } from '../utils/mapboxBasemap';
import { escapeHtml } from '../utils/sanitize';
import { clusterByGrid, type ClusterableItem, type ClusterPositionCache } from '../utils/serveMapClustering';
import { urgencyTierForDeadline, isRiskFlagged, matchesDeadlineFilter, type DeadlineFilter } from '../utils/serveMapOverlays';
import { fetchMapboxRoute } from '../utils/mapboxRouting';
import { exportServeMapSheet } from '../utils/serveMapExport';
import {
  gallonsForMiles,
  googleMapsNavUrl,
  hasEveningWindow,
  hoursUntilDeadline,
  nextUnservedJob,
} from '../utils/routePlannerEngine';

// ─── Constants ──────────────────────────────────────────────────────────

const FIELD_TABS = ['Queue', 'My Run', 'Route', 'Map'] as const;
const RECORDS_TABS = ['Subject File', 'Stats', 'Assign', 'Performance', 'Analytics', 'Collections'] as const;
const TABS = [...FIELD_TABS, ...RECORDS_TABS] as const;
type Tab = typeof TABS[number];

function serveTabVisible(tab: Tab, role: string): boolean {
  if (tab === 'Assign') return ['admin', 'manager', 'supervisor'].includes(role);
  if (tab === 'Performance') return ['admin', 'manager', 'supervisor', 'officer'].includes(role);
  if (tab === 'Analytics') return ['admin', 'manager', 'supervisor'].includes(role);
  if (tab === 'Collections') return ['admin', 'manager', 'supervisor'].includes(role);
  return true;
}

function serveTabClass(active: boolean): string {
  return `flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors border-b-2 whitespace-nowrap ${
    active
      ? 'text-text-primary border-accent-silver-400 bg-surface-raised'
      : 'text-text-secondary border-transparent hover:text-text-primary hover:bg-surface-hover'
  }`;
}
type StatusFilter = 'all' | 'pending' | 'in_progress' | 'served' | 'failed';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'served', label: 'Served' },
  { value: 'failed', label: 'Failed' },
];

// Terminal states (skipped/archived) sit one step dimmer than `pending` on
// purpose: they must stay visually separable from it, and a 12px marker carries
// a 2px white ring, so the dimmer step is still legible against the basemap.
// Do not collapse these onto --text-muted — that renders them identical to pending.
const MARKER_COLORS: Record<string, string> = {
  pending: 'var(--text-muted)',
  in_progress: '#eab308',
  served: '#22c55e',
  failed: '#ef4444',
  skipped: 'var(--border-strong)',
  archived: 'var(--border-strong)',
};

const CLUSTER_PRIORITY_COLORS: Record<string, string> = {
  urgent: '#ef4444',
  rush: '#f97316',
  normal: '#3b82f6',
  routine: '#6b7280',
};

// One-time stylesheet injection for the deadline-urgency pulse-ring animation
// used by buildServeJobMarkerElement below.
if (typeof document !== 'undefined' && !document.getElementById('srv-map-pulse-styles')) {
  const style = document.createElement('style');
  style.id = 'srv-map-pulse-styles';
  style.textContent = `
    @keyframes srv-map-pulse-critical { 0% { opacity:1; transform:scale(0.9);} 100% { opacity:0; transform:scale(1.6);} }
    @keyframes srv-map-pulse-warning { 0% { opacity:0.7; transform:scale(0.9);} 100% { opacity:0; transform:scale(1.4);} }
  `;
  document.head.appendChild(style);
}

function buildServeJobMarkerElement(job: ServeJob, selected: boolean): HTMLElement {
  const color = MARKER_COLORS[job.status] || MARKER_COLORS.pending;
  const tier = urgencyTierForDeadline(job.deadline, Date.now());
  const risk = isRiskFlagged(job);

  const el = document.createElement('div');
  const border = selected ? '3px solid #22c55e' : '2px solid #fff';
  const boxShadow = risk
    ? '0 1px 4px rgba(0 0 0 / 0.4), 0 0 0 3px rgba(239,68,68,0.6)'
    : '0 1px 4px rgba(0 0 0 / 0.4)';
  el.style.cssText = `position:relative;width:12px;height:12px;border-radius:50%;background:${color};border:${border};box-shadow:${boxShadow};cursor:pointer;`;

  if (tier === 'critical' || tier === 'warning') {
    const ring = document.createElement('div');
    const ringColor = tier === 'critical' ? '#ef4444' : '#f59e0b';
    ring.style.cssText = `position:absolute;inset:-6px;border-radius:50%;border:2px solid ${ringColor};animation:srv-map-pulse-${tier} 1.6s ease-out infinite;`;
    el.appendChild(ring);
  }

  if (risk) {
    const warningIcon = document.createElement('div');
    warningIcon.style.cssText = 'position:absolute;bottom:-10px;right:-10px;font-size:9px;';
    warningIcon.textContent = '⚠';
    warningIcon.title = 'Officer safety flag';
    el.appendChild(warningIcon);
  }

  return el;
}

function buildServeClusterMarkerElement(cluster: { count: number; dominantPriority: string }): HTMLElement {
  const color = CLUSTER_PRIORITY_COLORS[cluster.dominantPriority] ?? CLUSTER_PRIORITY_COLORS.routine;
  const el = document.createElement('div');
  el.style.cssText = `
    width:28px;height:28px;border-radius:50%;
    background:${color};border:2px solid rgba(255,255,255,0.85);
    display:flex;align-items:center;justify-content:center;
    font-family:monospace;font-weight:700;font-size:11px;color:#fff;
    cursor:pointer;
  `;
  el.textContent = String(cluster.count);
  el.title = `${cluster.count} serve jobs`;
  return el;
}

const DOCUMENT_TYPES = [
  'Summons', 'Complaint', 'Subpoena', 'Writ', 'Order', 'Notice',
  'Petition', 'Motion', 'Garnishment', 'Eviction', 'Other',
];

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const SERVE_TYPES = ['personal', 'substituted', 'corporate', 'posting', 'publication'] as const;
const CASE_TYPES = ['civil', 'criminal', 'family', 'eviction', 'small_claims', 'probate', 'traffic'] as const;
const PAYMENT_STATUSES = ['unpaid', 'invoiced', 'paid', 'waived'] as const;

const EMPTY_FORM = {
  // ── Recipient ──────────────────────────────────────────────────────────
  recipient_name: '',
  recipient_address: '',
  recipient_address_2: '',
  recipient_city: '',
  recipient_state: 'UT',
  recipient_zip: '',
  // Coordinates from the address autocomplete pick. Sent to the create/update
  // endpoint so it skips its own Nominatim backfill and uses the precise pin.
  recipient_lat: null as number | null,
  recipient_lng: null as number | null,
  // ── Contact (feature 1-3) ───────────────────────────────────────────────
  recipient_phone: '',
  recipient_email: '',
  recipient_dob: '',
  // ── Employment (feature 4-5) ────────────────────────────────────────────
  recipient_employer: '',
  recipient_employer_address: '',
  // ── Legal case ─────────────────────────────────────────────────────────
  document_type: 'Summons',
  case_number: '',
  court_name: '',
  jurisdiction: '',
  plaintiff_name: '',
  defendant_name: '',
  client_name: '',
  attorney_name: '',
  attorney_phone: '',
  attorney_email: '',
  attorney_bar_number: '',
  // ── Service details (feature 6-10) ─────────────────────────────────────
  serve_type: 'personal' as ServeJob['serve_type'],
  case_type: '' as ServeJob['case_type'] | '',
  return_date: '',
  co_defendants: '',
  relationship: '',
  // ── Assignment & scheduling ────────────────────────────────────────────
  officer_id: null as number | null,
  serve_date: '',
  status: 'pending' as ServeJob['status'],
  priority: 'normal' as ServeJob['priority'],
  time_window: 'anytime' as ServeJob['time_window'],
  deadline: '',
  max_attempts: 3,
  urgency_tier: '' as '' | 'standard' | 'tight' | 'critical',
  // ── Billing (feature 11-13) ─────────────────────────────────────────────
  serve_fee: '' as string | number,
  rush_fee: '' as string | number,
  payment_status: 'unpaid' as ServeJob['payment_status'],
  // ── Operations (feature 14-17) ──────────────────────────────────────────
  diligence_required: false as boolean,
  mileage_actual: '' as string | number,
  contact_restrictions: '',
  building_access_notes: '',
  // ── Instructions ───────────────────────────────────────────────────────
  service_instructions: '',
  notes: '',
  next_attempt_note: '',
  // Recipient type (mig 0237)
  recipient_type: '' as '' | 'individual' | 'business',
  business_name: '',
  business_dba: '',
  business_ein: '',
  business_sos_filing: '',
  business_state_of_inc: '',
  registered_agent_name: '',
  registered_agent_title: '',
  registered_office_address: '',
};

// ─── Stats Summary Type ─────────────────────────────────────────────────

interface StatsSummary {
  pending: number;
  in_progress: number;
  served: number;
  failed: number;
  total_attempts: number;
  overdue?: number;
  total?: number;
  date?: string;
  mileage?: number;
  planned_mileage?: number;
}

// ─── Component ──────────────────────────────────────────────────────────

export default function ServePage() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const canManage = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');
  const optimization = useOptimizationV2();
  const canDelete = ['admin', 'manager'].includes(user?.role ?? '');
  const { addToast } = useToast();
  // ── Right-click context menu ──────────────────────────────────────────
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  // ── URL deep-link contract ──
  // /serve?job_id=<n>            — auto-expand that job's card (Queue tab)
  // /serve?serve_id=<n>          — alias for job_id (same behaviour)
  // /serve?case_id=<n>           — expand the first job whose case_number matches
  // /serve?status=<filter>       — apply a status filter (pending|in_progress|served|failed|all)
  // /serve?tab=<Queue|Route|Map|Stats|Assign|My%20Run>  — preselect a tab
  // /serve?date=YYYY-MM-DD       — preselect the date picker
  // Honored once on mount; the param is stripped so a manual refresh does
  // not re-select. A miss raises a toast pointing at the current filter.
  const [searchParams, setSearchParams] = useSearchParams();
  const routerNavigate = useNavigate();
  // ── Core state ──────────────────────────────────────────────────────
  const initialDateParam = searchParams.get('date');
  const initialTabParam = searchParams.get('tab') as Tab | null;
  const initialStatusParam = searchParams.get('status') as StatusFilter | null;
  const validTab = initialTabParam && (TABS as readonly string[]).includes(initialTabParam)
    ? (initialTabParam as Tab)
    : 'Queue';
  const validStatus: StatusFilter = initialStatusParam && ['all', 'pending', 'in_progress', 'served', 'failed'].includes(initialStatusParam)
    ? initialStatusParam
    : 'all';
  const [selectedDate, setSelectedDate] = useState(() => initialDateParam || formatDate(new Date()));
  const [activeTab, setActiveTab] = useState<Tab>(validTab);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(validStatus);
  // Pending deep-link target — resolved once jobs hydrate.
  // ?serve_id= and ?job_id= are interchangeable; ?case_id= is stored separately.
  const pendingJobIdRef = useRef<string | null>(
    searchParams.get('serve_id') ?? searchParams.get('job_id'),
  );
  const pendingCaseIdRef = useRef<string | null>(searchParams.get('case_id'));
  // Delete-job confirm replaces the v480 window.confirm(). Carries the
  // job so the dialog body can show "for {name} (case {n})" detail.
  const [deleteJob, setDeleteJob] = useState<ServeJob | null>(null);
  const [deleting, setDeleting] = useState(false);
  // ── Officers for route planner ──────────────────────────────────────
  const [officers, setOfficers] = useState<{ id: number; name: string }[]>([]);
  // ── Clients (hiring parties) for the Add Job form selector ──────────
  const [clientsList, setClientsList] = useState<{ id: string; name: string }[]>([]);
  // ── Saved route state ───────────────────────────────────────────────
  const [savedRoute, setSavedRoute] = useState<any>(null);

  // ── Data ────────────────────────────────────────────────────────────
  const [jobs, setJobs] = useState<ServeJob[]>([]);
  const [linkedCalls, setLinkedCalls] = useState<Record<number, any>>({});
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [syncing, setSyncing] = useState(false);

  // ── Expanded card tracking ─────────────────────────────────────────
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);

  // ── Modals / panels ────────────────────────────────────────────────
  const [attemptJob, setAttemptJob] = useState<ServeJob | null>(null);
  // Edit modal for a previously-logged attempt — carries both the job
  // (so we know which queueId to PUT against) and the specific attempt row.
  const [editAttempt, setEditAttempt] = useState<{ jobId: number; attempt: ServeAttempt } | null>(null);
  const [skipTraceJob, setSkipTraceJob] = useState<ServeJob | null>(null);
  const [auditJobId, setAuditJobId] = useState<number | null>(null);
  const [routePlannerOpen, setRoutePlannerOpen] = useState(false);
  const [serveMileageRate, setServeMileageRate] = useState<number>(0.67);
  const [createJobOpen, setCreateJobOpen] = useState(false);
  const [editJob, setEditJob] = useState<ServeJob | null>(null);

  // ── Create/Edit form state ─────────────────────────────────────────
  const {
    form: formData,
    setForm: setFormData,
    isDirty: formIsDirty,
    wasRestored: formWasRestored,
    clearDraft: clearFormDraft,
    snapshot: snapshotForm,
  } = useFormDraft<typeof EMPTY_FORM>({
    storageKey: `rmpg_serve_job_form_${editJob?.id ?? 'new'}`,
    defaultValue: EMPTY_FORM,
    isActive: createJobOpen,
  });
  const [formSubmitting, setFormSubmitting] = useState(false);

  // ── Feature 12: Deadline Tracking ──
  const [deadlines, setDeadlines] = useState<any>(null);
  // ── Feature 14: Success Rate Stats ──
  const [successRates, setSuccessRates] = useState<any>(null);

  // ── Notice of Attempt to Serve (unsuccessful-attempt notice) ──
  // Fetches the job's real serve_attempts and maps them into the shape the
  // PDF generator expects. Distinct from the Affidavit of Non-Service: this
  // is an unsworn notice to leave at the address / send to the recipient or
  // client. Extracted from the old handleNoticeOfAttempt so both the
  // download/edit flow AND the new preview-modal flow (which regenerates
  // the doc every time the office/mobile toggle changes) share one source
  // of truth instead of duplicating the attempt-filtering logic.
  const buildNoticeOfAttemptData = async (jobId: number): Promise<(import('../utils/servePdfGenerator').NoticeOfAttemptData & { filename: string }) | null> => {
    // GET /:id returns the job row + its serve_attempts (joined w/ officer).
    const job = await apiFetch<ServeJob & { attempts?: any[] }>(`/process-server/${jobId}`);
    const fullAddress = [job.recipient_address, job.recipient_address_2, job.recipient_city, job.recipient_state, job.recipient_zip]
      .filter(Boolean).join(', ');
    // Only unsuccessful attempts belong on a Notice of Attempt. Filter on
    // both the legacy result enum AND the new disposition_code: a PS/05.*
    // code is a completed service (Personal), so its attempt shouldn't
    // appear on the "non-service" notice. Same for PS/10.* (Substitute)
    // and PS/20.* (Posted, when the queue is `served`).
    const { parseTimestamp } = await importWithRetry(() => import('../utils/dateUtils'));
    const attempts = (job.attempts || [])
      .filter((a) => {
        if ((a.result || '').toLowerCase() === 'served') return false;
        const code = String(a.disposition_code || '').toUpperCase();
        if (code.startsWith('PS/05') || code.startsWith('PS/10') || code.startsWith('PS/25')) return false;
        return true;
      })
      .map((a, i) => {
        const ts = a.attempt_at || a.created_at || null;
        const at = ts ? parseTimestamp(ts) : null;
        const resultText = a.disposition_code || a.result || 'other';
        return {
          number: a.attempt_number ?? i + 1,
          date: at && !isNaN(at.getTime())
            ? (() => {
                const p = (n: number) => String(n).padStart(2, '0');
                return `${p(at.getMonth() + 1)}/${p(at.getDate())}/${at.getFullYear()}`;
              })()
            : '',
          time: at && !isNaN(at.getTime())
            ? at.toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', hour12: false })
            : '',
          result: resultText,
          notes: a.notes || '',
          gpsLat: a.latitude ?? null,
          gpsLng: a.longitude ?? null,
        };
      });
    if (attempts.length === 0) {
      setFetchError('No unsuccessful attempts recorded yet — log a failed attempt before generating a Notice of Attempt.');
      return null;
    }
    const latestAttempt = (job.attempts || [])[(job.attempts || []).length - 1] || {};
    const nextAttemptNote = (job as any).next_attempt_note
      || (job.status === 'failed'
            ? undefined
            : 'A further attempt may be made; contact our office to arrange service.');
    return {
      noticeDate: (() => {
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, '0');
        return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
      })(),
      caseNumber: job.case_number || '',
      agencyRefNumber: `JOB-${job.id}`,
      courtName: job.court_name || 'N/A',
      jurisdiction: job.jurisdiction || 'Salt Lake County, Utah',
      serverName: user?.full_name || user?.username || 'Process Server',
      serverBadge: user?.badge_number || '',
      serverCompany: ORGANIZATION.name,
      serverPhone: ORGANIZATION.phone,
      signature: latestAttempt.signature_data || undefined,
      recipientName: job.recipient_name,
      recipientAddress: fullAddress || (job.recipient_address || 'N/A'),
      documentType: job.document_type,
      clientName: job.client_name || undefined,
      attorneyName: job.attorney_name || undefined,
      attempts,
      nextAttemptNote,
      filename: `Notice-of-Attempt-${job.case_number || job.id}.pdf`,
    } as import('../utils/servePdfGenerator').NoticeOfAttemptData & { filename: string };
  };

  const handleNoticeOfAttempt = async (jobId: number, editBeforePrint?: boolean) => {
    try {
      const data = await buildNoticeOfAttemptData(jobId);
      if (!data) return;
      const { filename, ...noticeData } = data;
      const { generateNoticeOfAttempt } = await importWithRetry(() => import('../utils/servePdfGenerator'));
      // Notice of Attempt is always printed in the field from the in-vehicle
      // Brother PJ thermal printer — never a desk laser — so this always
      // renders mobile-safe margins, no office option.
      const pdf = await generateNoticeOfAttempt(noticeData, { printTarget: 'mobile' });

      if (editBeforePrint) {
        const { storePdfForEditor } = await importWithRetry(() => import('../utils/openPdfDocument'));
        const bytes = new Uint8Array(pdf.output('arraybuffer'));
        storePdfForEditor(bytes, filename);
        // Navigate to the PDF editor in the same tab; the user can annotate,
        // sign, add stamps, and save/print from there.
        window.location.href = `/pdf-editor?from=serve&name=${encodeURIComponent(filename)}`;
      } else {
        const { openPdfDocument } = await importWithRetry(() => import('../utils/openPdfDocument'));
        openPdfDocument(pdf, filename);
      }
    } catch (err) {
      console.error('[serve] Notice of Attempt generation failed:', err);
      setFetchError('Could not generate the Notice of Attempt — please try again.');
    }
  };

  // ── Notice of Attempt — in-app preview ──
  // Opens PdfPreviewModal so the officer sees the actual rendered PDF —
  // margins, header offset, table layout — before printing or downloading,
  // instead of blind-downloading a file and finding out it's wrong once
  // it's already at the printer. Always mobile: this notice is printed in
  // the field from the in-vehicle Brother PJ thermal printer, never a desk
  // laser, so there's no office variant to toggle to.
  const [noticePreviewJobId, setNoticePreviewJobId] = useState<number | null>(null);

  // Job Information Sheet (PS-300) — full printable packet carried by the PSO
  // to the field and filed as an internal record. Distinct from the Notice of
  // Attempt (left with the recipient): this sheet shows ALL attempts, skip
  // trace results, service instructions, and has blank lines for field notes.
  const handleJobSheet = async (jobId: number) => {
    try {
      const job = await apiFetch<ServeJob & { attempts?: any[]; skipTraces?: any[] }>(`/process-server/${jobId}`);
      const { formatDate, formatShortTime } = await importWithRetry(() => import('../utils/dateUtils'));

      const fullAddress = [
        job.recipient_address,
        job.recipient_address_2,
        job.recipient_city,
        job.recipient_state,
        job.recipient_zip,
      ].filter(Boolean).join(', ');

      const attempts = (job.attempts || []).map((a, i) => {
        const ts = a.attempt_at || a.created_at || null;
        return {
          number: a.attempt_number ?? i + 1,
          date: ts ? formatDate(ts) : '',
          time: ts ? formatShortTime(ts) : '',
          type: toDisplayLabel(a.attempt_type),
          result: a.disposition_code || a.result || 'other',
          officerName: a.officer_name || '',
          notes: a.notes || '',
          gpsLat: a.latitude ?? null,
          gpsLng: a.longitude ?? null,
        };
      });

      const skipTraces = (job.skipTraces || []).map((t: any) => {
        const addrs = Array.isArray(t.addresses_found) ? t.addresses_found : [];
        return {
          date: t.created_at ? formatDate(t.created_at) : '',
          searchType: t.search_type || '',
          addressesFound: addrs.length,
          addressesTried: addrs.map((a: any) =>
            [a.address, a.city, a.state, a.zip].filter(Boolean).join(', ')
          ),
        };
      });

      const { generateServeJobSheet } = await importWithRetry(() => import('../utils/serveJobSheetPdfGenerator'));
      const pdf = await generateServeJobSheet({
        jobId: job.id,
        status: job.status,
        priority: job.priority,
        deadline: job.deadline || null,
        timeWindow: job.time_window,
        serveDate: job.serve_date || null,
        serviceInstructions: job.service_instructions || null,
        notes: job.notes || null,
        recipientName: job.recipient_name,
        recipientAddress: fullAddress || job.recipient_address || 'N/A',
        recipientGps: (job.recipient_lat != null && job.recipient_lng != null)
          ? { lat: job.recipient_lat, lng: job.recipient_lng }
          : null,
        documentType: job.document_type,
        caseNumber: job.case_number || null,
        courtName: job.court_name || null,
        jurisdiction: job.jurisdiction || null,
        clientName: job.client_name || null,
        attorneyName: job.attorney_name || null,
        officerName: user?.full_name || user?.username || 'Process Server',
        officerBadge: user?.badge_number || '',
        attempts,
        skipTraces: skipTraces.length > 0 ? skipTraces : undefined,
      });

      const { openPdfDocument } = await importWithRetry(() => import('../utils/openPdfDocument'));
      openPdfDocument(pdf, `Job-Sheet-${job.case_number || job.id}.pdf`);
    } catch (err) {
      console.error('[serve] Job sheet generation failed:', err);
      setFetchError('Could not generate the Job Information Sheet — please try again.');
    }
  };

  // ── Notice of Service Leave-Behind (PS-314) ──
  // Recipient-facing document left at the point of service. Page 1 is a
  // summary of what was served; page 2 is a dual-signature acknowledgement.
  const handleLeaveBehind = async (jobId: number) => {
    try {
      const job = await apiFetch<ServeJob & { attempts?: any[] }>(`/process-server/${jobId}`);
      const fullAddress = [
        job.recipient_address, job.recipient_address_2,
        job.recipient_city, job.recipient_state, job.recipient_zip,
      ].filter(Boolean).join(', ');

      const { generateServeLeaveBehin } = await importWithRetry(
        () => import('../utils/serveLeaveBehinPdfGenerator'),
      );
      const pdf = await generateServeLeaveBehin({
        jobId: job.id,
        caseNumber: job.case_number || null,
        documentType: job.document_type,
        courtName: job.court_name || null,
        jurisdiction: job.jurisdiction || null,
        clientName: job.client_name || null,
        attorneyName: job.attorney_name || null,
        serviceInstructions: job.service_instructions || null,
        serveDate: job.serve_date || null,
        recipientType: job.recipient_type || null,
        recipientName: job.recipient_name,
        recipientAddress: fullAddress || job.recipient_address || 'N/A',
        businessName: job.business_name || null,
        businessDba: job.business_dba || null,
        businessEin: job.business_ein || null,
        businessSosFiling: job.business_sos_filing || null,
        businessStateOfInc: job.business_state_of_inc || null,
        registeredAgentName: job.registered_agent_name || null,
        registeredAgentTitle: job.registered_agent_title || null,
        registeredOfficeAddress: job.registered_office_address || null,
        officerName: user?.full_name || user?.username || 'Process Server',
        officerBadge: user?.badge_number || '',
      });

      const { openPdfDocument } = await importWithRetry(() => import('../utils/openPdfDocument'));
      openPdfDocument(pdf, `Leave-Behind-PS314-${job.case_number || job.id}.pdf`);
    } catch (err) {
      console.error('[serve] PS-314 leave-behind generation failed:', err);
      setFetchError('Could not generate the Notice of Service leave-behind — please try again.');
    }
  };

  // ── Affidavit of Service (sworn, notarized, filed with court) ──
  const handleAffidavitOfService = async (jobId: number) => {
    try {
      const job = await apiFetch<ServeJob & { attempts?: any[] }>(`/process-server/${jobId}`);
      const fullAddress = [job.recipient_address, job.recipient_address_2, job.recipient_city, job.recipient_state, job.recipient_zip]
        .filter(Boolean).join(', ');
      const { formatDate, formatShortTime } = await importWithRetry(() => import('../utils/dateUtils'));

      // Find the attempt that resulted in service
      const serviceAttempt = (job.attempts || []).find((a) => {
        const code = String(a.disposition_code || '').toUpperCase();
        return (a.result || '').toLowerCase() === 'served' || code.startsWith('PS/05') || code.startsWith('PS/10');
      });

      if (!serviceAttempt) {
        setFetchError('No served attempt found — log a successful attempt before generating an Affidavit of Service.');
        return;
      }

      const ts = serviceAttempt.attempt_at || serviceAttempt.created_at || null;

      const method = serviceAttempt.attempt_type === 'substitute' ? 'substitute'
        : serviceAttempt.attempt_type === 'posting' ? 'posting'
        : 'personal';

      const subInfo = method === 'substitute' && serviceAttempt.person_served_name
        ? {
            name: serviceAttempt.person_served_name,
            relationship: serviceAttempt.person_served_relationship || 'Unknown',
            description: serviceAttempt.person_served_description || 'Person of suitable age and discretion',
          }
        : undefined;

      const { generateAffidavitOfService } = await importWithRetry(() => import('../utils/servePdfGenerator'));
      const pdf = await generateAffidavitOfService({
        courtName: job.court_name || 'Salt Lake County District Court',
        caseNumber: job.case_number || '',
        jurisdiction: job.jurisdiction || 'Salt Lake County, Utah',
        serverName: user?.full_name || user?.username || 'Process Server',
        serverBadge: user?.badge_number || '',
        serverCompany: 'Rocky Mountain Protective Group',
        recipientName: job.recipient_name,
        recipientAddress: fullAddress || (job.recipient_address || 'N/A'),
        documentType: job.document_type || 'Legal Documents',
        serviceDate: ts ? formatDate(ts) : formatDate(new Date().toISOString()),
        serviceTime: ts ? formatShortTime(ts) : '',
        serviceMethod: method,
        gpsLat: serviceAttempt.latitude ?? 0,
        gpsLng: serviceAttempt.longitude ?? 0,
        substituteInfo: subInfo,
        signature: serviceAttempt.signature_data || undefined,
      });

      const { openPdfDocument } = await importWithRetry(() => import('../utils/openPdfDocument'));
      openPdfDocument(pdf, `Affidavit-of-Service-${job.case_number || job.id}.pdf`);
    } catch (err) {
      console.error('[serve] Affidavit of Service generation failed:', err);
      setFetchError('Could not generate the Affidavit of Service — please try again.');
    }
  };

  // ── Affidavit of Non-Service / Due Diligence (sworn, notarized) ──
  const handleAffidavitOfNonService = async (jobId: number) => {
    try {
      const job = await apiFetch<ServeJob & { attempts?: any[]; skipTraces?: any[] }>(`/process-server/${jobId}`);
      const fullAddress = [job.recipient_address, job.recipient_address_2, job.recipient_city, job.recipient_state, job.recipient_zip]
        .filter(Boolean).join(', ');
      const { formatDate, formatShortTime } = await importWithRetry(() => import('../utils/dateUtils'));

      // Filter to only unsuccessful attempts
      const attempts = (job.attempts || [])
        .filter((a) => {
          if ((a.result || '').toLowerCase() === 'served') return false;
          const code = String(a.disposition_code || '').toUpperCase();
          if (code.startsWith('PS/05') || code.startsWith('PS/10') || code.startsWith('PS/25')) return false;
          return true;
        })
        .map((a, i) => {
          const ts = a.attempt_at || a.created_at || null;
          const resultText = a.disposition_code || a.result || 'other';
          return {
            number: a.attempt_number ?? i + 1,
            date: ts ? formatDate(ts) : '',
            time: ts ? formatShortTime(ts) : '',
            gpsLat: a.latitude ?? 0,
            gpsLng: a.longitude ?? 0,
            result: resultText,
            notes: a.notes || '',
          };
        });

      if (attempts.length === 0) {
        setFetchError('No unsuccessful attempts recorded — log at least one failed attempt before generating an Affidavit of Non-Service.');
        return;
      }

      // Map skip traces if available
      const skipTraces = ((job as any).skipTraces || []).map((st: any) => ({
        date: st.searched_at ? formatDate(st.searched_at) : '',
        searchType: st.search_type || 'Skip Trace',
        addressesFound: st.addresses_found || 0,
        addressesTried: st.addresses_tried_json ? JSON.parse(st.addresses_tried_json) : [],
      }));

      const { generateAffidavitOfNonService } = await importWithRetry(() => import('../utils/servePdfGenerator'));
      const pdf = await generateAffidavitOfNonService({
        courtName: job.court_name || 'Salt Lake County District Court',
        caseNumber: job.case_number || '',
        jurisdiction: job.jurisdiction || 'Salt Lake County, Utah',
        serverName: user?.full_name || user?.username || 'Process Server',
        serverBadge: user?.badge_number || '',
        recipientName: job.recipient_name,
        recipientAddress: fullAddress || (job.recipient_address || 'N/A'),
        documentType: job.document_type || 'Legal Documents',
        attempts,
        skipTraces: skipTraces.length > 0 ? skipTraces : undefined,
        signature: (user as any)?.signature_data || undefined,
      });

      const { openPdfDocument } = await importWithRetry(() => import('../utils/openPdfDocument'));
      openPdfDocument(pdf, `Affidavit-of-Non-Service-${job.case_number || job.id}.pdf`);
    } catch (err) {
      console.error('[serve] Affidavit of Non-Service generation failed:', err);
      setFetchError('Could not generate the Affidavit of Non-Service — please try again.');
    }
  };

  const handleLoadDeadlines = async () => {
    try {
      const data = await apiFetch<any>('/process-server/deadlines');
      setDeadlines(data);
    } catch { /* ignore */ }
  };

  const handleLoadSuccessRates = async () => {
    try {
      const data = await apiFetch<any>('/process-server/success-rates?days=90');
      setSuccessRates(data);
    } catch { /* ignore */ }
  };

  // ── Serve settings (mileage rate, etc.) ───────────────────────────
  useEffect(() => {
    apiFetch<{ data: { mileage_rate?: number } }>('/process-server/assignments/settings')
      .then(res => { if (res?.data?.mileage_rate) setServeMileageRate(res.data.mileage_rate); })
      .catch(() => { /* fall back to 0.67 — non-fatal */ });
  }, []);

  // ── Map state ──────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  // Outlives re-renders/zoom changes so a cluster's on-screen position, once
  // computed for a given set of member job ids, never re-averages — see
  // ClusterPositionCache doc in serveMapClustering.ts.
  const clusterPositionCacheRef = useRef<ClusterPositionCache>(new Map());
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const routeSourceRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  // WebGL context-loss recovery (rebuilds the map after a GPU context drop).
  const [serveMapRecoverNonce, setServeMapRecoverNonce] = useState(0);
  const [isServeMapRecovering, setIsServeMapRecovering] = useState(false);
  const [serveMapNeedsManualReload, setServeMapNeedsManualReload] = useState(false);
  const serveMapRecoveryCleanupRef = useRef<(() => void) | null>(null);
  const serveMapRectangleSelectCleanupRef = useRef<(() => void) | null>(null);
  const serveGeoWatchId = useRef<number | null>(null);
  // Grid-clustering zoom tracking, deadline filter, bulk rectangle-select,
  // attempt-history trail, and single-stop drive-time preview state.
  const [mapZoom, setMapZoom] = useState(11);
  const [mapDeadlineFilter, setMapDeadlineFilter] = useState<DeadlineFilter>('all');
  const [routeStatusFilter, setRouteStatusFilter] = useState<StatusFilter>('all');
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());
  const mapSelectStartRef = useRef<{ x: number; y: number } | null>(null);
  const jobsRef = useRef<ServeJob[]>([]);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  const [trailJobId, setTrailJobId] = useState<number | null>(null);
  const [previewOrigin, setPreviewOrigin] = useState<[number, number] | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{ id: number; lng: number; lat: number } | null>(null);
  const [previewRoute, setPreviewRoute] = useState<{ eta: string; distance: string } | null>(null);

  // Delegated click handler for the map popup. ONE popup instance is reused for
  // every job, so this resolves its target from the DOM rather than from a
  // captured `job`. The previous code wired each button by id inside a
  // setTimeout(…, 50) after setHTML, which had two failure modes an operator
  // sees as "the button stopped working": lose the race and getElementById
  // returned null so nothing was wired, or reopen the popup and a second
  // listener stacked on the same button, firing the action twice.
  // Stable identity (useCallback, no deps) makes re-attachment idempotent —
  // addEventListener ignores a duplicate (type, listener) pair.
  const onServePopupClick = useCallback((evt: MouseEvent) => {
    const btn = (evt.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.jobId);
    if (!Number.isFinite(id)) return;
    if (btn.dataset.action === 'trail') {
      setTrailJobId(id);
    } else if (btn.dataset.action === 'preview') {
      const lng = Number(btn.dataset.lng);
      const lat = Number(btn.dataset.lat);
      if (Number.isFinite(lng) && Number.isFinite(lat)) setPreviewTarget({ id, lng, lat });
    }
  }, []);

  // ── Route state ────────────────────────────────────────────────────
  const [routeData, setRouteData] = useState<{
    orderedIds: number[];
    totalDistance: number;
    totalDuration: number;
    fuelCost: number;
  } | null>(null);

  // ══════════════════════════════════════════════════════════════════════
  // API Calls
  // ══════════════════════════════════════════════════════════════════════

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setFetchError('');
    try {
      const data = await apiFetch<ServeJob[]>(`/process-server?date=${selectedDate}`);
      const fetchedJobs = data || [];
      setJobs(fetchedJobs);

      // Fetch linked dispatch calls for jobs that have call_id
      const jobsWithCalls = fetchedJobs.filter((j: any) => j.call_id);
      if (jobsWithCalls.length > 0) {
        const callMap: Record<number, any> = {};
        await Promise.all(
          jobsWithCalls.map(async (j: any) => {
            try {
              const call = await apiFetch(`/dispatch/calls/${j.call_id}`);
              if (call) callMap[j.id] = call;
            } catch (err) { console.warn("[ServePage] operation failed:", err); }
          })
        );
        setLinkedCalls(callMap);
      } else {
        setLinkedCalls({});
      }
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch<StatsSummary>(`/process-server/stats/summary?date=${selectedDate}`);
      setStats(data);
    } catch {
      // stats are non-critical
    }
  }, [selectedDate]);

  const refreshJobs = useCallback(() => {
    fetchJobs();
    fetchStats();
  }, [fetchJobs, fetchStats]);

  // Initial load + date change
  useEffect(() => {
    refreshJobs();
  }, [refreshJobs]);

  // ── WebSocket live updates ─────────────────────────────────────────
  useLiveSync('process-server', refreshJobs);

  // ── Cross-tab sync: My Run emits 'serve:statusChanged' on quick status
  //    updates; Queue tab picks it up here so its folder view updates
  //    immediately without waiting for the WS poll cycle.
  useEffect(() => {
    const handler = (e: Event) => {
      const { jobId, newStatus } = (e as CustomEvent<{ jobId: number; newStatus: string }>).detail;
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: newStatus as ServeJob['status'],
                closed_at:
                  newStatus === 'served' || newStatus === 'failed'
                    ? new Date().toISOString()
                    : j.closed_at,
              }
            : j,
        ),
      );
    };
    window.addEventListener('serve:statusChanged', handler);
    return () => window.removeEventListener('serve:statusChanged', handler);
  }, []);

  // ── Fetch officers for route planner ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<any>('/personnel?status=active');
        if (cancelled) return;
        const list = Array.isArray(res) ? res : res?.data ?? [];
        setOfficers(list.map((u: any) => ({ id: u.id, name: u.full_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username })));
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch clients for the hiring-party selector on the Add Job form ──
  // Mirrors the dispatch New Call form: picking a client fills the (free-text)
  // Client Name so the hiring party is a known, standardized account.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<any[]>('/admin/clients');
        if (cancelled) return;
        setClientsList((Array.isArray(res) ? res : [])
          .filter((c: any) => c.status === 'active')
          .map((c: any) => ({ id: String(c.id), name: c.name })));
      } catch { /* non-critical — selector just stays empty */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch saved route for today ──────────────────────────────────
  const fetchSavedRoute = useCallback(async (dateOverride?: string) => {
    if (!user?.id) return;
    const date = dateOverride ?? selectedDate;
    try {
      // GET /routes/:date returns a ROW ARRAY (src/routes/serve.ts uses
      // query(), i.e. `T[]`), newest first. Assigning the array straight to
      // savedRoute left `savedRoute.optimized_order_json` undefined, so the
      // Route tab rendered "No route planned for this date." even when a
      // route existed — unconditionally, for every date and officer. Take the
      // newest row (ORDER BY id DESC) and keep the object fallback in case the
      // endpoint is ever narrowed to a single row.
      const resp = await apiFetch<any>(`/process-server/routes/${date}?officer_id=${Number(user.id)}`);
      setSavedRoute(Array.isArray(resp) ? (resp[0] ?? null) : (resp ?? null));
    } catch { setSavedRoute(null); }
  }, [selectedDate, user?.id]);

  useEffect(() => { fetchSavedRoute(); }, [fetchSavedRoute]);

  // ══════════════════════════════════════════════════════════════════════
  // Handlers
  // ══════════════════════════════════════════════════════════════════════

  const handleSyncFromSM = useCallback(async () => {
    setSyncing(true);
    try {
      await apiFetch('/servemanager/sync', { method: 'POST', body: JSON.stringify({ type: 'incremental' }) });
      refreshJobs();
    } catch {
      addToast('Sync from ServeManager failed', 'error');
    } finally {
      setSyncing(false);
    }
  }, [refreshJobs]);

  const handleNavigate = useCallback(async (jobId: number) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    const label = encodeURIComponent(job.recipient_name || 'Serve stop');
    if (job.recipient_lat != null && job.recipient_lng != null) {
      routerNavigate(`/navigation?destination=${label}&lat=${job.recipient_lat}&lng=${job.recipient_lng}`);
      return;
    }
    if (!job.recipient_address) return;
    const addr = [
      job.recipient_address, job.recipient_address_2, job.recipient_city, job.recipient_state, job.recipient_zip,
    ].filter(Boolean).join(', ');
    try {
      const geo = await apiFetch<{ results: Array<{ lat: string; lon: string }> }>(`/geocode/search?q=${encodeURIComponent(addr)}&limit=1`);
      const hit = geo?.results?.[0];
      if (!hit) { addToast('Could not locate that address to navigate', 'error'); return; }
      routerNavigate(`/navigation?destination=${label}&lat=${hit.lat}&lng=${hit.lon}`);
    } catch {
      addToast('Could not locate that address to navigate', 'error');
    }
  }, [jobs, routerNavigate]);

  const handleAddressClassChange = useCallback(async (jobId: number, klass: string, confirmed: boolean) => {
    try {
      await apiFetch(`/process-server/${jobId}/address-class`, {
        method: 'PATCH',
        body: JSON.stringify({ klass, confirmed }),
      });
      // Patch local state so the UI reflects the change immediately without a full refresh.
      setJobs(prev => prev.map(j => {
        if (j.id !== jobId) return j;
        let pd: Record<string, any> = {};
        try { pd = j.parsed_data ? JSON.parse(j.parsed_data) : {}; } catch { /* ignore */ }
        pd._intake = pd._intake ?? {};
        pd._intake.address_class = { ...(pd._intake.address_class ?? {}), klass, confirmed };
        return { ...j, parsed_data: JSON.stringify(pd) };
      }));
      if (editJob?.id === jobId) {
        setEditJob(prev => {
          if (!prev) return prev;
          let pd: Record<string, any> = {};
          try { pd = prev.parsed_data ? JSON.parse(prev.parsed_data) : {}; } catch { /* ignore */ }
          pd._intake = pd._intake ?? {};
          pd._intake.address_class = { ...(pd._intake.address_class ?? {}), klass, confirmed };
          return { ...prev, parsed_data: JSON.stringify(pd) };
        });
      }
      addToast(`Address class set to ${klass}${confirmed ? ' (confirmed)' : ''}`, 'success');
    } catch {
      addToast('Could not update address class', 'error');
    }
  }, [editJob, addToast]);

  const handleFlagAddress = useCallback(async (jobId: number) => {
    try {
      await apiFetch(`/process-server/${jobId}`, {
        method: 'PUT',
        body: JSON.stringify({ notes: 'BAD ADDRESS \u2014 needs verification', status: 'skipped' }),
      });
      addToast('Address flagged for verification', 'success');
      refreshJobs();
    } catch {
      addToast('Could not flag address — please try again', 'error');
    }
  }, [refreshJobs, addToast]);

  // Opens the in-page ConfirmDialog (replaces the v480 native window.confirm
  // and its window.alert on failure — both broke the day/night surface and
  // bypassed our keyboard-trap / a11y model).
  const handleMoveToFolder = useCallback(async (job: ServeJob, newStatus: string) => {
    // Optimistic UI: update folder immediately.
    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: newStatus as ServeJob['status'] } : j));
    try {
      await apiFetch(`/serve-intake/${job.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      addToast(`Moved to ${newStatus === 'cancelled' ? 'Archive' : toDisplayLabel(newStatus)}`, 'success');
      setTimeout(refreshJobs, 600);
    } catch (e) {
      // Revert optimistic update on failure.
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: job.status } : j));
      addToast(`Could not move job: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    }
  }, [addToast, refreshJobs]);

  const handleDeleteJob = useCallback((job: ServeJob) => {
    setDeleteJob(job);
  }, []);

  const confirmDeleteJob = useCallback(async () => {
    if (!deleteJob) return;
    const removed = deleteJob;
    setDeleting(true);
    try {
      await apiFetch(`/serve-intake/${deleteJob.id}`, { method: 'DELETE' });
      setJobs((prev) => prev.filter((j) => j.id !== deleteJob.id));
      setExpandedJobId((prev) => (prev === deleteJob.id ? null : prev));
      addToast('Process-service job deleted', 'success');
      setDeleteJob(null);
      setTimeout(refreshJobs, 600);
    } catch (e) {
      setJobs((prev) => (prev.some((j) => j.id === removed.id) ? prev : [...prev, removed]));
      addToast(`Could not delete job: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    } finally {
      setDeleting(false);
    }
  }, [deleteJob, addToast, refreshJobs]);

  const handleAttemptSubmit = useCallback(async (data: ServeAttemptData) => {
    if (!attemptJob) return { dueDiligenceComplete: false, attemptNumber: 0, jobStatus: 'pending' };
    const result = await apiFetch<{
      queue_status: string;
      attempt_number: number;
    }>(`/process-server/${attemptJob.id}/attempt`, {
      method: 'POST',
      // Stamp from the officer's own device, not the server's receipt time.
      // toISOString() resolves the device clock through the device's timezone,
      // so the instant is correct regardless of where the unit is; the server
      // sanity-checks it and falls back to its own clock if it's implausible.
      body: JSON.stringify({ attempt_at: new Date().toISOString(), ...data }),
    });

    // Optimistic update — move job to its new folder immediately without waiting for poll
    const newStatus = (result.queue_status as ServeJob['status']) || attemptJob.status;
    const newClosedAt = (newStatus === 'served' || newStatus === 'failed')
      ? new Date().toISOString()
      : undefined;
    if (newStatus !== attemptJob.status) {
      setJobs(prev => prev.map(j =>
        j.id === attemptJob.id
          ? { ...j, status: newStatus, closed_at: newClosedAt ?? j.closed_at, attempt_count: j.attempt_count + 1 }
          : j,
      ));
      if (newStatus === 'served') {
        addToast('Job marked as Served', 'success');
      } else if (newStatus === 'failed') {
        addToast('Job marked as Non-Service', 'warning');
      }
    }

    // Still refresh after short delay to sync any server-side changes
    setTimeout(refreshJobs, 600);
    return {
      attemptNumber: result.attempt_number,
      jobStatus: result.queue_status,
      dueDiligenceComplete: (result as any).due_diligence_complete,
    };
  }, [attemptJob, refreshJobs, setJobs, addToast]);

  const handleDeleteAttempt = useCallback(async (queueId: number, attempt: ServeAttempt) => {
    try {
      await apiFetch(`/process-server/${queueId}/attempt/${attempt.id}`, { method: 'DELETE' });
      setEditAttempt(null);
      addToast(`Attempt #${attempt.attempt_number} deleted`, 'success');
      setTimeout(refreshJobs, 300);
    } catch (e) {
      addToast(`Could not delete attempt: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    }
  }, [addToast, refreshJobs]);

  const handleRouteOptimized = useCallback(async (
    orderedJobIds: number[],
    data: { totalDistance: number; totalDuration: number; fuelCost: number; routeDate?: string },
  ) => {
    setRouteData({ orderedIds: orderedJobIds, ...data });
    // Sync the page date to the planner's route date so fetchSavedRoute reads
    // the right row — the user can change the date inside the planner, and if
    // the page's selectedDate still points at a different day, the Route tab
    // would fetch the old route and appear not to update.
    if (data.routeDate && data.routeDate !== selectedDate) {
      setSelectedDate(data.routeDate);
    }
    setActiveTab('Route');
    // Persist sort order to server
    try {
      await apiFetch('/process-server/reorder', {
        method: 'PUT',
        body: JSON.stringify({ items: orderedJobIds.map((id, i) => ({ id, sort_order: i })) }),
      });
      refreshJobs();
      fetchSavedRoute(data.routeDate); // pass planner date so GET targets the right row
    } catch {
      addToast('Could not save route order on server', 'error');
    }
  }, [refreshJobs, fetchSavedRoute, selectedDate]);

  // ── Optimization V2 ───────────────────────────────────────────────────
  const pendingJobIds = useMemo(
    () => jobs.filter(j => j.status !== 'served' && j.status !== 'archived' && j.status !== 'failed').map(j => j.id),
    [jobs],
  );

  const handleOptimizeRouteV2 = useCallback(async () => {
    if (!user?.id || !savedRoute?.id || !pendingJobIds.length) return;
    const now = new Date(); // new-date-ok — wall-clock shift window
    const shiftStart = now.toISOString();
    const shiftEnd = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(); // new-date-ok — 8h shift window
    await optimization.submit({
      job_type: 'serve_run',
      serve_queue_ids: pendingJobIds,
      officer_unit_id: Number(user.id),
      shift_start: shiftStart,
      shift_end: shiftEnd,
      ref_id: savedRoute?.id ?? null,
    });
  }, [user?.id, savedRoute?.id, pendingJobIds, optimization]);

  useEffect(() => {
    if (optimization.status === 'complete') {
      fetchSavedRoute();
    }
  }, [optimization.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSkipTraceAddToRoute = useCallback(async (addr: ServeSkipAddress) => {
    if (!skipTraceJob) return;
    try {
      await apiFetch(`/process-server/${skipTraceJob.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          recipient_address: addr.address,
          recipient_city: addr.city,
          recipient_state: addr.state,
          recipient_zip: addr.zip,
        }),
      });
      addToast('Serve job address updated from skip trace', 'success');
      refreshJobs();
      setSkipTraceJob(null);
    } catch {
      addToast('Could not update job address', 'error');
    }
  }, [skipTraceJob, refreshJobs, addToast]);

  // ── Create / Edit Job ──────────────────────────────────────────────

  const openCreate = useCallback(() => {
    setEditJob(null);
    setFormData({ ...EMPTY_FORM, serve_date: selectedDate, officer_id: user?.id != null ? Number(user.id) : null });
    setCreateJobOpen(true);
    snapshotForm();
  }, [setFormData, snapshotForm, selectedDate, user?.id]);

  const openEdit = useCallback((jobId: number) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    setEditJob(job);
    setFormData({
      recipient_name: job.recipient_name,
      recipient_address: job.recipient_address || '',
      recipient_address_2: job.recipient_address_2 || '',
      recipient_city: job.recipient_city || '',
      recipient_state: job.recipient_state || 'UT',
      recipient_zip: job.recipient_zip || '',
      recipient_lat: job.recipient_lat ?? null,
      recipient_lng: job.recipient_lng ?? null,
      document_type: job.document_type,
      case_number: job.case_number || '',
      court_name: job.court_name || '',
      jurisdiction: job.jurisdiction || '',
      plaintiff_name: job.plaintiff_name || '',
      defendant_name: job.defendant_name || '',
      client_name: job.client_name || '',
      attorney_name: job.attorney_name || '',
      attorney_phone: job.attorney_phone || '',
      attorney_email: job.attorney_email || '',
      attorney_bar_number: job.attorney_bar_number || '',
      officer_id: job.officer_id ?? null,
      serve_date: job.serve_date || '',
      status: job.status,
      priority: job.priority,
      time_window: job.time_window,
      deadline: job.deadline || '',
      max_attempts: job.max_attempts,
      urgency_tier: (job.urgency_tier as '' | 'standard' | 'tight' | 'critical') || '',
      service_instructions: job.service_instructions || '',
      notes: job.notes || '',
      next_attempt_note: job.next_attempt_note || '',
      // New fields from main (expanded job data-entry)
      recipient_phone: job.recipient_phone || '',
      recipient_email: job.recipient_email || '',
      recipient_dob: job.recipient_dob || '',
      recipient_employer: job.recipient_employer || '',
      recipient_employer_address: job.recipient_employer_address || '',
      serve_type: job.serve_type ?? 'personal',
      case_type: job.case_type ?? '',
      return_date: job.return_date || '',
      co_defendants: job.co_defendants || '',
      relationship: job.relationship || '',
      serve_fee: job.serve_fee ?? '',
      rush_fee: job.rush_fee ?? '',
      payment_status: job.payment_status ?? 'unpaid',
      diligence_required: !!job.diligence_required,
      mileage_actual: job.mileage_actual ?? '',
      contact_restrictions: job.contact_restrictions || '',
      building_access_notes: job.building_access_notes || '',
      // Recipient type fields (mig 0237)
      recipient_type: (job.recipient_type as '' | 'individual' | 'business') || '',
      business_name: job.business_name || '',
      business_dba: job.business_dba || '',
      business_ein: job.business_ein || '',
      business_sos_filing: job.business_sos_filing || '',
      business_state_of_inc: job.business_state_of_inc || '',
      registered_agent_name: job.registered_agent_name || '',
      registered_agent_title: job.registered_agent_title || '',
      registered_office_address: job.registered_office_address || '',
    });
    setCreateJobOpen(true);
    snapshotForm();
  }, [jobs, setFormData, snapshotForm]);

  const handleFormSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.recipient_name.trim()) return;
    setFormSubmitting(true);
    try {
      if (editJob) {
        await apiFetch(`/process-server/${editJob.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        });
      } else {
        await apiFetch('/process-server', {
          method: 'POST',
          body: JSON.stringify({ ...formData, serve_date: formData.serve_date || selectedDate }),
        });
      }
      setCreateJobOpen(false);
      clearFormDraft();
      setEditJob(null);
      refreshJobs();
    } catch {
      addToast('Could not save job', 'error');
    } finally {
      setFormSubmitting(false);
    }
  }, [formData, editJob, selectedDate, clearFormDraft, refreshJobs]);

  const handleFormChange = useCallback((field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Feature 31: Clone job ────────────────────────────────────────────
  const handleCloneJob = useCallback(async (jobId: number) => {
    const source = jobs.find(j => j.id === jobId);
    if (!source) return;
    setCloningJobId(jobId);
    try {
      await apiFetch('/process-server', {
        method: 'POST',
        body: JSON.stringify({
          recipient_name: source.recipient_name,
          recipient_address: source.recipient_address,
          recipient_address_2: source.recipient_address_2 ?? undefined,
          recipient_city: source.recipient_city,
          recipient_state: source.recipient_state,
          recipient_zip: source.recipient_zip,
          recipient_lat: source.recipient_lat,
          recipient_lng: source.recipient_lng,
          recipient_phone: source.recipient_phone,
          recipient_email: source.recipient_email,
          document_type: source.document_type,
          case_number: source.case_number,
          court_name: source.court_name,
          jurisdiction: source.jurisdiction,
          plaintiff_name: source.plaintiff_name,
          defendant_name: source.defendant_name,
          client_name: source.client_name,
          attorney_name: source.attorney_name,
          attorney_phone: source.attorney_phone,
          attorney_email: source.attorney_email,
          attorney_bar_number: source.attorney_bar_number,
          serve_type: source.serve_type,
          case_type: source.case_type,
          co_defendants: source.co_defendants,
          priority: source.priority,
          time_window: source.time_window,
          deadline: source.deadline,
          max_attempts: source.max_attempts,
          service_instructions: source.service_instructions,
          building_access_notes: source.building_access_notes,
          contact_restrictions: source.contact_restrictions,
          diligence_required: source.diligence_required,
          serve_fee: source.serve_fee,
          rush_fee: source.rush_fee,
          serve_date: selectedDate,
          status: 'pending',
        }),
      });
      addToast('Job cloned — new copy added to queue', 'success');
      refreshJobs();
    } catch {
      addToast('Could not clone job', 'error');
    } finally {
      setCloningJobId(null);
    }
  }, [jobs, selectedDate, refreshJobs, addToast]);

  // ── Navigate to next unserved stop ─────────────────────────────────

  const handleNavigateToNext = useCallback(() => {
    const orderIds: number[] = (() => {
      if (savedRoute?.optimized_order_json) {
        try {
          const parsed = typeof savedRoute.optimized_order_json === 'string'
            ? JSON.parse(savedRoute.optimized_order_json)
            : savedRoute.optimized_order_json;
          if (Array.isArray(parsed)) return parsed;
        } catch { /* fall through */ }
      }
      return routeData?.orderedIds ?? [];
    })();
    const ordered = (orderIds.length
      ? orderIds.map((id) => jobs.find((j) => j.id === id)).filter((j): j is ServeJob => !!j)
      : jobs.filter((j) => j.status === 'pending' || j.status === 'in_progress'));
    const next = nextUnservedJob(ordered);
    if (next) handleNavigate(next.id);
  }, [jobs, routeData, savedRoute, handleNavigate]);

  const handleMarkArrived = useCallback(async (jobId: number) => {
    if (!savedRoute?.id) {
      addToast('Apply a route in the planner first', 'error');
      return;
    }
    const orderIds: number[] = (() => {
      try {
        const parsed = typeof savedRoute.optimized_order_json === 'string'
          ? JSON.parse(savedRoute.optimized_order_json)
          : savedRoute.optimized_order_json;
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    })();
    const visited = [
      ...jobs.filter((j) => orderIds.includes(j.id) && (j.status === 'served' || j.status === 'failed')).map((j) => j.id),
      jobId,
    ];
    try {
      await apiFetch('/serve-queue/route-progress', {
        method: 'POST',
        body: JSON.stringify({
          route_id: savedRoute.id,
          visited_queue_ids: [...new Set(visited)],
        }),
      });
      addToast('Arrived — stop marked on today’s route', 'success');
    } catch {
      addToast('Could not save arrival progress', 'error');
    }
  }, [savedRoute, jobs, addToast]);

  // ══════════════════════════════════════════════════════════════════════
  // Filtered Jobs
  // ══════════════════════════════════════════════════════════════════════

  // ── Feature 29: Multi-key sort ──
  type SortKey = 'urgency' | 'priority' | 'date' | 'name' | 'fee';
  const [sortKey, setSortKey] = useState<SortKey>('urgency');
  // ── Feature 1: Priority Queue Sort (kept for backwards compat) ──
  const [sortByUrgency, setSortByUrgency] = useState(false);
  // ── Feature 33: Serve-type filter ──
  const [serveTypeFilter, setServeTypeFilter] = useState<string>('all');
  // [30] Attorney name filter — new query param on GET /
  const [attorneyFilter, setAttorneyFilter] = useState('');
  // [22] Aging alert banner — at-risk jobs loaded once per mount, refresh with queue
  const [agingJobs, setAgingJobs] = useState<Array<{ id: number; recipient_name: string; days_remaining: number }>>([]);
  useEffect(() => {
    apiFetch<Array<{ id: number; recipient_name: string; days_remaining: number }>>('/serve/aging')
      .then(setAgingJobs)
      .catch(() => {});
  }, []);
  // [21] Bulk deadline extension modal
  const [bulkDeadlineOpen, setBulkDeadlineOpen] = useState(false);
  const [bulkDeadlineDate, setBulkDeadlineDate] = useState('');
  const [bulkDeadlineSubmitting, setBulkDeadlineSubmitting] = useState(false);
  // ── Feature 31: Clone state ──
  const [cloningJobId, setCloningJobId] = useState<number | null>(null);
  // ── Queue view: folder mode vs flat list ──
  const [viewMode, setViewMode] = useState<'folders' | 'list'>(() =>
    (localStorage.getItem('rmpg_serve_view_mode') as 'folders' | 'list') || 'folders',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [allFoldersOpen, setAllFoldersOpen] = useState<boolean | undefined>(undefined);
  // ── Feature 5: Cost Calculator ──
  const [costEstimate, setCostEstimate] = useState<any>(null);
  const [costJobId, setCostJobId] = useState<number | null>(null);

  const handleLoadCostEstimate = async (jobId: number) => {
    setCostJobId(jobId);
    try {
      const job = jobs.find(j => j.id === jobId);
      const params = new URLSearchParams({
        priority: job?.priority ?? 'normal',
        attempts: String(job?.attempt_count ?? 1),
      });
      // GET /billing/cost-estimate returns a generic {subtotal, lines: [{pricing_code, ...}]}
      // pricing engine response — reshape into the {costs: {...}} named-field shape this
      // page renders (this route/path used to 404 entirely; /process-server/:id/cost-estimate
      // never existed as a route).
      const data = await apiFetch<{ subtotal: number; lines: Array<{ pricing_code: string; quantity: number; line_total: number }> }>(
        `/billing/cost-estimate?${params}`);
      const lineFor = (code: string) => data.lines.find(l => l.pricing_code === code);
      const rush = lineFor('rush');
      const extra = lineFor('extra_attempt');
      const skip = lineFor('skip_trace');
      const mileage = lineFor('mileage');
      setCostEstimate({
        costs: {
          base_fee: lineFor('flat_serve')?.line_total ?? 0,
          extra_attempts: extra?.quantity ?? 0,
          extra_attempt_fee: extra?.line_total ?? 0,
          rush_surcharge: rush?.line_total ?? 0,
          skip_trace_count: skip?.quantity ?? 0,
          skip_trace_fee: skip?.line_total ?? 0,
          mileage: mileage?.quantity ?? 0,
          mileage_fee: mileage?.line_total ?? 0,
          total: data.subtotal ?? 0,
        },
      });
    } catch { setCostEstimate(null); }
  };

  const filteredJobs = useMemo(() => {
    let result = statusFilter === 'all' ? jobs : jobs.filter(j => j.status === statusFilter);

    // Search filter — applies across all folders.
    //
    // Matches the WHOLE address the card displays, not just the street line.
    // `recipient_address` holds "5245 South College Drive"; city/state/zip are
    // separate columns. Searching the city was therefore impossible even though
    // the card renders "5245 South College Drive, Murray, UT, 84123" — typing
    // "Murray" returned zero matches against text plainly on screen. Composing
    // the same string the card builds keeps what-you-see and what-you-search
    // identical, which is the only rule a user can predict.
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const haystack = (j: ServeJob) => [
        j.recipient_name,
        j.case_number,
        j.client_name,
        j.attorney_name,
        j.plaintiff_name,
        j.defendant_name,
        j.co_defendants,
        j.recipient_address,
        j.recipient_city,
        j.recipient_state,
        j.recipient_zip,
        j.document_type,
        j.serve_type,
        j.case_type,
        j.recipient_phone,
        j.recipient_email,
        j.recipient_employer,
        j.court_name,
        j.jurisdiction,
      ].filter(Boolean).join(' ').toLowerCase();
      result = result.filter(j => haystack(j).includes(q));
    }

    // Feature 1: Sort by deadline urgency
    if (sortByUrgency) {
      result = [...result].sort((a, b) => {
        // Priority: overdue > no deadline is last
        const getUrgencyScore = (j: ServeJob) => {
          if (!j.deadline) return 999;
          const daysLeft = (parseTimestamp(j.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          if (daysLeft < 0) return -100 + daysLeft; // overdue: most negative first
          return daysLeft;
        };
        return getUrgencyScore(a) - getUrgencyScore(b);
      });
    }

    // Feature 33: Serve-type filter
    if (serveTypeFilter !== 'all') {
      result = result.filter(j => (j.serve_type ?? 'personal') === serveTypeFilter);
    }

    // [30] Attorney name filter
    if (attorneyFilter.trim()) {
      const q = attorneyFilter.trim().toLowerCase();
      result = result.filter(j =>
        (j.attorney_name ?? '').toLowerCase().includes(q) ||
        (j.client_name ?? '').toLowerCase().includes(q),
      );
    }

    return result;
  }, [jobs, statusFilter, sortByUrgency, searchQuery, serveTypeFilter, attorneyFilter]);

  // Feature 30: Overdue count (open jobs past deadline)
  const overdueCount = useMemo(() => {
    const now = Date.now();
    return jobs.filter(j =>
      (j.status === 'pending' || j.status === 'in_progress') &&
      j.deadline && parseTimestamp(j.deadline).getTime() <= now,
    ).length;
  }, [jobs]);

  // Feature 32: Serve fee total across filtered active jobs
  const filteredFeeTotal = useMemo(() =>
    filteredJobs.reduce((sum, j) => sum + Number(j.serve_fee ?? 0) + Number(j.rush_fee ?? 0), 0),
  [filteredJobs]);

  // Feature 34: Pending-diligence count
  const diligenceCount = useMemo(() =>
    filteredJobs.filter(j => j.diligence_required && j.status !== 'served').length,
  [filteredJobs]);

  // Group jobs by folder for folder view
  const jobsByFolder = useMemo(() => {
    const groups: Record<ServeFolder, ServeJob[]> = {
      in_progress: [], pending: [], served: [], failed: [], archived: [],
    };
    for (const job of filteredJobs) {
      groups[deriveServeFolder(job)].push(job);
    }
    return groups;
  }, [filteredJobs]);

  // ══════════════════════════════════════════════════════════════════════
  // Map Tab
  // ══════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (activeTab !== 'Map') return;

    let cancelled = false;

    const initMap = async () => {
      if (cancelled || !mapContainerRef.current) return;

      if (mapRef.current) {
        // The map is only reusable if it is still attached to the container
        // React is currently rendering. The Map tab's JSX is conditionally
        // mounted, so leaving the tab destroys the container div while this
        // ref keeps pointing at a Map bound to that now-detached node.
        // Returning to the tab renders a NEW empty container, and the old
        // early-return skipped creation because the ref was non-null — so the
        // map never re-attached and the tab stayed permanently blank, with no
        // canvas and not even a "Loading map…" state. Reproduced on live:
        // one switch away and back was enough, and no amount of returning
        // brought it back for the rest of the session.
        const attached = mapRef.current.getContainer?.();
        if (attached && attached.isConnected && attached === mapContainerRef.current) {
          // Only paint markers onto a map that has actually finished loading.
          // This path used to call updateMapMarkers() unconditionally, which
          // BYPASSED the `if (mapReady)` gate below and attached every job
          // marker to a map whose camera had not settled — the markers then sat
          // at stale pixel positions, ignored the basemap while panning, and
          // (because clustering had not run for the real zoom yet) piled up
          // into a single line when zoomed out. If the map is still loading,
          // do nothing: its own 'load' handler flips mapReady and the
          // [mapReady, updateMapMarkers] effect renders them against a settled
          // camera.
          if (mapRef.current.loaded()) updateMapMarkers();
          return;
        }
        // Stale: tear the dead map down and fall through to a fresh build.
        // Its markers and popup belonged to the detached node, so drop those
        // handles too rather than leaving them to be "removed" from a map
        // that no longer exists.
        try { mapRef.current.remove(); } catch { /* already gone */ }
        mapRef.current = null;
        markersRef.current = [];
        try { popupRef.current?.remove(); } catch { /* already gone */ }
        popupRef.current = null;
      }

      const center: [number, number] = [-111.891, 40.7608]; // SLC default [lng, lat]
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: MAPBOX_STYLE_DARK,
        center,
        zoom: 11,
        // mapbox-gl v3 defaults new maps to the 3D Globe projection; a
        // CAD/dispatch map must stay flat at every zoom level so job pins
        // don't visually compress toward the center meridian once zoomed out
        // past the globe/mercator threshold (~zoom 5) — see utils/mapboxMap.ts.
        projection: 'mercator',
        attributionControl: false,
        // Disabled so shift-drag can be used for rectangle-select below without
        // also triggering Mapbox's native box-zoom on the same gesture.
        boxZoom: false,
      });

      map.addControl(new mapboxgl.NavigationControl(), 'top-right');
      map.on('style.load', () => applyRmpgBasemap(map, { variant: 'dark' }));
      map.on('zoomend', () => setMapZoom(map.getZoom()));
      // Right-click sets the drive-time preview origin (simulating "my current
      // position" — there is no live officer position feed). Right-click rather
      // than left-click so it never conflicts with marker/cluster click handlers.
      map.on('contextmenu', (e: mapboxgl.MapMouseEvent) => {
        e.originalEvent?.preventDefault?.();
        setPreviewOrigin([e.lngLat.lng, e.lngLat.lat]);
      });

      // Shift-drag rectangle select: bulk-select job markers by drawing a box
      // in screen space, then converting the corners to lng/lat via unproject.
      const container = mapContainerRef.current;
      const onMouseDown = (e: MouseEvent) => {
        if (!e.shiftKey || !container) return;
        const rect = container.getBoundingClientRect();
        mapSelectStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      };
      const onMouseUp = (e: MouseEvent) => {
        if (!mapSelectStartRef.current || !container) return;
        const start = mapSelectStartRef.current;
        mapSelectStartRef.current = null;
        const rect = container.getBoundingClientRect();
        const end = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const dragDistance = Math.hypot(end.x - start.x, end.y - start.y);
        if (!e.shiftKey || dragDistance < 5) return;
        const sw = map.unproject([Math.min(start.x, end.x), Math.max(start.y, end.y)]);
        const ne = map.unproject([Math.max(start.x, end.x), Math.min(start.y, end.y)]);
        const newlySelected = new Set<number>();
        for (const job of jobsRef.current) {
          if (job.recipient_lat == null || job.recipient_lng == null) continue;
          if (job.recipient_lng >= sw.lng && job.recipient_lng <= ne.lng &&
              job.recipient_lat >= sw.lat && job.recipient_lat <= ne.lat) {
            newlySelected.add(job.id);
          }
        }
        setSelectedJobIds(newlySelected);
      };
      const onMouseLeave = () => { mapSelectStartRef.current = null; };
      container?.addEventListener('mousedown', onMouseDown);
      container?.addEventListener('mouseup', onMouseUp);
      container?.addEventListener('mouseleave', onMouseLeave);
      serveMapRectangleSelectCleanupRef.current = () => {
        container?.removeEventListener('mousedown', onMouseDown);
        container?.removeEventListener('mouseup', onMouseUp);
        container?.removeEventListener('mouseleave', onMouseLeave);
      };

      mapRef.current = map;
      const jobPopup = new mapboxgl.Popup({ offset: 25, closeButton: false });
      // Attach on 'open' rather than at construction: the popup's container
      // element does not exist until it is added to the map.
      jobPopup.on('open', () => {
        jobPopup.getElement()?.addEventListener('click', onServePopupClick);
      });
      popupRef.current = jobPopup;

      // Rebuild in place if the GPU drops the context. updateMapMarkers re-runs
      // (keyed on mapReady) and re-adds the markers + route layer to the new map.
      serveMapRecoveryCleanupRef.current = installWebglContextRecovery(map, {
        label: 'ServePage',
        onRebuild: () => {
          setIsServeMapRecovering(false);
          setServeMapNeedsManualReload(false);
          if (serveMapRecoveryCleanupRef.current) { serveMapRecoveryCleanupRef.current(); serveMapRecoveryCleanupRef.current = null; }
          if (serveMapRectangleSelectCleanupRef.current) { serveMapRectangleSelectCleanupRef.current(); serveMapRectangleSelectCleanupRef.current = null; }
          markersRef.current.forEach((m) => { try { m.remove(); } catch { /* gone */ } });
          markersRef.current = [];
          try { popupRef.current?.remove(); } catch { /* gone */ }
          popupRef.current = null;
          routeSourceRef.current = null;
          if (mapRef.current) { try { mapRef.current.remove(); } catch { /* gone */ } mapRef.current = null; }
          setMapReady(false);
          setServeMapRecoverNonce((n) => n + 1);
        },
        onContextLost: () => setIsServeMapRecovering(true),
        onContextRestored: () => setIsServeMapRecovering(false),
        onGiveUp: () => { setIsServeMapRecovering(false); setServeMapNeedsManualReload(true); },
      });

      map.on('load', () => {
        if (cancelled) return;
        setMapReady(true);
      });
    };

    // The map may ONLY be constructed after initMapbox() has set
    // mapboxgl.accessToken. A bare synchronous `initMap()` used to sit below
    // this block and always won the race against the await, building the map
    // with no token: its style/tile requests never authenticated, 'load' never
    // fired, mapReady stayed false, and the tab sat on "Loading map…" while
    // mapRef.current was already populated — so the token-aware call that
    // followed took the reuse branch and hung markers off that dead map.
    // Intermittent by nature: initMapbox is global, so only the first map
    // opened in a session raced, and every later one inherited the token.
    (async () => {
      try {
        const token = await getMapboxAccessToken();
        if (cancelled) return;
        initMapbox(token);
        if (cancelled) return;
        initMap();
      } catch {
        if (!cancelled) setMapReady(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, serveMapRecoverNonce]);

  // Dispose the map + recovery listener on unmount (kept out of the init
  // effect's cleanup so a tab switch doesn't tear down the persisted map).
  useEffect(() => () => {
    if (serveGeoWatchId.current != null) { navigator.geolocation.clearWatch(serveGeoWatchId.current); serveGeoWatchId.current = null; }
    if (serveMapRecoveryCleanupRef.current) { serveMapRecoveryCleanupRef.current(); serveMapRecoveryCleanupRef.current = null; }
    if (serveMapRectangleSelectCleanupRef.current) { serveMapRectangleSelectCleanupRef.current(); serveMapRectangleSelectCleanupRef.current = null; }
    markersRef.current.forEach((m) => { try { m.remove(); } catch { /* gone */ } });
    markersRef.current = [];
    try { popupRef.current?.remove(); } catch { /* gone */ }
    popupRef.current = null;
    if (mapRef.current) { try { mapRef.current.remove(); } catch { /* gone */ } mapRef.current = null; }
  }, []);

  // Update markers when jobs change or map becomes ready
  const updateMapMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old markers
    markersRef.current.forEach((m) => { try { m.remove(); } catch { /* gone */ } });
    markersRef.current = [];

    // Clear old route source layer
    if (routeSourceRef.current) {
      try {
        safeRemoveLayer(mapRef.current, routeSourceRef.current);
        safeRemoveSource(mapRef.current, routeSourceRef.current);
      } catch { /* layer/source may not exist */ }
      routeSourceRef.current = null;
    }

    const mappableJobs = jobs
      .filter((j) => j.recipient_lat != null && j.recipient_lng != null)
      .filter((j) => matchesDeadlineFilter(j.deadline, mapDeadlineFilter, Date.now(), j.status));

    const clusterInput: ClusterableItem[] = mappableJobs.map((j) => ({
      id: j.id,
      lng: j.recipient_lng!,
      lat: j.recipient_lat!,
      priority: j.priority,
      status: j.status,
    }));
    const clusters = clusterByGrid(clusterInput, mapZoom, clusterPositionCacheRef.current);

    for (const cluster of clusters) {
      if (cluster.count === 1) {
        const job = mappableJobs.find((j) => j.id === cluster.itemIds[0])!;
        const lngLat: [number, number] = [job.recipient_lng!, job.recipient_lat!];

        const el = buildServeJobMarkerElement(job, selectedJobIds.has(job.id));
        // Pinned to the stored coordinate: `draggable` is deliberately OFF so a
        // serve target can never be nudged off its geocoded position by a
        // stray click-drag on the map. Relocating a job is an explicit records
        // edit, not a map gesture.
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center', draggable: false })
          .setLngLat(lngLat)
          .addTo(mapRef.current!);

        // Popup on click
        el.addEventListener('click', () => {
          const fullAddr = [job.recipient_address, job.recipient_address_2, job.recipient_city, job.recipient_state, job.recipient_zip]
            .filter(Boolean).join(', ');
          if (popupRef.current) {
            popupRef.current.setLngLat(lngLat).setHTML(`
              <div style="color:var(--text-primary);background:var(--surface-raised);padding:8px 12px;border-radius:4px;min-width:180px;font-family:system-ui;">
                <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${escapeHtml(job.recipient_name)}</div>
                <div style="font-size:11px;color:var(--text-secondary);">${escapeHtml(fullAddr) || 'No address'}</div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:4px;text-transform:uppercase;">${escapeHtml(toDisplayLabel(job.status))} &middot; ${escapeHtml(toDisplayLabel(job.document_type || ''))}</div>
                <div style="margin-top:8px;display:flex;gap:6px;">
                  <button data-action="trail" data-job-id="${job.id}" style="flex:1;padding:3px 6px;background:rgba(148,163,184,0.15);border:1px solid rgba(148,163,184,0.4);border-radius:2px;color:#cbd5e1;font-size:10px;cursor:pointer;font-family:monospace;">History</button>
                  <button data-action="preview" data-job-id="${job.id}" data-lng="${job.recipient_lng}" data-lat="${job.recipient_lat}" style="flex:1;padding:3px 6px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);border-radius:2px;color:#86efac;font-size:10px;cursor:pointer;font-family:monospace;">Preview drive time</button>
                </div>
              </div>
            `).addTo(mapRef.current!);
            // Buttons are handled by the delegated onServePopupClick listener
            // attached when the popup opens — no per-click id lookup needed.
          }
        });

        // Right-click: job actions menu, in place of the map's own
        // right-click (which sets the drive-time preview origin) —
        // stopPropagation keeps that global handler from also firing.
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu(e, buildJobMenu(job));
        });

        markersRef.current.push(marker);
      } else {
        const el = buildServeClusterMarkerElement(cluster);
        el.addEventListener('click', () => {
          mapRef.current?.easeTo({ center: [cluster.lng, cluster.lat], zoom: mapZoom + 2 });
        });
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu(e, buildClusterMenu(cluster));
        });
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([cluster.lng, cluster.lat])
          .addTo(mapRef.current!);
        markersRef.current.push(marker);
      }
    }

    // ── User location marker on the map ──
    let userLocationMarker: mapboxgl.Marker | null = null;
    if (navigator.geolocation) {
      // Clear previous watch
      if (serveGeoWatchId.current != null) { navigator.geolocation.clearWatch(serveGeoWatchId.current); }
      try {
        const updateUserMarker = (pos: GeolocationPosition) => {
          const lngLat: [number, number] = [pos.coords.longitude, pos.coords.latitude];
          if (!userLocationMarker) {
            // The map can be torn down between the geolocation request and its
            // callback — creating a marker against a dead map throws and would
            // take the whole position handler with it.
            const map = mapRef.current;
            if (!map) return;
            const el = document.createElement('div');
            el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:rgba(59,130,246,0.6);border:3px solid rgba(59,130,246,0.9);box-shadow:0 0 12px rgba(59,130,246,0.5);cursor:pointer;animation:pulse 2s infinite;';
            el.addEventListener('contextmenu', (e) => {
              e.preventDefault();
              e.stopPropagation();
              openMenu(e, buildLocationMenu(lngLat));
            });
            userLocationMarker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat(lngLat).addTo(map);
            // Register HERE, at creation. The previous code pushed the variable
            // synchronously below — while it was still null — so markersRef got
            // a null and the real marker was never tracked. Cleanup iterates
            // markersRef, so every re-run of this effect stranded its user
            // marker on the map and added another: 660 identical markers were
            // stacked on one coordinate on the live board, which is the black
            // blob this fixes. The `as any` cast is what let a null through the
            // type checker.
            markersRef.current.push(userLocationMarker);
          } else {
            userLocationMarker.setLngLat(lngLat);
          }
        };
        navigator.geolocation.getCurrentPosition(updateUserMarker, () => {}, { enableHighAccuracy: true, timeout: 10000 });
        serveGeoWatchId.current = navigator.geolocation.watchPosition(updateUserMarker, () => {}, { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 });
      } catch { /* geolocation unavailable */ }
    }

    // Draw trail if route planned
    if (routeData && routeData.orderedIds.length > 1) {
      const coords: [number, number][] = routeData.orderedIds
        .map(id => jobs.find(j => j.id === id))
        .filter((j): j is ServeJob => !!j && j.recipient_lat != null && j.recipient_lng != null)
        .map(j => [j.recipient_lng!, j.recipient_lat!]);

      if (coords.length > 1 && mapRef.current) {
        const sourceId = 'serve-route-line';
        routeSourceRef.current = sourceId;
        mapRef.current.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
        });
        mapRef.current.addLayer({
          id: sourceId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': getThemeColorRgb('--rmpg-500-rgb'),
            'line-opacity': 0.8,
            'line-width': 3,
          },
        });
      }
    }
  }, [jobs, routeData, mapZoom, mapDeadlineFilter, selectedJobIds, fetchJobs]);

  useEffect(() => {
    if (mapReady) updateMapMarkers();
  }, [mapReady, updateMapMarkers]);

  // Fit bounds to the job set — deliberately its own effect, NOT folded into
  // updateMapMarkers above. updateMapMarkers is keyed on mapZoom (so it can
  // re-cluster as the user zooms), and the map's own 'zoomend' handler calls
  // setMapZoom on every camera change, including ones fitBounds itself causes.
  // Calling fitBounds from inside the mapZoom-keyed callback closes a loop:
  // zoom -> setMapZoom -> updateMapMarkers -> fitBounds -> zoomend -> setMapZoom
  // -> repeat, each pass nudging the view by a slightly different amount — the
  // map never settles and visibly vibrates. Keying this effect on the job set
  // instead (not mapZoom, not selectedJobIds) means fitBounds only runs when
  // the underlying data actually changes, matching the same fix already
  // applied to ServeIntakeMap.tsx's fit-bounds effect.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const mappable = jobs
      .filter((j) => j.recipient_lat != null && j.recipient_lng != null)
      .filter((j) => matchesDeadlineFilter(j.deadline, mapDeadlineFilter, Date.now(), j.status));
    if (mappable.length === 0) return;
    const bounds = new mapboxgl.LngLatBounds();
    for (const j of mappable) bounds.extend([j.recipient_lng!, j.recipient_lat!]);
    map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
  }, [mapReady, jobs, mapDeadlineFilter]);

  // Attempt-history trail overlay. Follows the hardened cleanup pattern: read
  // mapRef.current fresh inside the cleanup (not a closed-over `map`) and wrap
  // every Mapbox call in try/catch, since the map-init effect's cleanup can
  // null mapRef.current / tear down the style before this effect's own
  // cleanup runs on unmount.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const sourceId = 'srv-map-attempt-trail';
    const layerId = 'srv-map-attempt-trail-layer';

    const clearTrail = () => {
      const currentMap = mapRef.current;
      if (!currentMap) return;
      try {
        if (currentMap.getLayer(layerId)) currentMap.removeLayer(layerId);
        if (currentMap.getSource(sourceId)) currentMap.removeSource(sourceId);
      } catch { /* non-fatal — map/style already torn down */ }
    };

    if (trailJobId == null) { clearTrail(); return; }

    let cancelled = false;
    apiFetch<{ trail: Array<{ attempt_at: string; latitude: number; longitude: number; result: string }>; polyline: [number, number][] }>(
      `/process-server/${trailJobId}/gps-trail`,
    ).then((res) => {
      if (cancelled || res.polyline.length < 2) return;
      const currentMap = mapRef.current;
      if (!currentMap) return;
      clearTrail();
      try {
        currentMap.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: res.polyline } },
        });
        currentMap.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: { 'line-color': '#94a3b8', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.8 },
        });
      } catch { /* non-fatal — map/style torn down before this ran */ }
    }).catch(() => { /* non-fatal — trail stays hidden */ });

    return () => { cancelled = true; clearTrail(); };
  }, [trailJobId, mapReady]);

  // Single-stop drive-time preview. Same hardened cleanup pattern as the
  // trail effect above.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const sourceId = 'srv-map-drive-preview';
    const layerId = 'srv-map-drive-preview-layer';

    const clearPreview = () => {
      const currentMap = mapRef.current;
      if (!currentMap) return;
      try {
        if (currentMap.getLayer(layerId)) currentMap.removeLayer(layerId);
        if (currentMap.getSource(sourceId)) currentMap.removeSource(sourceId);
      } catch { /* non-fatal */ }
      setPreviewRoute(null);
    };

    if (!previewOrigin || !previewTarget) { clearPreview(); return; }

    let cancelled = false;
    fetchMapboxRoute(
      { lng: previewOrigin[0], lat: previewOrigin[1] },
      { lng: previewTarget.lng, lat: previewTarget.lat },
    ).then((route) => {
      if (cancelled || !route) return;
      const currentMap = mapRef.current;
      if (!currentMap) return;
      clearPreview();
      try {
        currentMap.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.geometry.map((p) => [p.lng, p.lat]) } },
        });
        currentMap.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: { 'line-color': '#22c55e', 'line-width': 3, 'line-opacity': 0.85 },
        });
        setPreviewRoute({ eta: route.eta, distance: route.distance });
      } catch { /* non-fatal */ }
    }).catch(() => { /* non-fatal — falls back to no preview */ });

    return () => { cancelled = true; clearPreview(); };
  }, [previewOrigin, previewTarget, mapReady]);

  const applyMapBulkStatus = async (status: 'served' | 'failed' | 'archived') => {
    if (selectedJobIds.size === 0) return;
    const confirmed = window.confirm(`Set ${selectedJobIds.size} job(s) to "${status}"?`);
    if (!confirmed) return;
    try {
      await apiFetch('/process-server/bulk-status', {
        method: 'PUT',
        body: JSON.stringify({ ids: Array.from(selectedJobIds), status }),
      });
      setSelectedJobIds(new Set());
      fetchJobs();
    } catch {
      window.alert('Bulk update failed. Selection preserved — please try again.');
    }
  };

  const handleMapExport = () => {
    const filtered = jobs
      .filter((j) => j.recipient_lat != null && j.recipient_lng != null)
      .filter((j) => matchesDeadlineFilter(j.deadline, mapDeadlineFilter, Date.now(), j.status));
    exportServeMapSheet(filtered.map((j) => ({
      id: j.id,
      recipient_name: j.recipient_name,
      recipient_address: j.recipient_address,
      priority: j.priority,
      deadline: j.deadline,
      status: j.status,
    }))).catch(() => { window.alert('Failed to export route sheet.'); });
  };

  // ══════════════════════════════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════════════════════════════

  // Set document title
  useEffect(() => { document.title = 'Process Server \u2014 RMPG Flex'; }, []);

  // Keyboard shortcuts:
  //   Esc \u2014 smart cascade: close the smallest open thing first so a single
  //         tap does not punch through every overlay. Order picks the most
  //         recently opened layer the operator is interacting with:
  //           delete confirm \u2192 log-attempt modal \u2192 edit-attempt modal \u2192
  //           skip-trace panel \u2192 route planner \u2192 create/edit job form.
  //   N   \u2014 open a new Add-Job form from anywhere on the page; suppressed
  //         when the user is actually typing into a field so a recipient
  //         name with "n" in it doesn't pop the dialog mid-type.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (deleteJob)       { e.stopPropagation(); setDeleteJob(null); return; }
        if (attemptJob)      { e.stopPropagation(); setAttemptJob(null); return; }
        if (editAttempt)     { e.stopPropagation(); setEditAttempt(null); return; }
        if (skipTraceJob)    { e.stopPropagation(); setSkipTraceJob(null); return; }
        if (routePlannerOpen){ e.stopPropagation(); setRoutePlannerOpen(false); return; }
        if (createJobOpen)   { e.stopPropagation(); setCreateJobOpen(false); setEditJob(null); clearFormDraft(); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if ((e.key === 'n' || e.key === 'N') && canManage) {
        // Suppress N when any modal is already open \u2014 the in-modal Tab/Enter
        // contract owns the focused element.
        if (deleteJob || attemptJob || editAttempt || skipTraceJob || routePlannerOpen || createJobOpen) return;
        e.preventDefault();
        openCreate();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteJob, attemptJob, editAttempt, skipTraceJob, routePlannerOpen, createJobOpen, clearFormDraft, openCreate]);

  // \u2500\u2500 Deep-link resolver \u2014 runs once jobs hydrate, then strips the params \u2500\u2500
  useEffect(() => {
    if (loading) return;
    if (jobs.length === 0) return; // wait one more cycle for hydration

    // ?job_id= / ?serve_id= \u2014 expand by numeric job id
    const jobTarget = pendingJobIdRef.current;
    if (jobTarget) {
      pendingJobIdRef.current = null;
      const hit = jobs.find((j) => String(j.id) === String(jobTarget));
      if (!hit) {
        addToast(`Serve job ${jobTarget} not in the current view (try clearing the date filter)`, 'warning');
      } else {
        setActiveTab('Queue');
        setExpandedJobId(hit.id);
      }
    }

    // ?case_id= \u2014 expand first job whose case_number matches
    const caseTarget = pendingCaseIdRef.current;
    if (caseTarget) {
      pendingCaseIdRef.current = null;
      const hit = jobs.find((j) => String(j.case_number) === String(caseTarget));
      if (!hit) {
        addToast(`No serve job found for case ${caseTarget} in the current view`, 'warning');
      } else {
        setActiveTab('Queue');
        setExpandedJobId(hit.id);
      }
    }

    const next = new URLSearchParams(searchParams);
    next.delete('job_id');
    next.delete('serve_id');
    next.delete('case_id');
    setSearchParams(next, { replace: true });
  }, [jobs, loading, searchParams, setSearchParams, addToast]);

  // Strip ?tab / ?status / ?date once consumed so a manual refresh does not
  // re-pin the operator to a stale filter.
  const consumedInitialParamsRef = useRef(false);
  useEffect(() => {
    if (consumedInitialParamsRef.current) return;
    consumedInitialParamsRef.current = true;
    const hasInitial = initialTabParam || initialStatusParam || initialDateParam;
    if (!hasInitial) return;
    const next = new URLSearchParams(searchParams);
    if (initialTabParam) next.delete('tab');
    if (initialStatusParam) next.delete('status');
    if (initialDateParam) next.delete('date');
    setSearchParams(next, { replace: true });
    // We intentionally don't depend on the param refs \u2014 this is a one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Build a Move-to-Folder submenu for a job ──
  const buildMoveSubmenu = (job: ServeJob): ContextMenuItem[] => {
    const currentFolder = deriveServeFolder(job);
    return (['in_progress', 'pending', 'served', 'failed', 'archived'] as ServeFolder[])
      .filter(f => f !== currentFolder)
      .map(f => m.action(`Move to ${SERVE_FOLDER_CONFIG[f].label}`, () => handleMoveToFolder(job, f), { icon: <FolderOpen size={11} /> }));
  };

  // ── Build a serve-job row context menu ──
  const buildJobMenu = (job: ServeJob): ContextMenuItem[] => {
    const addr = [job.recipient_address, job.recipient_address_2, job.recipient_city, job.recipient_state, job.recipient_zip]
      .filter(Boolean).join(', ');
    const isClosed = job.status === 'served' || job.status === 'failed' || job.status === 'archived';
    return [
      m.action('Open / expand', () => setExpandedJobId(prev => prev === job.id ? null : job.id), { icon: <Eye size={12} /> }),
      ...(canManage ? [m.action('Edit job', () => openEdit(job.id), { icon: <Pencil size={12} /> })] : []),
      ...(canManage ? [m.action('Clone job', () => handleCloneJob(job.id), { icon: <Copy size={12} /> })] : []),
      ...(isClosed ? [] : [m.action('Log attempt', () => setAttemptJob(job), { icon: <ClipboardCheck size={12} /> })]),
      m.action('Print Job Sheet (PS-300)', () => handleJobSheet(job.id), { icon: <Printer size={12} /> }),
      m.action('Print Leave-Behind (PS-314)', () => handleLeaveBehind(job.id), { icon: <ScrollText size={12} /> }),
      ...(job.attempt_count > 0 && job.status !== 'served' ? [
        m.action('Preview Notice of Attempt', () => setNoticePreviewJobId(job.id), { icon: <FileWarning size={12} /> }),
        m.action('Edit Notice before print', () => handleNoticeOfAttempt(job.id, true), { icon: <Pencil size={12} /> }),
      ] : []),
      ...(job.status === 'served' ? [
        m.action('Affidavit of Service', () => handleAffidavitOfService(job.id), { icon: <FileSignature size={12} /> }),
      ] : []),
      ...(job.attempt_count > 0 && job.status !== 'served' ? [
        m.action('Affidavit of Non-Service', () => handleAffidavitOfNonService(job.id), { icon: <ScrollText size={12} /> }),
      ] : []),
      // Manage Attempts submenu — edit or delete individual attempts
      ...(job.attempt_count > 0 && Array.isArray(job.attempts) ? [{
        label: 'Manage Attempts', icon: <ClipboardCheck size={12} />,
        submenu: [
          ...(job.attempts as ServeAttempt[]).map((attempt, i) => [
            m.action(`Edit Attempt #${attempt.attempt_number || i + 1}`, () => setEditAttempt({ jobId: job.id, attempt }), { icon: <Pencil size={11} /> }),
            ...(canManage ? [
              m.action(`Delete Attempt #${attempt.attempt_number || i + 1}`, () => handleDeleteAttempt(job.id, attempt), {
                icon: <Trash2 size={11} />, danger: true,
              }),
            ] : []),
          ]).flat(),
        ].filter(Boolean),
      } as ContextMenuItem] : []),
      m.action('Skip trace', () => setSkipTraceJob(job), { icon: <SearchIcon size={12} /> }),
      // Build a Move-to-Folder submenu for this job.
      ...(buildMoveSubmenu(job).length > 0
        ? [{ label: 'Move to…', icon: <FolderOpen size={12} />, submenu: buildMoveSubmenu(job) } as ContextMenuItem]
        : []),
      m.action('Add to route', () => {
        setSelectedJobIds(prev => new Set(prev).add(job.id));
        setRoutePlannerOpen(true);
      }, { icon: <Route size={12} /> }),
      m.separator(),
      m.copy('Copy recipient', job.recipient_name),
      m.copyId(job.id),
      m.copyCoords(job.recipient_lat, job.recipient_lng),
      ...(addr ? [m.action('Navigate to address', () => handleNavigate(job.id), { icon: <Navigation size={12} /> })] : []),
      m.separator(),
      m.action('Flag bad address', () => handleFlagAddress(job.id), { icon: <AlertTriangle size={12} />, danger: true }),
      ...(canDelete ? [
        m.action('Delete job', () => handleDeleteJob(job), { icon: <Trash2 size={12} />, danger: true }),
      ] : []),
    ].filter(Boolean) as ContextMenuItem[];
  };

  // ── Map-only context menus: cluster markers and the user-location dot ──
  const buildClusterMenu = (cluster: { lng: number; lat: number; count: number; itemIds: number[] }): ContextMenuItem[] => [
    m.action('Expand cluster', () => {
      mapRef.current?.easeTo({ center: [cluster.lng, cluster.lat], zoom: mapZoom + 2 });
    }, { icon: <Eye size={12} /> }),
    m.action('Add all to route', () => {
      setSelectedJobIds(prev => {
        const next = new Set(prev);
        cluster.itemIds.forEach(id => next.add(id));
        return next;
      });
      setRoutePlannerOpen(true);
    }, { icon: <Route size={12} /> }),
    m.separator(),
    m.copy('Copy job count', cluster.count),
  ];

  const buildLocationMenu = (lngLat: [number, number]): ContextMenuItem[] => [
    m.copyCoords(lngLat[1], lngLat[0]),
    m.action('Set as route start', () => setPreviewOrigin(lngLat), { icon: <Route size={12} /> }),
    m.action('Center map here', () => mapRef.current?.easeTo({ center: lngLat }), { icon: <MapPin size={12} /> }),
  ];

  return (
    <div className="flex flex-col h-full bg-surface-base" role="main">
      {fetchError && (
        <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 rounded-[2px] text-red-400 text-xs flex items-center gap-2 animate-in fade-in duration-200">
          <AlertTriangle size={12} className="flex-shrink-0" aria-hidden="true" />
          <span>{fetchError}</span>
          <button type="button" onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300 transition-colors" aria-label="Dismiss error">
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}
      {/* ─── Header Bar ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-surface-raised flex-wrap" role="toolbar" aria-label="Process Server controls">
        <div className="flex items-center gap-2">
          <Briefcase size={16} style={{ color: 'var(--panel-header-color)' }} />
          {!isMobile && (
            <span className="text-sm font-semibold tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
              PROCESS SERVER
            </span>
          )}
        </div>

        {/* Date picker + route stats */}
        <div className="flex items-center gap-1 ml-auto sm:ml-2">
          <Calendar size={14} className="text-rmpg-400" />
          <input id="ff-servepage-0"
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="px-2 py-1 text-xs bg-surface-raised border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
          />
          {/* Route stats inline (Step 3.5) */}
          {savedRoute && savedRoute.optimized_order_json && (() => {
            const orderIds: number[] = (() => {
              try {
                return typeof savedRoute.optimized_order_json === 'string'
                  ? JSON.parse(savedRoute.optimized_order_json)
                  : savedRoute.optimized_order_json;
              } catch { return []; }
            })();
            const stopCount = orderIds.length;
            const dist = savedRoute.total_distance_miles;
            const mins = savedRoute.total_time_minutes;
            if (stopCount === 0) return null;
            return (
              <span className="font-mono tabular-nums text-[10px] ml-1.5 px-1.5 py-0.5 rounded-[2px] text-accent-silver-400 border border-border-subtle bg-surface-sunken">
                {stopCount} stops
                {dist ? ` / ${Number(dist).toFixed(0)} mi` : ''}
                {mins ? ` / ~${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m` : ''}
              </span>
            );
          })()}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          <button type="button"
            onClick={() => setRoutePlannerOpen(true)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-rmpg-400 bg-surface-sunken/20 hover:bg-surface-sunken/40 border border-border-default/40 rounded-[2px] transition-all duration-150 hover:shadow-[0_0_8px_rgba(136, 136, 136,0.15)] focus:outline-none focus:ring-1 focus:ring-rmpg-500/50"
            title="Plan Route"
            aria-label="Plan Route"
          >
            <Route size={12} />
            {!isMobile && 'Plan Route'}
          </button>
          <button type="button"
            onClick={handleSyncFromSM}
            disabled={syncing}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-rmpg-400 bg-surface-sunken/20 hover:bg-surface-sunken/40 border border-border-default/40 rounded-[2px] transition-all duration-150 disabled:opacity-40 hover:shadow-[0_0_8px_rgba(34,211,238,0.15)] focus:outline-none focus:ring-1 focus:ring-rmpg-500/50"
            title="Sync from ServeManager"
            aria-label="Sync from ServeManager"
          >
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {!isMobile && 'Sync from SM'}
          </button>
          {canManage && (
          <button type="button"
            onClick={openCreate}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-green-400 bg-green-900/20 hover:bg-green-900/40 border border-green-700/40 rounded-[2px] transition-all duration-150 hover:shadow-[0_0_8px_rgba(34,197,94,0.15)] focus:outline-none focus:ring-1 focus:ring-green-500/50"
            title="Add Job (N)"
            aria-label="Add serve job"
          >
            <Plus size={12} />
            {!isMobile && 'Add Job'}
          </button>
          )}
          <ExportButton exportUrl="/api/process-server/export/csv" exportFilename="serve-jobs.csv" />
          {['admin', 'manager'].includes(user?.role ?? '') && (
            <button type="button"
              onClick={() => routerNavigate('/admin?tab=servemanager')}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-fg-muted bg-surface-sunken/20 hover:bg-surface-sunken/40 border border-border-default/40 rounded-[2px] transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-rmpg-500/50"
              title="Process Server & ServeManager setup"
              aria-label="Process Server setup"
            >
              <Settings size={12} />
              {!isMobile && 'Setup'}
            </button>
          )}
        </div>
      </div>

      {/* ─── Tab Bar ───────────────────────────────────────────────── */}
      <div className="border-b border-border-subtle bg-surface-sunken">
        <div className="flex items-center gap-1 px-2 overflow-x-auto tab-scroll" role="tablist" aria-label="Field views">
          {!isMobile && (
            <span className="text-[9px] font-semibold uppercase tracking-wider px-2 shrink-0" style={{ color: 'var(--field-label-color)' }}>
              Field
            </span>
          )}
          {FIELD_TABS.map(tab => {
            const Icon =
              tab === 'Queue' ? List :
              tab === 'My Run' ? Users :
              tab === 'Route' ? Route :
              MapIcon;
            return (
              <button type="button"
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={serveTabClass(activeTab === tab)}
              >
                <Icon size={13} />
                {tab}
                {tab === 'Queue' && overdueCount > 0 && (
                  <span className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-0.5 text-[8px] font-bold bg-red-600 text-white rounded-[2px]">
                    {overdueCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1 px-2 border-t border-border-subtle overflow-x-auto tab-scroll" role="tablist" aria-label="Records views">
          {!isMobile && (
            <span className="text-[9px] font-semibold uppercase tracking-wider px-2 shrink-0" style={{ color: 'var(--field-label-color)' }}>
              Records
            </span>
          )}
          {RECORDS_TABS.filter(tab => serveTabVisible(tab, user?.role ?? '')).map(tab => {
            const Icon =
              tab === 'Subject File' ? FolderOpen :
              tab === 'Stats' ? BarChart3 :
              tab === 'Assign' ? ClipboardCheck :
              tab === 'Performance' ? Gauge :
              tab === 'Analytics' ? LineChart :
              DollarSign;
            return (
              <button type="button"
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={serveTabClass(activeTab === tab)}
              >
                <Icon size={13} />
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Tab Content ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {/* ── Queue Tab ───────────────────────────────────────────── */}
        {activeTab === 'Queue' && (
          <div className="h-full flex flex-col">
            {/* Filter buttons */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border-subtle bg-surface-raised overflow-x-auto tab-scroll">
              {/* Search box. The filter it drives (recipient / case # / client /
                  address, see filteredJobs) was fully implemented but had NO
                  input bound to it anywhere — searchQuery could only ever be
                  '' or be cleared, so that whole branch was unreachable. This
                  is the missing surface, not new filtering logic. */}
              <div className="relative flex-shrink-0">
                <SearchIcon
                  size={11}
                  aria-hidden="true"
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name, case #, client, address, city…"
                  aria-label="Search serve jobs"
                  className="w-56 pl-6 pr-6 py-1 text-[11px] rounded-[2px] bg-surface-sunken border border-rmpg-600 text-rmpg-100 placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-rmpg-400/50 focus:border-rmpg-400"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-fg-muted hover:text-rmpg-200"
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                )}
              </div>
              {searchQuery.trim() && (
                <span className="text-[10px] text-fg-muted tabular-nums whitespace-nowrap flex-shrink-0">
                  {filteredJobs.length} match{filteredJobs.length === 1 ? '' : 'es'}
                </span>
              )}
              {STATUS_FILTERS.map(f => (
                <button type="button"
                  key={f.value}
                  role="button"
                  aria-pressed={statusFilter === f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-[2px] border transition-all duration-150 whitespace-nowrap focus:outline-none focus:ring-1 focus:ring-rmpg-500/50 ${
                    statusFilter === f.value
                      ? 'text-rmpg-100 bg-rmpg-500 border-rmpg-500 shadow-[0_0_6px_rgb(var(--accent-silver-400-rgb)/0.3)]'
                      : 'text-rmpg-400 bg-transparent border-rmpg-600 hover:border-rmpg-400 hover:text-rmpg-200'
                  }`}
                >
                  {f.label}
                  {f.value !== 'all' && (
                    <span className="ml-1 text-[10px] tabular-nums font-mono text-rmpg-500">
                      {jobs.filter(j => j.status === f.value).length}
                    </span>
                  )}
                </button>
              ))}
              {/* Feature 33: Serve-type filter */}
              <select
                value={serveTypeFilter}
                onChange={e => setServeTypeFilter(e.target.value)}
                aria-label="Filter by serve type"
                className="px-2 py-1 text-[11px] rounded-[2px] bg-surface-sunken border border-rmpg-600 text-rmpg-300 focus:outline-none focus:ring-1 focus:ring-rmpg-400/50 focus:border-rmpg-400"
              >
                <option value="all">All Types</option>
                {SERVE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>

              {/* Feature 1: Priority Sort Toggle */}
              <button type="button"
                role="button"
                aria-pressed={sortByUrgency}
                onClick={() => setSortByUrgency(prev => !prev)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-[2px] border transition-all duration-150 whitespace-nowrap ml-auto focus:outline-none focus:ring-1 focus:ring-amber-500/50 ${
                  sortByUrgency
                    ? 'text-amber-400 bg-amber-900/30 border-amber-600'
                    : 'text-rmpg-400 bg-transparent border-rmpg-600 hover:border-rmpg-400 hover:text-rmpg-200'
                }`}
                title="Sort by deadline urgency"
              >
                <span className="inline-flex items-center gap-1">
                  {sortByUrgency
                    ? (<><Zap size={11} aria-hidden="true" /> Urgent</>)
                    : (<><ArrowUpDown size={11} aria-hidden="true" /> Sort</>)}
                </span>
              </button>
            </div>

            {/* [22] Aging alert banner — jobs at risk of missing deadline */}
            {agingJobs.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-amber-700/40 bg-amber-900/20 text-[10px]">
                <AlertTriangle size={11} className="text-amber-400 flex-shrink-0" />
                <span className="text-amber-300 font-bold">
                  {agingJobs.length} job{agingJobs.length === 1 ? '' : 's'} approaching deadline with no recent attempt —{' '}
                  {agingJobs.slice(0, 2).map((j) => j.recipient_name).join(', ')}
                  {agingJobs.length > 2 ? ` +${agingJobs.length - 2} more` : ''}
                </span>
              </div>
            )}

            {/* [30] Attorney filter + [21] Bulk deadline button */}
            <div className="flex items-center gap-2 px-3 py-1 border-b border-rmpg-700/30 bg-surface-sunken/20">
              <input
                type="search"
                value={attorneyFilter}
                onChange={(e) => setAttorneyFilter(e.target.value)}
                placeholder="Filter by attorney / client name…"
                aria-label="Filter by attorney or client"
                className="flex-1 px-2 py-0.5 text-[10px] rounded-[2px] bg-surface-sunken border border-rmpg-600 text-rmpg-100 placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-rmpg-400/50"
              />
              {selectedJobIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setBulkDeadlineOpen(true)}
                  className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-amber-300 bg-amber-900/30 border border-amber-700/50 rounded-[2px] hover:bg-amber-900/50 transition-colors whitespace-nowrap"
                >
                  <Calendar size={10} />
                  Extend Deadline ({selectedJobIds.size})
                </button>
              )}
            </div>

            {/* [21] Bulk deadline extension modal */}
            {bulkDeadlineOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                <div className="bg-surface-base border border-rmpg-700 rounded-[2px] p-4 w-80 space-y-3 shadow-xl">
                  <h2 className="text-[11px] font-bold text-rmpg-100 uppercase tracking-wider">
                    Extend Deadline — {selectedJobIds.size} job{selectedJobIds.size === 1 ? '' : 's'}
                  </h2>
                  <label className="block text-[10px] text-fg-secondary">
                    New deadline date
                    <input
                      type="date"
                      value={bulkDeadlineDate}
                      onChange={(e) => setBulkDeadlineDate(e.target.value)}
                      min={new Date().toISOString().slice(0, 10)}
                      className="mt-1 block w-full px-2 py-1 text-[10px] bg-surface-sunken border border-rmpg-600 rounded-[2px] text-rmpg-100 focus:outline-none focus:ring-1 focus:ring-rmpg-400/50"
                    />
                  </label>
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => { setBulkDeadlineOpen(false); setBulkDeadlineDate(''); }}
                      className="px-3 py-1 text-[10px] text-fg-muted border border-rmpg-600 rounded-[2px] hover:border-rmpg-400 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!bulkDeadlineDate || bulkDeadlineSubmitting}
                      onClick={async () => {
                        if (!bulkDeadlineDate) return;
                        setBulkDeadlineSubmitting(true);
                        try {
                          await apiFetch('/serve/bulk-deadline', {
                            method: 'PATCH',
                            body: JSON.stringify({ ids: [...selectedJobIds], deadline: bulkDeadlineDate }),
                          });
                          setBulkDeadlineOpen(false);
                          setBulkDeadlineDate('');
                          fetchJobs();
                        } catch {
                          addToast('Could not update deadline — please try again', 'error');
                        } finally {
                          setBulkDeadlineSubmitting(false);
                        }
                      }}
                      className="px-3 py-1 text-[10px] font-bold text-amber-300 bg-amber-900/40 border border-amber-700/50 rounded-[2px] hover:bg-amber-900/60 disabled:opacity-40 transition-colors"
                    >
                      {bulkDeadlineSubmitting ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Feature 32+34: Fee total and diligence warning strip */}
            {(filteredFeeTotal > 0 || diligenceCount > 0) && (
              <div className="flex items-center gap-3 px-3 py-1 border-b border-rmpg-700/50 bg-surface-sunken/40 text-[10px]">
                {filteredFeeTotal > 0 && (
                  <span className="text-green-300 font-mono tabular-nums">
                    Fee total: ${filteredFeeTotal.toFixed(2)}
                  </span>
                )}
                {diligenceCount > 0 && (
                  <span className="text-amber-400 font-bold">
                    {diligenceCount} job{diligenceCount === 1 ? '' : 's'} require due diligence
                  </span>
                )}
              </div>
            )}

            {/* Urgency legend */}
            {sortByUrgency && filteredJobs.length > 0 && (
              <div className="px-3 py-1 border-b border-rmpg-700 flex items-center gap-3 text-[9px] text-rmpg-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Overdue</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" /> {'<'}24h</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> {'<'}3d</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rmpg-500 inline-block" /> {'<'}7d</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> 7d+</span>
              </div>
            )}

            {/* Job list / Folder view */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3 scrollbar-dark">
              {loading && jobs.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-xs text-rmpg-400">
                  <Loader2 size={16} className="animate-spin mr-2 text-rmpg-500" />
                  <span className="text-rmpg-400">Loading jobs...</span>
                </div>
              ) : viewMode === 'folders' ? (
                /* ── FOLDER VIEW ─────────────────────────────────── */
                <div className="space-y-2">
                  {jobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-center">
                      <div className="w-12 h-12 rounded-full bg-surface-sunken flex items-center justify-center mb-3">
                        <Briefcase size={20} className="text-rmpg-500" />
                      </div>
                      <p className="text-sm text-rmpg-400 font-medium">
                        No jobs for {selectedDate}. Sync from ServeManager, press <kbd className="px-1 py-0.5 bg-surface-sunken border border-rmpg-700 rounded-[2px] text-[10px]">N</kbd>, or add manually.
                      </p>
                    </div>
                  ) : (
                    (['in_progress', 'pending', 'served', 'failed', 'archived'] as ServeFolder[]).map(folder => {
                      const cfg = SERVE_FOLDER_CONFIG[folder];
                      const folderJobs = jobsByFolder[folder];
                      return (
                        <ServeStatusFolder
                          key={folder}
                          status={folder}
                          label={cfg.label}
                          defaultOpen={cfg.defaultOpen}
                          count={folderJobs.length}
                          forceOpen={allFoldersOpen}
                        >
                          {folderJobs.map(job => (
                            <div key={job.id} onContextMenu={(e) => openMenu(e, buildJobMenu(job))}>
                              <ServeJobCard
                                job={job}
                                linkedCall={linkedCalls[job.id] || null}
                                onAttempt={(id) => { const j = jobs.find(jj => jj.id === id); if (j) setAttemptJob(j); }}
                                onNavigate={handleNavigate}
                                onSkipTrace={(id) => { const j = jobs.find(jj => jj.id === id); if (j) setSkipTraceJob(j); }}
                                onFlagAddress={handleFlagAddress}
                                onEdit={openEdit}
                                onEditAttempt={(jobId, attempt) => setEditAttempt({ jobId, attempt })}
                                onAudit={setAuditJobId}
                                isExpanded={expandedJobId === job.id}
                                onToggleExpand={() => setExpandedJobId(prev => prev === job.id ? null : job.id)}
                                isSelected={selectedJobIds.has(job.id)}
                                onToggleSelect={() => setSelectedJobIds(prev => { const next = new Set(prev); if (next.has(job.id)) next.delete(job.id); else next.add(job.id); return next; })}
                              />
                            </div>
                          ))}
                        </ServeStatusFolder>
                      );
                    })
                  )}
                </div>
              ) : (
                /* ── FLAT LIST VIEW (legacy) ─────────────────────── */
                <div className="space-y-2">
                  {filteredJobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-center">
                      <div className="w-12 h-12 rounded-full bg-surface-sunken flex items-center justify-center mb-3">
                        <Briefcase size={20} className="text-rmpg-500" />
                      </div>
                      {jobs.length > 0 ? (
                        <>
                          <p className="text-sm text-rmpg-400 font-medium">
                            {searchQuery ? `No jobs match "${searchQuery}"` : `No ${toDisplayLabel(statusFilter)} jobs.`}
                          </p>
                          <button type="button" onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
                            className="mt-2 text-[11px] text-brand-400 hover:text-brand-300 underline underline-offset-2">
                            Clear filters — show all {jobs.length} job{jobs.length === 1 ? '' : 's'}
                          </button>
                        </>
                      ) : (
                        <p className="text-sm text-rmpg-400 font-medium">
                          No jobs for {selectedDate}.
                        </p>
                      )}
                    </div>
                  ) : (
                    filteredJobs.map(job => (
                      <div key={job.id} onContextMenu={(e) => openMenu(e, buildJobMenu(job))}>
                        <ServeJobCard
                          job={job}
                          linkedCall={linkedCalls[job.id] || null}
                          onAttempt={(id) => { const j = jobs.find(jj => jj.id === id); if (j) setAttemptJob(j); }}
                          onNavigate={handleNavigate}
                          onSkipTrace={(id) => { const j = jobs.find(jj => jj.id === id); if (j) setSkipTraceJob(j); }}
                          onFlagAddress={handleFlagAddress}
                          onEdit={openEdit}
                          onEditAttempt={(jobId, attempt) => setEditAttempt({ jobId, attempt })}
                          onAudit={setAuditJobId}
                          isExpanded={expandedJobId === job.id}
                          onToggleExpand={() => setExpandedJobId(prev => prev === job.id ? null : job.id)}
                          isSelected={selectedJobIds.has(job.id)}
                          onToggleSelect={() => setSelectedJobIds(prev => { const next = new Set(prev); if (next.has(job.id)) next.delete(job.id); else next.add(job.id); return next; })}
                        />
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Route Tab (Step 3.4) ──────────────────────────────── */}
        {activeTab === 'Route' && (
          <div className="h-full overflow-y-auto p-4 space-y-4 scrollbar-dark">
            {/* Use routeData as an immediate fallback before savedRoute arrives from DB */}
            {(savedRoute?.optimized_order_json || routeData) ? (() => {
              const orderIds: number[] = (() => {
                if (savedRoute?.optimized_order_json) {
                  try {
                    return typeof savedRoute.optimized_order_json === 'string'
                      ? JSON.parse(savedRoute.optimized_order_json)
                      : savedRoute.optimized_order_json;
                  } catch { /* fall through to routeData */ }
                }
                return routeData?.orderedIds ?? [];
              })();
              const routeJobs = orderIds
                .map(id => jobs.find(j => j.id === id))
                .filter((j): j is ServeJob => !!j);
              const completedCount = routeJobs.filter(j => j.status === 'served').length;
              const totalStops = routeJobs.length;
              const progressPct = totalStops > 0 ? Math.round((completedCount / totalStops) * 100) : 0;

              // Per-stop ETAs walk the saved visit order (not nearest-neighbor).
              const routeStartMs = (() => {
                const t = savedRoute?.planned_start_time;
                const d = savedRoute?.route_date;
                if (t && d && /^\d{2}:\d{2}$/.test(t)) {
                  const [h, m] = t.split(':').map(Number);
                  const dt = new Date(d + 'T00:00:00'); // new-date-ok — local-time parse intentional
                  dt.setHours(h, m, 0, 0);
                  return dt.getTime();
                }
                return Date.now(); // new-date-ok — fallback to now when no saved start
              })();
              const stopEtas: Map<number, number> = (() => {
                const geocoded = routeJobs.filter(j => j.recipient_lat != null && j.recipient_lng != null);
                if (geocoded.length < 1) return new Map<number, number>();
                const stopItems = geocoded.map((j, i) => ({ job: j, selected: true, order: i }));
                const origin = savedRoute?.start_lat != null && savedRoute?.start_lng != null
                  ? { lat: Number(savedRoute.start_lat), lng: Number(savedRoute.start_lng) }
                  : null;
                return computeArrivalsInOrder(stopItems, origin, routeStartMs, savedRoute?.route_date).arrivals;
              })();
              const eveningOnRun = routeJobs.some(j => hasEveningWindow(j.time_window, j.next_attempt_window));

              return (
                <>
                  {/* Stats bar */}
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-4 sm:flex-wrap px-3 py-2.5 bg-surface-sunken border border-rmpg-700 rounded-[2px]" role="status" aria-label="Route statistics">
                    <div className="flex items-center gap-1.5 text-fg-secondary text-xs">
                      <MapPin size={12} className="text-fg-secondary" />
                      <span className="font-mono tabular-nums text-rmpg-100">{totalStops}</span>
                      <span>stops</span>
                    </div>
                    {(() => {
                      const distMiles = savedRoute?.total_distance_miles ?? routeData?.totalDistance ?? null;
                      const timeMins = savedRoute?.total_time_minutes ?? routeData?.totalDuration ?? null;
                      return (
                        <>
                          <div className="flex items-center gap-1.5 text-fg-secondary text-xs">
                            <Navigation size={12} className="text-emerald-400" />
                            <span className="font-mono tabular-nums text-rmpg-100">
                              {distMiles != null && !isNaN(Number(distMiles)) ? `${Number(distMiles).toFixed(1)} mi` : '--'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-fg-secondary text-xs">
                            <Calendar size={12} className="text-amber-400" />
                            <span className="font-mono tabular-nums text-rmpg-100">
                              {timeMins != null && !isNaN(Number(timeMins))
                                ? `~${Math.floor(Number(timeMins) / 60)}h ${Math.round(Number(timeMins) % 60)}m`
                                : '--'}
                            </span>
                          </div>
                          {distMiles != null && !isNaN(Number(distMiles)) && Number(distMiles) > 0 && (
                            <div className="flex items-center gap-1.5 text-fg-secondary text-xs">
                              <span className="text-[color:var(--field-label-color)] font-mono">$</span>
                              <span className="font-mono tabular-nums text-rmpg-100">
                                ${(Number(distMiles) * serveMileageRate).toFixed(2)}
                              </span>
                              <span className="text-fg-muted text-[9px]">fuel</span>
                            </div>
                          )}
                          {distMiles != null && !isNaN(Number(distMiles)) && gallonsForMiles(Number(distMiles)) > 0 && (
                            <div className="flex items-center gap-1.5 text-fg-secondary text-xs">
                              <span className="text-fg-muted text-[9px]">est.</span>
                              <span className="font-mono tabular-nums text-rmpg-100">
                                {gallonsForMiles(Number(distMiles)).toFixed(1)} gal
                              </span>
                              <span className="text-fg-muted text-[9px]">@ 18 mpg</span>
                            </div>
                          )}
                          {distMiles != null && !isNaN(Number(distMiles)) && Number(distMiles) > 0 && totalStops > 0 && (
                            <div className="flex items-center gap-1.5 text-fg-secondary text-xs">
                              <Gauge size={11} className="text-fg-muted" />
                              <span className="font-mono tabular-nums text-rmpg-100">
                                {(totalStops / Number(distMiles)).toFixed(1)}
                              </span>
                              <span className="text-fg-muted text-[9px]">stops/mi</span>
                            </div>
                          )}
                        </>
                      );
                    })()}
                    <div className="flex items-center gap-1.5 text-fg-secondary text-xs sm:ml-auto col-span-2 sm:col-span-1">
                      <span className="font-mono tabular-nums text-[color:var(--field-label-color)]">
                        {completedCount}/{totalStops} done ({progressPct}%)
                      </span>
                    </div>
                  </div>

                  {eveningOnRun && (
                    <div className="px-3 py-2 text-[10px] text-purple-300 bg-purple-900/20 border border-purple-700/40 rounded-[2px]">
                      Evening-window stops (17:00–21:00) are on this run — plan lighting, gated access, and a last knock before 21:00.
                    </div>
                  )}

                  {/* Progress bar */}
                  <div className="w-full h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${progressPct === 100 ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.25)]' : 'bg-brand-400 shadow-[0_0_6px_var(--brand-gold-glow,rgb(var(--accent-silver-400-rgb)/0.25))]'}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  {/* Route status filter */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {STATUS_FILTERS.map(f => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setRouteStatusFilter(f.value)}
                        className={`px-2 py-1 text-[10px] border border-border-subtle rounded-[2px] ${routeStatusFilter === f.value ? 'bg-rmpg-700 text-white' : 'bg-surface-sunken text-fg-muted'}`}
                      >
                        {f.label}
                        {f.value !== 'all' && (
                          <span className="ml-1 font-mono tabular-nums text-rmpg-500">
                            {routeJobs.filter(j => j.status === f.value).length}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Ordered stop list */}
                  <div className="space-y-1">
                    {(routeStatusFilter === 'all' ? routeJobs : routeJobs.filter(j => j.status === routeStatusFilter)).map((job, idx) => {
                      const isCompleted = job.status === 'served';
                      const isFailed = job.status === 'failed';
                      const deadlineDate = job.deadline ? parseTimestamp(job.deadline) : null;
                      const isOverdue = deadlineDate && deadlineDate < new Date(); // new-date-ok — wall-clock comparison
                      const priorityColors: Record<string, string> = {
                        urgent: 'bg-red-900/40 text-red-400 border-red-700/50',
                        rush: 'bg-orange-900/40 text-orange-400 border-orange-700/50',
                        normal: 'bg-rmpg-800/40 text-fg-secondary border-rmpg-700/50',
                        routine: 'bg-rmpg-800/30 text-fg-muted border-rmpg-700/30',
                      };
                      const twColors: Record<string, string> = {
                        morning: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
                        afternoon: 'bg-surface-sunken/40 text-fg-secondary border-border-default/50',
                        evening: 'bg-purple-900/40 text-purple-400 border-purple-700/50',
                        anytime: 'bg-rmpg-800/40 text-fg-secondary border-rmpg-700/50',
                      };
                      return (
                        <div
                          key={job.id}
                          className={`flex items-start gap-2.5 px-3 py-2.5 rounded-[2px] border transition-all duration-150 ${
                            isCompleted
                              ? 'bg-green-900/10 border-green-800/30 opacity-60'
                              : isFailed
                                ? 'bg-red-900/10 border-red-800/30 opacity-60'
                                : 'bg-surface-raised border-rmpg-700 hover:border-rmpg-500/40'
                          }`}
                        >
                          {/* Stop number */}
                          <span
                            className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold text-rmpg-100 flex-shrink-0 mt-0.5 ${
                              isCompleted ? 'bg-green-500' : isFailed ? 'bg-red-500' : job.status === 'in_progress' ? 'bg-amber-500' : 'bg-rmpg-500'
                            }`}
                          >
                            {idx + 1}
                          </span>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                              <span className={`text-xs font-medium truncate ${isCompleted ? 'text-fg-muted line-through' : 'text-rmpg-100'}`}>
                                {job.recipient_name}
                              </span>
                              {job.priority && job.priority !== 'normal' && (
                                <span className={`text-[9px] px-1 py-0.5 rounded-[2px] border font-mono uppercase flex-shrink-0 ${priorityColors[job.priority] ?? priorityColors.normal}`}>
                                  {job.priority}
                                </span>
                              )}
                              {job.time_window && job.time_window !== 'anytime' && (
                                <span className={`text-[9px] px-1 py-0.5 rounded-[2px] border font-mono flex-shrink-0 ${twColors[job.time_window] ?? twColors.anytime}`}>
                                  {job.time_window}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-fg-muted truncate">
                              {job.recipient_address || 'No address'}
                              {job.recipient_address_2 ? `, ${job.recipient_address_2}` : ''}
                              {job.recipient_city ? `, ${job.recipient_city}` : ''}
                            </div>
                            {stopEtas.has(job.id) && (
                              <div className={`text-[9px] font-mono mt-0.5 ${isCompleted ? 'text-fg-muted' : 'text-fg-secondary'}`}>
                                ETA {new Date(stopEtas.get(job.id)!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} {/* new-date-ok — epoch ms */}
                              </div>
                            )}
                            {optimization.status === 'complete' && optimization.solution && (() => {
                              const v2Route = optimization.solution.routes[0];
                              if (!v2Route) return null;
                              const v2Stop = v2Route.stops.find(
                                st => st.location === String(job.id) && st.type === 'service',
                              );
                              if (!v2Stop) return null;
                              const eta = new Date(v2Stop.eta); // new-date-ok — ISO from API
                              const timeStr = eta.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                              const isLate = v2Stop.wait != null && v2Stop.wait < 0;
                              return (
                                <div className={`text-[9px] font-mono mt-0.5 flex items-center gap-0.5 ${isLate ? 'text-amber-400' : 'text-rmpg-300'}`}>
                                  V2 ETA {timeStr}{isLate ? ' ⚠' : ''}
                                </div>
                              );
                            })()}
                            {deadlineDate && (
                              <div className={`text-[9px] font-mono mt-0.5 ${isOverdue ? 'text-red-400' : 'text-fg-muted'}`}>
                                {isOverdue ? '⚠ ' : ''}Deadline: {deadlineDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} {/* new-date-ok — from DB */}
                                {(() => {
                                  const hrs = hoursUntilDeadline(job.deadline);
                                  if (hrs == null) return null;
                                  return <span className="ml-1">({hrs < 0 ? `${Math.abs(Math.round(hrs))}h past` : `${hrs < 10 ? hrs.toFixed(1) : Math.round(hrs)}h left`})</span>;
                                })()}
                              </div>
                            )}
                            {(job.building_access_notes || job.contact_restrictions) && (
                              <div className="text-[9px] text-amber-300/90 truncate mt-0.5" title={[job.contact_restrictions, job.building_access_notes].filter(Boolean).join(' · ')}>
                                {job.contact_restrictions ? `Restrict: ${job.contact_restrictions}` : job.building_access_notes}
                              </div>
                            )}
                            {(job as any).case_number && (
                              <div className="text-[9px] text-fg-muted font-mono mt-0.5">
                                Case #{(job as any).case_number}
                              </div>
                            )}
                          </div>

                          {/* Right side: status + navigate */}
                          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                            <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded-[2px] border ${
                              isCompleted
                                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                : isFailed
                                  ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                  : job.status === 'in_progress'
                                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                    : 'bg-rmpg-500/10 text-fg-secondary border-rmpg-500/20'
                            }`}>
                              {toDisplayLabel(job.status)}
                            </span>
                            {!isCompleted && !isFailed && (job.recipient_lat != null || job.recipient_address) && (
                              <button
                                type="button"
                                onClick={() => handleNavigate(job.id)}
                                className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono text-emerald-400 bg-emerald-900/20 border border-emerald-700/40 rounded-[2px] hover:bg-emerald-900/40 transition-colors"
                                aria-label={`Navigate to ${job.recipient_name}`}
                              >
                                <Navigation size={9} /> Nav
                              </button>
                            )}
                            {!isCompleted && !isFailed && (
                              <button
                                type="button"
                                onClick={() => handleMarkArrived(job.id)}
                                className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono text-rmpg-200 bg-surface-sunken border border-rmpg-700 rounded-[2px] hover:border-rmpg-500"
                                aria-label={`Mark arrived at ${job.recipient_name}`}
                              >
                                Arrived
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 pt-2 flex-wrap">
                    <button type="button"
                      onClick={() => setRoutePlannerOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rmpg-400 bg-surface-sunken/20 hover:bg-surface-sunken/40 border border-border-default/40 rounded-[2px] transition-all duration-150 hover:shadow-[0_0_8px_rgba(136, 136, 136,0.15)] focus:outline-none focus:ring-1 focus:ring-rmpg-500/50"
                      aria-label="Open Route Planner"
                    >
                      <Route size={12} />
                      Open Route Planner
                    </button>
                    <button
                      type="button"
                      onClick={handleOptimizeRouteV2}
                      disabled={optimization.status === 'pending' || optimization.status === 'processing' || !pendingJobIds.length || !savedRoute?.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-rmpg-700 hover:bg-rmpg-600 text-rmpg-100 rounded-[2px] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      aria-label="Optimize Route with Mapbox V2"
                    >
                      {optimization.status === 'pending' || optimization.status === 'processing' ? (
                        <>
                          <span className="animate-spin inline-block w-3 h-3 border border-rmpg-400 border-t-transparent rounded-full" />
                          Optimizing… {Math.round(optimization.elapsedMs / 1000)}s
                        </>
                      ) : (
                        'Re-optimize remaining'
                      )}
                    </button>
                    {optimization.status === 'error' && (
                      <span className="text-xs text-red-400">
                        {optimization.error === 'timed_out'
                          ? 'Timed out — try fewer stops'
                          : `Optimization failed: ${optimization.error}`}
                      </span>
                    )}
                    <button type="button"
                      onClick={() => {
                        const next = nextUnservedJob(routeJobs);
                        if (!next) return;
                        if (next.recipient_lat != null && next.recipient_lng != null) {
                          window.open(googleMapsNavUrl(next.recipient_lat, next.recipient_lng), '_blank', 'noopener,noreferrer');
                          return;
                        }
                        handleNavigate(next.id);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-900/20 hover:bg-emerald-900/40 border border-emerald-700/40 rounded-[2px] transition-all duration-150 hover:shadow-[0_0_8px_rgba(16,185,129,0.15)] focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                      aria-label="Navigate to next unserved stop"
                    >
                      <Navigation size={12} />
                      Nav next stop
                    </button>
                  </div>
                </>
              );
            })() : (
              <div className="flex flex-col items-center justify-center h-40 text-center">
                <div className="w-12 h-12 rounded-full bg-surface-overlay flex items-center justify-center mb-3">
                  <Route size={20} className="text-rmpg-500" />
                </div>
                <p className="text-sm text-rmpg-400 font-medium mb-3">No route planned for this date.</p>
                <button type="button"
                  onClick={() => setRoutePlannerOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rmpg-400 bg-surface-sunken/20 hover:bg-surface-sunken/40 border border-border-default/40 rounded-[2px] transition-all duration-150 hover:shadow-[0_0_8px_rgba(136, 136, 136,0.15)] focus:outline-none focus:ring-1 focus:ring-rmpg-500/50"
                  aria-label="Open Route Planner"
                >
                  <Route size={12} />
                  Plan a Route
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Map Tab ─────────────────────────────────────────────── */}
        {activeTab === 'Map' && (
          <div className="h-full relative flex flex-col">
            {/* Map toolbar: deadline filter + export */}
            <div className="flex items-center justify-between gap-2 px-2 py-1 bg-surface-raised border-b border-border-subtle flex-wrap">
              <div className="flex items-center gap-1">
                {(['all', 'today', 'three_days', 'week', 'overdue', 'in_progress', 'served'] as DeadlineFilter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setMapDeadlineFilter(f)}
                    className={`px-2 py-1 text-[10px] border border-border-subtle rounded ${mapDeadlineFilter === f ? 'bg-rmpg-700 text-white' : 'bg-surface-sunken text-fg-muted'}`}
                  >
                    {f === 'three_days' ? '3 Days' : f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {previewRoute && (
                  <span className="text-[11px] text-green-400 px-2 py-1 bg-surface-sunken border border-border-subtle rounded">
                    ETA {previewRoute.eta} · {previewRoute.distance} (right-click map to move origin)
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleMapExport}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] bg-surface-sunken border border-border-subtle rounded text-fg-secondary hover:text-rmpg-100"
                >
                  <Printer size={11} /> Export Sheet
                </button>
              </div>
            </div>

            {selectedJobIds.size > 0 && (
              <div className="flex items-center gap-2 px-2 py-1 bg-surface-raised border-b border-border-subtle text-[11px]">
                <span className="text-fg-secondary">{selectedJobIds.size} selected (shift-drag to reselect)</span>
                <span className="text-fg-muted">Apply to selected:</span>
                <button type="button" onClick={() => applyMapBulkStatus('served')} className="px-2 py-0.5 border border-border-subtle rounded text-fg-secondary hover:text-rmpg-100">Mark Served</button>
                <button type="button" onClick={() => applyMapBulkStatus('archived')} className="px-2 py-0.5 border border-border-subtle rounded text-fg-secondary hover:text-rmpg-100">Archive</button>
                <button type="button" onClick={() => setSelectedJobIds(new Set())} className="px-2 py-0.5 border border-border-subtle rounded text-fg-muted hover:text-fg-secondary ml-auto">Clear</button>
              </div>
            )}

            <div className="flex-1 relative min-h-0">
              <div ref={mapContainerRef} className="absolute inset-0" />
              {!mapReady && !isServeMapRecovering && (
                <div className="absolute inset-0 flex items-center justify-center bg-surface-sunken">
                  <div className="flex items-center gap-2 text-xs text-rmpg-400">
                    <Loader2 size={14} className="animate-spin" />
                    Loading map...
                  </div>
                </div>
              )}
              {isServeMapRecovering && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-base/80 pointer-events-none">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 size={16} className="animate-spin text-brand-400" />
                    <span className="text-rmpg-300 text-[10px] font-mono">MAP RECONNECTING…</span>
                  </div>
                </div>
              )}
              {serveMapNeedsManualReload && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-base/90">
                  <div className="flex flex-col items-center gap-2 text-center px-4">
                    <span className="text-rmpg-100 text-xs font-mono">MAP GPU CRASH</span>
                    <button onClick={() => window.location.reload()} className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-[10px] font-mono" style={{ borderRadius: 2 }}>
                      RELOAD PAGE
                    </button>
                  </div>
                </div>
              )}

              {/* Navigate to Next button */}
              {mapReady && jobs.some(j => j.status === 'pending' || j.status === 'in_progress') && (
                <button type="button"
                  onClick={handleNavigateToNext}
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 text-sm font-semibold text-rmpg-100 bg-rmpg-500 hover:bg-rmpg-500/80 rounded-[2px] shadow-lg shadow-rmpg-500/20 border border-rmpg-500 transition-all duration-150 hover:shadow-[0_0_16px_rgb(var(--accent-silver-400-rgb)/0.3)] focus:outline-none focus:ring-2 focus:ring-rmpg-500/50"
                >
                  <Navigation size={16} />
                  Navigate to Next
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Stats Tab ───────────────────────────────────────────── */}
        {activeTab === 'Stats' && (
          <div className="h-full overflow-y-auto p-4 space-y-4 scrollbar-dark">
            {/* Summary cards */}
            <div className={`grid gap-3 ${isMobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
              <StatCard
                label="Jobs Remaining"
                value={(stats?.pending ?? 0) + (stats?.in_progress ?? 0)}
                color="text-rmpg-400"
                bg="bg-surface-sunken/20"
                border="border-border-default/40"
              />
              <StatCard
                label="Served Today"
                value={stats?.served ?? 0}
                color="text-green-400"
                bg="bg-green-900/20"
                border="border-green-700/40"
              />
              <StatCard
                label="Failed"
                value={stats?.failed ?? 0}
                color="text-red-400"
                bg="bg-red-900/20"
                border="border-red-700/40"
              />
              <StatCard
                label="Total Attempts"
                value={stats?.total_attempts ?? 0}
                color="text-amber-400"
                bg="bg-amber-900/20"
                border="border-amber-700/40"
              />
              {(stats?.overdue ?? 0) > 0 && (
                <StatCard
                  label="Overdue"
                  value={stats?.overdue ?? 0}
                  color="text-red-400"
                  bg="bg-red-900/20"
                  border="border-red-700/40"
                />
              )}
              {filteredFeeTotal > 0 && (
                <StatCard
                  label="Revenue Today"
                  value={`$${filteredFeeTotal.toFixed(2)}`}
                  color="text-rmpg-100"
                  bg="bg-surface-sunken/20"
                  border="border-border-default/40"
                />
              )}
              {(stats?.total_attempts ?? 0) > 0 && (stats?.served ?? 0) > 0 && (
                <StatCard
                  label="Avg Attempts/Serve"
                  value={((stats?.total_attempts ?? 0) / (stats?.served ?? 1)).toFixed(1)}
                  color="text-rmpg-100"
                  bg="bg-surface-sunken/20"
                  border="border-border-default/40"
                />
              )}
            </div>

            {/* Mileage / efficiency */}
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <div className="px-4 py-3 bg-surface-raised border border-rmpg-700 rounded-[2px] transition-colors hover:border-rmpg-400/30">
                <div className="text-[10px] uppercase font-semibold tracking-wider text-[color:var(--panel-header-color)] mb-1">Mileage Today</div>
                {/* Falls back to the PLANNED distance stored on serve_routes for
                    the day. Previously this only read `routeData` — ephemeral
                    state set after using the Route Planner in this session — so
                    the card showed "--" even with a saved route on the server.
                    Verified live: 76.3 planned miles existed for the day while
                    this rendered "--". The planned figure is labelled as such;
                    it is not driven mileage and must not be read as billable. */}
                <div className="text-lg font-bold text-rmpg-100 font-mono tabular-nums">
                  {routeData?.totalDistance
                    ? `${routeData.totalDistance.toFixed(1)} mi`
                    : stats?.mileage
                      ? `${Number(stats.mileage).toFixed(1)} mi`
                      : stats?.planned_mileage
                        ? `${Number(stats.planned_mileage).toFixed(1)} mi`
                        : '--'
                  }
                </div>
                {!routeData?.totalDistance && !stats?.mileage && !!stats?.planned_mileage && (
                  <div className="text-[10px] text-fg-muted mt-1">Planned — not recorded mileage</div>
                )}
                {routeData?.fuelCost && routeData.fuelCost > 0 && (
                  <div className="text-[10px] text-fg-muted mt-1">
                    Fuel cost: ${routeData.fuelCost.toFixed(2)}
                  </div>
                )}
              </div>
              <div className="px-4 py-3 bg-surface-raised border border-rmpg-700 rounded-[2px] transition-colors hover:border-rmpg-400/30">
                <div className="text-[10px] uppercase font-semibold tracking-wider text-[color:var(--panel-header-color)] mb-1">Route Efficiency</div>
                {/* Efficiency is planned ÷ actual, so it genuinely cannot be
                    computed without DRIVEN miles — and nothing on serve_routes
                    or serve_attempts records an odometer, so `stats.mileage` is
                    null by design rather than by accident. Say that, instead of
                    rendering a bare "--" that reads like a loading failure. */}
                <div className="text-lg font-bold text-rmpg-100 font-mono tabular-nums">
                  {routeData?.totalDistance && stats?.planned_mileage && stats.planned_mileage > 0
                    ? `${Math.round((stats.planned_mileage / routeData.totalDistance) * 100)}%`
                    : '--'
                  }
                </div>
                {routeData ? (
                  <div className="text-[10px] text-fg-muted mt-1">
                    Est. drive time: {Math.floor((routeData.totalDuration || 0) / 60)}h {Math.round((routeData.totalDuration || 0) % 60)}m
                  </div>
                ) : (
                  <div className="text-[10px] text-fg-muted mt-1">Needs recorded mileage to compare</div>
                )}
              </div>
            </div>

            {/* Feature 5: Cost Calculator */}
            <div className="p-3 bg-surface-raised border border-rmpg-700 rounded-[2px]">
              <div className="text-[10px] uppercase font-semibold tracking-wider text-[color:var(--panel-header-color)] mb-2">Job Cost Calculator</div>
              <div className="flex items-center gap-2">
                <select id="ff-servepage-1"
                  value={costJobId || ''}
                  onChange={e => { const v = parseInt(e.target.value, 10); if (v) handleLoadCostEstimate(v); }}
                  className="flex-1 px-2 py-1 text-xs bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                >
                  <option value="">Select a job...</option>
                  {jobs.map(j => (
                    <option key={j.id} value={j.id}>{j.recipient_name} - {j.document_type || 'N/A'}</option>
                  ))}
                </select>
              </div>
              {costEstimate && (
                <div className="mt-2 space-y-1 text-[10px]">
                  <div className="flex justify-between"><span className="text-rmpg-400">Base Fee:</span><span className="text-rmpg-100">${costEstimate.costs.base_fee.toFixed(2)}</span></div>
                  {costEstimate.costs.extra_attempts > 0 && (
                    <div className="flex justify-between"><span className="text-rmpg-400">Extra Attempts ({costEstimate.costs.extra_attempts}):</span><span className="text-rmpg-100">${costEstimate.costs.extra_attempt_fee.toFixed(2)}</span></div>
                  )}
                  {costEstimate.costs.rush_surcharge > 0 && (
                    <div className="flex justify-between"><span className="text-amber-400">Rush Surcharge:</span><span className="text-rmpg-100">${costEstimate.costs.rush_surcharge.toFixed(2)}</span></div>
                  )}
                  {costEstimate.costs.skip_trace_count > 0 && (
                    <div className="flex justify-between"><span className="text-rmpg-400">Skip Traces ({costEstimate.costs.skip_trace_count}):</span><span className="text-rmpg-100">${costEstimate.costs.skip_trace_fee.toFixed(2)}</span></div>
                  )}
                  {costEstimate.costs.mileage > 0 && (
                    <div className="flex justify-between"><span className="text-rmpg-400">Mileage ({costEstimate.costs.mileage.toFixed(1)} mi):</span><span className="text-rmpg-100">${costEstimate.costs.mileage_fee.toFixed(2)}</span></div>
                  )}
                  <div className="flex justify-between border-t border-rmpg-700 pt-1 font-bold"><span className="text-brand-400">Total:</span><span className="text-brand-300">${costEstimate.costs.total.toFixed(2)}</span></div>
                </div>
              )}
            </div>

            {/* Feature 12: Deadline Tracking + Feature 14: Success Rates */}
            <div className="flex gap-2">
              <button type="button" onClick={handleLoadDeadlines} className="toolbar-btn toolbar-btn-primary text-xs px-3 py-1.5">
                <Calendar className="w-3.5 h-3.5" /> Deadline Tracker
              </button>
              <button type="button" onClick={handleLoadSuccessRates} className="toolbar-btn text-xs px-3 py-1.5">
                <BarChart3 className="w-3.5 h-3.5" /> Success Rates
              </button>
            </div>

            {/* Feature 12: Deadline Tracking Panel */}
            {deadlines && (
              <div className="p-3 bg-surface-raised border border-rmpg-700 rounded-[2px] space-y-2">
                <div className="flex justify-between items-center">
                  <div className="text-[10px] uppercase font-semibold tracking-wider text-[color:var(--panel-header-color)]">Deadline Tracker ({deadlines.total} active)</div>
                  <button type="button" onClick={() => setDeadlines(null)} className="text-rmpg-500 hover:text-rmpg-300 text-xs transition-colors" aria-label="Close deadline tracker">Close</button>
                </div>
                {deadlines.overdue?.length > 0 && (
                  <div>
                    <div className="text-[9px] text-red-400 font-bold uppercase">Overdue ({deadlines.overdue.length})</div>
                    {deadlines.overdue.map((d: any) => (
                      <div key={d.id} className="text-[10px] flex gap-2 py-0.5 text-red-300">
                        <span>{d.recipient_name}</span>
                        <span className="text-rmpg-500">{toDisplayLabel(d.document_type)}</span>
                        <span className="ml-auto">{Math.abs(Math.round(d.days_remaining))}d overdue</span>
                      </div>
                    ))}
                  </div>
                )}
                {deadlines.urgent?.length > 0 && (
                  <div>
                    <div className="text-[9px] text-amber-400 font-bold uppercase">Due within 3 days ({deadlines.urgent.length})</div>
                    {deadlines.urgent.map((d: any) => (
                      <div key={d.id} className="text-[10px] flex gap-2 py-0.5 text-amber-300">
                        <span>{d.recipient_name}</span>
                        <span className="text-rmpg-500">{d.deadline}</span>
                        <span className="ml-auto">{Math.round(d.days_remaining)}d left</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Feature 14: Success Rate Stats Panel */}
            {successRates && (
              <div className="p-3 bg-surface-raised border border-rmpg-700 rounded-[2px] space-y-2">
                <div className="flex justify-between items-center">
                  <div className="text-[10px] uppercase font-semibold tracking-wider text-[color:var(--panel-header-color)]">Success Rates ({successRates.period_days}d)</div>
                  <button type="button" onClick={() => setSuccessRates(null)} className="text-rmpg-500 hover:text-rmpg-300 text-xs transition-colors" aria-label="Close success rates">Close</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div><div className="text-lg font-bold tabular-nums font-mono text-green-400" style={{ textShadow: '0 0 4px currentColor' }}>{successRates.overall?.success_rate}%</div><div className="text-[9px] text-rmpg-400">Overall</div></div>
                  <div><div className="text-lg font-bold tabular-nums font-mono text-rmpg-100" style={{ textShadow: '0 0 4px currentColor' }}>{successRates.overall?.total}</div><div className="text-[9px] text-rmpg-400">Total Jobs</div></div>
                  <div><div className="text-lg font-bold tabular-nums font-mono text-green-400" style={{ textShadow: '0 0 4px currentColor' }}>{successRates.overall?.served}</div><div className="text-[9px] text-rmpg-400">Served</div></div>
                  <div><div className="text-lg font-bold tabular-nums font-mono text-rmpg-100" style={{ textShadow: '0 0 4px currentColor' }}>{successRates.overall?.avg_attempts?.toFixed(1) ?? '--'}</div><div className="text-[9px] text-rmpg-400">Avg Attempts</div></div>
                </div>
                {successRates.by_officer?.length > 0 && (
                  <div>
                    <div className="text-[9px] text-rmpg-400 uppercase font-semibold mb-1">By Officer</div>
                    {successRates.by_officer.map((o: any) => (
                      <div key={o.officer_id} className="text-[10px] flex gap-2 py-0.5">
                        <span className="text-rmpg-100 flex-1">{o.officer_name || 'Unassigned'}</span>
                        <span className="text-green-400">{o.success_rate}%</span>
                        <span className="text-rmpg-500">{o.served}/{o.total}</span>
                        {o.avg_attempts != null && (
                          <span className="text-fg-muted">{Number(o.avg_attempts).toFixed(1)}x</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'Assign' && ['admin','manager','supervisor'].includes(user?.role ?? '') && <AssignTab />}
        {activeTab === 'My Run' && user?.id != null && (
          <MyRunTab
            officerId={Number(user.id)}
            sharedJobs={jobs}
            onJobsChange={setJobs}
            routeOrderIds={(() => {
              if (savedRoute?.optimized_order_json) {
                try {
                  const ids = typeof savedRoute.optimized_order_json === 'string'
                    ? JSON.parse(savedRoute.optimized_order_json)
                    : savedRoute.optimized_order_json;
                  return Array.isArray(ids) ? ids : undefined;
                } catch { return undefined; }
              }
              return routeData?.orderedIds;
            })()}
          />
        )}
        {activeTab === 'Performance' && ['admin','manager','supervisor','officer'].includes(user?.role ?? '') && <PerformanceTab />}
        {activeTab === 'Analytics' && ['admin','manager','supervisor'].includes(user?.role ?? '') && <AnalyticsTab />}
        {activeTab === 'Subject File' && (
          <div className="h-full min-h-0">
            <SubjectFileTab jobs={jobs} selectedJobId={expandedJobId ?? undefined} />
          </div>
        )}
        {activeTab === 'Collections' && ['admin','manager','supervisor'].includes(user?.role ?? '') && (
          <CollectionDatabaseTab />
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* Modals & Panels                                              */}
      {/* ══════════════════════════════════════════════════════════════ */}

      {/* Attempt Modal */}
      {attemptJob && (
        <ServeAttemptModal
          isOpen={!!attemptJob}
          onClose={() => setAttemptJob(null)}
          job={attemptJob}
          onSubmit={handleAttemptSubmit}
        />
      )}

      {/* Edit an existing attempt — operator corrections to a logged attempt */}
      {editAttempt && (
        <EditServeAttemptModal
          isOpen={!!editAttempt}
          onClose={() => setEditAttempt(null)}
          queueId={editAttempt.jobId}
          attempt={editAttempt.attempt}
          onSaved={refreshJobs}
          onDelete={canManage ? handleDeleteAttempt : undefined}
        />
      )}

      {/* Route Planner */}
      <ServeRoutePlanner
        isOpen={routePlannerOpen}
        onClose={() => setRoutePlannerOpen(false)}
        jobs={jobs.filter(j => j.status !== 'served' && j.status !== 'archived')}
        officers={officers}
        currentUserId={user?.id ? Number(user.id) : undefined}
        onRouteOptimized={handleRouteOptimized}
        // Reuses the same set the map's shift-drag rectangle-select and
        // "Add to route" / "Add all to route" context-menu actions populate:
        // if the officer had already staged specific jobs on the map, the
        // planner should open scoped to exactly those, not reset to "every
        // open job". Empty selectedJobIds falls back to the planner's own
        // default (every non-served/failed geocoded job).
        preselectedJobIds={selectedJobIds}
        onVerifyAddress={openEdit}
        mileageRate={serveMileageRate}
        initialDate={selectedDate}
      />

      {/* Skip Trace Panel */}
      {skipTraceJob && (
        <ServeSkipTracePanel
          isOpen={!!skipTraceJob}
          onClose={() => setSkipTraceJob(null)}
          job={skipTraceJob}
          onAddToRoute={handleSkipTraceAddToRoute}
          onLookupComplete={refreshJobs}
        />
      )}

      {/* Audit Log Modal */}
      {auditJobId != null && (
        <ServeAuditLogModal
          jobId={auditJobId}
          onClose={() => setAuditJobId(null)}
        />
      )}

      {/* Notice of Attempt preview — always mobile (Brother PJ in-vehicle
          thermal printer). Regenerates the doc live so the officer sees
          actual margins/layout before printing or downloading, instead of
          a blind download. */}
      {noticePreviewJobId != null && (
        <PdfPreviewModal
          target="mobile"
          title="Notice of Attempt to Serve"
          filename={`Notice-of-Attempt-${noticePreviewJobId}`}
          getDoc={async () => {
            const data = await buildNoticeOfAttemptData(noticePreviewJobId);
            if (!data) throw new Error('No unsuccessful attempts recorded yet — log a failed attempt before generating a Notice of Attempt.');
            const { filename: _filename, ...noticeData } = data;
            const { generateNoticeOfAttempt } = await importWithRetry(() => import('../utils/servePdfGenerator'));
            return generateNoticeOfAttempt(noticeData, { printTarget: 'mobile' });
          }}
          onClose={() => setNoticePreviewJobId(null)}
        />
      )}

      {/* Create / Edit Job Modal */}
      <FormModal
        isOpen={createJobOpen}
        onClose={() => { setCreateJobOpen(false); setEditJob(null); clearFormDraft(); }}
        onSubmit={handleFormSubmit}
        title={editJob ? 'Edit Job' : 'Add Serve Job'}
        icon={Briefcase}
        submitLabel={editJob ? 'Update' : 'Create'}
        isSubmitting={formSubmitting}
        maxWidth="max-w-3xl"
        isDirty={formIsDirty}
        draftRestored={formWasRestored}
        onDiscardDraft={clearFormDraft}
      >
        <div className="space-y-4">

          {/* ── RECIPIENT ─────────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold tracking-widest text-[color:var(--panel-header-color)] uppercase">Recipient</span>
              <div className="flex-1 h-px bg-border-default" />
            </div>
            <div className="space-y-2">
              {/* Recipient type toggle */}
              <div>
                <label className="block text-[11px] text-fg-muted mb-1">Recipient type</label>
                <div className="flex gap-2">
                  {(['individual', 'business'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleFormChange('recipient_type', formData.recipient_type === t ? '' : t)}
                      className={`px-3 py-1 text-[11px] font-semibold rounded-[2px] border transition-colors ${formData.recipient_type === t ? 'bg-rmpg-600 border-rmpg-400 text-rmpg-50' : 'bg-surface-deep border-rmpg-700 text-fg-muted hover:border-rmpg-500'}`}
                    >
                      {t === 'individual' ? 'Individual' : 'Business / Entity'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="ff-servepage-2" className="block text-[11px] text-fg-muted mb-1">
                  Recipient Name <span className="text-red-400">*</span>
                </label>
                <input id="ff-servepage-2"
                  type="text"
                  required
                  value={formData.recipient_name}
                  onChange={e => handleFormChange('recipient_name', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  placeholder="Full name of person or entity to serve"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-[11px] text-fg-muted mb-1">Address</label>
                  <AddressAutocomplete
                    value={formData.recipient_address}
                    onChange={val => handleFormChange('recipient_address', val)}
                    placeholder="Street address"
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                    onSelect={(addr: ParsedAddress) => {
                      setFormData(prev => ({
                        ...prev,
                        recipient_address: addr.street || addr.formatted || prev.recipient_address,
                        recipient_city: prev.recipient_city || addr.city || '',
                        recipient_state: (addr.state && addr.state.trim().length === 2)
                          ? addr.state.trim().toUpperCase() : prev.recipient_state,
                        recipient_zip: prev.recipient_zip || addr.zip || '',
                        recipient_lat: addr.latitude ?? prev.recipient_lat,
                        recipient_lng: addr.longitude ?? prev.recipient_lng,
                      }));
                    }}
                  />
                </div>
                <div className="w-28">
                  <label htmlFor="ff-servepage-addr2" className="block text-[11px] text-fg-muted mb-1">Apt / Unit</label>
                  <input id="ff-servepage-addr2" type="text"
                    value={formData.recipient_address_2}
                    onChange={e => handleFormChange('recipient_address_2', e.target.value)}
                    placeholder="Apt 4B"
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label htmlFor="ff-servepage-4" className="block text-[11px] text-fg-muted mb-1">City</label>
                  <input id="ff-servepage-4" type="text"
                    value={formData.recipient_city}
                    onChange={e => handleFormChange('recipient_city', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="ff-servepage-5" className="block text-[11px] text-fg-muted mb-1">State</label>
                  <input id="ff-servepage-5" type="text"
                    value={formData.recipient_state}
                    onChange={e => handleFormChange('recipient_state', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                    maxLength={2}
                  />
                </div>
                <div>
                  <label htmlFor="ff-servepage-6" className="block text-[11px] text-fg-muted mb-1">ZIP</label>
                  <input id="ff-servepage-6" type="text"
                    value={formData.recipient_zip}
                    onChange={e => handleFormChange('recipient_zip', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                    maxLength={10}
                  />
                </div>
              </div>
              {/* Business-specific fields — only shown when type is 'business' */}
              {formData.recipient_type === 'business' && (
                <div className="space-y-2 border border-rmpg-700 rounded-[2px] p-3 bg-surface-deep/50">
                  <p className="text-[10px] font-semibold tracking-widest text-[color:var(--panel-header-color)] uppercase mb-1">Business / Entity Details</p>
                  <div>
                    <label htmlFor="ff-servepage-biz-name" className="block text-[11px] text-fg-muted mb-1">Business legal name</label>
                    <input id="ff-servepage-biz-name" type="text"
                      value={formData.business_name}
                      onChange={e => handleFormChange('business_name', e.target.value)}
                      placeholder="Full legal name of the entity"
                      className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="ff-servepage-biz-dba" className="block text-[11px] text-fg-muted mb-1">DBA (if applicable)</label>
                      <input id="ff-servepage-biz-dba" type="text"
                        value={formData.business_dba}
                        onChange={e => handleFormChange('business_dba', e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                      />
                    </div>
                    <div>
                      <label htmlFor="ff-servepage-biz-ein" className="block text-[11px] text-fg-muted mb-1">EIN</label>
                      <input id="ff-servepage-biz-ein" type="text"
                        value={formData.business_ein}
                        onChange={e => handleFormChange('business_ein', e.target.value)}
                        placeholder="12-3456789"
                        className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="ff-servepage-biz-sos" className="block text-[11px] text-fg-muted mb-1">SOS filing number</label>
                      <input id="ff-servepage-biz-sos" type="text"
                        value={formData.business_sos_filing}
                        onChange={e => handleFormChange('business_sos_filing', e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                      />
                    </div>
                    <div>
                      <label htmlFor="ff-servepage-biz-inc" className="block text-[11px] text-fg-muted mb-1">State of incorporation</label>
                      <input id="ff-servepage-biz-inc" type="text"
                        value={formData.business_state_of_inc}
                        onChange={e => handleFormChange('business_state_of_inc', e.target.value)}
                        placeholder="UT"
                        maxLength={2}
                        className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="ff-servepage-biz-agent" className="block text-[11px] text-fg-muted mb-1">Registered agent</label>
                      <input id="ff-servepage-biz-agent" type="text"
                        value={formData.registered_agent_name}
                        onChange={e => handleFormChange('registered_agent_name', e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                      />
                    </div>
                    <div>
                      <label htmlFor="ff-servepage-biz-agentitle" className="block text-[11px] text-fg-muted mb-1">Agent title</label>
                      <input id="ff-servepage-biz-agentitle" type="text"
                        value={formData.registered_agent_title}
                        onChange={e => handleFormChange('registered_agent_title', e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="ff-servepage-biz-regoffice" className="block text-[11px] text-fg-muted mb-1">Registered / principal office address</label>
                    <input id="ff-servepage-biz-regoffice" type="text"
                      value={formData.registered_office_address}
                      onChange={e => handleFormChange('registered_office_address', e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── LEGAL CASE ────────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold tracking-widest text-[color:var(--panel-header-color)] uppercase">Legal Case</span>
              <div className="flex-1 h-px bg-border-default" />
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="ff-servepage-11" className="block text-[11px] text-fg-muted mb-1">Case Number</label>
                  <input id="ff-servepage-11" type="text"
                    value={formData.case_number}
                    onChange={e => handleFormChange('case_number', e.target.value)}
                    placeholder="4:26-cv-12695"
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="ff-servepage-12" className="block text-[11px] text-fg-muted mb-1">Court</label>
                  <input id="ff-servepage-12" type="text"
                    value={formData.court_name}
                    onChange={e => handleFormChange('court_name', e.target.value)}
                    placeholder="U.S. District Court"
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="ff-servepage-13" className="block text-[11px] text-fg-muted mb-1">Jurisdiction</label>
                  <input id="ff-servepage-13" type="text"
                    value={formData.jurisdiction}
                    onChange={e => handleFormChange('jurisdiction', e.target.value)}
                    placeholder="District of Utah"
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="ff-servepage-plaintiff" className="block text-[11px] text-fg-muted mb-1">Plaintiff</label>
                  <input id="ff-servepage-plaintiff" type="text"
                    value={formData.plaintiff_name}
                    onChange={e => handleFormChange('plaintiff_name', e.target.value)}
                    placeholder="Party bringing the action"
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="ff-servepage-defendant" className="block text-[11px] text-fg-muted mb-1">Defendant</label>
                  <input id="ff-servepage-defendant" type="text"
                    value={formData.defendant_name}
                    onChange={e => handleFormChange('defendant_name', e.target.value)}
                    placeholder="Party being sued"
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="ff-servepage-7" className="block text-[11px] text-fg-muted mb-1">Document Type</label>
                  <select id="ff-servepage-7"
                    value={formData.document_type}
                    onChange={e => handleFormChange('document_type', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  >
                    {DOCUMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-servepage-client" className="block text-[11px] text-fg-muted mb-1">Client / Hiring Party</label>
                  {clientsList.length > 0 && (
                    <select id="ff-servepage-client"
                      value={clientsList.find(c => c.name === formData.client_name)?.id || ''}
                      onChange={e => {
                        const picked = clientsList.find(c => c.id === e.target.value);
                        if (picked) handleFormChange('client_name', picked.name);
                      }}
                      className="w-full mb-1 px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                      aria-label="Select client"
                    >
                      <option value="">— Select client —</option>
                      {clientsList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                  <input id="ff-servepage-14" type="text"
                    value={formData.client_name}
                    onChange={e => handleFormChange('client_name', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                    placeholder="Or type a name"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="ff-servepage-15" className="block text-[11px] text-fg-muted mb-1">Attorney Name</label>
                <input id="ff-servepage-15" type="text"
                  value={formData.attorney_name}
                  onChange={e => handleFormChange('attorney_name', e.target.value)}
                  placeholder="Counsel of record"
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="ff-servepage-atty-phone" className="block text-[11px] text-fg-muted mb-1">Attorney Phone</label>
                  <input id="ff-servepage-atty-phone" type="tel"
                    value={formData.attorney_phone}
                    onChange={e => handleFormChange('attorney_phone', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="ff-servepage-atty-email" className="block text-[11px] text-fg-muted mb-1">Attorney Email</label>
                  <input id="ff-servepage-atty-email" type="email"
                    value={formData.attorney_email}
                    onChange={e => handleFormChange('attorney_email', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="ff-servepage-atty-bar" className="block text-[11px] text-fg-muted mb-1">Bar #</label>
                  <input id="ff-servepage-atty-bar" type="text"
                    value={formData.attorney_bar_number}
                    onChange={e => handleFormChange('attorney_bar_number', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── CONTACT INFO (features 1-3) ───────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold tracking-widest text-[color:var(--panel-header-color)] uppercase">Recipient Contact</span>
              <div className="flex-1 h-px bg-border-default" />
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="ff-srv-phone" className="block text-[11px] text-fg-muted mb-1">Phone</label>
                  <input id="ff-srv-phone" type="tel"
                    value={formData.recipient_phone}
                    onChange={e => handleFormChange('recipient_phone', e.target.value)}
                    placeholder="(801) 555-0100"
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="ff-srv-email" className="block text-[11px] text-fg-muted mb-1">Email</label>
                  <input id="ff-srv-email" type="email"
                    value={formData.recipient_email}
                    onChange={e => handleFormChange('recipient_email', e.target.value)}
                    placeholder="recipient@example.com"
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="ff-srv-dob" className="block text-[11px] text-fg-muted mb-1">Date of Birth <span className="text-fg-muted font-normal">(substituted service)</span></label>
                  <input id="ff-srv-dob" type="date"
                    value={formData.recipient_dob}
                    onChange={e => handleFormChange('recipient_dob', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── EMPLOYMENT (features 4-5) ─────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold tracking-widest text-[color:var(--panel-header-color)] uppercase">Employment / Workplace</span>
              <div className="flex-1 h-px bg-border-default" />
            </div>
            <div className="space-y-2">
              <div>
                <label htmlFor="ff-srv-employer" className="block text-[11px] text-fg-muted mb-1">Employer Name</label>
                <input id="ff-srv-employer" type="text"
                  value={formData.recipient_employer}
                  onChange={e => handleFormChange('recipient_employer', e.target.value)}
                  placeholder="Acme Corporation"
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                />
              </div>
              <div>
                <label htmlFor="ff-srv-employer-addr" className="block text-[11px] text-fg-muted mb-1">Workplace Address</label>
                <input id="ff-srv-employer-addr" type="text"
                  value={formData.recipient_employer_address}
                  onChange={e => handleFormChange('recipient_employer_address', e.target.value)}
                  placeholder="123 Business Pkwy, Salt Lake City, UT 84101"
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* ── SERVICE CLASSIFICATION (features 6-10) ───────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold tracking-widest text-[color:var(--panel-header-color)] uppercase">Service Classification</span>
              <div className="flex-1 h-px bg-border-default" />
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="ff-srv-type" className="block text-[11px] text-fg-muted mb-1">Serve Type</label>
                  <select id="ff-srv-type"
                    value={formData.serve_type ?? 'personal'}
                    onChange={e => handleFormChange('serve_type', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  >
                    {SERVE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-srv-case-type" className="block text-[11px] text-fg-muted mb-1">Case Type</label>
                  <select id="ff-srv-case-type"
                    value={formData.case_type ?? ''}
                    onChange={e => handleFormChange('case_type', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  >
                    <option value="">— Select —</option>
                    {CASE_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="ff-srv-return-date" className="block text-[11px] text-fg-muted mb-1">Return Date <span className="text-fg-muted font-normal">(service deadline)</span></label>
                  <input id="ff-srv-return-date" type="date"
                    value={formData.return_date}
                    onChange={e => handleFormChange('return_date', e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="ff-srv-relationship" className="block text-[11px] text-fg-muted mb-1">Relationship to Defendant <span className="text-fg-muted font-normal">(sub. service)</span></label>
                  <input id="ff-srv-relationship" type="text"
                    value={formData.relationship}
                    onChange={e => handleFormChange('relationship', e.target.value)}
                    placeholder="Spouse, Adult Occupant, Coworker…"
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="ff-srv-co-defendants" className="block text-[11px] text-fg-muted mb-1">Co-Defendants <span className="text-fg-muted font-normal">(additional parties)</span></label>
                <textarea id="ff-srv-co-defendants"
                  value={formData.co_defendants}
                  onChange={e => handleFormChange('co_defendants', e.target.value)}
                  rows={2}
                  placeholder="Jane Doe, XYZ LLC…"
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors resize-none"
                />
              </div>
            </div>
          </div>

          {/* ── ASSIGNMENT & SCHEDULING ────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold tracking-widest text-[color:var(--panel-header-color)] uppercase">Assignment &amp; Scheduling</span>
              <div className="flex-1 h-px bg-border-default" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="ff-servepage-officer" className="block text-[11px] text-fg-muted mb-1">Assigned Officer</label>
                <select id="ff-servepage-officer"
                  value={formData.officer_id ?? ''}
                  onChange={e => handleFormChange('officer_id', e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                >
                  <option value="">— Unassigned —</option>
                  {officers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ff-servepage-servedate" className="block text-[11px] text-fg-muted mb-1">Serve Date</label>
                <input id="ff-servepage-servedate" type="date"
                  value={formData.serve_date}
                  onChange={e => handleFormChange('serve_date', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                />
              </div>
              <div>
                <label htmlFor="ff-servepage-8" className="block text-[11px] text-fg-muted mb-1">Priority</label>
                <select id="ff-servepage-8"
                  value={formData.priority}
                  onChange={e => handleFormChange('priority', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                >
                  <option value="routine">Routine</option>
                  <option value="normal">Normal</option>
                  <option value="rush">Rush</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div>
                <label htmlFor="ff-servepage-9" className="block text-[11px] text-fg-muted mb-1">Time Window</label>
                <select id="ff-servepage-9"
                  value={formData.time_window}
                  onChange={e => handleFormChange('time_window', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                >
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                  <option value="anytime">Anytime</option>
                </select>
              </div>
              <div>
                <label htmlFor="ff-servepage-10" className="block text-[11px] text-fg-muted mb-1">Deadline</label>
                <input id="ff-servepage-10" type="date"
                  value={formData.deadline}
                  onChange={e => handleFormChange('deadline', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                />
              </div>
              <div>
                <label htmlFor="ff-servepage-16" className="block text-[11px] text-fg-muted mb-1">Max Attempts</label>
                <input id="ff-servepage-16" type="number" min={1} max={10}
                  value={formData.max_attempts}
                  onChange={e => handleFormChange('max_attempts', parseInt(e.target.value, 10) || 3)}
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                />
              </div>
              {editJob && (
                <>
                  <div>
                    <label htmlFor="ff-servepage-status" className="block text-[11px] text-fg-muted mb-1">Status</label>
                    <select id="ff-servepage-status"
                      value={formData.status}
                      onChange={e => handleFormChange('status', e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                    >
                      <option value="pending">Pending</option>
                      <option value="in_progress">In Progress</option>
                      <option value="attempted">Attempted</option>
                      <option value="served">Served</option>
                      <option value="failed">Failed / Non-Service</option>
                      <option value="skipped">Skipped</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ff-servepage-urgency" className="block text-[11px] text-fg-muted mb-1">Urgency Tier</label>
                    <select id="ff-servepage-urgency"
                      value={formData.urgency_tier}
                      onChange={e => handleFormChange('urgency_tier', e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                    >
                      <option value="">— Auto —</option>
                      <option value="standard">Standard</option>
                      <option value="tight">Tight</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── BILLING (features 11-13) ─────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold tracking-widest text-[color:var(--panel-header-color)] uppercase">Billing</span>
              <div className="flex-1 h-px bg-border-default" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="ff-srv-serve-fee" className="block text-[11px] text-fg-muted mb-1">Serve Fee ($)</label>
                <input id="ff-srv-serve-fee" type="number" min={0} step={0.01}
                  value={formData.serve_fee}
                  onChange={e => handleFormChange('serve_fee', e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                />
              </div>
              <div>
                <label htmlFor="ff-srv-rush-fee" className="block text-[11px] text-fg-muted mb-1">Rush Fee ($)</label>
                <input id="ff-srv-rush-fee" type="number" min={0} step={0.01}
                  value={formData.rush_fee}
                  onChange={e => handleFormChange('rush_fee', e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                />
              </div>
              <div>
                <label htmlFor="ff-srv-payment" className="block text-[11px] text-fg-muted mb-1">Payment Status</label>
                <select id="ff-srv-payment"
                  value={formData.payment_status ?? 'unpaid'}
                  onChange={e => handleFormChange('payment_status', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                >
                  {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Document type + priority */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label htmlFor="ff-servepage-7" className="block text-[11px] text-rmpg-400 mb-1">
                Document Type / Legal Statement
              </label>
              <DocumentTypeSelector
                id="ff-servepage-7"
                value={formData.document_type}
                onChange={val => handleFormChange('document_type', val)}
              />
            </div>
          </div>

          {/* ── OPERATIONAL (features 14-17) ─────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold tracking-widest text-[color:var(--panel-header-color)] uppercase">Operational</span>
              <div className="flex-1 h-px bg-border-default" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <label htmlFor="ff-srv-diligence" className="flex items-center gap-2 cursor-pointer text-sm text-rmpg-100 select-none">
                  <input id="ff-srv-diligence" type="checkbox"
                    checked={!!formData.diligence_required}
                    onChange={e => handleFormChange('diligence_required', e.target.checked as any)}
                    className="w-4 h-4 rounded-[2px] border-rmpg-600 bg-surface-deep text-brand-400 focus:ring-rmpg-400/40"
                  />
                  <span className="text-[11px] text-fg-muted">Require documented due diligence</span>
                </label>
                {editJob && (
                  <div className="flex-1">
                    <label htmlFor="ff-srv-mileage" className="block text-[11px] text-fg-muted mb-1">Actual Mileage (mi)</label>
                    <input id="ff-srv-mileage" type="number" min={0} step={0.1}
                      value={formData.mileage_actual}
                      onChange={e => handleFormChange('mileage_actual', e.target.value)}
                      placeholder="0.0"
                      className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                    />
                  </div>
                )}
              </div>
              <div>
                <label htmlFor="ff-srv-contact-restrictions" className="block text-[11px] text-fg-muted mb-1">Contact Restrictions <span className="text-amber-400 font-normal">(hours, who NOT to contact)</span></label>
                <textarea id="ff-srv-contact-restrictions"
                  value={formData.contact_restrictions}
                  onChange={e => handleFormChange('contact_restrictions', e.target.value)}
                  rows={2}
                  placeholder="Do not contact employer. No contact before 8 AM or after 9 PM…"
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-amber-900/30 rounded-[2px] text-rmpg-100 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-400/30 transition-colors resize-none"
                />
              </div>
              <div>
                <label htmlFor="ff-srv-building" className="block text-[11px] text-fg-muted mb-1">Building / Access Notes <span className="text-fg-muted font-normal">(gate codes, parking, buzzer)</span></label>
                <textarea id="ff-srv-building"
                  value={formData.building_access_notes}
                  onChange={e => handleFormChange('building_access_notes', e.target.value)}
                  rows={2}
                  placeholder="Gate code: #1234. Buzz unit 302. Park in visitor spot A…"
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors resize-none"
                />
              </div>
              {editJob && (() => {
                let ac: { klass?: string; confirmed?: boolean } = {};
                try { ac = JSON.parse(editJob.parsed_data ?? '{}')._intake?.address_class ?? {}; } catch { /* ignore */ }
                const klass = ac.klass ?? 'unknown';
                const confirmed = !!ac.confirmed;
                return (
                  <div>
                    <label className="block text-[11px] text-fg-muted mb-1">
                      Serve Location Type <span className="text-fg-muted font-normal">(shapes attempt windows)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      {(['residential', 'unknown', 'business'] as const).map(k => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => handleAddressClassChange(editJob.id, k, k !== 'unknown')}
                          className={`px-3 py-1 text-[11px] rounded-[2px] border transition-colors ${
                            klass === k
                              ? k === 'business'
                                ? 'bg-brand-800/60 border-brand-500 text-brand-200'
                                : k === 'residential'
                                ? 'bg-rmpg-800/60 border-rmpg-500 text-rmpg-100'
                                : 'bg-surface-raised border-rmpg-600 text-fg-muted'
                              : 'bg-surface-deep border-rmpg-700 text-fg-muted hover:border-rmpg-500'
                          }`}
                        >
                          {k.charAt(0).toUpperCase() + k.slice(1)}
                        </button>
                      ))}
                      {klass !== 'unknown' && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-[2px] border ${
                          confirmed
                            ? 'text-green-300 border-green-800/50 bg-green-900/20'
                            : 'text-amber-300 border-amber-800/50 bg-amber-900/20'
                        }`}>
                          {confirmed ? 'Confirmed' : 'Unconfirmed'}
                        </span>
                      )}
                    </div>
                    {klass === 'business' && !confirmed && (
                      <p className="text-[10px] text-amber-400 mt-1">
                        Unconfirmed — residential windows apply until confirmed. Select Business again to confirm.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── INSTRUCTIONS ──────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-semibold tracking-widest text-[color:var(--panel-header-color)] uppercase">Instructions</span>
              <div className="flex-1 h-px bg-border-default" />
            </div>
            <div className="space-y-2">
              <div>
                <label className="block text-[11px] text-fg-muted mb-1">Service Instructions</label>
                <RichTextArea
                  value={formData.service_instructions}
                  onChange={e => handleFormChange('service_instructions', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors resize-none"
                  placeholder="How to serve, who can accept, special access requirements..."
                />
              </div>
              <div>
                <label className="block text-[11px] text-fg-muted mb-1">Internal Notes</label>
                <RichTextArea
                  value={formData.notes}
                  onChange={e => handleFormChange('notes', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors resize-none"
                  placeholder="Internal-only context, history, prior contact notes..."
                />
              </div>
              {editJob && (
                <div>
                  <label className="block text-[11px] text-fg-muted mb-1">Next Attempt Note <span className="text-fg-muted font-normal">(shown on Notice of Attempt PDF)</span></label>
                  <textarea
                    value={formData.next_attempt_note}
                    onChange={e => handleFormChange('next_attempt_note', e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors resize-none"
                    placeholder="Will attempt again between 8–10 AM on weekdays..."
                  />
                </div>
              )}
            </div>
          </div>

        </div>
      </FormModal>

      {/* Delete-job confirm — replaces the v480 window.confirm + window.alert. */}
      {/* Same destructive-action contract as Code Enforcement / Cases: pre-     */}
      {/* focuses Cancel, blocks Enter-anywhere-confirms, scoped Esc cascade.    */}
      <ConfirmDialog
        isOpen={!!deleteJob}
        onClose={() => deleteJob && !deleting && setDeleteJob(null)}
        onConfirm={confirmDeleteJob}
        title="Delete Process Service Job"
        message={
          deleteJob
            ? `Delete process service job for ${deleteJob.recipient_name}${deleteJob.case_number ? ` (case ${deleteJob.case_number})` : ''}? This permanently removes the queue entry, all logged attempts and skip-trace history, and any scheduled attempt windows. Cannot be undone.`
            : ''
        }
        details={deleteJob ? (
          <>
            <div>Job ID: <span className="font-mono">{deleteJob.id}</span></div>
            {deleteJob.attempt_count > 0 && (
              <div>Logged attempts: <span className="font-mono">{deleteJob.attempt_count}</span></div>
            )}
            {deleteJob.document_type && (
              <div>Document: {deleteJob.document_type}</div>
            )}
          </>
        ) : undefined}
        confirmLabel={deleting ? 'Deleting…' : 'Delete Job'}
        confirmVariant="danger"
        isLoading={deleting}
      />

      <UnsavedChangesGuard hasUnsavedChanges={createJobOpen && formIsDirty} />
      <FloatingSaveBar
        visible={createJobOpen && formIsDirty}
        onSave={() => { const e = { preventDefault: () => {} } as React.FormEvent; handleFormSubmit(e); }}
        onCancel={() => { setCreateJobOpen(false); setEditJob(null); clearFormDraft(); }}
        isSaving={formSubmitting}
        saveLabel={editJob ? 'Update Job' : 'Create Job'}
      />
    </div>
  );
}

// ─── Stat Card Sub-component ────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
  bg,
  border,
}: {
  label: string;
  value: number | string;
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <div className={`px-4 py-3 rounded-[2px] border ${bg} ${border} transition-all duration-150 hover:shadow-md hover:scale-[1.01]`}>
      <div className="text-[10px] uppercase font-semibold tracking-wider text-[color:var(--panel-header-color)] mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono tabular-nums ${color}`} style={{ textShadow: '0 0 4px currentColor' }}>{value}</div>
    </div>
  );
}
