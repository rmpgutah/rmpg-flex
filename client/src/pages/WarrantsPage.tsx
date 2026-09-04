import React, { useState, useEffect, useCallback, useRef, useId } from 'react';
import { importWithRetry } from '../utils/importWithRetry';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import RichTextArea from '../components/RichTextArea';
import { useToast } from '../components/ToastProvider';
import WarrantNsopwStatus from '../components/WarrantNsopwStatus';
import LegalDataHunterValidateButton from '../components/LegalDataHunterValidateButton';
import {
  AlertTriangle, Plus, Search, CheckCircle, Clock,
  Loader2, RotateCcw, MapPin, User, Gavel, ChevronDown, X, Scale, Radar,
  PlayCircle, History, Globe, Shield, FileText, Activity, Zap, Printer, Download,
  UserCheck, ShieldAlert,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import SpillmanModuleGroup from '../components/spillman/SpillmanModuleGroup';
import type { ModuleGroupSpec } from '../components/spillman/SpillmanModuleGroup';
import { ScreeningWorkspace } from './ScreeningPage';
import IconButton from '../components/IconButton';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import ExportButton from '../components/ExportButton';
import PrintRecordButton from '../components/PrintRecordButton';
import ConfirmDialog from '../components/ConfirmDialog';
import WarrantBadge from '../components/WarrantBadge';
import JurisdictionLookup from '../components/JurisdictionLookup';
import { apiFetch } from '../hooks/useApi';
import { useIsMobile } from '../hooks/useIsMobile';
import StatuteLookup from '../components/StatuteLookup';
import type { StatuteResult } from '../components/StatuteLookup';
import { useFormValidation } from '../hooks/useFormValidation';
import { useFormDraft } from '../hooks/useFormDraft';
import EmptyState from '../components/EmptyState';
import ViewOnMapLink from '../components/ViewOnMapLink';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import FloatingSaveBar from '../components/FloatingSaveBar';
import { formatDate, formatDateTime, parseTimestamp } from '../utils/dateUtils';
import { useAuth } from '../context/AuthContext';
import {
  downloadRecordPdf, generateBoloPdf, generateWarrantSummaryPdf,
} from '../utils/recordPdfGenerator';
import type { WarrantPdfData, BoloSubject, WarrantSummaryData } from '../utils/recordPdfGenerator';
import CollapsibleSection from '../components/CollapsibleSection';
import LinkedEmailsSection from '../components/LinkedEmailsSection';
import EmailedDocuments from '../components/EmailedDocuments';
import { displayUserName } from '../utils/userDisplay';
import { useNavigate, useSearchParams } from 'react-router';
import ScrapersTab from './warrants/ScrapersTab';
import WarrantsListTab, { type WarrantsListTabHandle } from './warrants/WarrantsListTab';
// Canonical /warrants/scrapers row shape. See the note above ScraperSource's old
// local declaration site below — do not redeclare this locally.
import type { ScraperSource } from '../types/scrapers';

// ============================================================
// Types
// ============================================================

export interface Warrant {
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
  // Phase 1 list extensions
  priority_score?: number | null;
  age_days?: number | null;
  freshness_days?: number | null;
  matches_person?: number | boolean | null;
  source_scraper_name?: string | null;
  source_state?: string | null;
  source_url?: string | null;
  last_scraped_at?: string | null;
  rmpg_encounters?: any[];
  known_associates?: any[];
  known_vehicles?: any[];
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
  // Utah hits attributed to DOB-less persons (name-only matches) — possible
  // namesakes, kept OUT of activeWarrants and surfaced separately.
  unverifiedWarrants?: number;
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
  // Utah lead matched on name only (DOB-less person) — possible namesake.
  unverified?: boolean;
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
export interface UnifiedWarrant extends Warrant {
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
  // True when the local person has no DOB, so the poller could not age-confirm
  // the Utah match — these hits are possible namesakes, shown as leads.
  unverified?: boolean;
  local_warrant_count: number;
  utah_hit_count: number;
  warrants: { id: number; warrant_number: string; type: string; status: string; charge_description: string; offense_level: string | null; bail_amount: number | null; issuing_court: string | null; source: string | null; created_at: string }[];
  utahWarrants: { utah_warrant_id: string; charges: string; court_name: string; issue_date: string; city?: string | null; age?: number | null }[];
}

// Coverage / Sources
/**
 * Shape of one row from GET /warrants/scrapers.
 *
 * ⚠️ Imported, NOT redeclared. This file used to define its OWN local
 * `ScraperSource` interface, and that duplicate is the entire root cause of the
 * Sources tab's broken stats. It declared `id`, `source_name`, `last_run_at`,
 * `last_scraped_at`, `active_count`, `active_warrants`, `consecutive_failures`
 * and `total_count` — NONE of which the endpoint sends — while the CORRECT type
 * already existed in types/scrapers.ts and was already being used successfully by
 * AdminWarrantScrapersTab.
 *
 * Because `apiFetch<T>` is a cast and not a validation, tsc reported zero errors
 * while six things broke at runtime: two literal "NaN" stat tiles
 * (`sum + undefined`), "RECENTLY SCRAPED 0" despite live timestamps
 * (last_scraped_at vs last_scrape_at), never-rendered per-state counts
 * (active_warrants vs warrant_count), and never-rendered error styling
 * (consecutive_failures vs consecutive_errors).
 *
 * Do not re-add a local copy. There is one authority for this shape.
 *
 * Note the payload carries a SINGLE count (`warrant_count`) — there is no
 * active-vs-total pair, so the tiles that once read "Active Warrants" and
 * "Total Indexed" were describing a distinction that does not exist in the data.
 */
/**
 * Resolve a source's state code for grouping/display.
 *
 * `utah-warrant-watch` ships with `state: ''`, and the state grid was built with
 * `.filter(Boolean)` — which silently DROPPED RMPG's home jurisdiction from its
 * own coverage grid and collapsed 19 sources into 9 state groups (hence
 * national-coverage reporting states_covered: 10 against 9 rendered cards).
 * Returning an explicit bucket instead of a falsy value means a source can never
 * again vanish from a count without anyone noticing.
 */
function sourceStateCode(s: ScraperSource): string {
  const declared = (s.state || '').trim().toUpperCase();
  if (declared) return declared;
  if (/utah/i.test(s.source_key)) return 'UT';
  return 'UNK';
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

type TabId = 'dashboard' | 'warrants' | 'search-all' | 'screening' | 'watch' | 'sources' | 'scrapers';

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }>; roleGated?: boolean }[] = [
  { id: 'dashboard', label: 'DASHBOARD', icon: Activity },
  { id: 'warrants', label: 'WARRANTS', icon: Gavel },
  { id: 'search-all', label: 'SEARCH ALL', icon: Globe },
  { id: 'screening', label: 'SCREENING', icon: ShieldAlert },
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

function computeDuration(start: string, end: string | null): string {
  if (!end) return 'In progress...';
  try {
    const ms = parseTimestamp(end).getTime() - parseTimestamp(start).getTime();
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
    const ms = Date.now() - parseTimestamp(dt).getTime();
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
  const hasError = !!source.last_error;
  const isRecent = source.last_scrape_at &&
    (Date.now() - parseTimestamp(source.last_scrape_at).getTime()) < 3 * 60 * 60 * 1000;
  return (
    <div className={`p-2 rounded-sm border ${
      !source.enabled
        ? 'border-rmpg-700/50 bg-rmpg-700/30'
        : hasError
          ? 'border-amber-700/50 bg-amber-900/10'
          : isRecent
            ? 'border-green-700/50 bg-green-900/10'
            : 'border-brand-600/30 bg-brand-900/10'
    }`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-rmpg-100">{source.county || source.source_key}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${
          !source.enabled ? 'bg-rmpg-600' : isRecent ? 'bg-green-400' : hasError ? 'bg-amber-400' : 'bg-brand-400'
        }`} />
      </div>
      <div className="flex items-center justify-between mt-1 text-[9px] text-rmpg-400">
        {/* Was "{active_count} active / {total_count} total" — both fields are
            absent from the payload, so this rendered "undefined active /
            undefined total". One real count exists. */}
        <span>{(source.warrant_count || 0).toLocaleString()} indexed</span>
      </div>
      {source.last_scrape_at && (
        <div className="text-[8px] text-rmpg-500 mt-0.5">
          Last: {formatDateTime(source.last_scrape_at)}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Component
// ============================================================

export default function WarrantsPage() {
  const { addToast } = useToast();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const navigate = useNavigate();
  const warrantFormTitleId = useId();

  const [searchParams, setSearchParams] = useSearchParams();
  const initialPersonId = searchParams.get('personId');
  // ?warrant_id=<id> deep-link auto-select — resolved AFTER warrants hydrate;
  // we hold the pending id in a ref so a rerender doesn't re-attempt the lookup.
  const pendingWarrantIdRef = useRef<string | null>(searchParams.get('warrant_id'));
  const listTabRef = useRef<WarrantsListTabHandle>(null);

  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';
  // Reopen: mirrors requireRole('admin', 'supervisor', 'manager') on the server route.
  const isAdminSupervisorOrManager =
    user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'manager';
  const isGodMode = user?.role === 'admin'; // Admin God Mode — unrestricted access
  // Serve / archive / recall: mirrors ROLES_CRUD_WRITE on the server
  // (admin | manager | supervisor | dispatcher).
  const canManageWarrants =
    user?.role === 'admin' || user?.role === 'manager' ||
    user?.role === 'supervisor' || user?.role === 'dispatcher';

  // ── Tab state ──
  // If the URL deep-links to a specific warrant_id, force the warrants tab so the
  // selection lands somewhere visible.
  const [activeTab, setActiveTab] = useState<TabId>(
    initialPersonId || pendingWarrantIdRef.current ? 'warrants' : 'dashboard'
  );

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
  // User-scoped form-draft key (PII safety on shared workstations) — keeps
  // each officer's in-progress draft private even when two badges share a
  // browser session. Pre-auth render uses the legacy key so the hook gets
  // a stable string; once user.id is known the next render switches to the
  // scoped key. (Same pattern DlSearchPage.tsx ships.) A one-shot effect
  // removes the legacy unscoped key on hydrate so stale per-machine drafts
  // can't leak into the next officer's New-Warrant flow.
  const warrantFormStorageKey = user?.id
    ? `rmpg_warrant_form:${user.id}_${editingWarrant?.id ?? 'new'}`
    : `rmpg_warrant_form_${editingWarrant?.id ?? 'new'}`;
  useEffect(() => {
    if (!user?.id) return;
    try { localStorage.removeItem('rmpg_warrant_form'); } catch { /* storage unavailable */ }
  }, [user?.id]);
  const {
    form: formData,
    setForm: setFormData,
    isDirty: formIsDirty,
    wasRestored: formWasRestored,
    clearDraft: clearFormDraft,
    snapshot: snapshotForm,
  } = useFormDraft<typeof EMPTY_FORM>({
    storageKey: warrantFormStorageKey,
    defaultValue: EMPTY_FORM,
    isActive: formOpen,
  });
  const [submitting, setSubmitting] = useState(false);
  const { errors: formErrors, validate: validateForm, clearAllErrors } = useFormValidation();

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
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

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
  // Distinguishes "coverage failed to load" from "no sources configured" — the
  // fetch used to swallow errors, making those two states identical on screen.
  const [coverageError, setCoverageError] = useState<string | null>(null);
  const [watchRuns, setWatchRuns] = useState<WatchRun[]>([]);
  const [watchRunsLoading, setWatchRunsLoading] = useState(false);
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scanRunning, setScanRunning] = useState(false);
  const [boloPrinting, setBoloPrinting] = useState(false);

  // ============================================================
  // DASHBOARD FETCHES
  // ============================================================

  const fetchDashStats = useCallback(async () => {
    setDashStatsLoading(true);
    try {
      const res = await apiFetch<DashboardStats>('/warrants/dashboard/stats');
      if (!mountedRef.current) return;
      setDashStats(res);
    } catch { /* silent */ }
    finally { if (mountedRef.current) setDashStatsLoading(false); }
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
      if (!mountedRef.current) return;
      setPriorityWarrants(res.data || (Array.isArray(res) ? res : []));
    } catch { if (mountedRef.current) setPriorityWarrants([]); }
    finally { if (mountedRef.current) setPriorityLoading(false); }
  }, []);

  // Auto-refresh dashboard stats every 30s
  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    let cancelled = false;
    fetchDashStats();
    fetchPriority();
    apiFetch<{ count: number }>('/warrants/expiring?days=30').then(r => { if (!cancelled && r) setExpiringCount(r.count); }).catch(() => {});
    const interval = setInterval(fetchDashStats, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeTab, fetchDashStats, fetchPriority]);

  // Fetch feed when range changes
  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    fetchFeed();
  }, [activeTab, fetchFeed]);

  // Person search for form — uses the dedicated search endpoint
  useEffect(() => {
    if (!personSearch || personSearch.length < 2) {
      setPersonResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPersonSearchLoading(true);
      try {
        const res = await apiFetch<Person[]>(`/records/persons/search?q=${encodeURIComponent(personSearch)}`);
        if (!cancelled) setPersonResults(Array.isArray(res) ? res.slice(0, 10) : []);
      } catch { if (!cancelled) setPersonResults([]); }
      finally { if (!cancelled) setPersonSearchLoading(false); }
    }, 300);
    return () => { clearTimeout(timer); cancelled = true; };
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
    } catch (err) {
      addToast(err instanceof Error ? `Warrant check failed: ${err.message}` : 'Warrant check failed — please retry', 'error');
    } finally { setCheckingPerson(false); }
  }, []);

  // ============================================================
  // SOURCES TAB FETCHES
  // ============================================================

  // ── Unified Search ──
  const runUnifiedSearch = useCallback(async (firstOverride?: string, lastOverride?: string) => {
    const first = firstOverride ?? uniSearchFirst;
    const last = lastOverride ?? uniSearchLast;
    if (!first.trim() && !last.trim() && !uniSearchWarrantNum.trim()) return;
    setUniSearching(true);
    try {
      const body: Record<string, string> = {};
      if (first.trim()) body.firstName = first.trim();
      if (last.trim()) body.lastName = last.trim();
      if (uniSearchDob.trim()) body.dob = uniSearchDob.trim();
      if (uniSearchWarrantNum.trim()) body.caseNumber = uniSearchWarrantNum.trim();
      if (uniSearchCourt.trim()) body.courtName = uniSearchCourt.trim();
      if (uniSearchSource) body.source = uniSearchSource;
      if (uniSearchOffenseLevel) body.offenseLevel = uniSearchOffenseLevel;
      if (uniSearchStatus) body.status = uniSearchStatus;
      if (uniSearchType) body.type = uniSearchType;
      if (uniSearchCharge.trim()) body.charge = uniSearchCharge.trim();
      if (uniSearchDateFrom) body.dateFrom = uniSearchDateFrom;
      if (uniSearchDateTo) body.dateTo = uniSearchDateTo;

      const res = await apiFetch<UnifiedSearchResults>('/warrants/search-all', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setUniResults(res);
      if (first.trim() && last.trim()) {
        setUniSearchHistory(prev => [
          { first: first.trim(), last: last.trim(), hits: res.meta?.totalHits ?? 0, at: new Date().toISOString() },
          ...prev.filter(h => !(h.first === first.trim() && h.last === last.trim())),
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
    let cancelled = false;
    typeaheadTimer.current = setTimeout(async () => {
      setNameTypeaheadLoading(true);
      try {
        const res = await apiFetch<Person[]>(`/records/persons/search?q=${encodeURIComponent(query)}`);
        if (!cancelled) setNameTypeahead(Array.isArray(res) ? res.slice(0, 8) : []);
      } catch { if (!cancelled) setNameTypeahead([]); } finally { if (!cancelled) setNameTypeaheadLoading(false); }
    }, 300);
    return () => { if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current); cancelled = true; };
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
      notes: `Source: ${w._source === 'utah' ? 'Utah State Warrants API' : w._source === 'scraped' ? `Multi-Source (${w.source_key || 'scraped'})` : 'Local System'}\nSearch Date: ${new Date().toLocaleString('en-US', { timeZone: 'America/Denver' })}`,
      // Extended fields for source/verification
      county: w.city || '',
      case_number: w.case_id || '',
      filing_date: w.issue_date || '',
      data_source: w._source === 'utah' ? 'Utah State Warrants API (warrants.utah.gov)' : w._source === 'scraped' ? `Multi-Source Database (${w.source_key || 'scraped'})` : 'RMPG Local System',
      search_date: new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }),
    };
    try {
      await downloadRecordPdf('warrant', pdfData, pdfData.warrant_number);
    } catch (err) {
      console.error('Warrant PDF failed:', err);
      addToast(err instanceof Error ? `Warrant PDF failed: ${err.message}` : 'Warrant PDF generation failed', 'error');
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
      listTabRef.current?.refresh({ silent: true });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to add to local records', 'error');
    } finally {
      setAddingToLocal(false);
    }
  }, [utahDetailWarrant, addingToLocal]);

  const handleCheckPerson = useCallback(() => {
    if (!utahDetailWarrant) return;
    const first = utahDetailWarrant.first_name;
    const last = utahDetailWarrant.last_name;
    setUniSearchFirst(first);
    setUniSearchLast(last);
    setUtahDetailWarrant(null);
    setActiveTab('search-all');
    runUnifiedSearch(first, last);
  }, [utahDetailWarrant, runUnifiedSearch]);

  // ── Auto-Poll Status ──
  const fetchAutoPollStatus = useCallback(async () => {
    setAutoPollLoading(true);
    try {
      const res = await apiFetch<Partial<AutoPollStatus>>('/warrants/utah-search/auto-poll-status');
      // Normalize at the data boundary: the API contract has drifted (the CF
      // port of /auto-poll-status can return a slim status object missing the
      // watch-tab arrays). TS types don't validate runtime shape, so coerce to
      // a complete AutoPollStatus here — this single guard protects every
      // reader in the watch tab from `undefined.length` crashes.
      setAutoPollStatus({
        syncStatus: res?.syncStatus ?? { lastSync: null, warrantCount: 0, status: 'unknown', lastError: null },
        blocked: res?.blocked ?? false,
        runs: res?.runs ?? [],
        flaggedPersons: res?.flaggedPersons ?? [],
        recentHits: res?.recentHits ?? [],
        totalPersons: res?.totalPersons ?? 0,
      });
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
      const res = await apiFetch<{ sources: ScraperSource[] }>('/warrants/scrapers');
      setCoverageSources(res.sources || []);
      setCoverageError(null);
    } catch (err) {
      // Was `catch { /* silent */ }` — a failed load left the Sources tab in a
      // calm, permanent empty state that read as "no sources configured". On a
      // coverage screen that is indistinguishable from real zero coverage.
      setCoverageError(err instanceof Error ? err.message : 'Failed to load source coverage');
      setCoverageSources([]);
    }
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
        listTabRef.current?.applyWarrantUpdate(updated);
        listTabRef.current?.refetchIfSelected(editingWarrant.id);
      } else {
        await apiFetch('/warrants', { method: 'POST', body: JSON.stringify(body) });
        await listTabRef.current?.refresh({ silent: true });
      }
      clearFormDraft();
      setFormOpen(false);
    } catch (err) {
      listTabRef.current?.setListError(err instanceof Error ? err.message : 'Failed to save warrant');
    } finally {
      setSubmitting(false);
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

  // Keyboard shortcut: Escape — smart cascade. Closes the smallest open
  // modal first (top of stack), not all at once. Order: Utah detail →
  // person profile → form modal. (Bulk confirms / archive confirm / delete
  // confirm / serve modal are now owned by WarrantsListTab and handle their
  // own Escape dismissal via ConfirmDialog / the modal's own close handler.)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (utahDetailWarrant) { e.stopPropagation(); setUtahDetailWarrant(null); return; }
      if (personProfileOpen) { e.stopPropagation(); setPersonProfileOpen(false); return; }
      if (formOpen) { e.stopPropagation(); setFormOpen(false); setEditingWarrant(null); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [utahDetailWarrant, personProfileOpen, formOpen]);

  // Keyboard shortcut: N → open "New Warrant" form (mirrors Dispatch / FI).
  // Suppressed while typing in an input/textarea/contenteditable, while any
  // modal is open, and when role lacks admin/manager (the same gate the
  // existing toolbar button uses).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!isAdminOrManager) return; // role-gate mirrors toolbar button
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (t.isContentEditable) return;
      }
      if (formOpen || personProfileOpen || utahDetailWarrant) return;
      if (activeTab !== 'warrants') return;
      e.preventDefault();
      openNewForm();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen, personProfileOpen, utahDetailWarrant, activeTab, isAdminOrManager]);

  return (
    // h-full, not absolute inset-0: <main> in Layout.tsx isn't a positioned
    // ancestor, so `absolute inset-0` escaped it entirely and painted over
    // the whole viewport — hiding the top nav toolbar completely on this
    // page. Every sibling page (RecordsPage, DispatchPage, ...) uses h-full.
    <div className="h-full flex flex-col overflow-hidden bg-surface-deep">
      {/* ---- TITLE BAR ---- */}
      <PanelTitleBar title="WARRANT SEARCH" icon={AlertTriangle}>
        <RmpgLogo height={16} iconOnly />
        <span className="toolbar-separator" />
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

      {/* ---- TAB BAR (Spillman grouped module strip) ---- */}
      <SpillmanModuleGroup
        groups={[
          {
            label: 'Core',
            tone: 'steel',
            tabs: [
              { id: 'dashboard', label: 'Dashboard', count: dashStats && dashStats.activeWarrants > 0 ? dashStats.activeWarrants : undefined },
              { id: 'warrants',  label: 'Warrants' },
            ],
          },
          {
            label: 'Intelligence',
            tone: 'gold',
            tabs: [
              { id: 'search-all', label: 'Search All' },
              { id: 'screening',  label: 'Screening' },
              { id: 'watch',      label: 'Watch List' },
            ],
          },
          ...(isGodMode || isAdminOrManager ? [{
            label: 'Admin',
            tone: 'red' as const,
            tabs: [
              { id: 'sources',  label: 'Sources' },
              { id: 'scrapers', label: 'Scrapers' },
            ],
          }] : []),
        ] as ModuleGroupSpec[]}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabId)}
      />

      {/* ---- STATS BAR ---- */}
      <div className="panel-inset bg-[var(--surface-sunken)] flex items-center gap-0 border-b border-rmpg-700 text-[10px] font-mono flex-wrap">
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-rmpg-700">
          <span className={`led-dot ${(dashStats?.activeWarrants || 0) > 0 ? 'led-red' : 'led-off'}`} />
          <span className="text-rmpg-400">ACTIVE</span>
          <span className={`font-bold tabular-nums ${(dashStats?.activeWarrants || 0) > 0 ? 'text-red-400' : 'text-rmpg-300'}`}>
            {dashStats?.activeWarrants ?? '-'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-rmpg-700">
          <span className={`led-dot ${(dashStats?.hitsToday || 0) > 0 ? 'led-amber animate-led-blink' : 'led-off'}`} />
          <span className="text-rmpg-400">HITS TODAY</span>
          <span className={`font-bold tabular-nums ${(dashStats?.hitsToday || 0) > 0 ? 'text-amber-400' : 'text-rmpg-300'}`}>
            {dashStats?.hitsToday ?? '-'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-rmpg-700">
          <span className="text-rmpg-400">FLAGGED</span>
          <span className="font-bold tabular-nums text-rmpg-300">{dashStats?.personsFlagged ?? '-'}</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 border-r border-rmpg-700">
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
        <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent" style={{ overscrollBehavior: 'contain' }}>
          <div className="p-4 space-y-4">
            {/* Quick Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-rmpg-500" />
              <input id="ff-warrantspage-0"
                type="text"
                className="input-dark w-full pl-9 text-xs min-h-[36px]"
                placeholder="Quick search warrants by name, number, or charge..."
                value={dashSearch}
                onChange={(e) => setDashSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && dashSearch.trim()) {
                    listTabRef.current?.setSearchQuery(dashSearch.trim());
                    setActiveTab('warrants');
                  }
                }}
              />
              {dashSearch && (
                <IconButton onClick={() => setDashSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-100" aria-label="Clear dash search">
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
                  <input id="ff-warrantspage-1"
                    type="date"
                    className="input-dark text-[10px] py-0.5 px-1 min-h-[22px] w-28"
                    value={summaryFrom}
                    onChange={(e) => setSummaryFrom(e.target.value)}
                    placeholder="From"
                  />
                  <span className="text-[10px] text-rmpg-500">to</span>
                  <input id="ff-warrantspage-2"
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
                        const { fetchPdfBranding, setActiveBranding, loadPdfAssets } = await importWithRetry(() => import('../utils/pdfGenerator'));
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
                        addToast(err instanceof Error ? `Report failed: ${err.message}` : 'Summary report generation failed', 'error');
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
                <div className={`text-2xl font-bold font-mono tabular-nums ${(dashStats?.activeWarrants || 0) > 0 ? 'text-red-400' : 'text-rmpg-100'}`}>
                  {dashStatsLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" role="status" aria-label="Loading" /> : (dashStats?.activeWarrants ?? 0)}
                </div>
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Active Warrants</div>
                {!dashStatsLoading && (dashStats?.unverifiedWarrants ?? 0) > 0 && (
                  <div
                    className="text-[9px] font-bold text-amber-400 mt-0.5 inline-flex items-center gap-1"
                    title="Utah hits matched on name only (no DOB on file) — possible namesakes. Not counted as confirmed active warrants."
                  >
                    <AlertTriangle className="w-2.5 h-2.5" />+{dashStats?.unverifiedWarrants} unverified
                  </div>
                )}
              </div>
              <div className={`panel-inset p-3 rounded-sm text-center ${(dashStats?.hitsToday || 0) > 0 ? 'bg-amber-900/20 border border-amber-900/40' : 'bg-surface-sunken'}`}>
                <div className={`text-2xl font-bold font-mono tabular-nums ${(dashStats?.hitsToday || 0) > 0 ? 'text-amber-400' : 'text-rmpg-100'}`}>
                  {dashStatsLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" role="status" aria-label="Loading" /> : (dashStats?.hitsToday ?? 0)}
                </div>
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Hits Today</div>
              </div>
              <div className="panel-inset bg-surface-sunken p-3 rounded-sm text-center">
                <div className="text-2xl font-bold font-mono tabular-nums text-rmpg-100">
                  {dashStatsLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" role="status" aria-label="Loading" /> : (dashStats?.personsFlagged ?? 0)}
                </div>
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Individuals Flagged</div>
              </div>
              <div className={`panel-inset p-3 rounded-sm text-center ${dashStats && dashStats.sourcesOnline < dashStats.sourcesTotal ? 'bg-red-900/10 border border-red-900/30' : 'bg-surface-sunken'}`}>
                <div className={`text-2xl font-bold font-mono tabular-nums ${dashStats && dashStats.sourcesOnline >= dashStats.sourcesTotal ? 'text-green-400' : dashStats ? 'text-amber-400' : 'text-rmpg-100'}`}>
                  {dashStatsLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" role="status" aria-label="Loading" /> : dashStats ? `${dashStats.sourcesOnline}/${dashStats.sourcesTotal}` : '-'}
                </div>
                <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mt-1">Sources Online</div>
              </div>
              <div
                role="button"
                tabIndex={0}
                className="panel-inset bg-surface-sunken p-3 rounded-sm text-center cursor-pointer hover:bg-surface-raised/50 transition-colors"
                onClick={() => { setActiveTab('warrants'); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveTab('warrants');
                  }
                }}
              >
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
              <div className={`${isMobile ? '' : 'w-[65%]'} flex flex-col min-h-0`}>
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
                    <select id="ff-warrantspage-3"
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

                <div className="panel-inset bg-surface-sunken rounded-sm flex-1 min-h-0 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
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
              <div className={`${isMobile ? '' : 'w-[35%]'} flex flex-col min-h-0`}>
                <h2 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  Priority Warrants
                </h2>

                <div className="space-y-2 flex-1 min-h-0 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
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
                              <span className="text-xs font-bold text-rmpg-100 truncate">
                                {[pw.subject_first_name, pw.subject_last_name].filter(Boolean).join(' ') || 'Unknown'}
                              </span>
                              <span className={`inline-flex px-1 py-0.5 text-[8px] font-bold rounded-sm border ${
                                pw.offense_level === 'felony' ? SEVERITY_COLORS.felony
                                  : pw.offense_level === 'misdemeanor' ? SEVERITY_COLORS.misdemeanor
                                  : 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50'
                              }`}>
                                {(pw.offense_level || pw.type || 'WARRANT').toUpperCase()}
                              </span>
                              {pw.unverified && (
                                <span
                                  className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[8px] font-bold rounded-sm border bg-amber-900/30 text-amber-300 border-amber-600/40"
                                  title="No DOB on file — matched on name only, may be a namesake. Verify identity before acting."
                                >
                                  <AlertTriangle className="w-2 h-2" /> UNVERIFIED
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-rmpg-300 truncate mt-0.5">{chargesFromJson(pw.charge_description)}</div>
                            <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-400">
                              {pw.bail_amount != null && pw.bail_amount > 0 && (
                                <span className="text-green-400 font-mono font-bold">{formatCurrency(pw.bail_amount)}</span>
                              )}
                              {pw.source && (
                                <span className="inline-flex px-1 py-0.5 text-[8px] rounded-sm bg-surface-sunken text-rmpg-300 border border-border-subtle">
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
      <WarrantsListTab
        ref={listTabRef}
        isVisible={activeTab === 'warrants'}
        user={user}
        isAdminOrManager={isAdminOrManager}
        isAdminSupervisorOrManager={isAdminSupervisorOrManager}
        isGodMode={isGodMode}
        canManageWarrants={canManageWarrants}
        isMobile={isMobile}
        navigate={navigate}
        initialPersonId={initialPersonId}
        initialWarrantId={pendingWarrantIdRef.current}
        formOpen={formOpen}
        onOpenNewForm={openNewForm}
        onOpenEditForm={openEditForm}
        onOpenPersonProfile={openPersonProfile}
      />


      {/* ================================================================
          TAB: SEARCH ALL (Unified Cross-Source)
         ================================================================ */}
      {activeTab === 'search-all' && (
        <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
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
                    <label htmlFor="ff-warrantspage-14" className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">First Name</label>
                    <input id="ff-warrantspage-14"
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
                    <label htmlFor="ff-warrantspage-15" className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Last Name</label>
                    <input id="ff-warrantspage-15"
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
                    <label htmlFor="ff-warrantspage-16" className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">DOB</label>
                    <input id="ff-warrantspage-16"
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
                          <span className="text-xs text-rmpg-100">{p.last_name}, {p.first_name}</span>
                          {p.dob && <span className="text-[10px] text-rmpg-400 ml-auto">{p.dob}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Row 2: Warrant #, Court, Source */}
                <div className="flex gap-2 items-end flex-wrap mb-2">
                  <div className="flex-1 min-w-[120px]">
                    <label htmlFor="ff-warrantspage-17" className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Warrant #</label>
                    <input id="ff-warrantspage-17"
                      type="text"
                      className="input-dark w-full"
                      placeholder="Warrant number..."
                      value={uniSearchWarrantNum}
                      onChange={(e) => setUniSearchWarrantNum(e.target.value)}
                    />
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <label htmlFor="ff-warrantspage-18" className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Court</label>
                    <input id="ff-warrantspage-18"
                      type="text"
                      className="input-dark w-full"
                      placeholder="Court name..."
                      value={uniSearchCourt}
                      onChange={(e) => setUniSearchCourt(e.target.value)}
                    />
                  </div>
                  <div className="w-[160px]">
                    <label htmlFor="ff-warrantspage-19" className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Source</label>
                    <select id="ff-warrantspage-19" className="input-dark w-full" value={uniSearchSource} onChange={(e) => setUniSearchSource(e.target.value)}>
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
                      <label htmlFor="ff-warrantspage-20" className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Date From</label>
                      <input id="ff-warrantspage-20" type="date" className="input-dark w-full" value={uniSearchDateFrom} onChange={(e) => setUniSearchDateFrom(e.target.value)} />
                    </div>
                    <div className="w-[140px]">
                      <label htmlFor="ff-warrantspage-21" className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Date To</label>
                      <input id="ff-warrantspage-21" type="date" className="input-dark w-full" value={uniSearchDateTo} onChange={(e) => setUniSearchDateTo(e.target.value)} />
                    </div>
                    <div className="w-[140px]">
                      <label htmlFor="ff-warrantspage-22" className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Offense Level</label>
                      <select id="ff-warrantspage-22" className="input-dark w-full" value={uniSearchOffenseLevel} onChange={(e) => setUniSearchOffenseLevel(e.target.value)}>
                        <option value="">Any</option>
                        {OFFENSE_LEVELS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <label htmlFor="ff-warrantspage-23" className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Charge Keyword</label>
                      <input id="ff-warrantspage-23" type="text" className="input-dark w-full" placeholder="e.g. theft, DUI..." value={uniSearchCharge} onChange={(e) => setUniSearchCharge(e.target.value)} />
                    </div>
                    <div className="w-[120px]">
                      <label htmlFor="ff-warrantspage-24" className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Status</label>
                      <select id="ff-warrantspage-24" className="input-dark w-full" value={uniSearchStatus} onChange={(e) => setUniSearchStatus(e.target.value)}>
                        <option value="">Any</option>
                        {WARRANT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                    <div className="w-[120px]">
                      <label htmlFor="ff-warrantspage-25" className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block mb-1">Type</label>
                      <select id="ff-warrantspage-25" className="input-dark w-full" value={uniSearchType} onChange={(e) => setUniSearchType(e.target.value)}>
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
                    className="toolbar-btn !h-8 !px-3 text-xs text-rmpg-400 hover:text-rmpg-100"
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
                      <span className="text-xs font-bold text-rmpg-100">Local System</span>
                      <span className="ml-auto text-[10px] bg-brand-blue/20 text-brand-blue border border-brand-blue/40 px-1.5 py-0.5 rounded font-mono">
                        {uniResults.local.length}
                      </span>
                    </div>
                    <div className="divide-y divide-surface-border">
                      {uniResults.local.map((w) => (
                        <div key={`local-${w.id}`} className="p-3 hover:bg-surface-raised/50 transition-colors cursor-pointer" onClick={() => openUtahDetail({ first_name: w.subject_first_name || '', last_name: w.subject_last_name || '', charges: w.charge_description, court_name: w.issuing_court || undefined, bail_amount: w.bail_amount ?? undefined, offense_level: w.offense_level || undefined, warrant_type: w.type, status: w.status, case_id: undefined, issue_date: w.created_at }, 'local')}>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-rmpg-100">{w.warrant_number}</span>
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${STATUS_COLORS[w.status] || 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50'}`}>{toDisplayLabel(w.status)}</span>
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${TYPE_COLORS[w.type] || 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50'}`}>{formatEnumValue(w.type)}</span>
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
                      <span className="text-xs font-bold text-rmpg-100">Utah State API</span>
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
                                <span className="text-sm font-bold text-rmpg-100">{w.last_name}, {w.first_name} {w.middle_name || ''}</span>
                                {w.age && <span className="text-[10px] text-rmpg-400">Age: {w.age}</span>}
                                {w.city && <span className="text-[10px] text-rmpg-400">{w.city}</span>}
                              </div>
                              <div className="text-xs text-rmpg-300 mt-1">{chargesFromJson(w.charges || w.charge_description) || 'No charge description'}</div>
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
                                  {formatEnumValue(w.offense_level)}
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
                      <span className="text-xs font-bold text-rmpg-100">Multi-State Scraped</span>
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
                                <span className="text-sm font-bold text-rmpg-100">{w.last_name}, {w.first_name}</span>
                                {w.source_key && <span className="text-[9px] text-rmpg-400 bg-rmpg-700/30 px-1 rounded">{w.source_key}</span>}
                              </div>
                              <div className="text-xs text-rmpg-300 mt-1">{chargesFromJson(w.charges || w.charge_description) || '—'}</div>
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
                                  {formatEnumValue(w.offense_level)}
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
                      className="text-[10px] bg-surface-base/80 text-rmpg-300 hover:text-rmpg-100 border border-surface-border hover:border-brand-blue/40 px-2 py-1 rounded transition-colors"
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
        <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
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
                    <div className="text-xl font-bold font-mono text-rmpg-100">{autoPollStatus.totalPersons}</div>
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
                    className="toolbar-btn text-[10px] bg-red-900/20 text-red-400 border-red-700/40 hover:bg-red-900/30 disabled:opacity-50"
                    disabled={!autoPollStatus?.flaggedPersons?.length || boloPrinting}
                    onClick={async () => {
                      if (!autoPollStatus?.flaggedPersons?.length) return;
                      setBoloPrinting(true);
                      try {
                        const { fetchPdfBranding, setActiveBranding, loadPdfAssets } = await importWithRetry(() => import('../utils/pdfGenerator'));
                        const branding = await fetchPdfBranding();
                        setActiveBranding(branding);
                        await loadPdfAssets();

                        // Per-person augmentation: the auto-poll status endpoint
                        // joins warrants by subject_person_id, but manually-entered
                        // warrants frequently have NULL subject_person_id (the
                        // ArrestFormModal links by name lookup, not FK) - Karl
                        // Turley's BATTERY warrant is the canonical reproducer.
                        // Fall back to a search-all-by-name query and merge any
                        // additional active warrants we find. Dedup by warrant id.
                        const augmented = await Promise.all(
                          autoPollStatus.flaggedPersons.map(async (p) => {
                            try {
                              const res = await apiFetch<UnifiedSearchResults>('/warrants/search-all', {
                                method: 'POST',
                                body: JSON.stringify({
                                  firstName: p.first_name,
                                  lastName: p.last_name,
                                  status: 'active',
                                }),
                              });
                              const byName = (res?.local ?? []) as Array<Warrant & Record<string, any>>;
                              const seen = new Set<number>(p.warrants.map(w => w.id));
                              const merged = [...p.warrants];
                              for (const w of byName) {
                                if (typeof w.id === 'number' && !seen.has(w.id)) {
                                  merged.push({
                                    id: w.id,
                                    warrant_number: String(w.warrant_number ?? ''),
                                    type: String(w.type ?? 'arrest'),
                                    status: String(w.status ?? 'active'),
                                    charge_description: String(w.charge_description ?? ''),
                                    offense_level: (w.offense_level ?? null) as string | null,
                                    bail_amount: (w.bail_amount ?? null) as number | null,
                                    issuing_court: (w.issuing_court ?? null) as string | null,
                                    source: (w.source ?? null) as string | null,
                                    created_at: String(w.created_at ?? ''),
                                  });
                                  seen.add(w.id);
                                }
                              }
                              return { ...p, warrants: merged };
                            } catch {
                              return p;
                            }
                          })
                           );

                     const subjects: BoloSubject[] = augmented.map(p => ({
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
                        const pdf = generateBoloPdf(subjects, {
                          printedBy: displayUserName(user),
                          printedByBadge: user?.badge_number,
                        });
                        const blob = pdf.output('blob');
                        const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
                        const a = document.createElement('a');
                        a.href = url;
                        // Single-subject packets get an operator-greppable
                        // filename (BOLO_TURLEY_2026-05-30.pdf); multi-subject
                        // packets stay generic.
                        const date = new Date().toISOString().slice(0, 10);
                        const safe = (s: string) => s.replace(/[^\w\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
                        const filename = subjects.length === 1 && subjects[0].last_name
                          ? `BOLO_${safe(subjects[0].last_name.toUpperCase())}_${date}.pdf`
                          : `BOLO_Packet_${date}.pdf`;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      } catch (err) {
                        console.error('BOLO PDF generation failed:', err);
                        addToast(err instanceof Error ? `BOLO generation failed: ${err.message}` : 'BOLO generation failed', 'error');
                      } finally {
                        setBoloPrinting(false);
                      }
                    }}
                  >
                    {boloPrinting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Printer className="w-3 h-3" />} Print BOLO
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
                      <span className="text-xs font-bold text-rmpg-100">Persons with Active Warrants</span>
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
                                  <span className="text-sm font-bold text-rmpg-100">{p.last_name}, {p.first_name}</span>
                                  {p.warrant_severity && (
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${severityBg}`}>
                                      {formatEnumValue(p.warrant_severity)}
                                    </span>
                                  )}
                                  {p.local_warrant_count > 0 && (
                                    <span className="text-[9px] bg-brand-blue/20 text-brand-blue border border-brand-blue/30 px-1.5 py-0.5 rounded">
                                      {p.local_warrant_count} local
                                    </span>
                                  )}
                                  {p.utah_hit_count > 0 && (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${p.unverified ? 'bg-amber-900/30 text-amber-400 border-amber-700/40' : 'bg-red-900/30 text-red-400 border-red-700/40'}`}>
                                      {p.utah_hit_count} Utah
                                    </span>
                                  )}
                                  {p.unverified && p.utah_hit_count > 0 && (
                                    <span
                                      className="text-[9px] font-bold uppercase bg-amber-900/30 text-amber-300 border border-amber-600/40 px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                                      title="No DOB on file — Utah hits matched on name only and may belong to a namesake. Verify identity before acting; add a DOB to confirm."
                                    >
                                      <AlertTriangle className="w-2.5 h-2.5" /> Unverified
                                    </span>
                                  )}
                                </div>
                                {p.unverified && p.utah_hit_count > 0 && (
                                  <div className="text-[10px] text-amber-400/80 mt-0.5">
                                    Name-only match (no DOB) — possible namesake. Confirm identity before acting.
                                  </div>
                                )}
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
                                          <span className="text-rmpg-400">{formatEnumValue(w.type)}</span>
                                          <span className="text-rmpg-200 flex-1 min-w-0 truncate">{w.charge_description}</span>
                                          {w.issuing_court && <span className="text-rmpg-400 truncate">{w.issuing_court}</span>}
                                          {w.bail_amount != null && w.bail_amount > 0 && (
                                            <span className="text-amber-400 font-mono">${w.bail_amount.toLocaleString()}</span>
                                          )}
                                          {w.offense_level && (
                                            <span className={`text-[8px] font-bold uppercase px-1 py-0.5 rounded border ${
                                              w.offense_level === 'felony' ? 'bg-red-900/50 text-red-400 border-red-700/50' :
                                              w.offense_level === 'misdemeanor' ? 'bg-amber-900/50 text-amber-400 border-amber-700/50' :
                                              'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50'
                                            }`}>{formatEnumValue(w.offense_level)}</span>
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
                                          <span className="text-rmpg-200 flex-1 min-w-0 truncate">{chargesFromJson(uw.charges)}</span>
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
                      <span className="text-xs font-bold text-rmpg-100">Recent Activity</span>
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
                          {h.charges && <span className="text-[10px] text-rmpg-400 min-w-0 truncate flex-1">{chargesFromJson(h.charges)}</span>}
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
                      <span className="text-xs font-bold text-rmpg-100">Scan History</span>
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
                              <td className="p-2 text-center text-rmpg-100 font-mono">{r.persons_checked}</td>
                              <td className="p-2 text-center text-red-400 font-mono font-bold">{r.new_warrants_found}</td>
                              <td className="p-2 text-center text-green-400 font-mono">{r.warrants_cleared}</td>
                              <td className="p-2 text-center text-amber-400 font-mono">{r.errors}</td>
                              <td className="p-2 text-center">
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                  r.status === 'completed' ? 'bg-green-900/30 text-green-400' :
                                  r.status === 'running' ? 'bg-brand-blue/20 text-brand-blue' :
                                  'bg-red-900/30 text-red-400'
                                }`}>{toDisplayLabel(r.status)}</span>
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
        <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
          <div className="p-4 space-y-4">
            {/* Coverage Section */}
            {coverageLoading ? (
              <div className="flex items-center justify-center h-64 text-rmpg-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" role="status" aria-label="Loading" /> Loading coverage data...
              </div>
            ) : coverageError ? (
              <div role="alert" className="panel-inset bg-surface-sunken p-4 rounded-sm text-center space-y-2">
                <div className="text-[11px] font-bold text-[color:var(--sev-critical)] uppercase tracking-wider">
                  Source coverage unavailable
                </div>
                {/* text-fg-secondary / text-fg-muted, not the rmpg text ramp —
                    the accentTokens ratchet forbids new sub-AA ramp utilities,
                    and an error message is the last thing that should be low
                    contrast. */}
                <div className="text-[10px] text-fg-secondary">{coverageError}</div>
                <div className="text-[9px] text-fg-muted">
                  This is a load failure, not zero coverage — source counts below are not being shown.
                </div>
                <button
                  onClick={fetchCoverage}
                  className="text-[10px] px-2 py-1 border border-rmpg-600 rounded-sm text-rmpg-200 hover:bg-surface-raised"
                >
                  Retry
                </button>
              </div>
            ) : (() => {
              const totalSources = coverageSources.length;
              const enabledSources = coverageSources.filter(s => s.enabled).length;
              // `warrant_count` is the only count /warrants/scrapers returns. The old
              // code summed `active_count` and `total_count` — neither exists, so both
              // reduces produced NaN and rendered the literal string "NaN". There is no
              // active-vs-total distinction in the data, so we report ONE honest number
              // rather than the same value under two different labels.
              const totalIndexed = coverageSources.reduce((sum, s) => sum + (s.warrant_count || 0), 0);
              // Field is `last_scrape_at`, not `last_scraped_at` — the typo'd read made
              // this always 0 even though every source has a live timestamp.
              const recentlyScraped = coverageSources.filter(s => {
                if (!s.last_scrape_at) return false;
                const ago = Date.now() - parseTimestamp(s.last_scrape_at).getTime();
                return ago < 3 * 60 * 60 * 1000;
              }).length;
              const brokenSources = coverageSources.filter(s => s.circuit_broken).length;
              // Group via sourceStateCode so a source with a blank state lands in an
              // explicit bucket instead of being dropped by .filter(Boolean) — that
              // drop is what hid Utah from its own coverage grid.
              const stateCodes = [...new Set(coverageSources.map(sourceStateCode))].sort();
              const byState = new Map(stateCodes.map(code => [
                code,
                coverageSources.filter(s => sourceStateCode(s) === code),
              ]));

              return (
                <>
                  {/* Summary stats */}
                  <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-3`}>
                    {[
                      { label: 'Total Sources', value: totalSources, sub: `${enabledSources} enabled` },
                      { label: 'Recently Scraped', value: recentlyScraped, sub: 'within 3 hours' },
                      { label: 'Indexed Warrants', value: totalIndexed.toLocaleString(), sub: 'across all sources' },
                      { label: 'Circuit Broken', value: brokenSources, sub: brokenSources > 0 ? 'not being scraped' : 'all sources reachable' },
                    ].map((s, i) => (
                      <div key={i} className="panel-inset bg-surface-sunken p-3 rounded-sm text-center">
                        <div className="text-lg font-bold text-rmpg-100 font-mono">{s.value}</div>
                        <div className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">{s.label}</div>
                        <div className="text-[9px] text-rmpg-500 mt-0.5">{s.sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Sources list */}
                  <div className="panel-inset bg-surface-sunken p-3 rounded-sm">
                    <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-2 mb-2">
                      <Globe className="w-3.5 h-3.5 text-brand-400" />
                      All Sources ({totalSources})
                    </h3>
                    <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'} gap-2`}>
                      {stateCodes.map((state: any) => {
                        const sources: ScraperSource[] = byState.get(state) || [];
                        // Was `s.active_warrants` (nonexistent) → always 0, so the
                        // "N active" line below never rendered for any state.
                        const active = sources.reduce((sum: number, s) => sum + (s.warrant_count || 0), 0);
                        const enabled = sources.filter(s => s.enabled).length;
                        // Was `s.consecutive_failures` (nonexistent) → always false, so
                        // the amber error styling never rendered no matter how broken
                        // a source was. Real field is `consecutive_errors`.
                        const hasErrors = sources.some(s => (s.consecutive_errors || 0) > 0);
                        const lastScraped = sources.map(s => s.last_scrape_at).filter(Boolean).sort().pop();
                        const isRecent = lastScraped && (Date.now() - parseTimestamp(lastScraped).getTime()) < 3 * 60 * 60 * 1000;

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
                            <div className="text-sm font-bold font-mono text-rmpg-100">{state}</div>
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
                        <thead className="sticky top-0 z-10 bg-surface-deep">
                          <tr>
                            <th className="text-left px-2 py-1">Source</th>
                            <th className="text-left px-2 py-1">State</th>
                            <th className="text-left px-2 py-1">County</th>
                            <th className="text-center px-2 py-1">Status</th>
                            {/* One count, not two — /warrants/scrapers returns only
                                warrant_count. The old Active/Total pair read two
                                nonexistent fields and rendered blank cells. */}
                            <th className="text-right px-2 py-1">Indexed</th>
                            <th className="text-left px-2 py-1">Last Scrape</th>
                            <th className="text-left px-2 py-1">Last Success</th>
                          </tr>
                        </thead>
                        <tbody>
                          {coverageSources.map(src => (
                            <tr key={src.source_key} className="border-t border-rmpg-800/50 hover:bg-surface-raised/30 transition-colors">
                              <td className="px-2 py-1 font-mono text-rmpg-300">{src.source_key}</td>
                              <td className="px-2 py-1">{src.state}</td>
                              <td className="px-2 py-1 text-rmpg-400">{src.county || '-'}</td>
                              <td className="px-2 py-1 text-center">
                                {src.enabled ? (
                                  src.last_error ? (
                                    <span className="text-amber-400">Error</span>
                                  ) : (
                                    <span className="text-green-400">Enabled</span>
                                  )
                                ) : (
                                  <span className="text-rmpg-500">Disabled</span>
                                )}
                              </td>
                              <td className="px-2 py-1 text-right font-mono">{(src.warrant_count || 0).toLocaleString()}</td>
                              <td className="px-2 py-1 text-rmpg-400">
                                {src.last_scrape_at ? formatDateTime(src.last_scrape_at) : 'Never'}
                              </td>
                              <td className="px-2 py-1 text-rmpg-400">
                                {src.last_success_at ? formatDateTime(src.last_success_at) : 'Never'}
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
                            : run.status === 'running' ? 'bg-surface-sunken text-rmpg-400 border-border-default'
                            : 'bg-red-900/50 text-red-400 border-red-700/50'
                        }`}>
                          {run.status === 'running' && <Loader2 className="w-2.5 h-2.5 animate-spin" role="status" aria-label="Loading" />}
                          <span className={`led-dot ${
                            run.status === 'completed' ? 'led-green' : run.status === 'running' ? 'led-gray animate-led-pulse' : 'led-red'
                          }`} />
                          {formatEnumValue(run.status)}
                        </span>
                        <span className="ml-auto text-[10px] text-rmpg-500 font-mono">
                          {computeDuration(run.started_at, run.completed_at)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                        <div className="panel-beveled p-2">
                          <div className="text-[9px] text-rmpg-500 uppercase">Persons</div>
                          <div className="text-base font-bold font-mono text-rmpg-100 tabular-nums">{run.persons_checked}</div>
                        </div>
                        <div className="panel-beveled p-2">
                          <div className="text-[9px] text-rmpg-500 uppercase">New Warrants</div>
                          <div className={`text-base font-bold font-mono tabular-nums ${run.new_warrants_found > 0 ? 'text-red-400' : 'text-rmpg-100'}`}>
                            {run.new_warrants_found}
                          </div>
                        </div>
                        <div className="panel-beveled p-2">
                          <div className="text-[9px] text-rmpg-500 uppercase">Cleared</div>
                          <div className={`text-base font-bold font-mono tabular-nums ${run.warrants_cleared > 0 ? 'text-green-400' : 'text-rmpg-100'}`}>
                            {run.warrants_cleared}
                          </div>
                        </div>
                        <div className="panel-beveled p-2">
                          <div className="text-[9px] text-rmpg-500 uppercase">Errors</div>
                          <div className={`text-base font-bold font-mono tabular-nums ${run.errors > 0 ? 'text-amber-400' : 'text-rmpg-100'}`}>
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
          TAB: SCREENING — INTERPOL / OFAC / Utah SOR external screening
         ================================================================ */}
      {activeTab === 'screening' && (
        <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
          <div className="p-4">
            <ScreeningWorkspace />
          </div>
        </div>
      )}

      {/* ================================================================
          TAB 4: SCRAPERS — admin/manager only, phase 5 dashboard
         ================================================================ */}
      {activeTab === 'scrapers' && (isGodMode || isAdminOrManager) && (
        <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
          <ScrapersTab />
        </div>
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
              <h2 className="text-sm font-bold text-rmpg-100 flex items-center gap-2">
                <User className="w-4 h-4 text-brand-400" /> Person Warrant Profile
              </h2>
              <IconButton onClick={() => setPersonProfileOpen(false)} className="text-rmpg-400 hover:text-rmpg-100" aria-label="Close person profile">
                <X className="w-4 h-4" />
              </IconButton>
            </div>

            {personProfileLoading ? (
              <div className="flex-1 flex items-center justify-center text-rmpg-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" role="status" aria-label="Loading" /> Loading profile...
              </div>
            ) : personProfile ? (
              <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent p-4 space-y-4">
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
                    <h3 className="text-base font-bold text-rmpg-100">
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
                            <span className="font-mono text-xs text-rmpg-100 font-bold">{w.warrant_number}</span>
                            <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded-sm border ${STATUS_COLORS[w.status] || ''}`}>
                              {formatEnumValue(w.status)}
                            </span>
                            <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold rounded-sm border ${TYPE_COLORS[w.type] || TYPE_COLORS.other}`}>
                              {(w.type || 'WARRANT').toUpperCase()}
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
          <div className={`panel-beveled bg-surface-base flex flex-col ${isMobile ? 'w-full h-full' : 'w-[550px] max-h-[85vh]'}`}>
            <div className="flex items-center justify-between p-4 border-b border-rmpg-600">
              <div className="flex items-center gap-2">
                <h2 id={warrantFormTitleId} className="text-sm font-bold text-rmpg-100">{editingWarrant ? 'Edit Warrant' : 'New Warrant'}</h2>
                {formIsDirty && (
                  <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wider">UNSAVED</span>
                )}
              </div>
              <IconButton onClick={() => { clearFormDraft(); setFormOpen(false); }} className="text-rmpg-400 hover:text-rmpg-100" aria-label="Close form"><X className="w-4 h-4" /></IconButton>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4 flex-1 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
              {formWasRestored && (
                <div className="flex items-center justify-between px-3 py-2 rounded-sm border border-amber-500/30" style={{ background: 'rgb(var(--sev-warn-rgb) / 0.08)' }}>
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
                  <label htmlFor="ff-warrantspage-26" className="field-label">Warrant Type *</label>
                  <select id="ff-warrantspage-26" className="select-dark text-xs w-full" value={formData.type} onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}>
                    {WARRANT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-warrantspage-27" className="field-label">Offense Level</label>
                  <select id="ff-warrantspage-27" className="select-dark text-xs w-full" value={formData.offense_level} onChange={(e) => setFormData(prev => ({ ...prev, offense_level: e.target.value }))}>
                    <option value="">-- Select --</option>
                    {OFFENSE_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Subject person search */}
              <div className="relative">
                <label htmlFor="ff-warrantspage-28" className="field-label">Subject Person</label>
                {selectedPersonName && formData.subject_person_id ? (
                  <div className="flex items-center gap-2 p-2 bg-surface-raised border border-rmpg-600 rounded-sm text-xs">
                    <User className="w-3 h-3 text-brand-400" />
                    <span className="text-rmpg-100 font-bold">{selectedPersonName}</span>
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
                    <input id="ff-warrantspage-28"
                      type="text"
                      className="input-dark text-xs w-full min-h-[36px]"
                      placeholder="Search persons by name..." aria-label="Search persons by name..."
                      value={personSearch}
                      onChange={(e) => { setPersonSearch(e.target.value); setShowPersonDropdown(true); }}
                      onFocus={() => setShowPersonDropdown(true)}
                    />
                    {showPersonDropdown && personResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 max-h-40 overflow-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent bg-rmpg-800 border border-rmpg-600 rounded-sm shadow-lg">
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
                            <span className="font-bold text-rmpg-100">{p.first_name} {p.last_name}</span>
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
                <RichTextArea
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
                  <label htmlFor="ff-warrantspage-29" className="field-label">Issuing Court</label>
                  <input id="ff-warrantspage-29" type="text" className="input-dark text-xs w-full min-h-[36px]" value={formData.issuing_court} onChange={(e) => setFormData(prev => ({ ...prev, issuing_court: e.target.value }))} placeholder="e.g. 3rd District Court" />
                </div>
                <div>
                  <label htmlFor="ff-warrantspage-30" className="field-label">Issuing Judge</label>
                  <input id="ff-warrantspage-30" type="text" className="input-dark text-xs w-full min-h-[36px]" value={formData.issuing_judge} onChange={(e) => setFormData(prev => ({ ...prev, issuing_judge: e.target.value }))} placeholder="e.g. Hon. Smith" />
                </div>
              </div>

              {/* Bail + Expires */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-warrantspage-31" className="field-label">Bail Amount</label>
                  <input id="ff-warrantspage-31" type="number" step="0.01" className={`input-dark text-xs w-full ${formErrors.bail_amount ? '!border-red-500' : ''}`} value={formData.bail_amount} onChange={(e) => setFormData(prev => ({ ...prev, bail_amount: e.target.value }))} placeholder="0.00" />
                  {formErrors.bail_amount && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.bail_amount}</p>}
                </div>
                <div>
                  <label htmlFor="ff-warrantspage-32" className="field-label">Expires</label>
                  <input id="ff-warrantspage-32" type="date" className="input-dark text-xs w-full min-h-[36px]" value={formData.expires_at} onChange={(e) => setFormData(prev => ({ ...prev, expires_at: e.target.value }))} />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="field-label">Notes</label>
                <RichTextArea className="input-dark text-xs w-full min-h-[36px]" rows={2} value={formData.notes} onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Additional notes..." />
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

      {/* ================================================================
          UTAH WARRANT DETAIL MODAL
         ================================================================ */}
      {utahDetailWarrant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setUtahDetailWarrant(null)}>
          <div
            className="bg-surface-deep border border-rmpg-700 rounded w-full max-w-2xl max-h-[90vh] overflow-auto shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700 bg-surface-base">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="text-base font-bold text-rmpg-100 truncate">
                  {utahDetailWarrant.last_name}, {utahDetailWarrant.first_name} {utahDetailWarrant.middle_name || ''}
                </span>
                <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-sm border flex-shrink-0 ${
                  utahDetailWarrant._source === 'utah' ? 'bg-red-900/50 text-red-400 border-red-700/50' :
                  utahDetailWarrant._source === 'local' ? 'bg-surface-sunken text-rmpg-400 border-border-default' :
                  'bg-amber-900/50 text-amber-400 border-amber-700/50'
                }`}>
                  {utahDetailWarrant._source === 'utah' ? 'UTAH STATE' : utahDetailWarrant._source === 'local' ? 'LOCAL' : 'SCRAPED'}
                </span>
              </div>
              <IconButton onClick={() => setUtahDetailWarrant(null)} className="text-rmpg-400 hover:text-rmpg-100 p-1" aria-label="Close warrant detail">
                <X className="w-4 h-4" />
              </IconButton>
            </div>

            <div className="p-4 space-y-4">
              {/* SUBJECT INFORMATION */}
              <div>
                <div className="bg-surface-overlay px-3 py-1.5 rounded-t-sm">
                  <span className="text-[10px] font-bold text-rmpg-100 uppercase tracking-widest">Subject Information</span>
                </div>
                <div className="border border-t-0 border-rmpg-700 rounded-b-sm p-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Full Name</span>
                      <div className="font-mono text-rmpg-100 mt-0.5">{utahDetailWarrant.last_name}, {utahDetailWarrant.first_name} {utahDetailWarrant.middle_name || ''}</div>
                    </div>
                    {utahDetailWarrant.age != null && (
                      <div>
                        <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Age</span>
                        <div className="font-mono text-rmpg-100 mt-0.5">{utahDetailWarrant.age}</div>
                      </div>
                    )}
                    {utahDetailWarrant.city && (
                      <div>
                        <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">City</span>
                        <div className="font-mono text-rmpg-100 mt-0.5">{utahDetailWarrant.city}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* WARRANT DETAILS */}
              <div>
                <div className="bg-surface-overlay px-3 py-1.5 rounded-t-sm">
                  <span className="text-[10px] font-bold text-rmpg-100 uppercase tracking-widest">Warrant Details</span>
                </div>
                <div className="border border-t-0 border-rmpg-700 rounded-b-sm p-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    {(utahDetailWarrant.warrant_id || utahDetailWarrant.utah_warrant_id) && (
                      <div>
                        <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Warrant ID</span>
                        <div className="font-mono text-rmpg-100 mt-0.5">{utahDetailWarrant.warrant_id || utahDetailWarrant.utah_warrant_id}</div>
                      </div>
                    )}
                    {utahDetailWarrant.warrant_type && (
                      <div>
                        <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Type</span>
                        <div className="font-mono text-rmpg-100 mt-0.5 uppercase">{formatEnumValue(utahDetailWarrant.warrant_type)}</div>
                      </div>
                    )}
                    <div>
                      <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Status</span>
                      <div className="mt-0.5">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm border ${
                          (utahDetailWarrant.status || 'active') === 'active' ? 'bg-red-900/50 text-red-400 border-red-700/50' : 'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50'
                        }`}>{utahDetailWarrant.status || 'ACTIVE'}</span>
                      </div>
                    </div>
                    {utahDetailWarrant.offense_level && (
                      <div>
                        <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Offense Level</span>
                        <div className="mt-0.5">
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm border ${
                            utahDetailWarrant.offense_level === 'felony' ? 'bg-red-900/50 text-red-400 border-red-700/50' :
                            utahDetailWarrant.offense_level === 'misdemeanor' ? 'bg-amber-900/50 text-amber-400 border-amber-700/50' :
                            'bg-rmpg-700/40 text-rmpg-300 border-rmpg-600/50'
                          }`}>{toDisplayLabel(utahDetailWarrant.offense_level)}</span>
                        </div>
                      </div>
                    )}
                    {utahDetailWarrant.bail_amount != null && utahDetailWarrant.bail_amount > 0 && (
                      <div>
                        <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Bail Amount</span>
                        <div className="font-mono text-amber-400 font-bold mt-0.5 tabular-nums">${Number(utahDetailWarrant.bail_amount).toLocaleString()}</div>
                      </div>
                    )}
                  </div>
                  {/* Charges - full width */}
                  {(utahDetailWarrant.charges || utahDetailWarrant.charge_description) && (
                    <div className="mt-3">
                      <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Offense / Charges</span>
                      <div className="font-mono text-rmpg-100 mt-0.5 text-xs whitespace-pre-wrap">{chargesFromJson(utahDetailWarrant.charges || utahDetailWarrant.charge_description) || '—'}</div>
                      <LegalDataHunterValidateButton
                        charge={chargesFromJson(utahDetailWarrant.charges || utahDetailWarrant.charge_description) || ''}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* COURT INFORMATION */}
              {(utahDetailWarrant.court_name || utahDetailWarrant.case_id || utahDetailWarrant.issue_date) && (
                <div>
                  <div className="bg-surface-overlay px-3 py-1.5 rounded-t-sm">
                    <span className="text-[10px] font-bold text-rmpg-100 uppercase tracking-widest">Court Information</span>
                  </div>
                  <div className="border border-t-0 border-rmpg-700 rounded-b-sm p-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                      {utahDetailWarrant.court_name && (
                        <div>
                          <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Issuing Court</span>
                          <div className="font-mono text-rmpg-100 mt-0.5">{utahDetailWarrant.court_name}</div>
                        </div>
                      )}
                      {utahDetailWarrant.case_id && (
                        <div>
                          <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Case Number</span>
                          <div className="font-mono text-rmpg-100 mt-0.5">{utahDetailWarrant.case_id}</div>
                        </div>
                      )}
                      {utahDetailWarrant.issue_date && (
                        <div>
                          <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Issue Date</span>
                          <div className="font-mono text-rmpg-100 mt-0.5">{utahDetailWarrant.issue_date}</div>
                        </div>
                      )}
                      <div>
                        <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">State</span>
                        <div className="font-mono text-rmpg-100 mt-0.5">UTAH</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SOURCE / VERIFICATION */}
              <div>
                <div className="bg-surface-overlay px-3 py-1.5 rounded-t-sm">
                  <span className="text-[10px] font-bold text-rmpg-100 uppercase tracking-widest">Source / Verification</span>
                </div>
                <div className="border border-t-0 border-rmpg-700 rounded-b-sm p-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Data Source</span>
                      <div className="font-mono text-rmpg-100 mt-0.5">
                        {utahDetailWarrant._source === 'utah' ? 'Utah State Warrants API' :
                         utahDetailWarrant._source === 'local' ? 'RMPG Local System' :
                         `Multi-Source (${utahDetailWarrant.source_key || 'scraped'})`}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Search Date</span>
                      <div className="font-mono text-rmpg-100 mt-0.5">{new Date().toLocaleString()}</div>
                    </div>
                    {utahDetailWarrant.fetched_at && (
                      <div>
                        <span className="text-[10px] font-bold text-[var(--brand-gold)] uppercase tracking-wider">Fetched At</span>
                        <div className="font-mono text-rmpg-100 mt-0.5">{formatDateTime(utahDetailWarrant.fetched_at)}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-rmpg-700 bg-surface-base flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleUtahPrint}
                  className="toolbar-btn text-xs bg-[rgb(var(--brand-gold-rgb)/0.2)] text-[var(--brand-gold)] border-[rgb(var(--brand-gold-rgb)/0.4)] hover:bg-[rgb(var(--brand-gold-rgb)/0.3)]"
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
