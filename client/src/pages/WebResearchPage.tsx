// ============================================================
// RMPG Flex — Web Research Page
// Standalone Firecrawl-powered web search + deep scrape tool
// with saved results, notes, entity linking, court-ready PDF
// export, deep-link contract, Esc smart-cascade, and per-user
// recent-query history scoped to the operator.
//
// Audit Page 61 of the full-app frontend pass.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import RichTextArea from '../components/RichTextArea';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  Globe,
  Search,
  Loader2,
  ExternalLink,
  Save,
  Link2,
  Trash2,
  FileText,
  ChevronDown,
  ChevronUp,
  Eye,
  Plus,
  History,
  X,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../context/AuthContext';
import { safeDateTimeStr } from '../utils/dateUtils';
import { toDisplayLabel } from '../utils/formatters';
import { openWebResearchReportPdf } from '../utils/webResearchReportPdf';
import { downloadTextFile, webResearchHitsToCsv } from '../utils/rmsListExport';
import { useSlashFocus } from '../hooks/useSlashFocus';

// ── Types ────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

interface SavedResult {
  id: number;
  query: string;
  title: string;
  url: string;
  description: string;
  type: 'search' | 'scrape';
  notes: string | null;
  linked_entity_type: string | null;
  linked_entity_id: number | null;
  scraped_content: string | null;
  created_at: string;
}

type LinkEntityType = 'incident' | 'person' | 'case';
type FilterValue = 'all' | 'incident' | 'person' | 'case' | 'unlinked';

interface HistoryEntry {
  query: string;
  date: string;
  count: number;
}

// ── Component ────────────────────────────────────────────────

export default function WebResearchPage() {
  void useIsMobile(); // reserved for a future mobile-layout split; keeps the
                       // hook subscription so a window-resize re-renders the
                       // page rather than letting the cached value go stale.
  const { addToast } = useToast();
  const { user } = useAuth();
  const queryRef = useRef<HTMLInputElement>(null);
  useSlashFocus(queryRef);

  // Firecrawl connection
  const [firecrawlConnected, setFirecrawlConnected] = useState(false);
  const [statusChecked, setStatusChecked] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<'search' | 'saved'>('search');

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Per-result scrape state
  const [scrapingMap, setScrapingMap] = useState<Record<string, boolean>>({});
  const [scrapedMap, setScrapedMap] = useState<Record<string, string>>({});
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({});

  // Saved results state
  const [savedResults, setSavedResults] = useState<SavedResult[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [filterEntity, setFilterEntity] = useState<FilterValue>('all');

  // Link modal state
  const [linkModalResult, setLinkModalResult] = useState<SavedResult | null>(null);
  const [linkType, setLinkType] = useState<LinkEntityType>('incident');
  const [linkId, setLinkId] = useState('');
  const [linking, setLinking] = useState(false);

  // Notes editing
  const [editingNotesId, setEditingNotesId] = useState<number | null>(null);
  const [notesValue, setNotesValue] = useState('');

  // Delete confirmation — replaces the silent `window.confirm()` that the
  // page used to fire (no row-context, no shared dialog focus rules, no
  // ARIA). Same pattern as Arrest Records / Notifications / Tasks.
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Clear-history confirmation
  const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);

  // ── Per-user recent queries ───────────────────────────────
  // Web-research queries are PII-sensitive (subject names, addresses, plate
  // numbers, etc.). Storing them under an unscoped key would leak one
  // operator's investigation list to whoever sat at the MDT next. Scope
  // strictly to user.id; if no user is known (mid-login first render)
  // skip the read AND the write so we don't pollute the next session.
  const HISTORY_KEY = user?.id ? `rmpg_web_research_history_${user.id}` : null;
  const [searchHistory, setSearchHistory] = useState<HistoryEntry[]>(() => {
    try {
      if (HISTORY_KEY) {
        const scoped = localStorage.getItem(HISTORY_KEY);
        if (scoped) return JSON.parse(scoped);
      }
      return [];
    } catch {
      return [];
    }
  });

  const saveSearchToHistory = useCallback((q: string, count: number) => {
    if (!HISTORY_KEY) return;
    setSearchHistory(prev => {
      const entry: HistoryEntry = { query: q, date: new Date().toISOString(), count };
      const updated = [entry, ...prev.filter(h => h.query !== q)].slice(0, 20);
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

  // ── Check Firecrawl status on mount ───────────────────────
  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ connected: boolean }>('/web-research/status');
        setFirecrawlConnected(!!data?.connected);
      } catch {
        setFirecrawlConnected(false);
      } finally {
        setStatusChecked(true);
      }
    })();
  }, []);

  const loadSavedResults = useCallback(async () => {
    setLoadingSaved(true);
    try {
      const data = await apiFetch<SavedResult[]>('/web-research/results');
      setSavedResults(Array.isArray(data) ? data : []);
    } catch {
      addToast('Failed to load saved results', 'error');
    } finally {
      setLoadingSaved(false);
    }
  }, [addToast]);

  // ── Hydrate saved-results count on mount ──────────────────
  // Previously this only fired when switching to the Saved tab, which
  // meant the count badge in the tab strip ("Saved Results (12)") never
  // populated unless the operator clicked it. Loading once on mount lets
  // the badge accurately advertise existing research from any deep-link
  // landing.
  useEffect(() => {
    loadSavedResults();
  }, [loadSavedResults]);

  // ── New search reset ──
  // Single source of truth for "start over" — used by the keyboard
  // shortcut and the toolbar New button. Clears query + results +
  // expanded panels but keeps the active tab.
  const newSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setScrapedMap({});
    setExpandedMap({});
    setHasSearched(false);
    setActiveTab('search');
    // Move focus to the search input on next paint.
    setTimeout(() => {
      document.getElementById('ff-webresearchpage-0')?.focus();
    }, 0);
  }, []);

  // ── Search handler ────────────────────────────────────────
  const handleSearch = useCallback(async (overrideQuery?: string) => {
    const trimmed = (overrideQuery ?? query).trim();
    if (!trimmed) return;
    if (overrideQuery !== undefined && overrideQuery !== query) {
      setQuery(trimmed);
    }
    setSearching(true);
    setResults([]);
    setScrapedMap({});
    setExpandedMap({});
    setHasSearched(true);
    try {
      const data = await apiFetch<{ results: SearchResult[]; error?: string }>('/web-research/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      const fetched = data?.results || [];
      setResults(fetched);
      saveSearchToHistory(trimmed, fetched.length);
      if (data?.error) {
        addToast(data.error, 'warning');
      } else if (!fetched.length) {
        addToast('No results found', 'info');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Search failed';
      addToast(msg, 'error');
    } finally {
      setSearching(false);
    }
  }, [query, addToast, saveSearchToHistory]);

  // ── Deep scrape handler ───────────────────────────────────
  const handleScrape = useCallback(async (url: string) => {
    setScrapingMap(p => ({ ...p, [url]: true }));
    try {
      const data = await apiFetch<{ markdown?: string; content?: string; error?: string }>('/web-research/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const content = data?.markdown || data?.content || 'No content extracted';
      setScrapedMap(p => ({ ...p, [url]: content }));
      setExpandedMap(p => ({ ...p, [url]: true }));
      if (data?.error) {
        addToast(data.error, 'warning');
      } else {
        addToast('Page scraped successfully', 'success');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Scrape failed';
      addToast(msg, 'error');
    } finally {
      setScrapingMap(p => ({ ...p, [url]: false }));
    }
  }, [addToast]);

  // ── Save result handler ───────────────────────────────────
  const handleSave = useCallback(async (result: SearchResult, type: 'search' | 'scrape') => {
    const url = result.url;
    setSavingMap(p => ({ ...p, [url]: true }));
    try {
      await apiFetch('/web-research/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          title: result.title,
          url: result.url,
          description: result.description,
          type,
          scraped_content: scrapedMap[url] || null,
        }),
      });
      addToast('Result saved', 'success');
      // Best-effort refresh so the Saved Results tab badge advances
      // even though the empty-state Worker route is a no-op today.
      void loadSavedResults();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      addToast(msg, 'error');
    } finally {
      setSavingMap(p => ({ ...p, [url]: false }));
    }
  }, [query, scrapedMap, addToast, loadSavedResults]);

  // ── Delete saved result ───────────────────────────────────
  const handleDelete = useCallback(async (id: number) => {
    try {
      await apiFetch(`/web-research/results/${id}`, { method: 'DELETE' });
      setSavedResults(p => p.filter(r => r.id !== id));
      addToast('Result deleted', 'success');
    } catch {
      addToast('Failed to delete', 'error');
    } finally {
      setDeleteConfirm(null);
    }
  }, [addToast]);

  // ── Update notes ──────────────────────────────────────────
  const handleNotesBlur = useCallback(async (id: number) => {
    setEditingNotesId(null);
    try {
      await apiFetch(`/web-research/results/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notesValue }),
      });
      setSavedResults(p => p.map(r => r.id === id ? { ...r, notes: notesValue } : r));
    } catch {
      addToast('Failed to save notes', 'error');
    }
  }, [notesValue, addToast]);

  // ── Link to entity ────────────────────────────────────────
  const handleLink = useCallback(async () => {
    if (!linkModalResult || !linkId.trim()) return;
    setLinking(true);
    try {
      await apiFetch(`/web-research/results/${linkModalResult.id}/link`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linked_entity_type: linkType,
          linked_entity_id: parseInt(linkId, 10),
        }),
      });
      setSavedResults(p => p.map(r =>
        r.id === linkModalResult.id
          ? { ...r, linked_entity_type: linkType, linked_entity_id: parseInt(linkId, 10) }
          : r
      ));
      addToast(`Linked to ${linkType} #${linkId}`, 'success');
      setLinkModalResult(null);
      setLinkId('');
    } catch {
      addToast('Failed to link', 'error');
    } finally {
      setLinking(false);
    }
  }, [linkModalResult, linkType, linkId, addToast]);

  // ── Filtered saved results ────────────────────────────────
  const filteredSaved: SavedResult[] = filterEntity === 'all'
    ? savedResults
    : filterEntity === 'unlinked'
      ? savedResults.filter(r => !r.linked_entity_type)
      : savedResults.filter(r => r.linked_entity_type === filterEntity);

  // ── PDF: investigator hand-off / court-prep report ────────
  // Same Arial + gold pattern as the rest of the audit series.
  // Operators previously had no documented hand-off artifact for
  // web-research — they were screenshotting the saved-results panel
  // and pasting into Word. This produces the canonical RMPG record.
  const exportPdf = useCallback(() => {
    if (filteredSaved.length === 0) {
      addToast('No saved results match the active filter — nothing to export', 'warning');
      return;
    }
    try {
      const officerName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.full_name || user?.username || '';
      openWebResearchReportPdf(filteredSaved, {
        filter: filterEntity,
        officerName: officerName || undefined,
        badgeNumber: user?.badge_number || undefined,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate PDF';
      addToast(msg, 'error');
    }
  }, [filteredSaved, filterEntity, user, addToast]);

  // ── URL deep-link contract ─────────────────────────────────
  // Honors the audit-series cross-page contract:
  //   ?research_id=<n>   — switch to the Saved tab and scroll the
  //                        matching saved-row into view (best-effort
  //                        once the row exists)
  //   ?query=<text>      — pre-fill the search input and auto-run
  //   ?tab=<search|saved>— pre-select the active tab
  // Consumed once; the query string is stripped (replace:true) so a
  // hard refresh doesn't re-pin.
  const [searchParams, setSearchParams] = useSearchParams();
  const consumedDeepLinkRef = useRef(false);
  useEffect(() => {
    if (consumedDeepLinkRef.current) return;
    const researchIdParam = searchParams.get('research_id');
    const queryParam = searchParams.get('query');
    const tabParam = searchParams.get('tab');
    if (!researchIdParam && !queryParam && !tabParam) return;
    consumedDeepLinkRef.current = true;

    if (tabParam === 'saved' || researchIdParam) {
      setActiveTab('saved');
    } else if (tabParam === 'search') {
      setActiveTab('search');
    }

    if (queryParam) {
      setQuery(queryParam);
      // Defer the search so the input render flushes first.
      setTimeout(() => { void handleSearch(queryParam); }, 0);
    }

    if (researchIdParam) {
      // Try to scroll the row into view after the saved-results list
      // renders. The empty-state Worker route returns [] today so this
      // is a no-op when the route is unconfigured, but the contract
      // works the moment a backing store exists.
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>(`[data-research-row="${researchIdParam}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-brand-500');
          setTimeout(() => el.classList.remove('ring-2', 'ring-brand-500'), 2000);
        }
      }, 400);
    }

    const next = new URLSearchParams(searchParams);
    ['research_id', 'query', 'tab'].forEach(k => next.delete(k));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Document title ────────────────────────────────────────
  // Reflects active tab so a tab switcher can distinguish the search
  // surface from the saved corpus.
  useEffect(() => {
    document.title = activeTab === 'saved'
      ? `Saved Research (${savedResults.length}) — RMPG Flex`
      : 'Web Research — RMPG Flex';
  }, [activeTab, savedResults.length]);

  // ── Esc smart-cascade + N shortcut ────────────────────────
  // Cascade order is widest-blast-radius first; a single Esc unwinds
  // exactly ONE layer (ConfirmDialog owns its own Esc so it's not
  // mirrored here when open). Matches Arrest Records / Skip Tracker.
  //
  // N opens a new search (matches Trespass / Equipment / Notifications
  // muscle memory). Typing-suppressed so a name containing the letter
  // 'n' doesn't blow away the form.
  useEffect(() => {
    const isTypingInField = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // ConfirmDialog owns its own Esc handler.
        if (deleteConfirm !== null || showClearHistoryConfirm) return;
        if (linkModalResult) { setLinkModalResult(null); setLinkId(''); return; }
        if (editingNotesId !== null) { setEditingNotesId(null); return; }
        if (results.length > 0 || hasSearched) {
          setResults([]);
          setScrapedMap({});
          setExpandedMap({});
          setHasSearched(false);
          return;
        }
        if (query.trim()) { setQuery(''); return; }
        if (filterEntity !== 'all') { setFilterEntity('all'); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isTypingInField(e.target)) return;
      if (deleteConfirm !== null || showClearHistoryConfirm || linkModalResult) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        newSearch();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    deleteConfirm, showClearHistoryConfirm, linkModalResult, editingNotesId,
    results.length, hasSearched, query, filterEntity, newSearch,
  ]);

  const filterLabel: Record<FilterValue, string> = {
    all: 'All',
    incident: 'Incident',
    person: 'Person',
    case: 'Case',
    unlinked: 'Unlinked',
  };

  return (
    <div className="h-full flex flex-col bg-surface-base text-rmpg-100 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-rmpg-700" style={{ background: 'var(--surface-overlay)' }}>
        <Globe className="w-4 h-4 text-brand-400" />
        <h1 className="text-sm font-bold text-rmpg-100 tracking-wide uppercase flex-1">Web Research</h1>

        {/* Toolbar — New + PDF (PDF only when there is something to export) */}
        <button
          type="button"
          onClick={newSearch}
          className="toolbar-btn flex items-center gap-1 px-2 text-xs"
          title="Start a new search (N)"
          aria-label="Start a new search"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </button>
        {savedResults.length > 0 && (
          <button
            type="button"
            onClick={exportPdf}
            className="toolbar-btn flex items-center gap-1 px-2 text-xs"
            title="Generate investigator hand-off PDF for the active filter"
            aria-label="Generate PDF report"
          >
            <FileText className="w-3.5 h-3.5" />
            PDF
          </button>
        )}
        <button
          type="button"
          className="toolbar-btn"
          disabled={(activeTab === 'saved' ? filteredSaved : results).length === 0}
          onClick={() => downloadTextFile('web-research.csv', webResearchHitsToCsv(
            (activeTab === 'saved' ? filteredSaved : results).map((r) => ({ title: r.title, url: r.url })),
          ))}
        >CSV</button>

        {/* Firecrawl status LED */}
        <div className="flex items-center gap-1.5 ml-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              !statusChecked
                ? 'bg-rmpg-500 animate-pulse'
                : firecrawlConnected
                  ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]'
                  : 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]'
            }`}
            aria-hidden="true"
          />
          <span className="text-[10px] text-rmpg-400 font-mono" aria-live="polite">
            Firecrawl {!statusChecked ? '...' : firecrawlConnected ? 'online' : 'offline'}
          </span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-rmpg-700 bg-surface-sunken">
        <button type="button"
          className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeTab === 'search'
              ? 'text-brand-400 border-b-2 border-brand-400'
              : 'text-rmpg-400 hover:text-rmpg-200'
          }`}
          onClick={() => setActiveTab('search')}
        >
          <Search className="w-3 h-3 inline mr-1.5 -mt-0.5" />
          Search
        </button>
        <button type="button"
          className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
            activeTab === 'saved'
              ? 'text-brand-400 border-b-2 border-brand-400'
              : 'text-rmpg-400 hover:text-rmpg-200'
          }`}
          onClick={() => setActiveTab('saved')}
        >
          <Save className="w-3 h-3 inline mr-1.5 -mt-0.5" />
          Saved Results
          {savedResults.length > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 text-[9px] bg-brand-600/30 text-brand-300 rounded-sm">
              {savedResults.length}
            </span>
          )}
        </button>
      </div>

      {/* Firecrawl-offline banner — replaces the silent LED-only signal so
          operators immediately understand WHY a search returned nothing. */}
      {statusChecked && !firecrawlConnected && (
        <div
          className="px-4 py-2 text-xs border-b border-amber-700/50 bg-amber-900/30 text-amber-200"
          role="status"
        >
          Firecrawl is not configured on this Worker — searches and scrapes will return empty results until an
          operator with admin rights sets <code className="font-mono text-amber-100">FIRECRAWL_API_KEY</code>.
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {activeTab === 'search' ? (
          <>
            {/* Search bar */}
            <div className="panel-beveled bg-surface-base p-3">
              <form
                className="flex gap-2"
                onSubmit={e => {
                  e.preventDefault();
                  void handleSearch();
                }}
              >
                <input id="ff-webresearchpage-0"
                  ref={queryRef}
                  type="text"
                  className="input-dark flex-1 min-h-[36px]"
                  placeholder="Search the web… (/)" aria-label="Search the web..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={searching || !query.trim()}
                  className="toolbar-btn toolbar-btn-primary flex items-center gap-1.5 px-4"
                >
                  {searching ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  <span className="text-xs">Search</span>
                </button>
              </form>
            </div>

            {/* Per-user recent queries — only when there's no live search
                in progress / no results to show. Scoped to user.id so a
                shared MDT does not leak one operator's investigation
                list to the next. */}
            {!searching && results.length === 0 && searchHistory.length > 0 && (
              <div className="panel-beveled bg-surface-base p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold text-rmpg-400 uppercase tracking-wider">
                    <History className="w-3 h-3" />
                    Recent Queries
                  </span>
                  <button
                    type="button"
                    className="text-[10px] text-rmpg-500 hover:text-red-400 transition-colors"
                    onClick={() => setShowClearHistoryConfirm(true)}
                  >
                    Clear
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {searchHistory.slice(0, 12).map((h) => (
                    <button
                      type="button"
                      key={h.date}
                      className="px-2 py-0.5 text-[10px] font-mono bg-rmpg-700/40 text-rmpg-300 hover:bg-brand-600/30 hover:text-brand-300 transition-colors rounded-sm"
                      onClick={() => { setQuery(h.query); void handleSearch(h.query); }}
                      title={`${h.count} result${h.count === 1 ? '' : 's'} on ${safeDateTimeStr(h.date)}`}
                    >
                      {h.query}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Searching indicator */}
            {searching && (
              <div className="panel-beveled bg-surface-base p-6 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-400" role="status" aria-label="Loading" />
                <span className="text-sm text-rmpg-300">Searching the web...</span>
              </div>
            )}

            {/* Empty-state distinction — three branches so the operator
                gets the right cue: never searched, search with text but
                hasn't run, ran a search and got 0 hits. */}
            {!searching && results.length === 0 && hasSearched && (
              <div className="panel-beveled bg-surface-base p-6 text-center">
                <Globe className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                <p className="text-sm text-rmpg-300 mb-1">No results found</p>
                <p className="text-xs text-rmpg-500">
                  Try a different query, fewer words, or check spelling.
                </p>
                <button
                  type="button"
                  onClick={newSearch}
                  className="toolbar-btn toolbar-btn-primary text-xs mt-3 px-3"
                >
                  Start a new search
                </button>
              </div>
            )}

            {!searching && results.length === 0 && !hasSearched && (
              <div className="panel-beveled bg-surface-base p-8 text-center">
                <Globe className="w-10 h-10 text-rmpg-600 mx-auto mb-3" />
                <p className="text-sm text-rmpg-300 mb-1">Web Research Tool</p>
                <p className="text-xs text-rmpg-500">
                  Search the web for investigative research. Results can be deep-scraped,
                  saved, annotated, linked to incidents/persons/cases, and exported to a
                  court-ready PDF for case files.
                </p>
                <p className="text-[10px] text-rmpg-600 mt-2">
                  Press <kbd className="px-1 py-0.5 bg-rmpg-700 text-rmpg-300 rounded-sm font-mono">N</kbd> for a new search,
                  <kbd className="ml-1 px-1 py-0.5 bg-rmpg-700 text-rmpg-300 rounded-sm font-mono">Esc</kbd> to step back.
                </p>
              </div>
            )}

            {/* Results count */}
            {!searching && results.length > 0 && (
              <div className="px-1">
                <span className="text-[10px] font-semibold text-rmpg-400 uppercase tracking-wider">
                  {results.length} Result{results.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}

            {/* Search results */}
            {results.map((result, idx) => {
              const isScraping = scrapingMap[result.url];
              const scraped = scrapedMap[result.url];
              const isExpanded = expandedMap[result.url];
              const isSaving = savingMap[result.url];

              return (
                <div key={`${result.url}-${idx}`} className="panel-beveled bg-surface-base">
                  <div className="p-3 space-y-1.5">
                    {/* Title */}
                    <h3 className="text-sm font-semibold text-rmpg-100 leading-tight">
                      {result.title || 'Untitled'}
                    </h3>

                    {/* URL */}
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs font-mono text-brand-400 hover:underline truncate max-w-full"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{result.url}</span>
                    </a>

                    {/* Description */}
                    {result.description && (
                      <p className="text-xs text-rmpg-300 line-clamp-2">{result.description}</p>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      <button type="button"
                        className="toolbar-btn flex items-center gap-1 px-2 text-xs"
                        disabled={isScraping}
                        onClick={() => handleScrape(result.url)}
                      >
                        {isScraping ? (
                          <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" />
                        ) : (
                          <Eye className="w-3 h-3" />
                        )}
                        Deep Scrape
                      </button>

                      <button type="button"
                        className="toolbar-btn flex items-center gap-1 px-2 text-xs"
                        disabled={isSaving}
                        onClick={() => handleSave(result, scraped ? 'scrape' : 'search')}
                      >
                        {isSaving ? (
                          <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" />
                        ) : (
                          <Save className="w-3 h-3" />
                        )}
                        Save
                      </button>

                      {scraped && (
                        <button type="button"
                          className="toolbar-btn flex items-center gap-1 px-2 text-xs ml-auto"
                          onClick={() => setExpandedMap(p => ({ ...p, [result.url]: !isExpanded }))}
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                          {isExpanded ? 'Hide' : 'Show'} Data
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded scrape data */}
                  {scraped && isExpanded && (
                    <div className="border-t border-rmpg-700 bg-surface-sunken p-3">
                      <h4 className="text-xs font-semibold text-gold-400 uppercase tracking-wider mb-2">
                        Extracted Content
                      </h4>
                      <div className="text-xs text-rmpg-200 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
                        {scraped}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          /* ── Saved Results Tab ─────────────────────────────── */
          <>
            {/* Filter bar */}
            <div className="panel-beveled bg-surface-base p-2 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-rmpg-400 uppercase tracking-wider font-semibold">Filter:</span>
              {(['all', 'incident', 'person', 'case', 'unlinked'] as FilterValue[]).map(f => (
                <button type="button"
                  key={f}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded-sm transition-colors ${
                    filterEntity === f
                      ? 'bg-brand-600/30 text-brand-300 border border-brand-600/50'
                      : 'text-rmpg-400 hover:text-rmpg-200 border border-transparent'
                  }`}
                  onClick={() => setFilterEntity(f)}
                >
                  {filterLabel[f]}
                </button>
              ))}
              {filteredSaved.length > 0 && (
                <span className="ml-auto text-[10px] text-rmpg-500 font-mono">
                  {filteredSaved.length} shown
                </span>
              )}
            </div>

            {loadingSaved && (
              <div className="panel-beveled bg-surface-base p-6 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-400" role="status" aria-label="Loading" />
                <span className="text-sm text-rmpg-300">Loading saved results...</span>
              </div>
            )}

            {!loadingSaved && filteredSaved.length === 0 && (
              <div className="panel-beveled bg-surface-base p-6 text-center">
                <FileText className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                <p className="text-sm text-rmpg-400">
                  {filterEntity === 'all'
                    ? 'No saved results yet. Search and save results to build your research.'
                    : filterEntity === 'unlinked'
                      ? 'No unlinked results — every saved result is attached to an entity.'
                      : `No results linked to ${filterEntity}s.`}
                </p>
              </div>
            )}

            {/* Saved results list */}
            {filteredSaved.map(result => (
              <div
                key={result.id}
                data-research-row={result.id}
                className="panel-beveled bg-surface-base p-3 space-y-2 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    {/* Title + type badge */}
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-rmpg-100 leading-tight truncate">
                        {result.title || 'Untitled'}
                      </h3>
                      <span
                        className={`shrink-0 px-1.5 py-0.5 text-[9px] font-mono uppercase rounded-sm ${
                          result.type === 'scrape'
                            ? 'bg-gold-500/20 text-gold-400 border border-gold-500/30'
                            : 'bg-brand-600/20 text-brand-400 border border-brand-600/30'
                        }`}
                      >
                        {toDisplayLabel(result.type)}
                      </span>
                      {result.linked_entity_type && (
                        <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-mono uppercase bg-green-500/20 text-green-400 border border-green-500/30 rounded-sm">
                          {toDisplayLabel(result.linked_entity_type || '').toUpperCase()} #{result.linked_entity_id}
                        </span>
                      )}
                    </div>

                    {/* URL */}
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs font-mono text-brand-400 hover:underline truncate"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      <span className="truncate">{result.url}</span>
                    </a>

                    {/* Query + timestamp */}
                    <div className="flex items-center gap-3 text-[10px] text-rmpg-500 font-mono">
                      <span>Query: "{result.query}"</span>
                      <span>{safeDateTimeStr(result.created_at)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button"
                      className="toolbar-btn flex items-center gap-1 px-2 text-xs"
                      title="Link to entity"
                      onClick={() => {
                        setLinkModalResult(result);
                        setLinkType((result.linked_entity_type as LinkEntityType) || 'incident');
                        setLinkId(result.linked_entity_id?.toString() || '');
                      }}
                    >
                      <Link2 className="w-3 h-3" />
                      Link
                    </button>
                    <button type="button"
                      className="toolbar-btn flex items-center px-1.5 text-xs text-red-400 hover:text-red-300"
                      title="Delete"
                      aria-label="Delete saved result"
                      onClick={() => setDeleteConfirm(result.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Notes textarea */}
                <div>
                  {editingNotesId === result.id ? (
                    <RichTextArea
                      className="input-dark w-full text-xs resize-none min-h-[36px]"
                      rows={2}
                      placeholder="Add notes..."
                      value={notesValue}
                      onChange={e => setNotesValue(e.target.value)}
                      onBlur={() => handleNotesBlur(result.id)}
                      autoFocus
                    />
                  ) : (
                    <button type="button"
                      className="w-full text-left text-xs text-rmpg-400 hover:text-rmpg-200 px-2 py-1 rounded-sm hover:bg-rmpg-700/20 transition-colors"
                      onClick={() => {
                        setEditingNotesId(result.id);
                        setNotesValue(result.notes || '');
                      }}
                    >
                      {result.notes || 'Click to add notes...'}
                    </button>
                  )}
                </div>

                {/* Scraped content preview */}
                {result.scraped_content && (
                  <details className="group">
                    <summary className="text-[10px] text-rmpg-500 uppercase tracking-wider cursor-pointer hover:text-rmpg-300 transition-colors">
                      Scraped Content
                    </summary>
                    <div className="mt-1 p-2 bg-surface-sunken rounded-sm text-xs text-rmpg-300 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {result.scraped_content}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Link Modal */}
      {linkModalResult && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" onClick={() => { setLinkModalResult(null); setLinkId(''); }}>
          <div
            className="panel-beveled bg-surface-raised p-4 w-80 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-rmpg-100 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-brand-400" />
                Link to Entity
              </h3>
              <button
                type="button"
                onClick={() => { setLinkModalResult(null); setLinkId(''); }}
                className="text-rmpg-500 hover:text-rmpg-200 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-rmpg-400 truncate">
              {linkModalResult.title}
            </p>

            {/* Entity type selector */}
            <div className="flex gap-1">
              {(['incident', 'person', 'case'] as LinkEntityType[]).map(t => (
                <button type="button"
                  key={t}
                  className={`flex-1 px-2 py-1 text-xs font-mono rounded-sm transition-colors ${
                    linkType === t
                      ? 'bg-brand-600/30 text-brand-300 border border-brand-600/50'
                      : 'text-rmpg-400 hover:text-rmpg-200 border border-rmpg-600'
                  }`}
                  onClick={() => setLinkType(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* ID input */}
            <input id="ff-webresearchpage-1"
              type="number"
              className="input-dark w-full min-h-[36px]"
              placeholder={`${linkType.charAt(0).toUpperCase() + linkType.slice(1)} ID...`}
              value={linkId}
              onChange={e => setLinkId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLink()}
              autoFocus
            />

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button type="button"
                className="toolbar-btn px-3 text-xs"
                onClick={() => { setLinkModalResult(null); setLinkId(''); }}
              >
                Cancel
              </button>
              <button type="button"
                className="toolbar-btn toolbar-btn-primary flex items-center gap-1 px-3 text-xs"
                disabled={linking || !linkId.trim()}
                onClick={handleLink}
                style={{ opacity: (linking || !linkId.trim()) ? 0.4 : 1 }}
              >
                {linking ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Link2 className="w-3 h-3" />}
                Link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation — replaces the silent window.confirm() that
          shipped before. Shared ConfirmDialog (body-scroll-lock, ARIA,
          pre-focused Cancel, identifying-context displayed). */}
      <ConfirmDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm !== null && handleDelete(deleteConfirm)}
        title="Delete Saved Research"
        message="Permanently delete this saved research entry? This cannot be undone."
        details={(() => {
          if (deleteConfirm === null) return null;
          const target = savedResults.find(r => r.id === deleteConfirm);
          if (!target) return null;
          return (
            <div className="space-y-0.5">
              <div><span className="text-rmpg-500">Title:</span> <span className="font-bold text-rmpg-100">{target.title || 'Untitled'}</span></div>
              <div className="break-all"><span className="text-rmpg-500">URL:</span> <span className="font-mono text-rmpg-300">{target.url}</span></div>
              {target.query && (
                <div><span className="text-rmpg-500">Query:</span> <span className="text-rmpg-300">"{target.query}"</span></div>
              )}
              {target.linked_entity_type && (
                <div>
                  <span className="text-rmpg-500">Linked:</span>{' '}
                  <span className="text-rmpg-300">{target.linked_entity_type} #{target.linked_entity_id}</span>
                </div>
              )}
            </div>
          );
        })()}
        confirmLabel="Delete"
        confirmVariant="danger"
      />

      {/* Clear-history confirmation — replaces the silent localStorage
          destroy the older "Clear" link did on a single click. */}
      <ConfirmDialog
        isOpen={showClearHistoryConfirm}
        onClose={() => setShowClearHistoryConfirm(false)}
        onConfirm={clearSearchHistory}
        title="Clear Search History"
        message="Remove your saved recent queries from this browser? This affects only your account on this device."
        confirmLabel="Clear"
        confirmVariant="warning"
      />
    </div>
  );
}
