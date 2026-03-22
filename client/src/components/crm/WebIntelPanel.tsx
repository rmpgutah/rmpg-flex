// ============================================================
// RMPG Flex — CRM Overwatch: Web Intelligence Panel
// Firecrawl-powered web search, deep scrape, lead import
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

  // ── Check Firecrawl status on mount ───────────────────────
  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ connected: boolean }>('/api/crm/firecrawl/status');
        setFirecrawlConnected(!!data?.connected);
      } catch {
        setFirecrawlConnected(false);
      } finally {
        setStatusChecked(true);
      }
    })();
  }, []);

  // ── Search handler ────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setResults([]);
    setExtractedMap({});
    setExpandedMap({});
    try {
      const data = await apiFetch<{ results: SearchResult[] }>('/api/crm/firecrawl/search', {
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
      const data = await apiFetch<{ extracted?: ExtractedData } & ExtractedData>('/api/crm/firecrawl/scrape', {
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
      await apiFetch('/api/crm/firecrawl/import', {
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
          <button
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
      </div>

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
                  <button
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

                  <button
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
                    <button
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
                  <button
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
