// ============================================================
// RMPG Flex — Criminal History Standalone Page
// Search persons by name/DOB/DL, view caution flags, and display
// chronological criminal history timeline.
//
// v1160 improvements:
// - N shortcut focuses search input (when not typing).
// - ConfirmDialog before generating court-ready PDF (sensitive doc gate).
// - Role gate: Print/Export restricted to admin/manager/supervisor.
// - Esc cascade extended: printConfirm → person deselect.
//
// v1088 improvements:
// - Fix search API: name → /records/persons/search?q=  (FK-accurate).
//   Previously the page sent ?name=/?dob=/?dl= params that the server
//   does not read, so every name search silently returned the full
//   500-person unfiltered list.
// - Switch history fetch to /records/persons/:id/system-history (one
//   round-trip, FK-joined — incidents/warrants/citations/calls are now
//   accurate to the person record, not a loose name-text search).
// - Add CriminalHistorySection panel (formal arrest/conviction records
//   from the criminal_history table — previously absent from this page).
// - Add WarrantNsopwStatus panel (NSOPW nationwide SOR cross-reference).
// - Esc smart-cascade: Esc while person selected → back to list.
// - ?subject= URL param: pre-fills name search box (complements ?person_id=).
// - Fix useCallback dependency arrays (selectPerson/handleSearch).
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { Search, AlertTriangle, User, Shield, Calendar, MapPin, FileText, ChevronRight, Scale, List, Clock, Loader2, Eye, Printer } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { toDisplayLabel } from '../utils/formatters';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { formatAddressDisplay } from '../utils/statusLabels';
import { parseTimestamp } from '../utils/dateUtils';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { openCriminalHistoryPdf } from '../utils/criminalHistoryPdf';
import CriminalHistorySection from '../components/CriminalHistorySection';
import WarrantNsopwStatus from '../components/WarrantNsopwStatus';
import ConfirmDialog from '../components/ConfirmDialog';
import { historyTimelineToCsv, downloadTextFile } from '../utils/rmsListExport';

const MANAGE_ROLES = new Set(['admin', 'manager', 'supervisor']);

interface PersonResult {
  id: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  date_of_birth?: string;
  dob?: string;
  sex?: string;
  gender?: string;
  race?: string;
  drivers_license?: string;
  dl_number?: string;
  dl_state?: string;
  caution_flags?: string;
  is_sex_offender?: boolean;
  has_active_warrants?: boolean;
  address?: string;
  phone?: string;
}

interface HistoryEntry {
  id: string;
  type: 'incident' | 'citation' | 'field_interview' | 'warrant' | 'call';
  date: string;
  reference_number: string;
  description: string;
  status: string;
  officer_name?: string;
  location?: string;
}

// system-history response shape from /records/persons/:id/system-history
interface SystemHistory {
  warrants: any[];
  incidents: any[];
  calls: any[];
  citations: any[];
  summary: {
    total_warrants: number;
    active_warrants: number;
    total_incidents: number;
    total_calls: number;
    total_citations: number;
    active_citations: number;
  };
}

function normPerson(p: any): PersonResult {
  return {
    ...p,
    // server returns dob on the bulk list, date_of_birth on full detail
    date_of_birth: p.date_of_birth || p.dob || undefined,
    // server returns dl_number on bulk list, drivers_license on full detail
    drivers_license: p.drivers_license || p.dl_number || undefined,
    sex: p.sex || p.gender || undefined,
  };
}

export default function CriminalHistoryPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManage = MANAGE_ROLES.has(user?.role ?? '');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [printConfirmOpen, setPrintConfirmOpen] = useState(false);

  // ?subject= pre-fills the name search box
  const subjectParam = searchParams.get('subject') || '';
  const [searchQuery, setSearchQuery] = useState(subjectParam);
  const [searchType, setSearchType] = useState<'name' | 'dob' | 'dl'>('name');
  const [persons, setPersons] = useState<PersonResult[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PersonResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'timeline'>('table');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  // Distinguishes "haven't searched yet" from "search ran and returned zero":
  // the placeholder copy is different so the operator can tell which.
  const [lastSearchedQuery, setLastSearchedQuery] = useState<string | null>(null);

  // ── Keyboard shortcuts ──
  // N focuses the search input (when not already typing).
  // Esc cascade: printConfirm → person deselect.
  useEffect(() => {
    const isTypingInField = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    };

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (printConfirmOpen) { e.stopPropagation(); setPrintConfirmOpen(false); return; }
        if (selectedPerson) { e.stopPropagation(); setSelectedPerson(null); setHistory([]); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingInField(e.target)) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [printConfirmOpen, selectedPerson]);

  const handleSearch = useCallback(async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    setLoading(true);
    setFetchError('');
    setLastSearchedQuery(trimmed);
    try {
      let data: any;
      if (searchType === 'name') {
        // /records/persons/search?q= does a proper LIKE across name/alias/phone
        // and returns a bare array.
        data = await apiFetch<any>(`/records/persons/search?q=${encodeURIComponent(trimmed)}`);
      } else {
        // Fall back to the bulk list endpoint with the correct `search` param.
        // The server's GET /records/persons reads ?search= (not ?dob=/?dl=),
        // so DOB and DL searches also go through the generic LIKE path.
        data = await apiFetch<any>(`/records/persons?search=${encodeURIComponent(trimmed)}`);
      }
      // Normalize envelope variants (bare array, { data: [] }, { results: [] }, { persons: [] })
      const list: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.data) ? data.data
        : Array.isArray(data?.results) ? data.results
        : Array.isArray(data?.persons) ? data.persons
        : [];
      setPersons(list.map(normPerson));
      setSelectedPerson(null);
      setHistory([]);
    } catch (err: any) {
      setFetchError(err?.message || 'Failed to load data');
      addToast('Failed to search persons', 'error');
      setPersons([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, searchType, addToast]);

  const selectPerson = useCallback(async (person: PersonResult) => {
    setSelectedPerson(person);
    setHistoryLoading(true);
    try {
      // Single round-trip via /system-history which FK-joins all related records.
      // Previously the page made 4 separate fetches using fuzzy name-text search
      // for citations and FIs — those returned records for anyone with a similar
      // name, not just this person. The system-history endpoint uses person_id
      // FK joins throughout, so the history is now accurate to the subject.
      const sh = await apiFetch<SystemHistory>(`/records/persons/${person.id}/system-history`).catch(() => ({
        warrants: [], incidents: [], calls: [], citations: [],
        summary: { total_warrants: 0, active_warrants: 0, total_incidents: 0, total_calls: 0, total_citations: 0, active_citations: 0 },
      }));

      const entries: HistoryEntry[] = [];

      // Incidents
      (sh.incidents || []).forEach((inc: any) => {
        entries.push({
          id: String(inc.id),
          type: 'incident',
          date: inc.created_at || '',
          reference_number: inc.incident_number || '',
          description: `${toDisplayLabel(inc.incident_type || '').toUpperCase()}${inc.location_address ? ` — ${inc.location_address}` : ''}`,
          status: inc.status || '',
          location: inc.location_address,
        });
      });

      // Calls for service
      (sh.calls || []).forEach((call: any) => {
        entries.push({
          id: String(call.id),
          type: 'call',
          date: call.created_at || '',
          reference_number: call.call_number || '',
          description: `${toDisplayLabel(call.incident_type || 'Call').toUpperCase()}${call.location_address ? ` — ${call.location_address}` : ''}`,
          status: call.status || '',
          location: call.location_address,
        });
      });

      // Citations
      (sh.citations || []).forEach((cit: any) => {
        entries.push({
          id: String(cit.id),
          type: 'citation',
          date: cit.violation_date || cit.created_at || '',
          reference_number: cit.citation_number || '',
          description: cit.violation_description || 'Citation',
          status: cit.status || '',
        });
      });

      // Warrants — the system-history endpoint returns ALL warrant statuses;
      // surface them all so the operator sees the full picture.
      (sh.warrants || []).forEach((w: any) => {
        entries.push({
          id: String(w.id),
          type: 'warrant',
          date: w.issued_date || w.created_at || '',
          reference_number: w.warrant_number || `WAR-${w.id}`,
          description: w.description
            || w.charge_description
            || `${(w.type || w.warrant_type || 'Warrant').toString().toUpperCase()}`,
          status: w.status || 'active',
        });
      });

      entries.sort((a, b) => {
        const ta = a.date ? parseTimestamp(a.date).getTime() : 0;
        const tb = b.date ? parseTimestamp(b.date).getTime() : 0;
        return (tb || 0) - (ta || 0);
      });
      setHistory(entries);
    } catch (err) {
      addToast('Failed to load criminal history', 'error');
      setHistory([]);
    }
    setHistoryLoading(false);
  }, [addToast]);

  const openUtahCourts = useCallback((person?: PersonResult | null) => {
    const base = 'https://www.utcourts.gov/xchange/CaseSearch';
    const params = new URLSearchParams();
    if (person) {
      if (person.last_name) params.set('lastName', person.last_name);
      if (person.first_name) params.set('firstName', person.first_name);
    }
    const url = params.toString() ? `${base}?${params}` : base;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const buildPersonMenu = (p: PersonResult): ContextMenuItem[] => {
    const fullName = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    return [
      m.action('View criminal history', () => selectPerson(p), { icon: <Eye size={12} /> }),
      m.action('Search Utah Courts', () => openUtahCourts(p), { icon: <Scale size={12} /> }),
      m.separator(),
      m.copy('Copy name', fullName),
      m.copyId(p.id),
      ...(p.drivers_license ? [m.copy('Copy DL #', p.drivers_license)] : []),
    ];
  };

  const cautionFlags = selectedPerson?.caution_flags ? selectedPerson.caution_flags.split(',').map(f => f.trim()).filter(Boolean) : [];

  const typeIcon = (type: string) => {
    switch (type) {
      case 'incident': return <FileText className="w-3 h-3 text-brand-400" />;
      case 'citation': return <Shield className="w-3 h-3 text-amber-400" />;
      case 'field_interview': return <User className="w-3 h-3 text-purple-400" />;
      case 'warrant': return <AlertTriangle className="w-3 h-3 text-red-400" />;
      case 'call': return <FileText className="w-3 h-3 text-rmpg-400" />;
      default: return <FileText className="w-3 h-3 text-rmpg-400" />;
    }
  };

  const typeColor = (type: string) => {
    switch (type) {
      case 'incident': return 'text-brand-400 bg-brand-900/30 border-brand-700/50';
      case 'citation': return 'text-amber-400 bg-amber-900/30 border-amber-700/50';
      case 'field_interview': return 'text-purple-400 bg-purple-900/30 border-purple-700/50';
      case 'warrant': return 'text-red-400 bg-red-900/30 border-red-700/50';
      case 'call': return 'text-rmpg-400 bg-rmpg-700/30 border-rmpg-600/50';
      default: return 'text-rmpg-400 bg-rmpg-700/30 border-rmpg-600/50';
    }
  };

  // Set document title
  useEffect(() => { document.title = 'Criminal History — RMPG Flex'; }, []);

  // ── ?person_id=<id> URL deep-link auto-select ──
  // From Person Dossier / NCIC subject-history → "view criminal history" lands
  // here pre-selected. Fetches the single person + calls selectPerson; strips
  // the param so a refresh doesn't re-fetch.
  const pendingPersonIdRef = useRef<string | null>(searchParams.get('person_id'));
  useEffect(() => {
    const target = pendingPersonIdRef.current;
    if (!target) return;
    pendingPersonIdRef.current = null;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<any>(`/records/persons/${target}`);
        const person: PersonResult | null = data && data.id != null
          ? normPerson(data)
          : data?.data && data.data.id != null
            ? normPerson(data.data)
            : null;
        if (cancelled || !person) {
          if (!cancelled) addToast(`Person ${target} not found`, 'warning');
          return;
        }
        setPersons([person]);
        setLastSearchedQuery(`#${target}`);
        await selectPerson(person);
      } catch {
        if (!cancelled) addToast(`Failed to load person ${target}`, 'error');
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('person_id');
          next.delete('subject');
          setSearchParams(next, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ?subject= pre-populate: if set, fire search immediately ──
  const didAutoSearchRef = useRef(false);
  useEffect(() => {
    if (didAutoSearchRef.current) return;
    if (subjectParam && !pendingPersonIdRef.current) {
      didAutoSearchRef.current = true;
      // Clear the param without disrupting the URL
      const next = new URLSearchParams(searchParams);
      next.delete('subject');
      setSearchParams(next, { replace: true });
      // Fire the search with the pre-filled value
      const trimmed = subjectParam.trim();
      if (!trimmed) return;
      setLoading(true);
      setLastSearchedQuery(trimmed);
      apiFetch<any>(`/records/persons/search?q=${encodeURIComponent(trimmed)}`)
        .then((data: any) => {
          const list: any[] = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
          setPersons(list.map(normPerson));
        })
        .catch(() => addToast('Failed to search persons', 'error'))
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full flex flex-col bg-surface-base text-rmpg-100 overflow-hidden">
      {fetchError && (
        <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 text-red-400 text-xs flex items-center gap-2" role="alert">
          <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
          <span className="flex-1">{fetchError}</span>
          <button type="button" onClick={() => { setFetchError(''); void handleSearch(); }} className="ml-auto text-red-300 hover:text-red-100 text-[10px]" aria-label="Retry search">Retry</button>
        </div>
      )}
      {!isMobile && <PanelTitleBar title="Criminal History" icon={Shield}>
        <div className="flex items-center gap-2">
          <select id="ff-criminalhistorypage-0"
            className="select-dark text-[10px] w-24 min-h-[36px]"
            value={searchType}
            onChange={(e) => setSearchType(e.target.value as any)}
          >
            <option value="name">Name</option>
            <option value="dob">DOB</option>
            <option value="dl">DL #</option>
          </select>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400" />
            <input id="ff-criminalhistorypage-1"
              ref={searchInputRef}
              type="text"
              className="input-dark pl-7 text-[11px] w-64 min-h-[36px]"
              placeholder={searchType === 'name' ? 'Last, First...' : searchType === 'dob' ? 'YYYY-MM-DD...' : 'DL Number...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <button type="button" onClick={handleSearch} disabled={loading} className="toolbar-btn toolbar-btn-primary print:hidden">
            {loading ? 'Searching...' : 'Search'}
          </button>
          <button type="button" onClick={() => openUtahCourts()} className="toolbar-btn" title="Search Utah Courts Xchange (opens in new tab)">
            <Scale className="w-3 h-3" /> Utah Courts
          </button>
          <button
            type="button"
            className="toolbar-btn"
            disabled={history.length === 0}
            onClick={() => downloadTextFile('criminal-history-timeline.csv', historyTimelineToCsv(history))}
            title="CSV of type, date, reference — no names or DOB"
          >CSV</button>
        </div>
      </PanelTitleBar>}

      {/* Mobile search bar */}
      {isMobile && (
        <div className="flex items-center gap-1.5 px-3 py-2 flex-shrink-0" style={{ background: 'var(--surface-overlay)', borderBottom: '1px solid var(--border-default)' }}>
          <select id="ff-criminalhistorypage-2" className="select-dark text-[10px] w-16 min-h-[36px]" value={searchType} onChange={(e) => setSearchType(e.target.value as any)}>
            <option value="name">Name</option>
            <option value="dob">DOB</option>
            <option value="dl">DL #</option>
          </select>
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-400" />
            <input id="ff-criminalhistorypage-3"
              type="text"
              className="input-dark pl-6 text-[10px] w-full min-h-[36px]"
              placeholder={searchType === 'name' ? 'Last, First...' : searchType === 'dob' ? 'YYYY-MM-DD...' : 'DL Number...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <button type="button" onClick={handleSearch} disabled={loading} className="toolbar-btn toolbar-btn-primary text-[9px] px-2">
            {loading ? '...' : 'Go'}
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Person Results List */}
        <div className={`${isMobile ? (selectedPerson ? 'hidden' : 'w-full') : 'w-1/3'} border-r border-rmpg-700/50 overflow-auto`}>
          {persons.length === 0 && !loading && (
            // Distinguish "no search yet" from "search ran and returned zero"
            <div className="flex items-center justify-center h-full text-rmpg-500 text-[10px]">
              <div className="text-center max-w-[280px]">
                <Search className="w-7 h-7 mx-auto mb-2 text-rmpg-600" />
                {lastSearchedQuery ? (
                  <>
                    <p className="font-mono uppercase tracking-wider text-rmpg-400">No persons match</p>
                    <p className="font-mono text-rmpg-200 mt-1 break-words">"{lastSearchedQuery}"</p>
                    <p className="text-[9px] text-rmpg-500 mt-2 normal-case tracking-normal">
                      Try a shorter / partial name, or switch the search type
                      to DOB (<span className="font-mono">YYYY-MM-DD</span>) or DL number.
                    </p>
                  </>
                ) : (
                  <p className="font-mono uppercase tracking-wider">Search for a person to view criminal history</p>
                )}
              </div>
            </div>
          )}
          {(Array.isArray(persons) ? persons : []).map(p => (
            <button type="button"
              key={p.id}
              onClick={() => selectPerson(p)}
              onContextMenu={(e) => openMenu(e, buildPersonMenu(p))}
              className={`w-full text-left px-3 py-2 border-b border-rmpg-800/30 transition-all duration-150 ${
                selectedPerson?.id === p.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/20 border-l-2 border-l-transparent'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-rmpg-100">
                  {p.last_name}, {p.first_name} {p.middle_name || ''}
                </span>
                <ChevronRight className="w-3 h-3 text-rmpg-500" />
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-400">
                {p.date_of_birth && <span>DOB: {p.date_of_birth}</span>}
                {p.sex && <span>{toDisplayLabel(p.sex)}</span>}
                {p.race && <span>{toDisplayLabel(p.race)}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                {p.has_active_warrants && (
                  <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-red-900/50 text-red-400 border border-red-700/50">WARRANTS</span>
                )}
                {p.is_sex_offender && (
                  <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-red-900/50 text-red-400 border border-red-700/50">SEX OFFENDER</span>
                )}
                {p.caution_flags && (
                  <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-amber-900/50 text-amber-400 border border-amber-700/50">CAUTION</span>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Person Detail + History */}
        <div className={`${isMobile ? (selectedPerson ? 'w-full' : 'hidden') : 'flex-1'} overflow-auto`}>
          {selectedPerson ? (
            <div className={`${isMobile ? 'p-3 space-y-3' : 'p-4 space-y-4'}`}>
              {/* Mobile back button */}
              {isMobile && (
                <button type="button" onClick={() => { setSelectedPerson(null); setHistory([]); }}
                  className="text-rmpg-400 hover:text-rmpg-100 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <ChevronRight className="w-3 h-3 rotate-180" /> Back to Results
                </button>
              )}
              {/* Person Card */}
              <div className="panel-surface p-4">
                <div className={`${isMobile ? '' : 'flex items-start justify-between'}`}>
                  <div>
                    <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-black text-rmpg-100`}>
                      {selectedPerson.last_name}, {selectedPerson.first_name} {selectedPerson.middle_name || ''}
                    </h2>
                    <div className="flex items-center gap-4 mt-1 text-[10px] text-rmpg-300 flex-wrap">
                      {selectedPerson.date_of_birth && (
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> DOB: {selectedPerson.date_of_birth}</span>
                      )}
                      {selectedPerson.sex && <span>Sex: {selectedPerson.sex}</span>}
                      {selectedPerson.race && <span>Race: {selectedPerson.race}</span>}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-[10px] text-rmpg-400">
                      {selectedPerson.drivers_license && <span>DL: {selectedPerson.drivers_license} ({selectedPerson.dl_state || 'UT'})</span>}
                      {selectedPerson.address && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{selectedPerson.address}</span>}
                    </div>
                  </div>
                  <div className="text-right space-y-1">
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold">Record ID</span>
                    <p className="text-sm font-mono text-brand-400 font-bold">{selectedPerson.id}</p>
                    <div className="flex justify-end gap-1">
                      {/* Court-ready PDF — subject card + caution flags +
                          5-up summary tiles + chronological history table +
                          signature block. */}
                      {canManage && (
                        <button type="button"
                          onClick={() => setPrintConfirmOpen(true)}
                          className="toolbar-btn text-[9px] gap-1"
                          title="Open a printable criminal-history PDF for this subject (admin/manager/supervisor only)"
                          disabled={historyLoading}
                        >
                          <Printer className="w-3 h-3" /> Print
                        </button>
                      )}
                      <button type="button"
                        onClick={() => openUtahCourts(selectedPerson)}
                        className="toolbar-btn text-[9px] gap-1"
                        title="Search Utah Courts Xchange for this person"
                      >
                        <Scale className="w-3 h-3" /> Utah Courts
                      </button>
                    </div>
                  </div>
                </div>

                {/* Caution Flags */}
                {cautionFlags.length > 0 && (
                  <div className="mt-3 p-2 bg-red-900/20 border border-red-700/50">
                    <div className="flex items-center gap-1.5 mb-1">
                      <AlertTriangle className="w-3 h-3 text-red-400" />
                      <span className="text-[9px] font-bold text-red-400 uppercase tracking-wider">Caution Flags</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {cautionFlags.map((flag, i) => (
                        <span key={i} className="text-[9px] font-bold uppercase px-1.5 py-0.5 bg-red-900/50 text-red-300 border border-red-700/50">
                          {flag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* NSOPW — Nationwide Sex Offender Registry cross-reference.
                  Always shown when a person is selected so the operator never
                  has to navigate away for SOR status. personId must be a
                  number; guard against legacy string ids that aren't numeric. */}
              {!isNaN(Number(selectedPerson.id)) && (
                <WarrantNsopwStatus personId={Number(selectedPerson.id)} />
              )}

              {/* Formal criminal_history table records (arrests/convictions/charges).
                  This is the dedicated CRUD panel that lives in ArrestRecordsPage
                  and PersonsTab — surfaced here so officers can see and annotate
                  formal records without leaving the criminal history workflow. */}
              <CriminalHistorySection
                personId={selectedPerson.id}
                personName={`${selectedPerson.first_name || ''} ${selectedPerson.last_name || ''}`.trim()}
              />

              {/* Operational event history (incidents + calls + citations + warrants) */}
              <div className="panel-surface p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">
                    Operational History — {history.length} records
                  </h3>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setViewMode('table')}
                      className={`text-[9px] px-2 py-0.5 border ${viewMode === 'table' ? 'bg-brand-900/30 text-brand-300 border-brand-600/50' : 'text-rmpg-500 border-rmpg-700 hover:text-rmpg-300'}`}>
                      <List className="w-3 h-3 inline mr-0.5" />Table
                    </button>
                    <button type="button" onClick={() => setViewMode('timeline')}
                      className={`text-[9px] px-2 py-0.5 border ${viewMode === 'timeline' ? 'bg-brand-900/30 text-brand-300 border-brand-600/50' : 'text-rmpg-500 border-rmpg-700 hover:text-rmpg-300'}`}>
                      <Clock className="w-3 h-3 inline mr-0.5" />Timeline
                    </button>
                  </div>
                </div>

                {historyLoading ? (
                  <div className="flex items-center justify-center gap-2 py-6">
                    <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
                    <span className="text-rmpg-400 text-[10px] font-mono uppercase tracking-wider animate-pulse">Loading history...</span>
                  </div>
                ) : history.length === 0 ? (
                  <div className="text-center py-6">
                    <Shield className="w-6 h-6 mx-auto mb-2 text-rmpg-600" />
                    <p className="text-rmpg-500 text-[10px] font-mono uppercase tracking-wider">No operational history on file</p>
                  </div>
                ) : viewMode === 'table' ? (
                  <div className="space-y-1">
                    {history.map((entry) => (
                      <div key={`${entry.type}-${entry.id}`} className="flex items-start gap-3 py-2 border-b border-rmpg-800/30">
                        <div className="mt-0.5">{typeIcon(entry.type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border ${typeColor(entry.type)}`}>
                              {toDisplayLabel(entry.type).toUpperCase()}
                            </span>
                            <span className="text-[10px] font-mono font-bold text-rmpg-200">{entry.reference_number}</span>
                            <span className="text-[9px] text-rmpg-500">{entry.date ? parseTimestamp(entry.date).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : ''}</span>
                          </div>
                          <p className="text-[10px] text-rmpg-300 mt-0.5 truncate">{entry.description}</p>
                          <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500">
                            {entry.status && <span>Status: {toDisplayLabel(entry.status)}</span>}
                            {entry.officer_name && <span>Officer: {entry.officer_name}</span>}
                            {entry.location && <span><MapPin className="w-2.5 h-2.5 inline" /> {formatAddressDisplay(entry.location)}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Visual Timeline View */
                  <div className="relative pl-6">
                    {/* Vertical line */}
                    <div className="absolute left-2 top-0 bottom-0 w-px bg-rmpg-700" />
                    {history.map((entry) => {
                      const isExpanded = expandedEntry === `${entry.type}-${entry.id}`;
                      const dotColor = entry.type === 'incident' ? 'bg-brand-500' : entry.type === 'citation' ? 'bg-amber-500' :
                        entry.type === 'field_interview' ? 'bg-purple-500' : entry.type === 'warrant' ? 'bg-red-500' : 'bg-rmpg-500';
                      return (
                        <div key={`${entry.type}-${entry.id}`} className="relative mb-4">
                          {/* Dot on timeline */}
                          <div className={`absolute -left-[15px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-surface-base ${dotColor}`} />
                          {/* Date label */}
                          <div className="text-[9px] font-mono text-rmpg-500 mb-0.5">
                            {entry.date ? parseTimestamp(entry.date).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown date'}
                          </div>
                          {/* Card */}
                          <button type="button" onClick={() => setExpandedEntry(isExpanded ? null : `${entry.type}-${entry.id}`)}
                            className={`w-full text-left p-2.5 border transition-colors ${isExpanded ? 'bg-rmpg-800/60 border-rmpg-600' : 'bg-surface-sunken border-rmpg-800/50 hover:bg-rmpg-800/30'}`}>
                            <div className="flex items-center gap-2">
                              {typeIcon(entry.type)}
                              <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border ${typeColor(entry.type)}`}>
                                {toDisplayLabel(entry.type).toUpperCase()}
                              </span>
                              <span className="text-[10px] font-mono font-bold text-rmpg-200">{entry.reference_number}</span>
                            </div>
                            <p className="text-[10px] text-rmpg-300 mt-1">{entry.description}</p>
                            {isExpanded && (
                              <div className="mt-2 pt-2 border-t border-rmpg-700 space-y-1">
                                {entry.status && <div className="text-[9px] text-rmpg-400">Status: <span className="text-rmpg-100">{toDisplayLabel(entry.status)}</span></div>}
                                {entry.officer_name && <div className="text-[9px] text-rmpg-400">Officer: <span className="text-rmpg-100">{entry.officer_name}</span></div>}
                                {entry.location && <div className="text-[9px] text-rmpg-400 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />{formatAddressDisplay(entry.location)}</div>}
                              </div>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-rmpg-500 text-[10px]">
              <div className="text-center">
                <User className="w-10 h-10 mx-auto mb-2 text-rmpg-600" />
                <p>Select a person to view their criminal history</p>
                <p className="text-[9px] text-rmpg-600 mt-1">Press Esc at any time to return to the results list</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        isOpen={printConfirmOpen}
        onClose={() => setPrintConfirmOpen(false)}
        onConfirm={() => {
          setPrintConfirmOpen(false);
          openCriminalHistoryPdf({
            subject: selectedPerson as any,
            history: history as any,
            preparedBy: user
              ? (`${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username)
              : undefined,
          });
        }}
        title="Generate Criminal History PDF"
        message={`Generate and open a court-ready criminal history PDF for ${selectedPerson ? `${selectedPerson.last_name}, ${selectedPerson.first_name}` : 'this subject'}?`}
        details="This document includes all caution flags, formal criminal records, and operational history. Ensure this access is authorized and logged."
        confirmLabel="Generate PDF"
        confirmVariant="default"
      />
    </div>
  );
}
