// ============================================================
// RMPG Flex — Process Server Field Suite
// Mobile-first page for managing serve jobs, route planning,
// attempt documentation, and skip traces.
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import RichTextArea from '../components/RichTextArea';
import {
  Plus, RefreshCw, MapPin, BarChart3, List, Map as MapIcon, Briefcase, Calendar,
  Route, Navigation, Loader2, CheckCircle, Circle, Eye, Pencil, ClipboardCheck,
  Search as SearchIcon, AlertTriangle, FileWarning, Users, Trash2, Zap, ArrowUpDown, X,
  FolderOpen, Layers, Printer,
} from 'lucide-react';
import ServeStatusFolder from '../components/serve/ServeStatusFolder';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import AssignTab from './serve/AssignTab';
import MyRunTab from './serve/MyRunTab';
import PerformanceTab from './serve/PerformanceTab';
import { apiFetch } from '../hooks/useApi';
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
import ServeJobCard from '../components/serve/ServeJobCard';
import ServeAttemptModal from '../components/serve/ServeAttemptModal';
import EditServeAttemptModal from '../components/serve/EditServeAttemptModal';
import ServeRoutePlanner from '../components/serve/ServeRoutePlanner';
import ServeSkipTracePanel from '../components/serve/ServeSkipTracePanel';
import ServeAuditLogModal from '../components/serve/ServeAuditLogModal';
import FormModal from '../components/FormModal';
import AddressAutocomplete, { type ParsedAddress } from '../components/AddressAutocomplete';
import type { ServeJob, ServeAttempt, ServeAttemptData, ServeSkipAddress, ServeFolder } from '../types';
import { deriveServeFolder, SERVE_FOLDER_CONFIG } from '../types';
import ExportButton from '../components/ExportButton';
import { useFormDraft } from '../hooks/useFormDraft';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import FloatingSaveBar from '../components/FloatingSaveBar';
import { parseTimestamp } from '../utils/dateUtils';
import { hasLayer, hasSource, safeRemoveLayer, safeRemoveSource } from '../utils/mapboxSafeLayer';

// ─── Constants ──────────────────────────────────────────────────────────

const TABS = ['Queue', 'Route', 'Map', 'Stats', 'Assign', 'My Run', 'Performance'] as const;
type Tab = typeof TABS[number];
type StatusFilter = 'all' | 'pending' | 'in_progress' | 'served' | 'failed';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'served', label: 'Served' },
  { value: 'failed', label: 'Failed' },
];

const MARKER_COLORS: Record<string, string> = {
  pending: 'var(--text-muted)',
  in_progress: '#eab308',
  served: '#22c55e',
  failed: '#ef4444',
  skipped: 'var(--rmpg-500)',
  archived: 'var(--rmpg-500)',
};

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

const EMPTY_FORM = {
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
  document_type: 'Summons',
  case_number: '',
  court_name: '',
  jurisdiction: '',
  client_name: '',
  attorney_name: '',
  priority: 'normal' as ServeJob['priority'],
  time_window: 'anytime' as ServeJob['time_window'],
  deadline: '',
  max_attempts: 3,
  service_instructions: '',
  notes: '',
};

// ─── Stats Summary Type ─────────────────────────────────────────────────

interface StatsSummary {
  pending: number;
  in_progress: number;
  served: number;
  failed: number;
  total_attempts: number;
  mileage?: number;
  planned_mileage?: number;
}

// ─── Component ──────────────────────────────────────────────────────────

export default function ServePage() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const canManage = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');
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
    storageKey: 'rmpg_serve_job_form',
    defaultValue: EMPTY_FORM,
    isActive: createJobOpen,
  });
  const [formSubmitting, setFormSubmitting] = useState(false);

  // ── Feature 12: Deadline Tracking ──
  const [deadlines, setDeadlines] = useState<any>(null);
  // ── Feature 14: Success Rate Stats ──
  const [successRates, setSuccessRates] = useState<any>(null);

  // ── Notice of Attempt to Serve (unsuccessful-attempt notice) ──
  // Builds the professional notice from the job's real serve_attempts and opens
  // the rendered PDF. Distinct from the Affidavit of Non-Service: this is an
  // unsworn notice to leave at the address / send to the recipient or client.
  const handleNoticeOfAttempt = async (jobId: number) => {
    try {
      // GET /:id returns the job row + its serve_attempts (joined w/ officer).
      const job = await apiFetch<ServeJob & { attempts?: any[] }>(`/process-server/${jobId}`);
      const fullAddress = [job.recipient_address, (job as any).recipient_address_2, job.recipient_city, job.recipient_state, job.recipient_zip]
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
          const code = String((a as any).disposition_code || '').toUpperCase();
          if (code.startsWith('PS/05') || code.startsWith('PS/10') || code.startsWith('PS/25')) return false;
          return true;
        })
        .map((a, i) => {
          // Soft-recovery: prefer attempt_at, fall back to created_at. Legacy
          // and auto-logged attempts sometimes have a null attempt_at but
          // always have a created_at — without this the table renders blank.
          // parseTimestamp() handles naive UTC server strings ("YYYY-MM-DD HH:MM:SS").
          const ts = a.attempt_at || a.created_at || null;
          const at = ts ? parseTimestamp(ts) : null;
          // Structured code wins over the legacy enum — the generator's
          // serveResultLabel() prints the full PS/XX.XX — Label.
          const resultText = (a as any).disposition_code || a.result || 'other';
          return {
            number: a.attempt_number ?? i + 1,
            // MM/DD/YYYY zero-padded — toLocaleDateString() default is
            // M/D/YYYY which made the column visibly ragged when
            // adjacent rows had single vs double-digit months/days.
            date: at && !isNaN(at.getTime())
              ? (() => {
                  const p = (n: number) => String(n).padStart(2, '0');
                  return `${p(at.getMonth() + 1)}/${p(at.getDate())}/${at.getFullYear()}`;
                })()
              : '',
            // 24-hour HH:MM — police-form convention. hour12:false makes
            // sure environments with am/pm locales don't sneak in.
            time: at && !isNaN(at.getTime())
              ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
              : '',
            result: resultText,
            notes: a.notes || '',
            gpsLat: a.latitude ?? null,
            gpsLng: a.longitude ?? null,
          };
        });
      if (attempts.length === 0) {
        setFetchError('No unsuccessful attempts recorded yet — log a failed attempt before generating a Notice of Attempt.');
        return;
      }
      // The latest attempt carries the freshest signature; use it as the
      // server's mark on the notice. (The Notice of Attempt is an unsworn
      // notice, but a visible signature improves recipient trust.)
      const latestAttempt = (job.attempts || [])[(job.attempts || []).length - 1] || {};
      // Operator-set next-attempt note lives on the queue row — set by the
      // attempt modal when a failed attempt is logged. Falls back to the
      // generic boilerplate when nothing is scheduled and the job is still
      // active; suppressed entirely when the queue is in failed terminal state.
      const nextAttemptNote = (job as any).next_attempt_note
        || (job.status === 'failed'
              ? undefined
              : 'A further attempt may be made; contact our office to arrange service.');
      const { generateNoticeOfAttempt } = await importWithRetry(() => import('../utils/servePdfGenerator'));
      const pdf = await generateNoticeOfAttempt({
        // MM/DD/YYYY zero-padded so it matches the attempt dates in the
        // table below. toLocaleDateString() returns M/D/YYYY (no leading
        // zeros) which made columns visibly uneven.
        noticeDate: (() => {
          const d = new Date();
          const p = (n: number) => String(n).padStart(2, '0');
          return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
        })(),
        caseNumber: job.case_number || '',
        // Internal serve-queue reference for the AGENCY REF # header slot.
        // When a case number exists, this still surfaces so a recipient
        // knows our internal tracking ID without confusing it with the
        // court's case number.
        agencyRefNumber: `JOB-${job.id}`,
        courtName: job.court_name || 'N/A',
        jurisdiction: job.jurisdiction || 'Salt Lake County, Utah',
        serverName: user?.full_name || user?.username || 'Process Server',
        serverBadge: user?.badge_number || '',
        serverCompany: 'Rocky Mountain Protective Group',
        // RMPG Dispatch direct line — surfaces in the PDF's "To arrange
        // delivery, contact ..." call-to-action below the signature.
        serverPhone: '(385) 436-3370',
        signature: latestAttempt.signature_data || undefined,
        recipientName: job.recipient_name,
        recipientAddress: fullAddress || (job.recipient_address || 'N/A'),
        documentType: job.document_type,
        clientName: job.client_name || undefined,
        attorneyName: job.attorney_name || undefined,
        attempts,
        nextAttemptNote,
      });
      // Open the REAL PDF bytes in a new tab so the server can print/leave the
      // notice immediately. (dataurlnewwindow opened an HTML wrapper around a
      // session-bound blob URL — saving that wrapper produced a blank
      // "PDF"; see openPdfDocument.ts.)
      const { openPdfDocument } = await importWithRetry(() => import('../utils/openPdfDocument'));
      openPdfDocument(pdf, `Notice-of-Attempt-${job.case_number || job.id}.pdf`);
    } catch (err) {
      console.error('[serve] Notice of Attempt generation failed:', err);
      setFetchError('Could not generate the Notice of Attempt — please try again.');
    }
  };

  // Job Information Sheet (PS-300) — full printable packet carried by the PSO
  // to the field and filed as an internal record. Distinct from the Notice of
  // Attempt (left with the recipient): this sheet shows ALL attempts, skip
  // trace results, service instructions, and has blank lines for field notes.
  const handleJobSheet = async (jobId: number) => {
    try {
      const job = await apiFetch<ServeJob & { attempts?: any[]; skipTraces?: any[] }>(`/process-server/${jobId}`);
      const { parseTimestamp } = await importWithRetry(() => import('../utils/dateUtils'));

      const fullAddress = [
        job.recipient_address,
        (job as any).recipient_address_2,
        job.recipient_city,
        job.recipient_state,
        job.recipient_zip,
      ].filter(Boolean).join(', ');

      const pad = (n: number) => String(n).padStart(2, '0');

      const attempts = (job.attempts || []).map((a, i) => {
        const ts = a.attempt_at || a.created_at || null;
        const at = ts ? parseTimestamp(ts) : null;
        const valid = at && !isNaN(at.getTime());
        return {
          number: a.attempt_number ?? i + 1,
          date: valid ? `${pad(at!.getMonth() + 1)}/${pad(at!.getDate())}/${at!.getFullYear()}` : '',
          time: valid ? at!.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '',
          type: (a.attempt_type || '').replace(/_/g, ' '),
          result: (a as any).disposition_code || a.result || 'other',
          officerName: a.officer_name || '',
          notes: a.notes || '',
          gpsLat: a.latitude ?? null,
          gpsLng: a.longitude ?? null,
        };
      });

      const skipTraces = (job.skipTraces || []).map((t: any) => {
        const tTs = t.created_at ? parseTimestamp(t.created_at) : null;
        const tValid = tTs && !isNaN(tTs.getTime());
        const addrs = Array.isArray(t.addresses_found) ? t.addresses_found : [];
        return {
          date: tValid ? `${pad(tTs!.getMonth() + 1)}/${pad(tTs!.getDate())}/${tTs!.getFullYear()}` : '',
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

  // ── Map state ──────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const routeSourceRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  // WebGL context-loss recovery (rebuilds the map after a GPU context drop).
  const [serveMapRecoverNonce, setServeMapRecoverNonce] = useState(0);
  const serveMapRecoveryCleanupRef = useRef<(() => void) | null>(null);

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
  const fetchSavedRoute = useCallback(async () => {
    if (!user?.id) return;
    try {
      const route = await apiFetch<any>(`/process-server/routes/${selectedDate}?officer_id=${Number(user.id)}`);
      setSavedRoute(route);
    } catch { setSavedRoute(null); }
  }, [selectedDate, user?.id]);

  useEffect(() => { fetchSavedRoute(); }, [fetchSavedRoute]);

  // ══════════════════════════════════════════════════════════════════════
  // Handlers
  // ══════════════════════════════════════════════════════════════════════

  const handleSyncFromSM = useCallback(async () => {
    setSyncing(true);
    try {
      await apiFetch('/process-server/sync-from-sm', { method: 'POST' });
      refreshJobs();
    } catch {
      addToast('Sync from ServeManager failed', 'error');
    } finally {
      setSyncing(false);
    }
  }, [refreshJobs]);

  const handleNavigate = useCallback((jobId: number) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    if (job.recipient_lat != null && job.recipient_lng != null) {
      window.open(
        `https://www.openstreetmap.org/directions?engine=graphhopper_car&to=${job.recipient_lat},${job.recipient_lng}`,
        '_blank',
        'noopener,noreferrer',
      );
    } else if (job.recipient_address) {
      const addr = encodeURIComponent(
        `${job.recipient_address} ${(job as any).recipient_address_2 || ''} ${job.recipient_city || ''} ${job.recipient_state || ''} ${job.recipient_zip || ''}`,
      );
      window.open(`https://www.openstreetmap.org/search?query=${addr}`, '_blank', 'noopener,noreferrer');
    }
  }, [jobs]);

  const handleFlagAddress = useCallback(async (jobId: number) => {
    try {
      await apiFetch(`/process-server/${jobId}`, {
        method: 'PUT',
        body: JSON.stringify({ notes: 'BAD ADDRESS \u2014 needs verification', status: 'skipped' }),
      });
      refreshJobs();
    } catch {
      addToast('Could not flag address — please try again', 'error');
    }
  }, [refreshJobs]);

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
      addToast(`Moved to ${newStatus === 'cancelled' ? 'Archive' : newStatus.replace('_', ' ')}`, 'success');
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
    setDeleting(true);
    try {
      await apiFetch(`/serve-intake/${deleteJob.id}`, { method: 'DELETE' });
      setJobs((prev) => prev.filter((j) => j.id !== deleteJob.id));
      setExpandedJobId((prev) => (prev === deleteJob.id ? null : prev));
      addToast('Process-service job deleted', 'success');
      setDeleteJob(null);
    } catch (e) {
      addToast(`Could not delete job: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    } finally {
      setDeleting(false);
    }
  }, [deleteJob, addToast]);

  const handleAttemptSubmit = useCallback(async (data: ServeAttemptData) => {
    if (!attemptJob) return { dueDiligenceComplete: false, attemptNumber: 0, jobStatus: 'pending' };
    const result = await apiFetch<{
      dueDiligenceComplete?: boolean;
      attemptNumber?: number;
      jobStatus?: string;
    }>(`/process-server/${attemptJob.id}/attempt`, {
      method: 'POST',
      body: JSON.stringify(data),
    });

    // Optimistic update — move job to its new folder immediately without waiting for poll
    const newStatus = (result.jobStatus as ServeJob['status']) || attemptJob.status;
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
    return result;
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
    data: { totalDistance: number; totalDuration: number; fuelCost: number },
  ) => {
    setRouteData({ orderedIds: orderedJobIds, ...data });
    // Persist sort order to server
    try {
      await apiFetch('/process-server/reorder', {
        method: 'PUT',
        body: JSON.stringify({ items: orderedJobIds.map((id, i) => ({ id, sort_order: i })) }),
      });
      refreshJobs();
      fetchSavedRoute(); // Refresh saved route for Route tab
    } catch {
      addToast('Could not save route order on server', 'error');
    }
  }, [refreshJobs, fetchSavedRoute]);

  const handleSkipTraceAddToRoute = useCallback((_addr: ServeSkipAddress) => {
    // Could update the job's address — for now just close and refresh
    refreshJobs();
  }, [refreshJobs]);

  // ── Create / Edit Job ──────────────────────────────────────────────

  const openCreate = useCallback(() => {
    setEditJob(null);
    setFormData({ ...EMPTY_FORM });
    setCreateJobOpen(true);
    snapshotForm();
  }, [setFormData, snapshotForm]);

  const openEdit = useCallback((jobId: number) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;
    setEditJob(job);
    setFormData({
      recipient_name: job.recipient_name,
      recipient_address: job.recipient_address || '',
      recipient_address_2: (job as any).recipient_address_2 || '',
      recipient_city: job.recipient_city || '',
      recipient_state: job.recipient_state || 'UT',
      recipient_zip: job.recipient_zip || '',
      recipient_lat: job.recipient_lat ?? null,
      recipient_lng: job.recipient_lng ?? null,
      document_type: job.document_type,
      case_number: job.case_number || '',
      court_name: job.court_name || '',
      jurisdiction: job.jurisdiction || '',
      client_name: job.client_name || '',
      attorney_name: job.attorney_name || '',
      priority: job.priority,
      time_window: job.time_window,
      deadline: job.deadline || '',
      max_attempts: job.max_attempts,
      service_instructions: job.service_instructions || '',
      notes: job.notes || '',
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
          body: JSON.stringify({ ...formData, serve_date: selectedDate }),
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

  const handleFormChange = useCallback((field: string, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  // ── Navigate to next unserved stop ─────────────────────────────────

  const handleNavigateToNext = useCallback(() => {
    const unserved = routeData
      ? routeData.orderedIds
          .map(id => jobs.find(j => j.id === id))
          .filter((j): j is ServeJob => !!j && j.status !== 'served' && j.status !== 'failed')
      : jobs.filter(j => j.status === 'pending' || j.status === 'in_progress');

    if (unserved.length > 0) {
      handleNavigate(unserved[0].id);
    }
  }, [jobs, routeData, handleNavigate]);

  // ══════════════════════════════════════════════════════════════════════
  // Filtered Jobs
  // ══════════════════════════════════════════════════════════════════════

  // ── Feature 1: Priority Queue Sort ──
  const [sortByUrgency, setSortByUrgency] = useState(false);
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
      const data = await apiFetch<any>(`/process-server/${jobId}/cost-estimate`);
      setCostEstimate(data);
    } catch { setCostEstimate(null); }
  };

  const filteredJobs = useMemo(() => {
    let result = statusFilter === 'all' ? jobs : jobs.filter(j => j.status === statusFilter);

    // Search filter — applies across all folders
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(j =>
        j.recipient_name.toLowerCase().includes(q) ||
        (j.case_number || '').toLowerCase().includes(q) ||
        (j.client_name || '').toLowerCase().includes(q) ||
        (j.recipient_address || '').toLowerCase().includes(q),
      );
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

    return result;
  }, [jobs, statusFilter, sortByUrgency, searchQuery]);

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

    const initMap = () => {
      if (cancelled || !mapContainerRef.current) return;

      if (mapRef.current) {
        updateMapMarkers();
        return;
      }

      const center: [number, number] = [-111.891, 40.7608]; // SLC default [lng, lat]
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: MAPBOX_STYLE_DARK,
        center,
        zoom: 11,
        attributionControl: false,
      });

      map.addControl(new mapboxgl.NavigationControl(), 'top-right');

      mapRef.current = map;
      popupRef.current = new mapboxgl.Popup({ offset: 25, closeButton: false });

      // Rebuild in place if the GPU drops the context. updateMapMarkers re-runs
      // (keyed on mapReady) and re-adds the markers + route layer to the new map.
      serveMapRecoveryCleanupRef.current = installWebglContextRecovery(map, {
        label: 'ServePage',
        onRebuild: () => {
          if (serveMapRecoveryCleanupRef.current) { serveMapRecoveryCleanupRef.current(); serveMapRecoveryCleanupRef.current = null; }
          markersRef.current.forEach((m) => { try { m.remove(); } catch { /* gone */ } });
          markersRef.current = [];
          try { popupRef.current?.remove(); } catch { /* gone */ }
          popupRef.current = null;
          routeSourceRef.current = null;
          if (mapRef.current) { try { mapRef.current.remove(); } catch { /* gone */ } mapRef.current = null; }
          setMapReady(false);
          setServeMapRecoverNonce((n) => n + 1);
        },
      });

      map.on('load', () => {
        if (cancelled) return;
        setMapReady(true);
      });
    };

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
    if (serveMapRecoveryCleanupRef.current) { serveMapRecoveryCleanupRef.current(); serveMapRecoveryCleanupRef.current = null; }
    markersRef.current.forEach((m) => { try { m.remove(); } catch { /* gone */ } });
    markersRef.current = [];
    try { popupRef.current?.remove(); } catch { /* gone */ }
    popupRef.current = null;
    if (mapRef.current) { try { mapRef.current.remove(); } catch { /* gone */ } mapRef.current = null; }
  }, []);

  // Update markers when jobs change or map becomes ready
  const updateMapMarkers = useCallback(() => {
    if (!mapRef.current) return;

    // Clear old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Clear old route source layer
    if (routeSourceRef.current) {
      try {
        safeRemoveLayer(mapRef.current, routeSourceRef.current);
        safeRemoveSource(mapRef.current, routeSourceRef.current);
      } catch { /* layer/source may not exist */ }
      routeSourceRef.current = null;
    }

    const bounds = new mapboxgl.LngLatBounds();
    let hasMarkers = false;

    jobs.forEach(job => {
      if (job.recipient_lat == null || job.recipient_lng == null) return;
      hasMarkers = true;
      const lngLat: [number, number] = [job.recipient_lng, job.recipient_lat];
      bounds.extend(lngLat);

      const color = MARKER_COLORS[job.status] || MARKER_COLORS.pending;
      const el = document.createElement('div');
      el.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);cursor:pointer;`;
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat(lngLat)
        .addTo(mapRef.current!);

      // Popup on click
      el.addEventListener('click', () => {
        const fullAddr = [job.recipient_address, (job as any).recipient_address_2, job.recipient_city, job.recipient_state, job.recipient_zip]
          .filter(Boolean).join(', ');
        if (popupRef.current) {
          popupRef.current.setLngLat(lngLat).setHTML(`
            <div style="color:var(--text-primary);background:var(--surface-raised);padding:8px 12px;border-radius:4px;min-width:180px;font-family:system-ui;">
              <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${job.recipient_name}</div>
              <div style="font-size:11px;color:var(--text-secondary);">${fullAddr || 'No address'}</div>
              <div style="font-size:10px;color:var(--text-muted);margin-top:4px;text-transform:uppercase;">${job.status.replace(/_/g, ' ')} &middot; ${(job.document_type || '').replace(/_/g, ' ')}</div>
            </div>
          `).addTo(mapRef.current!);
        }
      });

      markersRef.current.push(marker);
    });

    // Draw polyline if route planned
    if (routeData && routeData.orderedIds.length > 1) {
      const coords: [number, number][] = routeData.orderedIds
        .map(id => jobs.find(j => j.id === id))
        .filter((j): j is ServeJob => !!j && j.recipient_lat != null && j.recipient_lng != null)
        .map(j => [j.recipient_lng!, j.recipient_lat!]);

      if (coords.length > 1) {
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
            'line-color': 'rgb(var(--rmpg-500-rgb))',
            'line-opacity': 0.8,
            'line-width': 3,
          },
        });
      }
    }

    if (hasMarkers) {
      mapRef.current.fitBounds(bounds, { padding: 60 });
    }
  }, [jobs, routeData]);

  useEffect(() => {
    if (mapReady) updateMapMarkers();
  }, [mapReady, updateMapMarkers]);

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

  // ── Build a serve-job row context menu ──
  const buildJobMenu = (job: ServeJob): ContextMenuItem[] => {
    const addr = [job.recipient_address, (job as any).recipient_address_2, job.recipient_city, job.recipient_state, job.recipient_zip]
      .filter(Boolean).join(', ');
    const isClosed = job.status === 'served' || job.status === 'failed' || job.status === 'archived';
    return [
      m.action('Open / expand', () => setExpandedJobId(prev => prev === job.id ? null : job.id), { icon: <Eye size={12} /> }),
      ...(canManage ? [m.action('Edit job', () => openEdit(job.id), { icon: <Pencil size={12} /> })] : []),
      ...(isClosed ? [] : [m.action('Log attempt', () => setAttemptJob(job), { icon: <ClipboardCheck size={12} /> })]),
      m.action('Print Job Sheet', () => handleJobSheet(job.id), { icon: <Printer size={12} /> }),
      ...(job.attempt_count > 0 ? [m.action('Notice of Attempt to Serve', () => handleNoticeOfAttempt(job.id), { icon: <FileWarning size={12} /> })] : []),
      m.action('Skip trace', () => setSkipTraceJob(job), { icon: <SearchIcon size={12} /> }),
      moveSubmenu.length > 0
        ? { label: 'Move to…', icon: <FolderOpen size={12} />, submenu: moveSubmenu }
        : null,
      m.separator(),
      m.copy('Copy recipient', job.recipient_name),
      m.copyId(job.id),
      ...(addr ? [m.action('Navigate to address', () => handleNavigate(job.id), { icon: <Navigation size={12} /> })] : []),
      m.separator(),
      m.action('Flag bad address', () => handleFlagAddress(job.id), { icon: <AlertTriangle size={12} />, danger: true }),
      ...(canDelete ? [
        m.action('Delete job', () => handleDeleteJob(job), { icon: <Trash2 size={12} />, danger: true }),
      ] : []),
    ].filter(Boolean) as ContextMenuItem[];
  };

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
      <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700 bg-surface-sunken flex-wrap" role="toolbar" aria-label="Process Server controls">
        <div className="flex items-center gap-1.5">
          <Briefcase size={16} className="text-brand-gold-500" />
          {!isMobile && <span className="text-sm font-semibold text-rmpg-100 tracking-wider">PROCESS SERVER</span>}
          {!isMobile && <span className="block h-px w-full bg-brand-400/30 mt-0.5" />}
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
              <span className="font-mono tabular-nums text-[10px] ml-1.5 px-1.5 py-0.5 rounded-[2px] text-brand-gold-500" style={{ background: "rgb(var(--brand-gold-rgb)/0.06)", border: "1px solid rgb(var(--brand-gold-rgb)/0.15)" }}>
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
        </div>
      </div>

      {/* ─── Tab Bar ───────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-rmpg-700 bg-surface-sunken" role="tablist" aria-label="Process Server views">
        {TABS.filter(tab => {
          const role = user?.role ?? '';
          if (tab === 'Assign') return ['admin', 'manager', 'supervisor'].includes(role);
          if (tab === 'Performance') return ['admin', 'manager', 'supervisor', 'officer'].includes(role);
          // Queue, Route, Map, Stats, My Run — visible to all
          return true;
        }).map(tab => {
          const Icon =
            tab === 'Queue' ? List :
            tab === 'Route' ? Route :
            tab === 'Map' ? MapIcon :
            tab === 'Stats' ? BarChart3 :
            tab === 'Assign' ? Users :
            tab === 'Performance' ? BarChart3 :
            Route; // My Run
          return (
            <button type="button"
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-all duration-150 border-b-2 ${
                activeTab === tab
                  ? 'text-brand-gold-500 border-brand-gold-500 bg-brand-gold-500/5'
                  : 'text-rmpg-400 border-transparent hover:text-rmpg-200 hover:border-rmpg-600 hover:bg-white/[0.02]'
              }`}
            >
              <Icon size={14} />
              {tab}
            </button>
          );
        })}
      </div>

      {/* ─── Tab Content ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {/* ── Queue Tab ───────────────────────────────────────────── */}
        {activeTab === 'Queue' && (
          <div className="h-full flex flex-col">
            {/* Filter buttons */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-rmpg-700 overflow-x-auto tab-scroll">
              {STATUS_FILTERS.map(f => (
                <button type="button"
                  key={f.value}
                  role="button"
                  aria-pressed={statusFilter === f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-[2px] border transition-all duration-150 whitespace-nowrap focus:outline-none focus:ring-1 focus:ring-rmpg-500/50 ${
                    statusFilter === f.value
                      ? 'text-rmpg-100 bg-rmpg-500 border-rmpg-500 shadow-[0_0_6px_rgba(212,160,23,0.3)]'
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
                            {searchQuery ? `No jobs match "${searchQuery}"` : `No ${statusFilter.replace(/_/g, ' ')} jobs.`}
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
            {savedRoute && savedRoute.optimized_order_json ? (() => {
              const orderIds: number[] = (() => {
                try {
                  return typeof savedRoute.optimized_order_json === 'string'
                    ? JSON.parse(savedRoute.optimized_order_json)
                    : savedRoute.optimized_order_json;
                } catch { return []; }
              })();
              const routeJobs = orderIds
                .map(id => jobs.find(j => j.id === id))
                .filter((j): j is ServeJob => !!j);
              const completedCount = routeJobs.filter(j => j.status === 'served').length;
              const totalStops = routeJobs.length;
              const progressPct = totalStops > 0 ? Math.round((completedCount / totalStops) * 100) : 0;

              return (
                <>
                  {/* Stats bar */}
                  <div className="flex items-center gap-4 flex-wrap px-3 py-2 bg-surface-sunken border border-rmpg-700 rounded-[2px]" role="status" aria-label="Route statistics">
                    <div className="flex items-center gap-1.5 text-rmpg-400 text-xs">
                      <MapPin size={12} className="text-rmpg-400" />
                      <span className="font-mono tabular-nums text-rmpg-100">{totalStops}</span> stops
                    </div>
                    <div className="flex items-center gap-1.5 text-rmpg-400 text-xs">
                      <Navigation size={12} className="text-emerald-400" />
                      <span className="font-mono tabular-nums text-rmpg-100">
                        {savedRoute.total_distance_miles ? `${Number(savedRoute.total_distance_miles).toFixed(1)} mi` : '--'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-rmpg-400 text-xs">
                      <Calendar size={12} className="text-amber-400" />
                      <span className="font-mono tabular-nums text-rmpg-100">
                        {savedRoute.total_time_minutes
                          ? `~${Math.floor(savedRoute.total_time_minutes / 60)}h ${Math.round(savedRoute.total_time_minutes % 60)}m`
                          : '--'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-rmpg-400 text-xs ml-auto">
                      <span className="font-mono tabular-nums text-brand-gold-500">
                        {completedCount}/{totalStops} done ({progressPct}%)
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${progressPct === 100 ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.25)]' : 'bg-brand-400 shadow-[0_0_6px_var(--brand-gold-glow,rgba(212,160,23,0.25))]'}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  {/* Ordered stop list */}
                  <div className="space-y-1">
                    {routeJobs.map((job, idx) => {
                      const isCompleted = job.status === 'served';
                      const isFailed = job.status === 'failed';
                      return (
                        <div
                          key={job.id}
                          className={`flex items-center gap-3 px-3 py-2 rounded-[2px] border transition-all duration-150 ${
                            isCompleted
                              ? 'bg-green-900/10 border-green-800/30 opacity-60'
                              : isFailed
                                ? 'bg-red-900/10 border-red-800/30 opacity-60'
                                : 'bg-surface-raised border-rmpg-700 hover:border-rmpg-400/30'
                          }`}
                        >
                          {/* Stop number */}
                          <span
                            className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold text-rmpg-100 flex-shrink-0 ${
                              isCompleted ? 'bg-green-500' : isFailed ? 'bg-red-500' : job.status === 'in_progress' ? 'bg-amber-500' : 'bg-rmpg-500'
                            }`}
                          >
                            {idx + 1}
                          </span>

                          {/* Completion indicator */}
                          {isCompleted ? (
                            <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
                          ) : (
                            <Circle size={14} className="text-rmpg-600 flex-shrink-0" />
                          )}

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs font-medium truncate ${isCompleted ? 'text-rmpg-400 line-through' : 'text-rmpg-100'}`}>
                              {job.recipient_name}
                            </div>
                            <div className="text-[10px] text-rmpg-500 truncate">
                              {job.recipient_address || 'No address'}
                              {(job as any).recipient_address_2 ? `, ${(job as any).recipient_address_2}` : ''}
                              {job.recipient_city ? `, ${job.recipient_city}` : ''}
                            </div>
                          </div>

                          {/* Status badge */}
                          <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded-[2px] flex-shrink-0 border ${
                            isCompleted
                              ? 'bg-green-500/10 text-green-400 border-green-500/20'
                              : isFailed
                                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                : job.status === 'in_progress'
                                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                  : 'bg-rmpg-500/10 text-rmpg-400 border-rmpg-500/20'
                          }`}>
                            {toDisplayLabel(job.status)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 pt-2">
                    <button type="button"
                      onClick={() => setRoutePlannerOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rmpg-400 bg-surface-sunken/20 hover:bg-surface-sunken/40 border border-border-default/40 rounded-[2px] transition-all duration-150 hover:shadow-[0_0_8px_rgba(136, 136, 136,0.15)] focus:outline-none focus:ring-1 focus:ring-rmpg-500/50"
                      aria-label="Open Route Planner"
                    >
                      <Route size={12} />
                      Open Route Planner
                    </button>
                    <button type="button"
                      onClick={() => {
                        // Build navigation URL with all waypoints
                        const geocoded = routeJobs.filter(j => j.status !== 'served' && j.recipient_lat != null && j.recipient_lng != null);
                        if (geocoded.length === 0) return;
                        const dest = geocoded[geocoded.length - 1];
                        const waypoints = geocoded.slice(0, -1).map(j => `${j.recipient_lng},${j.recipient_lat}`).join(';');
                        const url = `https://www.openstreetmap.org/directions?engine=graphhopper_car&to=${dest.recipient_lat},${dest.recipient_lng}${waypoints ? `&via=${encodeURIComponent(waypoints)}` : ''}`;
                        window.open(url, '_blank', 'noopener,noreferrer');
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-900/20 hover:bg-emerald-900/40 border border-emerald-700/40 rounded-[2px] transition-all duration-150 hover:shadow-[0_0_8px_rgba(16,185,129,0.15)] focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                      aria-label="Start Navigation"
                    >
                      <Navigation size={12} />
                      Start Navigation
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
          <div className="h-full relative">
            <div ref={mapContainerRef} className="absolute inset-0" />
            {!mapReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-surface-sunken">
                <div className="flex items-center gap-2 text-xs text-rmpg-400">
                  <Loader2 size={14} className="animate-spin" />
                  Loading map...
                </div>
              </div>
            )}

            {/* Navigate to Next button */}
            {mapReady && jobs.some(j => j.status === 'pending' || j.status === 'in_progress') && (
              <button type="button"
                onClick={handleNavigateToNext}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 text-sm font-semibold text-rmpg-100 bg-rmpg-500 hover:bg-rmpg-500/80 rounded-[2px] shadow-lg shadow-rmpg-500/20 border border-rmpg-500 transition-all duration-150 hover:shadow-[0_0_16px_rgba(212,160,23,0.3)] focus:outline-none focus:ring-2 focus:ring-rmpg-500/50"
              >
                <Navigation size={16} />
                Navigate to Next
              </button>
            )}
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
            </div>

            {/* Mileage / efficiency */}
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <div className="px-4 py-3 bg-surface-raised border border-rmpg-700 rounded-[2px] transition-colors hover:border-rmpg-400/30">
                <div className="text-[10px] text-brand-gold-500 uppercase font-semibold tracking-wider mb-1">Mileage Today</div>
                <div className="text-lg font-bold text-rmpg-100 font-mono tabular-nums">
                  {routeData?.totalDistance
                    ? `${routeData.totalDistance.toFixed(1)} mi`
                    : stats?.mileage
                      ? `${stats.mileage.toFixed(1)} mi`
                      : '--'
                  }
                </div>
                {routeData?.fuelCost && routeData.fuelCost > 0 && (
                  <div className="text-[10px] text-rmpg-400 mt-1">
                    Fuel cost: ${routeData.fuelCost.toFixed(2)}
                  </div>
                )}
              </div>
              <div className="px-4 py-3 bg-surface-raised border border-rmpg-700 rounded-[2px] transition-colors hover:border-rmpg-400/30">
                <div className="text-[10px] text-brand-gold-500 uppercase font-semibold tracking-wider mb-1">Route Efficiency</div>
                <div className="text-lg font-bold text-rmpg-100 font-mono tabular-nums">
                  {routeData && stats?.planned_mileage && stats.planned_mileage > 0
                    ? `${Math.round((stats.planned_mileage / (routeData.totalDistance || 1)) * 100)}%`
                    : '--'
                  }
                </div>
                {routeData && (
                  <div className="text-[10px] text-rmpg-400 mt-1">
                    Est. drive time: {Math.floor((routeData.totalDuration || 0) / 60)}h {Math.round((routeData.totalDuration || 0) % 60)}m
                  </div>
                )}
              </div>
            </div>

            {/* Feature 5: Cost Calculator */}
            <div className="p-3 bg-surface-raised border border-rmpg-700 rounded-[2px]">
              <div className="text-[10px] text-brand-gold-500 uppercase font-semibold tracking-wider mb-2">Job Cost Calculator</div>
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
                  <div className="text-[10px] text-brand-gold-500 uppercase font-semibold tracking-wider">Deadline Tracker ({deadlines.total} active)</div>
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
                  <div className="text-[10px] text-brand-gold-500 uppercase font-semibold tracking-wider">Success Rates ({successRates.period_days}d)</div>
                  <button type="button" onClick={() => setSuccessRates(null)} className="text-rmpg-500 hover:text-rmpg-300 text-xs transition-colors" aria-label="Close success rates">Close</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div><div className="text-lg font-bold tabular-nums font-mono text-green-400" style={{ textShadow: '0 0 4px currentColor' }}>{successRates.overall?.success_rate}%</div><div className="text-[9px] text-rmpg-400">Overall</div></div>
                  <div><div className="text-lg font-bold tabular-nums font-mono text-rmpg-100" style={{ textShadow: '0 0 4px currentColor' }}>{successRates.overall?.total}</div><div className="text-[9px] text-rmpg-400">Total Jobs</div></div>
                  <div><div className="text-lg font-bold tabular-nums font-mono text-green-400" style={{ textShadow: '0 0 4px currentColor' }}>{successRates.overall?.served}</div><div className="text-[9px] text-rmpg-400">Served</div></div>
                  <div><div className="text-lg font-bold tabular-nums font-mono text-rmpg-100" style={{ textShadow: '0 0 4px currentColor' }}>{successRates.overall?.avg_attempts?.toFixed(1)}</div><div className="text-[9px] text-rmpg-400">Avg Attempts</div></div>
                </div>
                {successRates.by_officer?.length > 0 && (
                  <div>
                    <div className="text-[9px] text-rmpg-400 uppercase font-semibold mb-1">By Officer</div>
                    {successRates.by_officer.map((o: any) => (
                      <div key={o.officer_id} className="text-[10px] flex gap-2 py-0.5">
                        <span className="text-rmpg-100 flex-1">{o.officer_name || 'Unassigned'}</span>
                        <span className="text-green-400">{o.success_rate}%</span>
                        <span className="text-rmpg-500">{o.served}/{o.total}</span>
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
          />
        )}
        {activeTab === 'Performance' && ['admin','manager','supervisor','officer'].includes(user?.role ?? '') && <PerformanceTab />}
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

      {/* Create / Edit Job Modal */}
      <FormModal
        isOpen={createJobOpen}
        onClose={() => { setCreateJobOpen(false); setEditJob(null); clearFormDraft(); }}
        onSubmit={handleFormSubmit}
        title={editJob ? 'Edit Job' : 'Add Serve Job'}
        icon={Briefcase}
        submitLabel={editJob ? 'Update' : 'Create'}
        isSubmitting={formSubmitting}
        maxWidth="max-w-xl"
        isDirty={formIsDirty}
        draftRestored={formWasRestored}
        onDiscardDraft={clearFormDraft}
      >
        <div className="space-y-3">
          {/* Recipient */}
          <div>
            <label htmlFor="ff-servepage-2" className="block text-[11px] text-rmpg-400 mb-1">
              Recipient Name <span className="text-red-400">*</span>
            </label>
            <input id="ff-servepage-2"
              type="text"
              required
              value={formData.recipient_name}
              onChange={e => handleFormChange('recipient_name', e.target.value)}
              className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
              placeholder="Full name"
            />
          </div>

          {/* Address */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex gap-2 sm:col-span-2">
            <div className="flex-1">
              <label className="block text-[11px] text-rmpg-400 mb-1">Address</label>
              <AddressAutocomplete
                value={formData.recipient_address}
                onChange={val => handleFormChange('recipient_address', val)}
                placeholder="Street address"
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                // Picking a suggestion fills the split address fields + the
                // precise pin. City/ZIP fill blanks only (never clobber a typed
                // value); the pick's coordinates always win for the chosen
                // address.
                onSelect={(addr: ParsedAddress) => {
                  setFormData(prev => ({
                    ...prev,
                    recipient_address: addr.street || addr.formatted || prev.recipient_address,
                    recipient_city: prev.recipient_city || addr.city || '',
                    // Only adopt a 2-letter state code — geocoders often return
                    // the full name ("Utah") which doesn't fit this 2-char field,
                    // so in that case keep the operator's value (defaults to UT).
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
              <label htmlFor="ff-servepage-addr2" className="block text-[11px] text-rmpg-400 mb-1">Apt / Unit</label>
              <input
                id="ff-servepage-addr2"
                type="text"
                value={formData.recipient_address_2}
                onChange={e => handleFormChange('recipient_address_2', e.target.value)}
                placeholder="Apt 4B"
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
              />
            </div>
            </div>
            <div>
              <label htmlFor="ff-servepage-4" className="block text-[11px] text-rmpg-400 mb-1">City</label>
              <input id="ff-servepage-4"
                type="text"
                value={formData.recipient_city}
                onChange={e => handleFormChange('recipient_city', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="ff-servepage-5" className="block text-[11px] text-rmpg-400 mb-1">State</label>
                <input id="ff-servepage-5"
                  type="text"
                  value={formData.recipient_state}
                  onChange={e => handleFormChange('recipient_state', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  maxLength={2}
                />
              </div>
              <div>
                <label htmlFor="ff-servepage-6" className="block text-[11px] text-rmpg-400 mb-1">ZIP</label>
                <input id="ff-servepage-6"
                  type="text"
                  value={formData.recipient_zip}
                  onChange={e => handleFormChange('recipient_zip', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                  maxLength={10}
                />
              </div>
            </div>
          </div>

          {/* Document type + priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ff-servepage-7" className="block text-[11px] text-rmpg-400 mb-1">Document Type</label>
              <select id="ff-servepage-7"
                value={formData.document_type}
                onChange={e => handleFormChange('document_type', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
              >
                {DOCUMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ff-servepage-8" className="block text-[11px] text-rmpg-400 mb-1">Priority</label>
              <select id="ff-servepage-8"
                value={formData.priority}
                onChange={e => handleFormChange('priority', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
              >
                {/* Values must match the serve_queue.priority CHECK
                    (routine/normal/rush/urgent) — 'low'/'high' were rejected. */}
                <option value="routine">Routine</option>
                <option value="normal">Normal</option>
                <option value="rush">Rush</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          {/* Time window + deadline */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ff-servepage-9" className="block text-[11px] text-rmpg-400 mb-1">Time Window</label>
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
              <label htmlFor="ff-servepage-10" className="block text-[11px] text-rmpg-400 mb-1">Deadline</label>
              <input id="ff-servepage-10"
                type="date"
                value={formData.deadline}
                onChange={e => handleFormChange('deadline', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
              />
            </div>
          </div>

          {/* Case / Court / Jurisdiction */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="ff-servepage-11" className="block text-[11px] text-rmpg-400 mb-1">Case Number</label>
              <input id="ff-servepage-11"
                type="text"
                value={formData.case_number}
                onChange={e => handleFormChange('case_number', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
              />
            </div>
            <div>
              <label htmlFor="ff-servepage-12" className="block text-[11px] text-rmpg-400 mb-1">Court</label>
              <input id="ff-servepage-12"
                type="text"
                value={formData.court_name}
                onChange={e => handleFormChange('court_name', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
              />
            </div>
            <div>
              <label htmlFor="ff-servepage-13" className="block text-[11px] text-rmpg-400 mb-1">Jurisdiction</label>
              <input id="ff-servepage-13"
                type="text"
                value={formData.jurisdiction}
                onChange={e => handleFormChange('jurisdiction', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
              />
            </div>
          </div>

          {/* Client + Attorney */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ff-servepage-client" className="block text-[11px] text-rmpg-400 mb-1">Client Name</label>
              {/* Hiring-party selector — picking a known client fills the
                  free-text field below (which stays editable for ad-hoc names). */}
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
              <input id="ff-servepage-14"
                type="text"
                value={formData.client_name}
                onChange={e => handleFormChange('client_name', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
                placeholder="Or type a name"
              />
            </div>
            <div>
              <label htmlFor="ff-servepage-15" className="block text-[11px] text-rmpg-400 mb-1">Attorney Name</label>
              <input id="ff-servepage-15"
                type="text"
                value={formData.attorney_name}
                onChange={e => handleFormChange('attorney_name', e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
              />
            </div>
          </div>

          {/* Max attempts */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ff-servepage-16" className="block text-[11px] text-rmpg-400 mb-1">Max Attempts</label>
              <input id="ff-servepage-16"
                type="number"
                min={1}
                max={10}
                value={formData.max_attempts}
                onChange={e => handleFormChange('max_attempts', parseInt(e.target.value, 10) || 3)}
                className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors"
              />
            </div>
          </div>

          {/* Instructions + notes */}
          <div>
            <label className="block text-[11px] text-rmpg-400 mb-1">Service Instructions</label>
            <RichTextArea
              value={formData.service_instructions}
              onChange={e => handleFormChange('service_instructions', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors resize-none"
              placeholder="Special instructions for service..."
            />
          </div>
          <div>
            <label className="block text-[11px] text-rmpg-400 mb-1">Notes</label>
            <RichTextArea
              value={formData.notes}
              onChange={e => handleFormChange('notes', e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-surface-deep border border-rmpg-700 rounded-[2px] text-rmpg-100 focus:border-rmpg-400 focus:outline-none focus:ring-1 focus:ring-rmpg-400/40 transition-colors resize-none"
              placeholder="Internal notes..."
            />
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
  value: number;
  color: string;
  bg: string;
  border: string;
}) {
  return (
    <div className={`px-4 py-3 rounded-[2px] border ${bg} ${border} transition-all duration-150 hover:shadow-md hover:scale-[1.01]`}>
      <div className="text-[10px] text-brand-gold-500 uppercase font-semibold tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono tabular-nums ${color}`} style={{ textShadow: '0 0 4px currentColor' }}>{value}</div>
    </div>
  );
}
