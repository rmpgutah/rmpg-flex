// ============================================================
// RMPG Flex — Web Research Page
// Standalone Firecrawl-powered web search + deep scrape tool
// with saved results, notes, and entity linking
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useToast } from '../components/ToastProvider';
import { useIsMobile } from '../hooks/useIsMobile';

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

// ── Component ────────────────────────────────────────────────

export default function WebResearchPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();

  // Firecrawl connection
  const [firecrawlConnected, setFirecrawlConnected] = useState(false);
  const [statusChecked, setStatusChecked] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<'search' | 'saved'>('search');

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Per-result scrape state
  const [scrapingMap, setScrapingMap] = useState<Record<string, boolean>>({});
  const [scrapedMap, setScrapedMap] = useState<Record<string, string>>({});
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [savingMap, setSavingMap] = useState<Record<string, boolean>>({});

  // Saved results state
  const [savedResults, setSavedResults] = useState<SavedResult[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [filterEntity, setFilterEntity] = useState<string>('all');

  // Link modal state
  const [linkModalResult, setLinkModalResult] = useState<SavedResult | null>(null);
  const [linkType, setLinkType] = useState<LinkEntityType>('incident');
  const [linkId, setLinkId] = useState('');
  const [linking, setLinking] = useState(false);

  // Notes editing
  const [editingNotesId, setEditingNotesId] = useState<number | null>(null);
  const [notesValue, setNotesValue] = useState('');

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

  // ── Load saved results when switching to saved tab ────────
  useEffect(() => {
    if (activeTab === 'saved') {
      loadSavedResults();
    }
  }, [activeTab]);

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

  // ── Search handler ────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setResults([]);
    setScrapedMap({});
    setExpandedMap({});
    try {
      const data = await apiFetch<{ results: SearchResult[] }>('/web-research/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      setResults(data?.results || []);
      if (!(data?.results?.length)) {
        addToast('No results found', 'info');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Search failed';
      addToast(msg, 'error');
    } finally {
      setSearching(false);
    }
  }, [query, addToast]);

  // ── Deep scrape handler ───────────────────────────────────
  const handleScrape = useCallback(async (url: string) => {
    setScrapingMap(p => ({ ...p, [url]: true }));
    try {
      const data = await apiFetch<{ markdown?: string; content?: string }>('/web-research/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const content = data?.markdown || data?.content || 'No content extracted';
      setScrapedMap(p => ({ ...p, [url]: content }));
      setExpandedMap(p => ({ ...p, [url]: true }));
      addToast('Page scraped successfully', 'success');
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      addToast(msg, 'error');
    } finally {
      setSavingMap(p => ({ ...p, [url]: false }));
    }
  }, [query, scrapedMap, addToast]);

  // ── Delete saved result ───────────────────────────────────
  const handleDelete = useCallback(async (id: number) => {
    try {
      await apiFetch(`/web-research/results/${id}`, { method: 'DELETE' });
      setSavedResults(p => p.filter(r => r.id !== id));
      addToast('Result deleted', 'success');
    } catch {
      addToast('Failed to delete', 'error');
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
  const filteredSaved = filterEntity === 'all'
    ? savedResults
    : savedResults.filter(r => r.linked_entity_type === filterEntity);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-surface-base text-white overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-rmpg-700" style={{ background: '#0d1520' }}>
        <Globe className="w-4 h-4 text-brand-400" />
        <h1 className="text-sm font-bold text-white tracking-wide uppercase flex-1">Web Research</h1>

        {/* Firecrawl status LED */}
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              !statusChecked
                ? 'bg-rmpg-500 animate-pulse'
                : firecrawlConnected
                  ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]'
                  : 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]'
            }`}
          />
          <span className="text-[10px] text-rmpg-400 font-mono">
            Firecrawl {!statusChecked ? '...' : firecrawlConnected ? 'online' : 'offline'}
          </span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-rmpg-700" style={{ background: '#0f1923' }}>
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
            <span className="ml-1.5 px-1.5 py-0.5 text-[9px] bg-brand-600/30 text-brand-300 rounded-full">
              {savedResults.length}
            </span>
          )}
        </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {activeTab === 'search' ? (
          <>
            {/* Search bar */}
            <div className="panel-beveled bg-surface-base p-3">
              <form
                className="flex gap-2"
                onSubmit={e => {
                  e.preventDefault();
                  handleSearch();
                }}
              >
                <input
                  type="text"
                  className="input-dark flex-1"
                  placeholder="Search the web..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
                <button type="button"
                  type="submit"
                  disabled={searching || !query.trim()}
                  className="toolbar-btn toolbar-btn-primary flex items-center gap-1.5 px-4"
                >
                  {searching ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  <span className="text-xs">Search</span>
                </button>
              </form>
            </div>

            {/* Searching indicator */}
            {searching && (
              <div className="panel-beveled bg-surface-base p-6 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
                <span className="text-sm text-rmpg-300">Searching the web...</span>
              </div>
            )}

            {/* No results */}
            {!searching && results.length === 0 && query.trim() !== '' && (
              <div className="panel-beveled bg-surface-base p-6 text-center">
                <Globe className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                <p className="text-sm text-rmpg-400">No results found. Try a different query.</p>
              </div>
            )}

            {/* Empty state */}
            {!searching && results.length === 0 && query.trim() === '' && (
              <div className="panel-beveled bg-surface-base p-8 text-center">
                <Globe className="w-10 h-10 text-rmpg-600 mx-auto mb-3" />
                <p className="text-sm text-rmpg-300 mb-1">Web Research Tool</p>
                <p className="text-xs text-rmpg-500">
                  Search the web for investigative research. Results can be deep-scraped,
                  saved, annotated, and linked to incidents, persons, or cases.
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
                          <Loader2 className="w-3 h-3 animate-spin" />
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
                          <Loader2 className="w-3 h-3 animate-spin" />
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
              {['all', 'incident', 'person', 'case', 'unlinked'].map(f => (
                <button type="button"
                  key={f}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded-sm transition-colors ${
                    filterEntity === f
                      ? 'bg-brand-600/30 text-brand-300 border border-brand-600/50'
                      : 'text-rmpg-400 hover:text-rmpg-200 border border-transparent'
                  }`}
                  onClick={() => setFilterEntity(f)}
                >
                  {f === 'all' ? 'All' : f === 'unlinked' ? 'Unlinked' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            {loadingSaved && (
              <div className="panel-beveled bg-surface-base p-6 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
                <span className="text-sm text-rmpg-300">Loading saved results...</span>
              </div>
            )}

            {!loadingSaved && filteredSaved.length === 0 && (
              <div className="panel-beveled bg-surface-base p-6 text-center">
                <FileText className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                <p className="text-sm text-rmpg-400">
                  {filterEntity === 'all'
                    ? 'No saved results yet. Search and save results to build your research.'
                    : `No results linked to ${filterEntity === 'unlinked' ? 'nothing' : filterEntity + 's'}.`}
                </p>
              </div>
            )}

            {/* Saved results list */}
            {filteredSaved.map(result => (
              <div key={result.id} className="panel-beveled bg-surface-base p-3 space-y-2">
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
                        {result.type}
                      </span>
                      {result.linked_entity_type && (
                        <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-mono uppercase bg-green-500/20 text-green-400 border border-green-500/30 rounded-sm">
                          {result.linked_entity_type} #{result.linked_entity_id}
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
                      <span>{new Date(result.created_at).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button"
                      className="toolbar-btn flex items-center gap-1 px-2 text-xs"
                      title="Link to entity"
                      onClick={() => {
                        setLinkModalResult(result);
                        setLinkType('incident');
                        setLinkId(result.linked_entity_id?.toString() || '');
                      }}
                    >
                      <Link2 className="w-3 h-3" />
                      Link
                    </button>
                    <button type="button"
                      className="toolbar-btn flex items-center px-1.5 text-xs text-red-400 hover:text-red-300"
                      title="Delete"
                      onClick={() => handleDelete(result.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Notes textarea */}
                <div>
                  {editingNotesId === result.id ? (
                    <textarea
                      className="input-dark w-full text-xs resize-none"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" onClick={() => setLinkModalResult(null)}>
          <div
            className="panel-beveled bg-surface-raised p-4 w-80 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Link2 className="w-4 h-4 text-brand-400" />
              Link to Entity
            </h3>
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
            <input
              type="number"
              className="input-dark w-full"
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
                onClick={() => setLinkModalResult(null)}
              >
                Cancel
              </button>
              <button type="button"
                className="toolbar-btn toolbar-btn-primary flex items-center gap-1 px-3 text-xs"
                disabled={linking || !linkId.trim()}
                onClick={handleLink}
              >
                {linking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
