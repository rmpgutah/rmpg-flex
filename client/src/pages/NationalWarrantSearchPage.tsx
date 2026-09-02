// ============================================================
// RMPG Flex — National Warrant Search Page
// Multi-state warrant search with US coverage map
// ============================================================

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Globe, Search, User, AlertTriangle, MapPin, Loader2, X, Shield, Gavel, ChevronDown, Printer } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { formatDate } from '../utils/dateUtils';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { openNationalWarrantPdf, type NationalWarrantHit } from '../utils/nationalWarrantPdf';
import { toDisplayLabel } from '../utils/formatters';
import { nationalWarrantsToCsv, downloadTextFile } from '../utils/rmsListExport';

type CoverageStatus = 'active' | 'pending' | 'disabled';

interface NationalCoverageState {
  stateCode: string;
  stateName: string;
  available: boolean;
  message?: string;
}

interface NationalCoverageResponse {
  states: NationalCoverageState[];
  updatedAt?: string;
  sources?: number;
  states_covered?: number;
  active_warrants?: number;
  state_status?: Record<string, CoverageStatus>;
  state_sources?: Record<string, number>;
  state_warrants?: Record<string, number>;
}

interface NationalWarrantSearchResults {
  total?: number;
  search_time_ms?: number;
  by_state?: Record<string, Warrant[]>;
  local?: Warrant[];
  error?: string;
}

interface Warrant {
  id?: string | number;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  dob?: string;
  age?: number | string;
  state?: string;
  warrant_type?: string | null;
  offense_level?: string | null;
  charge?: string;
  charges?: string;
  issued_date?: string | null;
  photo_url?: string | null;
  status?: string | null;
  bond_amount?: number | string | null;
  court?: string;
  source?: string;
}

// ── US States List ──────────────────────────────────────────
const US_STATES = [
  { code: '', label: 'All States' },
  { code: 'US', label: 'Federal' },
  { code: 'AL', label: 'Alabama' },
  { code: 'AK', label: 'Alaska' },
  { code: 'AZ', label: 'Arizona' },
  { code: 'AR', label: 'Arkansas' },
  { code: 'CA', label: 'California' },
  { code: 'CO', label: 'Colorado' },
  { code: 'CT', label: 'Connecticut' },
  { code: 'DE', label: 'Delaware' },
  { code: 'DC', label: 'District of Columbia' },
  { code: 'FL', label: 'Florida' },
  { code: 'GA', label: 'Georgia' },
  { code: 'HI', label: 'Hawaii' },
  { code: 'ID', label: 'Idaho' },
  { code: 'IL', label: 'Illinois' },
  { code: 'IN', label: 'Indiana' },
  { code: 'IA', label: 'Iowa' },
  { code: 'KS', label: 'Kansas' },
  { code: 'KY', label: 'Kentucky' },
  { code: 'LA', label: 'Louisiana' },
  { code: 'ME', label: 'Maine' },
  { code: 'MD', label: 'Maryland' },
  { code: 'MA', label: 'Massachusetts' },
  { code: 'MI', label: 'Michigan' },
  { code: 'MN', label: 'Minnesota' },
  { code: 'MS', label: 'Mississippi' },
  { code: 'MO', label: 'Missouri' },
  { code: 'MT', label: 'Montana' },
  { code: 'NE', label: 'Nebraska' },
  { code: 'NV', label: 'Nevada' },
  { code: 'NH', label: 'New Hampshire' },
  { code: 'NJ', label: 'New Jersey' },
  { code: 'NM', label: 'New Mexico' },
  { code: 'NY', label: 'New York' },
  { code: 'NC', label: 'North Carolina' },
  { code: 'ND', label: 'North Dakota' },
  { code: 'OH', label: 'Ohio' },
  { code: 'OK', label: 'Oklahoma' },
  { code: 'OR', label: 'Oregon' },
  { code: 'PA', label: 'Pennsylvania' },
  { code: 'RI', label: 'Rhode Island' },
  { code: 'SC', label: 'South Carolina' },
  { code: 'SD', label: 'South Dakota' },
  { code: 'TN', label: 'Tennessee' },
  { code: 'TX', label: 'Texas' },
  { code: 'UT', label: 'Utah' },
  { code: 'VT', label: 'Vermont' },
  { code: 'VA', label: 'Virginia' },
  { code: 'WA', label: 'Washington' },
  { code: 'WV', label: 'West Virginia' },
  { code: 'WI', label: 'Wisconsin' },
  { code: 'WY', label: 'Wyoming' },
];

const OFFENSE_LEVELS = [
  { code: '', label: 'All Levels' },
  { code: 'felony', label: 'Felony' },
  { code: 'misdemeanor', label: 'Misdemeanor' },
  { code: 'infraction', label: 'Infraction' },
];

const WARRANT_TYPES = [
  { code: '', label: 'All Types' },
  { code: 'arrest', label: 'Arrest Warrant' },
  { code: 'bench', label: 'Bench Warrant' },
  { code: 'search', label: 'Search Warrant' },
  { code: 'civil', label: 'Civil Warrant' },
  { code: 'extradition', label: 'Extradition' },
  { code: 'fugitive', label: 'Fugitive Warrant' },
];

// ── SVG State Map Data ──────────────────────────────────────
// Simplified US state grid for coverage map. Each state positioned
// in an approximate geographic grid. Columns 0-10 (west to east),
// rows 0-6 (north to south).
const STATE_GRID: { code: string; label: string; col: number; row: number }[] = [
  // Row 0 — Alaska / northern states
  { code: 'AK', label: 'AK', col: 0, row: 0 },
  { code: 'WA', label: 'WA', col: 1, row: 0 },
  { code: 'MT', label: 'MT', col: 3, row: 0 },
  { code: 'ND', label: 'ND', col: 5, row: 0 },
  { code: 'MN', label: 'MN', col: 6, row: 0 },
  { code: 'WI', label: 'WI', col: 7, row: 0 },
  { code: 'MI', label: 'MI', col: 8, row: 0 },
  { code: 'VT', label: 'VT', col: 9, row: 0 },
  { code: 'NH', label: 'NH', col: 10, row: 0 },
  { code: 'ME', label: 'ME', col: 11, row: 0 },
  // Row 1
  { code: 'HI', label: 'HI', col: 0, row: 1 },
  { code: 'OR', label: 'OR', col: 1, row: 1 },
  { code: 'ID', label: 'ID', col: 2, row: 1 },
  { code: 'WY', label: 'WY', col: 3, row: 1 },
  { code: 'SD', label: 'SD', col: 5, row: 1 },
  { code: 'IA', label: 'IA', col: 6, row: 1 },
  { code: 'IL', label: 'IL', col: 7, row: 1 },
  { code: 'IN', label: 'IN', col: 8, row: 1 },
  { code: 'NY', label: 'NY', col: 9, row: 1 },
  { code: 'MA', label: 'MA', col: 10, row: 1 },
  { code: 'CT', label: 'CT', col: 11, row: 1 },
  // Row 2
  { code: 'CA', label: 'CA', col: 0, row: 2 },
  { code: 'NV', label: 'NV', col: 1, row: 2 },
  { code: 'UT', label: 'UT', col: 2, row: 2 },
  { code: 'CO', label: 'CO', col: 3, row: 2 },
  { code: 'NE', label: 'NE', col: 5, row: 2 },
  { code: 'KS', label: 'KS', col: 5, row: 3 },
  { code: 'MO', label: 'MO', col: 6, row: 2 },
  { code: 'OH', label: 'OH', col: 8, row: 2 },
  { code: 'PA', label: 'PA', col: 9, row: 2 },
  { code: 'NJ', label: 'NJ', col: 10, row: 2 },
  { code: 'RI', label: 'RI', col: 11, row: 2 },
  // Row 3
  { code: 'AZ', label: 'AZ', col: 1, row: 3 },
  { code: 'NM', label: 'NM', col: 2, row: 3 },
  { code: 'OK', label: 'OK', col: 4, row: 3 },
  { code: 'AR', label: 'AR', col: 6, row: 3 },
  { code: 'KY', label: 'KY', col: 7, row: 2 },
  { code: 'WV', label: 'WV', col: 8, row: 3 },
  { code: 'VA', label: 'VA', col: 9, row: 3 },
  { code: 'DE', label: 'DE', col: 10, row: 3 },
  { code: 'MD', label: 'MD', col: 11, row: 3 },
  // Row 4
  { code: 'TX', label: 'TX', col: 3, row: 4 },
  { code: 'LA', label: 'LA', col: 5, row: 4 },
  { code: 'MS', label: 'MS', col: 6, row: 4 },
  { code: 'TN', label: 'TN', col: 7, row: 3 },
  { code: 'NC', label: 'NC', col: 9, row: 4 },
  { code: 'SC', label: 'SC', col: 10, row: 4 },
  { code: 'DC', label: 'DC', col: 11, row: 4 },
  // Row 5
  { code: 'AL', label: 'AL', col: 7, row: 4 },
  { code: 'GA', label: 'GA', col: 8, row: 4 },
  { code: 'FL', label: 'FL', col: 8, row: 5 },
];

// ── Coverage status colors ──────────────────────────────────
// All semantic — `active` reads ok/green, `pending` reads warn/amber via the
// theme palette so they re-skin between night and day. Pre-PR-1033 the hex
// values were hardcoded green-800/amber-900/15803d/92400e which froze the
// coverage map at night-only saturation even when the day skin was active.
function coverageFill(status: CoverageStatus | undefined): string {
  switch (status) {
    case 'active': return 'rgb(var(--sev-ok-rgb) / 0.35)';
    case 'pending': return 'rgb(var(--sev-warn-rgb) / 0.30)';
    default: return 'var(--border-subtle)';
  }
}
function coverageStroke(status: CoverageStatus | undefined): string {
  switch (status) {
    case 'active': return 'var(--sev-ok)';
    case 'pending': return 'var(--sev-warn)';
    default: return 'var(--text-muted)';
  }
}
function coverageHoverFill(status: CoverageStatus | undefined): string {
  switch (status) {
    case 'active': return 'rgb(var(--sev-ok-rgb) / 0.55)';
    case 'pending': return 'rgb(var(--sev-warn-rgb) / 0.50)';
    default: return 'var(--border-default)';
  }
}
function coverageTextColor(status: CoverageStatus | undefined): string {
  switch (status) {
    case 'active': return 'var(--sev-ok-soft)';
    case 'pending': return 'var(--sev-warn-soft)';
    default: return 'var(--text-secondary)';
  }
}

// ── Severity badge colors ───────────────────────────────────
function severityBadge(level: string) {
  switch (level?.toLowerCase()) {
    case 'felony':
      return 'bg-red-900/50 text-red-400 border border-red-700/50';
    case 'misdemeanor':
      return 'bg-amber-900/50 text-amber-400 border border-amber-700/50';
    case 'infraction':
      return 'bg-surface-sunken/50 text-rmpg-400 border border-border-default/50';
    default:
      return 'bg-surface-sunken/50 text-rmpg-400 border border-border-default/50';
  }
}

function typeBadge(type: string) {
  switch (type?.toLowerCase()) {
    case 'arrest':
    case 'arrest warrant':
      return 'bg-red-900/50 text-red-400 border border-red-700/50';
    case 'bench':
    case 'bench warrant':
      return 'bg-orange-900/50 text-orange-400 border border-orange-700/50';
    case 'fugitive':
    case 'fugitive warrant':
      return 'bg-rose-900/50 text-rose-400 border border-rose-700/50';
    case 'extradition':
      return 'bg-purple-900/50 text-purple-400 border border-purple-700/50';
    default:
      return 'bg-surface-sunken/50 text-rmpg-400 border border-border-default/50';
  }
}

// ── Main Component ──────────────────────────────────────────

export default function NationalWarrantSearchPage() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { addToast } = useToast();

  // ── Role gates ───────────────────────────────────────────
  // canPrint: admin or manager may open court-ready PDFs.
  // Any authenticated user may run searches (backend enforces READ_ROLES).
  const canPrint = !!(user?.role === 'admin' || user?.role === 'manager');

  // ── Ref: first name input (for N / `/` shortcut focus) ────
  const firstNameRef = useRef<HTMLInputElement>(null);

  // URL deep-link contract — operators land here from /persons, /warrants,
  // dispatch, NCIC, etc. with the subject's name + DOB. Honored params:
  //   ?last_name=  ?first_name=  ?dob=  ?state=  ?offense_level=
  //   ?warrant_type=  ?charge_keyword=  ?auto=1
  //   ?search=<keyword>  (quick charge-keyword alias, implies auto=1)
  //   ?warrant_id=<id>  (deep-link to a specific result row; highlighted)
  // `auto=1` (or ?search= present) triggers a search on mount once we've
  // hydrated. Mirrors the pattern used by Cases / FI / Citations / Patrol.
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = useMemo(() => {
    const quickSearch = searchParams.get('search') ?? '';
    return {
      last_name: searchParams.get('last_name') ?? '',
      first_name: searchParams.get('first_name') ?? '',
      dob: searchParams.get('dob') ?? '',
      state: searchParams.get('state') ?? '',
      offense_level: searchParams.get('offense_level') ?? '',
      warrant_type: searchParams.get('warrant_type') ?? '',
      // ?search= is a convenience alias for charge_keyword; existing
      // ?charge_keyword= takes precedence if both arrive.
      charge_keyword: searchParams.get('charge_keyword') ?? quickSearch,
      warrant_id: searchParams.get('warrant_id') ?? '',
      auto: searchParams.get('auto') === '1' || quickSearch.length > 0,
    };
  // The ref-equality of `searchParams` only matters for the first paint;
  // we strip the params after consuming them so this memo never re-runs
  // with a different shape. Disable react-hooks/exhaustive-deps lint.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search form state — hydrated from the URL when present.
  const [firstName, setFirstName] = useState(initial.first_name);
  const [lastName, setLastName] = useState(initial.last_name);
  const [dob, setDob] = useState(initial.dob);
  const [stateFilter, setStateFilter] = useState(initial.state.toUpperCase());
  const [offenseLevel, setOffenseLevel] = useState(initial.offense_level);
  const [warrantType, setWarrantType] = useState(initial.warrant_type);
  const [chargeKeyword, setChargeKeyword] = useState(initial.charge_keyword);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any>(null);
  // `searched` tracks whether at least one search has been fired so the
  // empty panel shows "no results" vs "not searched yet" messaging.
  const [searched, setSearched] = useState(false);
  const [coverage, setCoverage] = useState<any>(null);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [searchValidationError, setSearchValidationError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ?warrant_id= deep-link — highlights a specific result row and scrolls
  // to it once the auto-triggered search resolves. Cleared on Esc or click.
  const [highlightId, setHighlightId] = useState(initial.warrant_id);

  // Map hover tooltip
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Collapsed state groups in results
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // ── Load Coverage ─────────────────────────────────────────
  useEffect(() => {
    setCoverageLoading(true);
    apiFetch<NationalCoverageResponse>('/api/warrants/national-coverage')
      .then(data => setCoverage(data))
      .catch(() => setCoverage(null))
      .finally(() => setCoverageLoading(false));
  }, []);

  // ── Search Handler ────────────────────────────────────────
  // Accepts an optional `override` so the deep-link `auto=1` effect can fire
  // a search with the URL-derived fields without waiting for React state to
  // settle (the prior version of this closure was racing).
  // `fromDeepLink` = true triggers a warning toast when zero results are
  // returned so the operator knows the auto-triggered search ran but found
  // nothing — the page stays at "no results" rather than silently empty.
  const handleSearch = useCallback(async (e?: React.FormEvent, override?: Partial<{
    first_name: string; last_name: string; dob: string; state: string;
    offense_level: string; warrant_type: string; charge_keyword: string;
  }>, fromDeepLink?: boolean) => {
    if (e) e.preventDefault();
    const body = {
      first_name: override?.first_name ?? firstName,
      last_name: override?.last_name ?? lastName,
      dob: (override?.dob ?? dob) || undefined,
      state: (override?.state ?? stateFilter) || undefined,
      offense_level: (override?.offense_level ?? offenseLevel) || undefined,
      warrant_type: (override?.warrant_type ?? warrantType) || undefined,
      charge_keyword: (override?.charge_keyword ?? chargeKeyword) || undefined,
    };
    if (!body.first_name && !body.last_name && !body.dob && !body.state && !body.charge_keyword) return;

    setSearchValidationError(null);
    setSearchError(null);
    setSearching(true);
    setSearched(true);
    setResults(null);
    try {
      const data = await apiFetch<NationalWarrantSearchResults>('/api/warrants/national-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setResults(data);
      if (fromDeepLink && (data?.total ?? 0) === 0) {
        addToast('No national warrants found for the linked subject', 'warning');
      }
    } catch {
      setSearchError('Search failed — check server connection');
      setResults({ total: 0, search_time_ms: 0, by_state: {}, local: [], error: 'Search failed — check server connection' });
    } finally {
      setSearching(false);
    }
  }, [firstName, lastName, dob, stateFilter, offenseLevel, warrantType, chargeKeyword, addToast]);

  // ── Deep-link auto-search + URL strip ─────────────────────
  // On first mount only, if the URL carries enough to search AND ?auto=1
  // (or ?search=), fire one POST then clear ALL deep-link params so a
  // refresh isn't a second hit and the URL doesn't leak subject PII.
  // Even without auto=1, URL params pre-fill the form (initial state above).
  useEffect(() => {
    if (initial.auto && (initial.last_name || initial.first_name || initial.dob || initial.state || initial.charge_keyword)) {
      void handleSearch(undefined, {
        first_name: initial.first_name,
        last_name: initial.last_name,
        dob: initial.dob,
        state: initial.state.toUpperCase(),
        offense_level: initial.offense_level,
        warrant_type: initial.warrant_type,
        charge_keyword: initial.charge_keyword,
      }, /* fromDeepLink= */ true);
    }
    // Strip ALL deep-link params (incl. ?search= and ?warrant_id=)
    // unconditionally so the URL is copy-paste safe.
    if (Array.from(searchParams.keys()).some(k =>
      ['last_name', 'first_name', 'dob', 'state', 'offense_level', 'warrant_type',
       'charge_keyword', 'auto', 'search', 'warrant_id'].includes(k)
    )) {
      const next = new URLSearchParams(searchParams);
      ['last_name', 'first_name', 'dob', 'state', 'offense_level', 'warrant_type',
       'charge_keyword', 'auto', 'search', 'warrant_id'].forEach(k => next.delete(k));
      setSearchParams(next, { replace: true });
    }
  // Run exactly once on mount with the captured `initial` snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Global keyboard shortcuts ─────────────────────────────
  // N or `/` → focus First Name field (standard CAD search shortcut).
  // Esc       → Esc cascade: highlight → state filter → results.
  // Both stop propagation so they don't bubble to parent pages.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA' || target.isContentEditable;

      if ((e.key === 'n' || e.key === 'N' || e.key === '/') && !inInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        firstNameRef.current?.focus();
        return;
      }

      if (e.key === 'Escape') {
        // Cascade: clear row highlight → clear state filter → clear results.
        if (highlightId) {
          e.stopPropagation();
          setHighlightId('');
          return;
        }
        if (stateFilter) {
          e.stopPropagation();
          setStateFilter('');
          return;
        }
        if (results !== null) {
          e.stopPropagation();
          setResults(null);
          setSearched(false);
          setCollapsedGroups(new Set());
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [highlightId, stateFilter, results]);

  const clearSearch = () => {
    setFirstName('');
    setLastName('');
    setDob('');
    setStateFilter('');
    setOffenseLevel('');
    setWarrantType('');
    setChargeKeyword('');
    setResults(null);
    setSearched(false);
    setCollapsedGroups(new Set());
    setHighlightId('');
  };

  const handleStateClick = (code: string) => {
    setStateFilter(prev => prev === code ? '' : code);
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ── Computed Stats ────────────────────────────────────────
  const sourceCount = coverage?.sources ?? 50;
  const statesCovered = coverage?.states_covered ?? 0;
  const activeWarrants = coverage?.active_warrants ?? 0;
  const stateCoverage: Record<string, CoverageStatus> = coverage?.state_status ?? {};

  const totalResults = results?.total ?? 0;
  const searchTime = results?.search_time_ms ?? 0;
  const stateGroups: Record<string, Warrant[]> = results?.by_state ?? {};
  const localResults: Warrant[] = results?.local ?? [];
  const stateGroupKeys = Object.keys(stateGroups).sort();

  // Officer signature line for every PDF pulled from this page — same
  // resolution rule the criminal-history + FI PDFs use.
  const flattenedWarrants = useMemo(() => {
    const rows: Array<{
      id?: string | number; state?: string; warrant_type?: string | null; status?: string | null;
      offense_level?: string | null; court?: string; source?: string;
    }> = [];
    if (!results) return rows;
    for (const w of (results.local ?? []) as Warrant[]) {
      rows.push({
        id: w.id,
        state: w.state,
        warrant_type: w.warrant_type,
        status: w.status,
        offense_level: w.offense_level,
        court: w.court,
        source: w.source ?? 'local',
      });
    }
    for (const [st, list] of Object.entries((results.by_state ?? {}) as Record<string, Warrant[]>)) {
      for (const w of list ?? []) {
        rows.push({
          id: w.id,
          state: w.state ?? st,
          warrant_type: w.warrant_type,
          status: w.status,
          offense_level: w.offense_level,
          court: w.court,
          source: w.source ?? st,
        });
      }
    }
    return rows;
  }, [results]);

  const preparedBy = useMemo(() => (
    user
      ? (`${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username)
      : undefined
  ), [user]);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-sunken">
      {/* ─── Header ──────────────────────────────────── */}
      <PanelTitleBar title="NATIONAL WARRANT SEARCH" icon={Globe}>
        <button
          type="button"
          className="toolbar-btn"
          disabled={flattenedWarrants.length === 0}
          onClick={() => downloadTextFile('national-warrants.csv', nationalWarrantsToCsv(flattenedWarrants))}
        >CSV</button>
        <span className="text-[10px] text-rmpg-400 font-mono tracking-wide">
          {sourceCount}+ sources
        </span>
        <span className="text-rmpg-500 mx-1">|</span>
        <span className="text-[10px] text-rmpg-400 font-mono tracking-wide">
          {statesCovered} states covered
        </span>
        <span className="text-rmpg-500 mx-1">|</span>
        <span className="text-[10px] text-brand-400 font-mono tracking-wide">
          {activeWarrants.toLocaleString()} active warrants
        </span>
      </PanelTitleBar>

      {/* ─── Scrollable Content ──────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark p-3 space-y-3">

        {/* ─── Search Form ────────────────────────────── */}
        <form onSubmit={handleSearch} className="panel-raised p-3 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">
              Search Parameters
            </span>
            <span className="ml-auto text-[10px] text-rmpg-600">
              <kbd className="px-1 py-0.5 bg-surface-sunken border border-border-subtle text-rmpg-500 font-mono text-[9px]">N</kbd> to focus
            </span>
          </div>

          {/* Row 1: Name, DOB, State, Search button */}
          <div className={`grid gap-2 ${isMobile ? 'grid-cols-1' : 'grid-cols-[1fr_1fr_120px_140px_auto]'}`}>
            <input
              id="ff-nationalwarrantsearchpage-0"
              ref={firstNameRef}
              type="text"
              placeholder="First Name"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              className="input-dark text-xs"
            />
            <input id="ff-nationalwarrantsearchpage-1"
              type="text"
              placeholder="Last Name"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              className="input-dark text-xs"
            />
            <input id="ff-nationalwarrantsearchpage-2"
              type="date"
              placeholder="DOB"
              value={dob}
              onChange={e => setDob(e.target.value)}
              className="input-dark text-xs"
            />
            <select id="ff-nationalwarrantsearchpage-3"
              value={stateFilter}
              onChange={e => setStateFilter(e.target.value)}
              className="input-dark text-xs"
            >
              {US_STATES.map(s => (
                <option key={s.code} value={s.code}>{s.label}</option>
              ))}
            </select>
            <div className="flex gap-1.5">
              <button
                type="submit"
                disabled={searching}
                className="toolbar-btn bg-brand-900/40 text-brand-400 border-brand-700/50 hover:bg-brand-900/60 px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
              >
                {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Search
              </button>
              {(firstName || lastName || dob || stateFilter || offenseLevel || warrantType || chargeKeyword) && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="toolbar-btn text-rmpg-400 hover:text-rmpg-100 px-2 py-1.5 text-xs"
                  title="Clear search (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Row 2: Offense Level, Warrant Type, Charge Keyword */}
          <div className={`grid gap-2 ${isMobile ? 'grid-cols-1' : 'grid-cols-[140px_160px_1fr]'}`}>
            <select id="ff-nationalwarrantsearchpage-4"
              value={offenseLevel}
              onChange={e => setOffenseLevel(e.target.value)}
              className="input-dark text-xs"
            >
              {OFFENSE_LEVELS.map(o => (
                <option key={o.code} value={o.code}>{o.label}</option>
              ))}
            </select>
            <select id="ff-nationalwarrantsearchpage-5"
              value={warrantType}
              onChange={e => setWarrantType(e.target.value)}
              className="input-dark text-xs"
            >
              {WARRANT_TYPES.map(t => (
                <option key={t.code} value={t.code}>{t.label}</option>
              ))}
            </select>
            <input id="ff-nationalwarrantsearchpage-6"
              type="text"
              placeholder="Charge keyword (e.g., assault, DUI, theft)"
              value={chargeKeyword}
              onChange={e => setChargeKeyword(e.target.value)}
              className="input-dark text-xs"
            />
          </div>
        </form>

        {/* ─── Validation Error ────────────────────────── */}
        {searchValidationError && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-950/40 border border-red-800/50 text-red-400 text-xs">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {searchValidationError}
          </div>
        )}
        {searchError && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-950/40 border border-red-800/50 text-red-400 text-xs">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{searchError}</span>
            <button type="button" className="toolbar-btn ml-auto" onClick={() => { void handleSearch(); }}>Retry</button>
          </div>
        )}

        {/* ─── US Coverage Map ────────────────────────── */}
        <div className="panel-raised p-3">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">
              US Coverage Map
            </span>
            {/* Legend — uses the same semantic tokens as the SVG cells so
                the day/night skin re-themes both in lockstep. */}
            <div className="ml-auto flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ background: 'rgb(var(--sev-ok-rgb) / 0.35)', border: '1px solid var(--sev-ok)' }}
                />
                <span className="text-rmpg-400">Active</span>
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ background: 'rgb(var(--sev-warn-rgb) / 0.30)', border: '1px solid var(--sev-warn)' }}
                />
                <span className="text-rmpg-400">Pending</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)' }} />
                <span className="text-rmpg-400">No Source</span>
              </span>
            </div>
          </div>

          {coverageLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 text-rmpg-400 animate-spin" />
              <span className="ml-2 text-xs text-rmpg-400">Loading coverage data...</span>
            </div>
          ) : (
            <div className="relative panel-inset p-2">
              <svg
                viewBox="0 0 576 288"
                className="w-full"
                style={{ maxHeight: isMobile ? 200 : 320 }}
              >
                {STATE_GRID.map(st => {
                  const status = stateCoverage[st.code] as CoverageStatus | undefined;
                  const isHovered = hoveredState === st.code;
                  const isSelected = stateFilter === st.code;
                  const cellW = 44;
                  const cellH = 42;
                  const gap = 2;
                  const xOff = 4;
                  const yOff = 8;
                  const x = xOff + st.col * (cellW + gap);
                  const y = yOff + st.row * (cellH + gap);
                  return (
                    <g
                      key={st.code}
                      onClick={() => handleStateClick(st.code)}
                      onMouseEnter={(e) => {
                        setHoveredState(st.code);
                        const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect();
                        setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top - 10 });
                      }}
                      onMouseLeave={() => setHoveredState(null)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={x}
                        y={y}
                        width={cellW}
                        height={cellH}
                        rx={2}
                        fill={isHovered ? coverageHoverFill(status) : coverageFill(status)}
                        stroke={isSelected ? 'var(--rmpg-400)' : coverageStroke(status)}
                        strokeWidth={isSelected ? 2 : 1}
                        opacity={isHovered ? 1 : 0.85}
                      />
                      <text
                        x={x + cellW / 2}
                        y={y + cellH / 2 + 1}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="pointer-events-none select-none"
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          fontFamily: 'Arial, sans-serif',
                          fill: isSelected ? 'var(--text-secondary)' : coverageTextColor(status),
                        }}
                      >
                        {st.label}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Hover Tooltip */}
              {hoveredState && (
                <div
                  className="absolute pointer-events-none z-30 panel-raised border border-rmpg-700/60 px-2 py-1 shadow-lg"
                  style={{
                    left: tooltipPos.x,
                    top: tooltipPos.y,
                    transform: 'translate(-50%, -100%)',
                  }}
                >
                  <div className="text-[10px] font-bold text-rmpg-100">
                    {US_STATES.find(s => s.code === hoveredState)?.label ?? hoveredState}
                  </div>
                  <div className="text-[10px] text-rmpg-400">
                    Status: <span style={{ color: coverageTextColor(stateCoverage[hoveredState]) }}>
                      {stateCoverage[hoveredState] ?? 'No source'}
                    </span>
                  </div>
                  {coverage?.state_sources?.[hoveredState] && (
                    <div className="text-[10px] text-rmpg-500">
                      {coverage.state_sources[hoveredState]} sources
                    </div>
                  )}
                  {coverage?.state_warrants?.[hoveredState] && (
                    <div className="text-[10px] text-rmpg-500">
                      {coverage.state_warrants[hoveredState].toLocaleString()} active warrants
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── Searching Indicator ────────────────────── */}
        {searching && (
          <div className="panel-raised p-6 flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
            <span className="text-xs text-rmpg-300">
              Searching national warrant databases...
            </span>
          </div>
        )}

        {/* ─── Search Results ─────────────────────────── */}
        {results && !searching && (
          <div className="space-y-3">
            {/* Summary Bar */}
            <div className="panel-raised p-2 flex items-center gap-3">
              <Shield className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-xs text-rmpg-200">
                <span className="font-bold text-rmpg-100">{totalResults}</span> results
                across <span className="font-bold text-rmpg-100">{Object.keys(stateGroups).length + (localResults.length ? 1 : 0)}</span> sources
                in <span className="text-brand-400">{searchTime}ms</span>
              </span>
              {stateFilter && (
                <span className="ml-auto text-[10px] bg-surface-sunken/50 text-rmpg-400 border border-border-default/50 px-1.5 py-0.5 rounded">
                  Filtered: {US_STATES.find(s => s.code === stateFilter)?.label}
                </span>
              )}
            </div>

            {/* Local System Results */}
            {localResults.length > 0 && (
              <div className="panel-raised overflow-hidden">
                <button
                  onClick={() => toggleGroup('LOCAL')}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-brand-900/20 border-b border-brand-700/30 hover:bg-brand-900/30 transition-colors"
                >
                  <ChevronDown className={`w-3 h-3 text-rmpg-400 transition-transform ${collapsedGroups.has('LOCAL') ? '-rotate-90' : ''}`} />
                  <Shield className="w-3.5 h-3.5 text-brand-400" />
                  <span className="text-xs font-bold text-brand-400 uppercase tracking-wider">
                    Local System
                  </span>
                  <span className="ml-1 text-[10px] bg-brand-900/40 text-brand-400 border border-brand-700/50 px-1.5 py-0.5 rounded font-mono">
                    {localResults.length}
                  </span>
                </button>
                {!collapsedGroups.has('LOCAL') && (
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {localResults.map((w: any, i: number) => (
                      <WarrantRow
                        key={`local-${i}`}
                        warrant={w}
                        preparedBy={preparedBy}
                        canPrint={canPrint}
                        highlighted={highlightId ? String(w.id ?? w.warrant_id ?? '') === highlightId : false}
                        onClearHighlight={() => setHighlightId('')}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* State Group Results */}
            {stateGroupKeys.map(stateCode => {
              const warrants = stateGroups[stateCode];
              if (!warrants?.length) return null;
              const stateName = US_STATES.find(s => s.code === stateCode)?.label ?? stateCode;
              const isCollapsed = collapsedGroups.has(stateCode);
              return (
                <div key={stateCode} className="panel-raised overflow-hidden">
                  <button
                    onClick={() => toggleGroup(stateCode)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-surface-raised border-b border-border-default hover:bg-surface-sunken transition-colors"
                  >
                    <ChevronDown className={`w-3 h-3 text-rmpg-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                    <MapPin className="w-3.5 h-3.5 text-rmpg-400" />
                    <span className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">
                      {stateName}
                    </span>
                    <span className="ml-1 text-[10px] bg-surface-sunken/50 text-rmpg-400 border border-border-default/50 px-1.5 py-0.5 rounded font-mono">
                      {warrants.length}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="divide-y divide-[var(--border-subtle)]">
                      {warrants.map((w: any, i: number) => (
                        <WarrantRow
                          key={`${stateCode}-${i}`}
                          warrant={w}
                          preparedBy={preparedBy}
                          canPrint={canPrint}
                          highlighted={highlightId ? String(w.id ?? w.warrant_id ?? '') === highlightId : false}
                          onClearHighlight={() => setHighlightId('')}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* No Results — post-search empty state */}
            {totalResults === 0 && (
              <div className="panel-raised p-8 text-center">
                <Search className="w-8 h-8 text-rmpg-500 mx-auto mb-2" />
                <div className="text-xs text-rmpg-300 font-medium">No warrants found</div>
                <div className="text-[10px] text-rmpg-400 mt-1">
                  No active warrants match the criteria you entered.
                </div>
                <div className="text-[10px] text-rmpg-500 mt-1">
                  Try broadening your search — fewer fields, looser spelling, or a different state.
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── Idle empty state — not searched yet ─────── */}
        {!results && !searched && !searching && (
          <div className="panel-raised p-8 text-center">
            <Globe className="w-10 h-10 text-rmpg-500 mx-auto mb-3 opacity-40" />
            <div className="text-xs text-rmpg-400">
              Enter search criteria above to query national warrant databases.
            </div>
            <div className="text-[10px] text-rmpg-500 mt-1">
              Searches across {sourceCount}+ sources in {statesCovered} states.
            </div>
            <div className="text-[10px] text-rmpg-600 mt-2">
              Press <kbd className="px-1 py-0.5 bg-surface-sunken border border-border-subtle text-rmpg-500 font-mono text-[9px]">N</kbd> to start typing
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Name helper — prefers structured parts, falls back to full_name ──
const warrantName = (w: any): string =>
  w.last_name
    ? `${String(w.last_name).toUpperCase()}, ${w.first_name ?? ''}`.trim().replace(/,\s*$/, '')
    : (w.full_name ? String(w.full_name).toUpperCase() : 'UNKNOWN');

// ── Warrant Result Row ──────────────────────────────────────
function WarrantRow({
  warrant,
  preparedBy,
  highlighted,
  onClearHighlight,
  canPrint,
}: {
  warrant: any;
  preparedBy?: string;
  highlighted?: boolean;
  onClearHighlight?: () => void;
  canPrint?: boolean;
}) {
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const rowRef = useRef<HTMLDivElement>(null);

  // Scroll the highlighted row into view once on mount. Handles the
  // ?warrant_id= deep-link case where the auto-search result needs to
  // surface without the user having to scroll manually.
  useEffect(() => {
    if (highlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlighted]);

  const openPdf = useCallback(() => {
    openNationalWarrantPdf({ warrant: warrant as NationalWarrantHit, preparedBy });
  }, [warrant, preparedBy]);

  const buildWarrantMenu = (): ContextMenuItem[] => {
    const fullName = warrantName(warrant);
    return [
      {
        label: 'Open court-ready PDF',
        icon: <Printer size={12} />,
        onClick: openPdf,
      },
      m.copy('Copy name', fullName),
      ...(warrant.charges ? [m.copy('Copy charges', warrant.charges)] : []),
      ...(warrant.court ? [m.copy('Copy court', warrant.court, <Gavel size={12} />)] : []),
      ...(warrant.source ? [m.copy('Copy source', warrant.source)] : []),
    ];
  };

  return (
    <div
      ref={rowRef}
      className={`px-3 py-2 hover:bg-surface-sunken transition-colors flex items-start gap-3 ${
        highlighted ? 'ring-1 ring-inset ring-brand-500/60 bg-brand-900/10' : ''
      }`}
      onContextMenu={(e) => openMenu(e, buildWarrantMenu())}
      onClick={highlighted && onClearHighlight ? onClearHighlight : undefined}
    >
      {/* Photo thumbnail */}
      {warrant.photo_url ? (
        <img
          src={warrant.photo_url}
          alt=""
          className="w-10 h-12 rounded object-cover border border-border-default flex-shrink-0"
        />
      ) : (
        <div className="w-10 h-12 rounded bg-surface-sunken border border-border-default flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-rmpg-500" />
        </div>
      )}

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-rmpg-100">
            {warrantName(warrant)}
          </span>
          {warrant.dob && (
            <span className="text-[10px] text-rmpg-400">
              DOB: {formatDate(warrant.dob)}
            </span>
          )}
          {warrant.age && (
            <span className="text-[10px] text-rmpg-500">
              (Age {warrant.age})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {warrant.charges && (
            <span className="text-[10px] text-rmpg-300 truncate max-w-[300px]" title={warrant.charges}>
              {warrant.charges}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {warrant.offense_level && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${severityBadge(warrant.offense_level)}`}>
              {toDisplayLabel(warrant.offense_level)}
            </span>
          )}
          {warrant.warrant_type && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeBadge(warrant.warrant_type)}`}>
              {toDisplayLabel(warrant.warrant_type)}
            </span>
          )}
          {warrant.court && (
            <span className="text-[10px] text-rmpg-500 flex items-center gap-0.5">
              <Gavel className="w-2.5 h-2.5" />
              {warrant.court}
            </span>
          )}
          {warrant.source && (
            <span className="text-[10px] bg-surface-sunken text-rmpg-500 border border-border-default px-1.5 py-0.5 rounded">
              {warrant.source}
            </span>
          )}
        </div>
      </div>

      {/* Warrant status indicator */}
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        {warrant.status === 'active' && (
          <span className="flex items-center gap-1 text-[10px] text-red-400">
            <AlertTriangle className="w-3 h-3" />
            Active
          </span>
        )}
        {warrant.issued_date && (
          <span className="text-[10px] text-rmpg-500">
            Issued: {formatDate(warrant.issued_date)}
          </span>
        )}
        {Number.isFinite(Number(warrant.bond_amount)) && Number(warrant.bond_amount) > 0 && (
          <span className="text-[10px] text-amber-400 font-mono">
            Bond: ${Number(warrant.bond_amount).toLocaleString()}
          </span>
        )}
        {/* Court-ready PDF — gated to admin/manager (canPrint). Same path
            as the right-click "Open court-ready PDF" context-menu item. */}
        {canPrint && (
          <button
            type="button"
            onClick={openPdf}
            className="toolbar-btn text-rmpg-400 hover:text-brand-400 px-1.5 py-0.5 text-[10px] flex items-center gap-1"
            title="Open a court-ready PDF for this warrant hit"
            aria-label={`Open court-ready PDF for ${warrantName(warrant)}`}
          >
            <Printer className="w-3 h-3" />
            PDF
          </button>
        )}
      </div>
    </div>
  );
}

// ── Mock Data for Development ───────────────────────────────
// Mock data functions removed — only real API data is displayed
