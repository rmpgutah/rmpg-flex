// ============================================================
// RMPG Flex — CRM Overwatch: Web Intelligence Panel
// Firecrawl-powered web search, deep scrape, lead import
// Saved searches, recent history, bulk import
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Globe,
  Search,
  Loader2,
  Download,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Building2,
  Phone,
  Mail,
  MapPin,
  UserPlus,
  Star,
  Clock,
  Plus,
  X,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../ToastProvider';
import PanelTitleBar from '../PanelTitleBar';

// ── Types ────────────────────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

interface ExtractedData {
  business_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
  description?: string;
  contacts?: { name?: string; title?: string; phone?: string; email?: string }[];
  [key: string]: unknown;
}

interface SavedSearch {
  id: number;
  name: string;
  query: string;
  created_at: string;
}

interface SearchHistoryEntry {
  id: number;
  query: string;
  result_count: number;
  created_at: string;
}

// ── Component ────────────────────────────────────────────────

export default function WebIntelPanel() {
  const { addToast } = useToast();

  // Firecrawl connection
  const [firecrawlConnected, setFirecrawlConnected] = useState(false);
  const [statusChecked, setStatusChecked] = useState(false);

  // Search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Per-result state keyed by URL
  const [scrapingMap, setScrapingMap] = useState<Record<string, boolean>>({});
  const [extractedMap, setExtractedMap] = useState<Record<string, ExtractedData>>({});
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [importingMap, setImportingMap] = useState<Record<string, boolean>>({});

  // Saved searches
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Recent search history
  const [searchHistory, setSearchHistory] = useState<SearchHistoryEntry[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Bulk import
  const [bulkImporting, setBulkImporting] = useState(false);

  // ── Check Firecrawl status on mount ───────────────────────
  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ connected: boolean }>('/crm/firecrawl/status');
        setFirecrawlConnected(!!data?.connected);
      } catch {
        setFirecrawlConnected(false);
      } finally {
        setStatusChecked(true);
      }
    })();
  }, []);

  // ── Load saved searches + history on mount ────────────────
  useEffect(() => {
    (async () => {
      try {
        const saved = await apiFetch<SavedSearch[]>('/crm/firecrawl/saved-searches');
        setSavedSearches(Array.isArray(saved) ? saved : []);
      } catch { /* ignore */ }
    })();
    (async () => {
      try {
        const history = await apiFetch<SearchHistoryEntry[]>('/crm/firecrawl/search-history');
        setSearchHistory(Array.isArray(history) ? history.slice(0, 10) : []);
      } catch { /* ignore */ }
    })();
  }, []);

  // ── Search handler ────────────────────────────────────────
  const handleSearch = useCallback(async (overrideQuery?: string) => {
    const trimmed = (overrideQuery ?? query).trim();
    if (!trimmed) return;
    if (overrideQuery !== undefined) setQuery(trimmed);
    setSearching(true);
    setResults([]);
    setExtractedMap({});
    setExpandedMap({});
    try {
      const data = await apiFetch<{ results: SearchResult[] }>('/crm/firecrawl/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      setResults(data?.results || []);
      if (!(data?.results?.length)) {
        addToast('No results found', 'info');
      }
      // Refresh history after search
      try {
        const history = await apiFetch<SearchHistoryEntry[]>('/crm/firecrawl/search-history');
        setSearchHistory(Array.isArray(history) ? history.slice(0, 10) : []);
      } catch { /* ignore */ }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Search failed';
      addToast(msg, 'error');
    } finally {
      setSearching(false);
    }
  }, [query, addToast]);

  // ── Save search template ──────────────────────────────────
  const handleSaveTemplate = useCallback(async () => {
    const name = saveTemplateName.trim();
    const q = query.trim();
    if (!name || !q) return;
    setSavingTemplate(true);
    try {
      await apiFetch('/crm/firecrawl/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, query: q }),
      });
      addToast('Search template saved', 'success');
      setSaveTemplateName('');
      setShowSaveForm(false);
      // Refresh
      const saved = await apiFetch<SavedSearch[]>('/crm/firecrawl/saved-searches');
      setSavedSearches(Array.isArray(saved) ? saved : []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save template';
      addToast(msg, 'error');
    } finally {
      setSavingTemplate(false);
    }
  }, [saveTemplateName, query, addToast]);

  // ── Deep scrape handler ───────────────────────────────────
  const handleScrape = useCallback(async (url: string) => {
    setScrapingMap(p => ({ ...p, [url]: true }));
    try {
      const data = await apiFetch<{ extracted?: ExtractedData } & ExtractedData>('/crm/firecrawl/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      setExtractedMap(p => ({ ...p, [url]: data?.extracted || data || {} }));
      setExpandedMap(p => ({ ...p, [url]: true }));
      addToast('Data extracted successfully', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Scrape failed';
      addToast(msg, 'error');
    } finally {
      setScrapingMap(p => ({ ...p, [url]: false }));
    }
  }, [addToast]);

  // ── Import handler ────────────────────────────────────────
  const handleImport = useCallback(async (data: Record<string, unknown>, url: string) => {
    setImportingMap(p => ({ ...p, [url]: true }));
    try {
      await apiFetch('/crm/firecrawl/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, source_url: url }),
      });
      addToast('Lead imported successfully', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Import failed';
      addToast(msg, 'error');
    } finally {
      setImportingMap(p => ({ ...p, [url]: false }));
    }
  }, [addToast]);

  // ── Bulk import handler ───────────────────────────────────
  const handleBulkImport = useCallback(async () => {
    if (results.length === 0) return;
    setBulkImporting(true);
    try {
      const data = await apiFetch<{ imported: number; skipped: number }>('/crm/firecrawl/import-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results }),
      });
      const imported = data?.imported ?? 0;
      const skipped = data?.skipped ?? 0;
      addToast(`Imported ${imported}, skipped ${skipped}`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bulk import failed';
      addToast(msg, 'error');
    } finally {
      setBulkImporting(false);
    }
  }, [results, addToast]);

  // ── Relative time helper ──────────────────────────────────
  function relativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="panel-beveled bg-surface-base">
        <PanelTitleBar title="WEB INTELLIGENCE" icon={Globe} />

        {/* Status indicator */}
        <div className="flex items-center gap-2 px-3 pb-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              !statusChecked
                ? 'bg-rmpg-500 animate-pulse'
                : firecrawlConnected
                  ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]'
                  : 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]'
            }`}
          />
          <span className="text-xs text-rmpg-400 font-mono">
            Firecrawl {!statusChecked ? 'checking...' : firecrawlConnected ? 'connected' : 'disconnected'}
          </span>
        </div>
      </div>

      {/* Saved Searches */}
      {savedSearches.length > 0 && (
        <div className="panel-beveled bg-surface-base p-3">
          <div className="flex items-center gap-2 mb-2">
            <Star className="w-3 h-3 text-gold-400" />
            <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider">Saved Searches</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {savedSearches.map(s => (
              <button type="button"
                key={s.id}
                onClick={() => handleSearch(s.query)}
                className="px-2 py-0.5 text-[10px] font-mono bg-brand-600/20 text-brand-400 border border-brand-700/40 rounded-full hover:bg-brand-600/30 transition-colors truncate max-w-[180px]"
                title={s.query}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent History (collapsible) */}
      {searchHistory.length > 0 && (
        <div className="panel-beveled bg-surface-base">
          <button type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-left"
            onClick={() => setHistoryExpanded(p => !p)}
          >
            <Clock className="w-3 h-3 text-rmpg-400" />
            <span className="text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider flex-1">Recent Searches</span>
            {historyExpanded ? <ChevronUp className="w-3 h-3 text-rmpg-500" /> : <ChevronDown className="w-3 h-3 text-rmpg-500" />}
          </button>
          {historyExpanded && (
            <div className="px-3 pb-2 space-y-1">
              {searchHistory.map(h => (
                <button type="button"
                  key={h.id}
                  onClick={() => handleSearch(h.query)}
                  className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-rmpg-700/20 rounded-sm transition-colors"
                >
                  <Search className="w-2.5 h-2.5 text-rmpg-500 shrink-0" />
                  <span className="text-[11px] text-rmpg-200 truncate flex-1">{h.query}</span>
                  <span className="text-[9px] text-rmpg-500 font-mono shrink-0">{h.result_count} results</span>
                  <span className="text-[9px] text-rmpg-600 font-mono shrink-0">{relativeTime(h.created_at)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
            placeholder="Search the web for leads..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button type="button"
            type="button"
            onClick={() => setShowSaveForm(p => !p)}
            disabled={!query.trim()}
            className="toolbar-btn flex items-center justify-center px-2"
            title="Save search template"
          >
            <Star className={`w-3.5 h-3.5 ${showSaveForm ? 'text-gold-400' : ''}`} />
          </button>
          <button type="button"
            type="submit"
            disabled={searching || !query.trim()}
            className="toolbar-btn toolbar-btn-primary flex items-center gap-1.5 px-3"
          >
            {searching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
            <span className="text-xs">Search</span>
          </button>
        </form>

        {/* Save template inline form */}
        {showSaveForm && (
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-rmpg-700">
            <input
              type="text"
              className="input-dark flex-1"
              placeholder="Template name..."
              value={saveTemplateName}
              onChange={e => setSaveTemplateName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveTemplate()}
              autoFocus
            />
            <button type="button"
              type="button"
              disabled={savingTemplate || !saveTemplateName.trim()}
              onClick={handleSaveTemplate}
              className="toolbar-btn toolbar-btn-primary flex items-center gap-1 px-2 text-xs"
            >
              {savingTemplate ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Save
            </button>
            <button type="button"
              type="button"
              onClick={() => { setShowSaveForm(false); setSaveTemplateName(''); }}
              className="toolbar-btn flex items-center px-1.5"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Results header with bulk import */}
      {results.length > 0 && !searching && (
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-semibold text-rmpg-400 uppercase tracking-wider">
            {results.length} Result{results.length !== 1 ? 's' : ''}
          </span>
          <button type="button"
            className="toolbar-btn toolbar-btn-primary flex items-center gap-1.5 px-3 text-xs"
            disabled={bulkImporting}
            onClick={handleBulkImport}
          >
            {bulkImporting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Download className="w-3 h-3" />
            )}
            Import All ({results.length})
          </button>
        </div>
      )}

      {/* Results */}
      <div className="space-y-2">
        {searching && (
          <div className="panel-beveled bg-surface-base p-6 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
            <span className="text-sm text-rmpg-300">Searching the web...</span>
          </div>
        )}

        {!searching && results.length === 0 && query.trim() !== '' && (
          <div className="panel-beveled bg-surface-base p-6 text-center">
            <Globe className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
            <p className="text-sm text-rmpg-400">No results found. Try a different query.</p>
          </div>
        )}

        {!searching && results.length === 0 && query.trim() === '' && (
          <div className="panel-beveled bg-surface-base p-6 text-center">
            <Globe className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
            <p className="text-sm text-rmpg-400">Enter a search query to find potential leads on the web.</p>
          </div>
        )}

        {results.map((result, idx) => {
          const isExpanded = expandedMap[result.url];
          const isScraping = scrapingMap[result.url];
          const extracted = extractedMap[result.url];
          const isImporting = importingMap[result.url];

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
                    disabled={isImporting}
                    onClick={() =>
                      handleImport(
                        { title: result.title, url: result.url, description: result.description },
                        result.url,
                      )
                    }
                  >
                    {isImporting ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Download className="w-3 h-3" />
                    )}
                    Import
                  </button>

                  <button type="button"
                    className="toolbar-btn flex items-center gap-1 px-2 text-xs"
                    disabled={isScraping}
                    onClick={() => handleScrape(result.url)}
                  >
                    {isScraping ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Search className="w-3 h-3" />
                    )}
                    Deep Scrape
                  </button>

                  {extracted && (
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

              {/* Expanded deep scrape data */}
              {extracted && isExpanded && (
                <div className="border-t border-rmpg-700 bg-surface-sunken p-3 space-y-2">
                  <h4 className="text-xs font-semibold text-gold-400 uppercase tracking-wider">
                    Extracted Data
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {extracted.business_name && (
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3 h-3 text-rmpg-400" />
                        <span className="text-rmpg-200">{extracted.business_name}</span>
                      </div>
                    )}
                    {extracted.phone && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3 h-3 text-rmpg-400" />
                        <span className="text-rmpg-200">{extracted.phone}</span>
                      </div>
                    )}
                    {extracted.email && (
                      <div className="flex items-center gap-1.5">
                        <Mail className="w-3 h-3 text-rmpg-400" />
                        <span className="text-rmpg-200">{extracted.email}</span>
                      </div>
                    )}
                    {extracted.address && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-rmpg-400" />
                        <span className="text-rmpg-200">{extracted.address}</span>
                      </div>
                    )}
                    {extracted.website && (
                      <div className="flex items-center gap-1.5 col-span-full">
                        <Globe className="w-3 h-3 text-rmpg-400" />
                        <a
                          href={extracted.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-400 hover:underline truncate"
                        >
                          {extracted.website}
                        </a>
                      </div>
                    )}
                    {extracted.description && (
                      <div className="col-span-full">
                        <p className="text-rmpg-300">{extracted.description}</p>
                      </div>
                    )}
                  </div>

                  {/* Contacts list */}
                  {extracted.contacts && extracted.contacts.length > 0 && (
                    <div className="space-y-1">
                      <h5 className="text-xs font-semibold text-rmpg-300 uppercase">Contacts</h5>
                      {extracted.contacts.map((c, ci) => (
                        <div
                          key={ci}
                          className="flex items-center gap-2 text-xs text-rmpg-200 bg-surface-base rounded-sm px-2 py-1"
                        >
                          {c.name && <span className="font-medium">{c.name}</span>}
                          {c.title && <span className="text-rmpg-400">({c.title})</span>}
                          {c.phone && (
                            <span className="flex items-center gap-0.5 text-rmpg-300">
                              <Phone className="w-2.5 h-2.5" /> {c.phone}
                            </span>
                          )}
                          {c.email && (
                            <span className="flex items-center gap-0.5 text-rmpg-300">
                              <Mail className="w-2.5 h-2.5" /> {c.email}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Import as Lead button */}
                  <button type="button"
                    className="toolbar-btn toolbar-btn-primary flex items-center gap-1.5 px-3 text-xs mt-2"
                    disabled={isImporting}
                    onClick={() => handleImport(extracted as Record<string, unknown>, result.url)}
                  >
                    {isImporting ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <UserPlus className="w-3 h-3" />
                    )}
                    Import as Lead
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
