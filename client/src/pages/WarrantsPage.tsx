import React, { useState, useEffect, useCallback, useRef, useId } from 'react';
import {
  AlertTriangle,
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
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
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import ExportButton from '../components/ExportButton';
import PrintRecordButton from '../components/PrintRecordButton';
import ConfirmDialog from '../components/ConfirmDialog';
import StatusBadge from '../components/StatusBadge';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import StatuteLookup, { OffenseLevelBadge } from '../components/StatuteLookup';
import type { StatuteResult } from '../components/StatuteLookup';
import { useFormValidation } from '../hooks/useFormValidation';
import EmptyState from '../components/EmptyState';
import { formatDate, formatDateTime } from '../utils/dateUtils';

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

interface WatchLogEntry {
  id: number;
  person_id: number;
  person_name: string;
  event: 'warrant_found' | 'warrant_cleared';
  utah_warrant_id: string | null;
  utah_person_id: string | null;
  court_name: string | null;
  case_id: string | null;
  charges: string | null;
  issue_date: string | null;
  scan_run_id: string;
  created_at: string;
  photo_url?: string | null;
  dob?: string | null;
  caution_flags?: string | null;
}

interface ActiveWarrantHit {
  person_id: number;
  person_name: string;
  utah_warrant_id: string;
  utah_person_id: string;
  court_name: string | null;
  case_id: string | null;
  charges: string | null;
  issue_date: string | null;
  first_detected: string;
  photo_url?: string | null;
  dob?: string | null;
  caution_flags?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
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

interface UtahWarrantResult {
  utah_person_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  age: number | null;
  city: string | null;
  utah_warrant_id: string;
  issue_date: string | null;
  court_name: string | null;
  case_id: string | null;
  charges: string | null;
  fetched_at?: string;
  source?: string;
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

type TabId = 'local' | 'watch' | 'utah' | 'all_states' | 'coverage' | 'history';

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'local', label: 'LOCAL WARRANTS', icon: Gavel },
  { id: 'watch', label: 'WARRANT WATCH', icon: Radar },
  { id: 'utah', label: 'UTAH SEARCH', icon: Globe },
  { id: 'all_states', label: 'ALL STATES', icon: FileText },
  { id: 'coverage', label: 'COVERAGE', icon: Shield },
  { id: 'history', label: 'SCAN HISTORY', icon: History },
];

// State abbreviation → full name mapping for display
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  US: 'Federal', ALL: 'All States',
};

interface ScrapedWarrant {
  id: number;
  source_key: string;
  warrant_id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  date_of_birth: string | null;
  age: number | null;
  gender: string | null;
  race: string | null;
  city: string | null;
  state: string;
  warrant_type: string | null;
  case_number: string | null;
  court_name: string | null;
  issue_date: string | null;
  charge_description: string | null;
  bail_amount: string | null;
  offense_level: string | null;
  photo_url: string | null;
  detail_url: string | null;
  status: string;
  source_display_name: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

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

// ============================================================
// Helpers
// ============================================================

// formatDate and formatDateTime imported from ../utils/dateUtils

function formatCurrency(amount: number | null): string {
  if (amount == null) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

/** Parse JSON charges array into a readable string */
function chargesFromJson(charges: string | null): string {
  if (!charges) return '';
  try { return JSON.parse(charges).join('; '); } catch { return charges; }
}

/** Check if a date string is in the current month */
function isThisMonth(dt: string | null): boolean {
  if (!dt) return false;
  try {
    const d = new Date(dt.replace(' ', 'T'));
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  } catch { return false; }
}

/** Compute duration between two date strings */
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

// ============================================================
// Sub-components
// ============================================================

function CoverageSourceCard({ source }: { source: ScraperSource }) {
  const isRecent = source.last_scraped_at &&
    (Date.now() - new Date(source.last_scraped_at.replace(' ', 'T')).getTime()) < 3 * 60 * 60 * 1000;
  return (
    <div className={`p-2 rounded-sm border ${
      !source.enabled
        ? 'border-rmpg-700/50 bg-rmpg-800/30'
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

export default function WarrantsPage() {
  const isMobile = useIsMobile();
  const warrantFormTitleId = useId();
  const serveTitleId = useId();

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<TabId>('local');

  // ── Local warrants data ──
  const warrantDetailRef = useRef<HTMLDivElement>(null);
  const [warrants, setWarrants] = useState<Warrant[]>([]);
  const [selectedWarrant, setSelectedWarrant] = useState<Warrant | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  // Source tab: local vs utah
  const [warrantSource, setWarrantSource] = useState<'local' | 'utah'>('local');

  // Pagination (local)
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Utah state warrants
  const [utahWarrants, setUtahWarrants] = useState<UtahWarrant[]>([]);
  const [utahLoading, setUtahLoading] = useState(false);
  const [utahSearchQuery, setUtahSearchQuery] = useState('');
  const [utahPage, setUtahPage] = useState(1);
  const [utahTotalPages, setUtahTotalPages] = useState(1);
  const [utahTotalCount, setUtahTotalCount] = useState(0);
  const [selectedUtahWarrant, setSelectedUtahWarrant] = useState<UtahWarrant | null>(null);
  const [utahSyncStatus, setUtahSyncStatus] = useState<UtahSyncStatus | null>(null);
  const [utahCountBadge, setUtahCountBadge] = useState<number>(0);

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

  // ── Warrant Watch state ──
  const [watchActiveHits, setWatchActiveHits] = useState<ActiveWarrantHit[]>([]);
  const [watchLog, setWatchLog] = useState<WatchLogEntry[]>([]);
  const [watchRuns, setWatchRuns] = useState<WatchRun[]>([]);
  const [watchLoading, setWatchLoading] = useState(false);
  const [scanRunning, setScanRunning] = useState(false);

  // ── Utah Search state ──
  const [utahResults, setUtahResults] = useState<UtahWarrantResult[]>([]);
  const [utahSearching, setUtahSearching] = useState(false);
  const [utahSearched, setUtahSearched] = useState(false);
  const [utahResultSource, setUtahResultSource] = useState<'live' | 'cache' | ''>('');

  // ── All States search state ──
  const [allStatesQuery, setAllStatesQuery] = useState('');
  const [allStatesFilter, setAllStatesFilter] = useState(''); // state abbreviation filter
  const [allStatesStatusFilter, setAllStatesStatusFilter] = useState('active');
  const [allStatesResults, setAllStatesResults] = useState<ScrapedWarrant[]>([]);
  const [allStatesTotal, setAllStatesTotal] = useState(0);
  const [allStatesPage, setAllStatesPage] = useState(1);
  const [allStatesTotalPages, setAllStatesTotalPages] = useState(1);
  const [allStatesLoading, setAllStatesLoading] = useState(false);
  const [allStatesSearched, setAllStatesSearched] = useState(false);
  const [allStatesExpanded, setAllStatesExpanded] = useState<Set<number>>(new Set());

  // ── Coverage state ──
  const [coverageSources, setCoverageSources] = useState<ScraperSource[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(false);

  // ============================================================
  // Fetch — Local Warrants
  // ============================================================

  const fetchWarrants = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(null); }
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterType) params.set('type', filterType);
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
  }, [filterStatus, filterType, searchQuery, showArchived, page]);

  useEffect(() => { fetchWarrants(); }, [fetchWarrants]);

  // Live sync — auto-refresh when any device modifies warrants
  const silentRefreshWarrants = useCallback(() => fetchWarrants({ silent: true }), [fetchWarrants]);
  useLiveSync('alerts', silentRefreshWarrants);

  // ── Utah warrants fetch ──
  const fetchUtahWarrants = useCallback(async () => {
    setUtahLoading(true);
    try {
      const params = new URLSearchParams();
      if (utahSearchQuery) params.set('search', utahSearchQuery);
      params.set('page', String(utahPage));
      params.set('per_page', '50');

      const res = await apiFetch<{
        data: UtahWarrant[];
        pagination: { total: number; totalPages: number };
      }>(`/warrants/utah?${params.toString()}`);
      setUtahWarrants(res.data || []);
      setUtahTotalPages(res.pagination?.totalPages || 1);
      setUtahTotalCount(res.pagination?.total || 0);
    } catch {
      setUtahWarrants([]);
    } finally {
      setUtahLoading(false);
    }
  }, [utahSearchQuery, utahPage]);

  // Fetch Utah warrants only when user triggers search (not on tab switch)
  // Auto-fetch removed — real-time search requires explicit name input

  // Fetch Utah badge count + sync status on mount
  useEffect(() => {
    const fetchUtahMeta = async () => {
      try {
        const [countRes, syncRes] = await Promise.all([
          apiFetch<{ count: number }>('/warrants/utah/count'),
          apiFetch<UtahSyncStatus>('/warrants/utah/sync-status'),
        ]);
        setUtahCountBadge(countRes.count);
        setUtahSyncStatus(syncRes);
      } catch { /* Utah warrants not available */ }
    };
    fetchUtahMeta();
  }, []);

  // Fetch warrant detail (local)
  const fetchWarrantDetail = useCallback(async (id: number) => {
    try {
      const detail = await apiFetch<Warrant>(`/warrants/${id}`);
      setSelectedWarrant(detail);
    } catch { /* keep existing */ }
  }, []);

  // Person search
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
  // Fetch — Warrant Watch
  // ============================================================

  const fetchWatchData = useCallback(async () => {
    setWatchLoading(true);
    try {
      const [activeRes, logRes, runsRes] = await Promise.all([
        apiFetch<{ data: ActiveWarrantHit[] }>('/warrants/watch/active'),
        apiFetch<{ data: WatchLogEntry[] }>('/warrants/watch/log?limit=100'),
        apiFetch<{ data: WatchRun[] }>('/warrants/watch/runs?limit=20'),
      ]);
      setWatchActiveHits(activeRes.data || []);
      setWatchLog(logRes.data || []);
      setWatchRuns(runsRes.data || []);
      const running = (runsRes.data || []).some(r => r.status === 'running');
      setScanRunning(running);
    } catch { /* silent fail */ }
    finally { setWatchLoading(false); }
  }, []);

  // Fetch active hits count on mount for badge + stats
  useEffect(() => {
    apiFetch<{ data: ActiveWarrantHit[] }>('/warrants/watch/active')
      .then(res => setWatchActiveHits(res.data || []))
      .catch(() => {});
  }, []);

  // Fetch full watch data when switching to watch or history tab
  useEffect(() => {
    if (activeTab === 'watch' || activeTab === 'history') fetchWatchData();
  }, [activeTab, fetchWatchData]);

  // Fetch coverage data when switching to coverage tab
  useEffect(() => {
    if (activeTab !== 'coverage') return;
    setCoverageLoading(true);
    apiFetch<{ data: ScraperSource[] }>('/warrants/scraped/status')
      .then(res => setCoverageSources(res.data || []))
      .catch(() => {})
      .finally(() => setCoverageLoading(false));
  }, [activeTab]);

  // ── All States search ──
  const searchAllStates = useCallback(async (pageNum?: number) => {
    const pg = pageNum || 1;
    setAllStatesLoading(true);
    try {
      const params = new URLSearchParams();
      if (allStatesQuery.trim()) params.set('q', allStatesQuery.trim());
      if (allStatesFilter) params.set('state', allStatesFilter);
      if (allStatesStatusFilter) params.set('status', allStatesStatusFilter);
      params.set('page', String(pg));
      params.set('limit', '50');

      // If no search query, use the /active endpoint for browsing
      if (!allStatesQuery.trim()) {
        const res = await apiFetch<{ data: ScrapedWarrant[]; total: number }>(`/warrants/scraped/active?${params.toString()}`);
        setAllStatesResults(res.data || []);
        setAllStatesTotal(res.total || res.data?.length || 0);
        setAllStatesTotalPages(1); // active endpoint doesn't paginate the same way
      } else {
        const res = await apiFetch<{ data: ScrapedWarrant[]; total: number; pagination: { page: number; totalPages: number } }>(
          `/warrants/scraped/search?${params.toString()}`
        );
        setAllStatesResults(res.data || []);
        setAllStatesTotal(res.total || 0);
        setAllStatesTotalPages(res.pagination?.totalPages || 1);
      }
      setAllStatesPage(pg);
      setAllStatesSearched(true);
    } catch {
      setAllStatesResults([]);
      setAllStatesTotal(0);
    } finally {
      setAllStatesLoading(false);
    }
  }, [allStatesQuery, allStatesFilter, allStatesStatusFilter]);

  // Auto-load active warrants when switching to All States tab
  useEffect(() => {
    if (activeTab !== 'all_states') return;
    if (!allStatesSearched) searchAllStates();
  }, [activeTab, allStatesSearched, searchAllStates]);

  const handleTriggerScan = useCallback(async () => {
    setScanRunning(true);
    try {
      await apiFetch('/warrants/watch/scan', { method: 'POST' });
      // Poll for completion
      const pollInterval = setInterval(async () => {
        try {
          const res = await apiFetch<{ data: WatchRun[] }>('/warrants/watch/runs?limit=1');
          const latest = res.data?.[0];
          if (latest && latest.status !== 'running') {
            clearInterval(pollInterval);
            setScanRunning(false);
            fetchWatchData();
          }
        } catch { /* keep polling */ }
      }, 5000);
      // Auto-stop polling after 30 minutes
      setTimeout(() => clearInterval(pollInterval), 30 * 60 * 1000);
    } catch {
      setScanRunning(false);
    }
  }, [fetchWatchData]);

  // ============================================================
  // Utah Search
  // ============================================================

  const handleUtahSearch = useCallback(async () => {
    if (!utahSearchQuery.trim() || utahSearchQuery.trim().length < 2) return;
    setUtahSearching(true);
    setUtahSearched(false);
    try {
      const res = await apiFetch<{ data: UtahWarrantResult[]; source: string }>(
        `/warrants/utah?search=${encodeURIComponent(utahSearchQuery.trim())}`
      );
      setUtahResults(res.data || []);
      setUtahResultSource((res.source || '') as 'live' | 'cache');
      setUtahSearched(true);
    } catch {
      setUtahResults([]);
      setUtahSearched(true);
    }
    finally { setUtahSearching(false); }
  }, [utahSearchQuery]);

  // ============================================================
  // Handlers — Local Warrants
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

  /** Pre-fill form from a Warrant Watch hit */
  const handleCreateFromHit = (hit: ActiveWarrantHit) => {
    setEditingWarrant(null);
    clearAllErrors();
    setFormData({
      type: 'arrest',
      subject_person_id: String(hit.person_id),
      issuing_court: hit.court_name || '',
      issuing_judge: '',
      charge_description: chargesFromJson(hit.charges),
      bail_amount: '',
      offense_level: '',
      expires_at: '',
      notes: `Utah State Warrant ${hit.utah_warrant_id} — Case ${hit.case_id || 'N/A'}`,
      statute_id: null,
      statute_citation: '',
    });
    setSelectedPersonName(hit.person_name);
    setPersonSearch('');
    setFormOpen(true);
  };

  /** Pre-fill form from a Utah search result (no local person_id) */
  const handleCreateFromUtahResult = (r: UtahWarrantResult) => {
    setEditingWarrant(null);
    clearAllErrors();
    setFormData({
      type: 'arrest',
      subject_person_id: '',
      issuing_court: r.court_name || '',
      issuing_judge: '',
      charge_description: chargesFromJson(r.charges),
      bail_amount: '',
      offense_level: '',
      expires_at: '',
      notes: `Utah State Warrant ${r.utah_warrant_id} — ${r.first_name} ${r.last_name}${r.city ? `, ${r.city}` : ''} — Case ${r.case_id || 'N/A'}`,
      statute_id: null,
      statute_citation: '',
    });
    setSelectedPersonName('');
    setPersonSearch('');
    setFormOpen(true);
  };

  /** Pre-fill form from a scraped (multi-state) warrant result */
  const handleCreateFromScrapedWarrant = (w: ScrapedWarrant) => {
    setEditingWarrant(null);
    clearAllErrors();
    setFormData({
      type: w.warrant_type?.toLowerCase() || 'arrest',
      subject_person_id: '',
      issuing_court: w.court_name || '',
      issuing_judge: '',
      charge_description: w.charge_description || '',
      bail_amount: w.bail_amount || '',
      offense_level: w.offense_level?.toLowerCase() || '',
      expires_at: '',
      notes: `${STATE_NAMES[w.state] || w.state} Warrant — ${w.full_name}${w.city ? `, ${w.city}` : ''} — Case ${w.case_number || 'N/A'} — Source: ${w.source_display_name || w.source_key}`,
      statute_id: null,
      statute_citation: '',
    });
    setSelectedPersonName('');
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
        subject_person_id: formData.subject_person_id ? parseInt(formData.subject_person_id) : null,
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
  // Computed
  // ============================================================

  const activeCount = warrants.filter((w) => w.status === 'active').length;
  const servedMtd = warrants.filter((w) => w.status === 'served' && isThisMonth(w.served_at)).length;

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-surface-deep">
      {/* ══════════════════════════════════════════════════════════
          TITLE BAR
         ══════════════════════════════════════════════════════════ */}
      <PanelTitleBar title="WARRANTS" icon={AlertTriangle}>
        <RmpgLogo height={16} iconOnly />
        <span className="toolbar-separator" />
        {activeTab === 'local' && !showArchived && (
          <button onClick={openNewForm} className="toolbar-btn toolbar-btn-primary text-[9px]">
            <Plus className="w-3 h-3" /> New Warrant
          </button>
        )}
        {activeTab === 'local' && (
          <button
            onClick={() => { setShowArchived(!showArchived); setPage(1); }}
            className={`toolbar-btn text-[9px] ${showArchived ? 'text-amber-400' : ''}`}
            title={showArchived ? 'Show active warrants' : 'Show archived warrants'}
          >
            <Archive className="w-3 h-3" />
            {showArchived ? 'Showing Archived' : 'Archives'}
          </button>
        )}
        {(activeTab === 'watch' || activeTab === 'history') && (
          <>
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
            <button onClick={fetchWatchData} className="toolbar-btn text-[9px]" title="Refresh watch data">
              <RotateCcw className="w-3 h-3" />
            </button>
          </>
        )}
        <span className="toolbar-separator" />
        <ExportButton exportUrl="/warrants/export" exportFilename="warrants_export.csv" />
        <PrintButton />
      </PanelTitleBar>

      {/* ══════════════════════════════════════════════════════════
          TAB BAR
         ══════════════════════════════════════════════════════════ */}
      <div className={`tab-bar ${isMobile ? 'overflow-x-auto' : ''}`}>
        {TABS.map((tab) => {
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
              {/* Watch hits badge */}
              {tab.id === 'watch' && watchActiveHits.length > 0 && (
                <span className="ml-1 px-1 rounded bg-red-600 text-white text-[8px] font-bold leading-tight">
                  {watchActiveHits.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════════════════
          STATS BAR
         ══════════════════════════════════════════════════════════ */}
      <div className="panel-inset bg-[var(--surface-sunken)] flex items-center gap-0 border-b border-[#1e3048] text-[10px] font-mono flex-wrap">
        {/* Active */}
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-[#1e3048]">
          <span className={`led-dot ${activeCount > 0 ? 'led-red' : 'led-off'}`} />
          <span className="text-rmpg-400">ACTIVE</span>
          <span className={`font-bold tabular-nums ${activeCount > 0 ? 'text-red-400' : 'text-rmpg-300'}`}>{activeCount}</span>
        </div>
        {/* Watch Hits */}
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-[#1e3048]">
          <span className={`led-dot ${watchActiveHits.length > 0 ? 'led-amber animate-led-blink' : 'led-off'}`} />
          <span className="text-rmpg-400">WATCH HITS</span>
          <span className={`font-bold tabular-nums ${watchActiveHits.length > 0 ? 'text-amber-400' : 'text-rmpg-300'}`}>{watchActiveHits.length}</span>
        </div>
        {/* Served MTD */}
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-[#1e3048]">
          <span className={`led-dot ${servedMtd > 0 ? 'led-green' : 'led-off'}`} />
          <span className="text-rmpg-400">SERVED MTD</span>
          <span className="font-bold tabular-nums text-rmpg-300">{servedMtd}</span>
        </div>
        {/* Total */}
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-[#1e3048]">
          <span className="text-rmpg-400">TOTAL</span>
          <span className="font-bold tabular-nums text-rmpg-300">{totalCount}</span>
        </div>
        {/* Scan Status */}
        <div className="flex items-center gap-1.5 px-3 py-1">
          <span className={`led-dot ${scanRunning ? 'led-green animate-led-pulse' : 'led-off'}`} />
          <span className="text-rmpg-400">SCAN</span>
          <span className={`font-bold ${scanRunning ? 'text-green-400' : 'text-rmpg-500'}`}>
            {scanRunning ? 'RUNNING' : 'IDLE'}
          </span>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          TAB CONTENT
         ══════════════════════════════════════════════════════════ */}

      {/* ─── LOCAL WARRANTS TAB ─── */}
      {activeTab === 'local' && (
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
                  placeholder="Search by subject name..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                  style={isMobile ? { minHeight: 44 } : undefined}
                />
              </div>
              <div className={`flex ${isMobile ? 'gap-1.5' : 'gap-2'}`}>
                <select
                  className={`input-dark ${isMobile ? 'flex-1 text-sm py-2' : 'text-xs w-28'}`}
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
                /* Mobile: card-style list for better touch targets */
                <div>
                  {warrants.filter((w) => {
                    if (!searchQuery.trim()) return true;
                    const q = searchQuery.toLowerCase();
                    return (
                      (w.warrant_number || '').toLowerCase().includes(q) ||
                      (w.charge_description || '').toLowerCase().includes(q) ||
                      (w.subject_first_name || '').toLowerCase().includes(q) ||
                      (w.subject_last_name || '').toLowerCase().includes(q) ||
                      (w.subject_name || '').toLowerCase().includes(q)
                    );
                  }).map((w) => (
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
                      <div className="text-[10px] text-rmpg-500 mt-0.5">{formatDate(w.created_at)}{w.offense_level ? ` \u2022 ${w.offense_level}` : ''}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <table className="table-dark">
                  <thead>
                    <tr>
                      <th style={{ width: 120 }}>Number</th>
                      <th style={{ width: 80 }}>Type</th>
                      <th>Subject</th>
                      <th>Charge</th>
                      <th style={{ width: 90 }}>Status</th>
                      <th style={{ width: 90 }}>Offense</th>
                      <th style={{ width: 110 }}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warrants.filter((w) => {
                      if (!searchQuery.trim()) return true;
                      const q = searchQuery.toLowerCase();
                      return (
                        (w.warrant_number || '').toLowerCase().includes(q) ||
                        (w.charge_description || '').toLowerCase().includes(q) ||
                        (w.subject_first_name || '').toLowerCase().includes(q) ||
                        (w.subject_last_name || '').toLowerCase().includes(q) ||
                        (w.subject_name || '').toLowerCase().includes(q)
                      );
                    }).map((w) => (
                      <tr
                        key={w.id}
                        onClick={() => fetchWarrantDetail(w.id)}
                        className={`cursor-pointer ${selectedWarrant?.id === w.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : ''}`}
                      >
                        <td className="font-mono text-xs text-white font-bold">{w.warrant_number || '-'}</td>
                        <td>
                          <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded border ${TYPE_COLORS[w.type] || TYPE_COLORS.other}`}>
                            {w.type.toUpperCase()}
                          </span>
                        </td>
                        <td className="text-rmpg-200 text-xs">{w.subject_name || <span className="text-rmpg-500">Unknown</span>}</td>
                        <td className="text-xs text-rmpg-300 truncate max-w-[200px]">{w.charge_description}</td>
                        <td>
                          <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded border ${STATUS_COLORS[w.status] || ''}`}>
                            {w.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="text-xs text-rmpg-400">{w.offense_level ? w.offense_level.charAt(0).toUpperCase() + w.offense_level.slice(1) : '-'}</td>
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
                  <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="toolbar-btn text-[9px]" style={isMobile ? { minHeight: 48, minWidth: 48 } : undefined}>Prev</button>
                  <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="toolbar-btn text-[9px]" style={isMobile ? { minHeight: 48, minWidth: 48 } : undefined}>Next</button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Warrant Detail */}
          <div ref={warrantDetailRef} className={`${isMobile ? (selectedWarrant ? 'flex-1' : 'hidden') : 'flex-1'} flex flex-col overflow-hidden`}>
            <div className={`flex ${isMobile ? 'flex-wrap gap-1' : 'items-center gap-1'} px-3 py-1 border-b border-[#1e3048] bg-[var(--grid-header-bg)]`}>
              <Gavel className="w-3 h-3 text-brand-400" />
              <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Warrant Detail</span>
              <span className="flex-1" />
              {isMobile && selectedWarrant && (
                <button onClick={() => setSelectedWarrant(null)} className="toolbar-btn text-[9px]" style={isMobile ? { minHeight: 44 } : undefined}>← Back</button>
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
                          <span className="inline-flex px-2 py-0.5 text-[10px] font-bold rounded border bg-rmpg-700/40 text-rmpg-200 border-rmpg-600/50">
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

      {/* ─── WARRANT WATCH TAB ─── */}
      {activeTab === 'watch' && (
        <div className="flex-1 overflow-auto">
          {watchLoading ? (
            <div className="flex items-center justify-center h-64 text-rmpg-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading watch data...
            </div>
          ) : (
            <div className="p-4 space-y-6">
              {/* ── Active Hits Section ── */}
              <div>
                <h2 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                  <span className={`led-dot ${watchActiveHits.length > 0 ? 'led-red animate-led-blink' : 'led-off'}`} />
                  Active Warrant Hits
                  {watchActiveHits.length > 0 && (
                    <span className="ml-1 px-1.5 rounded bg-red-600 text-white text-[9px] font-bold">{watchActiveHits.length}</span>
                  )}
                </h2>

                {watchActiveHits.length === 0 ? (
                  <div className="panel-inset bg-surface-sunken p-6 text-center">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500/40" />
                    <p className="text-sm text-rmpg-400">No Active Warrant Hits</p>
                    <p className="text-[10px] text-rmpg-500 mt-1">No known persons currently have active Utah state warrants</p>
                  </div>
                ) : (
                  <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2 xl:grid-cols-3'} gap-3`}>
                    {watchActiveHits.map((hit) => {
                      let chargeList: string[] = [];
                      try { chargeList = JSON.parse(hit.charges || '[]'); } catch { /* ignore */ }
                      return (
                        <div key={`${hit.person_id}-${hit.utah_warrant_id}`} className="panel-inset bg-surface-sunken p-3 rounded-sm border border-red-900/30">
                          <div className="flex items-start gap-3">
                            {hit.photo_url ? (
                              <img src={hit.photo_url} alt="" className="w-12 h-12 rounded-sm object-cover border border-rmpg-600" />
                            ) : (
                              <div className="w-12 h-12 rounded-sm bg-rmpg-800 border border-rmpg-600 flex items-center justify-center">
                                <User className="w-6 h-6 text-rmpg-500" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white">{hit.person_name}</span>
                                <span className="inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded border bg-red-900/50 text-red-400 border-red-700/50">
                                  WARRANT
                                </span>
                                {hit.caution_flags && (
                                  <span className="inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded border bg-amber-900/50 text-amber-400 border-amber-700/50">
                                    <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> CAUTION
                                  </span>
                                )}
                              </div>
                              {hit.dob && <div className="text-[10px] text-rmpg-400 mt-0.5">DOB: {formatDate(hit.dob)}</div>}
                              {(hit.address || hit.city) && (
                                <div className="text-[10px] text-rmpg-400 flex items-center gap-1">
                                  <MapPin className="w-2.5 h-2.5" />
                                  {[hit.address, hit.city, hit.state].filter(Boolean).join(', ')}
                                </div>
                              )}
                              <div className="mt-1.5 text-[10px] text-rmpg-300">
                                <span className="text-rmpg-500">Court:</span> {hit.court_name || 'Unknown'}
                                {hit.case_id && <><span className="ml-2 text-rmpg-500">Case:</span> {hit.case_id}</>}
                              </div>
                              {chargeList.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {chargeList.map((c, i) => (
                                    <span key={i} className="inline-flex px-1.5 py-0.5 text-[9px] rounded bg-amber-900/30 text-amber-300 border border-amber-700/30">
                                      {c}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="mt-1.5 flex items-center justify-between">
                                <span className="text-[9px] text-rmpg-500">
                                  Issued: {hit.issue_date ? formatDate(hit.issue_date) : 'Unknown'} · Detected: {formatDateTime(hit.first_detected)}
                                </span>
                                <button
                                  onClick={() => handleCreateFromHit(hit)}
                                  className="toolbar-btn text-[9px] text-brand-400 hover:text-brand-300"
                                  title="Create local warrant from this hit"
                                >
                                  <Plus className="w-3 h-3" /> Create Local
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Event Log Section ── */}
              <div>
                <h2 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                  <History className="w-3.5 h-3.5 text-brand-400" />
                  Event Log
                  <span className="text-rmpg-500 font-normal">({watchLog.length} events)</span>
                </h2>

                {watchLog.length === 0 ? (
                  <div className="panel-inset bg-surface-sunken p-6 text-center">
                    <History className="w-8 h-8 mx-auto mb-2 text-rmpg-500/40" />
                    <p className="text-sm text-rmpg-400">No Watch Events Yet</p>
                    <p className="text-[10px] text-rmpg-500 mt-1">Events will appear here after the first automated scan runs</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {watchLog.map((entry) => (
                      <div key={entry.id} className={`flex items-center gap-2 px-3 py-2 rounded-sm border ${
                        entry.event === 'warrant_found'
                          ? 'bg-red-900/10 border-red-900/30'
                          : 'bg-green-900/10 border-green-900/30'
                      }`}>
                        {entry.event === 'warrant_found'
                          ? <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                          : <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                        }
                        <span className="text-xs font-medium text-white">{entry.person_name}</span>
                        <span className={`text-[10px] font-bold ${entry.event === 'warrant_found' ? 'text-red-400' : 'text-green-400'}`}>
                          {entry.event === 'warrant_found' ? 'WARRANT FOUND' : 'WARRANT CLEARED'}
                        </span>
                        {entry.court_name && <span className="text-[10px] text-rmpg-400">— {entry.court_name}</span>}
                        {entry.charges && (
                          <span className="text-[10px] text-rmpg-500 truncate max-w-[200px]">· {chargesFromJson(entry.charges)}</span>
                        )}
                        <span className="ml-auto text-[9px] text-rmpg-500 shrink-0 font-mono">{formatDateTime(entry.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── UTAH SEARCH TAB ─── */}
      {activeTab === 'utah' && (
        <div className="flex-1 overflow-auto">
          <div className="p-4 space-y-4">
            {/* Search bar */}
            <div className="panel-inset bg-surface-sunken p-4 rounded-sm">
              <h2 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                <Globe className="w-3.5 h-3.5 text-brand-400" />
                Search warrants.utah.gov
              </h2>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" />
                  <input
                    type="text"
                    className="input-dark text-xs w-full pl-7"
                    placeholder="Enter first and last name (e.g. JOHN SMITH)..."
                    value={utahSearchQuery}
                    onChange={(e) => setUtahSearchQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleUtahSearch(); }}
                  />
                </div>
                <button
                  onClick={handleUtahSearch}
                  disabled={utahSearching || utahSearchQuery.trim().length < 2}
                  className="toolbar-btn toolbar-btn-primary text-[9px]"
                >
                  {utahSearching
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Searching...</>
                    : <><Search className="w-3 h-3" /> Search Utah</>
                  }
                </button>
              </div>
              <p className="text-[9px] text-rmpg-500 mt-2">
                Enter both first and last name for a live search. Single names will search the local cache only.
              </p>
            </div>

            {/* Results */}
            {utahSearched && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
                    Results ({utahResults.length})
                  </h2>
                  {utahResultSource && (
                    <span className={`inline-flex px-1.5 py-0.5 text-[8px] font-bold rounded border ${
                      utahResultSource === 'live'
                        ? 'bg-green-900/50 text-green-400 border-green-700/50'
                        : 'bg-amber-900/50 text-amber-400 border-amber-700/50'
                    }`}>
                      {utahResultSource === 'live' ? '● LIVE' : '● CACHE'}
                    </span>
                  )}
                </div>

                {utahResults.length === 0 ? (
                  <div className="panel-inset bg-surface-sunken p-6 text-center">
                    <Shield className="w-8 h-8 mx-auto mb-2 text-green-500/40" />
                    <p className="text-sm text-rmpg-400">No Warrants Found</p>
                    <p className="text-[10px] text-rmpg-500 mt-1">No active warrants found on warrants.utah.gov for this name</p>
                  </div>
                ) : (
                  <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2 xl:grid-cols-3'} gap-3`}>
                    {utahResults.map((r) => {
                      let chargeList: string[] = [];
                      try { chargeList = JSON.parse(r.charges || '[]'); } catch { /* ignore */ }
                      return (
                        <div key={`${r.utah_person_id}-${r.utah_warrant_id}`} className="panel-inset bg-surface-sunken p-3 rounded-sm border border-[#1e3048]">
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-sm bg-rmpg-800 border border-rmpg-600 flex items-center justify-center">
                              <User className="w-5 h-5 text-rmpg-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white">
                                  {r.first_name} {r.middle_name ? `${r.middle_name} ` : ''}{r.last_name}
                                </span>
                                <span className="inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded border bg-red-900/50 text-red-400 border-red-700/50">
                                  WARRANT
                                </span>
                              </div>
                              <div className="flex items-center gap-3 mt-0.5 text-[10px] text-rmpg-400">
                                {r.age && <span>Age: {r.age}</span>}
                                {r.city && <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" /> {r.city}</span>}
                              </div>
                              <div className="mt-1.5 text-[10px] text-rmpg-300">
                                <span className="text-rmpg-500">Court:</span> {r.court_name || 'Unknown'}
                                {r.case_id && <><span className="ml-2 text-rmpg-500">Case:</span> {r.case_id}</>}
                              </div>
                              {chargeList.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {chargeList.map((c, i) => (
                                    <span key={i} className="inline-flex px-1.5 py-0.5 text-[9px] rounded bg-amber-900/30 text-amber-300 border border-amber-700/30">
                                      {c}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="mt-1.5 flex items-center justify-between">
                                <span className="text-[9px] text-rmpg-500">
                                  Issued: {r.issue_date ? formatDate(r.issue_date) : 'Unknown'}
                                  {r.fetched_at && ` · Cached: ${formatDateTime(r.fetched_at)}`}
                                </span>
                                <button
                                  onClick={() => handleCreateFromUtahResult(r)}
                                  className="toolbar-btn text-[9px] text-brand-400 hover:text-brand-300"
                                  title="Create local warrant from this result"
                                >
                                  <Plus className="w-3 h-3" /> Create Local
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Pre-search state */}
            {!utahSearched && !utahSearching && (
              <div className="panel-inset bg-surface-sunken p-8 text-center">
                <Globe className="w-10 h-10 mx-auto mb-3 text-brand-400/30" />
                <p className="text-sm text-rmpg-400">Search Utah State Warrants</p>
                <p className="text-[10px] text-rmpg-500 mt-1 max-w-md mx-auto">
                  Query warrants.utah.gov in real time. Enter a first and last name above to search for active warrants across all Utah courts.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── ALL STATES TAB ─── */}
      {activeTab === 'all_states' && (
        <div className="flex-1 overflow-auto">
          <div className="p-4 space-y-4">
            {/* Search + Filters */}
            <div className="panel-inset bg-surface-sunken p-4 rounded-sm">
              <h2 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-3">
                <FileText className="w-3.5 h-3.5 text-brand-400" />
                Search All State Warrants
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {/* Name search */}
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" />
                  <input
                    type="text"
                    className="input-dark text-xs w-full pl-7"
                    placeholder="Search by name..."
                    value={allStatesQuery}
                    onChange={(e) => setAllStatesQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setAllStatesPage(1); searchAllStates(1); } }}
                  />
                </div>
                {/* State filter */}
                <select
                  className="input-dark text-xs min-w-[120px]"
                  value={allStatesFilter}
                  onChange={(e) => { setAllStatesFilter(e.target.value); setAllStatesSearched(false); }}
                >
                  <option value="">All States</option>
                  {Object.entries(STATE_NAMES)
                    .filter(([k]) => k !== 'ALL')
                    .sort(([, a], [, b]) => a.localeCompare(b))
                    .map(([abbr, name]) => (
                      <option key={abbr} value={abbr}>{name} ({abbr})</option>
                    ))}
                </select>
                {/* Status filter */}
                <select
                  className="input-dark text-xs min-w-[100px]"
                  value={allStatesStatusFilter}
                  onChange={(e) => { setAllStatesStatusFilter(e.target.value); setAllStatesSearched(false); }}
                >
                  <option value="">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="served">Served</option>
                  <option value="cleared">Cleared</option>
                  <option value="expired">Expired</option>
                </select>
                {/* Search button */}
                <button
                  onClick={() => { setAllStatesPage(1); searchAllStates(1); }}
                  disabled={allStatesLoading}
                  className="toolbar-btn toolbar-btn-primary text-[9px]"
                >
                  {allStatesLoading
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Searching...</>
                    : <><Search className="w-3 h-3" /> Search</>
                  }
                </button>
              </div>
              <p className="text-[9px] text-rmpg-500 mt-2">
                Browse scraped warrants from all configured state sources. Leave name blank to browse all active warrants.
              </p>
            </div>

            {/* Results count */}
            {allStatesSearched && (
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
                  {allStatesTotal.toLocaleString()} Warrant{allStatesTotal !== 1 ? 's' : ''} Found
                </h2>
                {allStatesTotalPages > 1 && (
                  <div className="flex items-center gap-2 text-[10px]">
                    <button
                      onClick={() => searchAllStates(allStatesPage - 1)}
                      disabled={allStatesPage <= 1 || allStatesLoading}
                      className="toolbar-btn text-[9px]"
                    >
                      ← Prev
                    </button>
                    <span className="text-rmpg-400">
                      Page {allStatesPage} of {allStatesTotalPages}
                    </span>
                    <button
                      onClick={() => searchAllStates(allStatesPage + 1)}
                      disabled={allStatesPage >= allStatesTotalPages || allStatesLoading}
                      className="toolbar-btn text-[9px]"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Loading */}
            {allStatesLoading && (
              <div className="flex items-center justify-center h-40 text-rmpg-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading warrants...
              </div>
            )}

            {/* Results grid */}
            {allStatesSearched && !allStatesLoading && allStatesResults.length === 0 && (
              <div className="panel-inset bg-surface-sunken p-8 text-center">
                <Shield className="w-10 h-10 mx-auto mb-3 text-green-500/30" />
                <p className="text-sm text-rmpg-400">No Warrants Found</p>
                <p className="text-[10px] text-rmpg-500 mt-1">
                  No warrants match your search criteria. Try adjusting filters or search terms.
                </p>
              </div>
            )}

            {allStatesSearched && !allStatesLoading && allStatesResults.length > 0 && (
              <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'} gap-3`}>
                {allStatesResults.map((w) => {
                  const isExpanded = allStatesExpanded.has(w.id);
                  return (
                    <div
                      key={w.id}
                      className="panel-inset bg-surface-sunken p-3 rounded-sm border border-[#1e3048] hover:border-brand-600/40 transition-colors cursor-pointer"
                      onClick={() => {
                        setAllStatesExpanded(prev => {
                          const next = new Set(prev);
                          if (next.has(w.id)) next.delete(w.id);
                          else next.add(w.id);
                          return next;
                        });
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-sm bg-rmpg-800 border border-rmpg-600 flex items-center justify-center flex-shrink-0">
                          <User className="w-5 h-5 text-rmpg-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-white truncate">
                              {w.full_name || `${w.first_name || ''} ${w.last_name || ''}`.trim() || 'Unknown'}
                            </span>
                            <span className={`inline-flex px-1.5 py-0.5 text-[8px] font-bold rounded border ${
                              w.status === 'active'
                                ? 'bg-red-900/50 text-red-400 border-red-700/50'
                                : w.status === 'served'
                                  ? 'bg-green-900/50 text-green-400 border-green-700/50'
                                  : 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50'
                            }`}>
                              {w.status?.toUpperCase() || 'ACTIVE'}
                            </span>
                            <span className="inline-flex px-1.5 py-0.5 text-[8px] font-bold rounded border bg-blue-900/40 text-blue-300 border-blue-700/40">
                              {STATE_NAMES[w.state] || w.state}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-rmpg-400 flex-wrap">
                            {w.age && <span>Age: {w.age}</span>}
                            {w.date_of_birth && <span>DOB: {w.date_of_birth}</span>}
                            {w.city && <span className="flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" /> {w.city}{w.state ? `, ${w.state}` : ''}</span>}
                            {w.gender && <span>{w.gender}</span>}
                            {w.race && <span>{w.race}</span>}
                          </div>
                          <div className="mt-1.5 text-[10px] text-rmpg-300">
                            {w.warrant_type && <><span className="text-rmpg-500">Type:</span> {w.warrant_type} · </>}
                            {w.court_name && <><span className="text-rmpg-500">Court:</span> {w.court_name}</>}
                            {w.case_number && <span className="ml-2"><span className="text-rmpg-500">Case:</span> {w.case_number}</span>}
                          </div>
                          {w.charge_description && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              <span className="inline-flex px-1.5 py-0.5 text-[9px] rounded bg-amber-900/30 text-amber-300 border border-amber-700/30">
                                {w.charge_description}
                              </span>
                            </div>
                          )}
                          {w.offense_level && (
                            <span className={`mt-1 inline-flex px-1.5 py-0.5 text-[8px] font-bold rounded border ${
                              w.offense_level.toLowerCase().includes('felon')
                                ? 'bg-red-900/40 text-red-300 border-red-700/40'
                                : w.offense_level.toLowerCase().includes('misdemeanor')
                                  ? 'bg-amber-900/40 text-amber-300 border-amber-700/40'
                                  : 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/40'
                            }`}>
                              {w.offense_level}
                            </span>
                          )}

                          {/* Expanded details */}
                          {isExpanded && (
                            <div className="mt-2 pt-2 border-t border-rmpg-700/50 space-y-1 text-[10px]">
                              {w.bail_amount && <div><span className="text-rmpg-500">Bail:</span> <span className="text-green-400 font-mono">{w.bail_amount}</span></div>}
                              {w.issue_date && <div><span className="text-rmpg-500">Issued:</span> {w.issue_date}</div>}
                              {w.source_display_name && <div><span className="text-rmpg-500">Source:</span> {w.source_display_name}</div>}
                              {w.detail_url && (
                                <a
                                  href={w.detail_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-brand-400 hover:text-brand-300 underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  View Original →
                                </a>
                              )}
                              {w.last_seen_at && <div className="text-rmpg-500">Last verified: {formatDateTime(w.last_seen_at)}</div>}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCreateFromScrapedWarrant(w);
                                }}
                                className="toolbar-btn text-[9px] text-brand-400 hover:text-brand-300 mt-1"
                                title="Create local warrant from this result"
                              >
                                <Plus className="w-3 h-3" /> Create Local Warrant
                              </button>
                            </div>
                          )}

                          <div className="mt-1 flex items-center justify-between">
                            <span className="text-[9px] text-rmpg-500">
                              {w.issue_date && `Issued: ${w.issue_date}`}
                              {w.last_seen_at && ` · Cached: ${formatDateTime(w.last_seen_at)}`}
                            </span>
                            <ChevronDown className={`w-3 h-3 text-rmpg-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bottom pagination */}
            {allStatesSearched && !allStatesLoading && allStatesTotalPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-2 text-[10px]">
                <button
                  onClick={() => searchAllStates(allStatesPage - 1)}
                  disabled={allStatesPage <= 1}
                  className="toolbar-btn text-[9px]"
                >
                  ← Previous
                </button>
                <span className="text-rmpg-400">
                  Page {allStatesPage} of {allStatesTotalPages}
                </span>
                <button
                  onClick={() => searchAllStates(allStatesPage + 1)}
                  disabled={allStatesPage >= allStatesTotalPages}
                  className="toolbar-btn text-[9px]"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── COVERAGE TAB ─── */}
      {activeTab === 'coverage' && (
        <div className="flex-1 overflow-auto">
          <div className="p-4 space-y-4">
            {coverageLoading ? (
              <div className="flex items-center justify-center h-64 text-rmpg-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading coverage data...
              </div>
            ) : (() => {
              // Group sources by state
              const byState = new Map<string, ScraperSource[]>();
              for (const src of coverageSources) {
                const list = byState.get(src.state) || [];
                list.push(src);
                byState.set(src.state, list);
              }

              // Compute aggregate stats
              const totalSources = coverageSources.length;
              const enabledSources = coverageSources.filter(s => s.enabled).length;
              const statesWithSources = new Set(coverageSources.map(s => s.state).filter(s => s !== 'ALL'));
              const totalActive = coverageSources.reduce((sum, s) => sum + s.active_warrants, 0);
              const totalScraped = coverageSources.reduce((sum, s) => sum + s.total_warrants, 0);
              const recentlyScraped = coverageSources.filter(s => {
                if (!s.last_scraped_at) return false;
                const ago = Date.now() - new Date(s.last_scraped_at.replace(' ', 'T')).getTime();
                return ago < 3 * 60 * 60 * 1000; // within 3 hours
              }).length;

              // Separate federal from states
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
                        const lastScraped = sources
                          .map(s => s.last_scraped_at)
                          .filter(Boolean)
                          .sort()
                          .pop();
                        const isRecent = lastScraped && (Date.now() - new Date(lastScraped.replace(' ', 'T')).getTime()) < 3 * 60 * 60 * 1000;
                        const isSurrounding = ['CO', 'WY', 'ID', 'NV', 'AZ', 'NM'].includes(state);

                        return (
                          <div
                            key={state}
                            className={`p-2 rounded-sm border text-center ${
                              enabled === 0
                                ? 'border-rmpg-700/50 bg-rmpg-800/30'
                                : hasErrors
                                  ? 'border-amber-700/50 bg-amber-900/10'
                                  : isRecent
                                    ? 'border-green-700/50 bg-green-900/10'
                                    : 'border-brand-600/30 bg-brand-900/10'
                            }`}
                          >
                            <div className="flex items-center justify-center gap-1">
                              <span className={`text-sm font-bold font-mono ${
                                isSurrounding ? 'text-amber-300' : 'text-white'
                              }`}>
                                {state}
                              </span>
                              {isSurrounding && (
                                <span className="text-[7px] bg-amber-900/50 text-amber-400 px-1 rounded border border-amber-700/30">
                                  ADJ
                                </span>
                              )}
                            </div>
                            <div className="text-[9px] text-rmpg-400 mt-0.5">
                              {STATE_NAMES[state] || state}
                            </div>
                            <div className="text-[10px] text-rmpg-300 mt-1">
                              {sources.length} source{sources.length !== 1 ? 's' : ''}
                            </div>
                            {active > 0 && (
                              <div className="text-[9px] text-red-400 font-bold mt-0.5">
                                {active} active
                              </div>
                            )}
                            <div className={`mt-1 inline-flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded ${
                              enabled === 0
                                ? 'bg-rmpg-700/50 text-rmpg-500'
                                : isRecent
                                  ? 'bg-green-900/50 text-green-400'
                                  : hasErrors
                                    ? 'bg-amber-900/50 text-amber-400'
                                    : 'bg-brand-900/50 text-brand-300'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                enabled === 0
                                  ? 'bg-rmpg-600'
                                  : isRecent
                                    ? 'bg-green-400'
                                    : hasErrors
                                      ? 'bg-amber-400'
                                      : 'bg-brand-400'
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
                        <thead>
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
                            <tr key={src.source_key} className="border-t border-rmpg-800/50">
                              <td className="px-2 py-1 font-mono text-rmpg-300">{src.source_key}</td>
                              <td className="px-2 py-1">{src.state}</td>
                              <td className="px-2 py-1 text-rmpg-400">{src.county || '-'}</td>
                              <td className="px-2 py-1 text-center">
                                {src.enabled ? (
                                  src.consecutive_failures > 0 ? (
                                    <span className="text-amber-400">⚠ {src.consecutive_failures} failures</span>
                                  ) : (
                                    <span className="text-green-400">● Enabled</span>
                                  )
                                ) : (
                                  <span className="text-rmpg-500">○ Disabled</span>
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
          </div>
        </div>
      )}

      {/* ─── SCAN HISTORY TAB ─── */}
      {activeTab === 'history' && (
        <div className="flex-1 overflow-auto">
          {watchLoading ? (
            <div className="flex items-center justify-center h-64 text-rmpg-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading scan history...
            </div>
          ) : watchRuns.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Clock}
                title="No Scans Yet"
                description="Automated scans run at noon and midnight Mountain Time. You can also trigger one manually with the 'Run Scan Now' button."
              />
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <h2 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-1">
                <History className="w-3.5 h-3.5 text-brand-400" />
                Warrant Watch Scan Runs
                <span className="text-rmpg-500 font-normal">({watchRuns.length} runs)</span>
              </h2>

              {watchRuns.map((run) => (
                <div key={run.id} className="panel-inset bg-surface-sunken p-4 rounded-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-xs text-rmpg-200 font-bold">{run.run_id}</span>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold rounded border ${
                      run.status === 'completed' ? 'bg-green-900/50 text-green-400 border-green-700/50'
                        : run.status === 'running' ? 'bg-blue-900/50 text-blue-400 border-blue-700/50'
                        : 'bg-red-900/50 text-red-400 border-red-700/50'
                    }`}>
                      {run.status === 'running' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                      <span className={`led-dot ${
                        run.status === 'completed' ? 'led-green' : run.status === 'running' ? 'led-blue animate-led-pulse' : 'led-red'
                      }`} />
                      {run.status.toUpperCase()}
                    </span>
                    <span className="ml-auto text-[10px] text-rmpg-500 font-mono">
                      {computeDuration(run.started_at, run.completed_at)}
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-4 text-center">
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
                    {run.completed_at && ` → Completed: ${formatDateTime(run.completed_at)}`}
                  </div>
                  {run.error_message && (
                    <div className="mt-1 text-[10px] text-red-400 bg-red-900/20 px-2 py-1 rounded-sm">{run.error_message}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          MODALS
         ══════════════════════════════════════════════════════════ */}

      {/* ── FORM MODAL ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby={warrantFormTitleId}>
          <div className={`panel-beveled ${isMobile ? 'w-full h-full' : 'w-[550px] max-h-[85vh]'} overflow-auto bg-surface-base`}>
            <div className="flex items-center justify-between p-4 border-b border-rmpg-600">
              <h2 id={warrantFormTitleId} className="text-sm font-bold text-white">{editingWarrant ? 'Edit Warrant' : 'New Warrant'}</h2>
              <button onClick={() => setFormOpen(false)} className="text-rmpg-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
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
                  <div className="flex items-center gap-2 p-2 bg-rmpg-800 border border-rmpg-600 rounded text-xs">
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
                      className="input-dark text-xs w-full"
                      placeholder="Search persons by name..."
                      value={personSearch}
                      onChange={(e) => { setPersonSearch(e.target.value); setShowPersonDropdown(true); }}
                      onFocus={() => setShowPersonDropdown(true)}
                    />
                    {showPersonDropdown && personResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 max-h-40 overflow-auto bg-rmpg-800 border border-rmpg-600 rounded shadow-lg">
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
                      <div className="absolute right-2 top-7"><Loader2 className="w-3 h-3 animate-spin text-rmpg-400" /></div>
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
                  placeholder="Search statute (e.g. 76-5-102 or assault)..."
                  showStateFilter
                />
              </div>

              {/* Charge Description */}
              <div>
                <label className="field-label">Charge Description *</label>
                <textarea
                  className="input-dark text-xs w-full"
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
                  <input type="text" className="input-dark text-xs w-full" value={formData.issuing_court} onChange={(e) => setFormData(prev => ({ ...prev, issuing_court: e.target.value }))} placeholder="e.g. 3rd District Court" />
                </div>
                <div>
                  <label className="field-label">Issuing Judge</label>
                  <input type="text" className="input-dark text-xs w-full" value={formData.issuing_judge} onChange={(e) => setFormData(prev => ({ ...prev, issuing_judge: e.target.value }))} placeholder="e.g. Hon. Smith" />
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
                  <input type="date" className="input-dark text-xs w-full" value={formData.expires_at} onChange={(e) => setFormData(prev => ({ ...prev, expires_at: e.target.value }))} />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="field-label">Notes</label>
                <textarea className="input-dark text-xs w-full" rows={2} value={formData.notes} onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Additional notes..." />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-600">
                <button type="button" onClick={() => setFormOpen(false)} className="toolbar-btn text-xs">Cancel</button>
                <button type="submit" disabled={submitting} className="toolbar-btn toolbar-btn-primary text-xs">
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                  {editingWarrant ? 'Update Warrant' : 'Create Warrant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── SERVE MODAL ── */}
      {serveModalOpen && selectedWarrant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby={serveTitleId}>
          <div className={`panel-beveled ${isMobile ? 'w-full mx-4' : 'w-[400px]'} bg-surface-base`}>
            <div className="flex items-center justify-between p-4 border-b border-rmpg-600">
              <h2 id={serveTitleId} className="text-sm font-bold text-white">Serve Warrant</h2>
              <button onClick={() => setServeModalOpen(false)} className="text-rmpg-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-xs text-rmpg-300">
                Mark warrant <span className="font-bold text-white font-mono">{selectedWarrant.warrant_number}</span> as served?
              </p>
              <div>
                <label className="field-label">Location Served (optional)</label>
                <input
                  type="text"
                  className="input-dark text-xs w-full"
                  value={serveLocation}
                  onChange={(e) => setServeLocation(e.target.value)}
                  placeholder="e.g. 123 Main St, Salt Lake City"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setServeModalOpen(false)} className="toolbar-btn text-xs">Cancel</button>
                <button onClick={handleServe} disabled={serving} className="toolbar-btn toolbar-btn-primary text-xs">
                  {serving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle className="w-3 h-3 mr-1" />}
                  Confirm Served
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MOBILE FAB ── */}
      {isMobile && activeTab === 'local' && !selectedWarrant && !showArchived && !formOpen && (
        <button onClick={openNewForm} className="mobile-fab" aria-label="New Warrant">
          <Plus className="w-6 h-6" />
        </button>
      )}

      {/* ── DELETE CONFIRM ── */}
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
