// ============================================================
// RMPG Flex — Citations / Summons Page
// ============================================================
// Full citation management: list, create, edit, detail view.
// Left panel = filterable list, right panel = detail or form.
// Integrates StatuteLookup for violation code selection.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import RichTextArea from '../components/RichTextArea';
import { useToast } from '../components/ToastProvider';
import ConfirmDialog from '../components/ConfirmDialog';
import { useDistrictOptions, useDistrictIdentify } from '../hooks/useDistrictLookup';
import {
  FileWarning,
  Plus,
  Search,
  Filter,
  X,
  Loader2,
  AlertTriangle,
  Check,
  Scale,
  User,
  Car,
  Calendar,
  DollarSign,
  Clock,
  Hash,
  MapPin,
  FileText,
  Ban,
  RefreshCw,
  Eye,
  Pencil,
  Copy,
  Zap,
  Lock,
  Gavel,
  ExternalLink,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import { toNum } from '../utils/sentinel';
import { useLiveSync } from '../hooks/useLiveSync';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import StatuteLookup, { type StatuteResult } from '../components/StatuteLookup';
import PrintRecordButton from '../components/PrintRecordButton';
import type { CitationPdfData } from '../utils/recordPdfGenerator';
import { localToday, formatDate, parseTimestamp } from '../utils/dateUtils';
import { useFormValidation } from '../hooks/useFormValidation';
import { isValidDate, isValidPlate, isValidState } from '../utils/validate';
import SectorZoneBeatPicker from '../components/SectorZoneBeatPicker';
import ExportButton from '../components/ExportButton';
import { formatAddressDisplay } from '../utils/statusLabels';
import { useFormDraft } from '../hooks/useFormDraft';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard';
import FloatingSaveBar from '../components/FloatingSaveBar';
import AddressAutocomplete from '../components/AddressAutocomplete';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { ViolationStack } from '../components/ViolationStack';
import { newDraft, type ViolationDraft, type OffenseLevel } from '../components/violationStackHelpers';
import type { StatuteRow } from '../components/statuteAutofill';
import { CitationPdfPreview } from '../components/CitationPdfPreview';
import { formToData } from '../components/citationFormAdapter';
import { usePersistedPreviewMode } from '../hooks/usePersistedPreviewMode';
import { Combobox } from '../components/Combobox';
import { composeAddressUnit } from '../utils/addressUnit';

// ── Types ──────────────────────────────────────────────────

type CitationType = 'traffic' | 'criminal' | 'parking' | 'warning';
type CitationStatus = 'issued' | 'paid' | 'contested' | 'dismissed' | 'warrant_issued' | 'voided' | 'payment_plan';

interface Citation {
  id: number;
  citation_number: string;
  type: CitationType;
  status: CitationStatus;
  person_id: number | null;
  person_name: string | null;
  person_dob: string | null;
  person_dl: string | null;
  person_address: string | null;
  vehicle_description: string | null;
  vehicle_plate: string | null;
  vehicle_state: string | null;
  statute_id: number | null;
  statute_citation: string | null;
  violation_description: string | null;
  offense_level: string | null;
  fine_amount: number | null;
  violation_date: string | null;
  violation_time: string | null;
  location: string | null;
  incident_id: number | null;
  call_id: number | null;
  issuing_officer_id: number | null;
  issuing_officer_name: string | null;
  badge_number: string | null;
  court_date: string | null;
  court_name: string | null;
  court_address: string | null;
  notes: string | null;
  section_id: string | null;
  zone_id: string | null;
  beat_id: string | null;
  zone_beat: string | null;
  // Spillman Flex extended fields
  latitude: number | null;
  longitude: number | null;
  vehicle_vin: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  speed_recorded: number | null;
  speed_limit: number | null;
  radar_type: string | null;
  bac_level: number | null;
  bond_amount: number | null;
  bond_type: string | null;
  is_warning: number;
  is_equipment_violation: number;
  school_zone: number;
  construction_zone: number;
  accident_related: number;
  dui_related: number;
  commercial_vehicle: number;
  voided_reason: string | null;
  court_time: string | null;
  court_room: string | null;
  appearance_required: number;
  plea: string | null;
  verdict: string | null;
  sentence: string | null;
  disposition_date: string | null;
  created_at: string;
  updated_at: string;
}

interface CitationStats {
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  total: number;
  fines_issued: number;
  fines_collected: number;
  today_count: number;
}

interface CitationForm {
  type: CitationType;
  status: CitationStatus;
  person_id: string;
  person_name: string;
  person_dob: string;
  person_dl: string;
  person_address: string;
  vehicle_description: string;
  vehicle_plate: string;
  vehicle_state: string;
  statute_id: string;
  statute_citation: string;
  violation_description: string;
  offense_level: string;
  fine_amount: string;
  violation_date: string;
  violation_time: string;
  location: string;
  issuing_officer_name: string;
  badge_number: string;
  court_date: string;
  court_name: string;
  court_address: string;
  notes: string;
  section_id: string;
  zone_id: string;
  beat_id: string;
  zone_beat: string;
  // Geocoded coordinates for the violation location — populated by the
  // address autocomplete so the citation can be plotted on the Map UI.
  latitude: number | null;
  longitude: number | null;
  // Spillman Flex traffic fields
  vehicle_vin: string;
  vehicle_year: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_color: string;
  speed_recorded: string;
  speed_limit: string;
  radar_type: string;
  bac_level: string;
  bond_amount: string;
  bond_type: string;
  is_warning: boolean;
  school_zone: boolean;
  construction_zone: boolean;
  accident_related: boolean;
  dui_related: boolean;
  commercial_vehicle: boolean;
  court_time: string;
  court_room: string;
  appearance_required: boolean;
}

// ── Constants ──────────────────────────────────────────────

const CITATION_TYPES: { value: CitationType; label: string }[] = [
  { value: 'traffic', label: 'Traffic' },
  { value: 'criminal', label: 'Criminal' },
  { value: 'parking', label: 'Parking' },
  { value: 'warning', label: 'Warning' },
];

const CITATION_STATUSES: { value: CitationStatus; label: string }[] = [
  { value: 'issued', label: 'Issued' },
  { value: 'paid', label: 'Paid' },
  { value: 'payment_plan', label: 'Payment Plan' },
  { value: 'contested', label: 'Contested' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'warrant_issued', label: 'Warrant Issued' },
  { value: 'voided', label: 'Voided' },
];

const STATUS_BADGE: Record<string, string> = {
  issued: 'bg-surface-sunken text-rmpg-300 border-border-default',
  paid: 'bg-green-900/50 text-green-300 border-green-700/50',
  payment_plan: 'bg-surface-sunken text-rmpg-300 border-border-default',
  contested: 'bg-amber-900/50 text-amber-300 border-amber-700/50',
  dismissed: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  warrant_issued: 'bg-red-900/60 text-red-300 border-red-700/50',
  voided: 'bg-rmpg-800/50 text-rmpg-500 border-rmpg-700/50',
};

const TYPE_BADGE: Record<string, string> = {
  traffic: 'bg-brand-900/40 text-brand-300 border-brand-700/50',
  criminal: 'bg-red-900/40 text-red-300 border-red-700/50',
  parking: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
  warning: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
};

const US_STATES = [
  'UT','AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','VT','VA','WA','WV','WI','WY',
];

const STATE_OPTIONS: { value: string; label: string }[] = US_STATES.map(s => ({ value: s, label: s }));
const TYPE_FILTER_OPTIONS: { value: CitationType | ''; label: string }[] = [
  { value: '', label: 'All Types' },
  ...CITATION_TYPES.map(t => ({ value: t.value as CitationType | '', label: t.label })),
];
const STATUS_FILTER_OPTIONS: { value: CitationStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  ...CITATION_STATUSES.map(s => ({ value: s.value as CitationStatus | '', label: s.label })),
];
const PAYMENT_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' },
  { value: 'money_order', label: 'Money Order' },
  { value: 'other', label: 'Other' },
];

function normalizeOffenseLevel(s: string | null | undefined): OffenseLevel {
  const t = String(s ?? '').toLowerCase();
  if (t.startsWith('fel')) return 'Felony';
  if (t.startsWith('mis')) return 'Misdemeanor';
  return 'Infraction';
}

async function statuteFetcher(q: string): Promise<StatuteRow[]> {
  if (!q || q.length < 2) return [];
  try {
    const res = await apiFetch<{ data: any[] }>(`/citations/statutes/lookup?q=${encodeURIComponent(q)}`);
    return (res.data || []).map(r => ({
      id: Number(r.id),
      citation_code: String(r.citation_code ?? ''),
      title: String(r.title ?? ''),
      offense_level: String(r.offense_level ?? ''),
      default_fine: Number(r.default_fine) || 0,
      description: String(r.description ?? ''),
    }));
  } catch {
    return [];
  }
}

const EMPTY_FORM: CitationForm = {
  type: 'traffic',
  status: 'issued',
  person_id: '',
  person_name: '',
  person_dob: '',
  person_dl: '',
  person_address: '',
  vehicle_description: '',
  vehicle_plate: '',
  vehicle_state: 'UT',
  statute_id: '',
  statute_citation: '',
  violation_description: '',
  offense_level: '',
  fine_amount: '',
  violation_date: localToday(),
  violation_time: new Date().toTimeString().slice(0, 5),
  location: '',
  issuing_officer_name: '',
  badge_number: '',
  court_date: '',
  court_name: '',
  court_address: '',
  notes: '',
  section_id: '',
  zone_id: '',
  beat_id: '',
  zone_beat: '',
  latitude: null,
  longitude: null,
  vehicle_vin: '',
  vehicle_year: '',
  vehicle_make: '',
  vehicle_model: '',
  vehicle_color: '',
  speed_recorded: '',
  speed_limit: '',
  radar_type: '',
  bac_level: '',
  bond_amount: '',
  bond_type: '',
  is_warning: false,
  school_zone: false,
  construction_zone: false,
  accident_related: false,
  dui_related: false,
  commercial_vehicle: false,
  court_time: '',
  court_room: '',
  appearance_required: false,
};

// formatDate imported from ../utils/dateUtils

function formatCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '--';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Role constants ─────────────────────────────────────────

const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);

// ── Component ──────────────────────────────────────────────

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = parseTimestamp(date).getTime();
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

export default function CitationsPage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin'; // Admin God Mode — unrestricted access
  // canManage: admin / manager / supervisor may create, edit, and void citations
  const canManage = MANAGE_ROLES.has(user?.role ?? '');
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const { sections: sectionOptions, sectionLabels, zoneLabels, zonesForSection, beatsForZone, getBeatLabel } = useDistrictOptions();
  const { identify: identifyDistrict } = useDistrictIdentify();

  // List state
  const [citations, setCitations] = useState<Citation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<CitationType | ''>('');
  const [filterStatus, setFilterStatus] = useState<CitationStatus | ''>('');
  const [stats, setStats] = useState<CitationStats | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Detail state
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Form state
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');
  const [saving, setSaving] = useState(false);
  const [personAddressUnit, setPersonAddressUnit] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const { errors: formErrors, validate: runValidation, clearAllErrors: clearFormErrors } = useFormValidation();

  const {
    form,
    setForm,
    isDirty: formIsDirty,
    wasRestored: formWasRestored,
    clearDraft: clearFormDraft,
    snapshot: snapshotForm,
  } = useFormDraft<CitationForm>({
    storageKey: `rmpg_citation_form_${mode === 'edit' ? (selectedCitation?.id ?? 'new') : 'new'}`,
    defaultValue: EMPTY_FORM,
    isActive: mode !== 'list',
  });

  // Violations (multi-violation authoring)
  const [violations, setViolations] = useState<ViolationDraft[]>(() => [newDraft()]);
  const violationsCleanRef = useRef<string>(JSON.stringify([newDraft()].map(({ id, ...rest }) => rest)));
  const violationsDirty = mode !== 'list'
    && JSON.stringify(violations.map(({ id, ...rest }) => rest)) !== violationsCleanRef.current;

  // Live PDF preview mode (modal / side / full)
  const [previewMode, setPreviewMode] = usePersistedPreviewMode();

  // Duplicate detection
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const dupCheckTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Data completeness
  const [completeness, setCompleteness] = useState<{ score: number; grade: string; missing_required: string[]; missing_recommended: string[] } | null>(null);

  // Payment summary
  const [paymentSummary, setPaymentSummary] = useState<{ payment_count: number; payment_total: number; outstanding_amount: number; collection_rate: number } | null>(null);

  // Payment plan tracking
  const [paymentData, setPaymentData] = useState<{ payments: any[]; total_amount: number; total_paid: number; remaining: number } | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_date: localToday(), payment_method: 'cash', reference_number: '', notes: '' });
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  // Person search state
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<any[]>([]);
  const [personSearching, setPersonSearching] = useState(false);
  const [showPersonDropdown, setShowPersonDropdown] = useState(false);
  const personDropdownRef = useRef<HTMLDivElement>(null);
  const personSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Data fetching ────────────────────────────────────────

  const fetchCitations = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoading(true); setError(''); }
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '50');
      if (filterType) params.set('type', filterType);
      if (filterStatus) params.set('status', filterStatus);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());

      const res = await apiFetch<{ data: Citation[]; pagination: any }>(`/citations?${params}`);
      setCitations(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
    } catch (err: any) {
      if (!options?.silent) setError(err.message || 'Failed to load citations');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [page, filterType, filterStatus, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: CitationStats }>('/citations/stats');
      setStats(res.data);
    } catch {
      // stats are non-critical
    }
  }, []);

  useEffect(() => {
    fetchCitations();
  }, [fetchCitations]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Live sync — auto-refresh when any device modifies citations (silent to avoid unmounting UI)
  const silentRefreshCitations = useCallback(() => fetchCitations({ silent: true }), [fetchCitations]);
  useLiveSync('citations', silentRefreshCitations);

  // Close person dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (personDropdownRef.current && !personDropdownRef.current.contains(e.target as Node)) {
        setShowPersonDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Person search ────────────────────────────────────────

  const handlePersonSearchChange = (val: string) => {
    setPersonSearch(val);
    if (personSearchTimer.current) clearTimeout(personSearchTimer.current);
    if (val.length < 2) {
      setPersonResults([]);
      setShowPersonDropdown(false);
      return;
    }
    setPersonSearching(true);
    personSearchTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch<{ data: any[] }>(`/records/persons/search?q=${encodeURIComponent(val)}&limit=10`);
        setPersonResults(res.data || []);
        setShowPersonDropdown(true);
      } catch {
        setPersonResults([]);
      } finally {
        setPersonSearching(false);
      }
    }, 300);
  };

  const selectPerson = (p: any) => {
    setForm(prev => ({
      ...prev,
      person_id: String(p.id),
      person_name: [p.last_name, p.first_name].filter(Boolean).join(', '),
      person_dob: p.dob || '',
      person_dl: p.dl_number || '',
      person_address: [p.address, p.city, p.state, p.zip].filter(Boolean).join(', '),
    }));
    setPersonSearch([p.last_name, p.first_name].filter(Boolean).join(', '));
    setShowPersonDropdown(false);
  };

  const clearPerson = () => {
    setForm(prev => ({
      ...prev, person_id: '', person_name: '', person_dob: '', person_dl: '', person_address: '',
    }));
    setPersonSearch('');
  };

  // ── Fetch payments when citation selected ──────────────
  useEffect(() => {
    if (!selectedCitation || !selectedCitation.fine_amount) { setPaymentData(null); return; }
    (async () => {
      try {
        const res = await apiFetch<{ data: any }>(`/citations/${selectedCitation.id}/payments`);
        setPaymentData(res.data);
      } catch { setPaymentData(null); }
    })();
  }, [selectedCitation?.id, selectedCitation?.fine_amount]);

  // ── Fetch completeness when citation selected (UPGRADE 39) ──
  useEffect(() => {
    if (!selectedCitation) { setCompleteness(null); return; }
    (async () => {
      try {
        const res = await apiFetch<{ data: any }>(`/citations/${selectedCitation.id}/completeness`);
        setCompleteness(res.data);
      } catch { setCompleteness(null); }
    })();
  }, [selectedCitation?.id]);

  // ── Fetch payment summary on mount (UPGRADE 40) ──
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<{ data: any }>('/citations/payment-summary');
        setPaymentSummary(res.data);
      } catch { setPaymentSummary(null); }
    })();
  }, []);

  const handleRecordPayment = async () => {
    if (!selectedCitation || !paymentForm.amount) return;
    setPaymentSubmitting(true);
    try {
      await apiFetch(`/citations/${selectedCitation.id}/payments`, {
        method: 'POST', body: JSON.stringify(paymentForm),
      });
      // Refresh
      const res = await apiFetch<{ data: any }>(`/citations/${selectedCitation.id}/payments`);
      setPaymentData(res.data);
      setShowPaymentForm(false);
      setPaymentForm({ amount: '', payment_date: localToday(), payment_method: 'cash', reference_number: '', notes: '' });
      fetchCitations({ silent: true }); fetchStats();
    } catch (err: any) { addToast(err.message || 'Failed to record payment', 'error'); }
    finally { setPaymentSubmitting(false); }
  };

  // ── Duplicate detection ─────────────────────────────────
  useEffect(() => {
    if (mode !== 'create' && mode !== 'edit') { setDuplicateWarning(null); return; }
    const name = form.person_name?.trim();
    const statute = form.statute_citation?.trim();
    if (!name || name.length < 3 || !statute || statute.length < 2) { setDuplicateWarning(null); return; }
    if (dupCheckTimer.current) clearTimeout(dupCheckTimer.current);
    dupCheckTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch<{ data: Citation[] }>(`/citations/search?q=${encodeURIComponent(name)}`);
        const matches = (res.data || []).filter(
          c => c.statute_citation?.toLowerCase() === statute.toLowerCase()
            && c.person_name?.toLowerCase().includes(name.toLowerCase())
            && (mode !== 'edit' || c.id !== selectedCitation?.id)
        );
        if (matches.length > 0) {
          const m = matches[0];
          setDuplicateWarning(
            `Similar citation exists for ${m.person_name} — ${m.statute_citation} on ${formatDate(m.violation_date || m.created_at)}`
          );
        } else {
          setDuplicateWarning(null);
        }
      } catch { setDuplicateWarning(null); }
    }, 500);
    return () => { if (dupCheckTimer.current) clearTimeout(dupCheckTimer.current); };
  }, [form.person_name, form.statute_citation, mode, selectedCitation?.id]);

  // ── Statute lookup ───────────────────────────────────────

  const handleStatuteSelect = (statute: StatuteResult) => {
    setForm(prev => ({
      ...prev,
      statute_id: String(statute.id),
      statute_citation: statute.citation,
      violation_description: prev.violation_description || statute.short_title,
      offense_level: statute.offense_level || prev.offense_level,
      fine_amount: statute.citation_fine ? String(statute.citation_fine) : prev.fine_amount,
    }));
  };

  const clearStatute = () => {
    setForm(prev => ({ ...prev, statute_id: '', statute_citation: '', offense_level: '' }));
  };

  // ── Form helpers ─────────────────────────────────────────

  const updateField = (key: keyof CitationForm, value: any) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      // Auto-compute zone_beat when zone or beat changes
      if (key === 'zone_id' || key === 'beat_id') {
        const z = key === 'zone_id' ? value : prev.zone_id;
        const b = key === 'beat_id' ? value : prev.beat_id;
        next.zone_beat = (z && b) ? `${z}-${b}` : '';
      }
      return next;
    });
  };

  const snapshotViolations = (next: ViolationDraft[]) => {
    violationsCleanRef.current = JSON.stringify(next.map(({ id, ...rest }) => rest));
  };

  const handleNewCitation = () => {
    setForm({
      ...EMPTY_FORM,
      violation_date: localToday(),
      violation_time: new Date().toTimeString().slice(0, 5),
      issuing_officer_name: (user as any)?.full_name || (user as any)?.username || '',
      badge_number: (user as any)?.badge_number || '',
    });
    const initialViolations = [newDraft()];
    setViolations(initialViolations);
    snapshotViolations(initialViolations);
    setPersonSearch('');
    setSaveError('');
    setSaveSuccess(false);
    clearFormErrors();
    snapshotForm();
    setMode('create');
    setSelectedCitation(null);
  };

  const handleEditCitation = async (c: Citation) => {
    // Fetch full record (includes violations[]) before populating form.
    // Falls back to the row-only data if /full fails — form still usable.
    let full: any = c;
    let serverViolations: any[] = [];
    try {
      const res = await apiFetch<any>(`/citations/${c.id}/full`);
      full = res || c;
      serverViolations = Array.isArray(res?.violations) ? res.violations : [];
    } catch { /* fall back to row */ }
    const rehydrated: ViolationDraft[] = serverViolations.length > 0
      ? serverViolations.map((sv: any) => {
          const base = newDraft();
          return {
            id: base.id,
            statute_id: sv.statute_id != null ? Number(sv.statute_id) : undefined,
            statute_citation: String(sv.statute_citation ?? ''),
            description: String(sv.violation_description ?? sv.description ?? ''),
            offense_level: normalizeOffenseLevel(sv.offense_level),
            fine_amount: Number(sv.fine_amount) || 0,
          };
        })
      : [{
          ...newDraft(),
          statute_id: full.statute_id != null ? Number(full.statute_id) : undefined,
          statute_citation: full.statute_citation || '',
          description: full.violation_description || '',
          offense_level: normalizeOffenseLevel(full.offense_level),
          fine_amount: Number(full.fine_amount) || 0,
        }];
    setViolations(rehydrated);
    snapshotViolations(rehydrated);
    const c0: Citation = full as Citation;
    setForm({
      type: c0.type,
      status: c0.status,
      person_id: c0.person_id ? String(c0.person_id) : '',
      person_name: c0.person_name || '',
      person_dob: c0.person_dob || '',
      person_dl: c0.person_dl || '',
      person_address: c0.person_address || '',
      vehicle_description: c0.vehicle_description || '',
      vehicle_plate: c0.vehicle_plate || '',
      vehicle_state: c0.vehicle_state || 'UT',
      statute_id: c0.statute_id ? String(c0.statute_id) : '',
      statute_citation: c0.statute_citation || '',
      violation_description: c0.violation_description || '',
      offense_level: c0.offense_level || '',
      fine_amount: c0.fine_amount != null ? String(c0.fine_amount) : '',
      violation_date: c0.violation_date || '',
      violation_time: c0.violation_time || '',
      location: c0.location || '',
      issuing_officer_name: c0.issuing_officer_name || '',
      badge_number: c0.badge_number || '',
      court_date: c0.court_date || '',
      court_name: c0.court_name || '',
      court_address: c0.court_address || '',
      notes: c0.notes || '',
      section_id: c0.section_id || '',
      zone_id: c0.zone_id || '',
      beat_id: c0.beat_id || '',
      zone_beat: c0.zone_beat || '',
      latitude: c0.latitude ?? null,
      longitude: c0.longitude ?? null,
      vehicle_vin: (c0 as any).vehicle_vin || '',
      vehicle_year: (c0 as any).vehicle_year || '',
      vehicle_make: (c0 as any).vehicle_make || '',
      vehicle_model: (c0 as any).vehicle_model || '',
      vehicle_color: (c0 as any).vehicle_color || '',
      speed_recorded: (c0 as any).speed_recorded != null ? String((c0 as any).speed_recorded) : '',
      speed_limit: (c0 as any).speed_limit != null ? String((c0 as any).speed_limit) : '',
      radar_type: (c0 as any).radar_type || '',
      bac_level: (c0 as any).bac_level != null ? String((c0 as any).bac_level) : '',
      bond_amount: (c0 as any).bond_amount != null ? String((c0 as any).bond_amount) : '',
      bond_type: (c0 as any).bond_type || '',
      is_warning: !!(c0 as any).is_warning,
      school_zone: !!(c0 as any).school_zone,
      construction_zone: !!(c0 as any).construction_zone,
      accident_related: !!(c0 as any).accident_related,
      dui_related: !!(c0 as any).dui_related,
      commercial_vehicle: !!(c0 as any).commercial_vehicle,
      court_time: (c0 as any).court_time || '',
      court_room: (c0 as any).court_room || '',
      appearance_required: !!(c0 as any).appearance_required,
    });
    setPersonSearch(c0.person_name || '');
    setSaveError('');
    setSaveSuccess(false);
    clearFormErrors();
    snapshotForm();
    setMode('edit');
  };

  const handleCancelForm = () => {
    setMode('list');
    clearFormErrors();
    clearFormDraft();
    setSaveError('');
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    const isValid = runValidation(form, {
      violation_description: { required: true, minLength: 3 },
      violation_date: { required: true, custom: isValidDate, customMessage: 'Valid date required' },
      person_name: { required: true },
      vehicle_plate: { custom: (v) => !v || isValidPlate(v), customMessage: 'Invalid plate format (2–8 alphanumeric)' },
      vehicle_state: { custom: (v) => !v || isValidState(v), customMessage: 'Invalid US state abbreviation' },
    });
    if (!isValid) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);

    try {
      // Strip client-side draft ids; server expects {statute_id?, statute_citation,
      // description, offense_level, fine_amount}. Server back-fills the flat
      // statute_citation/violation_description/offense_level/fine_amount columns
      // from violations[0] on POST (see legacy/server-vps/src/routes/citations.ts),
      // so we still send the form's flat fields too for back-compat.
      const violationsPayload = violations
        .filter(v => v.statute_citation.trim() || v.description.trim() || v.fine_amount > 0)
        .map(({ id: _id, ...rest }) => rest);
      const payload: any = {
        ...form,
        person_address: composeAddressUnit(form.person_address, personAddressUnit),
        person_id: form.person_id ? parseInt(form.person_id, 10) : null,
        statute_id: form.statute_id ? parseInt(form.statute_id, 10) : null,
        fine_amount: form.fine_amount ? parseFloat(form.fine_amount) : null,
        issuing_officer_id: (user as any)?.userId || null,
        violations: violationsPayload,
      };

      if (mode === 'create') {
        const res = await apiFetch<{ data: Citation }>('/citations', { method: 'POST', body: JSON.stringify(payload) });
        setSelectedCitation(res.data);
        setSaveSuccess(true);
        snapshotViolations(violations);
        clearFormDraft();
        setTimeout(() => {
          setMode('list');
          setSaveSuccess(false);
          fetchCitations({ silent: true });
          fetchStats();
        }, 1200);
      } else if (mode === 'edit' && selectedCitation) {
        const res = await apiFetch<{ data: Citation }>(`/citations/${selectedCitation.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        setSelectedCitation(res.data);
        setSaveSuccess(true);
        snapshotViolations(violations);
        clearFormDraft();
        setTimeout(() => {
          setMode('list');
          setSaveSuccess(false);
          fetchCitations({ silent: true });
          fetchStats();
        }, 1200);
      }
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save citation');
    } finally {
      setSaving(false);
    }
  };

  // ── Void ─────────────────────────────────────────────────
  // Native window.confirm() removed — replaced with the in-app ConfirmDialog
  // for a11y, keyboard polish, and visual consistency with every other
  // destructive flow (Field Interviews #1597, Evidence #1603, Cases #1604).
  const [voidTarget, setVoidTarget] = useState<Citation | null>(null);
  const [voiding, setVoiding] = useState(false);

  const handleVoid = (c: Citation) => {
    setVoidTarget(c);
  };

  const confirmVoid = async () => {
    if (!voidTarget) return;
    setVoiding(true);
    try {
      await apiFetch(`/citations/${voidTarget.id}`, { method: 'DELETE' });
      fetchCitations({ silent: true });
      fetchStats();
      if (selectedCitation?.id === voidTarget.id) setSelectedCitation(null);
      setVoidTarget(null);
    } catch (err: any) {
      addToast(err.message || 'Failed to void citation', 'error');
    } finally {
      setVoiding(false);
    }
  };

  // ── Select citation ──────────────────────────────────────

  const handleSelectCitation = async (c: Citation) => {
    if (mode !== 'list') return;
    setDetailLoading(true);
    try {
      const res = await apiFetch<{ data: Citation }>(`/citations/${c.id}`);
      setSelectedCitation(res.data);
    } catch {
      setSelectedCitation(c);
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Right-click context menu ─────────────────────────────

  const buildCitationMenu = (c: Citation): ContextMenuItem[] => [
    m.action('Open citation', () => handleSelectCitation(c), { icon: <Eye size={12} /> }),
    ...(canManage ? [m.action('Edit citation', () => handleEditCitation(c), { icon: <Pencil size={12} /> })] : []),
    m.separator(),
    ...(canManage && c.status !== 'voided'
      ? [m.action('Void citation', () => handleVoid(c), { icon: <Ban size={12} />, danger: true })]
      : []),
    m.separator(),
    m.copy('Copy citation #', c.citation_number, <Copy size={12} />),
    m.copy('Copy violator', c.person_name),
    m.copyId(c.id),
    ...(c.vehicle_plate
      ? [m.go('View plate history', `/intel/plate-log?plate=${encodeURIComponent(c.vehicle_plate)}`, <ExternalLink size={12} />)]
      : []),
    ...(c.latitude != null && c.longitude != null
      ? [m.go('Show on map', `/map?flyto=${c.latitude},${c.longitude}`, <MapPin size={12} />)]
      : []),
  ];

  // ── Statute category filter based on citation type ───────

  const statuteCategoryFilter = form.type === 'traffic' || form.type === 'parking' ? 'vehicle' as const : undefined;

  // ============================================================
  // Stats bar
  // ============================================================

  const renderStatsBar = () => {
    if (!stats) return null;
    return (
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-brand-900/30 text-brand-300 border-brand-700/50">
          <Hash size={10} /> {stats.total} Total
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-surface-sunken text-rmpg-300 border-border-default">
          <FileWarning size={10} /> {stats.by_status?.issued || 0} Issued
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-green-900/30 text-green-300 border-green-700/50">
          <Check size={10} /> {stats.by_status?.paid || 0} Paid
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-amber-900/30 text-amber-300 border-amber-700/50">
          <AlertTriangle size={10} /> {stats.by_status?.contested || 0} Contested
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-red-900/30 text-red-300 border-red-700/50">
          <Scale size={10} /> {stats.by_status?.warrant_issued || 0} Warrant
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-green-900/20 text-green-400 border-green-700/40">
          <DollarSign size={10} /> Collected: {formatCurrency(stats.fines_collected)}
        </span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-rmpg-800/40 text-rmpg-300 border-rmpg-600/50">
          <Clock size={10} /> Today: {stats.today_count}
        </span>
        {paymentSummary && paymentSummary.collection_rate > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase border panel-beveled bg-brand-900/20 text-brand-400 border-brand-700/40">
            <Check size={10} /> Collection: {paymentSummary.collection_rate}%
          </span>
        )}
      </div>
    );
  };

  // ============================================================
  // Left panel: list
  // ============================================================

  const renderListPanel = () => (
    <>
      {/* Search & filters header */}
      <div className="p-3 border-b border-rmpg-700 space-y-2">
        <div className={`flex items-center gap-2 ${isMobile ? 'flex-col' : ''}`}>
          <div className={`relative ${isMobile ? 'w-full' : 'flex-1'}`}>
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-rmpg-400" />
            <input id="ff-citationspage-0"
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Search citations..." aria-label="Search citations"
              autoComplete="off"
              className={`input-dark w-full pl-8 pr-3 ${isMobile ? 'py-2.5 text-sm' : 'py-1.5 text-xs'}`}
              style={isMobile ? { minHeight: 44 } : undefined}
            />
          </div>
          <div className={`flex items-center gap-2 ${isMobile ? 'w-full' : ''}`}>
            {canManage && (
            <button type="button" onClick={handleNewCitation} className={`toolbar-btn toolbar-btn-primary ${isMobile ? 'flex-1 justify-center' : ''}`} title="New Citation" style={isMobile ? { minHeight: 48 } : undefined}>
              <Plus size={isMobile ? 16 : 12} /> New
            </button>
            )}
            <ExportButton exportUrl="/citations/export/csv" exportFilename="citations.csv" />
            <button type="button" onClick={() => { fetchCitations(); fetchStats(); }} className="text-rmpg-400 hover:text-rmpg-200 p-1 transition-colors" title="Refresh" style={isMobile ? { minHeight: 48, minWidth: 48 } : undefined}>
              <RefreshCw size={isMobile ? 18 : 14} />
            </button>
          </div>
        </div>
        {/* Filter row */}
        <div className={`flex items-center ${isMobile ? 'flex-col gap-1.5' : 'gap-2 flex-wrap'}`}>
          {!isMobile && <Filter size={10} className="text-rmpg-500" />}
          <div className={isMobile ? 'w-full' : 'min-w-[140px]'}>
            <Combobox<{ value: CitationType | ''; label: string }>
              value={TYPE_FILTER_OPTIONS.find(o => o.value === filterType) ?? null}
              onChange={(opt) => { setFilterType((opt?.value ?? '') as any); setPage(1); }}
              options={TYPE_FILTER_OPTIONS}
              getLabel={(o) => o.label}
              getKey={(o) => o.value || '__all__'}
              placeholder="All Types"
            />
          </div>
          <div className={isMobile ? 'w-full' : 'min-w-[160px]'}>
            <Combobox<{ value: CitationStatus | ''; label: string }>
              value={STATUS_FILTER_OPTIONS.find(o => o.value === filterStatus) ?? null}
              onChange={(opt) => { setFilterStatus((opt?.value ?? '') as any); setPage(1); }}
              options={STATUS_FILTER_OPTIONS}
              getLabel={(o) => o.label}
              getKey={(o) => o.value || '__all__'}
              placeholder="All Statuses"
            />
          </div>
        </div>
      </div>

      {/* List body */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent" style={{ overscrollBehavior: 'contain' }}>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Loader2 size={20} className="animate-spin text-brand-400" role="status" aria-label="Loading" />
            <span className="text-[10px] text-rmpg-500">Loading citations...</span>
          </div>
        ) : error ? (
          <div className="p-4 text-xs text-red-400 flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        ) : citations.length === 0 ? (
          // Empty-state distinction: "search/filter returned zero" vs
          // "nothing on file at all". Operators were confused on a clean
          // install with no citations whether the page was broken or just
          // empty.
          (() => {
            const isFiltered = !!(searchQuery.trim() || filterType || filterStatus);
            return (
              <div className="flex flex-col items-center justify-center py-12 text-rmpg-500">
                <FileWarning size={28} className="mb-2 opacity-40" />
                {isFiltered ? (
                  <>
                    <p className="text-xs font-medium">No citations match your filters</p>
                    <p className="text-[10px] text-rmpg-600 mt-1">Try adjusting the search or status filter</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-medium">No citations on file</p>
                    <p className="text-[10px] text-rmpg-600 mt-1">Press N or click New to create the first one</p>
                  </>
                )}
              </div>
            );
          })()
        ) : (
          citations.map(c => (
            <button type="button"
              key={c.id}
              onClick={() => handleSelectCitation(c)}
              onContextMenu={(e) => openMenu(e, buildCitationMenu(c))}
              className={`w-full text-left px-3 ${isMobile ? 'py-3' : 'py-2'} border-b border-rmpg-700/50 hover:bg-rmpg-700/20 transition-colors ${
                selectedCitation?.id === c.id && mode === 'list' ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : ''
              }`}
              style={isMobile ? { minHeight: 56 } : undefined}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[11px] font-mono font-bold text-rmpg-100">{c.citation_number}</span>
                <span className={`inline-flex items-center px-1.5 py-0 text-[9px] font-bold uppercase border panel-beveled ${STATUS_BADGE[c.status] || ''}`}>
                  {toDisplayLabel(c.status).toUpperCase()}
                </span>
                <span className={`inline-flex items-center px-1.5 py-0 text-[9px] font-bold uppercase border panel-beveled ${TYPE_BADGE[c.type] || ''}`}>
                  {toDisplayLabel(c.type)}
                </span>
                <span className="text-[10px] text-rmpg-500 ml-auto">{formatDate(c.violation_date)}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                {c.person_name && <span className="text-rmpg-300">{c.person_name}</span>}
                {c.statute_citation && <span className="text-rmpg-500 font-mono">{c.statute_citation}</span>}
              </div>
              {c.violation_description && (
                <p className="text-[10px] text-rmpg-400 truncate mt-0.5">{c.violation_description}</p>
              )}
            </button>
          ))
        )}
      </div>

      {/* Pagination */}
      <div className={`flex items-center justify-between px-3 py-2 border-t border-rmpg-700 ${isMobile ? 'text-xs' : 'text-[10px]'} text-rmpg-400`}>
        {totalPages > 1 ? (
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="hover:text-rmpg-200 disabled:opacity-30" style={isMobile ? { minHeight: 48, minWidth: 48 } : undefined}>
            Prev
          </button>
        ) : <span />}
        <span>Page {page} of {totalPages}</span>
        {totalPages > 1 ? (
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="hover:text-rmpg-200 disabled:opacity-30" style={isMobile ? { minHeight: 48, minWidth: 48 } : undefined}>
            Next
          </button>
        ) : <span />}
      </div>
    </>
  );

  // ============================================================
  // Detail view
  // ============================================================

  const renderDetailView = () => {
    if (!selectedCitation) return null;
    const c = selectedCitation;

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-rmpg-700">
          <Hash size={14} className="text-rmpg-400" />
          <h2 className="text-sm font-mono font-bold text-rmpg-100">{c.citation_number}</h2>
          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase border panel-beveled ${STATUS_BADGE[c.status] || ''}`}>
            {toDisplayLabel(c.status).toUpperCase()}
          </span>
          <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase border panel-beveled ${TYPE_BADGE[c.type] || ''}`}>
            {toDisplayLabel(c.type)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <PrintRecordButton
              recordType="citation"
              recordData={{
                id: c.id,
                citation_number: c.citation_number,
                type: c.type,
                status: c.status,
                person_name: c.person_name || undefined,
                person_dob: c.person_dob || undefined,
                person_dl: c.person_dl || undefined,
                person_address: c.person_address || undefined,
                vehicle_description: c.vehicle_description || undefined,
                vehicle_plate: c.vehicle_plate || undefined,
                vehicle_state: c.vehicle_state || undefined,
                statute_citation: c.statute_citation || undefined,
                violation_description: c.violation_description || undefined,
                offense_level: c.offense_level || undefined,
                fine_amount: c.fine_amount ?? undefined,
                violation_date: c.violation_date || undefined,
                violation_time: c.violation_time || undefined,
                location: c.location || undefined,
                issuing_officer_name: c.issuing_officer_name || undefined,
                badge_number: c.badge_number || undefined,
                court_date: c.court_date || undefined,
                court_name: c.court_name || undefined,
                court_address: c.court_address || undefined,
                notes: c.notes || undefined,
                created_at: c.created_at,
                updated_at: c.updated_at,
              } as CitationPdfData}
              identifier={c.citation_number}
              entityType="citation"
              entityId={c.id}
              iconOnly
            />
            {canManage && (
            <button type="button" onClick={() => handleEditCitation(c)} className="toolbar-btn text-[10px]">
              <FileText size={12} /> Edit
            </button>
            )}
            {canManage && (c.status !== 'voided' || isAdmin) && (
              <button type="button" onClick={() => handleVoid(c)} className="toolbar-btn text-[10px] text-red-400 hover:text-red-300">
                <Ban size={12} /> {c.status === 'voided' && isAdmin ? 'Un-Void' : 'Void'}
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent p-4 space-y-4">
          {/* Violation */}
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1">
              <Scale size={10} className="text-[var(--brand-gold)]" /> Violation
            </h3>
            <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
              {c.statute_citation && (
                <div><span className="text-rmpg-400">Statute:</span> <span className="text-rmpg-200 font-mono">{c.statute_citation}</span></div>
              )}
              {c.violation_description && (
                <div><span className="text-rmpg-400">Description:</span> <span className="text-rmpg-200">{c.violation_description}</span></div>
              )}
              {c.offense_level && (
                <div className="flex items-center gap-2">
                  <span className="text-rmpg-400">Offense Level:</span>
                  <span className={`inline-flex px-1.5 py-0.5 text-[9px] font-bold uppercase rounded-sm border ${
                    c.offense_level === 'felony' ? 'bg-red-900/50 text-red-400 border-red-700/50' :
                    c.offense_level === 'misdemeanor' ? 'bg-amber-900/50 text-amber-400 border-amber-700/50' :
                    'bg-surface-sunken text-rmpg-400 border-border-default'
                  }`}>{toDisplayLabel(c.offense_level)}</span>
                </div>
              )}
              {c.fine_amount != null && (
                <div><span className="text-rmpg-400">Fine:</span> <span className="text-green-400 font-bold">{formatCurrency(c.fine_amount)}</span></div>
              )}
            </div>
          </section>

          {/* Payment Plan Tracking */}
          {c.fine_amount != null && c.fine_amount > 0 && paymentData && (
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1">
                <DollarSign size={10} className="text-[var(--brand-gold)]" /> Payment Tracking
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-2">
                <div className="flex items-center gap-4 text-xs">
                  <div><span className="text-rmpg-400">Total:</span> <span className="text-rmpg-200 font-bold">{formatCurrency(paymentData.total_amount)}</span></div>
                  <div><span className="text-rmpg-400">Paid:</span> <span className="text-green-400 font-bold">{formatCurrency(paymentData.total_paid)}</span></div>
                  <div><span className="text-rmpg-400">Remaining:</span> <span className="text-amber-400 font-bold">{formatCurrency(paymentData.remaining)}</span></div>
                </div>
                {paymentData.total_amount > 0 && (
                  <div className="h-1.5 bg-rmpg-700 rounded-sm overflow-hidden">
                    <div className="h-full bg-green-500 transition-all" style={{ width: `${Math.min(100, (paymentData.total_paid / paymentData.total_amount) * 100)}%` }} />
                  </div>
                )}
                {paymentData.payments.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {paymentData.payments.map((p: any) => (
                      <div key={p.id} className="flex items-center gap-2 text-[10px] border-b border-rmpg-800/30 pb-1">
                        <span className="text-rmpg-500">{formatDate(p.payment_date)}</span>
                        <span className="text-green-400 font-bold">{formatCurrency(p.amount)}</span>
                        {p.payment_method && <span className="text-rmpg-500 capitalize">{formatEnumValue(p.payment_method)}</span>}
                        {p.reference_number && <span className="text-rmpg-500 font-mono">{p.reference_number}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {!showPaymentForm ? (
                  <button type="button" onClick={() => setShowPaymentForm(true)} className="toolbar-btn text-[10px] mt-1">
                    <Plus size={10} /> Record Payment
                  </button>
                ) : (
                  <div className="space-y-2 mt-2 p-2 border border-rmpg-700 bg-surface-sunken">
                    <div className="grid grid-cols-2 gap-2">
                      <div><label htmlFor="ff-citationspage-3" className="text-[9px] text-rmpg-400 uppercase">Amount *</label>
                        <input id="ff-citationspage-3" type="number" step="0.01" className="input-dark text-xs w-full min-h-[36px]" value={paymentForm.amount} onChange={e => setPaymentForm(p => ({ ...p, amount: e.target.value }))} /></div>
                      <div><label htmlFor="ff-citationspage-4" className="text-[9px] text-rmpg-400 uppercase">Date *</label>
                        <input id="ff-citationspage-4" type="date" className="input-dark text-xs w-full min-h-[36px]" value={paymentForm.payment_date} onChange={e => setPaymentForm(p => ({ ...p, payment_date: e.target.value }))} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-[9px] text-rmpg-400 uppercase">Method</label>
                        <Combobox<{ value: string; label: string }>
                          value={PAYMENT_METHOD_OPTIONS.find(o => o.value === paymentForm.payment_method) ?? null}
                          onChange={(opt) => setPaymentForm(p => ({ ...p, payment_method: opt?.value || 'cash' }))}
                          options={PAYMENT_METHOD_OPTIONS}
                          getLabel={(o) => o.label}
                          getKey={(o) => o.value}
                          placeholder="Method"
                        /></div>
                      <div><label htmlFor="ff-citationspage-6" className="text-[9px] text-rmpg-400 uppercase">Reference #</label>
                        <input id="ff-citationspage-6" className="input-dark text-xs w-full min-h-[36px]" value={paymentForm.reference_number} onChange={e => setPaymentForm(p => ({ ...p, reference_number: e.target.value }))} /></div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleRecordPayment} disabled={paymentSubmitting || !paymentForm.amount} className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1">
                        {paymentSubmitting ? 'Saving...' : 'Save Payment'}
                      </button>
                      <button type="button" onClick={() => setShowPaymentForm(false)} className="toolbar-btn text-[10px]">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Data Completeness (UPGRADE 41) */}
          {completeness && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-rmpg-400 font-bold mb-2 flex items-center gap-1">
                <Check size={10} /> Data Completeness
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className={`text-sm font-bold px-2 py-0.5 rounded ${completeness.grade === 'A' ? 'bg-green-900/50 text-green-400' : completeness.grade === 'B' ? 'bg-surface-sunken text-rmpg-400' : completeness.grade === 'C' ? 'bg-amber-900/50 text-amber-400' : 'bg-red-900/50 text-red-400'}`}>{completeness.grade}</div>
                  <div className="flex-1 h-1.5 bg-rmpg-700 rounded-sm overflow-hidden">
                    <div className={`h-full transition-all ${completeness.score >= 80 ? 'bg-green-500' : completeness.score >= 60 ? 'bg-rmpg-500' : completeness.score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${completeness.score}%` }} />
                  </div>
                  <span className="text-[10px] text-rmpg-400">{completeness.score}%</span>
                </div>
                {completeness.missing_required.length > 0 && (
                  <div className="text-[10px] text-amber-400">Missing: {completeness.missing_required.join(', ')}</div>
                )}
              </div>
            </section>
          )}

          {/* Subject */}
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1">
              <User size={10} /> Subject
            </h3>
            <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
              {c.person_name && <div><span className="text-rmpg-400">Name:</span> <span className="text-rmpg-200">{c.person_name}</span></div>}
              {c.person_dob && <div><span className="text-rmpg-400">DOB:</span> <span className="text-rmpg-200">{formatDate(c.person_dob)}</span></div>}
              {c.person_dl && <div><span className="text-rmpg-400">DL#:</span> <span className="text-rmpg-200 font-mono">{c.person_dl}</span></div>}
              {c.person_address && <div><span className="text-rmpg-400">Address:</span> <span className="text-rmpg-200">{c.person_address}</span></div>}
            </div>
          </section>

          {/* Vehicle */}
          {(c.vehicle_description || c.vehicle_plate) && (
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1">
                <Car size={10} /> Vehicle
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
                {c.vehicle_description && <div><span className="text-rmpg-400">Description:</span> <span className="text-rmpg-200">{c.vehicle_description}</span></div>}
                {c.vehicle_plate && (
                  <div className="flex items-center gap-2">
                    <span className="text-rmpg-400">Plate:</span>
                    <span className="text-rmpg-200 font-mono">{c.vehicle_plate}</span>
                    <span className="text-rmpg-500">({c.vehicle_state || 'UT'})</span>
                    <button
                      type="button"
                      onClick={() => navigate(`/intel/plate-log?plate=${encodeURIComponent(c.vehicle_plate!)}`)}
                      className="inline-flex items-center gap-0.5 text-[9px] text-brand-400 hover:text-brand-300 transition-colors"
                      title="View plate history in Plate Log"
                    >
                      <ExternalLink size={9} /> ALPR
                    </button>
                  </div>
                )}
                {(c as any).vehicle_vin && <div><span className="text-rmpg-400">VIN:</span> <span className="text-rmpg-200 font-mono">{(c as any).vehicle_vin}</span></div>}
                {((c as any).vehicle_year || (c as any).vehicle_make) && (
                  <div>
                    <span className="text-rmpg-400">Vehicle:</span>{' '}
                    <span className="text-rmpg-200">{[(c as any).vehicle_year, (c as any).vehicle_make, (c as any).vehicle_model].filter(Boolean).join(' ')}</span>
                    {(c as any).vehicle_color && <span className="text-rmpg-400 ml-2">({(c as any).vehicle_color})</span>}
                  </div>
                )}
                {(c as any).commercial_vehicle ? <span className="text-[8px] font-bold text-amber-400 bg-amber-900/30 px-1.5 py-0.5 border border-amber-700/30">COMMERCIAL VEHICLE</span> : null}
              </div>
            </section>
          )}

          {/* Traffic / Speed Details */}
          {(c.type === 'traffic' || (c as any).speed_recorded || (c as any).bac_level || (c as any).dui_related) && (
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1">
                <Zap size={10} className="text-[var(--brand-gold)]" /> Traffic Details
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
                {(c as any).speed_recorded && (
                  <div className="flex items-center gap-2">
                    <span className="text-rmpg-400">Speed:</span>
                    <span className="text-red-400 font-bold font-mono text-sm">{(c as any).speed_recorded} MPH</span>
                    {(c as any).speed_limit && <span className="text-rmpg-400">in a <span className="text-rmpg-100 font-bold">{(c as any).speed_limit} MPH</span> zone</span>}
                    {(c as any).speed_recorded && (c as any).speed_limit && (
                      <span className="text-[9px] font-bold text-red-400">({(c as any).speed_recorded - (c as any).speed_limit} over)</span>
                    )}
                  </div>
                )}
                {(c as any).radar_type && <div><span className="text-rmpg-400">Radar/LIDAR:</span> <span className="text-rmpg-200">{(c as any).radar_type}</span></div>}
                {(() => {
                  // bac_level may arrive as a sentinel string ("0.08"/"None") from
                  // live D1 — coerce before .toFixed() or the detail view crashes.
                  const bac = toNum((c as any).bac_level);
                  if (bac == null || bac <= 0) return null;
                  return <div><span className="text-rmpg-400">BAC Level:</span> <span className={`font-bold font-mono ${bac >= 0.08 ? 'text-red-400' : 'text-amber-400'}`}>{bac.toFixed(3)}%</span></div>;
                })()}
                <div className="flex flex-wrap gap-2 mt-1">
                  {(c as any).school_zone ? <span className="text-[8px] font-bold text-amber-400 bg-amber-900/30 px-1.5 py-0.5 border border-amber-700/30">SCHOOL ZONE</span> : null}
                  {(c as any).construction_zone ? <span className="text-[8px] font-bold text-orange-400 bg-orange-900/30 px-1.5 py-0.5 border border-orange-700/30">CONSTRUCTION ZONE</span> : null}
                  {(c as any).accident_related ? <span className="text-[8px] font-bold text-red-400 bg-red-900/30 px-1.5 py-0.5 border border-red-700/30">ACCIDENT RELATED</span> : null}
                  {(c as any).dui_related ? <span className="text-[8px] font-bold text-red-400 bg-red-900/30 px-1.5 py-0.5 border border-red-700/30">DUI RELATED</span> : null}
                  {(c as any).is_warning ? <span className="text-[8px] font-bold text-rmpg-400 bg-surface-sunken px-1.5 py-0.5 border border-border-subtle">WARNING ONLY</span> : null}
                  {(c as any).is_equipment_violation ? <span className="text-[8px] font-bold text-rmpg-400 bg-surface-sunken/30 px-1.5 py-0.5 border border-border-subtle">EQUIPMENT VIOLATION</span> : null}
                </div>
              </div>
            </section>
          )}

          {/* Bond / Bail */}
          {((c as any).bond_amount > 0 || (c as any).appearance_required) && (
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1">
                <Lock size={10} className="text-[var(--brand-gold)]" /> Bond / Bail
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
                {(c as any).bond_amount > 0 && <div><span className="text-rmpg-400">Bond Amount:</span> <span className="text-green-400 font-bold font-mono">${Number((c as any).bond_amount).toLocaleString()}</span></div>}
                {(c as any).bond_type && <div><span className="text-rmpg-400">Bond Type:</span> <span className="text-rmpg-200 capitalize">{(c as any).bond_type}</span></div>}
                {(c as any).appearance_required ? <span className="text-[9px] font-bold text-red-400 bg-red-900/20 px-2 py-1 border border-red-700/30">COURT APPEARANCE REQUIRED</span> : null}
              </div>
            </section>
          )}

          {/* Case Disposition */}
          {((c as any).plea || (c as any).verdict || (c as any).sentence) && (
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1">
                <Gavel size={10} className="text-[var(--brand-gold)]" /> Case Disposition
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
                {(c as any).plea && <div><span className="text-rmpg-400">Plea:</span> <span className="text-rmpg-200 capitalize">{(c as any).plea}</span></div>}
                {(c as any).verdict && <div><span className="text-rmpg-400">Verdict:</span> <span className={`font-bold capitalize ${(c as any).verdict === 'guilty' ? 'text-red-400' : (c as any).verdict === 'not_guilty' ? 'text-green-400' : 'text-rmpg-200'}`}>{toDisplayLabel((c as any).verdict)}</span></div>}
                {(c as any).sentence && <div><span className="text-rmpg-400">Sentence:</span> <span className="text-rmpg-200">{(c as any).sentence}</span></div>}
                {(c as any).disposition_date && <div><span className="text-rmpg-400">Disposition Date:</span> <span className="text-rmpg-200">{formatDate((c as any).disposition_date)}</span></div>}
              </div>
            </section>
          )}

          {/* Location & Time */}
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1">
              <MapPin size={10} /> Location & Time
            </h3>
            <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
              <div><span className="text-rmpg-400">Date:</span> <span className="text-rmpg-200">{formatDate(c.violation_date)}</span></div>
              {c.violation_time && <div><span className="text-rmpg-400">Time:</span> <span className="text-rmpg-200">{c.violation_time}</span></div>}
              {c.location && <div><span className="text-rmpg-400">Location:</span> <span className="text-rmpg-200">{formatAddressDisplay(c.location)}</span></div>}
              {(c.section_id || c.zone_id || c.beat_id) && (
                <div><span className="text-rmpg-400">S/Z/B:</span> <span className="text-rmpg-200 font-mono">{c.section_id || '—'} / {c.zone_id || '—'} / {c.beat_id || '—'}</span></div>
              )}
            </div>
          </section>

          {/* Officer */}
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1">
              <User size={10} /> Issuing Officer
            </h3>
            <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
              {c.issuing_officer_name && <div><span className="text-rmpg-400">Officer:</span> <span className="text-rmpg-200">{c.issuing_officer_name}</span></div>}
              {c.badge_number && <div><span className="text-rmpg-400">Badge:</span> <span className="text-rmpg-200 font-mono">{c.badge_number}</span></div>}
            </div>
          </section>

          {/* Court */}
          {(c.court_date || c.court_name) && (
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1">
                <Scale size={10} /> Court Information
                <button
                  type="button"
                  onClick={() => navigate('/court')}
                  className="ml-auto inline-flex items-center gap-0.5 text-[9px] text-brand-400 hover:text-brand-300 transition-colors font-normal normal-case tracking-normal"
                  title="Open Court Tracker"
                >
                  <ExternalLink size={9} /> Court Tracker
                </button>
              </h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 space-y-1.5 text-xs">
                {c.court_date && (() => {
                  const daysUntil = Math.ceil((parseTimestamp(c.court_date).getTime() - Date.now()) / 86400000);
                  // Semantic severity tokens — re-themes between day/night
                  // automatically (uses semantic sev-* tokens, not raw hex).
                  const cdColor = daysUntil < 0
                    ? 'rgb(var(--sev-critical-rgb))'
                    : daysUntil <= 7
                      ? 'rgb(var(--sev-high-rgb))'
                      : daysUntil <= 30
                        ? 'rgb(var(--sev-caution-rgb))'
                        : 'rgb(var(--sev-ok-rgb))';
                  const cdLabel = daysUntil < 0 ? `${Math.abs(daysUntil)}d overdue` : daysUntil === 0 ? 'TODAY' : `${daysUntil}d away`;
                  return (
                    <div className="flex items-center gap-2">
                      <span className="text-rmpg-400">Court Date:</span>
                      <span className="text-rmpg-200">{formatDate(c.court_date)}</span>
                      <span className="text-[9px] font-bold font-mono" style={{ color: cdColor }}>({cdLabel})</span>
                    </div>
                  );
                })()}
                {c.court_name && <div><span className="text-rmpg-400">Court:</span> <span className="text-rmpg-200">{c.court_name}</span></div>}
                {(c as any).court_time && <div><span className="text-rmpg-400">Time:</span> <span className="text-rmpg-200">{(c as any).court_time}</span></div>}
                {(c as any).court_room && <div><span className="text-rmpg-400">Courtroom:</span> <span className="text-rmpg-200">{(c as any).court_room}</span></div>}
                {c.court_address && <div><span className="text-rmpg-400">Address:</span> <span className="text-rmpg-200">{c.court_address}</span></div>}
                {(c as any).appearance_required ? (
                  <span className="text-[9px] font-bold text-red-400 mt-1 inline-flex items-center gap-1">
                    <AlertTriangle size={9} /> APPEARANCE REQUIRED
                  </span>
                ) : null}
              </div>
            </section>
          )}

          {/* Notes */}
          {c.notes && (
            <section>
              <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2">Notes</h3>
              <div className="bg-surface-raised border border-rmpg-700 p-3 text-xs text-rmpg-200 whitespace-pre-wrap">{c.notes}</div>
            </section>
          )}

          {/* Timestamps */}
          <div className="text-[9px] text-rmpg-600 pt-2 border-t border-rmpg-700/50 flex gap-4">
            <span>Created: {formatDate(c.created_at)}</span>
            <span>Updated: {formatDate(c.updated_at)}</span>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // Form (create / edit)
  // ============================================================

  const showVehicleSection = form.type === 'traffic' || form.type === 'parking';
  const isEdit = mode === 'edit';

  const renderForm = () => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Form header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-300">
            {isEdit ? `Edit Citation ${selectedCitation?.citation_number || ''}` : 'New Citation / Summons'}
          </h2>
          {(formIsDirty || violationsDirty) && (
            <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wider">UNSAVED</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <CitationPdfPreview
            form={formToData(form as any, violations)}
            mode={previewMode}
            onModeChange={setPreviewMode}
          />
          <button type="button" onClick={handleCancelForm} aria-label="Cancel form" className="text-rmpg-400 hover:text-rmpg-200 transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent p-4 space-y-5">
        {saveError && (
          <div className="bg-red-900/40 border border-red-700/50 px-3 py-2 text-xs text-red-300 flex items-center gap-2">
            <AlertTriangle size={14} /> {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="bg-green-900/40 border border-green-700/50 px-3 py-2 text-xs text-green-300 flex items-center gap-2">
            <Check size={14} /> Citation saved successfully
          </div>
        )}
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
        {duplicateWarning && (
          <div className="bg-amber-900/40 border border-amber-700/50 px-3 py-2 text-xs text-amber-300 flex items-center gap-2">
            <AlertTriangle size={14} className="flex-shrink-0" /> {duplicateWarning}
          </div>
        )}

        {/* Type selector */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2">Citation Type</h3>
          <div className={`flex ${isMobile ? 'flex-col' : 'flex-wrap'} gap-2`}>
            {CITATION_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => updateField('type', t.value)}
                className={`px-3 ${isMobile ? 'py-3 text-sm' : 'py-1.5 text-xs'} font-bold uppercase transition-colors border ${
                  form.type === t.value
                    ? TYPE_BADGE[t.value] + ' ring-1 ring-brand-500/50'
                    : 'border-rmpg-600 text-rmpg-400 bg-rmpg-800/40 hover:bg-rmpg-700/50'
                }`}
                style={isMobile ? { minHeight: 48 } : undefined}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* Status (edit only) */}
        {isEdit && (
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2">Status</h3>
            <Combobox<{ value: CitationStatus; label: string }>
              value={CITATION_STATUSES.find(s => s.value === form.status) ?? null}
              onChange={(opt) => updateField('status', opt?.value || 'issued')}
              options={CITATION_STATUSES}
              getLabel={(o) => o.label}
              getKey={(o) => o.value}
              placeholder="Status"
            />
          </section>
        )}

        {/* Violations — multi-violation authoring */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1.5">
            <Scale size={12} /> Violations
          </h3>
          <div className="space-y-3">
            <div>
              <label className="field-label">Quick Statute Search (autofills first violation)</label>
              <StatuteLookup
                onSelect={(statute) => {
                  // Keep legacy flat form fields in sync for back-compat (server
                  // back-fills these from violations[0] anyway, but other UI
                  // surfaces (detail view, list) still read the flat columns).
                  handleStatuteSelect(statute);
                  // Also push into violations[0] so the ViolationStack reflects it.
                  setViolations(prev => {
                    const first = prev.length === 0 ? newDraft() : prev[0];
                    const next = prev.length === 0 ? [first] : [...prev];
                    next[0] = {
                      ...first,
                      statute_id: Number(statute.id),
                      statute_citation: statute.citation,
                      description: first.description || statute.short_title || '',
                      offense_level: normalizeOffenseLevel(statute.offense_level),
                      fine_amount: first.fine_amount > 0 ? first.fine_amount : Number(statute.citation_fine) || 0,
                    };
                    return next;
                  });
                }}
                value={form.statute_citation || undefined}
                onClear={clearStatute}
                categoryFilter={statuteCategoryFilter}
                placeholder="Search statute code or description..." aria-label="Search statute code or description..."
                showStateFilter
              />
            </div>
            <ViolationStack
              value={violations}
              onChange={(next) => {
                setViolations(next);
                // Mirror the first violation into the flat form fields so the
                // existing validation, duplicate-detection, and back-compat
                // detail view keep working.
                const first = next[0];
                if (first) {
                  setForm(prev => ({
                    ...prev,
                    statute_citation: first.statute_citation,
                    statute_id: first.statute_id != null ? String(first.statute_id) : '',
                    violation_description: first.description,
                    offense_level: first.offense_level,
                    fine_amount: first.fine_amount > 0 ? String(first.fine_amount) : '',
                  }));
                }
              }}
              statuteFetcher={statuteFetcher}
            />
            {formErrors.violation_description && (
              <p className="text-red-400 text-[10px] mt-1">{formErrors.violation_description}</p>
            )}
          </div>
        </section>

        {/* Subject */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1.5">
            <User size={12} /> Subject
          </h3>
          <div className="space-y-3">
            <div ref={personDropdownRef} className="relative">
              <label htmlFor="ff-citationspage-12" className="field-label">Search Existing Person</label>
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-rmpg-400" />
                <input id="ff-citationspage-12"
                  type="text"
                  value={personSearch}
                  onChange={e => handlePersonSearchChange(e.target.value)}
                  onFocus={() => { if (personResults.length > 0) setShowPersonDropdown(true); }}
                  placeholder="Search by name or DL..." aria-label="Search by name or driver's license"
                  autoComplete="off"
                  className="input-dark w-full py-2 pl-8 pr-8 text-xs min-h-[36px]"
                />
                {personSearching && <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-rmpg-400 animate-spin" />}
                {form.person_id && (
                  <button type="button" onClick={clearPerson} aria-label="Clear selected person" className="absolute right-3 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-rmpg-200">
                    <X size={12} />
                  </button>
                )}
              </div>
              {showPersonDropdown && personResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full bg-rmpg-800 border border-rmpg-600 shadow-xl max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-rmpg-600 scrollbar-track-transparent">
                  {personResults.map((p: any) => (
                    <button type="button"
                      key={p.id}
                      onClick={() => selectPerson(p)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-rmpg-700/50 border-b border-rmpg-700/50 last:border-b-0 transition-colors"
                    >
                      <div className="font-semibold text-rmpg-200">{p.last_name}, {p.first_name}</div>
                      <div className="text-[10px] text-rmpg-400">
                        {p.dob ? `DOB: ${formatDate(p.dob)}` : ''} {p.dl_number ? `DL: ${p.dl_number}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {form.person_id && (
              <div
                className="text-[10px] text-brand-300 bg-brand-900/20 px-2 py-1 flex items-center gap-1 cursor-pointer hover:bg-brand-900/30 transition-colors"
                onClick={() => navigate(`/records?tab=persons&personId=${form.person_id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/records?tab=persons&personId=${form.person_id}`); }}
              >
                <Check size={10} /> Linked to person record #{form.person_id}
                <ExternalLink size={9} className="ml-1 opacity-60" />
              </div>
            )}

            <div>
              <label htmlFor="ff-citationspage-13" className="field-label">Full Name *</label>
              <input id="ff-citationspage-13"
                type="text"
                value={form.person_name}
                onChange={e => updateField('person_name', e.target.value)}
                placeholder="Last, First Middle"
                autoComplete="off"
                className={`input-dark w-full py-2 text-xs ${formErrors.person_name ? 'border-red-500' : ''}`}
              />
              {formErrors.person_name && <p className="text-red-400 text-[10px] mt-1">{formErrors.person_name}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="ff-citationspage-14" className="field-label">Date of Birth</label>
                <input id="ff-citationspage-14" type="date" value={form.person_dob} onChange={e => updateField('person_dob', e.target.value)} className="input-dark w-full py-2 text-xs min-h-[36px]" />
              </div>
              <div>
                <label htmlFor="ff-citationspage-15" className="field-label">Driver License #</label>
                <input id="ff-citationspage-15" type="text" value={form.person_dl} onChange={e => updateField('person_dl', e.target.value)} placeholder="DL number" className="input-dark w-full py-2 text-xs font-mono min-h-[36px]" />
              </div>
            </div>

             <div className="flex gap-2">
               <div className="flex-1">
               <label className="field-label">Address</label>
               <AddressAutocomplete
                 value={form.person_address}
                 onChange={(value) => updateField('person_address', value)}
                 placeholder="Enter address..."
                 className="input-dark w-full py-2 text-xs min-h-[36px]"
                 name="person_address"
                 onSelect={(addr) => {
                   // Update related fields when address is selected
                   updateField('person_address', addr.formatted);
                   // Optionally auto-fill city/state/zip if we had separate fields
                 }}
               />
               </div>
               <div className="w-24">
                 <label htmlFor="ff-citationspage-addrunit" className="field-label">Apt / Unit</label>
                 <input id="ff-citationspage-addrunit" type="text" className="input-dark w-full py-2 text-xs min-h-[36px]" value={personAddressUnit} onChange={e => setPersonAddressUnit(e.target.value)} placeholder="4B" />
               </div>
             </div>
          </div>
        </section>

        {/* Vehicle (traffic/parking only) */}
        {showVehicleSection && (
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1.5">
              <Car size={12} /> Vehicle Information
            </h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="ff-citationspage-16" className="field-label">Vehicle Description</label>
                <input id="ff-citationspage-16" type="text" value={form.vehicle_description} onChange={e => updateField('vehicle_description', e.target.value)} placeholder="Year Make Model Color" className="input-dark w-full py-2 text-xs min-h-[36px]" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ff-citationspage-17" className="field-label">License Plate</label>
                  <input id="ff-citationspage-17" type="text" value={form.vehicle_plate} onChange={e => updateField('vehicle_plate', e.target.value.toUpperCase())} placeholder="ABC1234" className="input-dark w-full py-2 text-xs font-mono uppercase min-h-[36px]" />
                </div>
                <div>
                  <label className="field-label">State</label>
                  <Combobox<{ value: string; label: string }>
                    value={STATE_OPTIONS.find(o => o.value === form.vehicle_state) ?? null}
                    onChange={(opt) => updateField('vehicle_state', opt?.value || 'UT')}
                    options={STATE_OPTIONS}
                    getLabel={(o) => o.label}
                    getKey={(o) => o.value}
                    placeholder="State"
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Location & Time */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1.5">
            <Calendar size={12} /> Location & Time
          </h3>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="ff-citationspage-19" className="field-label">Violation Date *</label>
                <input id="ff-citationspage-19"
                  type="date"
                  value={form.violation_date}
                  onChange={e => updateField('violation_date', e.target.value)}
                  className={`input-dark w-full py-2 text-xs ${formErrors.violation_date ? 'border-red-500' : ''}`}
                />
                {formErrors.violation_date && <p className="text-red-400 text-[10px] mt-1">{formErrors.violation_date}</p>}
              </div>
              <div>
                <label htmlFor="ff-citationspage-20" className="field-label">Violation Time</label>
                <input id="ff-citationspage-20" type="time" value={form.violation_time} onChange={e => updateField('violation_time', e.target.value)} className="input-dark w-full py-2 text-xs min-h-[36px]" />
              </div>
            </div>
            <div>
              <label className="field-label">Location</label>
              <AddressAutocomplete
                value={form.location}
                onChange={(value) => updateField('location', value)}
                placeholder="Address or intersection"
                className="input-dark w-full py-2 text-xs min-h-[36px]"
                name="location"
                onSelect={async (addr) => {
                  // Full formatted address + geocoded coords so this citation
                  // appears on the Map UI. Auto-fill Section/Zone/Beat via the
                  // server's geofence identify endpoint.
                  updateField('location', addr.formatted || addr.street);
                  if (addr.latitude != null) {
                    updateField('latitude', addr.latitude as any);
                    updateField('longitude', addr.longitude as any);
                    const district = await identifyDistrict(addr.latitude, addr.longitude!);
                    if (district) {
                      // Citations form uses the legacy "section_id" name for what
                      // the geography hook returns as sector_id.
                      if (district.sector_id) updateField('section_id', district.sector_id);
                      if (district.zone_id) updateField('zone_id', district.zone_id);
                      if (district.beat_id) updateField('beat_id', district.beat_id);
                    }
                  }
                }}
              />
            </div>
            {/* Section / Zone / Beat — cascading */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="ff-citationspage-21" className="block text-xs text-rmpg-400 mb-1">Section</label>
                <select id="ff-citationspage-21" className="w-full bg-surface-raised border border-rmpg-700 rounded-sm px-2 py-1.5 text-sm text-rmpg-100"
                  value={form.section_id || ''} onChange={(e) => { updateField('section_id', e.target.value); updateField('zone_id', ''); updateField('beat_id', ''); }}>
                  <option value="">—</option>
                  {sectionOptions.map((s: any) => <option key={s} value={s}>{sectionLabels.get(s) || s}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ff-citationspage-22" className="block text-xs text-rmpg-400 mb-1">Zone</label>
                <select id="ff-citationspage-22" className="w-full bg-surface-raised border border-rmpg-700 rounded-sm px-2 py-1.5 text-sm text-rmpg-100"
                  value={form.zone_id || ''} onChange={(e) => { updateField('zone_id', e.target.value); updateField('beat_id', ''); }}>
                  <option value="">—</option>
                  {zonesForSection(form.section_id).map((z: any) => <option key={z} value={z}>{zoneLabels.get(z) || z}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="ff-citationspage-23" className="block text-xs text-rmpg-400 mb-1">Beat</label>
                <select id="ff-citationspage-23" className="w-full bg-surface-raised border border-rmpg-700 rounded-sm px-2 py-1.5 text-sm text-rmpg-100"
                  value={form.beat_id || ''} onChange={(e) => updateField('beat_id', e.target.value)}>
                  <option value="">—</option>
                  {beatsForZone(form.zone_id).map((b: any) => <option key={b} value={b}>{getBeatLabel(form.zone_id, b)}</option>)}
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Officer */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1.5">
            <User size={12} /> Issuing Officer
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ff-citationspage-24" className="field-label">Officer Name</label>
              <input id="ff-citationspage-24" type="text" value={form.issuing_officer_name} onChange={e => updateField('issuing_officer_name', e.target.value)} className="input-dark w-full py-2 text-xs min-h-[36px]" />
            </div>
            <div>
              <label htmlFor="ff-citationspage-25" className="field-label">Badge #</label>
              <input id="ff-citationspage-25" type="text" value={form.badge_number} onChange={e => updateField('badge_number', e.target.value)} className="input-dark w-full py-2 text-xs font-mono min-h-[36px]" />
            </div>
          </div>
        </section>

        {/* Court */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2 flex items-center gap-1.5">
            <Scale size={12} /> Court Information
          </h3>
          <div className="space-y-3">
            <div>
              <label htmlFor="ff-citationspage-26" className="field-label">Court Date</label>
              <input id="ff-citationspage-26" type="date" value={form.court_date} onChange={e => updateField('court_date', e.target.value)} className="input-dark w-full py-2 text-xs min-h-[36px]" />
            </div>
            <div>
              <label htmlFor="ff-citationspage-27" className="field-label">Court Name</label>
              <input id="ff-citationspage-27" type="text" value={form.court_name} onChange={e => updateField('court_name', e.target.value)} placeholder="e.g. Provo Justice Court" className="input-dark w-full py-2 text-xs min-h-[36px]" />
            </div>
             <div>
               <label className="field-label">Court Address</label>
               <AddressAutocomplete
                 value={form.court_address}
                 onChange={(value) => updateField('court_address', value)}
                 placeholder="Enter court address..."
                 className="input-dark w-full py-2 text-xs min-h-[36px]"
                 name="court_address"
                 onSelect={(addr) => {
                   // Update the court address field with the selected formatted address
                   updateField('court_address', addr.formatted);
                 }}
               />
             </div>
          </div>
        </section>

        {/* Notes */}
        <section>
          <h3 className="text-[10px] uppercase tracking-widest text-[var(--brand-gold)] font-bold mb-2">Notes</h3>
          <RichTextArea
            value={form.notes}
            onChange={e => updateField('notes', e.target.value)}
            placeholder="Additional notes or remarks..."
            rows={4}
            className="input-dark w-full py-2 text-xs resize-none min-h-[36px]"
          />
        </section>
      </div>

      {/* Footer */}
      <div className={`flex items-center ${isMobile ? 'flex-col gap-2' : 'justify-end gap-3'} px-4 py-3 border-t border-rmpg-700`}>
        <button type="button"
          onClick={handleSave}
          disabled={saving}
          className={`toolbar-btn toolbar-btn-primary disabled:opacity-50 disabled:cursor-not-allowed ${isMobile ? 'w-full justify-center' : ''}`}
          style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}
        >
          {saving ? (
            <><Loader2 size={14} className="animate-spin" /> Saving...</>
          ) : (
            <><Check size={14} /> {isEdit ? 'Save Changes' : 'Create Citation'}</>
          )}
        </button>
        <button type="button" onClick={handleCancelForm} className={`px-4 py-2 text-xs font-bold uppercase text-rmpg-300 hover:text-rmpg-100 transition-colors ${isMobile ? 'w-full text-center' : ''}`} style={isMobile ? { minHeight: 48 } : undefined}>
          Cancel
        </button>
      </div>
    </div>
  );

  // ============================================================
  // Right panel switcher
  // ============================================================

  const renderRightPanel = () => {
    if (mode === 'create' || mode === 'edit') return renderForm();

    if (detailLoading) {
      return (
        <div className="flex items-center justify-center h-full text-rmpg-400">
          <Loader2 size={24} className="animate-spin mr-2" /> Loading citation...
        </div>
      );
    }

    if (selectedCitation) return renderDetailView();

    return (
      <div className="flex flex-col items-center justify-center h-full text-rmpg-500 px-8">
        <FileWarning size={48} className="mb-4 opacity-30" />
        <p className="text-sm font-semibold text-rmpg-400 mb-1">No Citation Selected</p>
        <p className="text-xs text-center text-rmpg-500 mb-6 max-w-xs">
          Select a citation from the list to view details, or create a new one.
        </p>
        {canManage && (
        <button type="button" onClick={handleNewCitation} className="toolbar-btn toolbar-btn-primary print:hidden">
          <Plus size={14} /> New Citation
        </button>
        )}
      </div>
    );
  };

  // ============================================================
  // Main layout
  // ============================================================

  // On mobile, show list OR detail/form — not both side by side
  const showListOnMobile = !isMobile || (mode === 'list' && !selectedCitation);
  const showRightOnMobile = !isMobile || mode !== 'list' || !!selectedCitation;

  // Set document title
  useEffect(() => { document.title = 'Citations \u2014 RMPG Flex'; }, []);

  // \u2500\u2500 /citations?citation_id=<id> deep-link auto-select \u2500\u2500
  // Same contract every audited page (1-13) now honors. Once the list
  // hydrates, find by id and set as selectedCitation; if it's not in
  // the current page (filtered out, on another page), fall through to
  // a direct fetch by id. Strip the query so refresh doesn't re-select.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingCitationIdRef = useRef<string | null>(searchParams.get('citation_id'));
  useEffect(() => {
    const target = pendingCitationIdRef.current;
    if (!target || loading) return;
    const stripQuery = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('citation_id');
      setSearchParams(next, { replace: true });
    };
    const hit = citations.find((c) => String(c.id) === String(target));
    if (hit) {
      pendingCitationIdRef.current = null;
      setSelectedCitation(hit);
      stripQuery();
      return;
    }
    // Wait until the list has at least attempted to hydrate before we
    // fall through to the direct-fetch path.
    if (citations.length === 0) return;
    // Direct fetch by id \u2014 works when the citation is filtered out
    // by the current type/status/search but the deep-link still resolves.
    pendingCitationIdRef.current = null;
    (async () => {
      try {
        const res = await apiFetch<{ data: Citation }>(`/citations/${target}`);
        if (res?.data) {
          setSelectedCitation(res.data);
        } else {
          addToast(`Citation ${target} not found`, 'warning');
        }
      } catch {
        addToast(`Citation ${target} not found`, 'warning');
      } finally {
        stripQuery();
      }
    })();
  }, [citations, loading, searchParams, setSearchParams, addToast]);

  // ── ?plate=<plate> deep-link — pre-fill the search box with a plate ──
  // Incoming from PlateLogPage context-menu "View citations for this plate".
  // Strips the param after applying so refresh doesn't re-run it.
  useEffect(() => {
    const plate = searchParams.get('plate');
    if (!plate) return;
    setSearchQuery(plate.toUpperCase());
    setPage(1);
    const next = new URLSearchParams(searchParams);
    next.delete('plate');
    setSearchParams(next, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ?officer_id=<id> deep-link — pre-fill search with officer's badge ──
  // Incoming from PersonnelPage officer card "View this officer's citations".
  useEffect(() => {
    const officerId = searchParams.get('officer_id');
    if (!officerId) return;
    setSearchQuery(officerId);
    setPage(1);
    const next = new URLSearchParams(searchParams);
    next.delete('officer_id');
    setSearchParams(next, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts: Esc smart-cascade (smallest modal first), and `N`
  // opens a new citation from anywhere on the page (mirrors Field Interviews
  // / Dispatch for operator muscle memory). Suppressed while typing into an
  // input/textarea/contenteditable so "N" doesn't fire mid-form-fill.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Smallest modal first. ConfirmDialog handles its own Esc via its
        // overlay, but we also close the inline payment form and the
        // person-search dropdown before falling through to the form panel.
        if (voidTarget) { e.stopPropagation(); setVoidTarget(null); return; }
        if (showPaymentForm) { e.stopPropagation(); setShowPaymentForm(false); return; }
        if (showPersonDropdown) { e.stopPropagation(); setShowPersonDropdown(false); return; }
        if (mode !== 'list') { e.stopPropagation(); handleCancelForm(); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if (e.key === 'n' || e.key === 'N') {
        // Don't fire while a destructive confirm is open, and gate on canManage
        if (voidTarget || mode !== 'list' || !canManage) return;
        e.preventDefault();
        handleNewCitation();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voidTarget, showPaymentForm, showPersonDropdown, mode]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <UnsavedChangesGuard hasUnsavedChanges={mode !== 'list' && (formIsDirty || violationsDirty)} />
      <FloatingSaveBar
        visible={mode !== 'list' && (formIsDirty || violationsDirty)}
        onSave={handleSave}
        onCancel={handleCancelForm}
        isSaving={saving}
        saveLabel={mode === 'create' ? 'Create Citation' : 'Save Changes'}
      />
      {/* Stats bar */}
      <div className={`${isMobile ? 'px-3 pt-3' : 'px-4 pt-4'} pb-0 shrink-0`}>
        {isMobile ? (
          <div className="overflow-x-auto -mx-3 px-3 pb-2">
            {renderStatsBar()}
          </div>
        ) : (
          renderStatsBar()
        )}
      </div>

      {/* Split view */}
      <div className={`flex flex-1 overflow-hidden ${isMobile ? 'px-2 pb-2 flex-col' : 'px-4 pb-4 gap-4'}`}>
        {/* Left panel */}
        {showListOnMobile && (
          <div className={`${isMobile ? 'flex-1' : 'w-[420px] min-w-[360px] shrink-0'} panel-beveled bg-surface-base border border-rmpg-700 flex flex-col overflow-hidden`}>
            {renderListPanel()}
          </div>
        )}

        {/* Right panel */}
        {showRightOnMobile && (
          <div className={`flex-1 panel-beveled bg-surface-base border border-rmpg-700 overflow-hidden flex flex-col ${isMobile && !showListOnMobile ? '' : ''}`}>
            {isMobile && selectedCitation && mode === 'list' && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-rmpg-700">
                <button type="button" onClick={() => setSelectedCitation(null)} className="toolbar-btn text-[10px]">← Back</button>
                <span className="text-xs text-rmpg-400 font-mono">{selectedCitation.citation_number}</span>
              </div>
            )}
            {renderRightPanel()}
          </div>
        )}
      </div>

      {/* Mobile FAB for new citation */}
      {isMobile && !selectedCitation && mode === 'list' && canManage && (
        <button type="button" onClick={handleNewCitation} className="mobile-fab" aria-label="New Citation">
          <Plus size={24} />
        </button>
      )}

      {/* Void-citation confirmation — replaces the native window.confirm()
          for a11y + keyboard polish + visual consistency with every other
          destructive flow in the app. */}
      <ConfirmDialog
        isOpen={voidTarget !== null}
        onClose={() => { if (!voiding) setVoidTarget(null); }}
        onConfirm={confirmVoid}
        title="Void citation"
        message="Voiding a citation marks it inactive in the case record. This cannot be undone from the UI."
        details={voidTarget && (
          <div className="space-y-1">
            <div><span className="text-rmpg-500">Citation:</span> <span className="font-mono text-rmpg-200">{voidTarget.citation_number}</span></div>
            {voidTarget.person_name && (
              <div><span className="text-rmpg-500">Violator:</span> <span className="text-rmpg-200">{voidTarget.person_name}</span></div>
            )}
            {voidTarget.violation_date && (
              <div><span className="text-rmpg-500">Issued:</span> <span className="text-rmpg-200">{formatDate(voidTarget.violation_date)}</span></div>
            )}
            {voidTarget.statute_citation && (
              <div><span className="text-rmpg-500">Statute:</span> <span className="font-mono text-rmpg-200">{voidTarget.statute_citation}</span></div>
            )}
          </div>
        )}
        confirmLabel={voiding ? 'Voiding…' : 'Void citation'}
        confirmVariant="danger"
        isLoading={voiding}
      />
    </div>
  );
}
