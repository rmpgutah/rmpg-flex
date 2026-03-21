import React, { useState, useEffect, useCallback, useRef, useId } from 'react';
import {
  AlertTriangle,
  Plus,
  Search,
  Edit,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Archive,
  RotateCcw,
  MapPin,
  User,
  Gavel,
  ChevronDown,
  X,
  Scale,
  Radar,
  PlayCircle,
  History,
  FileText,
  Activity,
  ChevronRight,
  Zap,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import ExportButton from '../components/ExportButton';
import PrintRecordButton from '../components/PrintRecordButton';
import ConfirmDialog from '../components/ConfirmDialog';
import WarrantBadge from '../components/WarrantBadge';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import StatuteLookup, { OffenseLevelBadge } from '../components/StatuteLookup';
import type { StatuteResult } from '../components/StatuteLookup';
import { useFormValidation } from '../hooks/useFormValidation';
import EmptyState from '../components/EmptyState';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { useAuth } from '../context/AuthContext';
import PersonIntelPanel from '../components/PersonIntelPanel';

// ============================================================
// Types
// ============================================================

interface Warrant {
  id: number;
  warrant_number: string;
  type: 'arrest' | 'search' | 'bench' | 'civil' | 'other';
  status: 'active' | 'served' | 'recalled' | 'expired' | 'quashed';
  subject_person_id: number | null;
  subject_first_name: string | null;
  subject_last_name: string | null;
  subject_name: string | null;
  subject_dob?: string | null;
  subject_gender?: string | null;
  subject_race?: string | null;
  subject_height?: string | null;
  subject_weight?: string | null;
  subject_hair_color?: string | null;
  subject_eye_color?: string | null;
  subject_address?: string | null;
  subject_photo_url?: string | null;
  issuing_court: string | null;
  issuing_judge: string | null;
  charge_description: string;
  bail_amount: number | null;
  offense_level: 'felony' | 'misdemeanor' | 'infraction' | 'civil' | null;
  entered_by: number;
  entered_by_name: string | null;
  served_by: number | null;
  served_by_name?: string | null;
  served_at: string | null;
  served_location: string | null;
  expires_at: string | null;
  notes: string | null;
  archived_at: string | null;
  source?: string | null;
  created_at: string;
  updated_at: string;
  activity?: ActivityEntry[];
}

interface ActivityEntry {
  id: number;
  action: string;
  details: string;
  user_name: string;
  created_at: string;
}

interface Person {
  id: number;
  first_name: string;
  last_name: string;
  dob?: string;
}

// Dashboard types
interface DashboardStats {
  activeWarrants: number;
  hitsToday: number;
  personsFlagged: number;
  sourcesOnline: number;
  sourcesTotal: number;
}

interface FeedEntry {
  id: number;
  person_id: number;
  person_name: string;
  event: string;
  utah_warrant_id?: string;
  charges: string | null;
  court_name: string | null;
  created_at: string;
  photo_url?: string | null;
}

interface PriorityWarrant {
  id: number;
  warrant_number: string;
  type: string;
  status: string;
  charge_description: string;
  offense_level: string | null;
  subject_first_name: string | null;
  subject_last_name: string | null;
  subject_photo_url: string | null;
  bail_amount: number | null;
  source: string | null;
  created_at: string;
}

// Person profile (slide-out)
interface PersonProfile {
  person: {
    id: number;
    first_name: string;
    last_name: string;
    dob?: string;
    photo_url?: string | null;
    flags?: string | any[];
  };
  warrants: Warrant[];
  scanHistory: { id: number; event: string; details: string; created_at: string }[];
  lastChecked: string | null;
}

// Unified warrants list
interface UnifiedWarrant extends Warrant {
  source?: string | null;
}

interface WatchRun {
  id: number;
  run_id: string;
  started_at: string;
  completed_at: string | null;
  persons_checked: number;
  new_warrants_found: number;
  warrants_cleared: number;
  errors: number;
  status: 'running' | 'completed' | 'failed';
  error_message: string | null;
}

// ============================================================
// Constants
// ============================================================

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

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-red-900/50 text-red-400 border-red-700/50',
  served: 'bg-green-900/50 text-green-400 border-green-700/50',
  recalled: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  expired: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  quashed: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
};

const TYPE_COLORS: Record<string, string> = {
  arrest: 'bg-red-900/40 text-red-300 border-red-700/50',
  search: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
  bench: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  civil: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
  other: 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50',
};

const SEVERITY_COLORS: Record<string, string> = {
  felony: 'bg-red-900/50 text-red-400 border-red-700/50',
  misdemeanor: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  infraction: 'bg-yellow-900/50 text-yellow-400 border-yellow-700/50',
  civil: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
};

type TabId = 'dashboard' | 'warrants' | 'utah_search' | 'watch_hits';

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }>; roleGated?: boolean }[] = [
  { id: 'dashboard', label: 'DASHBOARD', icon: Activity },
  { id: 'warrants', label: 'WARRANTS', icon: Gavel },
  { id: 'utah_search', label: 'PERSON INTEL', icon: Search },
  { id: 'watch_hits', label: 'WATCH HITS', icon: Radar },
];

const SEVERITY_BADGE: Record<string, string> = {
  felony: 'bg-red-900/40 text-red-300 border-red-800/40',
  misdemeanor: 'bg-amber-900/40 text-amber-300 border-amber-800/40',
  bench: 'bg-orange-900/40 text-orange-300 border-orange-800/40',
  civil: 'bg-blue-900/40 text-blue-300 border-blue-800/40',
};

const FEED_RANGES = ['1H', '8H', '24H', '7D'] as const;
type FeedRange = typeof FEED_RANGES[number];

const FEED_RANGE_PARAMS: Record<FeedRange, string> = {
  '1H': '1h',
  '8H': '8h',
  '24H': '24h',
  '7D': '7d',
};

// ============================================================
// Helpers
// ============================================================

function formatCurrency(amount: number | null): string {
  if (amount == null) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function chargesFromJson(charges: string | null): string {
  if (!charges) return '';
  try { return JSON.parse(charges).join('; '); } catch { return charges; }
}

function computeDuration(start: string, end: string | null): string {
  if (!end) return 'In progress...';
  try {
    const ms = new Date(end.replace(' ', 'T')).getTime() - new Date(start.replace(' ', 'T')).getTime();
    if (ms < 0) return '-';
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ${secs % 60}s`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  } catch { return '-'; }
}

function relativeTime(dt: string): string {
  try {
    const ms = Date.now() - new Date(dt.replace(' ', 'T')).getTime();
    if (ms < 0) return 'just now';
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch { return dt; }
}

// ============================================================
// Component
// ============================================================

export default function WarrantsPage() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const warrantFormTitleId = useId();
  const serveTitleId = useId();

  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  // ============================================================
  // DASHBOARD STATE
  // ============================================================
  const [dashStats, setDashStats] = useState<DashboardStats | null>(null);
  const [dashStatsLoading, setDashStatsLoading] = useState(false);
  const [feedEntries, setFeedEntries] = useState<FeedEntry[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedRange, setFeedRange] = useState<FeedRange>('24H');
  const [feedEventFilter, setFeedEventFilter] = useState<string>('');
  const [priorityWarrants, setPriorityWarrants] = useState<PriorityWarrant[]>([]);
  const [priorityLoading, setPriorityLoading] = useState(false);
  const [dashSearch, setDashSearch] = useState('');

  // ============================================================
  // WARRANTS TAB STATE
  // ============================================================
  const [warrants, setWarrants] = useState<UnifiedWarrant[]>([]);
  const [selectedWarrant, setSelectedWarrant] = useState<Warrant | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);

  // Form modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingWarrant, setEditingWarrant] = useState<Warrant | null>(null);
  const [formData, setFormData] = useState({
    type: 'arrest',
    subject_person_id: '',
    issuing_court: '',
    issuing_judge: '',
    charge_description: '',
    bail_amount: '',
    offense_level: '',
    expires_at: '',
    notes: '',
    statute_id: null as number | null,
    statute_citation: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const { errors: formErrors, validate: validateForm, clearAllErrors } = useFormValidation();

  // Serve modal
  const [serveModalOpen, setServeModalOpen] = useState(false);
  const [serveLocation, setServeLocation] = useState('');
  const [serving, setServing] = useState(false);

  // Delete confirm
  const [deletingWarrant, setDeletingWarrant] = useState<Warrant | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Person search for form
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<Person[]>([]);
  const [personSearchLoading, setPersonSearchLoading] = useState(false);
  const [showPersonDropdown, setShowPersonDropdown] = useState(false);
  const [selectedPersonName, setSelectedPersonName] = useState('');

  // ============================================================
  // PERSON PROFILE SLIDE-OUT STATE
  // ============================================================
  const [personProfileOpen, setPersonProfileOpen] = useState(false);
  const [personProfile, setPersonProfile] = useState<PersonProfile | null>(null);
  const [personProfileLoading, setPersonProfileLoading] = useState(false);
  const [checkingPerson, setCheckingPerson] = useState(false);

  // Watch hits state
  const [watchHits, setWatchHits] = useState<any[]>([]);
  const [watchHitsLoading, setWatchHitsLoading] = useState(false);
  const [linkCallTarget, setLinkCallTarget] = useState<any | null>(null);
  const [openCalls, setOpenCalls] = useState<any[]>([]);
  const [linkingId, setLinkingId] = useState<number | null>(null);

  // Watch runs state
  const [watchRuns, setWatchRuns] = useState<WatchRun[]>([]);
  const [watchRunsLoading, setWatchRunsLoading] = useState(false);
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scanRunning, setScanRunning] = useState(false);

  // Cleanup scan poll/timeout on unmount to prevent memory leaks
  useEffect(() => () => {
    if (scanPollRef.current) clearInterval(scanPollRef.current);
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
  }, []);

  // ============================================================
  // DASHBOARD FETCHES
  // ============================================================

  const fetchDashStats = useCallback(async () => {
    setDashStatsLoading(true);
    try {
      const res = await apiFetch<DashboardStats>('/warrants/dashboard/stats');
      setDashStats(res);
    } catch { /* silent */ }
    finally { setDashStatsLoading(false); }
  }, []);

  const fetchFeed = useCallback(async () => {
    setFeedLoading(true);
    try {
      const res = await apiFetch<{ data: FeedEntry[] }>(`/warrants/dashboard/feed?range=${FEED_RANGE_PARAMS[feedRange]}`);
      setFeedEntries(res.data || (Array.isArray(res) ? res : []));
    } catch { setFeedEntries([]); }
    finally { setFeedLoading(false); }
  }, [feedRange]);

  const fetchPriority = useCallback(async () => {
    setPriorityLoading(true);
    try {
      const res = await apiFetch<{ data: PriorityWarrant[] }>('/warrants/dashboard/priority');
      setPriorityWarrants(res.data || (Array.isArray(res) ? res : []));
    } catch { setPriorityWarrants([]); }
    finally { setPriorityLoading(false); }
  }, []);

  // Auto-refresh dashboard stats every 30s
  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    fetchDashStats();
    fetchPriority();
    const interval = setInterval(fetchDashStats, 30_000);
    return () => clearInterval(interval);
  }, [activeTab, fetchDashStats, fetchPriority]);

  // Fetch feed when range changes
  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    fetchFeed();
  }, [activeTab, fetchFeed]);

  // ============================================================
  // WARRANTS TAB FETCHES
  // ============================================================

  const fetchWarrants = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterType) params.set('type', filterType);
      if (filterSeverity) params.set('severity', filterSeverity);
      if (searchQuery) params.set('subject_name', searchQuery);
      params.set('archived', showArchived ? 'true' : 'false');
      params.set('page', String(page));
      params.set('per_page', '50');

      // Try unified endpoint first, fall back to standard
      try {
        const res = await apiFetch<{ warrants: UnifiedWarrant[]; total: number }>(
          `/warrants/unified?${params.toString()}`
        );
        setWarrants(res.warrants || []);
        setTotalCount(res.total || 0);
        setTotalPages(Math.ceil((res.total || 0) / 50) || 1);
      } catch {
        // Fallback to standard endpoint
        const res = await apiFetch<{ data: Warrant[]; pagination: { total: number; totalPages: number } }>(
          `/warrants?${params.toString()}`
        );
        setWarrants(res.data || []);
        setTotalPages(res.pagination?.totalPages || 1);
        setTotalCount(res.pagination?.total || 0);
      }
    } catch (err: any) {
      if (!options?.silent) setError(err?.message || 'Failed to load warrants');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [filterStatus, filterType, filterSeverity, searchQuery, showArchived, page]);

  useEffect(() => {
    if (activeTab === 'warrants') fetchWarrants();
  }, [activeTab, fetchWarrants]);

  // Live sync
  const silentRefreshWarrants = useCallback(() => fetchWarrants({ silent: true }), [fetchWarrants]);
  useLiveSync('alerts', silentRefreshWarrants);

  // Fetch warrant detail
  const fetchWarrantDetail = useCallback(async (id: number) => {
    try {
      const detail = await apiFetch<Warrant>(`/warrants/${id}`);
      setSelectedWarrant(detail);
    } catch { /* keep existing */ }
  }, []);

  // Person search for form
  useEffect(() => {
    if (!personSearch || personSearch.length < 2) {
      setPersonResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setPersonSearchLoading(true);
      try {
        const res = await apiFetch<{ data: Person[] }>(`/records/persons?search=${encodeURIComponent(personSearch)}&limit=10`);
        setPersonResults(res.data || res as any || []);
      } catch { setPersonResults([]); }
      finally { setPersonSearchLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [personSearch]);

  // ============================================================
  // PERSON PROFILE
  // ============================================================

  const openPersonProfile = useCallback(async (personId: number) => {
    setPersonProfileOpen(true);
    setPersonProfileLoading(true);
    setPersonProfile(null);
    try {
      const res = await apiFetch<PersonProfile>(`/warrants/person/${personId}/profile`);
      setPersonProfile(res);
    } catch {
      // If profile endpoint not available, close
      setPersonProfileOpen(false);
    }
    finally { setPersonProfileLoading(false); }
  }, []);

  const handleRunCheck = useCallback(async (personId: number) => {
    setCheckingPerson(true);
    try {
      await apiFetch<any>(`/warrants/check/${personId}`, { method: 'POST' });
      // Re-fetch profile
      const res = await apiFetch<PersonProfile>(`/warrants/person/${personId}/profile`);
      setPersonProfile(res);
    } catch { /* silent */ }
    finally { setCheckingPerson(false); }
  }, []);

  const fetchWatchHits = useCallback(async () => {
    setWatchHitsLoading(true);
    try {
      const res = await apiFetch<{ data: any[] }>('/warrants/watch/log?limit=100');
      setWatchHits(res.data || []);
    } catch { /* silent */ }
    finally { setWatchHitsLoading(false); }
  }, []);

  const fetchOpenCalls = useCallback(async () => {
    try {
      const res = await apiFetch<any>('/dispatch/calls?status=active,dispatched,enroute,onscene&per_page=50');
      setOpenCalls(res.data || []);
    } catch {}
  }, []);

  const linkHitToCall = async (hit: any, callId: number) => {
    setLinkingId(callId);
    try {
      await apiFetch(`/dispatch/calls/${callId}/notes`, {
        method: 'POST',
        body: JSON.stringify({
          content: `⚠ Warrant hit: ${hit.person_name || 'Unknown'} — ${(hit.resolvedSeverity || '').toUpperCase()} (${hit.charge_description || hit.source || 'scanner'}) via ${hit.source || 'Warrant Watch'}`,
          type: 'warrant_alert',
        }),
      });
      setLinkCallTarget(null);
    } catch {} finally {
      setLinkingId(null);
    }
  };

  const fetchWatchRuns = useCallback(async () => {
    setWatchRunsLoading(true);
    try {
      const res = await apiFetch<{ data: WatchRun[] }>('/warrants/watch/runs?limit=20');
      setWatchRuns(res.data || []);
      const running = (res.data || []).some(r => r.status === 'running');
      setScanRunning(running);
    } catch { /* silent */ }
    finally { setWatchRunsLoading(false); }
  }, []);

  useEffect(() => {
    fetchWatchRuns();
  }, [fetchWatchRuns]);

  useEffect(() => {
    if (activeTab === 'watch_hits') fetchWatchHits();
  }, [activeTab, fetchWatchHits]);

  const handleTriggerScan = useCallback(async () => {
    if (scanPollRef.current) clearInterval(scanPollRef.current);
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    setScanRunning(true);
    try {
      await apiFetch('/warrants/watch/scan', { method: 'POST' });
      scanPollRef.current = setInterval(async () => {
        try {
          const res = await apiFetch<{ data: WatchRun[] }>('/warrants/watch/runs?limit=1');
          const latest = res.data?.[0];
          if (latest && latest.status !== 'running') {
            if (scanPollRef.current) { clearInterval(scanPollRef.current); scanPollRef.current = null; }
            if (scanTimeoutRef.current) { clearTimeout(scanTimeoutRef.current); scanTimeoutRef.current = null; }
            setScanRunning(false);
            fetchWatchRuns();
            fetchDashStats();
          }
        } catch { /* keep polling */ }
      }, 5000);
      scanTimeoutRef.current = setTimeout(() => {
        if (scanPollRef.current) { clearInterval(scanPollRef.current); scanPollRef.current = null; }
        setScanRunning(false);
      }, 30 * 60 * 1000);
    } catch {
      setScanRunning(false);
    }
  }, [fetchWatchRuns, fetchDashStats]);

  useEffect(() => {
    return () => {
      if (scanPollRef.current) clearInterval(scanPollRef.current);
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    };
  }, []);

  // ============================================================
  // WARRANT HANDLERS (create / edit / serve / delete)
  // ============================================================

  const openNewForm = () => {
    setEditingWarrant(null);
    clearAllErrors();
    setFormData({
      type: 'arrest',
      subject_person_id: '',
      issuing_court: '',
      issuing_judge: '',
      charge_description: '',
      bail_amount: '',
      offense_level: '',
      expires_at: '',
      notes: '',
      statute_id: null,
      statute_citation: '',
    });
    setPersonSearch('');
    setSelectedPersonName('');
    setFormOpen(true);
  };

  const openEditForm = (w: Warrant) => {
    setEditingWarrant(w);
    setFormData({
      type: w.type,
      subject_person_id: w.subject_person_id ? String(w.subject_person_id) : '',
      issuing_court: w.issuing_court || '',
      issuing_judge: w.issuing_judge || '',
      charge_description: w.charge_description,
      bail_amount: w.bail_amount != null ? String(w.bail_amount) : '',
      offense_level: w.offense_level || '',
      expires_at: w.expires_at || '',
      notes: w.notes || '',
      statute_id: (w as any).statute_id || null,
      statute_citation: (w as any).statute_citation || '',
    });
    setSelectedPersonName(w.subject_name || '');
    setPersonSearch('');
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isValid = validateForm(formData, {
      charge_description: { required: true, minLength: 3 },
      type: { required: true },
      bail_amount: {
        custom: (v) => !v || (!isNaN(parseFloat(v)) && parseFloat(v) >= 0),
        customMessage: 'Bail amount must be a non-negative number',
      },
    });
    if (!isValid) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        type: formData.type,
        charge_description: formData.charge_description.trim(),
        subject_person_id: formData.subject_person_id ? parseInt(formData.subject_person_id, 10) : null,
        issuing_court: formData.issuing_court.trim() || null,
        issuing_judge: formData.issuing_judge.trim() || null,
        bail_amount: formData.bail_amount ? parseFloat(formData.bail_amount) : null,
        offense_level: formData.offense_level || null,
        expires_at: formData.expires_at || null,
        notes: formData.notes.trim() || null,
        statute_id: formData.statute_id || null,
        statute_citation: formData.statute_citation || null,
      };

      if (editingWarrant) {
        const updated = await apiFetch<Warrant>(`/warrants/${editingWarrant.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        setWarrants((prev) => prev.map((w) => w.id === editingWarrant.id ? { ...w, ...updated } : w));
        if (selectedWarrant?.id === editingWarrant.id) fetchWarrantDetail(editingWarrant.id);
      } else {
        await apiFetch('/warrants', { method: 'POST', body: JSON.stringify(body) });
        await fetchWarrants({ silent: true });
      }
      setFormOpen(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to save warrant');
    } finally {
      setSubmitting(false);
    }
  };

  const handleServe = async () => {
    if (!selectedWarrant) return;
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

  const handleArchive = async (id: number) => {
    try {
      await apiFetch(`/warrants/${id}/archive`, { method: 'POST' });
      await fetchWarrants({ silent: true });
      if (selectedWarrant?.id === id) setSelectedWarrant(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to archive warrant');
    }
  };

  const handleUnarchive = async (id: number) => {
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

  const handleUpdateStatus = async (id: number, newStatus: string) => {
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

  // ============================================================
  // COMPUTED
  // ============================================================

  const filteredFeed = feedEventFilter
    ? feedEntries.filter(e => e.event === feedEventFilter)
    : feedEntries;

  // Quick search on dashboard (searches priority + feed by name)
  const dashSearchLower = dashSearch.toLowerCase().trim();

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-surface-deep">
      {/* ---- TITLE BAR ---- */}
      <PanelTitleBar title="WARRANTS" icon={AlertTriangle}>
        <RmpgLogo height={16} iconOnly />
        <span className="toolbar-separator" />
        {activeTab === 'warrants' && !showArchived && (
          <button onClick={openNewForm} className="toolbar-btn toolbar-btn-primary text-[9px]">
            <Plus className="w-3 h-3" /> New Warrant
          </button>
        )}
        {activeTab === 'warrants' && (
          <button
            onClick={() => { setShowArchived(!showArchived); setPage(1); }}
            className={`toolbar-btn text-[9px] ${showArchived ? 'text-amber-400' : ''}`}
            title={showArchived ? 'Show active warrants' : 'Show archived warrants'}
          >
            <Archive className="w-3 h-3" />
            {showArchived ? 'Showing Archived' : 'Archives'}
          </button>
        )}
        {isAdminOrManager && (
          <button
            onClick={handleTriggerScan}
            disabled={scanRunning}
            className="toolbar-btn toolbar-btn-primary text-[9px]"
            title="Run warrant scan now"
          >
            {scanRunning
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Scanning...</>
              : <><PlayCircle className="w-3 h-3" /> Run Scan Now</>
            }
          </button>
        )}
        <span className="toolbar-separator" />
        <ExportButton exportUrl="/warrants/export" exportFilename="warrants_export.csv" />
        <PrintButton />
      </PanelTitleBar>

      {/* ---- TAB BAR ---- */}
      <div className={`tab-bar ${isMobile ? 'overflow-x-auto' : ''}`}>
        {TABS.map((tab) => {
          if (tab.roleGated && !isAdminOrManager) return null;
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`tab-bar-item ${isActive ? 'active' : ''}`}
            >
              <Icon className="w-3 h-3" />
              <span className="whitespace-nowrap">{tab.label}</span>
              {tab.id === 'dashboard' && dashStats && dashStats.activeWarrants > 0 && (
                <span className="ml-1 px-1 rounded bg-red-600 text-white text-[8px] font-bold leading-tight">
                  {dashStats.activeWarrants}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ---- STATS BAR ---- */}
      <div className="panel-inset bg-[var(--surface-sunken)] flex items-center gap-0 border-b border-[#1e3048] text-[10px] font-mono flex-wrap">
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-[#1e3048]">
          <span className={`led-dot ${(dashStats?.activeWarrants || 0) > 0 ? 'led-red' : 'led-off'}`} />
          <span className="text-rmpg-400">ACTIVE</span>
          <span className={`font-bold tabular-nums ${(dashStats?.activeWarrants || 0) > 0 ? 'text-red-400' : 'text-rmpg-300'}`}>
            {dashStats?.activeWarrants ?? '-'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-[#1e3048]">
          <span className={`led-dot ${(dashStats?.hitsToday || 0) > 0 ? 'led-amber animate-led-blink' : 'led-off'}`} />
          <span className="text-rmpg-400">HITS TODAY</span>
          <span className={`font-bold tabular-nums ${(dashStats?.hitsToday || 0) > 0 ? 'text-amber-400' : 'text-rmpg-300'}`}>
            {dashStats?.hitsToday ?? '-'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-[#1e3048]">
          <span className="text-rmpg-400">FLAGGED</span>
          <span className="font-bold tabular-nums text-rmpg-300">{dashStats?.personsFlagged ?? '-'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-[#1e3048]">
          <span className={`led-dot ${(dashStats?.sourcesOnline || 0) > 0 ? 'led-green' : 'led-red'}`} />
          <span className="text-rmpg-400">UTAH API</span>
          <span className={`font-bold tabular-nums ${(dashStats?.sourcesOnline || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {dashStats ? ((dashStats.sourcesOnline > 0) ? 'ONLINE' : 'BLOCKED') : '-'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1">
          <span className={`led-dot ${scanRunning ? 'led-green animate-led-pulse' : 'led-off'}`} />
          <span className="text-rmpg-400">SCAN</span>
          <span className={`font-bold ${scanRunning ? 'text-green-400' : 'text-rmpg-500'}`}>
            {scanRunning ? 'RUNNING' : 'IDLE'}
          </span>
        </div>
      </div>

      {/* ================================================================
          TAB 1: DASHBOARD
         ================================================================ */}
      {activeTab === 'dashboard' && (
        <div className="flex-1 overflow-auto">
          <div className="p-4 space-y-4">
            {/* Quick Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-rmpg-500" />
              <input
                type="text"
                className="input-dark w-full pl-9 text-xs"
                placeholder="Quick search warrants by name, number, or charge..."
                value={dashSearch}
                onChange={(e) => setDashSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && dashSearch.trim()) {
                    setSearchQuery(dashSearch.trim());
                    setActiveTab('warrants');
                  }
                }}
              />
              {dashSearch && (
                <button onClick={() => setDashSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Stat Cards */}
            <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-3`}>
              <div className={`panel-inset p-3 rounded-sm text-center ${(dashStats?.activeWarrants || 0) > 0 ? 'bg-red-900/20 border border-red-900/40' : 'bg-surface-sunken'}`}>
                <div className={`text-2xl font-bold font-mono tabular-nums ${(dashStats?.activeWarrants || 0) > 0 ? 'text-red-400' : 'text-white'}`}>
                  {dashStatsLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (dashStats?.activeWarrants ?? 0)}
                </div>
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Active Warrants</div>
              </div>
              <div className={`panel-inset p-3 rounded-sm text-center ${(dashStats?.hitsToday || 0) > 0 ? 'bg-amber-900/20 border border-amber-900/40' : 'bg-surface-sunken'}`}>
                <div className={`text-2xl font-bold font-mono tabular-nums ${(dashStats?.hitsToday || 0) > 0 ? 'text-amber-400' : 'text-white'}`}>
                  {dashStatsLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (dashStats?.hitsToday ?? 0)}
                </div>
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Hits Today</div>
              </div>
              <div className="panel-inset bg-surface-sunken p-3 rounded-sm text-center">
                <div className="text-2xl font-bold font-mono tabular-nums text-white">
                  {dashStatsLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (dashStats?.personsFlagged ?? 0)}
                </div>
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Persons Flagged</div>
              </div>
              <div className={`panel-inset p-3 rounded-sm text-center ${dashStats && dashStats.sourcesOnline === 0 ? 'bg-red-900/10 border border-red-900/30' : 'bg-surface-sunken'}`}>
                <div className={`text-2xl font-bold font-mono tabular-nums ${!dashStats ? 'text-white' : dashStats.sourcesOnline > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {dashStatsLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : dashStats ? (dashStats.sourcesOnline > 0 ? 'ONLINE' : 'BLOCKED') : '-'}
                </div>
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Utah API</div>
              </div>
            </div>

            {/* Main content: Feed (left) + Priority (right) */}
            <div className={`${isMobile ? 'space-y-4' : 'flex gap-4'}`}>
              {/* Alert Feed — left 65% */}
              <div className={`${isMobile ? '' : 'w-[65%]'} flex flex-col`}>
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-brand-400" />
                    Alert Feed
                  </h2>
                  <div className="flex gap-1 ml-auto">
                    {FEED_RANGES.map(r => (
                      <button
                        key={r}
                        onClick={() => setFeedRange(r)}
                        className={`px-1.5 py-0.5 text-[9px] font-bold rounded-sm border transition-colors ${
                          feedRange === r
                            ? 'bg-brand-900/40 text-brand-300 border-brand-600/50'
                            : 'bg-rmpg-800/50 text-rmpg-400 border-rmpg-700/50 hover:text-rmpg-200'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                    <select
                      className="input-dark text-[9px] py-0 px-1 w-24 ml-1"
                      value={feedEventFilter}
                      onChange={(e) => setFeedEventFilter(e.target.value)}
                    >
                      <option value="">All Events</option>
                      <option value="warrant_found">Found</option>
                      <option value="warrant_cleared">Cleared</option>
                    </select>
                  </div>
                </div>

                <div className="panel-inset bg-surface-sunken rounded-sm flex-1 max-h-[400px] overflow-auto">
                  {feedLoading ? (
                    <div className="flex items-center justify-center h-32 text-rmpg-400">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading feed...
                    </div>
                  ) : filteredFeed.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-rmpg-500 text-xs">
                      No events in this time range
                    </div>
                  ) : (
                    <div className="divide-y divide-rmpg-800/50">
                      {filteredFeed.map(entry => (
                        <div key={entry.id} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-raised/50 transition-colors">
                          <span className="text-[9px] text-rmpg-500 font-mono shrink-0 w-14">{relativeTime(entry.created_at)}</span>
                          <button
                            onClick={() => entry.person_id && openPersonProfile(entry.person_id)}
                            className="text-xs font-medium text-brand-300 hover:text-brand-200 transition-colors truncate"
                            title="View person profile"
                          >
                            {entry.person_name}
                          </button>
                          <span className={`inline-flex px-1.5 py-0.5 text-[8px] font-bold rounded border shrink-0 ${
                            entry.event === 'warrant_found' || entry.event === 'FOUND'
                              ? 'bg-red-900/50 text-red-400 border-red-700/50'
                              : 'bg-green-900/50 text-green-400 border-green-700/50'
                          }`}>
                            {entry.event === 'warrant_found' || entry.event === 'FOUND' ? 'FOUND' : 'CLEARED'}
                          </span>
                          {entry.charges && (
                            <span className="text-[9px] text-rmpg-400 truncate max-w-[180px]">{chargesFromJson(entry.charges)}</span>
                          )}
                          {entry.court_name && (
                            <span className="text-[9px] text-rmpg-500 truncate ml-auto shrink-0">{entry.court_name}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Priority Warrants — right 35% */}
              <div className={`${isMobile ? '' : 'w-[35%]'} flex flex-col`}>
                <h2 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  Priority Warrants
                </h2>

                <div className="space-y-2 max-h-[400px] overflow-auto">
                  {priorityLoading ? (
                    <div className="panel-inset bg-surface-sunken rounded-sm flex items-center justify-center h-32 text-rmpg-400">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...
                    </div>
                  ) : priorityWarrants.length === 0 ? (
                    <div className="panel-inset bg-surface-sunken rounded-sm flex items-center justify-center h-32 text-rmpg-500 text-xs">
                      No priority warrants
                    </div>
                  ) : (
                    priorityWarrants.map(pw => (
                      <div key={pw.id} className="panel-inset bg-surface-sunken p-2.5 rounded-sm border border-red-900/20 hover:border-red-900/40 transition-colors">
                        <div className="flex items-start gap-2">
                          {pw.subject_photo_url ? (
                            <img src={pw.subject_photo_url} alt="" className="w-9 h-9 rounded-sm object-cover border border-rmpg-600 shrink-0" />
                          ) : (
                            <div className="w-9 h-9 rounded-sm bg-rmpg-800 border border-rmpg-600 flex items-center justify-center shrink-0">
                              <User className="w-4 h-4 text-rmpg-500" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-white truncate">
                                {[pw.subject_first_name, pw.subject_last_name].filter(Boolean).join(' ') || 'Unknown'}
                              </span>
                              <span className={`inline-flex px-1 py-0.5 text-[8px] font-bold rounded border ${
                                pw.offense_level === 'felony' ? SEVERITY_COLORS.felony
                                  : pw.offense_level === 'misdemeanor' ? SEVERITY_COLORS.misdemeanor
                                  : 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50'
                              }`}>
                                {(pw.offense_level || pw.type || 'WARRANT').toUpperCase()}
                              </span>
                            </div>
                            <div className="text-[10px] text-rmpg-300 truncate mt-0.5">{pw.charge_description}</div>
                            <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-400">
                              {pw.bail_amount != null && pw.bail_amount > 0 && (
                                <span className="text-green-400 font-mono font-bold">{formatCurrency(pw.bail_amount)}</span>
                              )}
                              {pw.source && (
                                <span className="inline-flex px-1 py-0.5 text-[8px] rounded bg-blue-900/30 text-blue-300 border border-blue-700/30">
                                  {pw.source}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================
          TAB 2: WARRANTS (Unified List)
         ================================================================ */}
      {activeTab === 'warrants' && (
        <div className={`flex-1 ${isMobile ? 'flex flex-col' : 'flex'} overflow-hidden`}>
          {/* LEFT: Warrant List */}
          <div className={`${isMobile ? (selectedWarrant ? 'hidden' : 'flex-1') : 'w-[55%]'} flex flex-col ${!isMobile ? 'border-r border-rmpg-600' : ''}`}>
            {/* Filters */}
            <div className={`flex ${isMobile ? 'flex-col gap-1.5' : 'items-center gap-2'} px-3 py-2 border-b border-rmpg-700 bg-surface-sunken`}>
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" />
                <input
                  type="text"
                  className={`input-dark w-full pl-7 ${isMobile ? 'text-sm py-2.5' : 'text-xs'}`}
                  placeholder="Search by name, warrant #, or charge..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                  style={isMobile ? { minHeight: 44 } : undefined}
                />
              </div>
              <div className={`flex ${isMobile ? 'gap-1.5 flex-wrap' : 'gap-2'}`}>
                <select
                  className={`input-dark ${isMobile ? 'flex-1 text-sm py-2' : 'text-xs w-24'}`}
                  value={filterStatus}
                  onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
                  style={isMobile ? { minHeight: 44 } : undefined}
                >
                  <option value="">All Status</option>
                  {WARRANT_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <select
                  className={`input-dark ${isMobile ? 'flex-1 text-sm py-2' : 'text-xs w-24'}`}
                  value={filterType}
                  onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
                  style={isMobile ? { minHeight: 44 } : undefined}
                >
                  <option value="">All Types</option>
                  {WARRANT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <select
                  className={`input-dark ${isMobile ? 'flex-1 text-sm py-2' : 'text-xs w-28'}`}
                  value={filterSeverity}
                  onChange={(e) => { setFilterSeverity(e.target.value); setPage(1); }}
                  style={isMobile ? { minHeight: 44 } : undefined}
                >
                  <option value="">All Severity</option>
                  {OFFENSE_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="px-3 py-2 bg-red-900/30 border-b border-red-700/50 text-red-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-3 h-3" /> {error}
                <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300"><X className="w-3 h-3" /></button>
              </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="flex items-center justify-center h-full text-rmpg-400">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading warrants...
                </div>
              ) : warrants.length === 0 ? (
                <EmptyState
                  icon={Gavel}
                  title={showArchived ? 'No archived warrants' : 'No warrants found'}
                  description={!showArchived ? 'Create a new warrant to get started' : undefined}
                  action={!showArchived ? { label: 'New Warrant', onClick: openNewForm } : undefined}
                />
              ) : isMobile ? (
                <div>
                  {warrants.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => fetchWarrantDetail(w.id)}
                      className={`w-full text-left px-3 py-3 border-b border-rmpg-800 transition-colors hover:bg-surface-raised ${selectedWarrant?.id === w.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent'}`}
                      style={{ minHeight: 56 }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-mono font-bold text-white">{w.warrant_number || '-'}</span>
                        <div className="flex items-center gap-1">
                          <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded border ${TYPE_COLORS[w.type] || TYPE_COLORS.other}`}>
                            {w.type.toUpperCase()}
                          </span>
                          <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded border ${STATUS_COLORS[w.status] || ''}`}>
                            {w.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <div className="text-sm text-rmpg-200 font-medium">{w.subject_name || 'Unknown'}</div>
                      <div className="text-xs text-rmpg-400 truncate mt-0.5">{w.charge_description}</div>
                      <div className="text-[10px] text-rmpg-500 mt-0.5">
                        {formatDate(w.created_at)}{w.offense_level ? ` \u2022 ${w.offense_level}` : ''}
                        {w.source ? ` \u2022 ${w.source}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <table className="table-dark">
                  <thead>
                    <tr>
                      <th style={{ width: 80 }}>Status</th>
                      <th style={{ width: 120 }}>Warrant #</th>
                      <th>Subject</th>
                      <th style={{ width: 80 }}>Type</th>
                      <th>Charge</th>
                      <th style={{ width: 80 }}>Severity</th>
                      <th style={{ width: 90 }}>Court</th>
                      <th style={{ width: 80 }}>Bail</th>
                      <th style={{ width: 95 }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warrants.map((w) => (
                      <tr
                        key={w.id}
                        onClick={() => fetchWarrantDetail(w.id)}
                        className={`cursor-pointer ${selectedWarrant?.id === w.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : ''}`}
                      >
                        <td>
                          <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded border ${STATUS_COLORS[w.status] || ''}`}>
                            {w.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="font-mono text-xs text-white font-bold">{w.warrant_number || '-'}</td>
                        <td className="text-xs">
                          <div className="flex items-center gap-2">
                            {w.subject_photo_url ? (
                              <img src={w.subject_photo_url} alt="" className="w-6 h-6 rounded-sm object-cover border border-rmpg-600" />
                            ) : null}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (w.subject_person_id) openPersonProfile(w.subject_person_id);
                              }}
                              className={`text-rmpg-200 ${w.subject_person_id ? 'hover:text-brand-300 cursor-pointer' : ''}`}
                            >
                              {w.subject_name || <span className="text-rmpg-500">Unknown</span>}
                            </button>
                          </div>
                        </td>
                        <td>
                          <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded border ${TYPE_COLORS[w.type] || TYPE_COLORS.other}`}>
                            {w.type.toUpperCase()}
                          </span>
                        </td>
                        <td className="text-xs text-rmpg-300 truncate max-w-[200px]">{w.charge_description}</td>
                        <td>
                          {w.offense_level ? (
                            <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded border ${SEVERITY_COLORS[w.offense_level] || 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50'}`}>
                              {w.offense_level.toUpperCase()}
                            </span>
                          ) : <span className="text-rmpg-500">-</span>}
                        </td>
                        <td className="text-[10px] text-rmpg-400 truncate">{w.issuing_court || '-'}</td>
                        <td className="text-xs text-rmpg-400 font-mono">{w.bail_amount ? formatCurrency(w.bail_amount) : '-'}</td>
                        <td className="text-xs text-rmpg-400">{formatDate(w.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-3 py-1.5 border-t border-rmpg-700 bg-surface-sunken">
                <span className={`${isMobile ? 'text-xs' : 'text-[10px]'} text-rmpg-400`}>
                  Page {page} of {totalPages} ({totalCount} results)
                </span>
                <div className="flex gap-1">
                  <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="toolbar-btn text-[9px]">Prev</button>
                  <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="toolbar-btn text-[9px]">Next</button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Warrant Detail */}
          <div className={`${isMobile ? (selectedWarrant ? 'flex-1' : 'hidden') : 'flex-1'} flex flex-col overflow-hidden`}>
            <div className={`flex ${isMobile ? 'flex-wrap gap-1' : 'items-center gap-1'} px-3 py-1 border-b border-[#1e3048] bg-[var(--grid-header-bg)]`}>
              <Gavel className="w-3 h-3 text-brand-400" />
              <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Warrant Detail</span>
              <span className="flex-1" />
              {isMobile && selectedWarrant && (
                <button onClick={() => setSelectedWarrant(null)} className="toolbar-btn text-[9px]" style={isMobile ? { minHeight: 44 } : undefined}>&larr; Back</button>
              )}
              <PrintRecordButton recordType="warrant" recordData={selectedWarrant} identifier={selectedWarrant?.warrant_number} entityType="warrant" entityId={selectedWarrant?.id} label="Print" />
              {selectedWarrant && !selectedWarrant.archived_at && (
                <>
                  {selectedWarrant.status === 'active' && (
                    <>
                      <button onClick={() => { setServeLocation(''); setServeModalOpen(true); }} className="toolbar-btn toolbar-btn-primary text-[9px]" style={isMobile ? { minHeight: 48 } : undefined}>
                        <CheckCircle className="w-3 h-3" /> Serve
                      </button>
                      <button onClick={() => openEditForm(selectedWarrant)} className="toolbar-btn text-[9px]" style={isMobile ? { minHeight: 48 } : undefined}>
                        <Edit className="w-3 h-3" /> Edit
                      </button>
                      <button onClick={() => handleUpdateStatus(selectedWarrant.id, 'recalled')} className="toolbar-btn text-[9px] text-amber-400" style={isMobile ? { minHeight: 48 } : undefined}>
                        <XCircle className="w-3 h-3" /> Recall
                      </button>
                    </>
                  )}
                  {selectedWarrant.status !== 'active' && (
                    <>
                      <button onClick={() => handleArchive(selectedWarrant.id)} className="toolbar-btn text-[9px]" title="Archive this warrant" style={isMobile ? { minHeight: 48 } : undefined}>
                        <Archive className="w-3 h-3" /> Archive
                      </button>
                      <button onClick={() => setDeletingWarrant(selectedWarrant)} className="toolbar-btn text-[9px] text-red-400" title="Permanently delete" style={isMobile ? { minHeight: 48 } : undefined}>
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </>
                  )}
                </>
              )}
              {selectedWarrant?.archived_at && (
                <button onClick={() => handleUnarchive(selectedWarrant.id)} className="toolbar-btn text-[9px] text-amber-400" style={isMobile ? { minHeight: 48 } : undefined}>
                  <RotateCcw className="w-3 h-3" /> Unarchive
                </button>
              )}
            </div>

            {selectedWarrant ? (
              <div className="flex-1 overflow-auto p-4 space-y-4">
                {/* Header */}
                <div className="panel-beveled p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h2 className="text-lg font-bold text-white font-mono">{selectedWarrant.warrant_number}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold rounded border ${TYPE_COLORS[selectedWarrant.type] || TYPE_COLORS.other}`}>
                          {selectedWarrant.type.toUpperCase()} WARRANT
                        </span>
                        <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold rounded border ${STATUS_COLORS[selectedWarrant.status] || ''}`}>
                          {selectedWarrant.status.toUpperCase()}
                        </span>
                        {selectedWarrant.offense_level && (
                          <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold rounded border ${SEVERITY_COLORS[selectedWarrant.offense_level] || 'bg-rmpg-700/40 text-rmpg-200 border-rmpg-600/50'}`}>
                            {selectedWarrant.offense_level.toUpperCase()}
                          </span>
                        )}
                        {selectedWarrant.archived_at && (
                          <span className="inline-flex px-2 py-0.5 text-[10px] font-bold rounded border bg-amber-900/40 text-amber-300 border-amber-700/50">
                            ARCHIVED
                          </span>
                        )}
                      </div>
                    </div>
                    {selectedWarrant.bail_amount != null && selectedWarrant.bail_amount > 0 && (
                      <div className="text-right">
                        <span className="text-[10px] text-rmpg-400 uppercase">Bail</span>
                        <div className="text-lg font-bold text-green-400 font-mono">{formatCurrency(selectedWarrant.bail_amount)}</div>
                      </div>
                    )}
                  </div>

                  {/* Statute + Charge */}
                  {(selectedWarrant as any).statute_citation && (
                    <div className="mb-2">
                      <span className="text-[10px] text-rmpg-400 uppercase font-bold">Statute</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand-900/30 text-brand-300 border border-brand-700/40 text-xs font-mono font-bold">
                          <Scale className="w-3 h-3" />
                          {(selectedWarrant as any).statute_citation}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="mb-3">
                    <span className="text-[10px] text-rmpg-400 uppercase font-bold">Charge Description</span>
                    <p className="text-sm text-white mt-0.5">{selectedWarrant.charge_description}</p>
                  </div>

                  {/* Dates row */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-rmpg-400">Entered</span>
                      <div className="text-rmpg-200 mt-0.5">{formatDateTime(selectedWarrant.created_at)}</div>
                      <div className="text-rmpg-400 text-[10px]">by {selectedWarrant.entered_by_name || 'Unknown'}</div>
                    </div>
                    {selectedWarrant.expires_at && (
                      <div>
                        <span className="text-rmpg-400">Expires</span>
                        <div className="text-amber-300 mt-0.5">{formatDate(selectedWarrant.expires_at)}</div>
                      </div>
                    )}
                    {selectedWarrant.served_at && (
                      <div>
                        <span className="text-rmpg-400">Served</span>
                        <div className="text-green-300 mt-0.5">{formatDateTime(selectedWarrant.served_at)}</div>
                        {selectedWarrant.served_by_name && <div className="text-rmpg-400 text-[10px]">by {selectedWarrant.served_by_name}</div>}
                        {selectedWarrant.served_location && (
                          <div className="text-rmpg-400 text-[10px] flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3" /> {selectedWarrant.served_location}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Subject Info */}
                {selectedWarrant.subject_name && (
                  <div className="panel-beveled p-4">
                    <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                      <User className="w-4 h-4 text-brand-400" /> Subject Information
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-rmpg-400">Name</span>
                        <div className="text-white font-bold">{selectedWarrant.subject_name}</div>
                      </div>
                      {selectedWarrant.subject_dob && (
                        <div>
                          <span className="text-rmpg-400">DOB</span>
                          <div className="text-rmpg-200">{formatDate(selectedWarrant.subject_dob)}</div>
                        </div>
                      )}
                      {selectedWarrant.subject_gender && (
                        <div>
                          <span className="text-rmpg-400">Gender</span>
                          <div className="text-rmpg-200">{selectedWarrant.subject_gender}</div>
                        </div>
                      )}
                      {selectedWarrant.subject_race && (
                        <div>
                          <span className="text-rmpg-400">Race</span>
                          <div className="text-rmpg-200">{selectedWarrant.subject_race}</div>
                        </div>
                      )}
                      {selectedWarrant.subject_height && (
                        <div>
                          <span className="text-rmpg-400">Height</span>
                          <div className="text-rmpg-200">{selectedWarrant.subject_height}</div>
                        </div>
                      )}
                      {selectedWarrant.subject_weight && (
                        <div>
                          <span className="text-rmpg-400">Weight</span>
                          <div className="text-rmpg-200">{selectedWarrant.subject_weight}</div>
                        </div>
                      )}
                      {selectedWarrant.subject_hair_color && (
                        <div>
                          <span className="text-rmpg-400">Hair</span>
                          <div className="text-rmpg-200">{selectedWarrant.subject_hair_color}</div>
                        </div>
                      )}
                      {selectedWarrant.subject_eye_color && (
                        <div>
                          <span className="text-rmpg-400">Eyes</span>
                          <div className="text-rmpg-200">{selectedWarrant.subject_eye_color}</div>
                        </div>
                      )}
                      {selectedWarrant.subject_address && (
                        <div className="col-span-2">
                          <span className="text-rmpg-400">Address</span>
                          <div className="text-rmpg-200">{selectedWarrant.subject_address}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Court Info */}
                {(selectedWarrant.issuing_court || selectedWarrant.issuing_judge) && (
                  <div className="panel-beveled p-4">
                    <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                      <Gavel className="w-4 h-4 text-brand-400" /> Court Information
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {selectedWarrant.issuing_court && (
                        <div>
                          <span className="text-rmpg-400">Issuing Court</span>
                          <div className="text-rmpg-200">{selectedWarrant.issuing_court}</div>
                        </div>
                      )}
                      {selectedWarrant.issuing_judge && (
                        <div>
                          <span className="text-rmpg-400">Issuing Judge</span>
                          <div className="text-rmpg-200">{selectedWarrant.issuing_judge}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {selectedWarrant.notes && (
                  <div className="panel-beveled p-4">
                    <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2">Notes</h3>
                    <p className="text-xs text-rmpg-200 whitespace-pre-wrap">{selectedWarrant.notes}</p>
                  </div>
                )}

                {/* Activity Log */}
                {selectedWarrant.activity && selectedWarrant.activity.length > 0 && (
                  <div className="panel-beveled p-4">
                    <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                      <Clock className="w-4 h-4 text-brand-400" /> Activity Log
                    </h3>
                    <div className="space-y-2">
                      {selectedWarrant.activity.map((a) => (
                        <div key={a.id} className="flex items-start gap-2 text-xs">
                          <span className="text-rmpg-500 text-[10px] whitespace-nowrap mt-0.5">{formatDateTime(a.created_at)}</span>
                          <span className="text-rmpg-300">{a.details}</span>
                          <span className="text-rmpg-500 ml-auto whitespace-nowrap">{a.user_name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
      )}

      {/* ================================================================
          TAB: PERSON INTEL (utah_search)
         ================================================================ */}
      {activeTab === 'utah_search' && (
        <div className="flex-1 overflow-auto">
          <PersonIntelPanel
            apiAvailable={(dashStats?.sourcesOnline ?? 1) > 0}
            onNavigatePerson={personId => {
              window.location.href = `/records?person=${personId}`;
            }}
          />
        </div>
      )}

      {/* ================================================================
          TAB: WATCH HITS
         ================================================================ */}
      {activeTab === 'watch_hits' && (
        <div className="flex-1 overflow-auto">
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-mono text-rmpg-400 uppercase tracking-wider">
                Warrant Watch Event Log
              </div>
              <button onClick={fetchWatchHits} disabled={watchHitsLoading} className="toolbar-btn text-[10px]">
                {watchHitsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Refresh'}
              </button>
            </div>
            {watchHitsLoading && <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-rmpg-400" /></div>}
            {!watchHitsLoading && watchHits.length === 0 && (
              <div className="panel-inset p-6 text-center text-rmpg-400 text-sm">No watch hits recorded</div>
            )}
            {watchHits.map((hit: any) => (
              <div key={hit.id} className="panel-raised p-3 rounded-sm border border-rmpg-700/30 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-white">{hit.person_name || `Person #${hit.person_id}`}</span>
                    {hit.resolvedSeverity && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${SEVERITY_BADGE[hit.resolvedSeverity] || ''}`}>
                        {hit.resolvedSeverity.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-rmpg-400">
                    {hit.event} · {formatDate(hit.created_at)}
                  </div>
                  {hit.charges && (
                    <div className="text-[10px] text-rmpg-500 truncate">
                      {(() => { try { return JSON.parse(hit.charges).join(', '); } catch { return hit.charges; } })()}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { setLinkCallTarget(hit); fetchOpenCalls(); }}
                  className="toolbar-btn text-[10px] shrink-0"
                >
                  LINK TO CALL
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Link-to-call picker modal */}
      {linkCallTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setLinkCallTarget(null)}>
          <div className="panel-raised p-4 rounded-sm w-80 max-h-96 overflow-y-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <div className="text-sm font-bold text-white mb-3">Link to Open Call</div>
            <div className="text-[11px] text-rmpg-400 mb-3">
              Warrant hit: {linkCallTarget.person_name}
            </div>
            {openCalls.length === 0 && <div className="text-[11px] text-rmpg-400">No open calls</div>}
            {openCalls.map((call: any) => (
              <button
                key={call.id}
                onClick={() => linkHitToCall(linkCallTarget, call.id)}
                disabled={linkingId === call.id}
                className="w-full text-left toolbar-btn mb-1 text-[11px]"
              >
                {linkingId === call.id ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                {call.call_number} — {call.incident_type} — {call.location_address}
              </button>
            ))}
            <button onClick={() => setLinkCallTarget(null)} className="toolbar-btn w-full mt-2 text-[11px]">Cancel</button>
          </div>
        </div>
      )}

      {/* MOBILE FAB */}
      {isMobile && activeTab === 'warrants' && !selectedWarrant && !showArchived && !formOpen && (
        <button onClick={openNewForm} className="mobile-fab" aria-label="New Warrant">
          <Plus className="w-6 h-6" />
        </button>
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
    </div>
  );
}
