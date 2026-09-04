// ============================================================
// RMPG Flex — Skip Tracker Page
// Standalone skip-tracing search against the local D1 person corpus
// (the legacy Microbilt RapidAPI round-trip is no longer wired — the
// VPS the upstream proxy lived on was decommissioned 2026-06-15).
// Supports search by name, address, phone, email, and combined
// name+address. Every search is audit-logged server-side.
//
// Page 48 of the full-app frontend pass — brings the page up to the
// audit-series contract: URL deep-link, ConfirmDialog (no native
// confirm()), Esc smart-cascade, `N` shortcut for new search,
// per-user search-history scoping (DlSearch #1601 pattern), court-
// ready investigator-handoff PDF, and a hardened empty-state.
// ============================================================

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  Search, User, MapPin, Phone, Mail, Loader2, ChevronRight,
  AlertCircle, ExternalLink, Copy, CheckCircle2, Hash,
  ChevronLeft, ChevronDown, Eye, Plus, FileText,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import { useAuth } from '../context/AuthContext';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import ExportButton from '../components/ExportButton';
import { safeDateStr } from '../utils/dateUtils';
import { openSkipTracerReportPdf } from '../utils/skipTracerReportPdf';
import { withAlpha } from '../utils/withAlpha';
import { toDisplayLabel } from '../utils/formatters';

// Search modes
type SearchMode = 'name' | 'address' | 'nameaddress' | 'phone' | 'email';

// Per-mode accent chips use CSS variable tokens so they re-theme with
// day/night automatically. Mappings: address → sev-ok (green),
// nameaddress → sev-special (purple), phone → sev-warn (amber),
// email → sev-info (blue). The icon background derives from the theme
// so the chip stays legible in both skins.
const SEARCH_MODES: { id: SearchMode; label: string; icon: React.ElementType; color: string; description: string }[] = [
  { id: 'name', label: 'By Name', icon: User, color: 'var(--text-secondary)', description: 'Search by full name (first and last)' },
  { id: 'address', label: 'By Address', icon: MapPin, color: 'var(--sev-ok)', description: 'Search by street address' },
  { id: 'nameaddress', label: 'Name + Address', icon: Search, color: 'var(--sev-special)', description: 'Search by name and address combined' },
  { id: 'phone', label: 'By Phone', icon: Phone, color: 'var(--sev-warn)', description: 'Reverse phone lookup' },
  { id: 'email', label: 'By Email', icon: Mail, color: 'var(--sev-info)', description: 'Search by email address' },
];

// Clipboard copy helper
function useCopyToClipboard() {
  const [copied, setCopied] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const copy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(null), 1500);
  }, []);
  return { copied, copy };
}

interface SearchHistoryEntry {
  query: string;
  mode: SearchMode;
  date: string;
  count: number;
}

export default function SkipTracerPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { copied, copy } = useCopyToClipboard();
  const { openMenu } = useContextMenu();
  const menu = useMenuActions();
  const { user } = useAuth();

  // Role gates — CSV audit-export limited to admin/manager.
  const canExport = useMemo(() => user?.role === 'admin' || user?.role === 'manager', [user?.role]);

  // ── Search state ──
  const [mode, setMode] = useState<SearchMode>('name');
  const [nameQuery, setNameQuery] = useState('');
  const [addressQuery, setAddressQuery] = useState('');
  const [phoneQuery, setPhoneQuery] = useState('');
  const [emailQuery, setEmailQuery] = useState('');
  const [page, setPage] = useState(1);

  // Results
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<any>(null);
  // Person details via ID
  const [personDetail, setPersonDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Confirm dialog — replaces the silent localStorage destroy that
  // previously fired off the "Clear" link with zero confirmation.
  const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);

  const handleSearch = useCallback(async (overridePage?: number) => {
    setLoading(true);
    setError(null);
    setSelected(null);
    setPersonDetail(null);

    const pg = overridePage || page;

    try {
      let data: any;
      switch (mode) {
        case 'name':
          if (!nameQuery.trim()) throw new Error('Enter a name to search');
          data = await apiFetch(`/skiptracer/search/byname?name=${encodeURIComponent(nameQuery.trim())}&page=${pg}`);
          break;
        case 'address':
          if (!addressQuery.trim()) throw new Error('Enter an address to search');
          data = await apiFetch(`/skiptracer/search/byaddress?address=${encodeURIComponent(addressQuery.trim())}&page=${pg}`);
          break;
        case 'nameaddress':
          if (!nameQuery.trim() || !addressQuery.trim()) throw new Error('Enter both name and address');
          data = await apiFetch(`/skiptracer/search/bynameaddress?name=${encodeURIComponent(nameQuery.trim())}&address=${encodeURIComponent(addressQuery.trim())}&page=${pg}`);
          break;
        case 'phone':
          if (!phoneQuery.trim()) throw new Error('Enter a phone number');
          data = await apiFetch(`/skiptracer/search/byphone?phone=${encodeURIComponent(phoneQuery.trim())}&page=${pg}`);
          break;
        case 'email':
          if (!emailQuery.trim()) throw new Error('Enter an email address');
          data = await apiFetch(`/skiptracer/search/byemail?email=${encodeURIComponent(emailQuery.trim())}&page=${pg}`);
          break;
      }
      setResults(data);
    } catch (err: any) {
      setError(err?.message || 'Search failed');
      addToast(err?.message || 'Skip trace search failed', 'error');
      setResults(null);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, nameQuery, addressQuery, phoneQuery, emailQuery, page]);

  // ── Per-user search history (DlSearch #1601 pattern) ───────────
  // Storage key is scoped per user.id so a shared MDT doesn't leak
  // one operator's name/phone queries to the next. Falls back to an
  // unscoped key when no user is known (e.g. mid-login first render);
  // in that case writes are skipped entirely so we don't pollute
  // someone else's profile-scoped history later.
  const HISTORY_KEY = user?.id ? `rmpg_skiptracer_history_${user.id}` : null;
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>(() => {
    try {
      if (HISTORY_KEY) {
        const scoped = localStorage.getItem(HISTORY_KEY);
        if (scoped) return JSON.parse(scoped);
        // One-time migration from the v1.0 unscoped key — read once,
        // then nuke the bare key so the next user doesn't see it.
        const legacy = localStorage.getItem('rmpg_skiptracer_history');
        if (legacy) {
          localStorage.setItem(HISTORY_KEY, legacy);
          localStorage.removeItem('rmpg_skiptracer_history');
          return JSON.parse(legacy);
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  const saveSearchToHistory = useCallback((query: string, searchMode: SearchMode, resultCount: number) => {
    if (!HISTORY_KEY) return;
    setSearchHistory(prev => {
      const entry: SearchHistoryEntry = { query, mode: searchMode, date: new Date().toISOString(), count: resultCount };
      const updated = [entry, ...prev.filter(h => !(h.query === query && h.mode === searchMode))].slice(0, 20);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch { /* quota — ignore */ }
      return updated;
    });
  }, [HISTORY_KEY]);

  const clearSearchHistory = useCallback(() => {
    if (HISTORY_KEY) {
      try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
    }
    setSearchHistory([]);
    setShowClearHistoryConfirm(false);
    addToast('Search history cleared', 'success');
  }, [HISTORY_KEY, addToast]);

  // Re-run a past search from the recent list. Uses a flushSync-style
  // ref to bypass the previous setTimeout(0) race (where setState
  // hadn't flushed yet so handleSearch read stale query strings).
  const pendingRerunRef = useRef<{ mode: SearchMode; query: string } | null>(null);
  const rerunSearch = useCallback((entry: { query: string; mode: SearchMode }) => {
    pendingRerunRef.current = { mode: entry.mode, query: entry.query };
    setMode(entry.mode);
    switch (entry.mode) {
      case 'name': setNameQuery(entry.query); break;
      case 'address': setAddressQuery(entry.query); break;
      case 'phone': setPhoneQuery(entry.query); break;
      case 'email': setEmailQuery(entry.query); break;
      case 'nameaddress': setNameQuery(entry.query); break;
    }
    setPage(1);
  }, []);

  // After mode + query inputs flush, fire the deferred search exactly
  // once. The previous setTimeout(handleSearch, 100) raced state flush;
  // this effect waits on the updated handleSearch closure (which depends
  // on the freshly-set query state), then clears the ref.
  useEffect(() => {
    if (!pendingRerunRef.current) return;
    const want = pendingRerunRef.current;
    const queryNow =
      want.mode === 'name' || want.mode === 'nameaddress' ? nameQuery :
      want.mode === 'address' ? addressQuery :
      want.mode === 'phone' ? phoneQuery :
      want.mode === 'email' ? emailQuery : '';
    if (queryNow === want.query && mode === want.mode) {
      pendingRerunRef.current = null;
      handleSearch();
    }
  }, [mode, nameQuery, addressQuery, phoneQuery, emailQuery, handleSearch]);

  // Save to history after successful search
  useEffect(() => {
    if (results && !error) {
      const query = mode === 'name' ? nameQuery : mode === 'address' ? addressQuery : mode === 'phone' ? phoneQuery : mode === 'email' ? emailQuery : nameQuery;
      if (query.trim()) {
        const count = results?.PeopleDetails?.length || results?.data?.length || 0;
        saveSearchToHistory(query.trim(), mode, count);
      }
    }
  }, [results]); // eslint-disable-line react-hooks/exhaustive-deps

  useLiveSync('skiptracer', handleSearch);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    handleSearch(newPage);
  };

  const handleGetPersonDetails = async (id: string) => {
    setLoadingDetail(true);
    try {
      const data = await apiFetch(`/skiptracer/person/${encodeURIComponent(id)}`);
      setPersonDetail(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to get person details');
      addToast('Failed to load person details', 'error');
    } finally {
      setLoadingDetail(false);
    }
  };

  // ── New Search reset ──
  // Single source of truth for "start over" — used by the keyboard
  // shortcut, the empty-state CTA, and the no-results CTA. Clears
  // inputs + results + selection but keeps the active mode (operators
  // typically search the same mode several times in a row).
  const newSearch = useCallback(() => {
    setNameQuery('');
    setAddressQuery('');
    setPhoneQuery('');
    setEmailQuery('');
    setResults(null);
    setSelected(null);
    setPersonDetail(null);
    setError(null);
    setPage(1);
    // Move focus to the first relevant input on next paint.
    setTimeout(() => {
      const id = mode === 'address' ? 'ff-skiptracerpage-1'
        : mode === 'phone' ? 'ff-skiptracerpage-2'
        : mode === 'email' ? 'ff-skiptracerpage-3'
        : 'ff-skiptracerpage-0';
      document.getElementById(id)?.focus();
    }, 0);
  }, [mode]);

  // ── URL deep-link ──
  // Honors the audit-series cross-page contract:
  //   ?subject_id=<n>      — open the person's full-detail pane (calls /person/:id)
  //   ?mode=<name|addr…>   — pre-select a search mode
  //   ?search=<text>       — pre-fill the active mode's input + auto-run
  // Consumed once; the query string is stripped (replace:true) so a
  // hard refresh doesn't re-pin to a stale subject.
  const [searchParams, setSearchParams] = useSearchParams();
  const consumedDeepLinkRef = useRef(false);
  useEffect(() => {
    if (consumedDeepLinkRef.current) return;
    const subjectId = searchParams.get('subject_id');
    const linkMode = searchParams.get('mode') as SearchMode | null;
    const linkSearch = searchParams.get('search');
    if (!subjectId && !linkMode && !linkSearch) return;
    consumedDeepLinkRef.current = true;

    const validMode: SearchMode | null =
      linkMode && ['name', 'address', 'nameaddress', 'phone', 'email'].includes(linkMode)
        ? linkMode : null;
    if (validMode) setMode(validMode);
    if (linkSearch) {
      const effectiveMode = validMode ?? mode;
      switch (effectiveMode) {
        case 'name': case 'nameaddress': setNameQuery(linkSearch); break;
        case 'address': setAddressQuery(linkSearch); break;
        case 'phone': setPhoneQuery(linkSearch); break;
        case 'email': setEmailQuery(linkSearch); break;
      }
      pendingRerunRef.current = { mode: validMode ?? mode, query: linkSearch };
    }

    if (subjectId) {
      handleGetPersonDetails(subjectId).catch(() => { /* toast already fired */ });
    }

    // Strip the params so a refresh doesn't loop.
    const next = new URLSearchParams(searchParams);
    ['subject_id', 'mode', 'search'].forEach(k => next.delete(k));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Build a skip-trace result row context menu ──
  const buildResultMenu = (person: any): ContextMenuItem[] => {
    const name = person.Name || person.name || person.fullName || '';
    const personId = person['Person ID'] || person.personId || '';
    const livesIn = person['Lives in'] || person.livesIn || '';
    return [
      menu.action('Open result', () => setSelected(person), { icon: <Eye size={12} /> }),
      ...(personId ? [menu.action('Full details', () => handleGetPersonDetails(personId), { icon: <ExternalLink size={12} /> })] : []),
      menu.action('Generate PDF report', () => exportSelectedPdf(person), { icon: <FileText size={12} /> }),
      menu.separator(),
      menu.copy('Copy name', name),
      ...(personId ? [menu.copyId(personId)] : []),
      ...(livesIn ? [menu.copy('Copy location', livesIn, <MapPin size={12} />)] : []),
    ];
  };

  // ── PDF: investigator hand-off / court-prep report ──
  // Operators previously had to screenshot the detail pane to file
  // a skip-trace lead in a case folder; this matches the canonical
  // PDF artifact the rest of the audit series ships (DAR, Training,
  // Equipment, Audit Log, Field Interviews, etc.).
  const exportSelectedPdf = useCallback((subject: any) => {
    if (!subject) {
      addToast('No subject selected for export', 'warning');
      return;
    }
    try {
      const officerName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.full_name || user?.username || '';
      const query =
        mode === 'name' || mode === 'nameaddress' ? nameQuery :
        mode === 'address' ? addressQuery :
        mode === 'phone' ? phoneQuery :
        mode === 'email' ? emailQuery : '';
      openSkipTracerReportPdf(subject, {
        query,
        mode,
        officerName: officerName || undefined,
        badgeNumber: user?.badge_number || undefined,
      });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to generate PDF', 'error');
    }
  }, [mode, nameQuery, addressQuery, phoneQuery, emailQuery, user, addToast]);

  // Extract result items — API returns { PeopleDetails: [...] }
  const resultItems: any[] = results?.PeopleDetails || results?.data || results?.result || (Array.isArray(results) ? results : []);
  const totalRecords: number = results?.Records || resultItems.length;

  // ── Esc smart-cascade ──
  // Single press unwinds exactly ONE operator layer (newest-open-first):
  //   1) Clear-history confirm dialog
  //   2) The extended person detail (from "Full details")
  //   3) The selected result row
  //   4) The error banner
  //   5) The whole result set (returns to empty state)
  // Skipped while typing in any input — operators expect Esc to clear the
  // input/blur, not the page state. Matches FlexCam / Geography / DAR.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // ConfirmDialog owns its own Esc handler — only react when it isn't open.
      if (showClearHistoryConfirm) return;
      if (isTypingInField(e.target)) return;
      if (personDetail) { e.stopPropagation(); setPersonDetail(null); return; }
      if (selected) { e.stopPropagation(); setSelected(null); return; }
      if (error) { e.stopPropagation(); setError(null); return; }
      if (results) { e.stopPropagation(); setResults(null); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [personDetail, selected, error, results, showClearHistoryConfirm]);

  // ── `N` shortcut — start a new search ──
  // Suppressed inside any input/textarea/modifier chord/dialog so an
  // operator typing a name containing the letter N doesn't reset the form.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (showClearHistoryConfirm) return;
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      e.preventDefault();
      newSearch();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [newSearch, showClearHistoryConfirm]);

  // ─── Render helpers ─────────────────────────────────────
  const renderCopyButton = (text: string, label: string) => (
    <button type="button"
      onClick={(e) => { e.stopPropagation(); copy(text, label); }}
      className="ml-1 text-rmpg-600 hover:text-rmpg-400 transition-colors"
      title={`Copy ${label}`}
    >
      {copied === label ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );

  const renderFieldRow = (label: string, value: any, copyLabel?: string) => {
    if (!value) return null;
    const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return (
      <div className="flex items-baseline gap-2 py-0.5">
        <span className="text-[9px] text-rmpg-500 uppercase tracking-wider font-bold w-24 shrink-0">{label}</span>
        <span className="text-[11px] text-rmpg-200 font-mono">{strVal}</span>
        {copyLabel && renderCopyButton(strVal, copyLabel)}
      </div>
    );
  };

  // Set document title
  useEffect(() => { document.title = 'Skip Tracker — RMPG Flex'; }, []);

  // ── Empty-state distinction ──
  // Separate "no search yet" from "search ran, 0 hits": the operator
  // needs a clear cue whether to refine the query or whether the
  // record genuinely isn't on file. Before this, "no results found"
  // showed in the same micro-typography as the result counter and was
  // easy to miss.
  const hasSearchRun = results !== null;
  const hasZeroResults = hasSearchRun && resultItems.length === 0;

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PanelTitleBar title="SKIP TRACKER" icon={Search}>
        <button
          type="button"
          onClick={newSearch}
          className="toolbar-btn"
          title="Start a new search (N)"
          aria-label="Start a new search"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New</span>
        </button>
        {selected && (
          <button
            type="button"
            onClick={() => exportSelectedPdf(selected)}
            className="toolbar-btn"
            title="Generate investigator hand-off PDF for the selected subject"
            aria-label="Generate PDF report"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>PDF</span>
          </button>
        )}
        {canExport && <ExportButton exportUrl="/api/skiptracer/export/csv" exportFilename="skip-traces.csv" />}
      </PanelTitleBar>

      <div className={`flex-1 overflow-hidden ${isMobile ? 'flex flex-col' : 'flex'}`}>
        {/* ─── Left Panel: Search Form ──────────────────────── */}
        <div
          className={`${isMobile ? 'flex-shrink-0' : 'w-80'} overflow-y-auto border-r border-rmpg-700`}
          style={{ background: 'var(--surface-overlay)' }}
        >
          {/* Search Mode Selector */}
          <div className="p-3 space-y-3">
            <div className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-2">Search Method</div>
            <div className="grid grid-cols-2 gap-1.5">
              {SEARCH_MODES.map(({ id, label, icon: Icon, color }) => (
                <button type="button"
                  key={id}
                  onClick={() => { setMode(id); setResults(null); setSelected(null); setPage(1); }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-all ${
                    mode === id
                      ? 'bg-surface-base border-rmpg-500 text-rmpg-100'
                      : 'bg-transparent border-rmpg-700 text-rmpg-500 hover:border-rmpg-500 hover:text-rmpg-300'
                  }`}
                >
                  <Icon className="w-3 h-3" style={{ color: mode === id ? color : undefined }} />
                  {label}
                </button>
              ))}
            </div>

            {/* Search Fields */}
            <div className="space-y-2 pt-2">
              {(mode === 'name' || mode === 'nameaddress') && (
                <div>
                  <label htmlFor="ff-skiptracerpage-0" className="block text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">
                    Full Name
                  </label>
                  <input id="ff-skiptracerpage-0"
                    type="text"
                    value={nameQuery}
                    onChange={(e) => setNameQuery(e.target.value)}
                    placeholder="e.g. John Smith"
                    className="w-full bg-surface-base border border-rmpg-600 text-rmpg-100 text-xs px-3 py-1.5 font-mono focus:border-rmpg-500 focus:outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    autoFocus
                  />
                </div>
              )}

              {(mode === 'address' || mode === 'nameaddress') && (
                <div>
                  <label htmlFor="ff-skiptracerpage-1" className="block text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">
                    Address
                  </label>
                  <input id="ff-skiptracerpage-1"
                    type="text"
                    value={addressQuery}
                    onChange={(e) => setAddressQuery(e.target.value)}
                    placeholder="e.g. 123 Main St, Anytown, UT"
                    className="w-full bg-surface-base border border-rmpg-600 text-rmpg-100 text-xs px-3 py-1.5 font-mono focus:border-rmpg-500 focus:outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    autoFocus={mode === 'address'}
                  />
                </div>
              )}

              {mode === 'phone' && (
                <div>
                  <label htmlFor="ff-skiptracerpage-2" className="block text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">
                    Phone Number
                  </label>
                  <input id="ff-skiptracerpage-2"
                    type="text"
                    value={phoneQuery}
                    onChange={(e) => setPhoneQuery(e.target.value)}
                    placeholder="e.g. 801-555-1234"
                    className="w-full bg-surface-base border border-rmpg-600 text-rmpg-100 text-xs px-3 py-1.5 font-mono focus:border-rmpg-500 focus:outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    autoFocus
                  />
                </div>
              )}

              {mode === 'email' && (
                <div>
                  <label htmlFor="ff-skiptracerpage-3" className="block text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">
                    Email Address
                  </label>
                  <input id="ff-skiptracerpage-3"
                    type="text"
                    value={emailQuery}
                    onChange={(e) => setEmailQuery(e.target.value)}
                    placeholder="e.g. john@example.com"
                    className="w-full bg-surface-base border border-rmpg-600 text-rmpg-100 text-xs px-3 py-1.5 font-mono focus:border-rmpg-500 focus:outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    autoFocus
                  />
                </div>
              )}

              <button type="button"
                onClick={() => handleSearch()}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase tracking-wider bg-brand-600 text-rmpg-100 hover:bg-brand-700 disabled:opacity-50 border border-brand-700 transition-colors"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" /> : <Search className="w-3.5 h-3.5" />}
                Search
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs bg-red-900/20 text-red-400 border border-red-700/50" role="alert">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1">{error}</span>
              </div>
            )}

            {/* Result count */}
            {results && !loading && (
              <div className="text-[10px] text-rmpg-400 pt-1 font-mono tabular-nums">
                {resultItems.length > 0
                  ? `Found ${totalRecords} result${totalRecords !== 1 ? 's' : ''} — Page ${results?.Page || page}`
                  : 'No results found'}
              </div>
            )}

            {/* Pagination */}
            {results && resultItems.length >= 10 && (
              <div className="flex items-center gap-2 pt-1">
                <button type="button"
                  onClick={() => page > 1 && handlePageChange(page - 1)}
                  disabled={page <= 1 || loading}
                  className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase bg-surface-base border border-rmpg-600 text-rmpg-400 hover:text-rmpg-100 disabled:opacity-30"
                >
                  <ChevronLeft className="w-3 h-3" /> Prev
                </button>
                <span className="text-[10px] text-rmpg-500 tabular-nums">Page {page}</span>
                <button type="button"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={loading}
                  className="flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase bg-surface-base border border-rmpg-600 text-rmpg-400 hover:text-rmpg-100 disabled:opacity-30"
                >
                  Next <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Keyboard cheat-strip — same place every audited page puts it. */}
            <div className="text-[8px] text-rmpg-600 pt-2 uppercase tracking-wider font-bold">
              N new search · Esc cascade
            </div>
          </div>

          {/* ─── Recent Searches ────────────────────────────── */}
          {searchHistory.length > 0 && (
            <div className="border-t border-rmpg-700 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider">Recent Searches</span>
                <button
                  type="button"
                  onClick={() => setShowClearHistoryConfirm(true)}
                  className="text-[8px] text-rmpg-600 hover:text-red-400 transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {searchHistory.slice(0, 10).map((entry, i) => (
                  <button type="button" key={i} onClick={() => rerunSearch(entry)}
                    className="w-full text-left px-2 py-1.5 text-[10px] bg-surface-sunken border border-rmpg-800 hover:bg-rmpg-800/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <span className="text-rmpg-200 font-mono truncate">{entry.query}</span>
                      <span className="text-[8px] text-rmpg-600 ml-1 shrink-0">{entry.count} results</span>
                    </div>
                    <div className="flex items-center gap-2 text-[8px] text-rmpg-500">
                      <span className="uppercase">{entry.mode}</span>
                      <span>{safeDateStr(entry.date)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ─── Result List ────────────────────────────────── */}
          {resultItems.length > 0 && (
            <div className="border-t border-rmpg-700">
              {resultItems.map((person: any, idx: number) => {
                // API returns: Name, "Person ID", Age, "Lives in", "Used to live in", "Related to", Link
                const name = person.Name || person.name || person.fullName || `Result ${idx + 1}`;
                const age = person.Age || person.age;
                const livesIn = person['Lives in'] || person.livesIn || '';
                const personId = person['Person ID'] || person.personId || '';
                const isActive = selected === person;

                return (
                  <button type="button"
                    key={idx}
                    onClick={() => setSelected(person)}
                    onContextMenu={(e) => openMenu(e, buildResultMenu(person))}
                    className={`w-full text-left px-3 py-2 border-b border-rmpg-800 transition-all ${
                      isActive
                        ? 'bg-surface-sunken/20 border-l-2 border-l-rmpg-500'
                        : 'hover:bg-surface-base border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <User className="w-3.5 h-3.5 text-rmpg-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-rmpg-100 truncate">{name}</div>
                          <div className="text-[9px] text-rmpg-500">
                            {age && `Age ${age}`}
                            {age && livesIn && ' · '}
                            {livesIn}
                          </div>
                          {personId && <div className="text-[8px] text-rmpg-600 font-mono">ID: {personId}</div>}
                        </div>
                      </div>
                      <ChevronRight className="w-3 h-3 text-rmpg-600 shrink-0" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ─── Right Panel: Detail View ─────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4" style={{ background: 'var(--surface-deep)' }}>
          {loading && !selected && !personDetail && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Loader2 className="w-10 h-10 text-rmpg-600 mb-3 animate-spin" role="status" aria-label="Searching" />
              <p className="text-sm text-rmpg-500 font-bold uppercase tracking-wider">Searching…</p>
              <p className="text-[10px] text-rmpg-600 mt-1">Querying the local person corpus</p>
            </div>
          )}

          {!loading && !selected && !personDetail && !hasZeroResults && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Search className="w-12 h-12 text-rmpg-700 mb-3" />
              <p className="text-sm text-rmpg-500 font-bold uppercase tracking-wider">Skip Tracker</p>
              <p className="text-[10px] text-rmpg-600 mt-1 max-w-xs">
                Search for individuals by name, address, phone, or email.
                Select a result to view detailed information.
              </p>
              <p className="text-[9px] text-rmpg-700 mt-3 max-w-xs">
                Press <kbd className="px-1 py-0.5 bg-surface-base border border-rmpg-700 text-[8px] uppercase font-bold">N</kbd> to start a new search.
              </p>
            </div>
          )}

          {!loading && !selected && !personDetail && hasZeroResults && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <AlertCircle className="w-12 h-12 text-rmpg-700 mb-3" />
              <p className="text-sm text-rmpg-400 font-bold uppercase tracking-wider">No results found</p>
              <p className="text-[10px] text-rmpg-600 mt-1 max-w-xs">
                No person on file matches the query you ran. Try a wider
                search (e.g. last name only, or area code only) or switch
                search modes from the panel on the left.
              </p>
              <button
                type="button"
                onClick={newSearch}
                className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-brand-700/20 text-brand-400 border border-brand-700/50 hover:bg-brand-700/40 transition-colors"
              >
                <Plus className="w-3 h-3" /> Start over
              </button>
            </div>
          )}

          {selected && (
            <div className="space-y-4 animate-fade-in">
              {/* Person Header */}
              <div className="panel-beveled bg-surface-base p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-sm" style={{ background: 'var(--surface-raised)' }}>
                    <User className="w-5 h-5 text-rmpg-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-bold text-rmpg-100 tracking-wider uppercase truncate">
                      {selected.Name || selected.name || selected.fullName || 'Unknown'}
                    </h2>
                    <div className="flex items-center gap-2 text-[10px] text-rmpg-400 mt-0.5">
                      {(selected.Age || selected.age) && <span>Age {selected.Age || selected.age}</span>}
                      {selected['Lives in'] && <span>{selected['Lives in']}</span>}
                    </div>
                    {selected['Person ID'] && (
                      <div className="text-[9px] text-rmpg-500 font-mono mt-0.5">ID: {selected['Person ID']}</div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {selected['Person ID'] && (
                      <button type="button"
                        onClick={() => handleGetPersonDetails(selected['Person ID'])}
                        disabled={loadingDetail}
                        className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-brand-700/20 text-brand-400 border border-brand-700/50 hover:bg-brand-700/40 disabled:opacity-50 transition-colors"
                      >
                        {loadingDetail ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <ExternalLink className="w-3 h-3" />}
                        Full Details
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => exportSelectedPdf(selected)}
                      className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider bg-surface-base text-rmpg-300 border border-rmpg-600 hover:border-rmpg-400 hover:text-rmpg-100 transition-colors"
                      title="Generate investigator hand-off PDF"
                    >
                      <FileText className="w-3 h-3" /> PDF
                    </button>
                  </div>
                </div>
              </div>

              {/* Render all available fields dynamically */}
              <div className="panel-beveled bg-surface-base p-4 space-y-1">
                <div className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-2">Person Information</div>
                {renderAllFields(selected, renderFieldRow)}
              </div>

              {/* Phones */}
              {renderArraySection(selected, ['phones', 'phoneNumbers', 'phone_numbers', 'Phones'], 'Phone Numbers', Phone, 'var(--sev-warn)', renderFieldRow, copy, copied)}

              {/* Emails */}
              {renderArraySection(selected, ['emails', 'emailAddresses', 'email_addresses', 'Emails'], 'Email Addresses', Mail, 'var(--sev-info)', renderFieldRow, copy, copied)}

              {/* Addresses */}
              {renderArraySection(selected, ['addresses', 'Addresses', 'address_history'], 'Addresses', MapPin, 'var(--sev-ok)', renderFieldRow, copy, copied)}

              {/* Relatives / Associates */}
              {renderArraySection(selected, ['relatives', 'Relatives', 'associates', 'Associates'], 'Relatives / Associates', User, 'var(--sev-special)', renderFieldRow, copy, copied)}

              {/* Raw JSON (collapsible) */}
              <details className="panel-beveled bg-surface-base">
                <summary className="flex items-center gap-2 p-3 cursor-pointer text-[10px] font-bold text-rmpg-400 uppercase tracking-wider hover:text-rmpg-200">
                  <Hash className="w-3.5 h-3.5" />
                  Raw API Response
                  <ChevronDown className="w-3 h-3 ml-auto" />
                </summary>
                <pre className="p-3 text-[9px] text-rmpg-400 font-mono overflow-x-auto border-t border-rmpg-700 max-h-64 overflow-y-auto">
                  {JSON.stringify(selected, null, 2)}
                </pre>
              </details>
            </div>
          )}

          {/* Person Detail (from ID lookup) */}
          {personDetail && (
            <div className="mt-4 panel-beveled bg-surface-base p-4 space-y-1 animate-fade-in">
              <div className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-2">Extended Person Details</div>
              {renderAllFields(personDetail, renderFieldRow)}
              <details className="mt-3">
                <summary className="text-[9px] text-rmpg-500 cursor-pointer hover:text-rmpg-300">Raw Response</summary>
                <pre className="mt-2 text-[9px] text-rmpg-400 font-mono overflow-x-auto max-h-48 overflow-y-auto">
                  {JSON.stringify(personDetail, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      </div>

      {/* ── Confirm: clear search history ─────────────────── */}
      <ConfirmDialog
        isOpen={showClearHistoryConfirm}
        onClose={() => setShowClearHistoryConfirm(false)}
        onConfirm={clearSearchHistory}
        title="Clear search history?"
        message="This removes every entry from your local recent-search list on this device. Past searches stay in the server audit log."
        details={
          searchHistory.length > 0 ? (
            <>
              <div>{searchHistory.length} entr{searchHistory.length === 1 ? 'y' : 'ies'} on this device</div>
              <div>Most recent: <span className="font-mono">{searchHistory[0]?.query}</span></div>
            </>
          ) : undefined
        }
        confirmLabel="Clear"
        confirmVariant="danger"
      />
    </div>
  );
}

// ─── Utility: Render all top-level fields of an object ───────
const SKIP_KEYS = new Set(['phones', 'phoneNumbers', 'phone_numbers', 'Phones', 'emails', 'emailAddresses', 'email_addresses', 'Emails', 'addresses', 'Addresses', 'address_history', 'relatives', 'Relatives', 'associates', 'Associates', 'Link']);

function renderAllFields(obj: any, renderFieldRow: (label: string, value: any, copyLabel?: string) => React.ReactNode): React.ReactNode {
  if (!obj || typeof obj !== 'object') return null;
  return Object.entries(obj)
    .filter(([key]) => !SKIP_KEYS.has(key))
    .map(([key, value]) => {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value === 'object' && !Array.isArray(value)) return null; // skip nested objects
      if (Array.isArray(value) && value.length === 0) return null;
      const label = toDisplayLabel(key).replace(/([A-Z])/g, ' $1').trim().toUpperCase();
      const displayValue = Array.isArray(value) ? value.join(', ') : value;
      return <React.Fragment key={key}>{renderFieldRow(label, displayValue, key)}</React.Fragment>;
    });
}

// ─── Utility: Render an array section (phones, emails, etc.) ─
function renderArraySection(
  person: any,
  possibleKeys: string[],
  title: string,
  Icon: React.ElementType,
  color: string,
  renderFieldRow: (label: string, value: any, copyLabel?: string) => React.ReactNode,
  copy: (text: string, label: string) => void,
  copied: string | null,
): React.ReactNode {
  let items: any[] = [];
  for (const key of possibleKeys) {
    if (person[key] && Array.isArray(person[key]) && person[key].length > 0) {
      items = person[key];
      break;
    }
  }
  if (items.length === 0) return null;

  return (
    <div className="panel-beveled bg-surface-base p-4 space-y-2">
      <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider" style={{ color }}>
        <Icon className="w-3.5 h-3.5" />
        {title} ({items.length})
      </div>
      {items.map((item: any, idx: number) => (
        <div key={idx} className="pl-3 border-l-2 py-1 space-y-0.5" style={{ borderColor: withAlpha(color, '40') }}>
          {typeof item === 'string' ? (
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-rmpg-200 font-mono">{item}</span>
              <button type="button"
                onClick={() => copy(item, `${title}-${idx}`)}
                className="text-rmpg-600 hover:text-rmpg-400"
              >
                {copied === `${title}-${idx}` ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          ) : typeof item === 'object' ? (
            Object.entries(item).map(([k, v]) => {
              if (!v) return null;
              return <React.Fragment key={k}>{renderFieldRow(toDisplayLabel(k).toUpperCase(), v)}</React.Fragment>;
            })
          ) : (
            <span className="text-[11px] text-rmpg-200 font-mono">{String(item)}</span>
          )}
        </div>
      ))}
    </div>
  );
}
