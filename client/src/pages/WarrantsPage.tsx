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
  Globe,
  Shield,
  FileText,
  Activity,
  ChevronRight,
  Zap,
  Printer,
  Download,
  UserCheck,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
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
import { useFormDraft } from '../hooks/useFormDraft';
import EmptyState from '../components/EmptyState';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import FloatingSaveBar from '../components/FloatingSaveBar';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { useAuth } from '../context/AuthContext';
import { downloadRecordPdf, generateBoloPdf, generateWarrantSummaryPdf } from '../utils/recordPdfGenerator';
import type { WarrantPdfData, BoloSubject, WarrantSummaryData } from '../utils/recordPdfGenerator';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { loadGoogleMaps, DARK_MAP_STYLE } from '../utils/googleMapsLoader';
import ScrapersTab from './warrants/ScrapersTab';

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
  service_attempt_count: number;
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

// Utah Search types
interface UtahWarrantResult {
  warrant_id?: string;
  utah_warrant_id?: string;
  utah_person_id?: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  age?: number;
  city?: string;
  issue_date?: string;
  court_name?: string;
  case_id?: string;
  charges?: string;
  charge_description?: string;
  bail_amount?: number;
  offense_level?: string;
  warrant_type?: string;
  status?: string;
  fetched_at?: string;
  source_key?: string;
}

interface UtahSearchResults {
  utahResults: UtahWarrantResult[];
  localWarrants: Warrant[];
  scrapedWarrants: UtahWarrantResult[];
  source: 'live' | 'cache';
  blocked: boolean;
  searchedAt: string;
  totalHits: number;
}

interface UnifiedSearchResults {
  local: Warrant[];
  utah: UtahWarrantResult[];
  scraped: UtahWarrantResult[];
  meta: {
    duration: number;
    sources: string[];
    utahBlocked: boolean;
    searchedAt: string;
    totalHits: number;
  };
}

interface AutoPollStatus {
  syncStatus: { lastSync: string | null; warrantCount: number; status: string; lastError: string | null };
  blocked: boolean;
  runs: WatchRun[];
  flaggedPersons: WatchPerson[];
  recentHits: { id: number; person_id: number; person_name: string; event: string; charges?: string; court_name?: string; created_at: string }[];
  totalPersons: number;
}

interface WatchPerson {
  id: number;
  first_name: string;
  last_name: string;
  dob?: string;
  gender?: string;
  race?: string;
  height?: string;
  weight?: string;
  hair_color?: string;
  eye_color?: string;
  address?: string;
  photo_url?: string | null;
  warrant_severity: string | null;
  local_warrant_count: number;
  utah_hit_count: number;
  warrants: { id: number; warrant_number: string; type: string; status: string; charge_description: string; offense_level: string | null; bail_amount: number | null; issuing_court: string | null; source: string | null; created_at: string }[];
  utahWarrants: { utah_warrant_id: string; charges: string; court_name: string; issue_date: string }[];
}

// Coverage / Sources
interface ScraperSource {
  id: number;
  source_key: string;
  state: string;
  county: string;
  source_url: string;
  parser_type: string;
  enabled: number;
  scrape_interval_minutes: number;
  last_scraped_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  active_warrants: number;
  total_warrants: number;
  auto_recovering: boolean;
  backoff_attempt: number;
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
  search: 'bg-gray-900/40 text-gray-300 border-gray-700/50',
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

type TabId = 'dashboard' | 'warrants' | 'search-all' | 'watch' | 'sources' | 'scrapers';

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }>; roleGated?: boolean }[] = [
  { id: 'dashboard', label: 'DASHBOARD', icon: Activity },
  { id: 'warrants', label: 'WARRANTS', icon: Gavel },
  { id: 'search-all', label: 'SEARCH ALL', icon: Globe },
  { id: 'watch', label: 'WATCH LIST', icon: Radar },
  { id: 'sources', label: 'SOURCES', icon: Shield, roleGated: true },
  { id: 'scrapers', label: 'SCRAPERS', icon: Zap, roleGated: true },
];

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
// Sub-components
// ============================================================

function CoverageSourceCard({ source }: { source: ScraperSource }) {
  const isRecent = source.last_scraped_at &&
    (Date.now() - new Date(source.last_scraped_at.replace(' ', 'T')).getTime()) < 3 * 60 * 60 * 1000;
  return (
    <div className={`p-2 rounded-sm border ${
      !source.enabled
        ? 'border-rmpg-700/50 bg-rmpg-700/30'
        : source.consecutive_failures > 0
          ? 'border-amber-700/50 bg-amber-900/10'
          : isRecent
            ? 'border-green-700/50 bg-green-900/10'
            : 'border-brand-600/30 bg-brand-900/10'
    }`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-white">{source.county || source.source_key}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${
          !source.enabled ? 'bg-rmpg-600' : isRecent ? 'bg-green-400' : source.consecutive_failures > 0 ? 'bg-amber-400' : 'bg-brand-400'
        }`} />
      </div>
      <div className="flex items-center justify-between mt-1 text-[9px] text-rmpg-400">
        <span>{source.active_warrants} active / {source.total_warrants} total</span>
        <span>{source.scrape_interval_minutes}m</span>
      </div>
      {source.last_scraped_at && (
        <div className="text-[8px] text-rmpg-500 mt-0.5">
          Last: {formatDateTime(source.last_scraped_at)}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Component
// ============================================================

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function WarrantsPage() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const navigate = useNavigate();
  const warrantFormTitleId = useId();
  const serveTitleId = useId();

  const [searchParams] = useSearchParams();
  const initialPersonId = searchParams.get('personId');

  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';
  const isGodMode = user?.role === 'admin'; // Admin God Mode — unrestricted access

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<TabId>(initialPersonId ? 'warrants' : 'dashboard');
  const [filterPersonId, setFilterPersonId] = useState<string | null>(initialPersonId);

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
  const [expiringCount, setExpiringCount] = useState<number | null>(null);
  const [summaryReportOpen, setSummaryReportOpen] = useState(false);
  const [summaryFrom, setSummaryFrom] = useState('');
  const [summaryTo, setSummaryTo] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);

  // ============================================================
  // WARRANTS TAB STATE
  // ============================================================
  const [warrants, setWarrants] = useState<UnifiedWarrant[]>([]);
  const [selectedWarrant, setSelectedWarrant] = useState<Warrant | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterSource, setFilterSource] = useState<string>('');
  const [filterCourt, setFilterCourt] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);

  // Batch selection
  const [batchSelected, setBatchSelected] = useState<Set<number>>(new Set());
  const [batchStatus, setBatchStatus] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  const toggleBatchSelect = (id: number) => {
    setBatchSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (batchSelected.size === warrants.length) {
      setBatchSelected(new Set());
    } else {
      setBatchSelected(new Set(warrants.map(w => w.id)));
    }
  };
  const handleBatchUpdate = async () => {
    if (batchSelected.size === 0 || !batchStatus) return;
    if (!confirm(`Update ${batchSelected.size} warrants to "${batchStatus}"?`)) return;
    setBatchSubmitting(true);
    try {
      await apiFetch('/warrants/batch-update', {
        method: 'PUT',
        body: JSON.stringify({ ids: Array.from(batchSelected), status: batchStatus }),
      });
      setBatchSelected(new Set());
      setBatchStatus('');
      fetchWarrants({ silent: true });
    } catch (err: any) { alert(err?.message || 'Batch update failed'); }
    finally { setBatchSubmitting(false); }
  };

  // Form modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingWarrant, setEditingWarrant] = useState<Warrant | null>(null);
  const EMPTY_FORM = {
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
  };
  const {
    form: formData,
    setForm: setFormData,
    isDirty: formIsDirty,
    wasRestored: formWasRestored,
    clearDraft: clearFormDraft,
    snapshot: snapshotForm,
  } = useFormDraft<typeof EMPTY_FORM>({
    storageKey: 'rmpg_warrant_form',
    defaultValue: EMPTY_FORM,
    isActive: formOpen,
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

  // ============================================================
  // UNIFIED SEARCH TAB STATE
  // ============================================================
  const [uniSearchFirst, setUniSearchFirst] = useState('');
  const [uniSearchLast, setUniSearchLast] = useState('');
  const [uniSearchDob, setUniSearchDob] = useState('');
  const [uniSearchWarrantNum, setUniSearchWarrantNum] = useState('');
  const [uniSearchCourt, setUniSearchCourt] = useState('');
  const [uniSearchSource, setUniSearchSource] = useState('');
  const [uniSearchOffenseLevel, setUniSearchOffenseLevel] = useState('');
  const [uniSearchStatus, setUniSearchStatus] = useState('');
  const [uniSearchType, setUniSearchType] = useState('');
  const [uniSearchCharge, setUniSearchCharge] = useState('');
  const [uniSearchDateFrom, setUniSearchDateFrom] = useState('');
  const [uniSearchDateTo, setUniSearchDateTo] = useState('');
  const [uniSearching, setUniSearching] = useState(false);
  const [uniResults, setUniResults] = useState<UnifiedSearchResults | null>(null);
  const [uniAdvancedOpen, setUniAdvancedOpen] = useState(false);
  const [uniSearchHistory, setUniSearchHistory] = useState<{ first: string; last: string; hits: number; at: string }[]>([]);
  const [nameTypeahead, setNameTypeahead] = useState<Person[]>([]);
  const [nameTypeaheadLoading, setNameTypeaheadLoading] = useState(false);
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Utah warrant detail modal (shared for unified search results)
  const [utahDetailWarrant, setUtahDetailWarrant] = useState<(UtahWarrantResult & { _source: 'utah' | 'local' | 'scraped' }) | null>(null);
  const [addingToLocal, setAddingToLocal] = useState(false);
  const [addedToLocal, setAddedToLocal] = useState(false);

  // ============================================================
  // WATCH LIST TAB STATE
  // ============================================================
  const [autoPollStatus, setAutoPollStatus] = useState<AutoPollStatus | null>(null);
  const [autoPollLoading, setAutoPollLoading] = useState(false);
  const [watchSort, setWatchSort] = useState<'severity' | 'recent' | 'name'>('severity');
  const [watchMapOpen, setWatchMapOpen] = useState(false);
  const [expandedWatchPersons, setExpandedWatchPersons] = useState<Set<number>>(new Set());
  const watchMapRef = useRef<HTMLDivElement>(null);
  const watchMapInstance = useRef<any>(null);

  // ============================================================
  // SOURCES TAB STATE
  // ============================================================
  const [coverageSources, setCoverageSources] = useState<ScraperSource[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [watchRuns, setWatchRuns] = useState<WatchRun[]>([]);
  const [watchRunsLoading, setWatchRunsLoading] = useState(false);
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scanRunning, setScanRunning] = useState(false);

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
      const res = await apiFetch<{ data: FeedEntry[] }>(`/warrants/dashboard/feed?range=${FEED_RANGE_PARAMS[feedRange]}&limit=50`);
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
    apiFetch<{ count: number }>('/warrants/expiring?days=30').then(r => setExpiringCount(r.count)).catch(() => {});
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
      if (filterSource) params.set('source', filterSource);
      if (filterCourt) params.set('court', filterCourt);
      if (filterSeverity) params.set('severity', filterSeverity);
      if (filterPersonId) params.set('person_id', filterPersonId);
      if (searchQuery) params.set('subject_name', searchQuery);
      params.set('archived', showArchived ? 'true' : 'false');
      params.set('page', String(page));
      params.set('per_page', '50');

      const res = await apiFetch<{ data: Warrant[]; pagination: { total: number; totalPages: number } }>(
        `/warrants?${params.toString()}`
      );
      setWarrants(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch (err: any) {
      if (!options?.silent) setError(err?.message || 'Failed to load warrants');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [filterStatus, filterType, filterSource, filterCourt, filterSeverity, filterPersonId, searchQuery, showArchived, page]);

  useEffect(() => {
    if (activeTab === 'warrants') fetchWarrants();
  }, [activeTab, fetchWarrants]);

  // Live sync — skip while form modal is open to prevent UI freezes during person search
  const silentRefreshWarrants = useCallback(() => {
    if (formOpen) return; // Don't refresh list while editing
    fetchWarrants({ silent: true });
  }, [fetchWarrants, formOpen]);
  useLiveSync('alerts', silentRefreshWarrants);

  // Fetch warrant detail
  const fetchWarrantDetail = useCallback(async (id: number) => {
    try {
      const detail = await apiFetch<Warrant>(`/warrants/${id}`);
      setSelectedWarrant(detail);
    } catch { /* keep existing */ }
  }, []);

  // Person search for form — uses the dedicated search endpoint
  useEffect(() => {
    if (!personSearch || personSearch.length < 2) {
      setPersonResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setPersonSearchLoading(true);
      try {
        const res = await apiFetch<Person[]>(`/records/persons/search?q=${encodeURIComponent(personSearch)}`);
        setPersonResults(Array.isArray(res) ? res.slice(0, 10) : []);
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

  // ============================================================
  // SOURCES TAB FETCHES
  // ============================================================

  // ── Unified Search ──
  const runUnifiedSearch = useCallback(async () => {
    if (!uniSearchFirst.trim() && !uniSearchLast.trim() && !uniSearchWarrantNum.trim()) return;
    setUniSearching(true);
    try {
      const body: Record<string, string> = {};
      if (uniSearchFirst.trim()) body.firstName = uniSearchFirst.trim();
      if (uniSearchLast.trim()) body.lastName = uniSearchLast.trim();
      if (uniSearchDob.trim()) body.dob = uniSearchDob.trim();
      if (uniSearchWarrantNum.trim()) body.warrantNumber = uniSearchWarrantNum.trim();
      if (uniSearchCourt.trim()) body.court = uniSearchCourt.trim();
      if (uniSearchSource) body.source = uniSearchSource;
      if (uniSearchOffenseLevel) body.offenseLevel = uniSearchOffenseLevel;
      if (uniSearchStatus) body.status = uniSearchStatus;
      if (uniSearchType) body.type = uniSearchType;
      if (uniSearchCharge.trim()) body.chargeKeyword = uniSearchCharge.trim();
      if (uniSearchDateFrom) body.dateFrom = uniSearchDateFrom;
      if (uniSearchDateTo) body.dateTo = uniSearchDateTo;

      const res = await apiFetch<UnifiedSearchResults>('/warrants/search-all', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setUniResults(res);
      if (uniSearchFirst.trim() && uniSearchLast.trim()) {
        setUniSearchHistory(prev => [
          { first: uniSearchFirst.trim(), last: uniSearchLast.trim(), hits: res.meta.totalHits, at: new Date().toISOString() },
          ...prev.filter(h => !(h.first === uniSearchFirst.trim() && h.last === uniSearchLast.trim())),
        ].slice(0, 10));
      }
    } finally { setUniSearching(false); }
  }, [uniSearchFirst, uniSearchLast, uniSearchDob, uniSearchWarrantNum, uniSearchCourt,
      uniSearchSource, uniSearchOffenseLevel, uniSearchStatus, uniSearchType,
      uniSearchCharge, uniSearchDateFrom, uniSearchDateTo]);

  // ── Typeahead for unified search name fields ──
  const [nameFieldFocused, setNameFieldFocused] = useState(false);
  useEffect(() => {
    if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    const query = `${uniSearchFirst} ${uniSearchLast}`.trim();
    if (query.length < 2) { setNameTypeahead([]); return; }
    typeaheadTimer.current = setTimeout(async () => {
      setNameTypeaheadLoading(true);
      try {
        const res = await apiFetch<Person[]>(`/records/persons/search?q=${encodeURIComponent(query)}`);
        setNameTypeahead(Array.isArray(res) ? res.slice(0, 8) : []);
      } finally { setNameTypeaheadLoading(false); }
    }, 300);
    return () => { if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current); };
  }, [uniSearchFirst, uniSearchLast]);

  // ── Utah Warrant Detail Modal Handlers ──

  const openUtahDetail = useCallback((w: UtahWarrantResult, source: 'utah' | 'local' | 'scraped') => {
    setUtahDetailWarrant({ ...w, _source: source });
    setAddedToLocal(false);
  }, []);

  const handleUtahPrint = useCallback(async () => {
    if (!utahDetailWarrant) return;
    const w = utahDetailWarrant;
    const pdfData: WarrantPdfData = {
      warrant_number: w.case_id || w.warrant_id || w.utah_warrant_id || 'UTAH-SEARCH',
      type: w.warrant_type || 'arrest',
      status: w.status || 'active',
      offense_level: w.offense_level || '',
      charge_description: w.charges || w.charge_description || '',
      subject_first_name: w.first_name || '',
      subject_last_name: w.last_name || '',
      subject_dob: '',
      subject_gender: '',
      subject_race: '',
      subject_height: '',
      subject_weight: '',
      subject_hair_color: '',
      subject_eye_color: '',
      subject_address: w.city || '',
      issuing_court: w.court_name || '',
      issuing_judge: '',
      bail_amount: w.bail_amount ?? undefined,
      expires_at: '',
      entered_by_name: '',
      created_at: w.issue_date || new Date().toISOString(),
      notes: `Source: ${w._source === 'utah' ? 'Utah State Warrants API' : w._source === 'scraped' ? `Multi-Source (${w.source_key || 'scraped'})` : 'Local System'}\nSearch Date: ${new Date().toLocaleString()}`,
      // Extended fields for source/verification
      county: w.city || '',
      case_number: w.case_id || '',
      filing_date: w.issue_date || '',
      data_source: w._source === 'utah' ? 'Utah State Warrants API (warrants.utah.gov)' : w._source === 'scraped' ? `Multi-Source Database (${w.source_key || 'scraped'})` : 'RMPG Local System',
      search_date: new Date().toLocaleString(),
    };
    try {
      await downloadRecordPdf('warrant', pdfData, pdfData.warrant_number);
    } catch (err) {
      console.error('Warrant PDF failed:', err);
    }
  }, [utahDetailWarrant]);

  const handleAddToLocal = useCallback(async () => {
    if (!utahDetailWarrant || addingToLocal) return;
    setAddingToLocal(true);
    try {
      const w = utahDetailWarrant;
      await apiFetch('/warrants/ingest-utah', {
        method: 'POST',
        body: JSON.stringify({
          warrants: [{
            utah_warrant_id: w.utah_warrant_id || w.warrant_id || `manual-${Date.now()}`,
            charges: w.charges || w.charge_description || 'Utah warrant',
            court_name: w.court_name || null,
            first_name: w.first_name,
            last_name: w.last_name,
            bail_amount: w.bail_amount,
            offense_level: w.offense_level,
            case_id: w.case_id,
            issue_date: w.issue_date,
          }],
        }),
      });
      setAddedToLocal(true);
      // Refresh warrants list if on warrants tab
      fetchWarrants({ silent: true });
    } catch (err: any) {
      setError(err?.message || 'Failed to add to local records');
    } finally {
      setAddingToLocal(false);
    }
  }, [utahDetailWarrant, addingToLocal, fetchWarrants]);

  const handleCheckPerson = useCallback(() => {
    if (!utahDetailWarrant) return;
    // Switch to unified search with this person's name
    setUniSearchFirst(utahDetailWarrant.first_name);
    setUniSearchLast(utahDetailWarrant.last_name);
    setUtahDetailWarrant(null);
    setActiveTab('search-all');
    setTimeout(() => runUnifiedSearch(), 100);
  }, [utahDetailWarrant, runUnifiedSearch]);

  // ── Auto-Poll Status ──
  const fetchAutoPollStatus = useCallback(async () => {
    setAutoPollLoading(true);
    try {
      const res = await apiFetch<AutoPollStatus>('/warrants/utah-search/auto-poll-status');
      setAutoPollStatus(res);
    } catch { /* error handled */ }
    finally { setAutoPollLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'search-all') { /* nothing to auto-fetch */ }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'watch') return;
    fetchAutoPollStatus();
  }, [activeTab, fetchAutoPollStatus]);

  const fetchCoverage = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const res = await apiFetch<{ data: ScraperSource[] }>('/warrants/scraped/status');
      setCoverageSources(res.data || []);
    } catch { /* silent */ }
    finally { setCoverageLoading(false); }
  }, []);

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
    if (activeTab !== 'sources') return;
    fetchCoverage();
    fetchWatchRuns();
  }, [activeTab, fetchCoverage, fetchWatchRuns]);

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
    snapshotForm();
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
    snapshotForm();
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
      clearFormDraft();
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

  // Set document title
  useEffect(() => { document.title = 'Warrants \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setServeModalOpen(false); setFormOpen(false); setEditingWarrant(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-surface-deep">
      {/* ---- TITLE BAR ---- */}
      <PanelTitleBar title="WARRANTS" icon={AlertTriangle}>
        <RmpgLogo height={16} iconOnly />
        <span className="toolbar-separator" />
        {activeTab === 'warrants' && !showArchived && (
          <button type="button" onClick={openNewForm} className="toolbar-btn toolbar-btn-primary text-[9px]">
            <Plus className="w-3 h-3" /> New Warrant
          </button>
        )}
        {activeTab === 'warrants' && (
          <button type="button"
            onClick={() => { setShowArchived(!showArchived); setPage(1); }}
            className={`toolbar-btn text-[9px] ${showArchived ? 'text-amber-400' : ''}`}
            title={showArchived ? 'Show active warrants' : 'Show archived warrants'}
          >
            <Archive className="w-3 h-3" />
            {showArchived ? 'Showing Archived' : 'Archives'}
          </button>
        )}
        {activeTab === 'sources' && (isGodMode || isAdminOrManager) && (
          <>
            <button type="button"
              onClick={handleTriggerScan}
              disabled={scanRunning}
              className="toolbar-btn toolbar-btn-primary text-[9px]"
              title="Run warrant scan now"
            >
              {scanRunning
                ? <><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Scanning...</>
                : <><PlayCircle className="w-3 h-3" /> Run Scan Now</>
              }
            </button>
            <button type="button" onClick={() => { fetchCoverage(); fetchWatchRuns(); }} className="toolbar-btn text-[9px]" title="Refresh">
              <RotateCcw className="w-3 h-3" />
            </button>
          </>
        )}
        <span className="toolbar-separator" />
        <ExportButton exportUrl="/warrants/export" exportFilename="warrants_export.csv" />
        <PrintButton />
      </PanelTitleBar>

      {/* ---- TAB BAR ---- */}
      <div className={`tab-bar ${isMobile ? 'overflow-x-auto' : ''}`}>
        {TABS.map((tab) => {
          if (tab.roleGated && !isGodMode && !isAdminOrManager) return null;
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`tab-bar-item ${isActive ? 'active' : ''}`}
            >
              <Icon className="w-3 h-3" />
              <span className="whitespace-nowrap">{tab.label}</span>
              {tab.id === 'dashboard' && dashStats && dashStats.activeWarrants > 0 && (
                <span className="ml-1 px-1 rounded-sm bg-red-600 text-white text-[8px] font-bold leading-tight">
                  {dashStats.activeWarrants}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ---- STATS BAR ---- */}
      <div className="panel-inset bg-[var(--surface-sunken)] flex items-center gap-0 border-b border-[#222222] text-[10px] font-mono flex-wrap">
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-[#222222]">
          <span className={`led-dot ${(dashStats?.activeWarrants || 0) > 0 ? 'led-red' : 'led-off'}`} />
          <span className="text-rmpg-400">ACTIVE</span>
          <span className={`font-bold tabular-nums ${(dashStats?.activeWarrants || 0) > 0 ? 'text-red-400' : 'text-rmpg-300'}`}>
            {dashStats?.activeWarrants ?? '-'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-[#222222]">
          <span className={`led-dot ${(dashStats?.hitsToday || 0) > 0 ? 'led-amber animate-led-blink' : 'led-off'}`} />
          <span className="text-rmpg-400">HITS TODAY</span>
          <span className={`font-bold tabular-nums ${(dashStats?.hitsToday || 0) > 0 ? 'text-amber-400' : 'text-rmpg-300'}`}>
            {dashStats?.hitsToday ?? '-'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-[#222222]">
          <span className="text-rmpg-400">FLAGGED</span>
          <span className="font-bold tabular-nums text-rmpg-300">{dashStats?.personsFlagged ?? '-'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-[#222222]">
          <span className={`led-dot ${(dashStats?.sourcesOnline || 0) > 0 ? 'led-green' : 'led-off'}`} />
          <span className="text-rmpg-400">SOURCES</span>
          <span className={`font-bold tabular-nums ${(dashStats?.sourcesOnline || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {dashStats ? `${dashStats.sourcesOnline}/${dashStats.sourcesTotal}` : '-'}
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
        <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent" style={{ overscrollBehavior: 'contain' }}>
          <div className="p-4 space-y-4">
            {/* Quick Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-rmpg-500" />
              <input
                type="text"
                className="input-dark w-full pl-9 text-xs min-h-[36px]"
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
                <IconButton onClick={() => setDashSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-white" aria-label="Clear dash search">
                  <X className="w-3.5 h-3.5" />
                </IconButton>
              )}
            </div>

            {/* Export Report */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="toolbar-btn text-[10px]"
                onClick={() => setSummaryReportOpen(!summaryReportOpen)}
              >
                <Download className="w-3 h-3" /> Export Report
              </button>
              {summaryReportOpen && (
                <div className="flex items-center gap-2 bg-surface-sunken border border-surface-border rounded-sm px-2 py-1">
                  <input
                    type="date"
                    className="input-dark text-[10px] py-0.5 px-1 min-h-[22px] w-28"
                    value={summaryFrom}
                    onChange={(e) => setSummaryFrom(e.target.value)}
                    placeholder="From"
                  />
                  <span className="text-[10px] text-rmpg-500">to</span>
                  <input
                    type="date"
                    className="input-dark text-[10px] py-0.5 px-1 min-h-[22px] w-28"
                    value={summaryTo}
                    onChange={(e) => setSummaryTo(e.target.value)}
                    placeholder="To"
                  />
                  <button
                    type="button"
                    className="toolbar-btn text-[9px] bg-brand-blue/20 text-brand-blue border-brand-blue/40 hover:bg-brand-blue/30"
                    disabled={summaryLoading}
                    onClick={async () => {
                      setSummaryLoading(true);
                      try {
                        const params = new URLSearchParams();
                        if (summaryFrom) params.set('from', summaryFrom);
                        if (summaryTo) params.set('to', summaryTo);
                        const res = await apiFetch<WarrantSummaryData>(`/warrants/summary-report?${params.toString()}`);
                        if (!res) throw new Error('No data returned');
                        const { fetchPdfBranding, setActiveBranding, loadPdfAssets } = await import('../utils/pdfGenerator');
                        const branding = await fetchPdfBranding();
                        setActiveBranding(branding);
                        await loadPdfAssets();
                        const pdf = generateWarrantSummaryPdf(res);
                        const blob = pdf.output('blob');
                        const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `Warrant_Summary_${summaryFrom || 'all'}_to_${summaryTo || 'present'}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                        setSummaryReportOpen(false);
                      } catch (err) {
                        console.error('Summary report failed:', err);
                      } finally {
                        setSummaryLoading(false);
                      }
                    }}
                  >
                    {summaryLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Generate'}
                  </button>
                </div>
              )}
            </div>

            {/* Stat Cards */}
            <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-3`}>
              <div className={`panel-inset p-3 rounded-sm text-center ${(dashStats?.activeWarrants || 0) > 0 ? 'bg-red-900/20 border border-red-900/40' : 'bg-surface-sunken'}`}>
                <div className={`text-2xl font-bold font-mono tabular-nums ${(dashStats?.activeWarrants || 0) > 0 ? 'text-red-400' : 'text-white'}`}>
                  {dashStatsLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" role="status" aria-label="Loading" /> : (dashStats?.activeWarrants ?? 0)}
                </div>
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Active Warrants</div>
              </div>
              <div className={`panel-inset p-3 rounded-sm text-center ${(dashStats?.hitsToday || 0) > 0 ? 'bg-amber-900/20 border border-amber-900/40' : 'bg-surface-sunken'}`}>
                <div className={`text-2xl font-bold font-mono tabular-nums ${(dashStats?.hitsToday || 0) > 0 ? 'text-amber-400' : 'text-white'}`}>
                  {dashStatsLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" role="status" aria-label="Loading" /> : (dashStats?.hitsToday ?? 0)}
                </div>
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Hits Today</div>
              </div>
              <div className="panel-inset bg-surface-sunken p-3 rounded-sm text-center">
                <div className="text-2xl font-bold font-mono tabular-nums text-white">
                  {dashStatsLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" role="status" aria-label="Loading" /> : (dashStats?.personsFlagged ?? 0)}
                </div>
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Persons Flagged</div>
              </div>
              <div className={`panel-inset p-3 rounded-sm text-center ${dashStats && dashStats.sourcesOnline < dashStats.sourcesTotal ? 'bg-red-900/10 border border-red-900/30' : 'bg-surface-sunken'}`}>
                <div className={`text-2xl font-bold font-mono tabular-nums ${dashStats && dashStats.sourcesOnline >= dashStats.sourcesTotal ? 'text-green-400' : dashStats ? 'text-amber-400' : 'text-white'}`}>
                  {dashStatsLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" role="status" aria-label="Loading" /> : dashStats ? `${dashStats.sourcesOnline}/${dashStats.sourcesTotal}` : '-'}
                </div>
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Sources Online</div>
              </div>
              <div className="panel-inset bg-surface-sunken p-3 rounded-sm text-center cursor-pointer hover:bg-surface-raised/50 transition-colors" onClick={() => { setActiveTab('warrants'); }}>
                <div className="text-2xl font-bold font-mono tabular-nums text-amber-400">
                  {expiringCount ?? '\u2014'}
                </div>
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Expiring Soon</div>
                <div className="text-[9px] text-rmpg-500 mt-0.5">within 30 days</div>
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
                      <button type="button"
                        key={r}
                        onClick={() => setFeedRange(r)}
                        className={`px-1.5 py-0.5 text-[9px] font-bold rounded-sm border transition-colors ${
                          feedRange === r
                            ? 'bg-brand-900/40 text-brand-300 border-brand-600/50'
                            : 'bg-rmpg-700/40 text-rmpg-400 border-rmpg-700/50 hover:text-rmpg-200'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                    <select
                      className="input-dark text-[9px] py-0 px-1 w-24 ml-1 min-h-[22px]"
                      value={feedEventFilter}
                      onChange={(e) => setFeedEventFilter(e.target.value)}
                    >
                      <option value="">All Events</option>
                      <option value="warrant_found">Found</option>
                      <option value="warrant_cleared">Cleared</option>
                    </select>
                  </div>
                </div>

                <div className="panel-inset bg-surface-sunken rounded-sm flex-1 max-h-[400px] overflow-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent">
                  {feedLoading ? (
                    <div className="flex items-center justify-center h-32 text-rmpg-400">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" role="status" aria-label="Loading" /> Loading feed...
                    </div>
                  ) : filteredFeed.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-rmpg-500 text-xs">
                      No events in this time range
                    </div>
                  ) : (
                    <div className="divide-y divide-rmpg-700/50">
                      {filteredFeed.map(entry => (
                        <div key={entry.id} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-raised/50 transition-colors">
                          <span className="text-[9px] text-rmpg-500 font-mono shrink-0 w-14">{relativeTime(entry.created_at)}</span>
                          <button type="button"
                            onClick={() => entry.person_id && openPersonProfile(entry.person_id)}
                            className="text-xs font-medium text-brand-300 hover:text-brand-200 transition-colors truncate"
                            title="View person profile"
                          >
                            {entry.person_name}
                          </button>
                          <span className={`inline-flex px-1.5 py-0.5 text-[8px] font-bold rounded-sm border shrink-0 ${
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

                <div className="space-y-2 max-h-[400px] overflow-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent">
                  {priorityLoading ? (
                    <div className="panel-inset bg-surface-sunken rounded-sm flex items-center justify-center h-32 text-rmpg-400">
                      <Loader2 className="w-4 h-4 animate-spin mr-2" role="status" aria-label="Loading" /> Loading...
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
                            <div className="w-9 h-9 rounded-sm bg-surface-raised border border-rmpg-600 flex items-center justify-center shrink-0">
                              <User className="w-4 h-4 text-rmpg-500" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-white truncate">
                                {[pw.subject_first_name, pw.subject_last_name].filter(Boolean).join(' ') || 'Unknown'}
                              </span>
                              <span className={`inline-flex px-1 py-0.5 text-[8px] font-bold rounded-sm border ${
                                pw.offense_level === 'felony' ? SEVERITY_COLORS.felony
                                  : pw.offense_level === 'misdemeanor' ? SEVERITY_COLORS.misdemeanor
                                  : 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50'
                              }`}>
                                {(pw.offense_level || pw.type || 'WARRANT').toUpperCase()}
                              </span>
                            </div>
                            <div className="text-[10px] text-rmpg-300 truncate mt-0.5">{chargesFromJson(pw.charge_description)}</div>
                            <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-400">
                              {pw.bail_amount != null && pw.bail_amount > 0 && (
                                <span className="text-green-400 font-mono font-bold">{formatCurrency(pw.bail_amount)}</span>
                              )}
                              {pw.source && (
                                <span className="inline-flex px-1 py-0.5 text-[8px] rounded-sm bg-gray-900/30 text-gray-300 border border-gray-700/30">
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
                  className={`input-dark w-full pl-7 ${searchQuery ? 'pr-7' : 'pr-2'} ${isMobile ? 'text-sm py-2.5' : 'text-xs'}`}
                  placeholder="Search by name, warrant #, or charge..." aria-label="Search by name, warrant #, or charge..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                  style={isMobile ? { minHeight: 44 } : undefined}
                />
                {searchQuery && (
                  <IconButton onClick={() => { setSearchQuery(''); setPage(1); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300" aria-label="Clear search">
                    <X className="w-3.5 h-3.5" />
                  </IconButton>
                )}
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
                {/* Court filter */}
                <input
                  type="text"
                  className={`input-dark ${isMobile ? 'flex-1 text-sm py-2' : 'text-xs w-28'}`}
                  placeholder="Court..."
                  value={filterCourt}
                  onChange={(e) => { setFilterCourt(e.target.value); setPage(1); }}
                  style={isMobile ? { minHeight: 44 } : undefined}
                />
                {/* Source filter */}
                <select
                  className={`input-dark ${isMobile ? 'flex-1 text-sm py-2' : 'text-xs w-24'}`}
                  value={filterSource}
                  onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}
                  style={isMobile ? { minHeight: 44 } : undefined}
                >
                  <option value="">All Sources</option>
                  <option value="manual">Local</option>
                  <option value="utah_api">Utah API</option>
                  <option value="scraper">Scraped</option>
                </select>
              </div>
            </div>

            {/* Person filter indicator */}
            {filterPersonId && (
              <div className="px-3 py-1.5 bg-brand-900/30 border-b border-brand-700/50 text-brand-300 text-xs flex items-center gap-2">
                <User className="w-3 h-3" />
                <span>Filtered by person #{filterPersonId}</span>
                <button type="button" onClick={() => { setFilterPersonId(null); setPage(1); }} className="ml-auto text-brand-400 hover:text-white text-[10px] underline">Clear filter</button>
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
            {batchSelected.size > 0 && (isGodMode || isAdminOrManager) && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-brand-900/20 border-b border-brand-700/50">
                <span className="text-[10px] font-bold text-brand-300">{batchSelected.size} selected</span>
                <select value={batchStatus} onChange={e => setBatchStatus(e.target.value)} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-2 py-0.5 outline-none">
                  <option value="">Set Status...</option>
                  <option value="served">Served</option>
                  <option value="recalled">Recalled</option>
                  <option value="quashed">Quashed</option>
                  <option value="expired">Expired</option>
                </select>
                <button type="button" onClick={handleBatchUpdate} disabled={!batchStatus || batchSubmitting} className="toolbar-btn-primary text-[10px] px-2 py-0.5 disabled:opacity-40">
                  {batchSubmitting ? 'Updating...' : 'Apply'}
                </button>
                <button type="button" onClick={() => setBatchSelected(new Set())} className="toolbar-btn text-[10px] px-2 py-0.5">Clear</button>
              </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent">
              {loading ? (
                <div className="flex items-center justify-center h-full text-rmpg-400">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" role="status" aria-label="Loading" /> Loading warrants...
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
                    <button type="button"
                      key={w.id}
                      onClick={() => fetchWarrantDetail(w.id)}
                      className={`w-full text-left px-3 py-3 border-b border-rmpg-700/50 transition-colors hover:bg-surface-raised ${selectedWarrant?.id === w.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'border-l-2 border-l-transparent'}`}
                      style={{ minHeight: 56 }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-mono font-bold text-white">{w.warrant_number || '-'}</span>
                        <div className="flex items-center gap-1">
                          <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded-sm border ${TYPE_COLORS[w.type] || TYPE_COLORS.other}`}>
                            {w.type.toUpperCase()}
                          </span>
                          <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded-sm border ${STATUS_COLORS[w.status] || ''}`}>
                            {w.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <div className="text-sm text-rmpg-200 font-medium">{w.subject_name || 'Unknown'}</div>
                      <div className="text-xs text-rmpg-400 truncate mt-0.5">{chargesFromJson(w.charge_description)}</div>
                      <div className="text-[10px] text-rmpg-500 mt-0.5">
                        {formatDate(w.created_at)}{w.offense_level ? ` \u2022 ${w.offense_level.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}` : ''}
                        {w.source ? ` \u2022 ${w.source}` : ''}
                      </div>
                      {/* UPGRADE 42: Expiration warning highlight */}
                      {w.expires_at && w.status === 'active' && (() => {
                        const daysLeft = Math.ceil((new Date(w.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                        if (daysLeft < 0) return <div className="text-[9px] text-red-400 font-bold mt-0.5 flex items-center gap-1"><AlertTriangle size={9} /> EXPIRED {Math.abs(daysLeft)}d ago</div>;
                        if (daysLeft <= 30) return <div className="text-[9px] text-amber-400 font-bold mt-0.5 flex items-center gap-1"><Clock size={9} /> Expires in {daysLeft}d</div>;
                        return null;
                      })()}
                    </button>
                  ))}
                </div>
              ) : (
                <table className="table-dark">
                  <thead className="sticky top-0 z-10 bg-[#050505]">
                    <tr>
                      {(isGodMode || isAdminOrManager) && (
                        <th style={{ width: 30 }}>
                          <input type="checkbox" checked={batchSelected.size === warrants.length && warrants.length > 0} onChange={toggleSelectAll} className="accent-brand-500" />
                        </th>
                      )}
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
                        className={`cursor-pointer hover:bg-[#141414]/50 transition-colors ${selectedWarrant?.id === w.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : ''} ${batchSelected.has(w.id) ? 'bg-brand-900/10' : ''}`}
                      >
                        {(isGodMode || isAdminOrManager) && (
                          <td onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={batchSelected.has(w.id)} onChange={() => toggleBatchSelect(w.id)} className="accent-brand-500" />
                          </td>
                        )}
                        <td>
                          <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded-sm border ${STATUS_COLORS[w.status] || ''}`}>
                            {w.status.toUpperCase()}
                          </span>
                          {w.expires_at && w.status === 'active' && (() => {
                            const daysLeft = Math.ceil((new Date(w.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                            if (daysLeft < 0) return <span className="ml-1 text-[8px] bg-red-900/50 text-red-400 border border-red-700/50 px-1 py-0.5 rounded-sm font-bold">EXPIRED</span>;
                            if (daysLeft <= 7) return <span className="ml-1 text-[8px] bg-amber-900/50 text-amber-400 border border-amber-700/50 px-1 py-0.5 rounded-sm font-bold">{daysLeft}d</span>;
                            return null;
                          })()}
                        </td>
                        <td className="font-mono text-xs text-white font-bold">{w.warrant_number || '-'}</td>
                        <td className="text-xs">
                          <div className="flex items-center gap-2">
                            {w.subject_photo_url ? (
                              <img src={w.subject_photo_url} alt="" className="w-6 h-6 rounded-sm object-cover border border-rmpg-600" />
                            ) : null}
                            <button type="button"
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
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded-sm border ${TYPE_COLORS[w.type] || TYPE_COLORS.other}`}>
                            {(() => { const Icon = TYPE_ICONS[w.type] || TYPE_ICONS.other; return <Icon className="w-3 h-3" />; })()}
                            {w.type.toUpperCase()}
                          </span>
                        </td>
                        <td className="text-xs text-rmpg-300 truncate max-w-[200px]">{chargesFromJson(w.charge_description)}</td>
                        <td>
                          {w.offense_level ? (
                            <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded-sm border ${SEVERITY_COLORS[w.offense_level] || 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50'}`}>
                              {w.offense_level.toUpperCase()}
                            </span>
                          ) : <span className="text-rmpg-500">-</span>}
                        </td>
                        <td className="text-[10px] text-rmpg-400 truncate">{w.issuing_court || '-'}</td>
                        <td className="text-xs text-rmpg-400 font-mono">{w.bail_amount ? formatCurrency(w.bail_amount) : '-'}</td>
                        <td className="text-center">
                          {w.service_attempt_count > 0 ? (
                            <span className="text-amber-400 font-mono">{w.service_attempt_count}</span>
                          ) : (
                            <span className="text-rmpg-500">&mdash;</span>
                          )}
                        </td>
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
                  <button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="toolbar-btn text-[9px] disabled:opacity-40">Prev</button>
                  <button type="button" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="toolbar-btn text-[9px] disabled:opacity-40">Next</button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Warrant Detail */}
          <div className={`${isMobile ? (selectedWarrant ? 'flex-1' : 'hidden') : 'flex-1'} flex flex-col overflow-hidden`}>
            <div className={`flex ${isMobile ? 'flex-wrap gap-1' : 'items-center gap-1'} px-3 py-1 border-b border-[#222222] bg-[var(--grid-header-bg)]`}>
              <Gavel className="w-3 h-3 text-brand-400" />
              <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-widest">Warrant Detail</span>
              <span className="flex-1" />
              {isMobile && selectedWarrant && (
                <button type="button" onClick={() => setSelectedWarrant(null)} className="toolbar-btn text-[9px]" style={isMobile ? { minHeight: 44 } : undefined}>&larr; Back</button>
              )}
              <PrintRecordButton recordType="warrant" recordData={selectedWarrant} identifier={selectedWarrant?.warrant_number} entityType="warrant" entityId={selectedWarrant?.id} label="Print" />
              {selectedWarrant && !selectedWarrant.archived_at && (
                <>
                  {selectedWarrant.status === 'active' && (
                    <>
                      <button type="button" onClick={() => { setServeLocation(''); setServeModalOpen(true); }} className="toolbar-btn toolbar-btn-primary text-[9px]" style={isMobile ? { minHeight: 48 } : undefined}>
                        <CheckCircle className="w-3 h-3" /> Serve
                      </button>
                      <button type="button" onClick={() => openEditForm(selectedWarrant)} className="toolbar-btn text-[9px]" style={isMobile ? { minHeight: 48 } : undefined}>
                        <Edit className="w-3 h-3" /> Edit
                      </button>
                      <button type="button" onClick={() => handleUpdateStatus(selectedWarrant.id, 'recalled')} className="toolbar-btn text-[9px] text-amber-400" style={isMobile ? { minHeight: 48 } : undefined}>
                        <XCircle className="w-3 h-3" /> Recall
                      </button>
                    </>
                  )}
                  {selectedWarrant.status !== 'active' && (
                    <>
                      <button type="button" onClick={() => handleArchive(selectedWarrant.id)} className="toolbar-btn text-[9px]" title="Archive this warrant" style={isMobile ? { minHeight: 48 } : undefined}>
                        <Archive className="w-3 h-3" /> Archive
                      </button>
                      <button type="button" onClick={() => setDeletingWarrant(selectedWarrant)} className="toolbar-btn text-[9px] text-red-400" title="Permanently delete" style={isMobile ? { minHeight: 48 } : undefined}>
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </>
                  )}
                </>
              )}
              {selectedWarrant?.archived_at && (
                <button type="button" onClick={() => handleUnarchive(selectedWarrant.id)} className="toolbar-btn text-[9px] text-amber-400" style={isMobile ? { minHeight: 48 } : undefined}>
                  <RotateCcw className="w-3 h-3" /> Unarchive
                </button>
              )}
            </div>

            {selectedWarrant ? (
              <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent p-4 space-y-4">
                {/* Header */}
                <div className="panel-beveled p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h2 className="text-lg font-bold text-white font-mono">{selectedWarrant.warrant_number}</h2>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold rounded-sm border ${TYPE_COLORS[selectedWarrant.type] || TYPE_COLORS.other}`}>
                          {selectedWarrant.type.toUpperCase()} WARRANT
                        </span>
                        <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold rounded-sm border ${STATUS_COLORS[selectedWarrant.status] || ''}`}>
                          {selectedWarrant.status.toUpperCase()}
                        </span>
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
                        <span className="text-[10px] text-rmpg-400 uppercase">Bail</span>
                        <div className="text-lg font-bold text-green-400 font-mono">{formatCurrency(selectedWarrant.bail_amount)}</div>
                      </div>
                    )}
                  </div>

                  {/* Statute + Charge */}
                  {(selectedWarrant as any).statute_citation && (
                    <div className="mb-2">
                      <span className="text-[10px] text-[#d4a017] uppercase font-bold tracking-wider">Statute</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand-900/30 text-brand-300 border border-brand-700/40 text-xs font-mono font-bold">
                          <Scale className="w-3 h-3" />
                          {(selectedWarrant as any).statute_citation}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="mb-3">
                    <span className="text-[10px] text-[#d4a017] uppercase font-bold tracking-wider">Charge Description</span>
                    <p className="text-sm text-white mt-0.5">{chargesFromJson(selectedWarrant.charge_description)}</p>
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
                    <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-widest flex items-center gap-2 mb-3">
                      <User className="w-4 h-4 text-[#d4a017]" /> Subject Information
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
                    {selectedWarrant.subject_person_id && (
                      <div className="flex gap-2 flex-wrap mt-3">
                        <button type="button" onClick={() => navigate(`/records?tab=persons&personId=${selectedWarrant.subject_person_id}`)}
                          className="toolbar-btn text-[9px]"><User className="w-3 h-3" /> View Record</button>
                        <button type="button" onClick={() => navigate(`/dispatch?personId=${selectedWarrant.subject_person_id}`)}
                          className="toolbar-btn text-[9px]"><Activity className="w-3 h-3" /> View Calls</button>
                        <button type="button" onClick={() => navigate(`/records?tab=arrests&personId=${selectedWarrant.subject_person_id}`)}
                          className="toolbar-btn text-[9px]"><Shield className="w-3 h-3" /> View Arrests</button>
                      </div>
                    )}
                  </div>
                )}

                {/* Court Info */}
                {(selectedWarrant.issuing_court || selectedWarrant.issuing_judge) && (
                  <div className="panel-beveled p-4">
                    <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-widest flex items-center gap-2 mb-3">
                      <Gavel className="w-4 h-4 text-[#d4a017]" /> Court Information
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
                    <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-widest mb-2">Notes</h3>
                    <p className="text-xs text-rmpg-200 whitespace-pre-wrap">{selectedWarrant.notes}</p>
                  </div>
                )}

                {/* Activity Log */}
                {selectedWarrant.activity && selectedWarrant.activity.length > 0 && (
                  <div className="panel-beveled p-4">
                    <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-widest flex items-center gap-2 mb-3">
                      <Clock className="w-4 h-4 text-[#d4a017]" /> Activity Log
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
          TAB: SEARCH ALL (Unified Cross-Source)
         ================================================================ */}
      {activeTab === 'search-all' && (
        <div className="flex-1 overflow-auto">
          <div className="p-4 space-y-4">
            {/* Search Form */}
            <div className="panel-raised p-4">
              <div className="flex items-center gap-2 mb-3">
                <Globe className="w-4 h-4 text-brand-blue" />
                <span className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Cross-Source Warrant Search</span>
                <span className="text-[9px] text-rmpg-400 ml-auto">Local + Utah API + Multi-State</span>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); runUnifiedSearch(); }}>
                {/* Row 1: First Name, Last Name, DOB */}
                <div className="flex gap-2 items-end flex-wrap mb-2 relative">
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">First Name</label>
                    <input
                      type="text"
                      className="input-dark w-full"
                      placeholder="First name..."
                      value={uniSearchFirst}
                      onChange={(e) => setUniSearchFirst(e.target.value)}
                      onFocus={() => setNameFieldFocused(true)}
                      onBlur={() => setTimeout(() => setNameFieldFocused(false), 200)}
                      autoComplete="off"
                      autoFocus
                    />
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Last Name</label>
                    <input
                      type="text"
                      className="input-dark w-full"
                      placeholder="Last name..."
                      value={uniSearchLast}
                      onChange={(e) => setUniSearchLast(e.target.value)}
                      onFocus={() => setNameFieldFocused(true)}
                      onBlur={() => setTimeout(() => setNameFieldFocused(false), 200)}
                      autoComplete="off"
                    />
                  </div>
                  <div className="w-[140px]">
                    <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">DOB</label>
                    <input
                      type="date"
                      className="input-dark w-full"
                      value={uniSearchDob}
                      onChange={(e) => setUniSearchDob(e.target.value)}
                    />
                  </div>
                  {/* Typeahead dropdown — only visible when name fields are focused */}
                  {nameTypeahead.length > 0 && nameFieldFocused && (
                    <div className="absolute top-full left-0 z-50 mt-1 w-[320px] panel-raised border border-[var(--border-strong)] shadow-lg max-h-48 overflow-auto">
                      {nameTypeaheadLoading && (
                        <div className="p-2 text-[10px] text-rmpg-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading...</div>
                      )}
                      {nameTypeahead.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          className="w-full text-left px-3 py-1.5 hover:bg-surface-raised/80 transition-colors flex items-center gap-2"
                          onClick={() => {
                            setUniSearchFirst(p.first_name);
                            setUniSearchLast(p.last_name);
                            if (p.dob) setUniSearchDob(p.dob);
                            setNameTypeahead([]);
                          }}
                        >
                          <User className="w-3 h-3 text-rmpg-400 flex-shrink-0" />
                          <span className="text-xs text-white">{p.last_name}, {p.first_name}</span>
                          {p.dob && <span className="text-[10px] text-rmpg-400 ml-auto">{p.dob}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Row 2: Warrant #, Court, Source */}
                <div className="flex gap-2 items-end flex-wrap mb-2">
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Warrant #</label>
                    <input
                      type="text"
                      className="input-dark w-full"
                      placeholder="Warrant number..."
                      value={uniSearchWarrantNum}
                      onChange={(e) => setUniSearchWarrantNum(e.target.value)}
                    />
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Court</label>
                    <input
                      type="text"
                      className="input-dark w-full"
                      placeholder="Court name..."
                      value={uniSearchCourt}
                      onChange={(e) => setUniSearchCourt(e.target.value)}
                    />
                  </div>
                  <div className="w-[160px]">
                    <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Source</label>
                    <select className="input-dark w-full" value={uniSearchSource} onChange={(e) => setUniSearchSource(e.target.value)}>
                      <option value="">All Sources</option>
                      <option value="local">Local System</option>
                      <option value="utah">Utah State API</option>
                      <option value="scraped">Multi-State Scraped</option>
                    </select>
                  </div>
                </div>

                {/* Advanced Filters (collapsible) */}
                <button
                  type="button"
                  className="text-[10px] text-rmpg-400 hover:text-rmpg-200 flex items-center gap-1 mb-2 transition-colors"
                  onClick={() => setUniAdvancedOpen(!uniAdvancedOpen)}
                >
                  <ChevronDown className={`w-3 h-3 transition-transform ${uniAdvancedOpen ? 'rotate-180' : ''}`} />
                  Advanced Filters
                </button>
                {uniAdvancedOpen && (
                  <div className="flex gap-2 items-end flex-wrap mb-2 border-t border-surface-border pt-2">
                    <div className="w-[140px]">
                      <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Date From</label>
                      <input type="date" className="input-dark w-full" value={uniSearchDateFrom} onChange={(e) => setUniSearchDateFrom(e.target.value)} />
                    </div>
                    <div className="w-[140px]">
                      <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Date To</label>
                      <input type="date" className="input-dark w-full" value={uniSearchDateTo} onChange={(e) => setUniSearchDateTo(e.target.value)} />
                    </div>
                    <div className="w-[140px]">
                      <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Offense Level</label>
                      <select className="input-dark w-full" value={uniSearchOffenseLevel} onChange={(e) => setUniSearchOffenseLevel(e.target.value)}>
                        <option value="">Any</option>
                        {OFFENSE_LEVELS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Charge Keyword</label>
                      <input type="text" className="input-dark w-full" placeholder="e.g. theft, DUI..." value={uniSearchCharge} onChange={(e) => setUniSearchCharge(e.target.value)} />
                    </div>
                    <div className="w-[120px]">
                      <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Status</label>
                      <select className="input-dark w-full" value={uniSearchStatus} onChange={(e) => setUniSearchStatus(e.target.value)}>
                        <option value="">Any</option>
                        {WARRANT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                    <div className="w-[120px]">
                      <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Type</label>
                      <select className="input-dark w-full" value={uniSearchType} onChange={(e) => setUniSearchType(e.target.value)}>
                        <option value="">Any</option>
                        {WARRANT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2 items-center">
                  <button
                    type="submit"
                    disabled={uniSearching || (!uniSearchFirst.trim() && !uniSearchLast.trim() && !uniSearchWarrantNum.trim())}
                    className="toolbar-btn !h-8 !px-4 text-xs font-bold bg-brand-blue/20 text-brand-blue border-brand-blue/40 hover:bg-brand-blue/30 disabled:opacity-40"
                  >
                    {uniSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                    <span className="ml-1">{uniSearching ? 'Searching...' : 'Search All'}</span>
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn !h-8 !px-3 text-xs text-rmpg-400 hover:text-white"
                    onClick={() => {
                      setUniSearchFirst(''); setUniSearchLast(''); setUniSearchDob('');
                      setUniSearchWarrantNum(''); setUniSearchCourt(''); setUniSearchSource('');
                      setUniSearchOffenseLevel(''); setUniSearchStatus(''); setUniSearchType('');
                      setUniSearchCharge(''); setUniSearchDateFrom(''); setUniSearchDateTo('');
                      setUniResults(null); setNameTypeahead([]);
                    }}
                  >
                    <X className="w-3 h-3" />
                    <span className="ml-1">Clear</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Results */}
            {uniResults && (
              <div className="space-y-3">
                {/* Summary bar */}
                <div className="panel-raised p-3 flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    {uniResults.meta.sources.map(s => (
                      <span key={s} className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border bg-rmpg-700/30 text-rmpg-300 border-rmpg-600/50">{s}</span>
                    ))}
                  </div>
                  <span className="text-[10px] text-rmpg-400">
                    {uniResults.meta.totalHits} total hit{uniResults.meta.totalHits !== 1 ? 's' : ''}
                  </span>
                  <span className="text-[10px] text-rmpg-400">
                    {uniResults.meta.duration}ms
                  </span>
                  {uniResults.meta.utahBlocked && (
                    <span className="text-[10px] text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Utah API rate-limited
                    </span>
                  )}
                  <span className="text-[10px] text-rmpg-500 ml-auto">
                    Searched {formatDateTime(uniResults.meta.searchedAt)}
                  </span>
                </div>

                {/* LOCAL SYSTEM results */}
                {uniResults.local.length > 0 && (
                  <div className="panel-raised">
                    <div className="p-3 border-b border-surface-border flex items-center gap-2">
                      <Shield className="w-3.5 h-3.5 text-brand-blue" />
                      <span className="text-xs font-bold text-white">Local System</span>
                      <span className="ml-auto text-[10px] bg-brand-blue/20 text-brand-blue border border-brand-blue/40 px-1.5 py-0.5 rounded font-mono">
                        {uniResults.local.length}
                      </span>
                    </div>
                    <div className="divide-y divide-surface-border">
                      {uniResults.local.map((w) => (
                        <div key={`local-${w.id}`} className="p-3 hover:bg-surface-raised/50 transition-colors cursor-pointer" onClick={() => openUtahDetail({ first_name: w.subject_first_name || '', last_name: w.subject_last_name || '', charges: w.charge_description, court_name: w.issuing_court || undefined, bail_amount: w.bail_amount ?? undefined, offense_level: w.offense_level || undefined, warrant_type: w.type, status: w.status, case_id: undefined, issue_date: w.created_at }, 'local')}>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{w.warrant_number}</span>
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${STATUS_COLORS[w.status] || 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50'}`}>{w.status}</span>
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${TYPE_COLORS[w.type] || 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50'}`}>{w.type}</span>
                          </div>
                          <div className="text-xs text-rmpg-300 mt-1">{w.charge_description}</div>
                          <div className="text-[10px] text-rmpg-400 mt-1">
                            {w.subject_first_name && <span>{w.subject_last_name}, {w.subject_first_name} • </span>}
                            {w.issuing_court && <span>Court: {w.issuing_court} • </span>}
                            Created {formatDateTime(w.created_at)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* UTAH STATE API results */}
                {uniResults.utah.length > 0 && (
                  <div className="panel-raised">
                    <div className="p-3 border-b border-surface-border flex items-center gap-2">
                      <Globe className="w-3.5 h-3.5 text-red-400" />
                      <span className="text-xs font-bold text-white">Utah State API</span>
                      <span className="ml-auto text-[10px] bg-red-900/40 text-red-400 border border-red-700/50 px-1.5 py-0.5 rounded font-mono">
                        {uniResults.utah.length}
                      </span>
                    </div>
                    <div className="divide-y divide-surface-border">
                      {uniResults.utah.map((w, i) => (
                        <div key={`utah-${i}`} className="p-3 hover:bg-surface-raised/50 transition-colors cursor-pointer" onClick={() => openUtahDetail(w, 'utah')}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold text-white">{w.last_name}, {w.first_name} {w.middle_name || ''}</span>
                                {w.age && <span className="text-[10px] text-rmpg-400">Age: {w.age}</span>}
                                {w.city && <span className="text-[10px] text-rmpg-400">{w.city}</span>}
                              </div>
                              <div className="text-xs text-rmpg-300 mt-1">{w.charges || w.charge_description || 'No charge description'}</div>
                              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-rmpg-400 flex-wrap">
                                {w.court_name && <span>Court: {w.court_name}</span>}
                                {w.case_id && <span>Case: {w.case_id}</span>}
                                {w.issue_date && <span>Issued: {w.issue_date}</span>}
                                {w.bail_amount != null && w.bail_amount > 0 && (
                                  <span className="text-amber-400 font-bold">Bail: ${Number(w.bail_amount).toLocaleString()}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                type="button"
                                className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border bg-green-900/30 text-green-400 border-green-700/40 hover:bg-green-900/50 transition-colors"
                                title="Import to local system"
                                onClick={(e) => { e.stopPropagation(); openUtahDetail(w, 'utah'); }}
                              >
                                <Download className="w-3 h-3 inline mr-0.5" />Import
                              </button>
                              {w.offense_level ? (
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${SEVERITY_COLORS[w.offense_level] || 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50'}`}>
                                  {w.offense_level}
                                </span>
                              ) : (
                                <span className="text-[9px] bg-red-900/30 text-red-400 border border-red-700/40 px-1.5 py-0.5 rounded font-bold uppercase">ACTIVE</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* MULTI-STATE SCRAPED results */}
                {uniResults.scraped.length > 0 && (
                  <div className="panel-raised">
                    <div className="p-3 border-b border-surface-border flex items-center gap-2">
                      <Radar className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-bold text-white">Multi-State Scraped</span>
                      <span className="ml-auto text-[10px] bg-amber-900/40 text-amber-400 border border-amber-700/50 px-1.5 py-0.5 rounded font-mono">
                        {uniResults.scraped.length}
                      </span>
                    </div>
                    <div className="divide-y divide-surface-border">
                      {uniResults.scraped.map((w, i) => (
                        <div key={`scraped-${i}`} className="p-3 hover:bg-surface-raised/50 transition-colors cursor-pointer" onClick={() => openUtahDetail(w, 'scraped')}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white">{w.last_name}, {w.first_name}</span>
                                {w.source_key && <span className="text-[9px] text-rmpg-400 bg-rmpg-700/30 px-1 rounded">{w.source_key}</span>}
                              </div>
                              <div className="text-xs text-rmpg-300 mt-1">{w.charges || w.charge_description || '—'}</div>
                              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-rmpg-400 flex-wrap">
                                {w.court_name && <span>Court: {w.court_name}</span>}
                                {w.issue_date && <span>Issued: {w.issue_date}</span>}
                                {w.bail_amount != null && w.bail_amount > 0 && (
                                  <span className="text-amber-400 font-bold">Bail: ${Number(w.bail_amount).toLocaleString()}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                type="button"
                                className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border bg-green-900/30 text-green-400 border-green-700/40 hover:bg-green-900/50 transition-colors"
                                title="Import to local system"
                                onClick={(e) => { e.stopPropagation(); openUtahDetail(w, 'scraped'); }}
                              >
                                <Download className="w-3 h-3 inline mr-0.5" />Import
                              </button>
                              {w.offense_level && (
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${SEVERITY_COLORS[w.offense_level] || 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50'}`}>
                                  {w.offense_level}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* No results */}
                {uniResults.meta.totalHits === 0 && (
                  <div className="panel-raised p-8 text-center">
                    <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
                    <div className="text-sm font-bold text-green-400">No Active Warrants Found</div>
                    <div className="text-xs text-rmpg-400 mt-1">
                      No warrants found for {uniSearchFirst} {uniSearchLast} across local system, Utah state, or multi-source databases.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Search History */}
            {uniSearchHistory.length > 0 && (
              <div className="panel-raised p-3">
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <History className="w-3 h-3" /> Recent Searches
                </div>
                <div className="flex flex-wrap gap-1">
                  {uniSearchHistory.map((h, i) => (
                    <button
                      key={i}
                      type="button"
                      className="text-[10px] bg-surface-base/80 text-rmpg-300 hover:text-white border border-surface-border hover:border-brand-blue/40 px-2 py-1 rounded transition-colors"
                      onClick={() => { setUniSearchFirst(h.first); setUniSearchLast(h.last); }}
                    >
                      {h.last}, {h.first}
                      {h.hits > 0 && <span className="text-red-400 ml-1">({h.hits})</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================
          TAB: WATCH LIST (Auto-Poll)
         ================================================================ */}
      {activeTab === 'watch' && (
        <div className="flex-1 overflow-auto">
          <div className="p-4 space-y-4">
            {autoPollLoading && !autoPollStatus ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-brand-blue mr-2" />
                <span className="text-xs text-rmpg-400">Loading watch status...</span>
              </div>
            ) : autoPollStatus ? (
              <>
                {/* Status Overview */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="panel-raised p-3 text-center">
                    <div className="text-xl font-bold font-mono text-white">{autoPollStatus.totalPersons}</div>
                    <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Persons Monitored</div>
                  </div>
                  <div className="panel-raised p-3 text-center">
                    <div className="text-xl font-bold font-mono text-red-400">{autoPollStatus.flaggedPersons.length}</div>
                    <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Warrant Hits</div>
                  </div>
                  <div className="panel-raised p-3 text-center">
                    <div className={`text-xl font-bold font-mono ${autoPollStatus.blocked ? 'text-red-400' : 'text-green-400'}`}>
                      {autoPollStatus.blocked ? 'BLOCKED' : 'ONLINE'}
                    </div>
                    <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Utah API</div>
                  </div>
                  <div className="panel-raised p-3 text-center">
                    <div className="text-xl font-bold font-mono text-rmpg-200">
                      {autoPollStatus.syncStatus.lastSync ? formatDate(autoPollStatus.syncStatus.lastSync) : 'Never'}
                    </div>
                    <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Last Scan</div>
                  </div>
                </div>

                {/* Trigger Scan + Sort + Map Controls */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="toolbar-btn text-xs bg-brand-blue/20 text-brand-blue border-brand-blue/40 hover:bg-brand-blue/30"
                    disabled={scanRunning}
                    onClick={async () => {
                      setScanRunning(true);
                      try {
                        await apiFetch('/warrants/watch/scan', { method: 'POST' });
                        setTimeout(() => { fetchAutoPollStatus(); setScanRunning(false); }, 5000);
                      } catch { setScanRunning(false); }
                    }}
                  >
                    {scanRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlayCircle className="w-3 h-3" />}
                    <span className="ml-1">{scanRunning ? 'Scanning...' : 'Run Scan Now'}</span>
                  </button>
                  <button type="button" className="toolbar-btn text-[10px]" onClick={fetchAutoPollStatus}>
                    <RotateCcw className="w-3 h-3" /> Refresh
                  </button>
                  <button
                    type="button"
                    className="toolbar-btn text-[10px] bg-red-900/20 text-red-400 border-red-700/40 hover:bg-red-900/30"
                    disabled={!autoPollStatus?.flaggedPersons?.length}
                    onClick={async () => {
                      if (!autoPollStatus?.flaggedPersons?.length) return;
                      try {
                        const { fetchPdfBranding, setActiveBranding, loadPdfAssets } = await import('../utils/pdfGenerator');
                        const branding = await fetchPdfBranding();
                        setActiveBranding(branding);
                        await loadPdfAssets();
                        const subjects: BoloSubject[] = autoPollStatus.flaggedPersons.map(p => ({
                          first_name: p.first_name,
                          last_name: p.last_name,
                          dob: p.dob,
                          gender: p.gender,
                          race: p.race,
                          height: p.height,
                          weight: p.weight,
                          hair_color: p.hair_color,
                          eye_color: p.eye_color,
                          address: p.address,
                          photo_url: p.photo_url,
                          warrants: p.warrants.map(w => ({
                            warrant_number: w.warrant_number,
                            type: w.type,
                            charge_description: w.charge_description,
                            offense_level: w.offense_level,
                            issuing_court: w.issuing_court,
                            bail_amount: w.bail_amount,
                          })),
                        }));
                        const pdf = generateBoloPdf(subjects);
                        const blob = pdf.output('blob');
                        const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `BOLO_Packet_${new Date().toISOString().slice(0, 10)}.pdf`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      } catch (err) {
                        console.error('BOLO PDF generation failed:', err);
                      }
                    }}
                  >
                    <Printer className="w-3 h-3" /> Print BOLO
                  </button>
                  <div className="flex items-center gap-1 ml-2 border-l border-surface-border pl-2">
                    <span className="text-[9px] text-rmpg-500 uppercase tracking-wider mr-1">Sort:</span>
                    {(['severity', 'recent', 'name'] as const).map(s => (
                      <button key={s} type="button"
                        className={`toolbar-btn text-[9px] ${watchSort === s ? 'bg-brand-blue/20 text-brand-blue border-brand-blue/40' : ''}`}
                        onClick={() => setWatchSort(s)}
                      >{s === 'severity' ? 'Severity' : s === 'recent' ? 'Recent' : 'Name'}</button>
                    ))}
                  </div>
                  <button type="button"
                    onClick={() => setWatchMapOpen(prev => !prev)}
                    className={`toolbar-btn text-[9px] ${watchMapOpen ? 'bg-brand-blue/20 text-brand-blue border-brand-blue/40' : ''}`}
                  >
                    <MapPin className="w-3 h-3" /> {watchMapOpen ? 'Hide Map' : 'Show Map'}
                  </button>
                  <span className="text-[10px] text-rmpg-500 ml-auto">Auto-scans every 4 hours</span>
                </div>

                {/* Embedded Watch Map */}
                {watchMapOpen && (
                  <div className="panel-inset bg-surface-sunken rounded-sm overflow-hidden" style={{ height: 280 }}>
                    <div ref={watchMapRef} className="w-full h-full" />
                  </div>
                )}

                {/* Flagged Persons -- Rich Cards */}
                {autoPollStatus.flaggedPersons.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                      <span className="text-xs font-bold text-white">Persons with Active Warrants</span>
                      <span className="ml-auto text-[10px] bg-red-900/40 text-red-400 border border-red-700/50 px-1.5 py-0.5 rounded font-mono font-bold">
                        {autoPollStatus.flaggedPersons.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {[...autoPollStatus.flaggedPersons].sort((a, b) => {
                        if (watchSort === 'severity') {
                          const order: Record<string, number> = { felony: 0, misdemeanor: 1, infraction: 2, civil: 3 };
                          const aO = order[a.warrant_severity || ''] ?? 4;
                          const bO = order[b.warrant_severity || ''] ?? 4;
                          return aO - bO;
                        }
                        if (watchSort === 'recent') {
                          const aDate = [...(a.warrants || [])].sort((x, y) => y.created_at.localeCompare(x.created_at))[0]?.created_at || '';
                          const bDate = [...(b.warrants || [])].sort((x, y) => y.created_at.localeCompare(x.created_at))[0]?.created_at || '';
                          return bDate.localeCompare(aDate);
                        }
                        return (a.last_name || '').localeCompare(b.last_name || '');
                      }).map((p) => {
                        const isExpanded = expandedWatchPersons.has(p.id);
                        const severityColor = p.warrant_severity === 'felony' ? 'border-l-red-500' :
                          p.warrant_severity === 'misdemeanor' ? 'border-l-amber-500' :
                          'border-l-rmpg-500';
                        const severityBg = p.warrant_severity === 'felony' ? 'bg-red-900/50 text-red-400 border-red-700/50' :
                          p.warrant_severity === 'misdemeanor' ? 'bg-amber-900/50 text-amber-400 border-amber-700/50' :
                          'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50';
                        const allWarrants = [...(p.warrants || [])];
                        const allUtah = [...(p.utahWarrants || [])];
                        return (
                          <div key={p.id} id={`watch-person-${p.id}`} className={`panel-raised border-l-4 ${severityColor}`}>
                            {/* Card Header */}
                            <div className="p-3 flex items-start gap-3">
                              {/* Photo */}
                              <div className="flex-shrink-0">
                                {p.photo_url ? (
                                  <img src={p.photo_url} alt="" className="w-12 h-12 rounded-sm object-cover border border-rmpg-600" />
                                ) : (
                                  <div className="w-12 h-12 rounded-sm bg-rmpg-700/60 border border-rmpg-600 flex items-center justify-center">
                                    <User className="w-6 h-6 text-rmpg-400" />
                                  </div>
                                )}
                              </div>
                              {/* Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-bold text-white">{p.last_name}, {p.first_name}</span>
                                  {p.warrant_severity && (
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${severityBg}`}>
                                      {p.warrant_severity}
                                    </span>
                                  )}
                                  {p.local_warrant_count > 0 && (
                                    <span className="text-[9px] bg-brand-blue/20 text-brand-blue border border-brand-blue/30 px-1.5 py-0.5 rounded">
                                      {p.local_warrant_count} local
                                    </span>
                                  )}
                                  {p.utah_hit_count > 0 && (
                                    <span className="text-[9px] bg-red-900/30 text-red-400 border border-red-700/40 px-1.5 py-0.5 rounded">
                                      {p.utah_hit_count} Utah
                                    </span>
                                  )}
                                </div>
                                {p.dob && <div className="text-[10px] text-rmpg-400 mt-0.5">DOB: {p.dob}</div>}
                                {(() => {
                                  const descs = [p.gender, p.race, p.height, p.weight, p.hair_color ? `${p.hair_color} hair` : null, p.eye_color ? `${p.eye_color} eyes` : null].filter(Boolean);
                                  return descs.length > 0 ? (
                                    <div className="text-[10px] text-rmpg-400 mt-0.5">{descs.join(' / ')}</div>
                                  ) : null;
                                })()}
                                {p.address && (
                                  <div className="flex items-center gap-1 mt-0.5 text-[10px] text-rmpg-400">
                                    <MapPin className="w-2.5 h-2.5 flex-shrink-0" /> {p.address}
                                  </div>
                                )}
                              </div>
                              {/* Expand toggle */}
                              <button type="button" className="flex-shrink-0 toolbar-btn text-[9px]"
                                onClick={() => setExpandedWatchPersons(prev => {
                                  const next = new Set(prev);
                                  if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                                  return next;
                                })}
                              >
                                <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                {isExpanded ? 'Less' : 'Warrants'}
                              </button>
                            </div>

                            {/* Expanded warrants list */}
                            {isExpanded && (allWarrants.length > 0 || allUtah.length > 0) && (
                              <div className="border-t border-surface-border">
                                {allWarrants.length > 0 && (
                                  <div className="panel-beveled m-2 p-2">
                                    <div className="text-[9px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Local Warrants</div>
                                    <div className="space-y-1">
                                      {allWarrants.map(w => (
                                        <div key={w.id} className="flex items-center gap-2 text-[10px] p-1.5 rounded bg-surface-sunken/50">
                                          <span className="font-mono text-rmpg-200">{w.warrant_number}</span>
                                          <span className="text-rmpg-400">{w.type}</span>
                                          <span className="text-rmpg-200 flex-1 truncate">{w.charge_description}</span>
                                          {w.issuing_court && <span className="text-rmpg-400 truncate">{w.issuing_court}</span>}
                                          {w.bail_amount != null && w.bail_amount > 0 && (
                                            <span className="text-amber-400 font-mono">${w.bail_amount.toLocaleString()}</span>
                                          )}
                                          {w.offense_level && (
                                            <span className={`text-[8px] font-bold uppercase px-1 py-0.5 rounded border ${
                                              w.offense_level === 'felony' ? 'bg-red-900/50 text-red-400 border-red-700/50' :
                                              w.offense_level === 'misdemeanor' ? 'bg-amber-900/50 text-amber-400 border-amber-700/50' :
                                              'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50'
                                            }`}>{w.offense_level}</span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {allUtah.length > 0 && (
                                  <div className="panel-beveled m-2 p-2">
                                    <div className="text-[9px] font-bold text-rmpg-300 uppercase tracking-wider mb-1">Utah State Warrants</div>
                                    <div className="space-y-1">
                                      {allUtah.map((uw, i) => (
                                        <div key={i} className="flex items-center gap-2 text-[10px] p-1.5 rounded bg-surface-sunken/50">
                                          <span className="font-mono text-rmpg-200">{uw.utah_warrant_id}</span>
                                          <span className="text-rmpg-200 flex-1 truncate">{uw.charges}</span>
                                          <span className="text-rmpg-400 truncate">{uw.court_name}</span>
                                          <span className="text-rmpg-500">{uw.issue_date}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Action buttons */}
                            <div className="p-2 border-t border-surface-border flex items-center gap-1 flex-wrap">
                              <button type="button" className="toolbar-btn text-[9px]" title="Search All"
                                onClick={() => {
                                  setUniSearchFirst(p.first_name);
                                  setUniSearchLast(p.last_name);
                                  setActiveTab('search-all');
                                  setTimeout(() => runUnifiedSearch(), 100);
                                }}
                              >
                                <Search className="w-3 h-3" /> Search All
                              </button>
                              <button type="button" className="toolbar-btn text-[9px]" title="Print Sheet"
                                onClick={() => {
                                  const pdfData: WarrantPdfData = {
                                    warrant_number: allWarrants[0]?.warrant_number || 'N/A',
                                    type: allWarrants[0]?.type || 'arrest',
                                    status: allWarrants[0]?.status || 'active',
                                    subject_first_name: p.first_name,
                                    subject_last_name: p.last_name,
                                    subject_dob: p.dob || undefined,
                                    subject_gender: p.gender || undefined,
                                    subject_race: p.race || undefined,
                                    subject_height: p.height || undefined,
                                    subject_weight: p.weight || undefined,
                                    subject_hair_color: p.hair_color || undefined,
                                    subject_eye_color: p.eye_color || undefined,
                                    subject_address: p.address || undefined,
                                    subject_photo_url: p.photo_url || undefined,
                                    charge_description: allWarrants[0]?.charge_description || allUtah[0]?.charges || '',
                                    offense_level: allWarrants[0]?.offense_level as any || undefined,
                                    bail_amount: allWarrants[0]?.bail_amount || undefined,
                                    issuing_court: allWarrants[0]?.issuing_court || allUtah[0]?.court_name || undefined,
                                    issuing_judge: undefined,
                                    entered_by_name: undefined,
                                    created_at: allWarrants[0]?.created_at || new Date().toISOString(),
                                    notes: undefined,
                                  };
                                  downloadRecordPdf('warrant', pdfData, pdfData.warrant_number);
                                }}
                              >
                                <Printer className="w-3 h-3" /> Print Sheet
                              </button>
                              <button type="button" className="toolbar-btn text-[9px]" title="View Record"
                                onClick={() => navigate(`/records?tab=persons&personId=${p.id}`)}
                              >
                                <FileText className="w-3 h-3" /> View Record
                              </button>
                              <button type="button" className="toolbar-btn text-[9px]" title="View Calls"
                                onClick={() => navigate(`/dispatch?personId=${p.id}`)}
                              >
                                <Gavel className="w-3 h-3" /> View Calls
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Recent Watch Log */}
                {autoPollStatus.recentHits.length > 0 && (
                  <div className="panel-raised">
                    <div className="p-3 border-b border-surface-border flex items-center gap-2">
                      <History className="w-3.5 h-3.5 text-rmpg-300" />
                      <span className="text-xs font-bold text-white">Recent Activity</span>
                    </div>
                    <div className="divide-y divide-surface-border max-h-[300px] overflow-auto">
                      {autoPollStatus.recentHits.map((h) => (
                        <div key={h.id} className="p-2.5 flex items-center gap-2 text-xs">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            h.event === 'warrant_found' ? 'bg-red-400' : 'bg-green-400'
                          }`} />
                          <span className="text-rmpg-200 font-medium">{h.person_name}</span>
                          <span className={`text-[10px] ${h.event === 'warrant_found' ? 'text-red-400' : 'text-green-400'}`}>
                            {h.event === 'warrant_found' ? 'WARRANT FOUND' : 'WARRANT CLEARED'}
                          </span>
                          {h.charges && <span className="text-[10px] text-rmpg-400 truncate flex-1">{h.charges}</span>}
                          <span className="text-[10px] text-rmpg-500 flex-shrink-0 ml-auto">{formatDateTime(h.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Scan History */}
                {autoPollStatus.runs.length > 0 && (
                  <div className="panel-raised">
                    <div className="p-3 border-b border-surface-border flex items-center gap-2">
                      <Activity className="w-3.5 h-3.5 text-rmpg-300" />
                      <span className="text-xs font-bold text-white">Scan History</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-surface-border text-[10px] text-rmpg-400 uppercase tracking-wider">
                            <th className="p-2 text-left">Started</th>
                            <th className="p-2 text-center">Checked</th>
                            <th className="p-2 text-center">Found</th>
                            <th className="p-2 text-center">Cleared</th>
                            <th className="p-2 text-center">Errors</th>
                            <th className="p-2 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-border">
                          {autoPollStatus.runs.map((r) => (
                            <tr key={r.id} className="hover:bg-surface-raised/50">
                              <td className="p-2 text-rmpg-300">{formatDateTime(r.started_at)}</td>
                              <td className="p-2 text-center text-white font-mono">{r.persons_checked}</td>
                              <td className="p-2 text-center text-red-400 font-mono font-bold">{r.new_warrants_found}</td>
                              <td className="p-2 text-center text-green-400 font-mono">{r.warrants_cleared}</td>
                              <td className="p-2 text-center text-amber-400 font-mono">{r.errors}</td>
                              <td className="p-2 text-center">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                  r.status === 'completed' ? 'bg-green-900/30 text-green-400' :
                                  r.status === 'running' ? 'bg-brand-blue/20 text-brand-blue' :
                                  'bg-red-900/30 text-red-400'
                                }`}>{(r.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <EmptyState icon={Radar} title="Watch List" description="No auto-poll data available yet. The system scans all persons in the database every 4 hours." />
            )}
          </div>
        </div>
      )}

      {/* ================================================================
          TAB 3: SOURCES (admin/manager only)
         ================================================================ */}
      {activeTab === 'sources' && (isGodMode || isAdminOrManager) && (
        <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent">
          <div className="p-4 space-y-4">
            {/* Coverage Section */}
            {coverageLoading ? (
              <div className="flex items-center justify-center h-64 text-rmpg-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" role="status" aria-label="Loading" /> Loading coverage data...
              </div>
            ) : (() => {
              const byState = new Map<string, ScraperSource[]>();
              for (const src of coverageSources) {
                const list = byState.get(src.state) || [];
                list.push(src);
                byState.set(src.state, list);
              }

              const totalSources = coverageSources.length;
              const enabledSources = coverageSources.filter(s => s.enabled).length;
              const statesWithSources = new Set(coverageSources.map(s => s.state).filter(s => s !== 'ALL'));
              const totalActive = coverageSources.reduce((sum, s) => sum + s.active_warrants, 0);
              const totalScraped = coverageSources.reduce((sum, s) => sum + s.total_warrants, 0);
              const recentlyScraped = coverageSources.filter(s => {
                if (!s.last_scraped_at) return false;
                const ago = Date.now() - new Date(s.last_scraped_at.replace(' ', 'T')).getTime();
                return ago < 3 * 60 * 60 * 1000;
              }).length;

              const federalSources = byState.get('US') || [];
              const stateCodes = [...byState.keys()].filter(k => k !== 'US' && k !== 'ALL').sort();

              return (
                <>
                  {/* Summary stats */}
                  <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-5'} gap-3`}>
                    {[
                      { label: 'States Covered', value: statesWithSources.size, sub: 'of 50 + Federal' },
                      { label: 'Total Sources', value: totalSources, sub: `${enabledSources} enabled` },
                      { label: 'Recently Scraped', value: recentlyScraped, sub: 'within 3 hours' },
                      { label: 'Active Warrants', value: totalActive.toLocaleString(), sub: 'across all sources' },
                      { label: 'Total Indexed', value: totalScraped.toLocaleString(), sub: 'all-time records' },
                    ].map((s, i) => (
                      <div key={i} className="panel-inset bg-surface-sunken p-3 rounded-sm text-center">
                        <div className="text-lg font-bold text-white font-mono">{s.value}</div>
                        <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">{s.label}</div>
                        <div className="text-[9px] text-rmpg-500 mt-0.5">{s.sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Federal sources */}
                  {federalSources.length > 0 && (
                    <div className="panel-inset bg-surface-sunken p-3 rounded-sm">
                      <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-2">
                        <Shield className="w-3.5 h-3.5 text-brand-400" />
                        Federal Sources ({federalSources.length})
                      </h3>
                      <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2 xl:grid-cols-3'} gap-2`}>
                        {federalSources.map(src => (
                          <CoverageSourceCard key={src.source_key} source={src} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* State grid */}
                  <div className="panel-inset bg-surface-sunken p-3 rounded-sm">
                    <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-2">
                      <Globe className="w-3.5 h-3.5 text-brand-400" />
                      State Coverage ({stateCodes.length} states)
                    </h3>
                    <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'} gap-2`}>
                      {stateCodes.map(state => {
                        const sources = byState.get(state) || [];
                        const active = sources.reduce((sum, s) => sum + s.active_warrants, 0);
                        const enabled = sources.filter(s => s.enabled).length;
                        const hasErrors = sources.some(s => s.consecutive_failures > 0);
                        const lastScraped = sources.map(s => s.last_scraped_at).filter(Boolean).sort().pop();
                        const isRecent = lastScraped && (Date.now() - new Date(lastScraped.replace(' ', 'T')).getTime()) < 3 * 60 * 60 * 1000;

                        return (
                          <div
                            key={state}
                            className={`p-2 rounded-sm border text-center ${
                              enabled === 0
                                ? 'border-rmpg-700/50 bg-rmpg-700/30'
                                : hasErrors
                                  ? 'border-amber-700/50 bg-amber-900/10'
                                  : isRecent
                                    ? 'border-green-700/50 bg-green-900/10'
                                    : 'border-brand-600/30 bg-brand-900/10'
                            }`}
                          >
                            <div className="text-sm font-bold font-mono text-white">{state}</div>
                            <div className="text-[10px] text-rmpg-300 mt-1">{sources.length} source{sources.length !== 1 ? 's' : ''}</div>
                            {active > 0 && <div className="text-[9px] text-red-400 font-bold mt-0.5">{active} active</div>}
                            <div className={`mt-1 inline-flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded-sm ${
                              enabled === 0
                                ? 'bg-rmpg-700/50 text-rmpg-500'
                                : isRecent
                                  ? 'bg-green-900/50 text-green-400'
                                  : hasErrors
                                    ? 'bg-amber-900/50 text-amber-400'
                                    : 'bg-brand-900/50 text-brand-300'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                enabled === 0 ? 'bg-rmpg-600' : isRecent ? 'bg-green-400' : hasErrors ? 'bg-amber-400' : 'bg-brand-400'
                              }`} />
                              {enabled === 0 ? 'DISABLED' : isRecent ? 'ACTIVE' : hasErrors ? 'ERRORS' : 'ENABLED'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Detailed source list */}
                  <details className="panel-inset bg-surface-sunken p-3 rounded-sm">
                    <summary className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider cursor-pointer flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-brand-400" />
                      All Sources Detail ({totalSources})
                    </summary>
                    <div className="mt-3 overflow-x-auto">
                      <table className="table-dark text-[10px] w-full">
                        <thead className="sticky top-0 z-10 bg-[#050505]">
                          <tr>
                            <th className="text-left px-2 py-1">Source</th>
                            <th className="text-left px-2 py-1">State</th>
                            <th className="text-left px-2 py-1">County</th>
                            <th className="text-center px-2 py-1">Status</th>
                            <th className="text-right px-2 py-1">Interval</th>
                            <th className="text-right px-2 py-1">Active</th>
                            <th className="text-right px-2 py-1">Total</th>
                            <th className="text-left px-2 py-1">Last Scraped</th>
                          </tr>
                        </thead>
                        <tbody>
                          {coverageSources.map(src => (
                            <tr key={src.source_key} className="border-t border-rmpg-800/50 hover:bg-[#141414]/30 transition-colors">
                              <td className="px-2 py-1 font-mono text-rmpg-300">{src.source_key}</td>
                              <td className="px-2 py-1">{src.state}</td>
                              <td className="px-2 py-1 text-rmpg-400">{src.county || '-'}</td>
                              <td className="px-2 py-1 text-center">
                                {src.enabled ? (
                                  src.consecutive_failures > 0 ? (
                                    <span className="text-amber-400">{src.consecutive_failures} failures</span>
                                  ) : (
                                    <span className="text-green-400">Enabled</span>
                                  )
                                ) : (
                                  <span className="text-rmpg-500">Disabled</span>
                                )}
                              </td>
                              <td className="px-2 py-1 text-right text-rmpg-400">{src.scrape_interval_minutes}m</td>
                              <td className="px-2 py-1 text-right font-mono">{src.active_warrants}</td>
                              <td className="px-2 py-1 text-right font-mono text-rmpg-400">{src.total_warrants}</td>
                              <td className="px-2 py-1 text-rmpg-400">
                                {src.last_scraped_at ? formatDateTime(src.last_scraped_at) : 'Never'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              );
            })()}

            {/* Scan History Section */}
            <div className="panel-inset bg-surface-sunken p-3 rounded-sm">
              <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                <History className="w-3.5 h-3.5 text-brand-400" />
                Scan History
                <span className="text-rmpg-500 font-normal">({watchRuns.length} runs)</span>
              </h3>

              {watchRunsLoading ? (
                <div className="flex items-center justify-center h-32 text-rmpg-400">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" role="status" aria-label="Loading" /> Loading scan history...
                </div>
              ) : watchRuns.length === 0 ? (
                <div className="text-center py-6">
                  <Clock className="w-8 h-8 mx-auto mb-2 text-rmpg-500/40" />
                  <p className="text-sm text-rmpg-400">No Scans Yet</p>
                  <p className="text-[10px] text-rmpg-500 mt-1">Automated scans run at noon and midnight Mountain Time.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {watchRuns.map((run) => (
                    <div key={run.id} className="panel-beveled p-3 rounded-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-mono text-xs text-rmpg-200 font-bold">{run.run_id}</span>
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold rounded-sm border ${
                          run.status === 'completed' ? 'bg-green-900/50 text-green-400 border-green-700/50'
                            : run.status === 'running' ? 'bg-gray-900/50 text-gray-400 border-gray-700/50'
                            : 'bg-red-900/50 text-red-400 border-red-700/50'
                        }`}>
                          {run.status === 'running' && <Loader2 className="w-2.5 h-2.5 animate-spin" role="status" aria-label="Loading" />}
                          <span className={`led-dot ${
                            run.status === 'completed' ? 'led-green' : run.status === 'running' ? 'led-gray animate-led-pulse' : 'led-red'
                          }`} />
                          {run.status.toUpperCase()}
                        </span>
                        <span className="ml-auto text-[10px] text-rmpg-500 font-mono">
                          {computeDuration(run.started_at, run.completed_at)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                        <div className="panel-beveled p-2">
                          <div className="text-[9px] text-rmpg-500 uppercase">Persons</div>
                          <div className="text-base font-bold font-mono text-white tabular-nums">{run.persons_checked}</div>
                        </div>
                        <div className="panel-beveled p-2">
                          <div className="text-[9px] text-rmpg-500 uppercase">New Warrants</div>
                          <div className={`text-base font-bold font-mono tabular-nums ${run.new_warrants_found > 0 ? 'text-red-400' : 'text-white'}`}>
                            {run.new_warrants_found}
                          </div>
                        </div>
                        <div className="panel-beveled p-2">
                          <div className="text-[9px] text-rmpg-500 uppercase">Cleared</div>
                          <div className={`text-base font-bold font-mono tabular-nums ${run.warrants_cleared > 0 ? 'text-green-400' : 'text-white'}`}>
                            {run.warrants_cleared}
                          </div>
                        </div>
                        <div className="panel-beveled p-2">
                          <div className="text-[9px] text-rmpg-500 uppercase">Errors</div>
                          <div className={`text-base font-bold font-mono tabular-nums ${run.errors > 0 ? 'text-amber-400' : 'text-white'}`}>
                            {run.errors}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 text-[10px] text-rmpg-500 font-mono">
                        Started: {formatDateTime(run.started_at)}
                        {run.completed_at && ` \u2192 Completed: ${formatDateTime(run.completed_at)}`}
                      </div>
                      {run.error_message && (
                        <div className="mt-1 text-[10px] text-red-400 bg-red-900/20 px-2 py-1 rounded-sm">{run.error_message}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================
          TAB 4: SCRAPERS — admin/manager only, phase 5 dashboard
         ================================================================ */}
      {activeTab === 'scrapers' && (isGodMode || isAdminOrManager) && (
        <ScrapersTab />
      )}

      {/* ================================================================
          PERSON PROFILE SLIDE-OUT
         ================================================================ */}
      {personProfileOpen && (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={() => setPersonProfileOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className={`relative ${isMobile ? 'w-full' : 'w-[420px]'} h-full bg-surface-base border-l border-rmpg-600 shadow-md flex flex-col overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-600 bg-[var(--grid-header-bg)]">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <User className="w-4 h-4 text-brand-400" /> Person Warrant Profile
              </h2>
              <IconButton onClick={() => setPersonProfileOpen(false)} className="text-rmpg-400 hover:text-white" aria-label="Close person profile">
                <X className="w-4 h-4" />
              </IconButton>
            </div>

            {personProfileLoading ? (
              <div className="flex-1 flex items-center justify-center text-rmpg-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" role="status" aria-label="Loading" /> Loading profile...
              </div>
            ) : personProfile ? (
              <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent p-4 space-y-4">
                {/* Person header */}
                <div className="panel-beveled p-4 flex items-start gap-3">
                  {personProfile.person.photo_url ? (
                    <img src={personProfile.person.photo_url} alt="" className="w-16 h-16 rounded-sm object-cover border border-rmpg-600" />
                  ) : (
                    <div className="w-16 h-16 rounded-sm bg-surface-raised border border-rmpg-600 flex items-center justify-center">
                      <User className="w-8 h-8 text-rmpg-500" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-base font-bold text-white">
                      {personProfile.person.first_name} {personProfile.person.last_name}
                    </h3>
                    {personProfile.person.dob && (
                      <div className="text-xs text-rmpg-400 mt-0.5">DOB: {formatDate(personProfile.person.dob)}</div>
                    )}
                    {personProfile.person.flags && (
                      <div className="mt-1">
                        <WarrantBadge flags={personProfile.person.flags} size="md" />
                      </div>
                    )}
                    {personProfile.lastChecked && (
                      <div className="text-[10px] text-rmpg-500 mt-1">Last checked: {relativeTime(personProfile.lastChecked)}</div>
                    )}
                  </div>
                </div>

                {/* Quick actions */}
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => handleRunCheck(personProfile.person.id)}
                    disabled={checkingPerson}
                    className="toolbar-btn toolbar-btn-primary text-[9px] flex-1"
                  >
                    {checkingPerson ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Radar className="w-3 h-3" />}
                    Run Check Now
                  </button>
                  <button type="button"
                    onClick={() => {
                      setPersonProfileOpen(false);
                      setFormData(prev => ({
                        ...prev,
                        type: 'arrest',
                        subject_person_id: String(personProfile.person.id),
                      }));
                      setSelectedPersonName(`${personProfile.person.first_name} ${personProfile.person.last_name}`);
                      openNewForm();
                      // Re-set person ID after openNewForm resets
                      setTimeout(() => {
                        setFormData(prev => ({
                          ...prev,
                          subject_person_id: String(personProfile.person.id),
                        }));
                        setSelectedPersonName(`${personProfile.person.first_name} ${personProfile.person.last_name}`);
                      }, 0);
                    }}
                    className="toolbar-btn text-[9px] flex-1"
                  >
                    <Plus className="w-3 h-3" /> Create Manual Warrant
                  </button>
                </div>

                {/* Warrants list */}
                <div>
                  <h4 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-2">
                    <Gavel className="w-3.5 h-3.5 text-brand-400" />
                    Warrants ({personProfile.warrants.length})
                  </h4>
                  {personProfile.warrants.length === 0 ? (
                    <div className="panel-inset bg-surface-sunken p-4 text-center text-xs text-rmpg-500">
                      No warrants on file
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {personProfile.warrants.map(w => (
                        <div key={w.id} className="panel-inset bg-surface-sunken p-3 rounded-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-xs text-white font-bold">{w.warrant_number}</span>
                            <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded-sm border ${STATUS_COLORS[w.status] || ''}`}>
                              {w.status.toUpperCase()}
                            </span>
                            <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded-sm border ${TYPE_COLORS[w.type] || TYPE_COLORS.other}`}>
                              {w.type.toUpperCase()}
                            </span>
                          </div>
                          <div className="text-xs text-rmpg-300">{chargesFromJson(w.charge_description)}</div>
                          <div className="text-[10px] text-rmpg-500 mt-1">
                            {formatDate(w.created_at)}
                            {w.issuing_court && ` \u2022 ${w.issuing_court}`}
                            {w.bail_amount ? ` \u2022 Bail: ${formatCurrency(w.bail_amount)}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Scan history timeline */}
                {personProfile.scanHistory && personProfile.scanHistory.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-2">
                      <History className="w-3.5 h-3.5 text-brand-400" />
                      Scan History
                    </h4>
                    <div className="space-y-1">
                      {personProfile.scanHistory.map(entry => (
                        <div key={entry.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs ${
                          entry.event.includes('found') ? 'bg-red-900/10 border border-red-900/20' : 'bg-green-900/10 border border-green-900/20'
                        }`}>
                          {entry.event.includes('found')
                            ? <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                            : <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />
                          }
                          <span className="text-rmpg-300 flex-1">{entry.details || entry.event}</span>
                          <span className="text-[9px] text-rmpg-500 font-mono shrink-0">{relativeTime(entry.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-rmpg-500 text-sm">
                Profile not available
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================
          MODALS
         ================================================================ */}

      {/* FORM MODAL */}
      {formOpen && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby={warrantFormTitleId}>
          <div className={`panel-beveled ${isMobile ? 'w-full h-full' : 'w-[550px] max-h-[85vh]'} overflow-auto bg-surface-base`}>
            <div className="flex items-center justify-between p-4 border-b border-rmpg-600">
              <div className="flex items-center gap-2">
                <h2 id={warrantFormTitleId} className="text-sm font-bold text-white">{editingWarrant ? 'Edit Warrant' : 'New Warrant'}</h2>
                {formIsDirty && (
                  <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wider">UNSAVED</span>
                )}
              </div>
              <IconButton onClick={() => { clearFormDraft(); setFormOpen(false); }} className="text-rmpg-400 hover:text-white" aria-label="Close form"><X className="w-4 h-4" /></IconButton>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              {formWasRestored && (
                <div className="flex items-center justify-between px-3 py-2 rounded-sm border border-amber-500/30" style={{ background: '#1a1500' }}>
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-amber-400" />
                    <span className="text-xs text-amber-400 font-medium">Restored pending draft</span>
                  </div>
                  <button type="button" onClick={clearFormDraft} className="text-[10px] text-amber-400 underline hover:text-amber-300">
                    Discard
                  </button>
                </div>
              )}
              {/* Type + Offense Level */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Warrant Type *</label>
                  <select className="select-dark text-xs w-full" value={formData.type} onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}>
                    {WARRANT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Offense Level</label>
                  <select className="select-dark text-xs w-full" value={formData.offense_level} onChange={(e) => setFormData(prev => ({ ...prev, offense_level: e.target.value }))}>
                    <option value="">-- Select --</option>
                    {OFFENSE_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Subject person search */}
              <div className="relative">
                <label className="field-label">Subject Person</label>
                {selectedPersonName && formData.subject_person_id ? (
                  <div className="flex items-center gap-2 p-2 bg-surface-raised border border-rmpg-600 rounded-sm text-xs">
                    <User className="w-3 h-3 text-brand-400" />
                    <span className="text-white font-bold">{selectedPersonName}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setFormData(prev => ({ ...prev, subject_person_id: '' }));
                        setSelectedPersonName('');
                      }}
                      className="ml-auto text-rmpg-400 hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      className="input-dark text-xs w-full min-h-[36px]"
                      placeholder="Search persons by name..." aria-label="Search persons by name..."
                      value={personSearch}
                      onChange={(e) => { setPersonSearch(e.target.value); setShowPersonDropdown(true); }}
                      onFocus={() => setShowPersonDropdown(true)}
                    />
                    {showPersonDropdown && personResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 max-h-40 overflow-auto scrollbar-thin scrollbar-thumb-[#222222] scrollbar-track-transparent bg-rmpg-800 border border-rmpg-600 rounded-sm shadow-lg">
                        {personResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setFormData(prev => ({ ...prev, subject_person_id: String(p.id) }));
                              setSelectedPersonName(`${p.first_name} ${p.last_name}`);
                              setShowPersonDropdown(false);
                              setPersonSearch('');
                            }}
                            className="w-full text-left px-3 py-2 text-xs text-rmpg-200 hover:bg-rmpg-700 transition-colors flex items-center gap-2"
                          >
                            <User className="w-3 h-3 text-rmpg-400" />
                            <span className="font-bold text-white">{p.first_name} {p.last_name}</span>
                            {p.dob && <span className="text-rmpg-400 ml-auto">DOB: {p.dob}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {personSearchLoading && (
                      <div className="absolute right-2 top-7"><Loader2 className="w-3 h-3 animate-spin text-rmpg-400" role="status" aria-label="Loading" /></div>
                    )}
                  </>
                )}
              </div>

              {/* Statute Lookup */}
              <div>
                <label className="field-label">Statute Reference</label>
                <StatuteLookup
                  value={formData.statute_citation || undefined}
                  onSelect={(statute: StatuteResult) => {
                    setFormData(prev => ({
                      ...prev,
                      statute_id: statute.id,
                      statute_citation: statute.citation,
                      charge_description: prev.charge_description || `${statute.citation} - ${statute.short_title}`,
                    }));
                  }}
                  onClear={() => setFormData(prev => ({ ...prev, statute_id: null, statute_citation: '' }))}
                  placeholder="Search statute (e.g. 76-5-102 or assault)..." aria-label="Search statute (e.g. 76-5-102 or assault)..."
                  showStateFilter
                />
              </div>

              {/* Charge Description */}
              <div>
                <label className="field-label">Charge Description *</label>
                <textarea
                  className="input-dark text-xs w-full min-h-[36px]"
                  rows={3}
                  value={formData.charge_description}
                  onChange={(e) => setFormData(prev => ({ ...prev, charge_description: e.target.value }))}
                  placeholder="Enter charge description..."
                  required
                />
                {formErrors.charge_description && (
                  <p className="text-red-400 text-[10px] mt-0.5">{formErrors.charge_description}</p>
                )}
              </div>

              {/* Court + Judge */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Issuing Court</label>
                  <input type="text" className="input-dark text-xs w-full min-h-[36px]" value={formData.issuing_court} onChange={(e) => setFormData(prev => ({ ...prev, issuing_court: e.target.value }))} placeholder="e.g. 3rd District Court" />
                </div>
                <div>
                  <label className="field-label">Issuing Judge</label>
                  <input type="text" className="input-dark text-xs w-full min-h-[36px]" value={formData.issuing_judge} onChange={(e) => setFormData(prev => ({ ...prev, issuing_judge: e.target.value }))} placeholder="e.g. Hon. Smith" />
                </div>
              </div>

              {/* Bail + Expires */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Bail Amount</label>
                  <input type="number" step="0.01" className={`input-dark text-xs w-full ${formErrors.bail_amount ? '!border-red-500' : ''}`} value={formData.bail_amount} onChange={(e) => setFormData(prev => ({ ...prev, bail_amount: e.target.value }))} placeholder="0.00" />
                  {formErrors.bail_amount && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.bail_amount}</p>}
                </div>
                <div>
                  <label className="field-label">Expires</label>
                  <input type="date" className="input-dark text-xs w-full min-h-[36px]" value={formData.expires_at} onChange={(e) => setFormData(prev => ({ ...prev, expires_at: e.target.value }))} />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="field-label">Notes</label>
                <textarea className="input-dark text-xs w-full min-h-[36px]" rows={2} value={formData.notes} onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Additional notes..." />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-600">
                <button type="button" onClick={() => { clearFormDraft(); setFormOpen(false); }} className="toolbar-btn text-xs">Cancel</button>
                <button type="submit" disabled={submitting} className="toolbar-btn toolbar-btn-primary text-xs">
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin mr-1" role="status" aria-label="Loading" /> : null}
                  {editingWarrant ? 'Update Warrant' : 'Create Warrant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <UnsavedChangesGuard hasUnsavedChanges={formOpen && formIsDirty} />
      <FloatingSaveBar
        visible={formOpen && formIsDirty}
        onSave={() => { const e = { preventDefault: () => {} } as React.FormEvent; handleSubmit(e); }}
        onCancel={() => { clearFormDraft(); setFormOpen(false); }}
        isSaving={submitting}
        saveLabel={editingWarrant ? 'Update Warrant' : 'Create Warrant'}
      />

      {/* SERVE MODAL */}
      {serveModalOpen && selectedWarrant && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby={serveTitleId}>
          <div className={`panel-beveled ${isMobile ? 'w-full mx-4' : 'w-[400px]'} bg-surface-base`}>
            <div className="flex items-center justify-between p-4 border-b border-rmpg-600">
              <h2 id={serveTitleId} className="text-sm font-bold text-white">Serve Warrant</h2>
              <IconButton onClick={() => setServeModalOpen(false)} className="text-rmpg-400 hover:text-white" aria-label="Close serve modal"><X className="w-4 h-4" /></IconButton>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-xs text-rmpg-300">
                Mark warrant <span className="font-bold text-white font-mono">{selectedWarrant.warrant_number}</span> as served?
              </p>
              <div>
                <label className="field-label">Location Served (optional)</label>
                <input
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
      {isMobile && activeTab === 'warrants' && !selectedWarrant && !showArchived && !formOpen && (
        <IconButton onClick={openNewForm} className="mobile-fab" aria-label="New Warrant">
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

      {/* ================================================================
          UTAH WARRANT DETAIL MODAL
         ================================================================ */}
      {utahDetailWarrant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setUtahDetailWarrant(null)}>
          <div
            className="bg-[#050505] border border-[#222222] rounded w-full max-w-2xl max-h-[90vh] overflow-auto shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#222222] bg-[#0a0a0a]">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="text-base font-bold text-white truncate">
                  {utahDetailWarrant.last_name}, {utahDetailWarrant.first_name} {utahDetailWarrant.middle_name || ''}
                </span>
                <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-sm border flex-shrink-0 ${
                  utahDetailWarrant._source === 'utah' ? 'bg-red-900/50 text-red-400 border-red-700/50' :
                  utahDetailWarrant._source === 'local' ? 'bg-gray-900/50 text-gray-400 border-gray-700/50' :
                  'bg-amber-900/50 text-amber-400 border-amber-700/50'
                }`}>
                  {utahDetailWarrant._source === 'utah' ? 'UTAH STATE' : utahDetailWarrant._source === 'local' ? 'LOCAL' : 'SCRAPED'}
                </span>
              </div>
              <IconButton onClick={() => setUtahDetailWarrant(null)} className="text-rmpg-400 hover:text-white p-1" aria-label="Close warrant detail">
                <X className="w-4 h-4" />
              </IconButton>
            </div>

            <div className="p-4 space-y-4">
              {/* SUBJECT INFORMATION */}
              <div>
                <div className="bg-[#2e2e2e] px-3 py-1.5 rounded-t-sm">
                  <span className="text-[10px] font-bold text-white uppercase tracking-widest">Subject Information</span>
                </div>
                <div className="border border-t-0 border-[#222222] rounded-b-sm p-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Full Name</span>
                      <div className="font-mono text-white mt-0.5">{utahDetailWarrant.last_name}, {utahDetailWarrant.first_name} {utahDetailWarrant.middle_name || ''}</div>
                    </div>
                    {utahDetailWarrant.age != null && (
                      <div>
                        <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Age</span>
                        <div className="font-mono text-white mt-0.5">{utahDetailWarrant.age}</div>
                      </div>
                    )}
                    {utahDetailWarrant.city && (
                      <div>
                        <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">City</span>
                        <div className="font-mono text-white mt-0.5">{utahDetailWarrant.city}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* WARRANT DETAILS */}
              <div>
                <div className="bg-[#2e2e2e] px-3 py-1.5 rounded-t-sm">
                  <span className="text-[10px] font-bold text-white uppercase tracking-widest">Warrant Details</span>
                </div>
                <div className="border border-t-0 border-[#222222] rounded-b-sm p-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    {(utahDetailWarrant.warrant_id || utahDetailWarrant.utah_warrant_id) && (
                      <div>
                        <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Warrant ID</span>
                        <div className="font-mono text-white mt-0.5">{utahDetailWarrant.warrant_id || utahDetailWarrant.utah_warrant_id}</div>
                      </div>
                    )}
                    {utahDetailWarrant.warrant_type && (
                      <div>
                        <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Type</span>
                        <div className="font-mono text-white mt-0.5 uppercase">{utahDetailWarrant.warrant_type}</div>
                      </div>
                    )}
                    <div>
                      <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Status</span>
                      <div className="mt-0.5">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm border ${
                          (utahDetailWarrant.status || 'active') === 'active' ? 'bg-red-900/50 text-red-400 border-red-700/50' : 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50'
                        }`}>{utahDetailWarrant.status || 'ACTIVE'}</span>
                      </div>
                    </div>
                    {utahDetailWarrant.offense_level && (
                      <div>
                        <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Offense Level</span>
                        <div className="mt-0.5">
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm border ${
                            utahDetailWarrant.offense_level === 'felony' ? 'bg-red-900/50 text-red-400 border-red-700/50' :
                            utahDetailWarrant.offense_level === 'misdemeanor' ? 'bg-amber-900/50 text-amber-400 border-amber-700/50' :
                            'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50'
                          }`}>{(utahDetailWarrant.offense_level || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                        </div>
                      </div>
                    )}
                    {utahDetailWarrant.bail_amount != null && utahDetailWarrant.bail_amount > 0 && (
                      <div>
                        <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Bail Amount</span>
                        <div className="font-mono text-amber-400 font-bold mt-0.5 tabular-nums">${Number(utahDetailWarrant.bail_amount).toLocaleString()}</div>
                      </div>
                    )}
                  </div>
                  {/* Charges - full width */}
                  {(utahDetailWarrant.charges || utahDetailWarrant.charge_description) && (
                    <div className="mt-3">
                      <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Offense / Charges</span>
                      <div className="font-mono text-white mt-0.5 text-xs whitespace-pre-wrap">{utahDetailWarrant.charges || utahDetailWarrant.charge_description}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* COURT INFORMATION */}
              {(utahDetailWarrant.court_name || utahDetailWarrant.case_id || utahDetailWarrant.issue_date) && (
                <div>
                  <div className="bg-[#2e2e2e] px-3 py-1.5 rounded-t-sm">
                    <span className="text-[10px] font-bold text-white uppercase tracking-widest">Court Information</span>
                  </div>
                  <div className="border border-t-0 border-[#222222] rounded-b-sm p-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                      {utahDetailWarrant.court_name && (
                        <div>
                          <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Issuing Court</span>
                          <div className="font-mono text-white mt-0.5">{utahDetailWarrant.court_name}</div>
                        </div>
                      )}
                      {utahDetailWarrant.case_id && (
                        <div>
                          <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Case Number</span>
                          <div className="font-mono text-white mt-0.5">{utahDetailWarrant.case_id}</div>
                        </div>
                      )}
                      {utahDetailWarrant.issue_date && (
                        <div>
                          <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Issue Date</span>
                          <div className="font-mono text-white mt-0.5">{utahDetailWarrant.issue_date}</div>
                        </div>
                      )}
                      <div>
                        <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">State</span>
                        <div className="font-mono text-white mt-0.5">UTAH</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SOURCE / VERIFICATION */}
              <div>
                <div className="bg-[#2e2e2e] px-3 py-1.5 rounded-t-sm">
                  <span className="text-[10px] font-bold text-white uppercase tracking-widest">Source / Verification</span>
                </div>
                <div className="border border-t-0 border-[#222222] rounded-b-sm p-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Data Source</span>
                      <div className="font-mono text-white mt-0.5">
                        {utahDetailWarrant._source === 'utah' ? 'Utah State Warrants API' :
                         utahDetailWarrant._source === 'local' ? 'RMPG Local System' :
                         `Multi-Source (${utahDetailWarrant.source_key || 'scraped'})`}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Search Date</span>
                      <div className="font-mono text-white mt-0.5">{new Date().toLocaleString()}</div>
                    </div>
                    {utahDetailWarrant.fetched_at && (
                      <div>
                        <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider">Fetched At</span>
                        <div className="font-mono text-white mt-0.5">{formatDateTime(utahDetailWarrant.fetched_at)}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[#222222] bg-[#0a0a0a] flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleUtahPrint}
                  className="toolbar-btn text-xs bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]/40 hover:bg-[#d4a017]/30"
                >
                  <Printer className="w-3 h-3" />
                  <span className="ml-1">PRINT WARRANT</span>
                </button>
                {utahDetailWarrant._source !== 'local' && (
                  <button
                    type="button"
                    onClick={handleAddToLocal}
                    disabled={addingToLocal || addedToLocal}
                    className={`toolbar-btn text-xs ${addedToLocal
                      ? 'bg-green-900/30 text-green-400 border-green-700/50'
                      : 'bg-brand-blue/20 text-brand-blue border-brand-blue/40 hover:bg-brand-blue/30'
                    } disabled:opacity-60`}
                  >
                    {addingToLocal ? <Loader2 className="w-3 h-3 animate-spin" /> : addedToLocal ? <CheckCircle className="w-3 h-3" /> : <Download className="w-3 h-3" />}
                    <span className="ml-1">{addedToLocal ? 'ADDED' : 'ADD TO LOCAL RECORDS'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCheckPerson}
                  className="toolbar-btn text-xs bg-purple-900/30 text-purple-400 border-purple-700/50 hover:bg-purple-900/50"
                >
                  <UserCheck className="w-3 h-3" />
                  <span className="ml-1">CHECK PERSON</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setUtahDetailWarrant(null)}
                className="toolbar-btn text-xs"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
